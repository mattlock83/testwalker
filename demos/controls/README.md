# Controls lab

A self-contained plain HTML site and selector-free [model](model.json) covering common browser controls. It has 34 states and 85 journeys, with no custom runtime hooks.

## Shell scripts

After [repository setup](../../README.md#build-and-run), run from the repository root:

```bash
./demos/controls/test.sh --headed
./demos/controls/discover.sh --headed
```

Testing uses the existing model and `run.local.json` with your Jev key. Discovery needs no key and writes a new timestamped draft beside the existing model, with its viewer and captures under `artifact/`. Both scripts accept extra CLI options. The local site is started and stopped automatically; discovery uses a free port. See [the script guide](../README.md#shell-scripts) for overrides.

## Run

After [setup](../../README.md#build-and-run), run from the repository root. Create the local configuration once and set `decision.api_key`:

```bash
cp demos/controls/run.json.example demos/controls/run.local.json
```

Edit `decision.api_key` in the new file, then run:

```bash
npm run demo --workspace @testwalker/demo-controls -- --headed
```

The wrapper uses port 4187 and closes its server and browser afterward. Reports go to `demos/controls/artifact/`.

The default selects the full graph and six focused Name-validation phases. Select all 21 Name, Email and Notes phases with:

```bash
npm run demo --workspace @testwalker/demo-controls -- --headed \
  --max-input-attempts 1000
```

Use `--input-mode none` for graph-only execution. Fixed date, slider and colour values on graph journeys still execute.

## Scenarios

| Scenario            | Coverage                                                                     |
| ------------------- | ---------------------------------------------------------------------------- |
| Checkbox and switch | Set/clear/toggle; disabled and read-only controls remain unavailable.        |
| Radio               | Select an option; choosing a sibling clears the prior choice.                |
| Native selects      | Single/multiple selection, enabled/disabled choices, replacing and clearing. |
| Native date         | Enter a real ISO date, an out-of-range date and clear it.                    |
| Custom calendar     | Open, change month, select a labelled day, cancel and reopen.                |
| Upload              | One file, multiple files, replacement and clearing.                          |
| Sliders             | Native and ARIA controls, limits, interior values and restoration.           |
| Colour              | Set and restore a native `#RRGGBB` value.                                    |
| Drag/drop           | Move an item between labelled lists and verify membership.                   |
| Custom dropdown     | Open, choose an accessible option, close and reopen.                         |
| Registration        | Name/email/textarea constraints and read-only accepted-value comparisons.    |

Uploads refer to fixture aliases in [browser.json](browser.json), backed by the included synthetic files. The model contains no file paths or selectors. Native dates use literal values instead of OS popup automation. Colour and continuous native range values use trusted native setters with input/change events; other slider operations use keyboard interaction.

The event history records actual browser events separately from current results. Opaque widgets without usable labels/roles/targets require hooks in an application integration; this demo does not need them.

## Plan, preview and regression checks

```bash
npx --no-install testwalker-web plan --directory demos/controls
npx --no-install testwalker-web serve --directory demos/controls/site --port 4187
npm test --workspace @testwalker/demo-controls
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/demo-controls
```

Stop preview before testing on its port. Regression tests consume the public adapter API and installed Rust executable, without a Jev key. Browser checks need Chrome.

The checked-in [verification record](verification.json) contains a measured full-graph, 21-input run; its report paths refer to ignored local artifacts. See [testing and debugging](../../testwalker-web/docs/testing.md) for current run reports.
