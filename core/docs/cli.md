# Framework CLI

Run `testwalker --help` for the command-line reference. Build and PATH setup are in the [framework guide](../README.md).

| Command                | Use                                            |
| ---------------------- | ---------------------------------------------- |
| `testwalker run`       | Execute a model through an adapter executable. |
| `testwalker rpc`       | Test an executable JSON-RPC service.           |
| `testwalker self-test` | Test the bundled worker API model.             |

## Run an adapter

```bash
testwalker run --model /path/to/model.json \
  --adapter /path/to/adapter --config /path/to/run.json \
  --output artifacts
```

An adapter implements the [target protocol](protocol.md). It may be a binary or executable script. To run a script through its runtime, supply that runtime as the executable and the script as an argument:

```bash
testwalker run --model /path/to/model.json --adapter node \
  --adapter-arg=/path/to/adapter.js --adapter-arg=--profile \
  --adapter-arg='a profile with spaces' --config /path/to/run.json
```

Arguments are passed directly, without a shell. `--cwd` sets the adapter working directory. Stdout is reserved for JSON-RPC; adapter diagnostics go to stderr. The framework launches and closes the adapter and owns all reports.

For browser tests, the [web CLI](../../testwalker-web/README.md) prepares these arguments and can host the demo site.

Without `--output`, runs write to `<model directory>/artifact/<timestamped run>/`. Each run has its own report files and asset subfolders. `--output DIR` overrides the parent directory. The bundled `self-test` has no model file path, so its default is `artifact/` in the current working directory. Planning with `--plan` writes no artifacts.

## Run configuration

`--config FILE` reads three optional JSON objects:

```json
{
  "target": {
    "url": "http://localhost:3000",
    "screenshots": true,
    "limits": { "actions_per_journey": 25, "confidence": 0.8 }
  },
  "options": {
    "input_mode": "focused",
    "cases": 1,
    "max_input_attempts": 1000,
    "max_steps": 1000,
    "evaluator": "adapter"
  },
  "decision": {
    "provider": "jev",
    "api_key": "your-jev-key",
    "max_calls": 4000,
    "threshold": 0.8
  }
}
```

- `target` is adapter-specific configuration. The framework adds its report directory before passing it to `target.initialize`.
- `options` configures execution. CLI flags override matching settings.
- `decision` configures the Rust decision provider. Omit it when the adapter uses deterministic assertions. Credentials are not passed in target configuration or included in reports.

Keep API keys in ignored local files. `--config -` accepts the same JSON on stdin; the web CLI uses this to keep credentials out of process arguments.

With `evaluator: "adapter"`, the adapter returns observed states and rule checks and Rust applies the verdict policy. With `evaluator: "core"`, Rust prepares decision questions from JSON observations. The CLI default is `adapter`.

## Exploration and input options

These are CLI defaults when configuration does not override them. Direct worker RPC defaults are documented separately in the [protocol](protocol.md).

| Option                                    | Meaning / default                                                                      |
| ----------------------------------------- | -------------------------------------------------------------------------------------- |
| `--seed N`                                | Graph and input seed; 42.                                                              |
| `--walks N`                               | Separately reset graph walks; 1, range 1–100.                                          |
| `--generator EXPR`                        | Generator name or expression; uses the model when no exploration override is supplied. |
| `--edge-coverage N`, `--state-coverage N` | Required verified coverage percentages; use the model's values by default.             |
| `--max-steps N`                           | Maximum graph elements per walk; 1000, range 1–10000. Both states and edges count.     |
| `--input-mode MODE`                       | `focused`, `generated`, `boundaries`, `all` or `none`; default `focused`.              |
| `--cases N`                               | Up to N generated examples per phase; 1, range 1–200.                                  |
| `--max-input-attempts N`                  | Select input scope and bound reproduction/shrinking; 1000, range 1–10000.              |
| `--input-strategies FILE`                 | Focused-mode generation policy.                                                        |
| `--custom-strategies`                     | Ask the adapter for declarative Hegel domains through `target.strategy`.               |
| `--no-shrink`                             | Disable shrinking; failure reproduction can still occur.                               |
| `--timeout SECONDS`                       | Deadline per callback; 120 for adapter runs, 30 for RPC targets.                       |
| `--output DIR`                            | Report parent; defaults to `artifact/` beside the supplied model.                      |

Input strategies and scope selection are described in [Hegel strategies](input-strategies.md). `decision.max_calls` bounds provider calls; the web CLI also exposes it as `--max-calls`. It is separate from the input-attempt allowance.

An input limit selects work before execution. Unselected phases are outside scope. A provider or action limit that blocks selected work makes the run inconclusive. Reaching the input allowance during failure minimization preserves the observed defect, with a note that it may not be minimal.

## Graph walk modes

| Generator                          | Use                                                                 |
| ---------------------------------- | ------------------------------------------------------------------- |
| `new_york_street_sweeper`          | Traverse the graph's edges; requires a strongly connected graph.    |
| `random`                           | Random walk until the stop condition.                               |
| `quick_random`                     | Random exploration with coverage-oriented routing.                  |
| `weighted_random`                  | Random walk using native edge `weight` values.                      |
| `shortest_all_paths`               | Native shortest-path exploration.                                   |
| `a_star(reached_vertex(state_id))` | Route to a named vertex. A bare `a_star` needs a target expression. |
| `predefined_path`                  | Use the graph's `predefinedPathEdgeIds`.                            |

New York Street Sweeper treats edges equally and can warn that model weights are treated as 1. Use `weighted_random` when weights should influence exploration.

The bare names `random`, `quick_random`, `weighted_random` and `shortest_all_paths` use the effective edge/state coverage targets as their stop condition. A complete expression retains its own condition:

```bash
testwalker run --model /path/to/model.json --adapter /path/to/adapter \
  --config /path/to/run.json \
  --generator 'random(length(4)) a_star(reached_vertex(review))' \
  --edge-coverage 0 --state-coverage 0
```

The example requires a vertex named `review`. A short route with zero coverage targets tests that selected route; it does not claim full-graph coverage. The framework separately verifies requested coverage after execution. Increasing `--max-steps` cannot make a terminal graph state traversable.

Advanced `options.paths` can import already planned walks as arrays of `{kind:"state"|"edge", id}`. Each route must start at the model's start state and alternate connected edges and states. The route count must match `walks`, and each route must fit `max_steps`.

## Plan, replay and results

Planning validates the model and prints the inventory without starting a target or configuring a provider:

```bash
testwalker run --model /path/to/model.json --plan
```

Custom strategy callbacks run during execution before target initialization, not during planning.

Replay a saved concrete case with its saved effective model:

```bash
testwalker run --model /path/to/report/model.json \
  --adapter /path/to/adapter --config /path/to/run.json \
  --replay /path/to/report/replays/case.json
```

Replay validates the model hash and uses the saved input and modeled setup. Do not supply generator, coverage or input-strategy overrides. Supply the same adapter configuration and hooks.

Exit codes are **0 PASS**, **1 FAIL**, and **2 INCONCLUSIVE or configuration error**. Cleanup and report writing also run after an unsuccessful result. See [results and debugging](../../testwalker-web/docs/testing.md#results-and-reports) for the browser report bundle, and [RPC testing](rpc-testing.md) for browser-free execution.
