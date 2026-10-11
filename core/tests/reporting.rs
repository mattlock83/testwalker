//! The same portable artifacts serve every target adapter.
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};
use testwalker_core::{model::Model, report};

struct Directory(PathBuf);

impl Directory {
    fn new() -> Self {
        static SEQUENCE: AtomicU64 = AtomicU64::new(0);
        let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
            "reporting-{}-{}",
            std::process::id(),
            SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn json(&self, name: &str) -> Value {
        serde_json::from_str(&fs::read_to_string(self.0.join(name)).unwrap()).unwrap()
    }
}

impl Drop for Directory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn model() -> Model {
    let mut document: Value = serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap();
    document["models"][0]["name"] = json!("Test <model> & \"__REPORT_JSON__\"\u{0}");
    Model::new(document).unwrap()
}

fn embedded(html: &str) -> Value {
    let pattern =
        regex::Regex::new(r#"(?s)<script id="run-data" type="application/json">(.*?)</script>"#)
            .unwrap();
    serde_json::from_str(&pattern.captures(html).unwrap()[1]).unwrap()
}

fn json_evidence(xml: &str, name: &str) -> Value {
    let pattern = regex::Regex::new(&format!(
        r#"(?s)<testcase name="{}"[^>]*><(?:failure|error|skipped|system-out)[^>]*>(.*?)</(?:failure|error|skipped|system-out)>"#,
        regex::escape(name)
    )).unwrap();
    let escaped = &pattern.captures(xml).unwrap()[1];
    let raw = escaped
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&amp;", "&");
    serde_json::from_str(&raw).unwrap()
}

#[test]
fn viewer_chunks_are_lossless_safe_and_loaded_from_local_scripts() {
    let directory = Directory::new();
    let mut result = json!({
        "status":"INCONCLUSIVE",
        "tests":[{"id":"graph/1","kind":"graph","status":"INCONCLUSIVE","reason":"__VIEWER_SCRIPT__","decision_range":[127,130]}],
        "decisions":(0..260).map(|i| json!({"request":format!("request {i}"),"response":"uncertain"})).collect::<Vec<_>>()
    });
    let attack =
        "</script><script>window.untrustedExecuted=true</script>\u{2028}\u{2029} & __TITLE__";
    result["decisions"][128]["response"] = json!(attack);
    let decisions = result["decisions"].clone();
    report::save(&directory.0, &model(), &mut result).unwrap();
    let html = fs::read_to_string(directory.0.join("report.html")).unwrap();
    let viewer = embedded(&html);
    assert!(viewer.get("decisions").is_none());
    assert_eq!(viewer["tests"], result["tests"]);
    assert_eq!(viewer["decision_chunks"]["size"], 128);
    let files = viewer["decision_chunks"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 3);
    let mut restored = Vec::new();
    for (index, filename) in files.iter().enumerate() {
        let script = fs::read_to_string(directory.0.join(filename.as_str().unwrap())).unwrap();
        assert!(!script.contains("</script>"));
        assert!(!script.contains('\u{2028}'));
        assert!(!script.contains('\u{2029}'));
        let prefix = format!("window.testwalkerDecisionChunks[{index}] = ");
        let chunk: Value = serde_json::from_str(
            script
                .strip_prefix(&prefix)
                .unwrap()
                .strip_suffix(";\n")
                .unwrap(),
        )
        .unwrap();
        restored.extend(chunk.as_array().unwrap().iter().cloned());
    }
    assert_eq!(json!(restored), decisions);
    assert_eq!(directory.json("report.json")["decisions"], decisions);
    assert!(!html.contains(attack));
    assert!(html.contains("Test &lt;model&gt; &amp; &quot;__REPORT_JSON__&quot;"));
    assert!(html.contains("document.createElement(\"script\")"));
    assert_eq!(viewer["tests"][0]["reason"], "__VIEWER_SCRIPT__");
}

#[test]
fn junit_has_suites_counts_timings_and_scoped_diagnostics() {
    let result = json!({
        "model":"API <contract> & \"checks\"\u{1}","model_hash":"abc","seed":42,
        "status":"INCONCLUSIVE","error":"Unknown <state> & \"rule\"\u{ffff}",
        "started":"2026-10-11T12:30:00Z","duration":3.25,
        "planning":{"complete":true},
        "scope":{"property_selection":{"selected_phases":1,"available_phases":2,"selected_examples":2,"available_examples":4,"input_limit":2}},
        "tests":[
            {"id":"graph/fail","name":"failed","kind":"graph","status":"FAIL","duration":0.5,"reason":"wrong <value>","trace_range":[1,2],"decision_range":[1,2],"step_indices":[1,999]},
            {"id":"graph/uncertain","name":"uncertain","kind":"graph","status":"INCONCLUSIVE","duration":0.25,"reason":"uncertain","trace_range":[2,1],"decision_range":[0,1]},
            {"id":"property/skipped","name":"skipped","kind":"property","status":"SKIPPED","reason":"blocked by graph/fail"},
            {"id":"property/pass","name":"passed","kind":"property","status":"PASS","duration":1,"attempt_indices":[0]}
        ],
        "trace":[{"action":"outside-before"},{"action":"relevant-action"},{"action":"outside-after"}],
        "decisions":[{"decision":"first"},{"decision":"relevant-decision"},{"decision":"last"}],
        "steps":[{"state":"other"},{"state":"expected","evidence":{"observed":"actual"},"screenshot":"screenshots/1.png"}],
        "cases":[{"input":{"count":0},"status":"PASS","violations":["minimum"],"replay_file":"replays/1.json"}],
        "counterexample":{"replay_recipe":{}},"stop":{"phase":"graph"},"failure":{"reason":"bad"},
        "hooks":{"events":[{"event":"before_node","context":{}},{"event":"after_run","context":{"error":"cleanup interrupted"}}]},
        "cleanup_errors":["disconnect failed"]
    });
    let xml = report::junit(&result);
    assert!(
        xml.contains("tests=\"5\" failures=\"1\" errors=\"2\" skipped=\"1\" time=\"3.250000\"")
    );
    assert!(xml.contains(
        "name=\"testwalker.graph\" timestamp=\"2026-10-11T12:30:00Z\" time=\"0.750000\""
    ));
    assert!(xml.contains("name=\"testwalker.property\""));
    assert!(xml.contains("name=\"testwalker.run\""));
    assert!(xml.contains("value=\"API &lt;contract&gt; &amp; &quot;checks&quot;�\""));
    assert!(xml.contains("message=\"Unknown &lt;state&gt; &amp; &quot;rule&quot;�\""));
    assert!(xml.contains("name=\"property_input_limit\" value=\"2\""));
    assert!(xml.contains("type=\"Defect\""));
    assert!(xml.contains("type=\"Inconclusive\""));
    assert!(!xml.contains('\u{1}'));
    assert!(!xml.contains('\u{ffff}'));
    let failed = json_evidence(&xml, "failed");
    assert_eq!(failed["actions"], json!([{"action":"relevant-action"}]));
    assert_eq!(
        failed["decisions"],
        json!([{"decision":"relevant-decision"}])
    );
    assert_eq!(failed["checkpoints"].as_array().unwrap().len(), 1);
    assert_eq!(failed["checkpoints"][0]["screenshot"], "screenshots/1.png");
    assert_eq!(failed["hook_errors"].as_array().unwrap().len(), 1);
    let skipped = json_evidence(&xml, "skipped");
    assert_eq!(skipped["actions"], json!([]));
    assert_eq!(skipped["decisions"], json!([]));
    assert!(skipped["failure"].is_null());
    assert_eq!(skipped["blocked_by"].as_array().unwrap().len(), 2);
    let passed = json_evidence(&xml, "passed");
    assert_eq!(passed["attempts"][0]["input"]["count"], 0);
    assert_eq!(passed["artifacts"]["replay.json"], "replay.json");
    assert!(passed.get("actions").is_none());
    assert_eq!(json_evidence(&xml, "uncertain")["actions"], json!([]));
}

#[test]
fn saved_plan_and_executed_cases_have_independent_replay_files() {
    let directory = Directory::new();
    let model = model();
    let planned_recipe = json!({"kind":"graph","model_hash":model.digest,"state":"form"});
    let plan = json!({"status":"NOT_RUN","tests":[{"id":"graph/start","kind":"graph","status":"NOT_RUN","replay_recipe":planned_recipe}]});
    report::save_plan(&directory.0, &model, &plan).unwrap();
    let saved_plan = directory.json("plan.json");
    let planned_file = saved_plan["tests"][0]["replay_file"].as_str().unwrap();
    assert_eq!(directory.json(planned_file), planned_recipe);
    assert!(plan["tests"][0].get("replay_file").is_none());
    let case_recipe =
        json!({"kind":"property","model_hash":model.digest,"journey":"submit","input":{"count":0}});
    let mut result = plan.clone();
    result["status"] = json!("FAIL");
    result["tests"][0]["status"] = json!("PASS");
    result["cases"] = json!([{"status":"FAIL","replay_recipe":case_recipe}]);
    result["counterexample"] = result["cases"][0].clone();
    report::save(&directory.0, &model, &mut result).unwrap();
    assert_eq!(directory.json("plan.json"), saved_plan);
    assert_eq!(result["tests"][0]["replay_file"], planned_file);
    let case_file = result["cases"][0]["replay_file"].as_str().unwrap();
    assert_ne!(case_file, planned_file);
    assert_eq!(directory.json(case_file), case_recipe);
    assert_eq!(directory.json("replay.json"), case_recipe);
    assert_eq!(directory.json("report.json")["status"], "FAIL");
    assert_eq!(directory.json("model.json"), model.document);
}

#[test]
fn minimal_adapter_metadata_and_scope_notes_remain_portable() {
    let directory = Directory::new();
    for (scope, replay, note) in [
        (
            json!({"input_mode":"none"}),
            Value::Null,
            "covers graph journeys only",
        ),
        (json!({}), json!({"kind":"graph"}), "covers one replay case"),
        (
            json!({"property_selection":{"selected_phases":1,"available_phases":3,"selected_examples":1,"available_examples":8,"input_limit":2}}),
            Value::Null,
            "This is a limited input scope",
        ),
    ] {
        let mut result = json!({"status":"INCONCLUSIVE","scope":scope,"replay":replay});
        report::save(&directory.0, &model(), &mut result).unwrap();
        assert_eq!(result["status"], "INCONCLUSIVE");
        let html = fs::read_to_string(directory.0.join("report.html")).unwrap();
        assert!(html.contains(note));
        assert_eq!(embedded(&html)["decision_chunks"]["files"], json!([]));
        let xml = fs::read_to_string(directory.0.join("junit.xml")).unwrap();
        assert!(xml.contains("tests=\"1\" failures=\"0\" errors=\"1\" skipped=\"0\""));
    }
}
