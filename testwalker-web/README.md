# Testwalker web adapter

The web adapter executes business models against websites using Playwright and Jev. Rust plans and schedules tests and owns the results; this package supplies browser interactions, observations, screenshots and explicit JavaScript/TypeScript hooks through JSON-RPC.

## Setup

Follow the repository's [build and run guide](../README.md#build-and-run). Web execution needs Google Chrome, the built Rust executable and a Jev API key. Run commands below from the repository root after building the local workspace packages.

The framework executable is selected by `--framework /absolute/path/to/testwalker`, `TESTWALKER_BIN`, or the bundled `@testwalker/core` executable. Public `CoreClient` utilities use `TESTWALKER_CORE_BIN` or the packaged worker. Neither default searches PATH or runs Cargo.

The public modules are `@testwalker/web` for hooks/browser helpers and `@testwalker/web/cli` for the launcher's `main(argv)` function. See [local packages](../docs/local-packages.md) for local archives and installation outside the checkout.

## Test an existing website

Start your application separately. Create `run.local.json` using the [run configuration](../core/docs/cli.md#run-configuration) and set `decision.api_key`.

```bash
npx --no-install testwalker-web run \
  --model /path/to/model.json --url http://localhost:3000/ \
  --config /path/to/run.local.json --headed
```

Models describe business states, intents and rules, without selectors. Jev resolves those descriptions against observed browser controls. Start with the [model guide](../core/docs/model-format.md) or a [demo](../demos/README.md).

Reports default to `artifact/<timestamped run>/` beside the supplied model, including when `--model` overrides a demo model. Screenshots, evidence and replay files use subfolders within that run. `--output DIR` selects a different parent directory.

## CLI commands

| Command | Purpose                                                             |
| ------- | ------------------------------------------------------------------- |
| `run`   | Execute a model against a separately hosted `--url`.                |
| `demo`  | Start a local `site/`, execute its model, then stop the server.     |
| `plan`  | Inspect the route and input scope without a key, browser or server. |
| `serve` | Preview a local site without running tests or calling Jev.          |

A demo folder contains `site/`, `model.json`, `browser.json`, and a local run configuration. `demo` and `plan --directory` locate those files automatically. `--app` explicitly loads a backend exporting `create_server(directory)`; `--hooks` loads lifecycle functions. Neither is loaded from the model.

```bash
npx --no-install testwalker-web demo \
  --directory demos/hello-world --port 4185 --headed

npx --no-install testwalker-web plan --directory demos/hello-world

npx --no-install testwalker-web serve \
  --directory demos/hello-world/site --port 4185
```

Stop a preview server before using its port for a demo, or choose another `--port`. The direct demo CLI defaults to port 4173; the demo scripts select the ports listed in [the demo guide](../demos/README.md).

## Run and browser configuration

There are two separate JSON files:

| File                                             | Settings                                                                                            |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `run.local.json`, selected with `--config`       | Jev key, call allowance, confidence threshold, execution options, screenshots and action allowance. |
| `browser.json`, selected with `--browser-config` | Chromium launch/context settings, settling and named upload fixtures.                               |

The launcher passes provider configuration to Rust through stdin. `--max-calls` changes the whole-run Jev allowance; `--threshold` changes required confidence, default 0.80. `--max-actions` bounds control operations in one journey, default 25. Graph, input, `--keep-going` and replay flags pass to Rust; see [scope and debugging](docs/testing.md).

Browser example:

```json
{
  "launch": { "channel": "chrome" },
  "context": {
    "viewport": { "width": 1280, "height": 900 },
    "ignoreHTTPSErrors": false
  },
  "action_timeout_ms": 15000,
  "navigation_timeout_ms": 30000,
  "settle_ms": 150,
  "settle_timeout_ms": 5000,
  "uploads": { "sample document": ["fixtures/sample.txt"] }
}
```

`launch` and `context` accept Playwright Chromium options. Relative executable and upload paths resolve beside this file. `--headed` controls browser visibility. The adapter supports Chromium, using fresh nonpersistent contexts; Firefox, WebKit and persistent-profile extensions are not implemented.

`--cdp-url http://127.0.0.1:9222` can attach to externally managed Chromium. The adapter creates and closes its own context without closing the external browser's other contexts. Owned browser resources close at completion. `--keep-target-open` is not supported; inspect report screenshots after a run.

Before observations, the adapter waits for relevant requests and DOM activity to settle. A timeout is inconclusive. Tune `settle_ms` and `settle_timeout_ms` for your application; setting `settle_ms` to 0 disables that wait.

## Supported interactions

| Control                                | Model intent or input                                                              |
| -------------------------------------- | ---------------------------------------------------------------------------------- |
| Links and buttons                      | Business intent resolved against observed labels and context.                      |
| Text, email, textarea, contenteditable | Literal named input values.                                                        |
| Checkbox, radio, switch                | Desired checked state; a selected radio is cleared by choosing a sibling.          |
| Native single/multiple select          | Choose enabled observed options, set a complete selection or clear it.             |
| Native date                            | A real `YYYY-MM-DD` value; out-of-range dates remain enterable for app validation. |
| Custom calendar or dropdown            | Separate modeled opening, navigation and option-selection journeys.                |
| File upload                            | A fixture alias configured in `browser.json`; empty input clears it.               |
| Native/ARIA slider                     | Exact numeric input, with keyboard interaction and verification.                   |
| Native colour                          | `#RRGGBB`, applied with a native value setter and input/change events.             |
| Drag/drop                              | An observed draggable source and labelled destination region/list.                 |

Native date and colour popups supplied by the OS are not automated. Continuous native ranges also use a native value setter. Unreachable values, disabled options, ambiguous mappings and opaque widgets remain inconclusive or need an explicit hook. See the [Controls lab](../demos/controls/README.md).

The adapter plans and validates literal inputs before mutation, verifies their entry and submits once when the intent asks for submission. It does not repair deliberately invalid data. Editing inputs alone does not implicitly submit a form. Changed page evidence invalidates cached control bindings.

## Verification and evidence

Actions and outcomes are checked separately. Jev independently identifies the observed state, then checks its rules. Editable values do not prove acceptance. Read-only outputs, current validation feedback, select configuration and visible menus provide state evidence. Screenshots and traces are returned to Rust for its report bundle.

All decision calls use the framework's provider budget, confidence gate, cache and transcript. The adapter executes trusted Playwright operations; it does not execute code returned by Jev. See [architecture](../core/docs/architecture.md) for the call sequence.

## Extensions and development

- [Lifecycle hooks](docs/hooks.md): backend reset, custom controls and deterministic assertions.
- [Input strategies](../core/docs/input-strategies.md): JSON policies and custom Hegel domains.
- [Adapter protocol](../core/docs/protocol.md): executable integration contract.
- [web-discover](https://github.com/mattlock83/web-discover): separate model-draft tool.

From the repository root:

```bash
npm run check --workspace @testwalker/web
npm test --workspace @testwalker/web
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/web
```

Local browser regression tests need Chrome and use deterministic decisions, without a Jev key. The package's public exports are in [src/index.ts](src/index.ts). Extensions can be `.js`, `.mjs` or `.ts`; TypeScript is loaded with the bundled tsx runtime.
