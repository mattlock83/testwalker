//! Property-generation regressions run directly against Rust/Hegel, without Python wrappers.
use serde_json::{Value, json};
use testwalker_core::{
    Fault,
    model::{Model, violations},
    properties::{boundary_samples, exercise, plan_cases},
};
fn model() -> Model {
    Model::new(serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap()).unwrap()
}
fn samples(field: &Value) -> Vec<Value> {
    boundary_samples(field)
        .into_iter()
        .map(|(_, v)| v)
        .collect()
}
#[test]
fn boundaries_cover_each_partition_and_change_one_field_at_a_time() {
    let model = model();
    let field = &model.data_sets["Reservation"]["Places"];
    let fields = json!({"Adults":field,"Children":field});
    let fields = fields.as_object().unwrap();
    let plan = plan_cases(fields, 200, "boundaries", &json!({}), "");
    let inputs: Vec<_> = plan.iter().map(|p| &p["input"]).collect();
    assert_eq!(
        inputs
            .iter()
            .map(|v| v.to_string())
            .collect::<std::collections::HashSet<_>>()
            .len(),
        inputs.len()
    );
    assert_eq!(
        inputs
            .iter()
            .filter(|v| ***v == json!({"Adults":2,"Children":2}))
            .count(),
        1
    );
    for input in &inputs {
        assert!(
            input
                .as_object()
                .unwrap()
                .values()
                .filter(|v| **v != 2)
                .count()
                <= 1
        );
    }
    for name in ["Adults", "Children"] {
        for value in [
            json!(""),
            json!("   "),
            json!(0),
            json!(1),
            json!(2),
            json!(3),
            json!(4),
            json!(5),
            json!("1.5"),
            json!("not a number"),
        ] {
            assert!(inputs.iter().any(|v| v[name] == value));
        }
    }
}
#[test]
fn email_length_partitions_do_not_accidentally_test_format() {
    let field = json!({"description":"Contact","type":"email","minimum length":8,"maximum length":12,"example":"a@ex.test"});
    let fields = json!({"Contact":field});
    for size in [7, 8, 9, 11, 12, 13] {
        let value = samples(&field)
            .into_iter()
            .find(|v| {
                v.as_str()
                    .is_some_and(|s| s.len() == size && s.contains('@'))
            })
            .unwrap();
        let errors = violations(fields.as_object().unwrap(), &json!({"Contact":value}));
        assert!(!json!(errors).to_string().contains("valid email required"));
        assert_eq!(!errors.is_empty(), [7, 13].contains(&size));
    }
}
#[test]
fn text_numeric_and_choice_boundaries_use_authored_constraints() {
    assert_eq!(
        samples(&json!({"type":"text","example":"Alex","required":true,"minimum length":2})),
        json!(["Alex", "", "   ", "x", "xx", "xxx", "  Alex  "])
            .as_array()
            .unwrap()
            .clone()
    );
    assert_eq!(
        samples(&json!({"type":"text","example":"Alex"})),
        json!(["Alex", "", "  Alex  "]).as_array().unwrap().clone()
    );
    assert_eq!(
        samples(&json!({"type":"number","example":2,"minimum":0.1,"maximum":5.1})),
        json!([2, "", -0.9, 0.1, 1.1, 4.1, 5.1, 6.1, "not a number"])
            .as_array()
            .unwrap()
            .clone()
    );
    let values = samples(
        &json!({"type":"choice","example":"unlisted choice","options":["unlisted choice","other"]}),
    );
    assert_eq!(values.last().unwrap(), "unlisted choice!");
}
#[test]
fn input_modes_and_default_focused_strategy_preserve_partitions() {
    let model = model();
    let fields = model.data_sets["Reservation"].as_object().unwrap();
    for mode in ["all", "generated", "boundaries", "focused", "none"] {
        let plan = plan_cases(fields, 1, mode, &json!({}), "");
        if mode == "none" {
            assert!(plan.is_empty());
            continue;
        }
        let mut inputs = vec![];
        for phase in &plan {
            exercise(fields, phase, 42, true, |data| {
                if phase.get("violations").is_some() {
                    assert_eq!(json!(violations(fields, &data)), phase["violations"]);
                }
                inputs.push(data);
                Ok(json!({"status":"PASS"}))
            })
            .unwrap();
        }
        if mode == "focused" {
            assert_eq!(plan.len(), 10);
            assert_eq!(inputs.len(), 10);
            assert!(
                plan.iter()
                    .all(|p| p["kind"] == "generated" && p.get("input").is_none())
            );
        }
        if mode == "boundaries" {
            assert!(plan.iter().all(|p| p["kind"] == "boundary"));
        }
        if mode == "generated" {
            assert!(plan.iter().all(|p| p["kind"] == "generated"));
        }
    }
}
#[test]
fn focused_hegel_varies_and_shrinks_inside_the_selected_violation() {
    let model = model();
    let fields = model.data_sets["Reservation"].as_object().unwrap();
    let plan = plan_cases(
        fields,
        20,
        "focused",
        &json!({"defaults":{"radius":50}}),
        "",
    );
    let phase = plan
        .iter()
        .find(|p| p["partition"] == "maximum +1")
        .unwrap();
    let mut inputs = std::collections::HashSet::new();
    exercise(fields, phase, 42, true, |data| {
        let value = data["Places"].as_i64().unwrap();
        assert!((5..=54).contains(&value));
        inputs.insert(value);
        Ok(json!({"status":"PASS"}))
    })
    .unwrap();
    assert!(inputs.len() > 1);
    let failure = exercise(fields, phase, 42, true, |data| {
        assert_eq!(json!(violations(fields, &data)), phase["violations"]);
        if data["Places"].as_i64().unwrap() >= 8 {
            Err(Fault::defect(
                "Reproducible defect",
                json!({"case":{"input":data}}),
            ))
        } else {
            Ok(json!({}))
        }
    })
    .unwrap_err();
    assert_eq!(failure.result["case"]["input"], json!({"Places":8}));
}
#[test]
fn all_native_fixture_domains_have_satisfiable_focused_strategies() {
    for text in [
        include_str!("fixtures/capacity.json"),
        include_str!("fixtures/service-workflow.json"),
    ] {
        let model = Model::new(serde_json::from_str(text).unwrap()).unwrap();
        for fields in model.data_sets.values() {
            let fields = fields.as_object().unwrap();
            for phase in plan_cases(fields, 3, "focused", &json!({}), "") {
                let mut attempts = 0;
                exercise(fields, &phase, 42, true, |data| {
                    attempts += 1;
                    assert_eq!(json!(violations(fields, &data)), phase["violations"]);
                    Ok(json!({}))
                })
                .unwrap();
                assert!(attempts > 0);
            }
        }
    }
}
#[test]
fn custom_domains_cannot_change_partition_or_submit_discarded_inputs() {
    let model = model();
    let fields = model.data_sets["Reservation"].as_object().unwrap();
    let mut phase = plan_cases(fields, 1, "focused", &json!({}), "")
        .into_iter()
        .find(|p| p["partition"] == "maximum +1")
        .unwrap();
    phase["domain"] = json!({"kind":"literal","value":2});
    let error = exercise(fields, &phase, 42, true, |_| {
        panic!("Filtered input must not reach the target")
    })
    .unwrap_err();
    assert_eq!(error.status, "INCONCLUSIVE");
    assert!(error.message.contains("Hegel could not establish"));
}

