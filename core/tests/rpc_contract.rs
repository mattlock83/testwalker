//! Wire-level assertions independent of the execution model and target adapter.
use serde_json::{Value, json};
use std::io::Cursor;
use testwalker_core::protocol::Peer;

fn exchange(lines: &[Value]) -> Vec<Value> {
    let input = lines
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    exchange_raw(&input)
}

fn exchange_raw(input: &str) -> Vec<Value> {
    let mut output = Vec::new();
    Peer::new(Cursor::new(input.as_bytes()), &mut output)
        .serve()
        .unwrap();
    String::from_utf8(output)
        .unwrap()
        .lines()
        .map(|line| serde_json::from_str(line).unwrap())
        .collect()
}

fn info(id: Value) -> Value {
    json!({"jsonrpc":"2.0","id":id,"method":"core.info"})
}

fn assert_error(response: &Value, id: Value, code: i64) {
    assert_eq!(response["jsonrpc"], "2.0");
    assert_eq!(response["id"], id);
    assert_eq!(response["error"]["code"], code);
    assert!(response["error"]["message"].is_string());
    assert!(response.get("result").is_none());
}

#[test]
fn decision_default_accepts_eighty_percent_and_explicit_threshold_still_applies() {
    let answer = json!({"answers":{"state":{"choice":"a","confidence":0.80,
        "probabilities":{"a":0.80,"b":0.20}}}});
    let replies = exchange(&[
        json!({"jsonrpc":"2.0","id":1,"method":"decision.configure","params":{}}),
        json!({"jsonrpc":"2.0","id":2,"method":"decision.answer",
            "params":{"result":answer,"name":"state","choices":["a","b"]}}),
        json!({"jsonrpc":"2.0","id":3,"method":"decision.answer",
            "params":{"result":answer,"name":"state","choices":["a","b"],"threshold":0.85}}),
    ]);
    assert!(replies[0].get("result").is_some());
    assert_eq!(replies[1]["result"], "a");
    assert_error(&replies[2], json!(3), -32001);
}

#[test]
fn response_identifiers_preserve_json_type_and_value() {
    let ids = [json!("request/1"), json!(17), json!(0), Value::Null];
    let responses = exchange(&ids.iter().cloned().map(info).collect::<Vec<_>>());
    assert_eq!(responses.len(), ids.len());
    for (response, id) in responses.iter().zip(ids) {
        assert_eq!(response["jsonrpc"], "2.0");
        assert_eq!(response["id"], id);
        assert_eq!(response["result"]["name"], "testwalker-core");
        assert!(response.get("error").is_none());
    }
}

#[test]
fn invalid_artifact_options_do_not_start_a_target_or_poison_the_worker() {
    let model: Value = serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap();
    for extra in [
        json!({"output": 5}),
        json!({"output": ""}),
        json!({"target": "invalid"}),
    ] {
        let mut params = json!({"model": model});
        params
            .as_object_mut()
            .unwrap()
            .extend(extra.as_object().unwrap().clone());
        let replies = exchange(&[
            json!({"jsonrpc":"2.0","id":1,"method":"run.start","params":params}),
            json!({"jsonrpc":"2.0","id":2,"method":"core.shutdown"}),
        ]);
        assert_eq!(replies.len(), 2);
        assert_error(&replies[0], json!(1), -32001);
        assert!(
            replies[1].get("result").is_some(),
            "The worker remained active after invalid configuration"
        );
    }
}

#[test]
fn valid_notifications_do_not_receive_success_or_error_responses() {
    let responses = exchange(&[
        json!({"jsonrpc":"2.0","method":"core.info"}),
        json!({"jsonrpc":"2.0","method":"unknown.method"}),
        json!({"jsonrpc":"2.0","method":"model.validate","params":{"model":null}}),
        json!({"jsonrpc":"2.0","method":"core.shutdown","params":42}),
        info(json!("still-running")),
    ]);
    assert_eq!(responses.len(), 1);
    assert_eq!(responses[0]["id"], "still-running");
    assert_eq!(responses[0]["result"]["name"], "testwalker-core");
}

#[test]
fn invalid_envelopes_respond_with_invalid_request_and_recover() {
    for request in [
        json!({}),
        json!({"jsonrpc":"1.0","method":"core.info"}),
        json!({"jsonrpc":"2.0"}),
        json!({"jsonrpc":"2.0","method":17}),
        json!(null),
        json!(true),
        json!(17),
        json!("core.info"),
        json!([]),
        json!([{"jsonrpc":"2.0","id":1,"method":"core.info"}]),
    ] {
        let responses = exchange(&[request, info(json!("recovered"))]);
        assert_eq!(responses.len(), 2);
        assert_error(&responses[0], Value::Null, -32600);
        assert_eq!(responses[1]["id"], "recovered");
        assert_eq!(responses[1]["result"]["name"], "testwalker-core");
    }
}

