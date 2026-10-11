//! Native contract, subprocess, replay, verdict and report regressions.
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use testwalker_core::{
    Fault, Target,
    model::Model,
    rpc::{
        SELF_MODEL,
        contract::{check, passed, pointer, resolve, validate_predicates},
        target::RpcTarget,
        transport::{Handler, NoHandler, Transport},
    },
};
fn model() -> Model {
    Model::new(serde_json::from_str(SELF_MODEL).unwrap()).unwrap()
}
fn temp() -> PathBuf {
    static SEQUENCE: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "testwalker-rust-{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos(),
        SEQUENCE.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}
fn invoke(args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_testwalker-core"))
        .args(args)
        .env_remove("TYPESAFE_API_KEY")
        .env_remove("OPENAI_API_KEY")
        .env_remove("JEV_API_KEY")
        .env("PATH", "/nonexistent")
        .output()
        .unwrap()
}
fn report(path: &Path) -> (PathBuf, Value) {
    let directory = fs::read_dir(path).unwrap().next().unwrap().unwrap().path();
    let result =
        serde_json::from_str(&fs::read_to_string(directory.join("report.json")).unwrap()).unwrap();
    (directory, result)
}
#[test]
fn typed_templates_and_exact_pointers_preserve_values() {
    let context = json!({"input":{"Value":null,"Enabled":false},"fixtures":{"model":{"a/b":[1,2],"~":7,"":8,"$ref":"literal"}}});
    let template = json!({"model":{"$ref":"/fixtures/model"},"values":[{"$ref":"/input/Value"},{"$ref":"/input/Enabled"}],"literal":"${input/Value} {{literal}}"});
    let mut result = resolve(&template, &context).unwrap();
    assert_eq!(result["values"], json!([null, false]));
    result["model"]["a/b"] = json!([3]);
    assert_eq!(context["fixtures"]["model"]["a/b"], json!([1, 2]));
    assert_eq!(pointer(&context, "/fixtures/model/a~1b/0").unwrap(), 1);
    assert_eq!(pointer(&context, "/fixtures/model/~0").unwrap(), 7);
    assert_eq!(pointer(&context, "/fixtures/model/").unwrap(), 8);
    for path in [
        "/fixtures/model/a~1b/01",
        "/fixtures/model/a~1b/-1",
        "/fixtures/model/a~1b/2",
        "/~2",
        "no-slash",
    ] {
        assert!(pointer(&context, path).is_err());
    }
    assert!(resolve(&json!({"$ref":"/input/missing"}), &context).is_err());
    assert!(resolve(&json!({"$ref":"/bad"}), &context).is_err());
    assert!(resolve(&json!({"$ref":"/input/Value","extra":true}), &context).is_err());
}
#[test]
fn predicate_semantics_missing_null_types_and_evidence() {
    for (actual, op, expected, success) in [
        (json!(true), "equals", json!(1), false),
        (json!(2), "equals", json!(2.0), true),
        (json!([true]), "equals", json!([1]), false),
        (json!(2.0), "type", json!("integer"), false),
        (json!(false), "type", json!("number"), false),
        (json!(null), "type", json!("null"), true),
        (json!("雪🌲"), "length", json!({"exact":2}), true),
        (json!([1, 2]), "contains", json!(2.0), true),
        (json!([1]), "contains", json!(true), false),
        (
            json!({"a":{"b":2,"c":3},"array":[1,2]}),
            "subset",
            json!({"a":{"b":2},"array":[2]}),
            true,
        ),
        (json!([{"a":1,"b":2}]), "subset", json!([{"a":1}]), false),
        (json!("studio"), "contains", json!("tud"), true),
    ] {
        let mut predicate = json!({"path":"/response"});
        predicate[op] = expected;
        assert_eq!(
            passed(&check(&json!([predicate]), &json!({"response":actual})).unwrap()),
            success
        );
    }
    for (op, expected, success) in [
        ("exists", json!(false), true),
        ("not_equals", json!(0), false),
        ("equals", json!(null), false),
    ] {
        let mut predicate = json!({"path":"/missing"});
        predicate[op] = expected;
        let result = check(&json!([predicate]), &json!({})).unwrap();
        assert_eq!(passed(&result), success);
        assert_eq!(result[0]["present"], false);
    }
    let result = check(
        &json!([{"path":"/actual","equals":{"$ref":"/variables/missing"}}]),
        &json!({"actual":7}),
    )
    .unwrap();
    assert_eq!(result[0]["actual"], 7);
    assert!(result[0]["error"].is_string());
    assert!(!passed(&result));
}
#[test]
fn invalid_contracts_are_rejected_before_launch() {
    for predicate in [
        json!({"path":"/x"}),
        json!({"path":"/x","equals":1,"type":"number"}),
        json!({"path":"/~9","exists":false}),
        json!({"path":"/x","exists":0}),
        json!({"path":"/x","type":"date"}),
        json!({"path":"/x","length":{"min":2,"max":1}}),
        json!({"path":"/x","length":{"exact":1,"min":0}}),
        json!({"path":"/x","length":{"exact":true}}),
    ] {
        assert!(validate_predicates(&json!([predicate])).is_err());
    }
    let original = model().document;
    for (path, value) in [
        ("/models/0/properties/rpc/reset", json!({"raw":"bad"})),
        ("/models/0/properties/rpc/rules", json!({})),
        ("/models/0/vertices/0/properties/rpc/match", json!([])),
        (
            "/models/0/edges/0/properties/rpc/request",
            json!({"method":"core.info","selector":"x"}),
        ),
        (
            "/models/0/edges/0/properties/rpc/capture",
            json!({"token":"/~3"}),
        ),
        (
            "/models/0/properties/rpc/callbacks",
            json!({"target.observe":{"result":{},"request":{"method":true}}}),
        ),
    ] {
        let mut document = original.clone();
        let (parent, key) = path.rsplit_once('/').unwrap();
        document.pointer_mut(parent).unwrap()[key] = value;
        assert!(Model::new(document).is_err(), "Accepted {path}");
    }
}
#[test]
fn target_state_classification_uses_response_and_historical_variables() {
    let model = model();
    let mut target = RpcTarget::new(
        model.clone(),
        vec![env!("CARGO_BIN_EXE_testwalker-core").into()],
        Duration::from_secs(5),
        None,
    )
    .unwrap();
    target.call("target.reset", json!({})).unwrap();
    let old = target.call("target.observe", json!({})).unwrap();
    let result = target
        .call(
            "target.evaluate",
            json!({"observation":old,"expected":"wrong"}),
        )
        .unwrap();
    assert_eq!(result["observed"], "ready");
    let no_match = target
        .evaluate(&json!({"response":{"result":null},"input":{},"variables":{}}))
        .unwrap();
    assert!(no_match["observed"].is_null());
    assert!(no_match["state_diagnostics"].is_object());
    let mut ambiguous = model.clone();
    let matching = ambiguous.states["ready"]["properties"]["rpc"]["match"].clone();
    ambiguous.states.get_mut("rejected").unwrap()["properties"]["rpc"]["match"] = matching;
    let ambiguous = RpcTarget::new(
        ambiguous,
        vec!["unused".into()],
        Duration::from_secs(1),
        None,
    )
    .unwrap();
    assert!(ambiguous.evaluate(&old).unwrap()["observed"].is_null());
    let mut historical = model.clone();
    historical.graph["properties"]["rpc"]["rules"] = json!({"Snapshot input is retained":[{"path":"/response/result/value","equals":{"$ref":"/input/Value"}},{"path":"/response/result/receipt","equals":{"$ref":"/variables/token"}}]});
    // Evaluate a captured context without consulting mutable current target state.
    let mut document = historical.document;
    document["models"][0]["properties"]["rpc"]["rules"] =
        historical.graph["properties"]["rpc"]["rules"].clone();
    document["models"][0]["properties"]["business"]["rules"] =
        json!(["Snapshot input is retained"]);
    let target = RpcTarget::new(
        Model::new(document).unwrap(),
        vec!["unused".into()],
        Duration::from_secs(1),
        None,
    )
    .unwrap();
    let evaluation = target.evaluate(&json!({"response":{"result":{"value":2,"receipt":"old"}},"input":{"Value":2},"variables":{"token":"old"}})).unwrap();
    assert_eq!(evaluation["checks"][0]["status"], "met");
}
fn fixture_peer(mode: &str, argument: Option<&str>, timeout: Duration) -> Transport {
    let mut argv = vec![
        env!("CARGO_BIN_EXE_testwalker-rpc-test-peer").into(),
        mode.into(),
    ];
    if let Some(argument) = argument {
        argv.push(argument.into());
    }
    Transport::spawn(&argv, timeout, None).unwrap()
}

