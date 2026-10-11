//! Native entry points share options, scheduling and framework-owned reporting.
use crate::{
    Fault, Target,
    adapter::ExecutableAdapter,
    engine::{self, Options},
    model::Model,
    rpc::{SELF_MODEL, target::RpcTarget},
};
use serde_json::{Value, json};
use std::{
    fs,
    io::{self, BufReader, BufWriter, Read},
    path::PathBuf,
    time::Duration,
};

const HELP: &str = "testwalker run --model MODEL --adapter EXECUTABLE [options]
testwalker rpc --model MODEL --target EXECUTABLE [options]
testwalker self-test [options]

The framework launches any executable adapter over bidirectional JSON-RPC/stdio.
No language flag or shell command parsing. Use repeated arguments for its options.
  --adapter EXECUTABLE   Target protocol implementation (run)
  --adapter-arg VALUE    Repeat for adapter arguments (--adapter-arg=--flag)
  --target EXECUTABLE    JSON-RPC API under test (rpc)
  --target-arg VALUE     Repeat for target arguments (rpc)
  --cwd DIR             Adapter/target working directory
  --config FILE         Run JSON: target, options, optional decision provider; '-' reads stdin
  --output DIR          Report parent directory (default artifacts)
  --timeout SECONDS     Adapter/target request deadline (default 120 for run, 30 for rpc)
  --seed N              Default 42
  --walks N             Default 1
  --max-steps N         Default 1000
  --generator EXPR      GraphWalker name or complete expression
  --edge-coverage N     Required verified edge coverage, percent
  --state-coverage N    Required verified state coverage, percent
  --input-mode MODE     focused (default), all, generated, boundaries, none
  --cases N             Hegel examples per phase (default 1)
  --max-input-attempts N Input scope cap (default 1000)
  --input-strategies FILE Hegel strategy policy JSON
  --custom-strategies   Ask the adapter for declarative input domains
  --no-shrink           Disable shrinking
  --keep-target-open    Ask the adapter to retain its target for debugging
  --evaluator MODE      adapter (default) or core (uses configured decision provider)
  --replay FILE         Replay an individual saved test recipe
  --plan                Print inventory without launching an adapter or calling a provider
";

fn decode(text: &str, label: &str) -> Result<Value, Fault> {
    serde_json::from_str(text).map_err(|e| Fault::unknown(format!("Invalid JSON in {label}: {e}")))
}
fn read(path: &str) -> Result<Value, Fault> {
    decode(
        &fs::read_to_string(path)
            .map_err(|e| Fault::unknown(format!("Cannot read {path}: {e}")))?,
        path,
    )
}
fn number<T: std::str::FromStr>(name: &str, value: &str) -> Result<T, Fault> {
    value
        .parse()
        .map_err(|_| Fault::unknown(format!("Invalid value for {name}")))
}
fn summary(result: &Value) -> i32 {
    if let Some(error) = result["error"].as_str() {
        println!(
            "{}: {error}",
            result["status"].as_str().unwrap_or("INCONCLUSIVE")
        );
    }
    println!(
        "{} · {}/{} verified edges · {} input attempts · {} model calls",
        result["status"].as_str().unwrap_or("INCONCLUSIVE"),
        result["coverage"]["edges"]["verified"],
        result["coverage"]["edges"]["total"],
        result["input_attempts"],
        result["usage"]["calls"].as_u64().unwrap_or(0)
    );
    if let Some(directory) = result["directory"].as_str() {
        let directory = PathBuf::from(directory);
        println!(
            "Report: {}\nJUnit: {}",
            directory.join("report.html").display(),
            directory.join("junit.xml").display()
        );
    }
    match result["status"].as_str() {
        Some("PASS") => 0,
        Some("FAIL") => 1,
        _ => 2,
    }
}

