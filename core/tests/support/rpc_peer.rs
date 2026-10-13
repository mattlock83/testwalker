//! Independent subprocess fixtures for the native transport regression tests.
use serde_json::{Value, json};
use std::{
    io::{self, BufRead, Write},
    thread,
    time::Duration,
};
fn send(message: Value) {
    println!("{message}");
    io::stdout().flush().unwrap();
}
fn main() {
    let args: Vec<_> = std::env::args().collect();
    let Some(mode) = args.get(1) else {
        return;
    };
    if mode == "block" {
        thread::sleep(Duration::from_secs(2));
        return;
    }
    if mode.starts_with("adapter") {
        adapter(mode, &args[2..]);
        return;
    }
    let input = io::stdin();
    let mut lines = input.lock().lines();
    let request: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
    match mode.as_str() {
        "raw" => {
            println!("{}", args[2]);
            io::stdout().flush().unwrap();
        }
        "hang" => thread::sleep(Duration::from_secs(2)),
        "nested" | "nested-timeout" => {
            send(json!({"jsonrpc":"2.0","id":"cb","method":"callback","params":{}}));
            let nested: Value = serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
            if mode == "nested-timeout" {
                thread::sleep(Duration::from_secs(2));
                return;
            }
            send(json!({"jsonrpc":"2.0","id":request["id"],"result":"outer"}));
            send(json!({"jsonrpc":"2.0","id":nested["id"],"result":"nested"}));
            let _ = lines.next();
        }
        "stderr" => {
            io::stderr().write_all(&vec![b'x'; 100000]).unwrap();
            send(json!({"jsonrpc":"2.0","id":request["id"],"result":{}}));
        }
        "ack-hang" => {
            send(json!({"jsonrpc":"2.0","id":request["id"],"result":{}}));
            thread::sleep(Duration::from_secs(2));
        }
        "notifications" => {
            for _ in 0..1000 {
                send(json!({"jsonrpc":"2.0","method":"status","params":{}}));
                thread::sleep(Duration::from_millis(10));
            }
        }
        _ => panic!("Unknown fixture mode"),
    }
}

fn adapter(mode: &str, args: &[String]) {
    use testwalker_core::model::{Model, violations};
    let input = io::stdin();
    let mut lines = input.lock().lines();
    let mut model: Option<Model> = None;
    let mut state = String::new();
    let mut calls = vec![];
    let mut closed = false;
    let mut services = json!({});
    let mut property_active = false;
    let mut property_executed = false;
    while let Some(Ok(line)) = lines.next() {
        let request: Value = serde_json::from_str(&line).unwrap();
        let method = request["method"].as_str().unwrap();
        let params = &request["params"];
        calls.push(json!({"method":method,"params":params}));
        let result = match method {
            "target.initialize" => {
                model = Some(Model::new(params["model"].clone()).unwrap());
                let service = if mode == "adapter-decision" {
                    "decision.ask"
                } else {
                    "core.info"
                };
                send(
                    json!({"jsonrpc":"2.0","id":"fixture/service","method":service,"params":if service=="decision.ask" {json!({"evidence":{"synthetic":true},"questions":{}})} else {json!({})}}),
                );
                let response: Value =
                    serde_json::from_str(&lines.next().unwrap().unwrap()).unwrap();
                services = response;
                eprintln!("Adapter initialized (diagnostics belong on stderr)");
                json!({"capabilities":{"artifacts":true}})
            }
            "target.reset" => {
                state = model.as_ref().unwrap().start().to_owned();
                json!({})
            }
            "target.execute" => {
                property_executed |= property_active;
                let edge = &params["edge"];
                let fields = params["fields"].as_object().unwrap();
                let business = &edge["properties"]["business"];
                state = if fields.is_empty() {
                    edge["targetVertexId"].as_str().unwrap().to_owned()
                } else if violations(fields, &params["input"]).is_empty() {
                    business
                        .get("accepted at")
                        .unwrap_or(&edge["targetVertexId"])
                        .as_str()
                        .unwrap()
                        .to_owned()
                } else {
                    business["rejected at"].as_str().unwrap().to_owned()
                };
                json!({})
            }
            "target.observe" => json!({"state":state}),
            "target.evaluate" => {
                let model = model.as_ref().unwrap();
                let checks = model.business["rules"].as_array().unwrap().iter().map(|r|json!({"rule":r,"scope":"global","status":"met"}))
                    .chain(model.states[&state]["properties"]["business"]["rules"].as_array().unwrap().iter().map(|r|json!({"rule":r,"scope":"state","status":if mode=="adapter-uncertain" || (mode=="adapter-property-uncertain" && property_executed) {"uncertain"} else {"met"}}))).collect::<Vec<_>>();
                json!({"observed":if mode=="adapter-fail" {"wrong_state"} else {&state},"checks":checks})
            }
            "target.strategy" => params["default"].clone(),
            "target.audit" => json!([]),
            "run.event" => {
                if params["type"] == "test.begin" {
                    property_active = params["data"]["id"]
                        .as_str()
                        .is_some_and(|id| id.starts_with("property/"));
                }
                json!({})
            }
            "target.hook" => json!({}),
            "target.close" => {
                closed = true;
                json!({})
            }
            "target.artifacts" => {
                json!({"entries":[{"kind":"trace","data":{"calls":calls,"closed":closed,"args":args,"services":services}}],"next_offset":null})
            }
            _ => panic!("Unhandled adapter call {method}"),
        };
        send(json!({"jsonrpc":"2.0","id":request["id"],"result":result}));
    }
}
