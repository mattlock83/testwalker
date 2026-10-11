# Native adapter protocol (version 1)

`testwalker-core` speaks bidirectional JSON-RPC 2.0 using one UTF-8 JSON message per line on stdin/stdout. Stdout contains protocol messages only; diagnostics use stderr. Message limit: 64 MiB. `testwalker run --model MODEL --adapter EXECUTABLE` launches a target adapter and issues lifecycle callbacks on these pipes. The adapter can make nested framework service calls while handling a callback. The worker mode also remains available for clients that launch the framework themselves; the Node `CoreClient` implements that client profile. See [CLI configuration](cli.md).

The machine-readable contracts are [openrpc.json](../openrpc.json) for calls to the worker and [openrpc.adapter.json](../openrpc.adapter.json) for callbacks that adapters implement. Both use OpenRPC 1.3.2 with JSON Schema Draft 7 and include parameter/result schemas, examples, errors and lifecycle requirements. They describe named parameters over stdio; `x-testwalker` metadata records the transport and direction. The two documents keep callback methods out of the worker's callable method inventory.

The worker embeds its specification and exposes it through `rpc.discover`, without a provider or adapter. For example, send this line to its stdin:

```json
{"jsonrpc":"2.0","id":1,"method":"rpc.discover","params":{}}
```

The response's `result` is the complete OpenRPC document. `core.info.methods` advertises the same method inventory. The specifications belong to the framework; the separate TypeScript web package consumes its JSON-RPC interface and does not bundle copies. The graph model continues to define business behaviour and call sequences; the OpenRPC documents define the API interface.

This profile accepts single request objects, not batches. Malformed JSON returns `-32700`, invalid request envelopes return `-32600`, unknown methods return `-32601`, and scalar or null parameters return `-32602`. Valid notifications have no response. An unusable or absent ID on an invalid request is returned as null; valid IDs retain their JSON type. Domain validation errors use `-32001` with Testwalker's structured outcome data.

Run `testwalker-core self-test` to exercise this API through the Rust library driver and a separate subject worker. The [RPC testing guide](rpc-testing.md) also describes testing other stdio APIs with declarative bindings and deterministic assertions, without Jev.

One worker runs one synchronous execution at a time. `run.start` returns its final report, rather than an asynchronous run handle. Start independent workers for parallel runs. `run.cancel` is cooperative at the next target or decision boundary; it cannot interrupt an already running browser operation or HTTP request.

## Client → core

| Method | Parameters / result |
| --- | --- |
| `core.info` | Returns version, protocol version and native dependency revisions. |
| `rpc.discover` | No parameters → the worker's embedded OpenRPC specification. |
| `model.validate` | `{model}` → normalized document, model hash, counts and nominal edge inputs. |
| `model.configure` | `{model, exploration?:{generator?, edges?, states?}}` → the same normalized model result. Fractional stop targets round up for GraphWalker; exact verification thresholds are retained. |
| `graph.setup` | `{model, state}` → nominal setup edges from the start. |
| `property.validate` | `{fields, input}` → independent input violations. |
| `property.policy` | `{policy?, data_sets}` → validated strategy settings and references. |
| `run.validate` | `{model, options?}` → normalized execution options; no graph planning or target initialization. |
| `graph.plan` | `{model, options}` → one connected GraphWalker route. No target or provider required. |
| `run.plan` | `{model, options}` → selected inventory, routes and property phases. No execution. |
| `run.start` | `{model, options?, target?, output?}` → final results, coverage, cases, stop reason and `directory`. `target` is adapter-specific configuration; `output` requests framework-owned report files in a unique child directory. |
| `case.replay` | Same as `run.start`, plus `{case}` containing a saved replay recipe. Validates the model hash. |
| `run.cancel` | Requests cancellation of the active run. |
| `run.results` | Returns the most recently completed report. |
| `decision.configure` | `{provider:"jev", api_key, model?, threshold?, max_calls?, endpoint?}`. Configure before starting. |
| `decision.ask` | `{evidence, questions}` → provider response. Core owns HTTP, cache, call budget and audit. |
| `decision.answer` | `{result, name, choices, threshold?}` → validated choice or uncertainty. Choice probabilities and confidence must meet the threshold. |
| `decision.stats` | Provider call, cache-hit and token usage. |
| `decision.audit` | `{offset?:0, limit?:128}` → `{entries, total, next_offset}`. Fetch the transcript in order until `next_offset` is null. Limit is 1–1024; pages also have a byte bound. |
| `decision.post` | `{url, key, body, cache?}` for an optional auxiliary text helper; shares the call budget. |
| `property.plan` | `{fields, data_set?, options?}` → native property phases. |
| `property.samples` | `{fields}` with one field → named native boundary samples. |
| `property.exercise` | Callback-based Hegel execution over `{fields, options?, phase_ids?}`; issues `property.evaluate` to the adapter. Used for testing domains independently of a graph. |
| `core.shutdown` | Graceful exit when no run is active. |

