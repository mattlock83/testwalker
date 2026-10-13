//! Framework-owned run artifacts. Targets supply observations and attachment references only.
use crate::{
    Fault, Target,
    engine::{self, Options},
    model::Model,
    report,
};
use chrono::{DateTime, SecondsFormat, Utc};
use serde_json::{Value, json};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{Instant, SystemTime},
};

fn timestamp() -> String {
    DateTime::<Utc>::from(SystemTime::now()).to_rfc3339_opts(SecondsFormat::Millis, true)
}
fn directory(parent: &Path) -> Result<PathBuf, Fault> {
    static SEQUENCE: AtomicU64 = AtomicU64::new(0);
    let parent = std::path::absolute(parent).map_err(|e| Fault::unknown(e.to_string()))?;
    fs::create_dir_all(&parent)
        .map_err(|e| Fault::unknown(format!("Cannot create output directory: {e}")))?;
    let path = parent.join(format!(
        "{}-{}-{}",
        timestamp().replace(':', "-"),
        std::process::id(),
        SEQUENCE.fetch_add(1, Ordering::Relaxed)
    ));
    fs::create_dir(&path)
        .map_err(|e| Fault::unknown(format!("Cannot create run directory: {e}")))?;
    Ok(path)
}
fn metadata(model: &Model, options: &Options, target: &Value, directory: Option<&Path>) -> Value {
    let mut limits = target
        .get("limits")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or(json!({}));
    for (key, value) in json!({"generated_cases":options.cases,"input_mode":options.input_mode,
        "input_strategies":options.input_strategies,"shrink":options.shrink,"input_attempts":options.max_input_attempts,
        "walks":options.walks,"graph_steps":options.max_steps,"property_engine":"hegel","keep_going":options.keep_going,
        "screenshots":target["screenshots"].as_bool().unwrap_or(false)}).as_object().unwrap() {
        limits[key] = value.clone();
    }
    json!({"model":model.graph["name"],"model_hash":model.digest,"seed":options.seed,
        "directory":directory.map(|p|p.to_string_lossy()),"started":timestamp(),"limits":limits,
        "adapter":target.get("adapter").cloned().unwrap_or(json!("external")),"url":target.get("url").cloned().unwrap_or(json!("")),
        "hooks":{"events":[]},"trace":[],"decisions":[],"usage":{"calls":0},
        "coverage":{"edges":{"verified":0,"total":model.edges.len()},"states":{"verified":0,"total":model.states.len()},"properties":{"completed":0,"total":0}}})
}
fn with_metadata(metadata: &Value, report: &Value) -> Value {
    let mut result = metadata.clone();
    for (key, value) in report.as_object().into_iter().flatten() {
        result[key] = value.clone();
    }
    result
}
fn cleanup_error(report: &mut Value, error: Fault) {
    if !report["cleanup_errors"].is_array() {
        report["cleanup_errors"] = json!([]);
    }
    report["cleanup_errors"]
        .as_array_mut()
        .unwrap()
        .push(json!(error.message));
    if report["status"] == "PASS" {
        report["status"] = json!(error.status);
        report["error"] = json!(error.message);
    }
}

struct ReportingTarget<'a, T: Target> {
    target: &'a mut T,
    model: &'a Model,
    metadata: Value,
    directory: Option<PathBuf>,
    artifacts: bool,
    planned: bool,
    after_run: bool,
    closed: bool,
    decision_start: Option<usize>,
}
impl<T: Target> Target for ReportingTarget<'_, T> {
    fn call(&mut self, method: &str, mut params: Value) -> Result<Value, Fault> {
        match method {
            "run.event" if params["type"] == "planned" => {
                params["data"] = with_metadata(&self.metadata, &params["data"]);
                if let Some(directory) = &self.directory {
                    report::save_plan(directory, self.model, &params["data"])?;
                }
                self.planned = true;
            }
            "run.event" if params["type"] == "test.begin" => {
                self.decision_start = self.target.decision_count();
            }
            "target.initialize" => {
                if let Some(directory) = &self.directory {
                    params["config"]["directory"] = json!(directory.to_string_lossy());
                }
            }
            "target.hook" if params["event"] == "after_run" => {
                self.after_run = true;
                params["context"]["result"] =
                    with_metadata(&self.metadata, &params["context"]["result"]);
            }
            "target.close" => self.closed = true,
            _ => {}
        }
        let mut result = self.target.call(method, params.clone())?;
        if method == "target.initialize" {
            self.artifacts = result["capabilities"]["artifacts"] == true;
        }
        if method == "run.event"
            && params["type"] == "test.end"
            && let (Some(start), Some(end)) =
                (self.decision_start.take(), self.target.decision_count())
        {
            if !result.is_object() {
                result = json!({});
            }
            result["decision_range"] = json!([start, end]);
        }
        Ok(result)
    }
}