#[test]
fn inconclusive_replay_preserves_generator_choices_and_original_fault() {
    const CHILD: &str = "TESTWALKER_PROPERTY_REPLAY_CHILD";
    let Ok(mode) = std::env::var(CHILD) else {
        // The old implementation returned the right Fault but also printed a caught
        // Hegel nondeterminism panic. Capture a subprocess to check that diagnostic.
        for mode in ["no_shrink", "shrink", "after_pass", "input_limit"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "inconclusive_replay_preserves_generator_choices_and_original_fault",
                    "--nocapture",
                ])
                .env(CHILD, mode)
                .output()
                .unwrap();
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(output.status.success(), "{mode}: {stderr}");
            assert!(
                !stderr.contains("non-deterministic") && !stderr.contains("panicked at"),
                "{mode} emitted an unexpected panic: {stderr}"
            );
        }
        return;
    };
    let model = model();
    let fields = model.data_sets["Reservation"].as_object().unwrap();
    let phase = json!({"kind":"generated","field":"Places","max_examples":20,"domain":{"kind":"integer","minimum":0,"maximum":100}});
    let mut calls = 0;
    let mut recorded = Value::Null;
    let error = exercise(fields, &phase, 42, mode != "no_shrink", |data| {
        calls += 1;
        if mode == "after_pass" && calls == 1 {
            return Ok(json!({"status":"PASS"}));
        }
        if mode == "input_limit" && calls == 1 {
            recorded = data.clone();
            return Err(Fault::defect(
                "Recorded defect",
                json!({"case":{"input":data}}),
            ));
        }
        if mode == "input_limit" {
            return Err(Fault {
                status: "INCONCLUSIVE".into(),
                message: "Input allowance exhausted".into(),
                result: json!({"input_limit":true}),
            });
        }
        recorded = data.clone();
        Err(Fault {
            status: "INCONCLUSIVE".into(),
            message: "Decision confidence is insufficient".into(),
            result: json!({"case":{"input":data,"evidence":{"message":"Unresolved state"}}}),
        })
    })
    .unwrap_err();
    assert_eq!(error.result["case"]["input"], recorded);
    if mode == "input_limit" {
        assert_eq!(calls, 2);
        assert_eq!(error.status, "FAIL");
        assert_eq!(error.message, "Recorded defect");
        assert_eq!(error.result["case"]["minimization_limited"], true);
    } else {
        assert_eq!(calls, if mode == "after_pass" { 2 } else { 1 });
        assert_eq!(error.status, "INCONCLUSIVE");
        assert_eq!(error.message, "Decision confidence is insufficient");
        assert_eq!(
            error.result["case"]["evidence"]["message"],
            "Unresolved state"
        );
    }
}