Options include `seed`, `walks`, `max_steps`, `cases`, `input_mode`, `input_strategies`, `custom_strategies`, `shrink`, `max_input_attempts`, `keep_target_open`, and `evaluator` (`core` or `adapter`). Unknown fields are rejected. Graph steps count both states and edges. Input limits select phases before execution and bound extra reproduction/shrink attempts. Hegel is always the property engine; there is no backend selector.

`run.plan` does not execute trusted strategy-provider callbacks. `run.start` binds custom domains before target initialization and emits the resulting authoritative inventory through `run.event`.

Run results contain `usage` and can contain a `decision_audit` reference when the provider transcript is omitted from the RPC response. Fetch it with `decision.audit`. Framework-written `report.json` retains the full transcript, and the HTML viewer loads its evidence chunks on demand. Deferred web requirements likewise use bounded provider batches without imposing a limit on total campaign evidence.

## Framework-owned reports

Supply `output` to `run.start` or `case.replay` to persist the run. The framework creates a unique directory under that parent, saves `model.json` and `plan.json`, then sends `run.event` with `type:"planned"`. Its `data.directory` is the absolute directory path, available before subsequent case events; the same path is passed as `target.initialize.config.directory`. Relative output paths resolve from the worker's working directory. Without `output`, the framework returns results without writing a report bundle and `directory` is null.

The adapter performs target operations and returns evidence through the callbacks below. After the run and cleanup, Rust writes `report.json`, `report.html`, `junit.xml`, individual replay files and any counterexample replay. The returned report includes `directory`. Screenshots may be captured by the adapter in that directory and returned as relative attachment paths. Report formatting, planned inventory, skipped-test reasons, JUnit outcomes and replay filenames belong to the framework.

This resembles Cucumber's division of responsibilities: the model defines the scenarios, adapters implement the operations, hooks handle setup or custom actions, and the framework runs and reports the tests. An adapter does not need an HTML or JUnit implementation.

## Core → adapter

Respond to each request with the same ID. The adapter must not choose the next graph edge or silently change supplied data. The native CLI passes literal executable arguments without invoking a shell and drains adapter stderr as diagnostics. Stdout must contain protocol messages only; the Node executable adapter redirects hook/library prints to stderr. Closing the input stream ends the adapter after target cleanup and artifact collection.

When the CLI hosts the run, nested requests can use model/graph/property validation and planning plus `decision.ask`, `decision.answer`, `decision.post`, `decision.stats`, `decision.audit`, `core.info` and `rpc.discover`. Adapters cannot configure a provider, launch a nested run, cancel/shut down the host or use callback-driven `property.exercise`. Configure the provider through the native CLI before execution.