#[test]
fn invalid_request_preserves_only_a_usable_identifier() {
    for id in [json!(true), json!([]), json!({"id":1})] {
        let responses = exchange(&[info(id)]);
        assert_eq!(responses.len(), 1);
        assert_error(&responses[0], Value::Null, -32600);
    }
    for id in [json!("request/1"), json!(17), Value::Null] {
        let responses = exchange(&[
            json!({"jsonrpc":"1.0","id":id,"method":"core.shutdown"}),
            info(json!("still-running")),
        ]);
        assert_eq!(responses.len(), 2);
        assert_error(&responses[0], id, -32600);
        assert_eq!(responses[1]["id"], "still-running");
    }
}

#[test]
fn scalar_parameters_are_rejected_without_executing_the_method() {
    for params in [json!(null), json!(true), json!(17), json!("invalid")] {
        let responses = exchange(&[
            json!({"jsonrpc":"2.0","id":"invalid","method":"core.shutdown","params":params}),
            info(json!("still-running")),
        ]);
        assert_eq!(responses.len(), 2);
        assert_error(&responses[0], json!("invalid"), -32602);
        assert_eq!(responses[1]["result"]["name"], "testwalker-core");
    }
}

#[test]
fn parse_method_and_domain_errors_remain_distinguishable() {
    let responses = exchange_raw(
        "invalid json\n\
         {\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"unknown.method\"}\n\
         {\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"model.validate\",\"params\":{\"model\":null}}\n\
         {\"jsonrpc\":\"2.0\",\"id\":3,\"method\":\"core.info\"}\n",
    );
    assert_eq!(responses.len(), 4);
    assert_error(&responses[0], Value::Null, -32700);
    assert_error(&responses[1], json!(1), -32601);
    assert_error(&responses[2], json!(2), -32001);
    assert_eq!(responses[2]["error"]["data"]["status"], "INCONCLUSIVE");
    assert_eq!(responses[3]["result"]["name"], "testwalker-core");
}

#[test]
fn graceful_shutdown_acknowledges_then_stops_reading_requests() {
    let responses = exchange(&[
        json!({"jsonrpc":"2.0","id":1,"method":"core.shutdown"}),
        info(json!(2)),
    ]);
    assert_eq!(responses, vec![json!({"jsonrpc":"2.0","id":1,"result":{}})]);
}

#[test]
fn framework_client_configuration_preserves_exact_thresholds_and_normalization() {
    let model: Value = serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap();
    let responses = exchange(&[
        json!({"jsonrpc":"2.0","id":1,"method":"model.configure","params":{"model":model,"exploration":{"generator":"random","edges":50.5,"states":70.2}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"model.validate","params":{"model":model}}),
    ]);
    let configured = &responses[0]["result"];
    let original = &responses[1]["result"];
    assert_eq!(
        configured["document"]["models"][0]["generator"],
        "random(edge_coverage(51) and vertex_coverage(71))"
    );
    assert_eq!(
        configured["document"]["models"][0]["properties"]["business"]["coverage"]["edges"],
        50.5
    );
    assert_eq!(
        original["document"]["models"][0]["properties"]["business"]["coverage"]["edges"],
        100
    );
    assert_ne!(configured["model_hash"], original["model_hash"]);
    assert_eq!(original["examples"]["submit"], json!({"Places":2}));
    assert_eq!(original["examples"]["submit_invalid"], json!({"Places":0}));
}

#[test]
fn client_validation_uses_native_rules_and_recovers_after_bad_strategy_references() {
    let fields = json!({"Amount":{"description":"Exact amount","type":"number","minimum":0.1,"maximum":0.1,"example":0.1,"required":true}});
    let responses = exchange(&[
        json!({"jsonrpc":"2.0","id":1,"method":"property.validate","params":{"fields":fields,"input":{"Amount":"0.1000000000000000000001"}}}),
        json!({"jsonrpc":"2.0","id":2,"method":"property.validate","params":{"fields":fields,"input":{}}}),
        json!({"jsonrpc":"2.0","id":3,"method":"property.policy","params":{"policy":{"data sets":{"Unknown":{}}},"data_sets":{"Money":fields}}}),
        json!({"jsonrpc":"2.0","id":4,"method":"property.policy","params":{"policy":{"defaults":{"cases":true}},"data_sets":{"Money":fields}}}),
        json!({"jsonrpc":"2.0","id":5,"method":"property.policy","params":{"policy":{"data sets":{"Money":{"Missing":{}}}},"data_sets":{"Money":fields}}}),
        info(json!("still-running")),
    ]);
    assert_eq!(
        responses[0]["result"]["violations"][0]["violations"],
        json!(["above maximum"])
    );
    assert_eq!(
        responses[1]["result"]["violations"][0]["violations"],
        json!(["required"])
    );
    for (index, id) in [(2, 3), (3, 4), (4, 5)] {
        assert_error(&responses[index], json!(id), -32001);
    }
    assert_eq!(responses[5]["result"]["name"], "testwalker-core");
}