fn collect<T: Target>(target: &mut T, report: &mut Value) -> Result<(), Fault> {
    let mut offset = 0u64;
    loop {
        let page = target.call("target.artifacts", json!({"offset":offset,"limit":128}))?;
        let entries = page["entries"]
            .as_array()
            .filter(|e| e.len() <= 128)
            .ok_or_else(|| Fault::unknown("Artifact pages must contain at most 128 entries"))?;
        for entry in entries {
            let data = entry
                .get("data")
                .ok_or_else(|| Fault::unknown("Artifact entry is missing data"))?
                .clone();
            let values = match entry["kind"].as_str() {
                Some("trace") => &mut report["trace"],
                Some("hook") => &mut report["hooks"]["events"],
                Some("decision") => &mut report["decisions"],
                _ => return Err(Fault::unknown("Unknown artifact entry kind")),
            };
            values.as_array_mut().unwrap().push(data);
        }
        // Target metadata cannot replace tests, inputs, coverage, or verdicts.
        if offset == 0 {
            for key in ["path", "sha256"] {
                if let Some(value) = page["metadata"]["hooks"].get(key) {
                    report["hooks"][key] = value.clone();
                }
            }
            for key in ["usage", "browser_left_open", "adapter_tracebacks"] {
                if let Some(value) = page["metadata"].get(key) {
                    report[key] = value.clone();
                }
            }
        }
        match page.get("next_offset") {
            Some(Value::Null) => break,
            Some(value)
                if !entries.is_empty() && value.as_u64() == Some(offset + entries.len() as u64) =>
            {
                offset += entries.len() as u64
            }
            _ => return Err(Fault::unknown("Invalid artifact page cursor")),
        }
    }
    Ok(())
}

/// Execute and persist a complete report without delegating result ownership to a target.
pub fn run<T: Target>(
    model: &Model,
    target: &mut T,
    options: Options,
    config: Value,
    replay: Option<Value>,
    output: Option<&Path>,
) -> Result<Value, Fault> {
    options.validate()?;
    if !config.is_object() {
        return Err(Fault::unknown("Target configuration must be an object"));
    }
    let started = Instant::now();
    let directory = output.map(directory).transpose()?;
    let metadata = metadata(model, &options, &config, directory.as_deref());
    let mut wrapped = ReportingTarget {
        target,
        model,
        metadata: metadata.clone(),
        directory,
        artifacts: false,
        planned: false,
        after_run: false,
        closed: false,
        decision_start: None,
    };
    let outcome = engine::run(model, &mut wrapped, options.clone(), config, replay.clone());
    let mut result = match outcome {
        Ok(report) => with_metadata(&metadata, &report),
        Err(error) => {
            let inventory = error
                .result
                .get("partial_report")
                .cloned()
                .or_else(|| engine::inventory_for(model, &options, replay.as_ref()).ok());
            let Some(inventory) = inventory else {
                return Err(error);
            };
            let mut report = with_metadata(&metadata, &inventory);
            report["status"] = json!(error.status);
            report["error"] = json!(error.message);
            report["failure"] = error.result.clone();
            report["stop"] = error
                .result
                .get("stop")
                .cloned()
                .unwrap_or(json!({"phase":"run setup"}));
            report["stop"]["reason"] = json!(error.message);
            report["input_attempts"] = json!(0);
            if !wrapped.planned
                && let Err(fault) =
                    wrapped.call("run.event", json!({"type":"planned","data":inventory}))
            {
                cleanup_error(&mut report, fault);
            }
            for test in report["tests"].as_array_mut().unwrap() {
                test["status"] = json!("SKIPPED");
                test["reason"] = json!(error.message);
            }
            report["test_summary"] = json!({"PASS":0,"FAIL":0,"INCONCLUSIVE":0,"SKIPPED":report["tests"].as_array().unwrap().len()});
            if !wrapped.after_run && let Err(fault) = wrapped.call("target.hook",json!({"event":"after_run","context":{"phase":"run setup","result":report,"error":error}})) { cleanup_error(&mut report,fault); }
            if !wrapped.closed
                && let Err(fault) = wrapped.call(
                    "target.close",
                    json!({"keep_open":options.keep_target_open}),
                )
            {
                cleanup_error(&mut report, fault);
            }
            report
        }
    };
    if wrapped.artifacts
        && let Err(error) = collect(wrapped.target, &mut result)
    {
        cleanup_error(&mut result, error);
    }
    if let Some(evidence) = wrapped.target.decision_report() {
        result["usage"] = evidence["usage"].clone();
        result["decisions"] = evidence["decisions"].clone();
    }
    result["duration"] = json!(started.elapsed().as_secs_f64());
    result["finished"] = json!(timestamp());
    if let Some(directory) = &wrapped.directory {
        report::save(directory, model, &mut result)?;
    }
    Ok(result)
}
