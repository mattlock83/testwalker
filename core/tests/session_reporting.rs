//! Report ownership remains inside the framework for every target implementation.
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use testwalker_core::{
    Fault, Target,
    engine::Options,
    model::{Model, violations},
    session,
};

struct Directory(PathBuf);

impl Directory {
    fn new() -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "session-reporting-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
struct Adapter {
    state: String,
    directory: Option<PathBuf>,
    entries: Vec<Value>,
    trace_start: usize,
    decision_start: usize,
    artifact_offsets: Vec<u64>,
    failure: Option<&'static str>,
    uncertain: bool,
    malicious: bool,
    closed: bool,
}

impl Adapter {
    fn count(&self, kind: &str) -> usize {
        self.entries
            .iter()
            .filter(|entry| entry["kind"] == kind)
            .count()
    }

    fn record(&mut self, kind: &str, data: Value) {
        self.entries.push(json!({"kind":kind,"data":data}));
    }

    fn capture(&self) -> Value {
        let directory = self.directory.as_ref().unwrap();
        fs::create_dir_all(directory.join("screenshots")).unwrap();
        fs::write(
            directory.join("screenshots/fixture.png"),
            b"fixture attachment",
        )
        .unwrap();
        let mut result = json!({
            "screenshot":"screenshots/fixture.png","screenshot_at":"2026-10-11T12:00:00Z",
            "trace_range":[self.trace_start,self.count("trace")],
            "decision_range":[self.decision_start,self.count("decision")],
            "attachments":[{"kind":"text","path":"screenshots/fixture.png"}]
        });
        if self.malicious {
            for (key, value) in json!({"status":"FAIL","id":"adapter-replaced-id","input":{"Places":"adapter injected"},"coverage":{"edges":{"verified":999}},"replay_recipe":{"kind":"forged"},"kind":"forged"}).as_object().unwrap() {
                result[key] = value.clone();
            }
        }
        result
    }
}

impl Target for Adapter {
    fn call(&mut self, method: &str, params: Value) -> Result<Value, Fault> {
        match method {
            "target.initialize" => {
                self.directory = params["config"]["directory"].as_str().map(PathBuf::from);
                let directory = self.directory.as_ref().unwrap();
                assert!(
                    directory.join("plan.json").exists(),
                    "The framework saves inventory before initializing the adapter"
                );
                assert!(!directory.join("report.json").exists());
                Ok(json!({"capabilities":{"artifacts":true}}))
            }
            "target.reset" => {
                self.state = "form".into();
                self.record("trace", json!({"action":"reset"}));
                Ok(json!({}))
            }
            "target.execute" => {
                let fields = params["fields"].as_object().unwrap();
                self.state = if fields.is_empty() {
                    "form"
                } else if violations(fields, &params["input"]).is_empty() {
                    "accepted"
                } else {
                    "rejected"
                }
                .into();
                self.record("trace", json!({"action":"execute","input":params["input"]}));
                Ok(json!({}))
            }
            "target.observe" => {
                self.record("trace", json!({"action":"observe","state":self.state}));
                Ok(json!({"state":self.state}))
            }
            "target.evaluate" => {
                self.record(
                    "decision",
                    json!({"request":"inspect state","response":self.state}),
                );
                Ok(json!({"observed":self.state,"checks":[
                    {"scope":"state","rule":"The outcome is visible.","status":if self.uncertain {"uncertain"} else {"met"}},
                    {"scope":"global","rule":"Invalid capacity is rejected.","status":"met"}
                ]}))
            }
            "target.hook" => {
                let failed = self
                    .failure
                    .is_some_and(|failure| params["event"] == failure);
                self.record("hook",json!({"event":params["event"],"context":{"phase":params["context"]["phase"],"error":if failed {json!("synthetic lifecycle failure")}else{Value::Null}}}));
                if failed {
                    Err(Fault::unknown("synthetic lifecycle failure"))
                } else {
                    Ok(json!({}))
                }
            }
            "target.close" => {
                self.closed = true;
                if self.failure == Some("close") {
                    Err(Fault::unknown("synthetic close failure"))
                } else {
                    Ok(json!({}))
                }
            }
            "run.event" => match params["type"].as_str() {
                Some("test.begin") => {
                    self.trace_start = self.count("trace");
                    self.decision_start = self.count("decision");
                    Ok(json!({}))
                }
                Some("test.end") => {
                    if self.failure == Some("test.end") {
                        self.failure = None;
                        Err(Fault::unknown("synthetic completion callback failure"))
                    } else {
                        Ok(self.capture())
                    }
                }
                Some("case") => Ok(self.capture()),
                _ => Ok(json!({})),
            },
            "target.artifacts" => {
                let offset = params["offset"].as_u64().unwrap() as usize;
                let limit = params["limit"].as_u64().unwrap() as usize;
                assert_eq!(limit, 128);
                self.artifact_offsets.push(offset as u64);
                let end = (offset + limit).min(self.entries.len());
                let next = (end < self.entries.len()).then_some(end);
                Ok(
                    json!({"entries":self.entries[offset..end],"next_offset":next,"metadata":{
                        "usage":{"calls":self.count("decision")},"hooks":{"path":"fixture-hooks","sha256":"synthetic"},
                        "status":"FAIL","input":{"Places":"adapter injected"},"tests":[],"coverage":{"edges":{"verified":999}},"model_hash":"forged","seed":999,"limits":{"graph_steps":0}
                    }}),
                )
            }
            _ => Err(Fault::unknown(format!(
                "Unexpected adapter method {method}"
            ))),
        }
    }
}

fn model() -> Model {
    Model::new(serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap()).unwrap()
}

fn run(output: &Directory, adapter: &mut Adapter) -> Value {
    let options = Options {
        evaluator: "adapter".into(),
        max_steps: 1000,
        max_input_attempts: 2,
        ..Default::default()
    };
    let result = session::run(
        &model(),
        adapter,
        options,
        json!({"adapter":"synthetic","screenshots":true}),
        None,
        Some(&output.0),
    )
    .unwrap();
    let directory = PathBuf::from(result["directory"].as_str().unwrap());
    assert_eq!(directory.parent(), Some(output.0.as_path()));
    assert!(adapter.closed);
    for file in [
        "report.json",
        "report.html",
        "model.json",
        "plan.json",
        "junit.xml",
    ] {
        assert!(directory.join(file).exists(), "Missing {file}");
    }
    let saved: Value =
        serde_json::from_str(&fs::read_to_string(directory.join("report.json")).unwrap()).unwrap();
    assert_eq!(saved, result);
    assert!(result["started"].as_str().unwrap().ends_with('Z'));
    assert!(result["finished"].as_str().unwrap().ends_with('Z'));
    assert!(result["duration"].as_f64().unwrap() >= 0.0);
    let tests = result["tests"].as_array().unwrap();
    assert!(tests.iter().all(|test| {
        ["PASS", "FAIL", "INCONCLUSIVE", "SKIPPED"]
            .iter()
            .any(|status| test["status"] == *status)
    }));
    for status in ["PASS", "FAIL", "INCONCLUSIVE", "SKIPPED"] {
        assert_eq!(
            result["test_summary"][status],
            json!(tests.iter().filter(|test| test["status"] == status).count())
        );
    }
    result
}

#[test]
fn framework_owns_results_and_collects_paginated_evidence() {
    let output = Directory::new();
    let mut adapter = Adapter {
        malicious: true,
        ..Default::default()
    };
    for i in 0..129 {
        adapter.record("trace", json!({"action":"outside-prefill","index":i}));
    }
    let result = run(&output, &mut adapter);
    assert_eq!(result["status"], "PASS");
    assert_eq!(result["model_hash"], model().digest);
    assert_eq!(result["seed"], 42);
    assert_eq!(result["coverage"]["edges"]["verified"], 4);
    assert_eq!(result["limits"]["graph_steps"], 1000);
    assert_eq!(result["usage"]["calls"], json!(adapter.count("decision")));
    assert_eq!(
        result["trace"].as_array().unwrap().len(),
        adapter.count("trace")
    );
    assert_eq!(
        result["decisions"].as_array().unwrap().len(),
        adapter.count("decision")
    );
    assert_eq!(result["hooks"]["path"], "fixture-hooks");
    assert_eq!(&adapter.artifact_offsets[..2], &[0, 128]);
    assert!(
        result["tests"]
            .as_array()
            .unwrap()
            .iter()
            .all(|test| test["status"] == "PASS"
                && test["id"] != "adapter-replaced-id"
                && test["kind"] != "forged")
    );
    for case in result["cases"].as_array().unwrap() {
        assert_eq!(case["status"], "PASS");
        assert_ne!(case["input"], json!({"Places":"adapter injected"}));
        assert_eq!(case["replay_recipe"]["kind"], "property");
        assert_eq!(case["replay_recipe"]["input"], case["input"]);
    }
    let test = &result["tests"][0];
    assert_eq!(test["screenshot"], "screenshots/fixture.png");
    assert_eq!(test["attachments"][0]["kind"], "text");
    let directory = adapter.directory.as_ref().unwrap();
    let xml = fs::read_to_string(directory.join("junit.xml")).unwrap();
    assert!(xml.contains("screenshots/fixture.png"));
    assert!(xml.contains("&quot;trace_range&quot;"));
    assert!(xml.contains("&quot;decision_range&quot;"));
    assert!(!xml.contains("adapter-replaced-id"));
    let plan: Value =
        serde_json::from_str(&fs::read_to_string(directory.join("plan.json")).unwrap()).unwrap();
    assert_eq!(plan["tests"][0]["status"], "NOT_RUN");
    assert!(
        plan["tests"]
            .as_array()
            .unwrap()
            .iter()
            .any(|test| test["kind"] == "graph" && test["replay_file"].is_string())
    );
}

#[test]
fn lifecycle_and_completion_failures_still_persist_terminal_results() {
    for failure in ["before_run", "after_run", "close", "test.end"] {
        let output = Directory::new();
        let mut adapter = Adapter {
            failure: Some(failure),
            ..Default::default()
        };
        let result = run(&output, &mut adapter);
        assert_eq!(result["status"], "INCONCLUSIVE", "Failure: {failure}");
        let xml =
            fs::read_to_string(adapter.directory.as_ref().unwrap().join("junit.xml")).unwrap();
        assert!(xml.contains("<error"));
        assert!(xml.contains("synthetic"));
        if failure == "before_run" {
            assert!(
                result["tests"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .all(|test| test["status"] == "SKIPPED")
            );
        }
        if failure == "test.end" {
            assert!(
                result["tests"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|test| test["status"] == "PASS")
            );
            assert!(result["test_summary"]["SKIPPED"].as_u64().unwrap() > 0);
        }
    }
}

#[test]
fn uncertain_case_keeps_screenshots_and_only_its_own_evidence_ranges() {
    let output = Directory::new();
    let mut adapter = Adapter {
        uncertain: true,
        malicious: true,
        ..Default::default()
    };
    for i in 0..129 {
        adapter.record("trace", json!({"action":"outside-prefill","index":i}));
    }
    adapter.record("decision", json!({"response":"outside-decision"}));
    let result = run(&output, &mut adapter);
    assert_eq!(result["status"], "INCONCLUSIVE");
    let test = result["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|test| test["status"] == "INCONCLUSIVE")
        .unwrap();
    assert_eq!(test["status"], "INCONCLUSIVE");
    assert_eq!(test["trace_range"][0], 130);
    assert_eq!(test["decision_range"], json!([1, 2]));
    assert_eq!(test["screenshot"], "screenshots/fixture.png");
    let xml = fs::read_to_string(adapter.directory.as_ref().unwrap().join("junit.xml")).unwrap();
    assert!(xml.contains("screenshots/fixture.png"));
    assert!(xml.contains("inspect state"));
    assert!(!xml.contains("outside-prefill"));
    assert!(!xml.contains("outside-decision"));
}
