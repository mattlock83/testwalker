//! Target-independent reports, replay recipes and portable evidence viewers.
//!
//! Adapters supply evidence in the report document. Only the framework renders
//! that document, so browser, API and other targets share the same diagnostics.
use crate::{Fault, model::Model};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fmt::Write as _, fs, path::Path};

const DECISION_CHUNK_SIZE: usize = 128;

fn write(path: &Path, content: impl AsRef<[u8]>) -> Result<(), Fault> {
    fs::write(path, content)
        .map_err(|e| Fault::unknown(format!("Cannot write {}: {e}", path.display())))
}

fn json_file(path: &Path, value: &Value) -> Result<(), Fault> {
    write(path, serde_json::to_string_pretty(value).unwrap() + "\n")
}

fn create_directory(path: &Path) -> Result<(), Fault> {
    fs::create_dir_all(path)
        .map_err(|e| Fault::unknown(format!("Cannot create {}: {e}", path.display())))
}

/// Escape text and attributes, replacing characters XML 1.0 cannot represent.
pub fn escape(text: &str) -> String {
    let mut result = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => result.push_str("&amp;"),
            '<' => result.push_str("&lt;"),
            '>' => result.push_str("&gt;"),
            '"' => result.push_str("&quot;"),
            '\'' => result.push_str("&apos;"),
            '\t' | '\r' | '\n' => result.push(character),
            c if c < ' ' || c == '\u{fffe}' || c == '\u{ffff}' => result.push('\u{fffd}'),
            c => result.push(c),
        }
    }
    result
}

fn text(value: &Value) -> String {
    value.as_str().map(str::to_owned).unwrap_or_else(|| {
        if value.is_null() {
            String::new()
        } else {
            value.to_string()
        }
    })
}

fn array(value: &Value) -> &[Value] {
    value.as_array().map(Vec::as_slice).unwrap_or_default()
}

fn script_json(value: &Value) -> String {
    value
        .to_string()
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
}

fn replay(directory: &Path, recipe: &Value) -> Result<String, Fault> {
    let mut canonical = recipe.clone();
    canonical.sort_all_objects();
    let hash = format!("{:x}", Sha256::digest(canonical.to_string().as_bytes()));
    let relative = format!("replays/{}.json", &hash[..24]);
    create_directory(&directory.join("replays"))?;
    json_file(&directory.join(&relative), recipe)?;
    Ok(relative)
}

fn attach_replays(directory: &Path, report: &mut Value) -> Result<(), Fault> {
    for field in ["tests", "cases"] {
        if let Some(tests) = report.get_mut(field).and_then(Value::as_array_mut) {
            for test in tests {
                if let Some(recipe) = test.get("replay_recipe").filter(|r| r.is_object()) {
                    test["replay_file"] = json!(replay(directory, recipe)?);
                }
            }
        }
    }
    Ok(())
}

/// Save the inventory before execution, including replayable planned journeys.
/// The caller's inventory is unchanged; execution cannot mutate the saved plan.
pub fn save_plan(directory: &Path, model: &Model, report: &Value) -> Result<(), Fault> {
    create_directory(directory)?;
    json_file(&directory.join("model.json"), &model.document)?;
    let mut inventory = report.clone();
    attach_replays(directory, &mut inventory)?;
    json_file(&directory.join("plan.json"), &inventory)
}

/// Save framework results. Evidence and replay links enrich the document;
/// verdicts are always preserved exactly as execution produced them.
pub fn save(directory: &Path, model: &Model, report: &mut Value) -> Result<(), Fault> {
    if !report.is_object() {
        return Err(Fault::unknown("A report must be a JSON object"));
    }
    create_directory(directory)?;
    attach_replays(directory, report)?;
    if let Some(recipe) = report["counterexample"]
        .get("replay_recipe")
        .filter(|recipe| recipe.is_object())
    {
        json_file(&directory.join("replay.json"), recipe)?;
    }
    report["model"] = model.graph["name"].clone();
    report["model_hash"] = json!(model.digest);
    json_file(&directory.join("model.json"), &model.document)?;
    json_file(&directory.join("report.json"), report)?;
    viewer(directory, report)?;
    write(&directory.join("junit.xml"), junit(report))
}

fn scope_note(report: &Value) -> String {
    if report
        .get("replay")
        .is_some_and(|r| !r.is_null() && r != false)
    {
        return "This result covers one replay case; graph exploration and other property phases are outside this run.".into();
    }
    let scope = &report["scope"];
    if scope["input_mode"] == "none" {
        return "Input campaigns were disabled; this result covers graph journeys only.".into();
    }
    if let Some(selection) = scope.get("property_selection").filter(|s| s.is_object()) {
        let mut note = format!(
            "Property scope: {} of {} phases selected in model order, with up to {} planned inputs. Total input attempts, including shrinking and reproduction, are capped at {}.",
            text(&selection["selected_phases"]),
            text(&selection["available_phases"]),
            text(&selection["selected_examples"]),
            text(&selection["input_limit"]),
        );
        if selection["selected_examples"]
            .as_u64()
            .zip(selection["available_examples"].as_u64())
            .is_some_and(|(selected, available)| selected < available)
        {
            note.push_str(" This is a limited input scope; unselected work is outside this run.");
        }
        return note;
    }
    "JUnit counts generated phases; inputs and shrinking attempts appear within each case.".into()
}