#[test]
fn malformed_responses_fail_and_timeout_is_inconclusive() {
    for line in [
        "not-json",
        "{}",
        r#"{"jsonrpc":"2.0","id":"wrong","result":{}}"#,
        r#"{"jsonrpc":"2.0","id":"testwalker/1","result":{},"error":{"code":1,"message":"x"}}"#,
        r#"{"jsonrpc":"2.0","id":"testwalker/1","error":{"code":true,"message":"x"}}"#,
    ] {
        let mut peer = fixture_peer("raw", Some(line), Duration::from_secs(1));
        assert_eq!(
            peer.request("info", None, &mut NoHandler)
                .unwrap_err()
                .status,
            "FAIL"
        );
        peer.close();
    }
    let mut peer = fixture_peer("hang", None, Duration::from_millis(30));
    let start = Instant::now();
    assert_eq!(
        peer.request("info", None, &mut NoHandler)
            .unwrap_err()
            .status,
        "INCONCLUSIVE"
    );
    assert!(start.elapsed() < Duration::from_secs(1));
    assert!(peer.exit_code().is_some());
    let mut peer = fixture_peer("block", None, Duration::from_millis(30));
    let start = Instant::now();
    assert_eq!(
        peer.request(
            "large",
            Some(json!({"data":"x".repeat(2*1024*1024)})),
            &mut NoHandler
        )
        .unwrap_err()
        .status,
        "INCONCLUSIVE"
    );
    assert!(start.elapsed() < Duration::from_secs(1));
}
struct Nested;
impl Handler for Nested {
    fn handle(&mut self, peer: &mut Transport, _: &str, _: Value) -> Result<Value, Fault> {
        peer.request("nested", None, self)
            .map(|response| response["result"].clone())
    }
}
#[test]
fn nested_callback_buffers_outer_response_and_shares_deadline() {
    let mut peer = fixture_peer("nested", None, Duration::from_secs(1));
    assert_eq!(
        peer.request("outer", None, &mut Nested).unwrap()["result"],
        "outer"
    );
    let mut peer = fixture_peer("nested-timeout", None, Duration::from_millis(30));
    let start = Instant::now();
    assert_eq!(
        peer.request("outer", None, &mut Nested).unwrap_err().status,
        "INCONCLUSIVE"
    );
    assert!(start.elapsed() < Duration::from_secs(1));
}
#[test]
fn stderr_is_drained_and_bounded_and_shutdown_is_reaped() {
    let mut peer = fixture_peer("stderr", None, Duration::from_secs(1));
    peer.request("info", None, &mut NoHandler).unwrap();
    peer.wait_for_exit().unwrap();
    assert_eq!(peer.stderr().len(), 65536);
    peer.close();
    peer.close();
    assert!(peer.exit_code().is_some());
    let mut peer = fixture_peer("ack-hang", None, Duration::from_millis(30));
    peer.request("shutdown", None, &mut NoHandler).unwrap();
    assert_eq!(peer.wait_for_exit().unwrap_err().status, "FAIL");
}
#[test]
fn native_cli_runs_full_model_and_replays_graph_and_property_without_python() {
    let path = temp();
    let output = invoke(&["self-test", "--output", path.to_str().unwrap()]);
    assert!(
        output.status.success(),
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let (directory, result) = report(&path);
    assert_eq!(result["status"], "PASS");
    assert_eq!(result["usage"]["calls"], 0);
    assert_eq!(
        result["test_summary"]["PASS"].as_u64().unwrap() as usize,
        result["tests"].as_array().unwrap().len()
    );
    assert_eq!(result["coverage"]["edges"]["verified"], 67);
    assert_eq!(result["coverage"]["states"]["verified"], 30);
    assert!(result["input_attempts"].as_u64().unwrap() >= 30);
    assert!(directory.join("report.html").exists());
    assert!(directory.join("junit.xml").exists());
    assert!(fs::metadata(directory.join("junit.xml")).unwrap().len() < 20_000_000);
    let graph = result["tests"]
        .as_array()
        .unwrap()
        .iter()
        .find(|t| t["element"]["id"] == "read_success")
        .unwrap();
    let property = result["cases"]
        .as_array()
        .unwrap()
        .iter()
        .find(|c| c["input"] == json!({"Cases":201}))
        .unwrap();
    for case in [graph, property] {
        let replay_output = temp();
        let output = invoke(&[
            "rpc",
            "--model",
            directory.join("model.json").to_str().unwrap(),
            "--target",
            env!("CARGO_BIN_EXE_testwalker-core"),
            "--replay",
            directory
                .join(case["replay_file"].as_str().unwrap())
                .to_str()
                .unwrap(),
            "--output",
            replay_output.to_str().unwrap(),
        ]);
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let (_, result) = report(&replay_output);
        assert_eq!(result["status"], "PASS");
        assert_eq!(result["tests"].as_array().unwrap().len(), 1);
        fs::remove_dir_all(replay_output).unwrap();
    }
    fs::remove_dir_all(path).unwrap();
}
#[test]
fn native_cli_mutant_fails_with_predicate_evidence_and_planned_skips() {
    let path = temp();
    let mut document = model().document;
    let ready = document["models"][0]["vertices"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["id"] == "ready")
        .unwrap();
    let rule = ready["properties"]["rpc"]["rules"]
        .as_object()
        .unwrap()
        .keys()
        .next()
        .unwrap()
        .clone();
    ready["properties"]["rpc"]["rules"][rule] =
        json!([{"path":"/response/result/protocol_version","equals":"deliberately-wrong"}]);
    fs::write(path.join("wrong.json"), document.to_string()).unwrap();
    let output = invoke(&[
        "rpc",
        "--model",
        path.join("wrong.json").to_str().unwrap(),
        "--target",
        env!("CARGO_BIN_EXE_testwalker-core"),
        "--output",
        path.join("results").to_str().unwrap(),
    ]);
    assert_eq!(output.status.code(), Some(1));
    let (directory, result) = report(&path.join("results"));
    assert_eq!(result["status"], "FAIL");
    assert!(result["test_summary"]["SKIPPED"].as_u64().unwrap() > 0);
    let xml = fs::read_to_string(directory.join("junit.xml")).unwrap();
    assert!(xml.contains("<failure"));
    assert!(xml.contains("deliberately-wrong"));
    assert!(xml.contains("&quot;actual&quot;: &quot;1&quot;"));
    assert!(xml.contains("<skipped"));
    fs::remove_dir_all(path).unwrap();
}
#[test]
fn planning_never_launches_target_and_invalid_options_fail_first() {
    let output = invoke(&["self-test", "--plan", "--target", "/absent/target"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("property_selection"));
    for timeout in ["0", "-1", "nan", "inf"] {
        assert_eq!(
            invoke(&["self-test", "--timeout", timeout]).status.code(),
            Some(2)
        );
    }
    assert_eq!(
        invoke(&["self-test", "--cases", "201"]).status.code(),
        Some(2)
    );
}

#[test]
fn planning_failures_preserve_inventory_and_do_not_launch_the_subject() {
    let path = temp();
    let output = invoke(&[
        "self-test",
        "--max-steps",
        "1",
        "--target",
        "/absent/target",
        "--output",
        path.to_str().unwrap(),
    ]);
    assert_eq!(output.status.code(), Some(2));
    let (directory, result) = report(&path);
    assert_eq!(result["status"], "INCONCLUSIVE");
    assert_eq!(result["stop"]["phase"], "graph planning");
    assert!(result["error"].as_str().unwrap().contains("max-steps"));
    assert!(result["trace"].as_array().unwrap().is_empty());
    assert!(directory.join("plan.json").exists());
    assert!(directory.join("junit.xml").exists());
    fs::remove_dir_all(path).unwrap();
}

#[test]
fn notifications_cannot_extend_deadlines() {
    let mut peer = fixture_peer("notifications", None, Duration::from_secs(1));
    let start = Instant::now();
    assert_eq!(
        peer.request("info", None, &mut NoHandler)
            .unwrap_err()
            .status,
        "INCONCLUSIVE"
    );
    assert!(start.elapsed() < Duration::from_secs(2));
    assert!(!peer.notifications.is_empty());
}
