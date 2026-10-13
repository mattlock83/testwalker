//! Public CLI launches language-independent executables and owns all artifacts.
use serde_json::{Value, json};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::atomic::{AtomicUsize, Ordering},
};
fn temp() -> PathBuf {
    static NEXT: AtomicUsize = AtomicUsize::new(0);
    let path = PathBuf::from(env!("CARGO_TARGET_TMPDIR")).join(format!(
        "adapter-cli-{}-{}",
        std::process::id(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir_all(&path).unwrap();
    path
}
fn invoke(path: &Path, mode: &str, config: Value, extra: &[&str]) -> std::process::Output {
    invoke_output(path, mode, config, extra, Some(&path.join("reports")))
}
fn invoke_output(
    path: &Path,
    mode: &str,
    config: Value,
    extra: &[&str],
    output: Option<&Path>,
) -> std::process::Output {
    let model = path.join("model with spaces.json");
    let mut document: Value = serde_json::from_str(include_str!("fixtures/capacity.json")).unwrap();
    document["models"][0]["generator"] = json!("new_york_street_sweeper()");
    fs::write(&model, document.to_string()).unwrap();
    let mut cmd = Command::new(env!("CARGO_BIN_EXE_testwalker"));
    cmd.args(["run", "--model"])
        .arg(model)
        .args([
            "--adapter",
            env!("CARGO_BIN_EXE_testwalker-rpc-test-peer"),
            "--adapter-arg",
        ])
        .arg(mode)
        .args([
            "--adapter-arg=literal; $(do-not-execute)",
            "--adapter-arg",
            "--help",
        ]);
    if let Some(output) = output {
        cmd.arg("--output").arg(output);
    }
    cmd.args(["--config", "-"])
        .args(extra)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(config.to_string().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

#[test]
fn default_output_is_model_local_with_unique_timestamped_runs_and_asset_folders() {
    let path = temp().join("models with spaces");
    fs::create_dir_all(&path).unwrap();
    let original = path.join("model with spaces.json");
    for _ in 0..2 {
        let output = invoke_output(
            &path,
            "adapter",
            json!({"options":{"input_mode":"none"}}),
            &[],
            None,
        );
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    assert!(original.is_file());
    let parent = path.join("artifact");
    let runs: Vec<_> = fs::read_dir(&parent)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect();
    assert_eq!(runs.len(), 2);
    let timestamped =
        regex::Regex::new(r"^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-\d+-\d+$").unwrap();
    for run in runs {
        assert!(timestamped.is_match(run.file_name().unwrap().to_str().unwrap()));
        let report: Value =
            serde_json::from_slice(&fs::read(run.join("report.json")).unwrap()).unwrap();
        assert_eq!(report["directory"], run.to_str().unwrap());
        assert_eq!(report["status"], "PASS");
        for file in ["report.html", "junit.xml", "model.json", "plan.json"] {
            assert!(run.join(file).is_file());
        }
        assert!(run.join("replays").is_dir());
        let initialize = report["trace"][0]["calls"]
            .as_array()
            .unwrap()
            .iter()
            .find(|call| call["method"] == "target.initialize")
            .unwrap();
        assert_eq!(
            initialize["params"]["config"]["directory"],
            report["directory"]
        );
    }
    assert!(!path.join("reports").exists());
    assert!(!path.join("artifacts").exists());
}

#[test]
fn planning_without_explicit_output_does_not_create_an_artifact_directory() {
    let path = temp();
    let output = invoke_output(
        &path,
        "would-panic-if-started",
        json!({}),
        &["--plan"],
        None,
    );
    assert!(output.status.success());
    assert!(!path.join("artifact").exists());
}

#[test]
fn relative_models_write_beside_the_model_rather_than_the_invocation_directory() {
    let path = temp();
    let models = path.join("nested models");
    fs::create_dir_all(&models).unwrap();
    assert!(
        invoke_output(&models, "unused", json!({}), &["--plan"], None)
            .status
            .success()
    );
    let output = Command::new(env!("CARGO_BIN_EXE_testwalker"))
        .current_dir(&path)
        .args([
            "run",
            "--model",
            "nested models/model with spaces.json",
            "--adapter",
            env!("CARGO_BIN_EXE_testwalker-rpc-test-peer"),
            "--adapter-arg",
            "adapter",
            "--input-mode",
            "none",
        ])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(models.join("artifact").is_dir());
    assert!(!path.join("artifact").exists());
}

#[test]
fn bundled_self_test_defaults_to_artifact_in_the_invocation_directory() {
    let path = temp();
    let output = Command::new(env!("CARGO_BIN_EXE_testwalker"))
        .current_dir(&path)
        .arg("self-test")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(path.join("artifact").is_dir());
    assert!(!path.join("artifacts").exists());
}
fn report(path: &Path) -> (PathBuf, Value) {
    let dir = fs::read_dir(path.join("reports"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let report =
        serde_json::from_str(&fs::read_to_string(dir.join("report.json")).unwrap()).unwrap();
    (dir, report)
}
#[test]
fn executable_adapter_runs_graph_hegel_hooks_and_replay_without_a_language_flag() {
    let path = temp();
    let output = invoke(
        &path,
        "adapter",
        json!({"target":{"label":"opaque adapter configuration"},"options":{"input_mode":"generated","cases":1,"max_input_attempts":2,"shrink":false}}),
        &[],
    );
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let (dir, r) = report(&path);
    assert_eq!(r["status"], "PASS");
    assert_eq!(r["coverage"]["edges"]["verified"], 4);
    assert_eq!(r["input_attempts"], 2);
    assert!(!path.join("artifact").exists());
    let evidence = &r["trace"][0];
    assert_eq!(evidence["closed"], true);
    assert_eq!(evidence["args"][0], "literal; $(do-not-execute)");
    assert_eq!(evidence["args"][1], "--help");
    assert_eq!(evidence["services"]["result"]["protocol_version"], "1");
    let calls = evidence["calls"].as_array().unwrap();
    assert!(
        calls
            .iter()
            .any(|c| c["method"] == "target.hook" && c["params"]["event"] == "before_case")
    );
    assert_eq!(
        calls
            .iter()
            .find(|c| c["method"] == "target.initialize")
            .unwrap()["params"]["config"]["label"],
        "opaque adapter configuration"
    );
    for file in ["report.html", "junit.xml", "model.json", "plan.json"] {
        assert!(dir.join(file).is_file());
    }
    let recipe = r["cases"][0]["replay_recipe"].clone();
    let recipe_file = path.join("replay.json");
    fs::write(&recipe_file, recipe.to_string()).unwrap();
    let replay_path = temp();
    let output = invoke(
        &replay_path,
        "adapter",
        json!({}),
        &["--replay", recipe_file.to_str().unwrap()],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert_eq!(report(&replay_path).1["status"], "PASS");
}
#[test]
fn adapter_outcomes_preserve_exit_codes_and_cleanup() {
    for (mode, status, code) in [
        ("adapter-fail", "FAIL", 1),
        ("adapter-uncertain", "INCONCLUSIVE", 2),
    ] {
        let path = temp();
        let output = invoke(&path, mode, json!({"options":{"input_mode":"none"}}), &[]);
        assert_eq!(output.status.code(), Some(code));
        let (_, r) = report(&path);
        assert_eq!(r["status"], status);
        assert_eq!(r["trace"][0]["closed"], true);
        assert!(r["test_summary"]["SKIPPED"].as_u64().unwrap() > 0);
    }
}

#[test]
fn inconclusive_property_preserves_report_and_cleanup_without_a_hegel_panic() {
    for shrink in [false, true] {
        let path = temp();
        let output = invoke(
            &path,
            "adapter-property-uncertain",
            json!({"options":{"input_mode":"generated","cases":20,"max_input_attempts":40,"shrink":shrink}}),
            &[],
        );
        assert_eq!(output.status.code(), Some(2));
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            !stderr.contains("non-deterministic") && !stderr.contains("panicked at"),
            "{stderr}"
        );
        let (dir, r) = report(&path);
        assert_eq!(r["status"], "INCONCLUSIVE");
        assert_eq!(r["coverage"]["edges"]["verified"], 4);
        assert_eq!(r["input_attempts"], 1);
        let cases = r["cases"].as_array().unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0]["status"], "INCONCLUSIVE");
        assert_eq!(cases[0]["checks"][1]["status"], "uncertain");
        assert!(cases[0]["input"]["Places"].is_number() || cases[0]["input"]["Places"].is_string());
        assert!(
            dir.join(cases[0]["replay_file"].as_str().unwrap())
                .is_file()
        );
        assert!(dir.join("report.html").is_file());
        let junit = fs::read_to_string(dir.join("junit.xml")).unwrap();
        assert!(junit.contains("<error") && !junit.contains("<failure"));
        assert_eq!(r["trace"][0]["closed"], true);
        assert_eq!(
            r["trace"][0]["calls"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|call| call["method"] == "target.hook"
                    && call["params"]["event"] == "before_case")
                .count(),
            1
        );
    }
}
#[test]
fn plan_does_not_start_adapter_or_require_a_key_and_cli_overrides_config_options() {
    let path = temp();
    let output = invoke(
        &path,
        "would-panic-if-started",
        json!({"decision":{"api_key":"synthetic-secret"},"options":{"max_steps":1}}),
        &["--plan", "--max-steps", "1000", "--input-mode", "none"],
    );
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let inventory: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert!(inventory["tests"].as_array().unwrap().len() > 4);
    assert!(!path.join("reports").exists());
    assert!(!String::from_utf8_lossy(&output.stdout).contains("synthetic-secret"));
}
#[test]
fn invalid_config_and_options_do_not_start_external_code() {
    for config in [
        json!({"target":null}),
        json!({"options":{"max_steps":0}}),
        json!({"options":{"input_strategies":{"data sets":{"Missing":{}}}}}),
        json!({"language":"python"}),
    ] {
        let path = temp();
        let output = invoke(&path, "would-panic-if-started", config, &[]);
        assert_eq!(output.status.code(), Some(2));
        assert!(!path.join("reports").exists());
    }
}

#[test]
fn planning_failure_preserves_inventory_without_launching_adapter() {
    let path = temp();
    let output = invoke(
        &path,
        "would-panic-if-started",
        json!({}),
        &["--max-steps", "1"],
    );
    assert_eq!(output.status.code(), Some(2));
    let (dir, r) = report(&path);
    assert_eq!(r["status"], "INCONCLUSIVE");
    assert_eq!(r["stop"]["phase"], "graph planning");
    assert!(dir.join("plan.json").is_file() && dir.join("junit.xml").is_file());
    assert!(!String::from_utf8_lossy(&output.stderr).contains("Unknown fixture mode"));
}

#[test]
fn nested_decision_requests_are_owned_and_audited_by_the_cli() {
    use std::{
        io::{BufRead, BufReader, Read},
        net::TcpListener,
        thread,
        time::{Duration, Instant},
    };
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let server = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        let mut stream = loop {
            match listener.accept() {
                Ok((s, _)) => break s,
                Err(_) if Instant::now() < deadline => thread::sleep(Duration::from_millis(5)),
                Err(e) => panic!("No provider request: {e}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut input = BufReader::new(stream.try_clone().unwrap());
        let mut header = String::new();
        let mut headers = String::new();
        loop {
            header.clear();
            input.read_line(&mut header).unwrap();
            headers.push_str(&header);
            if header == "\r\n" {
                break;
            }
        }
        assert!(
            headers
                .to_lowercase()
                .contains("authorization: bearer synthetic-cli-key")
        );
        let length = headers
            .lines()
            .find_map(|line| {
                line.to_lowercase()
                    .strip_prefix("content-length: ")
                    .and_then(|n| n.parse::<usize>().ok())
            })
            .unwrap();
        let mut body = vec![0; length];
        input.read_exact(&mut body).unwrap();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["state"]["synthetic"], true);

        let response =
            json!({"answers":{},"usage":{"input_tokens":11,"output_tokens":3}}).to_string();
        write!(stream,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{response}",response.len()).unwrap();
    });
    let path = temp();
    let output = invoke(
        &path,
        "adapter-decision",
        json!({"decision":{"provider":"jev","api_key":"synthetic-cli-key","endpoint":endpoint},"options":{"input_mode":"none"}}),
        &[],
    );
    server.join().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let (dir, r) = report(&path);
    assert_eq!(r["usage"]["calls"], 1);
    assert_eq!(r["usage"]["input_tokens"], 11);
    assert_eq!(r["decisions"].as_array().unwrap().len(), 1);
    assert_eq!(r["trace"][0]["services"]["result"]["answers"], json!({}));
    for file in ["report.json", "report.html", "plan.json", "junit.xml"] {
        assert!(
            !fs::read_to_string(dir.join(file))
                .unwrap()
                .contains("synthetic-cli-key")
        );
    }
}
