# Demos

Start with Hello World, then use Controls to see supported browser interactions or Trailhead for backend hooks and a larger workflow. Each local demo contains its site, model, configuration examples and regression tests.

## Setup

Complete [the repository build](../README.md#build-and-run) and put `core/target/release` on PATH. Commands below run from the repository root.

For each demo, copy its configuration once and set `decision.api_key` to your Jev key. For example:

```bash
cp demos/hello-world/run.json.example demos/hello-world/run.local.json
```

If the local file already exists, edit it rather than overwriting it. The files are ignored by Git. Browser settings are separate in each demo's `browser.json`.

## Choose a demo

| Demo                                 | What it shows                                                        | Default port  | States / journeys |
| ------------------------------------ | -------------------------------------------------------------------- | ------------- | ----------------- |
| [Hello World](hello-world/README.md) | Two navigation options and one required input.                       | 4185          | 4 / 8             |
| [Booking](booking/README.md)         | Workshop pages, form rejection, review and confirmation.             | 4183          | 8 / 35            |
| [Feedback](feedback/README.md)       | Subject/message validation and acceptance.                           | 4186          | 3 / 4             |
| [Controls](controls/README.md)       | Selects, checks, calendars, files, sliders, colour and drag/drop.    | 4187          | 34 / 85           |
| [Trailhead](trailhead/README.md)     | Adventures, profiles, booking/refund ledger and custom pickup hooks. | 4184          | 20 / 148          |
| [Sauce Demo](saucedemo/README.md)    | An external-site discovery draft requiring model review.             | External site | 63 / 135          |

## Shell scripts

Each demo folder has two executable scripts. After the repository build, run these commands from the repository root:

```bash
./demos/trailhead/test.sh --headed
./demos/trailhead/discover.sh --headed
```

- `test.sh` executes the existing `model.json` through Testwalker, using the demo's local Jev configuration. Local sites start and stop automatically; Trailhead includes its backend and lifecycle hooks. Sauce Demo uses the hosted site and its existing draft may remain inconclusive.
- `discover.sh` needs no Jev key or Rust executable. It starts and stops each local site, or uses the hosted Sauce Demo with its synthetic input values. Local discovery chooses a free port by default; `--port N` selects one. Discovery enables button and empty-form exploration with a bounded scope suited to each demo.

The scripts locate their own demo files, so they also work from another directory when invoked by absolute path. Scripts forward CLI options, so you can select a model or input scope for testing and change discovery depth, limits or output. Relative option paths resolve from your current working directory. For example:

```bash
./demos/trailhead/test.sh --input-mode generated --cases 1 \
  --max-input-attempts 2 --no-shrink --max-calls 4000
./demos/hello-world/discover.sh --depth 1 --output /tmp/hello.model.json
./demos/saucedemo/discover.sh --headed
```

Discovery defaults to a new `discovered-<timestamp>-<pid>.model.json` beside the demo's authored model. Its inventory, viewer and visit assets go under the same folder's `artifact/<timestamped run>/`. Review each new draft before testing it; discovery leaves the authored model unchanged. Use `--help` on either script for CLI options.

Local test scripts start and stop their site and owned browser. A live preview on the same port causes an address-in-use error; stop it or append `--port 0` to choose a free port. Sauce Demo uses the external website; see its guide for the draft's limitations.

The optional npm equivalent is `npm run demo --workspace @testwalker/demo-trailhead -- --headed`. Npm executes inside the demo folder, so use absolute paths for custom model, configuration or replay files.

The demo models request full graph coverage. Input scope comes from the run configuration: the small demos use focused Hegel checks, while Controls selects six phases by default. To select all focused partitions:

```bash
./demos/controls/test.sh --headed \
  --max-input-attempts 1000
```

To explore Trailhead with only two generated property inputs:

```bash
./demos/trailhead/test.sh --headed \
  --input-mode generated --cases 1 --max-input-attempts 2 \
  --no-shrink --max-calls 4000
```

Add `--keep-going` to continue independent cases after failures; see [recovery and dependency skips](../core/docs/continuation.md). The default stops at the first failed or inconclusive check.

`--input-mode none` disables extra property tests but keeps fixed graph form inputs. `--max-calls` is the Jev allowance. See [scope and results](../testwalker-web/docs/testing.md).

## Plan or preview without Jev

Planning needs the Rust executable but no API key, browser or server:

```bash
npx --no-install testwalker-web plan --directory demos/hello-world
```

Preview needs Node and starts the site without tests:

```bash
npx --no-install testwalker-web serve \
  --directory demos/hello-world/site --port 4185
```

Use Ctrl+C to stop preview. Trailhead additionally needs `--app demos/trailhead/app.ts` when serving.

## Results and regression tests

Each run prints its report and JUnit paths. With the default model they are under `demos/DEMO/artifact/<timestamped run>/`. A custom `--model` writes beside that model instead; `--output DIR` overrides the artifact parent. Those generated directories are not checked in. Use [the testing guide](../testwalker-web/docs/testing.md#results-and-reports) for reports and replay.

The checked-in [verification inventory](verification.json) records measured runs, scopes and local artifact paths; it is a test record, not a guarantee for future executions. It also records expected failures for Trailhead's injected defects and Sauce Demo's unresolved draft.

Run local regression checks without a Jev key:

```bash
npm test --workspace @testwalker/demo-hello-world
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/demo-controls
```

Tests stay under each demo's `tests/`. They check model planning and site behavior; `model.test.ts` is a regression test for the model and is not the runtime implementation of its steps. Runtime interactions come from the shared web adapter, plus explicitly loaded hooks where required.