fn viewer(directory: &Path, report: &Value) -> Result<(), Fault> {
    let mut viewer = Value::Object(
        report
            .as_object()
            .unwrap()
            .iter()
            .filter(|(key, _)| key.as_str() != "decisions")
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
    );
    let mut files = Vec::new();
    for (index, chunk) in array(&report["decisions"])
        .chunks(DECISION_CHUNK_SIZE)
        .enumerate()
    {
        create_directory(&directory.join("evidence"))?;
        let relative = format!("evidence/decisions-{index:05}.js");
        let script = format!(
            "window.testwalkerDecisionChunks[{index}] = {};\n",
            script_json(&json!(chunk))
        );
        write(&directory.join(&relative), script)?;
        files.push(relative);
    }
    viewer["decision_chunks"] = json!({"size":DECISION_CHUNK_SIZE,"files":files});
    let replacements = [
        ("TITLE", escape(&text(&report["model"]))),
        ("STATUS", escape(&text(&report["status"]))),
        ("REPORT_JSON", script_json(&viewer)),
        ("SCOPE_NOTE", escape(&scope_note(report))),
        ("VIEWER_STYLE", include_str!("../assets/viewer.css").into()),
        ("VIEWER_SCRIPT", include_str!("../assets/viewer.js").into()),
    ];
    // Substitute once: evidence containing template names must remain evidence.
    let expression =
        regex::Regex::new("__(TITLE|STATUS|REPORT_JSON|SCOPE_NOTE|VIEWER_STYLE|VIEWER_SCRIPT)__")
            .unwrap();
    let html = expression.replace_all(
        include_str!("../assets/viewer.html"),
        |caps: &regex::Captures<'_>| {
            replacements
                .iter()
                .find(|(key, _)| *key == &caps[1])
                .unwrap()
                .1
                .clone()
        },
    );
    write(&directory.join("report.html"), html.as_bytes())
}

fn select(report: &Value, test: &Value, indices: &str, field: &str) -> Vec<Value> {
    array(&test[indices])
        .iter()
        .filter_map(|i| {
            report[field]
                .get(usize::try_from(i.as_u64()?).ok()?)
                .cloned()
        })
        .collect()
}

fn range(report: &Value, test: &Value, indices: &str, field: &str) -> Value {
    let items = array(&report[field]);
    let bounds = array(&test[indices]);
    let bound = |index| {
        bounds
            .get(index)
            .and_then(Value::as_u64)
            .and_then(|n| usize::try_from(n).ok())
            .unwrap_or(0)
            .min(items.len())
    };
    let start = bound(0);
    let end = bound(1).max(start);
    json!(&items[start..end])
}

fn evidence(report: &Value, test: &Value) -> Value {
    let mut details = json!({
        "test":test,
        "model_hash":report["model_hash"],
        "seed":report["seed"],
        "url":report["url"],
        "exploration":report["exploration"],
        "limits":report["limits"],
        "artifacts":{"report.html":"report.html","report.json":"report.json","model.json":"model.json","plan.json":"plan.json"}
    });
    if report["counterexample"].is_object() {
        details["artifacts"]["replay.json"] = json!("replay.json");
    }
    if test["kind"] == "run" {
        for key in [
            "stop",
            "failure",
            "coverage",
            "scope",
            "planning",
            "global_audit",
            "hooks",
            "cleanup_errors",
        ] {
            details[key] = report[key].clone();
        }
    } else {
        details["checkpoints"] = json!(select(report, test, "step_indices", "steps"));
        details["attempts"] = json!(select(report, test, "attempt_indices", "cases"));
    }
    if test["status"] != "PASS" {
        details["stop"] = report["stop"].clone();
        details["failure"] = if test["status"] == "SKIPPED" {
            Value::Null
        } else {
            report["failure"].clone()
        };
        details["blocked_by"] = json!(
            array(&report["tests"])
                .iter()
                .filter(|item| item["status"] == "FAIL" || item["status"] == "INCONCLUSIVE")
                .map(
                    |item| json!({"id":item["id"],"status":item["status"],"reason":item["reason"]})
                )
                .collect::<Vec<_>>()
        );
        details["actions"] = range(report, test, "trace_range", "trace");
        details["decisions"] = range(report, test, "decision_range", "decisions");
        details["hook_errors"] = json!(
            array(&report["hooks"]["events"])
                .iter()
                .filter(|event| {
                    event.get("error").is_some_and(|e| !e.is_null())
                        || event["context"].get("error").is_some_and(|e| !e.is_null())
                })
                .collect::<Vec<_>>()
        );
    }
    details
}

