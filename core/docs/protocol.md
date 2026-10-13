# JSON-RPC adapter protocol

Testwalker uses bidirectional JSON-RPC 2.0 over stdin/stdout: one UTF-8 JSON object per line, with a 64 MiB message limit. Stdout contains protocol messages; diagnostics go to stderr. Batch requests are not supported.

There are two roles:

1. **Executable adapter:** `testwalker run` hosts the framework, launches the adapter, and calls its target methods. The adapter can make nested framework service requests while handling callbacks.
2. **Worker client:** a client launches `testwalker-core` without arguments and calls framework methods such as `run.start`. That client also handles target callbacks. The web package's `CoreClient` supports this profile.

Use the native CLI for normal runs. Implement this protocol when adding an adapter or hosting execution yourself. See [CLI configuration](cli.md).

## Machine-readable contracts

- [openrpc.json](../openrpc.json): methods callable on the worker.
- [openrpc.adapter.json](../openrpc.adapter.json): callbacks implemented by adapters.

Both specify named parameters, result schemas, errors and examples. The worker exposes its embedded contract through `rpc.discover`:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "rpc.discover", "params": {} }
```

Valid notifications receive no response. Errors use `-32700` for malformed JSON, `-32600` for invalid request envelopes, `-32601` for unknown methods and `-32602` for invalid parameter types. Domain errors use `-32001` with a structured Testwalker outcome.

One worker executes one synchronous run at a time. `run.start` returns the final report, not an asynchronous run handle. Cancellation is cooperative at target/decision boundaries; it cannot interrupt an already running external operation.

## Client to framework

The OpenRPC contract is the complete schema reference. Main methods are:

| Method                                                                      | Purpose                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `core.info`, `rpc.discover`                                                 | Version, method inventory and API contract.                                        |
| `model.validate`, `model.configure`                                         | Validate the model; optionally override exploration.                               |
| `graph.setup`, `graph.plan`, `run.plan`                                     | Setup routes, graph routes and selected inventory without target execution.        |
| `property.validate`, `property.policy`, `property.plan`, `property.samples` | Input validity, strategy policies and phases.                                      |
| `run.validate`                                                              | Validate execution options without planning or target initialization.              |
| `run.start`                                                                 | Execute `{model, options?, target?, output?}` and return final results.            |
| `case.replay`                                                               | Execute a concrete saved `{case}` using the same model hash.                       |
| `run.cancel`, `run.results`                                                 | Request cancellation or retrieve the last completed report.                        |
| `decision.configure`                                                        | Configure Jev before execution: key, endpoint/model, threshold and allowance.      |
| `decision.ask`                                                              | Submit `{evidence, questions}` through the framework's provider, cache and budget. |
| `decision.answer`                                                           | Validate a named answer and its confidence against the allowed choices.            |
| `decision.stats`, `decision.audit`                                          | Usage and paginated request/response transcripts.                                  |
| `decision.post`                                                             | Auxiliary HTTP JSON request sharing the provider allowance.                        |
| `property.exercise`                                                         | Run Hegel independently of a graph, with `property.evaluate` callbacks.            |
| `core.shutdown`                                                             | Exit when no run is active.                                                        |

Worker execution options include `seed`, `walks`, `max_steps`, `cases`, `input_mode`, `input_strategies`, `custom_strategies`, `shrink`, `max_input_attempts`, `keep_target_open`, `keep_going`, `evaluator` and optional imported `paths`. Unknown options are rejected. Direct worker defaults include `max_steps:200` and `evaluator:"core"`; the native CLI defaults to 1000 and `adapter` instead.

Planning does not call custom strategy providers. During execution, custom domains are bound before target initialization and included in the authoritative planned event.

When the native CLI hosts a run, nested adapter requests may use validation/planning, decision queries/audit, `core.info` and `rpc.discover`. Adapters cannot reconfigure the provider, start nested runs, shut down the host, or use callback-driven `property.exercise`.

## Framework to adapter

Respond with the same request ID. The adapter implements target operations rather than choosing graph edges or changing supplied data.

| Callback                              | Contract                                                                                                                                                      |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `target.initialize`                   | `{protocol_version:"1", model, config}` → `{capabilities:{...}}`.                                                                                             |
| `target.reset`                        | Restore the entry fixture. Web opens a fresh context; hooks reset backend data.                                                                               |
| `target.execute`                      | `{edge, input, fields, destination, states}` → perform the declared intent with literal inputs.                                                               |
| `target.observe`                      | Return arbitrary JSON evidence of the actual target state.                                                                                                    |
| `target.evaluate`                     | Adapter evaluator only: `{observation, expected, input, violations, ...}` → `{observed, checks}`. Identify state independently before comparing expectations. |
| `target.audit`                        | Adapter evaluator: `{records, rules}` → checks for deferred global rules.                                                                                     |
| `target.hook`                         | `{event, context}` → invoke target-specific lifecycle code.                                                                                                   |
| `target.strategy`                     | `{context, default}` → a declarative Hegel domain when custom strategies are enabled.                                                                         |
| `target.close`                        | `{keep_open}` → release owned resources after a terminal outcome.                                                                                             |
| `run.event`                           | `{type, data}` → optional case evidence attachments.                                                                                                          |
| `target.artifacts`                    | Optional paginated traces, hooks and decisions after cleanup.                                                                                                 |
| `target.checkpoint`, `target.restore` | Optional complete isolated fixture capture/restore.                                                                                                           |

Checks have a scope, rule and status, for example:

```json
{ "scope": "state", "rule": "Invalid data is rejected.", "status": "met" }
```

Statuses are `met`, `broken`, `uncertain`, and `not_applicable` for global rules. A wrong known state or broken rule produces FAIL. Unknown state, unresolved requirements and target/provider errors produce INCONCLUSIVE. Rust applies the final verdict and coverage policy.

A definite defect may be returned as a JSON-RPC error with `data:{status:"FAIL",message,result}`. Errors without a definite contradiction remain inconclusive.

## Lifecycle and isolation

Hooks cover before/after run, walk, reset, transition, state and case. Context contains phase (`graph`, `setup`, `property`), walk, element, data, independent violations, result and error. After hooks run after failed wrapped operations; cleanup faults do not erase an earlier defect.

Checkpoint callbacks are enabled only by `capabilities.isolated_checkpoints:true`. The adapter must restore the entire fixture, including backend state. A DOM snapshot alone is insufficient. Restores do not fire reset hooks. The web adapter advertises false.

## Evidence and framework-owned reports

Supply `output` to persist a worker run or replay. Rust creates a unique child directory and saves the effective model and plan. It announces the directory in the `planned` event and `target.initialize.config.directory`. Without `output`, worker results remain in memory and `directory` is null.

Event types are `planned`, `test.begin`, `step`, `step.result`, `case` and `test.end`. Returns from `case` or `test.end` may include `screenshot`, `screenshot_at`, `screenshot_error`, `trace_range`, `decision_range`, `hook_range` and `attachments`. Core inputs and verdicts remain authoritative.

After cleanup, Rust writes HTML, JSON, JUnit and replay files. The adapter may capture evidence into that directory but does not format reports. See [report contents](../../testwalker-web/docs/testing.md#results-and-reports).

Artifact pagination is enabled by `capabilities.artifacts:true`. Retain captured evidence after `target.close`. Requests contain `{offset,limit}`; responses contain `{entries,next_offset,metadata?}`. Entries have `kind:"trace"|"hook"|"decision"` and `data`. The framework requests up to 128 entries per page. `next_offset:null` ends pagination; other offsets must advance by the number of entries returned.

First-page metadata may contain loaded hook metadata, usage, browser retention or adapter tracebacks. It cannot overwrite tests, coverage, inputs or verdicts. Framework-owned provider usage and audit take precedence. Artifact errors are recorded as cleanup errors.

Provider transcripts can be omitted from a large RPC response with a `decision_audit` reference. Fetch them through `decision.audit` until `next_offset` is null. Framework-written reports retain the transcript, and the HTML viewer loads chunks on demand.

For a complete browser-free integration, see [the built-in RPC target and self-test](rpc-testing.md). For JS/TS browser extensions, see [web hooks](../../testwalker-web/docs/hooks.md).

## Continuation policy

`options.keep_going` defaults to false. When enabled, Rust retains each failed/inconclusive case and continues independent work after verified reset/setup. Adapter faults may set `result.run_fatal: true` for shared infrastructure failures; transport, provider, reset and event persistence failures are marked by the native host. A business contradiction or uncertain state must not use that marker merely to request fail-fast. See [the continuation guide](continuation.md). Recorded replay recipes may include `setup_path`, a connected list of modeled journey IDs from the start to the case source; replay preserves that actual setup route.
