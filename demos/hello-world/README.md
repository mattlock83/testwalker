# Hello World

The smallest example has Home and Greeting navigation, one Name input, four states and eight journeys. A name must contain 2–30 characters after trimming surrounding spaces.

The plain HTML site and selector-free [model](model.json) need no application-specific runtime hook. The web adapter supplies the interactions; Hegel tests the Name constraints.

## Run

After [setup](../../README.md#build-and-run), run from the repository root. Create the local configuration once and set `decision.api_key`:

```bash
cp demos/hello-world/run.json.example demos/hello-world/run.local.json
```

Edit `decision.api_key` in the new file, then run:

```bash
./demos/hello-world/test.sh --headed
```

The script uses port 4185, starts/stops the site and closes the owned browser. Reports go to `demos/hello-world/artifact/`. Defaults cover the full graph and ten focused input phases.

For the full graph with two selected inputs, append `--max-input-attempts 2 --no-shrink`. For graph only, append `--input-mode none`.

## Discover a model draft

Discovery needs no Jev key or Rust executable. After building the Node packages, run from the repository root:

```bash
./demos/hello-world/discover.sh --headed
```

The script starts and stops the local site automatically, using a free port. It writes a new `discovered-<timestamp>-<pid>.model.json` beside the existing model, with its viewer and captures under `artifact/`. Review the draft before executing it; the existing model is unchanged. Both `test.sh` and `discover.sh` accept CLI options; see [the script guide](../README.md#shell-scripts) for overrides.

## Plan or preview

Neither command needs a Jev key:

```bash
npx --no-install testwalker-web plan --directory demos/hello-world
npx --no-install testwalker-web serve --directory demos/hello-world/site --port 4185
```

Stop preview with Ctrl+C before testing on the same port.

## Regression checks

After the local package build:

```bash
npm test --workspace @testwalker/demo-hello-world
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/demo-hello-world
```

The [tests](tests/) check the model and site; they are not runtime step definitions. See [scope, reports and replay](../../testwalker-web/docs/testing.md).
