//! Keep-going preserves failures, verifies recovery and continues only independent work.
use serde_json::{Value, json};
use testwalker_core::{
    Fault, Target,
    engine::{self, Options},
    model::{Model, violations},
    report,
};

fn model(alternate: bool) -> Model {
    let mut document: Value = serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap();
    document["models"][0]["properties"]["business"]["coverage"] = json!({"edges":0,"states":0});
    document["models"][0]["vertices"].as_array_mut().unwrap().push(json!({"id":"info","name":"info","properties":{"business":{"description":"Read information","rules":["The outcome is visible."]}}}));
    let edges = document["models"][0]["edges"].as_array_mut().unwrap();
    for (id, source, target) in [("open_info", "form", "info"), ("back_info", "info", "form")] {
        edges.push(json!({"id":id,"name":id,"sourceVertexId":source,"targetVertexId":target,"properties":{"business":{"intent":id}}}));
    }
    if alternate {
        let mut edge = edges[0].clone();
        edge["id"] = json!("alternate_submit");
        edge["name"] = json!("alternate_submit");
        edge["properties"]["business"]["example"] = json!({"Places":3});
        edges.push(edge);
    }
    Model::new(document).unwrap()
}
fn options() -> Options {
    let mut path = vec![json!({"kind":"state","id":"form"})];
    for (edge, state) in [
        ("submit", "accepted"),
        ("another", "form"),
        ("open_info", "info"),
        ("back_info", "form"),
        ("submit_invalid", "rejected"),
        ("correct", "form"),
    ] {
        path.push(json!({"kind":"edge","id":edge}));
        path.push(json!({"kind":"state","id":state}));
    }
    Options {
        keep_going: true,
        evaluator: "adapter".into(),
        input_mode: "boundaries".into(),
        shrink: false,
        max_steps: 1000,
        paths: Some(vec![path]),
        ..Options::default()
    }
}
#[derive(Default)]
struct Fixture {
    mode: &'static str,
    state: String,
    phase: String,
    last_edge: String,
    calls: Vec<(String, Value)>,
    resets: usize,
    checkpoints: bool,
    blank_submissions: usize,
}
impl Target for Fixture {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        self.calls.push((method.into(), params.clone()));
        match method {
            "target.initialize" => {
                Ok(json!({"capabilities":{"isolated_checkpoints":self.checkpoints}}))
            }
            "target.hook" => {
                self.phase = params["context"]["phase"].as_str().unwrap().into();
                if self.mode == "cleanup"
                    && params["event"] == "after_case"
                    && params["context"]["error"]["status"] == "FAIL"
                {
                    return Err(Fault::defect("Cleanup assertion failed", json!({})));
                }
                Ok(json!({}))
            }
            "target.reset" => {
                self.resets += 1;
                if self.mode == "reset" && self.resets > 1 {
                    return Err(Fault::unknown("Fixture reset unavailable"));
                }
                self.state = "form".into();
                self.last_edge.clear();
                Ok(json!({}))
            }
            "target.execute" => {
                self.last_edge = params["edge"]["id"].as_str().unwrap().into();
                if self.phase == "property" && params["input"]["Places"] == "" {
                    self.blank_submissions += 1;
                    if self.mode == "shrink_fatal" && self.blank_submissions > 1 {
                        return Err(Fault::unknown("Minimization provider unavailable").run_fatal());
                    }
                }
                if self.phase == "property" && self.mode == "fatal" {
                    return Err(Fault::unknown("Provider unavailable").run_fatal());
                }
                if self.phase == "property"
                    && self.mode == "failure_then_fatal"
                    && params["input"]["Places"] == "   "
                {
                    return Err(Fault::unknown("Shared allowance exhausted").run_fatal());
                }
                let fields = params["fields"].as_object().unwrap();
                self.state = if fields.is_empty() {
                    params["edge"]["targetVertexId"].as_str().unwrap()
                } else if violations(fields, &params["input"]).is_empty()
                    || (self.phase == "property"
                        && [
                            "properties",
                            "failure_then_fatal",
                            "shrink_fatal",
                            "cleanup",
                        ]
                        .contains(&self.mode)
                        && [json!(5), json!("")].contains(&params["input"]["Places"]))
                {
                    "accepted"
                } else {
                    "rejected"
                }
                .into();
                Ok(json!({}))
            }
            "target.observe" => {
                Ok(json!({"state":self.state,"phase":self.phase,"edge":self.last_edge}))
            }
            "target.evaluate" => {
                let observed = if (self.mode == "property_unknown"
                    && self.phase == "property"
                    && params["input"]["Places"] == 2)
                    || (self.mode == "unknown"
                        && self.phase == "graph"
                        && self.last_edge == "submit")
                {
                    Value::Null
                } else {
                    json!(self.state)
                };
                let broken =
                    self.mode == "rule" && self.phase == "graph" && self.last_edge == "submit";
                Ok(
                    json!({"observed":observed,"checks":[{"rule":"The outcome is visible.","scope":"state","status":if broken{"broken"}else{"met"}},{"rule":"Invalid capacity is rejected.","scope":"global","status":"met"}]}),
                )
            }
            "target.checkpoint" => Ok(json!({"state":self.state})),
            "target.restore" => {
                self.state = params["checkpoint"]["state"].as_str().unwrap().into();
                Ok(json!({}))
            }
            "target.close" | "run.event" => Ok(json!({})),
            "target.audit" => Ok(json!([])),
            _ => panic!("Unexpected callback: {method}"),
        }
    }
}
fn run(mode: &'static str, options: Options, checkpoints: bool) -> (Fixture, Value) {
    let mut fixture = Fixture {
        mode,
        checkpoints,
        ..Default::default()
    };
    let result = engine::run(&model(false), &mut fixture, options, json!({}), None).unwrap();
    (fixture, result)
}
fn graph(result: &Value, edge: &str) -> Value {
    result["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["kind"] == "graph" && t["element"]["id"] == edge)
        .unwrap()
        .clone()
}

#[test]
fn uncertain_graph_step_blocks_dependents_but_recovers_independent_edges_and_properties() {
    let (fixture, result) = run("unknown", options(), false);
    assert_eq!(result["status"], "INCONCLUSIVE");
    assert_eq!(graph(&result, "submit")["status"], "INCONCLUSIVE");
    let blocked = graph(&result, "another");
    assert_eq!(blocked["status"], "SKIPPED");
    assert_eq!(
        blocked["blocked_by"][0]["id"],
        graph(&result, "submit")["id"]
    );
    for edge in ["open_info", "back_info", "submit_invalid", "correct"] {
        assert_eq!(graph(&result, edge)["status"], "PASS");
    }
    assert!(
        result["tests"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["kind"] == "property")
            .all(|t| t["status"] == "PASS")
    );
    assert!(
        !result["coverage"]["edges"]["ids"]
            .as_array()
            .unwrap()
            .contains(&json!("submit"))
    );
    assert!(!result["recoveries"].as_array().unwrap().is_empty());
    assert!(fixture.resets > 1);
}
#[test]
fn known_state_rule_failure_continues_the_same_graph_fixture_without_crediting_the_failed_case() {
    let mut opts = options();
    opts.input_mode = "none".into();
    let (fixture, result) = run("rule", opts, false);
    assert_eq!(result["status"], "FAIL");
    assert_eq!(graph(&result, "submit")["status"], "FAIL");
    assert_eq!(graph(&result, "another")["status"], "PASS");
    assert_eq!(fixture.resets, 1);
    assert_eq!(result["test_summary"]["SKIPPED"], 0);
    assert!(
        !result["coverage"]["edges"]["ids"]
            .as_array()
            .unwrap()
            .contains(&json!("submit"))
    );
}
#[test]
fn failing_property_phases_do_not_block_other_phases_or_completed_graph_tests() {
    let (fixture, result) = run("properties", options(), true);
    assert_eq!(result["status"], "FAIL");
    assert!(
        result["tests"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["kind"] == "graph")
            .all(|t| t["status"] == "PASS")
    );
    assert!(result["test_summary"]["FAIL"].as_u64().unwrap() >= 2);
    assert_eq!(result["test_summary"]["SKIPPED"], 0);
    assert!(result["tests"].as_array().unwrap().iter().any(|t| {
        t["phase"]["source"]
            .as_str()
            .is_some_and(|s| s.contains("non-numeric"))
            && t["status"] == "PASS"
    }));
    assert!(
        fixture
            .calls
            .iter()
            .filter(|(method, _)| method == "target.checkpoint")
            .count()
            >= 3,
        "Failed phases must discard their campaign checkpoints"
    );
}

#[test]
fn uncertain_property_submission_does_not_block_other_phases_on_the_same_form() {
    let (_, result) = run("property_unknown", options(), false);
    assert_eq!(result["status"], "INCONCLUSIVE");
    assert_eq!(result["test_summary"]["INCONCLUSIVE"], 1);
    assert_eq!(result["test_summary"]["SKIPPED"], 0);
    assert!(
        result["tests"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["kind"] == "graph")
            .all(|t| t["status"] == "PASS")
    );
    assert!(
        result["coverage"]["property phases"]["completed"]
            .as_u64()
            .unwrap()
            > 1
    );
}

#[test]
fn infrastructure_failure_during_reproduction_retains_the_counterexample_and_stops_the_run() {
    let mut opts = options();
    opts.shrink = true;
    let (_, result) = run("shrink_fatal", opts, false);
    assert_eq!(result["status"], "FAIL");
    assert_eq!(result["counterexample"]["input"]["Places"], "");
    assert_eq!(result["counterexample"]["minimization_limited"], true);
    assert_eq!(
        result["terminal_stop"]["reason"],
        "Minimization provider unavailable"
    );
    assert!(result["test_summary"]["SKIPPED"].as_u64().unwrap() > 0);
}

#[test]
fn multiple_walks_skip_only_the_known_failed_fixed_scenario() {
    let mut opts = options();
    opts.walks = 2;
    let path = opts.paths.as_ref().unwrap()[0].clone();
    opts.paths.as_mut().unwrap().push(path);
    opts.input_mode = "none".into();
    let (_, result) = run("unknown", opts, false);
    let walks = result["tests"].as_array().unwrap();
    assert!(
        walks
            .iter()
            .any(|t| t["walk"] == 2 && t["element"]["id"] == "submit" && t["status"] == "SKIPPED")
    );
    assert!(
        walks
            .iter()
            .any(|t| t["walk"] == 2 && t["element"]["id"] == "open_info" && t["status"] == "PASS")
    );
}

#[test]
fn malformed_saved_setup_is_rejected_before_initializing_the_target() {
    let model = model(false);
    let mut target = Fixture::default();
    let result = engine::run(
        &model,
        &mut target,
        options(),
        json!({}),
        Some(
            json!({"kind":"graph","model_hash":model.digest,"journey":"another","input":{},"setup_path":["back_info"]}),
        ),
    );
    assert!(result.unwrap_err().message.contains("disconnected"));
    assert!(target.calls.is_empty());
}
#[test]
fn run_wide_failure_stops_selected_work_without_erasing_an_earlier_defect() {
    let (_, result) = run("failure_then_fatal", options(), false);
    assert_eq!(result["status"], "FAIL");
    assert!(result["counterexample"].is_object());
    assert_eq!(
        result["terminal_stop"]["reason"],
        "Shared allowance exhausted"
    );
    assert!(result["test_summary"]["SKIPPED"].as_u64().unwrap() > 0);
    assert!(
        result["tests"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|t| t["status"] == "SKIPPED")
            .all(|t| t["reason"].as_str().unwrap().contains("Shared allowance"))
    );
}
#[test]
fn reset_failure_is_run_wide_and_does_not_submit_property_inputs() {
    let (fixture, result) = run("reset", options(), false);
    assert_eq!(result["status"], "INCONCLUSIVE");
    assert_eq!(
        result["terminal_stop"]["reason"],
        "Fixture reset unavailable"
    );
    assert!(
        !fixture
            .calls
            .iter()
            .any(|(method, params)| method == "target.hook"
                && params["event"] == "before_transition"
                && params["context"]["phase"] == "property")
    );
}
#[test]
fn fail_fast_remains_the_default() {
    let mut opts = options();
    opts.keep_going = false;
    let (_, result) = run("properties", opts, false);
    assert_eq!(result["test_summary"]["FAIL"], 1);
    assert!(result["test_summary"]["SKIPPED"].as_u64().unwrap() > 0);
}
#[test]
fn graph_recovery_uses_an_unblocked_alternative_and_replay_preserves_it() {
    let model = model(true);
    let mut fixture = Fixture {
        mode: "unknown",
        ..Default::default()
    };
    let mut opts = options();
    opts.input_mode = "none".into();
    let result = engine::run(&model, &mut fixture, opts, json!({}), None).unwrap();
    let another = graph(&result, "another");
    assert_eq!(another["status"], "PASS");
    assert_eq!(
        another["replay_recipe"]["setup_path"],
        json!(["alternate_submit"])
    );
    let mut replay_fixture = Fixture::default();
    let replay = engine::run(
        &model,
        &mut replay_fixture,
        Options {
            evaluator: "adapter".into(),
            ..Default::default()
        },
        json!({}),
        Some(another["replay_recipe"].clone()),
    )
    .unwrap();
    assert_eq!(replay["status"], "PASS");
    assert!(
        replay_fixture
            .calls
            .iter()
            .any(|(method, params)| method == "target.execute"
                && params["edge"]["id"] == "alternate_submit")
    );
    assert!(
        !replay_fixture
            .calls
            .iter()
            .any(|(method, params)| method == "target.execute" && params["edge"]["id"] == "submit")
    );
}
#[test]
fn junit_retains_each_cases_own_failure_and_exact_dependency_blockers() {
    let (_, mut result) = run("properties", options(), false);
    result["hooks"] = json!({"events":[{"event":"after_case","error":"this phase hook"},{"event":"after_case","error":"different phase hook"}]});
    let mut first = true;
    for test in result["tests"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .filter(|t| t["status"] == "FAIL")
    {
        test["hook_range"] = if first { json!([0, 1]) } else { json!([1, 2]) };
        first = false;
    }
    let xml = report::junit(&result);
    for test in result["tests"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|t| t["status"] == "FAIL")
    {
        assert_eq!(test["failure"]["case"]["test_id"], test["id"]);
        assert!(xml.contains(&report::escape(test["id"].as_str().unwrap())));
        let pattern = regex::Regex::new(&format!(
            r#"(?s)<testcase name="{}"[^>]*><failure[^>]*>(.*?)</failure>"#,
            regex::escape(&report::escape(test["name"].as_str().unwrap()))
        ))
        .unwrap();
        let raw = pattern.captures(&xml).unwrap()[1]
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&");
        let evidence: Value = serde_json::from_str(&raw).unwrap();
        assert_eq!(evidence["failure"]["case"]["test_id"], test["id"]);
        assert_eq!(evidence["failure"], test["failure"]);
        assert_eq!(evidence["hook_errors"].as_array().unwrap().len(), 1);
        assert_eq!(
            evidence["hook_errors"][0],
            result["hooks"]["events"][test["hook_range"][0].as_u64().unwrap() as usize]
        );
    }
}

#[test]
fn failing_teardown_is_retained_without_erasing_the_original_defect() {
    let (_, result) = run("cleanup", options(), false);
    assert_eq!(result["status"], "FAIL");
    assert!(result["counterexample"].is_object());
    assert_ne!(result["error"], "Cleanup assertion failed");
    assert!(
        result["cleanup_errors"]
            .as_array()
            .unwrap()
            .contains(&json!("Cleanup assertion failed"))
    );
    assert_eq!(result["test_summary"]["SKIPPED"], 0);
}