fn duration(value: &Value) -> f64 {
    value
        .as_f64()
        .filter(|v| v.is_finite() && *v >= 0.0)
        .unwrap_or(0.0)
}

#[derive(Default)]
struct Counts {
    tests: usize,
    failures: usize,
    errors: usize,
    skipped: usize,
}

impl Counts {
    fn tests(tests: &[&Value]) -> Self {
        Self {
            tests: tests.len(),
            failures: tests.iter().filter(|t| t["status"] == "FAIL").count(),
            errors: tests
                .iter()
                .filter(|t| t["status"] == "INCONCLUSIVE")
                .count(),
            skipped: tests.iter().filter(|t| t["status"] == "SKIPPED").count(),
        }
    }

    fn attributes(&self) -> String {
        format!(
            "tests=\"{}\" failures=\"{}\" errors=\"{}\" skipped=\"{}\"",
            self.tests, self.failures, self.errors, self.skipped
        )
    }
}

/// Render graph, property and run suites with portable, self-contained triage
/// data. Per-case traces are sliced to their recorded bounds rather than copied
/// from the whole run; omitted optional adapter evidence remains empty.
pub fn junit(report: &Value) -> String {
    let run = json!({
        "id":"run/outcome","kind":"run","name":"Coverage, global requirements and run lifecycle",
        "status":report["status"],"reason":report["error"],
        "duration":duration(&report["duration"]),
        "trace_range":report["trace_range"],"decision_range":report["decision_range"]
    });
    let mut suites: BTreeMap<&str, Vec<&Value>> = BTreeMap::new();
    for test in array(&report["tests"]) {
        suites
            .entry(test["kind"].as_str().unwrap_or("test"))
            .or_default()
            .push(test);
    }
    suites.entry("run").or_default().push(&run);
    let tests = suites.values().flatten().copied().collect::<Vec<_>>();
    let elapsed = report.get("duration").map(duration).unwrap_or_else(|| {
        array(&report["tests"])
            .iter()
            .map(|test| duration(&test["duration"]))
            .sum()
    });
    let mut xml = format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<testsuites name=\"testwalker\" {} time=\"{elapsed:.6}\">\n",
        Counts::tests(&tests).attributes()
    );
    for (kind, tests) in suites {
        let elapsed: f64 = tests.iter().map(|test| duration(&test["duration"])).sum();
        let _ = writeln!(
            xml,
            "  <testsuite name=\"testwalker.{}\" timestamp=\"{}\" time=\"{elapsed:.6}\" {}>",
            escape(kind),
            escape(&text(&report["started"])),
            Counts::tests(&tests).attributes()
        );
        xml.push_str("    <properties>\n");
        let mut properties = vec![
            ("model".to_owned(), report["model"].clone()),
            ("model_hash".to_owned(), report["model_hash"].clone()),
            ("seed".to_owned(), report["seed"].clone()),
            ("report".to_owned(), json!("report.html")),
            ("inventory".to_owned(), json!("plan.json")),
            (
                "planning_complete".to_owned(),
                report["planning"]["complete"].clone(),
            ),
        ];
        if let Some(selection) = report["scope"]
            .get("property_selection")
            .filter(|s| s.is_object())
        {
            for key in [
                "selected_phases",
                "available_phases",
                "selected_examples",
                "available_examples",
                "input_limit",
            ] {
                properties.push((format!("property_{key}"), selection[key].clone()));
            }
        }
        for (name, value) in properties {
            let _ = writeln!(
                xml,
                "      <property name=\"{}\" value=\"{}\"/>",
                escape(&name),
                escape(&text(&value))
            );
        }
        xml.push_str("    </properties>\n");
        for test in tests {
            let name = test
                .get("name")
                .filter(|v| v.is_string())
                .unwrap_or(&test["id"]);
            let _ = write!(
                xml,
                "    <testcase name=\"{}\" classname=\"testwalker.{}\" time=\"{:.6}\">",
                escape(&text(name)),
                escape(kind),
                duration(&test["duration"])
            );
            let details = escape(&serde_json::to_string_pretty(&evidence(report, test)).unwrap());
            let outcome = match test["status"].as_str() {
                Some("FAIL") => Some(("failure", " type=\"Defect\"")),
                Some("INCONCLUSIVE") => Some(("error", " type=\"Inconclusive\"")),
                Some("SKIPPED") => Some(("skipped", "")),
                _ => None,
            };
            if let Some((element, attribute)) = outcome {
                let reason = test["reason"]
                    .as_str()
                    .filter(|s| !s.is_empty())
                    .or(report["error"].as_str())
                    .unwrap_or_else(|| test["status"].as_str().unwrap_or("Outcome unavailable"));
                let _ = write!(
                    xml,
                    "<{element} message=\"{}\"{attribute}>{details}</{element}>",
                    escape(reason)
                );
            } else {
                let _ = write!(xml, "<system-out>{details}</system-out>");
            }
            xml.push_str("</testcase>\n");
        }
        xml.push_str("  </testsuite>\n");
    }
    xml.push_str("</testsuites>\n");
    xml
}
