//! Fixed scenarios replay through the same public adapter contract as property inputs.
use serde_json::{Value, json};
use testwalker_core::{
    Fault, Target,
    engine::{self, Options},
    model::Model,
};

fn document(example: Value) -> Value {
    json!({"models":[{"id":"fixed","name":"Fixed inputs","generator":"quick_random(edge_coverage(100))","startElementId":"form","properties":{"business":{"version":3,"purpose":"Submit a literal scenario","rules":["The scenario is observable."],"data sets":{}}},
    "vertices":[
      {"id":"form","name":"v_Form","properties":{"business":{"description":"Enter request details","rules":["The request form is available."]}}},
      {"id":"done","name":"v_Done","properties":{"business":{"description":"Request received","rules":["The request is recorded."]}}}
    ],"edges":[
      {"id":"submit","name":"e_Submit","sourceVertexId":"form","targetVertexId":"done","properties":{"business":{"intent":"Submit the request","example":example}}},
      {"id":"again","name":"e_Again","sourceVertexId":"done","targetVertexId":"form","properties":{"business":{"intent":"Start another request"}}}
    ]}]})
}

#[derive(Default)]
struct Adapter {
    state: String,
    executions: Vec<Value>,
}
impl Target for Adapter {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        match method {
            "target.initialize" => Ok(json!({})),
            "target.reset" => {
                self.state = "form".into();
                Ok(json!({}))
            }
            "target.execute" => {
                if params["edge"]["id"] == "submit" {
                    assert_eq!(
                        params["input"],
                        json!({"Name":" Alex ","Quantity":3.5,"Consent":true})
                    );
                    assert_eq!(params["fields"]["Name"]["description"], "Name");
                    assert_eq!(params["fields"]["Name"]["trim spaces"], false);
                    self.state = "done".into();
                } else {
                    self.state = "form".into();
                }
                self.executions.push(params);
                Ok(json!({}))
            }
            "target.observe" => Ok(json!({"state":self.state})),
            "target.evaluate" => Ok(
                json!({"status":if params["expected"]==self.state {"PASS"}else{"FAIL"},"observed":self.state,"checks":[{"scope":"global","rule":"The scenario is observable.","status":"met"}]}),
            ),
            "target.audit" => Ok(
                json!({"status":"PASS","checks":[{"scope":"global","rule":"The scenario is observable.","status":"met"}]}),
            ),
            "target.hook" | "target.close" | "run.event" => Ok(json!({})),
            _ => Err(Fault::unknown(format!(
                "Unexpected adapter method {method}"
            ))),
        }
    }
}

#[test]
fn fixed_inputs_are_executed_reported_and_replayed_without_property_campaigns() {
    let input = json!({"Name":" Alex ","Quantity":3.5,"Consent":true});
    let model = Model::new(document(input.clone())).unwrap();
    let options = Options {
        input_mode: "none".into(),
        evaluator: "adapter".into(),
        max_steps: 100,
        ..Default::default()
    };
    let mut adapter = Adapter::default();
    let report = engine::run(&model, &mut adapter, options.clone(), json!({}), None).unwrap();
    assert_eq!(report["status"], "PASS");
    assert_eq!(report["input_attempts"], 0);
    assert_eq!(report["scope"]["available_campaigns"], 0);
    assert_eq!(report["scope"]["selected_campaigns"], 0);
    let test = report["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|test| test["element"]["id"] == "submit")
        .unwrap();
    assert_eq!(test["input"], input);
    assert_eq!(test["replay_recipe"]["input"], input);
    let recipe = test["replay_recipe"].clone();
    let mut fresh = Adapter::default();
    let replay = engine::run(
        &model,
        &mut fresh,
        options.clone(),
        json!({}),
        Some(recipe.clone()),
    )
    .unwrap();
    assert_eq!(replay["status"], "PASS");
    assert_eq!(replay["scope"]["selected_campaigns"], 0);
    assert_eq!(replay["input_attempts"], 0);
    assert_eq!(fresh.executions.len(), 1);
    let mut altered = recipe;
    altered["input"]["Name"] = json!("Changed");
    let mut fresh = Adapter::default();
    let rejected = engine::run(&model, &mut fresh, options, json!({}), Some(altered)).unwrap();
    assert_eq!(rejected["status"], "INCONCLUSIVE");
    assert!(fresh.executions.is_empty());
}

#[test]
fn fixed_examples_are_bounded_literals_without_acceptance_or_rejection_domains() {
    for example in [
        json!({}),
        json!(null),
        json!([]),
        json!({"Name":{}}),
        json!({"Name":[1]}),
        json!({"":1}),
        json!({"Name":"a".repeat(2001)}),
    ] {
        assert!(Model::new(document(example)).is_err());
    }
    let too_many: serde_json::Map<String, Value> = (0..21)
        .map(|index| (format!("Field {index}"), json!(index)))
        .collect();
    assert!(Model::new(document(json!(too_many))).is_err());
    let mut input = document(json!({"Name":"literal"}));
    input["models"][0]["edges"][0]["properties"]["business"]["rejected at"] = json!("form");
    assert!(Model::new(input).is_err());
}