pub fn execute(args: &[String]) -> Result<i32, Fault> {
    let mode = args.first().map(String::as_str).unwrap_or("");
    let generic = mode == "run";
    let self_test = mode == "self-test";
    let mut overrides = json!({});
    let mut model_path = None;
    let mut executable = None;
    let mut executable_args = vec![];
    let mut cwd = None;
    let mut output = PathBuf::from("artifacts");
    let mut config_path = None;
    let mut replay = None;
    let mut plan = false;
    let mut timeout = if generic { 120.0_f64 } else { 30.0_f64 };
    let mut generator = None;
    let mut edge_coverage = None;
    let mut state_coverage = None;
    let mut position = 1;
    while position < args.len() {
        let argument = &args[position];
        position += 1;
        match argument.as_str() {
            "--help" | "-h" => {
                print!("{HELP}");
                return Ok(0);
            }
            "--no-shrink" => {
                overrides["shrink"] = json!(false);
                continue;
            }
            "--keep-target-open" => {
                overrides["keep_target_open"] = json!(true);
                continue;
            }
            "--custom-strategies" => {
                overrides["custom_strategies"] = json!(true);
                continue;
            }
            "--plan" => {
                plan = true;
                continue;
            }
            _ => {}
        }
        let (name, value) = if let Some((name, value)) = argument.split_once('=') {
            (name, value.to_owned())
        } else {
            let value = args
                .get(position)
                .ok_or_else(|| Fault::unknown(format!("Missing value for {argument}")))?
                .clone();
            position += 1;
            (argument.as_str(), value)
        };
        match name {
            "--model" => model_path = Some(value),
            "--adapter" if generic => executable = Some(value),
            "--adapter-arg" if generic => executable_args.push(value),
            "--target" if !generic => executable = Some(value),
            "--target-arg" if !generic => executable_args.push(value),
            "--config" if generic => config_path = Some(value),
            "--cwd" => cwd = Some(PathBuf::from(value)),
            "--output" => output = PathBuf::from(value),
            "--replay" => replay = Some(value),
            "--timeout" => timeout = number(name, &value)?,
            "--seed" => overrides["seed"] = json!(number::<u64>(name, &value)?),
            "--walks" => overrides["walks"] = json!(number::<usize>(name, &value)?),
            "--max-steps" => overrides["max_steps"] = json!(number::<usize>(name, &value)?),
            "--cases" => overrides["cases"] = json!(number::<u64>(name, &value)?),
            "--max-input-attempts" => {
                overrides["max_input_attempts"] = json!(number::<usize>(name, &value)?)
            }
            "--input-mode" => overrides["input_mode"] = json!(value),
            "--evaluator" if generic => overrides["evaluator"] = json!(value),
            "--input-strategies" => overrides["input_strategies"] = read(&value)?,
            "--generator" => generator = Some(value),
            "--edge-coverage" => edge_coverage = Some(number::<f64>(name, &value)?),
            "--state-coverage" => state_coverage = Some(number::<f64>(name, &value)?),
            _ => {
                return Err(Fault::unknown(format!(
                    "Unknown native option {name}; use --help"
                )));
            }
        }
    }
    if !timeout.is_finite() || timeout <= 0.0 || timeout > 86400.0 {
        return Err(Fault::unknown(
            "Timeout must be positive, finite and at most 86400 seconds",
        ));
    }
    let config = match config_path.as_deref() {
        Some("-") => {
            let mut input = String::new();
            io::stdin()
                .read_to_string(&mut input)
                .map_err(|_| Fault::unknown("Cannot read run configuration from stdin"))?;
            decode(&input, "stdin")?
        }
        Some(path) => read(path)?,
        None => json!({}),
    };
    crate::model::shape(&config, &["target", "options", "decision"], &[])?;
    let mut option_values = json!({"max_steps":1000,"evaluator":"adapter"});
    if let Some(options) = config.get("options") {
        let options = options
            .as_object()
            .ok_or_else(|| Fault::unknown("Run options must be an object"))?;
        for (k, v) in options {
            option_values[k] = v.clone();
        }
    }
    for (k, v) in overrides.as_object().unwrap() {
        option_values[k] = v.clone();
    }
    let options: Options = serde_json::from_value(option_values)
        .map_err(|e| Fault::unknown(format!("Invalid run options: {e}")))?;
    options.validate()?;
    let target_config = config.get("target").cloned().unwrap_or(json!({}));
    if !target_config.is_object() {
        return Err(Fault::unknown("Target configuration must be an object"));
    }
    if config.get("decision").is_some_and(|d| !d.is_object()) {
        return Err(Fault::unknown("Decision configuration must be an object"));
    }
    if plan && replay.is_some() {
        return Err(Fault::unknown("--plan cannot execute a replay"));
    }
    if replay.is_some()
        && (generator.is_some()
            || edge_coverage.is_some()
            || state_coverage.is_some()
            || options.input_strategies != json!({})
            || options.custom_strategies)
    {
        return Err(Fault::unknown(
            "Replay uses its saved model and input; do not override exploration or strategies",
        ));
    }
    let document = if let Some(path) = model_path {
        read(&path)?
    } else if self_test {
        decode(SELF_MODEL, "self-model")?
    } else {
        return Err(Fault::unknown(format!("{mode} requires --model")));
    };
    let model = crate::configuration::configure(
        Model::new(document)?,
        generator,
        edge_coverage,
        state_coverage,
    )?;
    engine::validate_policy_fields(&options.input_strategies, &model.data_sets)?;
    let recipe = replay.as_deref().map(read).transpose()?;
    if plan {
        let inventory = engine::inventory_for(&model, &options, recipe.as_ref())?;
        println!("{}", serde_json::to_string_pretty(&inventory).unwrap());
        return Ok(0);
    }
    let executable = match executable {
        Some(value) => value,
        None if self_test => std::env::current_exe()
            .map_err(|e| Fault::unknown(e.to_string()))?
            .to_string_lossy()
            .into_owned(),
        None => {
            return Err(Fault::unknown(if generic {
                "run requires --adapter"
            } else {
                "rpc requires --target"
            }));
        }
    };
    let mut argv = vec![executable];
    argv.extend(executable_args);
    let mut target: Box<dyn Target> = if generic {
        Box::new(ExecutableAdapter::new(
            &argv,
            Duration::from_secs_f64(timeout),
            cwd.as_deref(),
            config.get("decision"),
        )?)
    } else {
        Box::new(RpcTarget::new(
            model.clone(),
            argv.clone(),
            Duration::from_secs_f64(timeout),
            cwd,
        )?)
    };
    let target_config = if generic {
        target_config
    } else {
        json!({"url":format!("stdio://{}",argv[0]),"adapter":"json-rpc"})
    };
    let result = crate::session::run(
        &model,
        &mut target,
        options,
        target_config,
        recipe,
        Some(&output),
    )?;
    Ok(summary(&result))
}

/// Both installed binaries provide the CLI and the JSON-RPC worker.
pub fn main_entry() {
    let args: Vec<_> = std::env::args().collect();
    if args
        .get(1)
        .is_some_and(|a| ["run", "self-test", "rpc"].contains(&a.as_str()))
    {
        let code = match execute(&args[1..]) {
            Ok(code) => code,
            Err(error) => {
                eprintln!("{}: {}", error.status, error.message);
                2
            }
        };
        std::process::exit(code);
    }
    if args.iter().any(|a| a == "--version") {
        println!("testwalker {}", env!("CARGO_PKG_VERSION"));
        return;
    }
    if args.iter().any(|a| a == "--help" || a == "-h") {
        print!(
            "{HELP}\nWithout a subcommand: JSON-RPC 2.0 worker over stdin/stdout. See docs/protocol.md.\n"
        );
        return;
    }
    if args.len() > 1 {
        eprintln!("Unknown command; use --help");
        std::process::exit(2);
    }
    let mut peer = crate::protocol::Peer::new(
        BufReader::new(io::stdin().lock()),
        BufWriter::new(io::stdout().lock()),
    );
    if let Err(error) = peer.serve() {
        eprintln!("testwalker: {error}");
        std::process::exit(2);
    }
}