| Method | Contract |
| --- | --- |
| `target.initialize` | `{protocol_version:"1", model, config}` → `{capabilities:{...}}`. |
| `target.reset` | Restore the target's entry state. For web, open a fresh owned tab; hooks restore backend fixtures. |
| `target.execute` | `{edge, input, fields, destination, states}`. Perform the edge's business intent using literal data. Return when observation can assess the outcome. |
| `target.observe` | Return arbitrary JSON evidence of the actual target state. |
| `target.evaluate` | Only with `evaluator:"adapter"`: `{observation, expected, input, violations, ...}` → `{observed, checks}`. Independently identify state before comparing expectations. Rust applies the final verdict. Web sends decision questions through nested core calls. |
| `target.audit` | Web/adapter evaluator: `{records, rules}` → deferred global rule checks from accumulated observations. |
| `target.hook` | `{event, context}`. Bind lifecycle events to the implementation language. |
| `target.strategy` | `{context, default}` → declarative Hegel domain, when `custom_strategies:true`. |
| `target.close` | `{keep_open}`. Release owned resources; runs after all terminal outcomes. |
| `target.artifacts` | Optional `{offset, limit}` → `{entries, next_offset, metadata?}` after cleanup. Enabled by `capabilities.artifacts:true`; supplies target traces, hook events and optional decision evidence for framework reports. |
| `run.event` | `{type, data}`. Types: `planned`, `test.begin`, `step`, `step.result`, `case`, `test.end`. The planned event contains `data.directory`. Return `screenshot`, `screenshot_at`, `screenshot_error`, `trace_range`, `decision_range` or `attachments` from `case` or `test.end` to enrich the report. Inputs, verdicts and replay files remain authoritative in Rust. |
| `target.checkpoint` | Optional `{state}` → opaque isolated checkpoint handle. |
| `target.restore` | Optional `{checkpoint}`. Restore the full fixture, including application/backend state. |

Checkpoint calls are enabled only when initialization returns `capabilities.isolated_checkpoints:true`. The runner prepares one source fixture per campaign, then restores and verifies it before each case. The web adapter advertises false. A DOM snapshot alone is insufficient. Restores do not fire reset hooks; the checkpoint adapter owns restoring its full fixture.

Artifact collection is enabled only by `capabilities.artifacts:true`. Keep captured evidence available after `target.close`. The framework starts at offset zero and requests up to 128 entries per page. Each entry is `{kind:"trace"|"hook"|"decision", data:...}`. Return `next_offset:null` at the end; otherwise it must equal the requested offset plus the number of returned entries. Nonterminal pages must make progress and each message must respect the transport byte limit.

The optional first-page metadata supports `hooks:{path,sha256}`, `usage`, `browser_left_open` and `adapter_tracebacks`. It cannot overwrite tests, coverage, inputs or verdicts. When the framework has a configured decision provider, its own audit and usage take precedence over adapter values. Artifact callback failures are included as cleanup errors; an earlier defect remains the primary outcome.

Checks are objects such as `{"scope":"state", "rule":"Invalid data is rejected.", "status":"met"}`. Statuses are `met`, `broken`, `uncertain`, and (for global requirements) `not_applicable`. Wrong identified state or broken requirements produce FAIL. Unknown state, unresolved state requirements, provider or target errors produce INCONCLUSIVE. Untouched selected tests are SKIPPED with the stopping reason. Rules that have not been demonstrated cannot be counted as verified coverage.

Hooks cover before/after run, walk, reset, state, transition and case. Context includes phase (`graph`, `setup`, `property`), walk, element, data, independent violations, result and error. After hooks run even when the wrapped operation fails; cleanup faults do not erase the primary defect.

## A browser-free adapter

```ts
import {CoreClient, Inconclusive} from '@testwalker/web';

// Implement these application operations independently.
import {resetFixture, executeIntent} from './my-api-steps.js';
let lastResponse = {};
const core = new CoreClient('testwalker-core', async (method, params) => {
  switch (method) {
    case 'target.initialize': return {capabilities: {isolated_checkpoints: false}};
    case 'target.reset': return resetFixture();
    case 'target.execute':
      lastResponse = await executeIntent(params.edge, params.input); return {};
    case 'target.observe': return lastResponse;
    case 'target.hook': case 'run.event': case 'target.close': return {};
    default: throw new Inconclusive('Unsupported callback: ' + method);
  }
});
try {
  await core.request('decision.configure', {provider: 'jev', api_key: process.env.JEV_API_KEY});
  const report = await core.request('run.start', {model: modelDocument,
    target: {base_url: 'http://localhost:3000'}, output: 'artifacts',
    options: {evaluator: 'core'}});
} finally {await core.close();}
```

With the core evaluator, Rust constructs state and requirement questions from JSON observations and calls Jev. Adapters for any language can use the same stdio contract; the TypeScript implementation covers browsers, and the native Rust implementation covers stdio JSON-RPC targets.

A definite assertion or modeled defect can be returned as a JSON-RPC error whose `data` contains `{status:"FAIL", message, result}`. Transport failures and errors without a definite defect are INCONCLUSIVE. JSON-RPC errors preserve detailed evidence without converting uncertainty into a failed assertion.
