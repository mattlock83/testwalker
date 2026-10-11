//! Offline official meta-schema checks plus validation of real worker/callback traffic.
use jsonschema::{Retrieve, Uri, Validator};
use serde_json::{Value, json};
use std::{collections::HashSet, time::Duration};
use testwalker_core::{
    Fault,
    engine::{self, Options},
    model::{Model, violations},
    rpc::{
        SELF_MODEL,
        target::RpcTarget,
        transport::{Handler, NoHandler, Transport},
    },
};
fn core() -> Value {
    serde_json::from_str(include_str!("../openrpc.json")).unwrap()
}
fn adapter() -> Value {
    serde_json::from_str(include_str!("../openrpc.adapter.json")).unwrap()
}
struct Pinned;
impl Retrieve for Pinned {
    fn retrieve(
        &self,
        uri: &Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        let text = match uri.as_str().trim_end_matches('/') {
            "https://meta.open-rpc.org" => {
                include_str!("fixtures/openrpc/open-rpc-meta-schema-1.14.9.json")
            }
            "https://meta.json-schema.tools" => {
                include_str!("fixtures/openrpc/json-schema-tools-meta-1.8.0.json")
            }
            _ => return Err(format!("Unpinned reference: {uri}").into()),
        };
        Ok(serde_json::from_str(text)?)
    }
}
fn resolve<'a>(document: &'a Value, mut value: &'a Value) -> &'a Value {
    while let Some(reference) = value["$ref"].as_str() {
        assert!(reference.starts_with("#/"));
        value = document
            .pointer(&reference[1..])
            .unwrap_or_else(|| panic!("Missing reference: {reference}"));
    }
    value
}
fn validator(schema: &Value) -> Validator {
    jsonschema::draft7::options()
        .with_retriever(Pinned)
        .build(schema)
        .unwrap()
}
fn validators(document: &Value, name: &str) -> (Validator, Validator) {
    let method = document["methods"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| resolve(document, m))
        .find(|m| m["name"] == name)
        .unwrap();
    let mut properties = json!({});
    let mut required = vec![];
    for descriptor in method["params"].as_array().unwrap() {
        let p = resolve(document, descriptor);
        properties[p["name"].as_str().unwrap()] = p["schema"].clone();
        if p["required"] == true {
            required.push(p["name"].clone());
        }
    }
    let parameters = json!({"components":document["components"],"type":"object","properties":properties,"required":required,"additionalProperties":false});
    let mut response = resolve(document, &method["result"])["schema"].clone();
    response["components"] = document["components"].clone();
    (validator(&parameters), validator(&response))
}
fn valid(document: &Value, method: &str, params: &Value, result: &Value) {
    let (request, response) = validators(document, method);
    request
        .validate(params)
        .unwrap_or_else(|e| panic!("{method} params: {e}"));
    response
        .validate(result)
        .unwrap_or_else(|e| panic!("{method} result: {e}"));
}
fn walk(document: &Value, value: &Value) {
    match value {
        Value::Object(map) => {
            if map.contains_key("$ref") {
                resolve(document, value);
            }
            if let Some(schema) = map.get("schema") {
                let mut schema = schema.clone();
                schema["components"] = document["components"].clone();
                validator(&schema);
            }
            for (key, child) in map {
                if !["examples", "default", "value"].contains(&key.as_str())
                    && !key.starts_with("x-")
                {
                    walk(document, child);
                }
            }
        }
        Value::Array(a) => {
            for child in a {
                walk(document, child);
            }
        }
        _ => {}
    }
}
#[test]
fn published_documents_conform_to_official_schema_and_examples_offline() {
    let meta: Value = serde_json::from_str(include_str!(
        "fixtures/openrpc/open-rpc-meta-schema-1.14.9.json"
    ))
    .unwrap();
    let meta = jsonschema::draft7::options()
        .with_retriever(Pinned)
        .should_validate_formats(true)
        .build(&meta)
        .unwrap();
    for doc in [core(), adapter()] {
        meta.validate(&doc).unwrap();
        walk(&doc, &doc);
        for schema in doc["components"]["schemas"].as_object().unwrap().values() {
            let mut schema = schema.clone();
            schema["components"] = doc["components"].clone();
            validator(&schema);
        }
        let mut names = HashSet::new();
        let mut count = 0;
        for method in doc["methods"].as_array().unwrap() {
            let method = resolve(&doc, method);
            assert!(names.insert(method["name"].as_str().unwrap()));
            if let Some(examples) = method["examples"].as_array() {
                for example in examples {
                    let example = resolve(&doc, example);
                    let mut params = json!({});
                    for p in example["params"].as_array().unwrap() {
                        let p = resolve(&doc, p);
                        assert!(params.get(p["name"].as_str().unwrap()).is_none());
                        params[p["name"].as_str().unwrap()] = p["value"].clone();
                    }
                    valid(
                        &doc,
                        method["name"].as_str().unwrap(),
                        &params,
                        &resolve(&doc, &example["result"])["value"],
                    );
                    count += 1;
                }
            }
        }
        assert!(count >= 5);
    }
    assert!(
        jsonschema::options()
            .with_retriever(Pinned)
            .build(&json!({"$ref":"https://unexpected.test/schema"}))
            .is_err()
    );
}
#[test]
fn actual_self_model_traffic_matches_published_methods_and_faults() {
    let model = Model::new(serde_json::from_str(SELF_MODEL).unwrap()).unwrap();
    let mut target = RpcTarget::new(
        model.clone(),
        vec![env!("CARGO_BIN_EXE_testwalker-core").into()],
        Duration::from_secs(10),
        None,
    )
    .unwrap();
    let result = engine::run(
        &model,
        &mut target,
        Options {
            max_steps: 1000,
            evaluator: "adapter".into(),
            ..Options::default()
        },
        json!({}),
        None,
    )
    .unwrap();
    assert_eq!(result["status"], "PASS", "{}", result["error"]);
    let document = core();
    let callback = adapter();
    let fault = validator(
        &json!({"$ref":"#/components/schemas/Fault","components":document["components"]}),
    );
    let mut codes = HashSet::new();
    let mut seen = HashSet::new();
    for entry in target.trace {
        if let Some(method) = entry["request"]["method"].as_str() {
            if document["methods"]
                .as_array()
                .unwrap()
                .iter()
                .any(|m| m["name"] == method)
            {
                seen.insert(method.to_owned());
            }
            if entry["response"].get("result").is_some() {
                valid(
                    &document,
                    method,
                    &entry["request"].get("params").cloned().unwrap_or(json!({})),
                    &entry["response"]["result"],
                );
                seen.insert(method.to_owned());
            }
            if method == "rpc.discover" {
                assert_eq!(entry["response"]["result"], document);
            }
            if method == "core.info" && entry["response"].get("result").is_some() {
                assert_eq!(
                    entry["response"]["result"]["methods"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .collect::<HashSet<_>>(),
                    document["methods"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|m| &m["name"])
                        .collect()
                );
            }
        }
        if let Some(code) = entry["response"]["error"]["code"].as_i64() {
            codes.insert(code);
            if [-32601, -32001].contains(&code) {
                fault.validate(&entry["response"]["error"]["data"]).unwrap();
            }
        }
        let mut pending = std::collections::HashMap::new();
        for message in entry["messages"].as_array().unwrap() {
            let m = &message["message"];
            if message["direction"] == "received" && m["method"].is_string() {
                pending.insert(m["id"].to_string(), m.clone());
            } else if message["direction"] == "sent"
                && m.get("result").is_some()
                && let Some(call) = pending.remove(&m["id"].to_string())
            {
                valid(
                    &callback,
                    call["method"].as_str().unwrap(),
                    &call["params"],
                    &m["result"],
                );
            }
        }
    }
    assert_eq!(
        codes,
        HashSet::from([-32700, -32600, -32602, -32601, -32001])
    );
    assert_eq!(
        seen,
        document["methods"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|m| !["decision.ask", "decision.post"].contains(&m["name"].as_str().unwrap()))
            .map(|m| m["name"].as_str().unwrap().to_owned())
            .collect()
    );
}
struct CallbackTarget {
    document: Value,
    seen: HashSet<String>,
    state: String,
}
impl Handler for CallbackTarget {
    fn handle(&mut self, _: &mut Transport, method: &str, params: Value) -> Result<Value, Fault> {
        self.seen.insert(method.into());
        let result = match method {
            "target.initialize" => {
                json!({"capabilities":{"isolated_checkpoints":true,"artifacts":true}})
            }
            "target.reset" => {
                self.state = "form".into();
                json!({})
            }
            "target.execute" => {
                self.state = if params["fields"].as_object().unwrap().is_empty() {
                    "form"
                } else if violations(params["fields"].as_object().unwrap(), &params["input"])
                    .is_empty()
                {
                    "accepted"
                } else {
                    "rejected"
                }
                .into();
                json!({})
            }
            "target.observe" => json!({"state":self.state}),
            "target.evaluate" => {
                json!({"observed":params["observation"]["state"],"checks":[{"rule":"The outcome is visible.","scope":"state","status":"met"}]})
            }
            "target.audit" => json!(
                params["rules"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|rule| json!({"rule":rule,"scope":"global","status":"met"}))
                    .collect::<Vec<_>>()
            ),
            "target.checkpoint" => json!({"saved_state":self.state}),
            "target.restore" => {
                self.state = params["checkpoint"]["saved_state"].as_str().unwrap().into();
                json!({})
            }
            "target.strategy" => params["default"].clone(),
            "target.artifacts" => json!({"entries":[],"next_offset":null}),
            "property.evaluate" => json!({"status":"PASS"}),
            _ => {
                assert!(["run.event", "target.hook", "target.close"].contains(&method));
                json!({})
            }
        };
        valid(&self.document, method, &params, &result);
        Ok(result)
    }
}
#[test]
fn every_callback_and_replay_are_validated_on_the_wire() {
    let server = core();
    let mut target = CallbackTarget {
        document: adapter(),
        seen: HashSet::new(),
        state: "form".into(),
    };
    let model =
        Model::new(serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap()).unwrap();
    let fields = &model.data_sets["Reservation"];
    let mut peer = Transport::spawn(
        &[env!("CARGO_BIN_EXE_testwalker-core").into()],
        Duration::from_secs(10),
        None,
    )
    .unwrap();
    let params = json!({"fields":fields,"options":{"custom_strategies":true,"shrink":false}});
    let result = peer
        .request("property.exercise", Some(params.clone()), &mut target)
        .unwrap()["result"]
        .clone();
    valid(&server, "property.exercise", &params, &result);
    assert_eq!(result["status"], "PASS");
    let params = json!({"model":model.document,"options":{"max_steps":1000,"max_input_attempts":2,"evaluator":"adapter"}});
    let report = peer
        .request("run.start", Some(params.clone()), &mut target)
        .unwrap()["result"]
        .clone();
    valid(&server, "run.start", &params, &report);
    assert_eq!(report["status"], "PASS", "{}", report["error"]);
    assert_eq!(
        peer.request("run.results", None, &mut target).unwrap()["result"],
        report
    );
    let recipe = report["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["kind"] == "graph")
        .unwrap()["replay_recipe"]
        .clone();
    let mut params = params;
    params["case"] = recipe;
    let replay = peer
        .request("case.replay", Some(params.clone()), &mut target)
        .unwrap()["result"]
        .clone();
    valid(&server, "case.replay", &params, &replay);
    assert_eq!(replay["status"], "PASS");
    assert_eq!(
        target.seen,
        adapter()["methods"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["name"].as_str().unwrap().to_owned())
            .collect()
    );
    valid(
        &server,
        "core.shutdown",
        &json!({}),
        &peer.request("core.shutdown", None, &mut NoHandler).unwrap()["result"],
    );
}
#[test]
fn schema_bounds_reject_empty_domains_and_invalid_audit_limits() {
    let document = core();
    let (audit, _) = validators(&document, "decision.audit");
    for value in [json!(0), json!(1025), json!(true)] {
        assert!(!audit.is_valid(&json!({"limit":value})));
    }
    let model: Value = serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap();
    let fields = &model["models"][0]["properties"]["business"]["data sets"]["Reservation"];
    let (samples, _) = validators(&document, "property.samples");
    assert!(samples.is_valid(&json!({"fields":fields})));
    assert!(!samples.is_valid(&json!({"fields":{}})));
    assert!(!samples.is_valid(&json!({"fields":{"One":fields["Places"],"Two":fields["Places"]}})));
}
