# Framework CLI and executable adapters

`testwalker` is the Rust framework command. An adapter is any executable implementing the [JSON-RPC target contract](protocol.md): a compiled binary, an installed console entry point, or an executable script with a shebang. The framework does not need to know its language.

```bash
cd core  # From the repository root
cargo build --release --locked --bin testwalker --bin testwalker-core
export PATH="$PWD/target/release:$PATH"

testwalker run --model model.json --adapter /path/to/my-adapter \
  --config run.json --generator new_york_street_sweeper \
  --max-steps 1000 --max-input-attempts 2 --output artifacts
```

Adapters receive callbacks such as `target.initialize`, `target.execute`, `target.observe`, `target.hook` and `target.close`. They return observations and evidence. Rust owns graph selection, Hegel inputs, budgets, verdicts, reports, JUnit and replay. Adapter stderr is shown as diagnostics; stdout is reserved for newline-delimited JSON-RPC messages.

Arguments are literal and are never executed by a shell:

```bash
testwalker run --model model.json --adapter /path/to/my-adapter \
  --adapter-arg=--profile --adapter-arg='a profile with spaces' --cwd /path/to/workdir
```

A non-executable script can also be launched using its runtime as the executable and the script path as an argument. That is ordinary process invocation, not a framework language setting.

## Run configuration

`--config FILE` reads JSON containing three optional objects:

```json
{
  "target": {
    "url": "http://localhost:3000",
    "adapter": "web",
    "screenshots": true,
    "limits": {"actions_per_journey": 25, "confidence": 0.80}
  },
  "options": {
    "input_mode": "generated",
    "cases": 1,
    "max_input_attempts": 2,
    "shrink": false,
    "evaluator": "adapter"
  },
  "decision": {
    "provider": "jev",
    "api_key": "your-jev-key",
    "max_calls": 4000,
    "threshold": 0.80
  }
}
```

`target` is opaque adapter configuration passed to `target.initialize`, with the framework's output directory added. `options` uses the execution settings documented in [the protocol](protocol.md). CLI flags override corresponding options. `decision` configures the native provider and is not included in adapter configuration or reports. Omit it for adapters using deterministic assertions. Keep files containing API keys out of version control.

Use `--config -` to supply the same JSON through stdin, without putting credentials in process arguments. The Node web CLI uses this mechanism. Stdin configuration is consumed before the framework creates the adapter's separate protocol pipes.

`--plan` prints the selected inventory without starting the adapter or configuring a provider. Custom strategy callbacks are not executed during planning. During execution, `--custom-strategies` lets the adapter return declarative Hegel domains through `target.strategy`, before browser initialization.

Use `--evaluator adapter` (the default) when the adapter prepares state/rule checks, as the web adapter does. With `--evaluator core`, Rust prepares questions directly from JSON observations using its configured decision provider.

`--timeout` bounds each adapter callback, including its nested service calls; default 120 seconds. It is not the overall run duration. Exit codes are 0 for PASS, 1 for FAIL and 2 for INCONCLUSIVE/configuration errors. Normal execution closes the target, retrieves optional artifacts, writes reports, then closes adapter stdin and reaps the process.

## Web adapter

The [TypeScript adapter](../../testwalker-web/README.md) uses PlayJev and Playwright. Install it locally with `npm ci && npm run build` from the repository root. Put the built Rust executable on PATH or set `TESTWALKER_BIN`.

```bash
cp demos/trailhead/run.json.example demos/trailhead/run.local.json
# Set decision.api_key in run.local.json.
npx --no-install testwalker-web demo --directory demos/trailhead \
  --app demos/trailhead/app.ts --hooks demos/trailhead/hooks.ts --headed \
  --generator predefined_path --edge-coverage 0 --state-coverage 0 \
  --max-input-attempts 2 --no-shrink --max-calls 1000
```

The Node launcher hosts the application, passes provider configuration through stdin, invokes Rust, and stops the server at exit. Rust launches the executable adapter and owns all scheduling and reports. The adapter returns screenshots, traces and observations. Neither the launcher nor the adapter renders JUnit or HTML reports. Static demos need no custom code.

For an already hosted site, the native framework can invoke Node directly:

```bash
testwalker run --model demos/trailhead/model.json --adapter node \
  --adapter-arg=/absolute/path/to/testwalker-web/dist/main.js \
  --adapter-arg=--config --adapter-arg=/absolute/path/to/browser.json \
  --adapter-arg=--headed \
  --adapter-arg=--hooks --adapter-arg=/absolute/path/to/trailhead/hooks.ts \
  --config run.local.json --max-steps 1000
```

The browser JSON supplies Playwright Chromium launch/context options. The native run JSON supplies the URL, provider and execution options. The convenience CLI aligns adapter confidence with the provider threshold (default 0.80).

Replay uses the same executable and configuration:

```bash
testwalker run --model /path/to/report/model.json --adapter /path/to/my-adapter \
  --config run.json --replay /path/to/report/replays/case.json
```

Replay requires the saved model hash and does not allow generator, coverage or input-strategy overrides. Use `testwalker --help` for all flags. Native `rpc` and `self-test` modes use the same CLI options, scheduler and report implementation.
