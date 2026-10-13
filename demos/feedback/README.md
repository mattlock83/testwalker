# Feedback

A studio enquiry form with three states and four journeys: compose, reject invalid details, acknowledge acceptance and start another enquiry. The [model](model.json) defines required subject/message fields and their length limits.

The plain HTML site needs no custom runtime hook. The shared web adapter supplies interactions, and Hegel generates validation inputs.

## Shell scripts

After [repository setup](../../README.md#build-and-run), run from the repository root:

```bash
./demos/feedback/test.sh --headed
./demos/feedback/discover.sh --headed
```

Testing uses the existing model and `run.local.json` with your Jev key. Discovery needs no key and writes a new timestamped draft beside the existing model, with its viewer and captures under `artifact/`. Both scripts accept extra CLI options. The local site is started and stopped automatically; discovery uses a free port. See [the script guide](../README.md#shell-scripts) for overrides.

## Run

After [setup](../../README.md#build-and-run), run from the repository root. Create the local configuration once and set `decision.api_key`:

```bash
cp demos/feedback/run.json.example demos/feedback/run.local.json
```

Edit `decision.api_key` in the new file, then run:

```bash
npm run demo --workspace @testwalker/demo-feedback -- --headed
```

The wrapper uses port 4186 and closes its site and browser afterward. Reports go to `demos/feedback/artifact/`. Defaults cover the full graph and 19 focused input phases.

For two selected inputs, append `--max-input-attempts 2 --no-shrink`. For graph only, append `--input-mode none`.

## Plan, preview and regression checks

```bash
npx --no-install testwalker-web plan --directory demos/feedback
npx --no-install testwalker-web serve --directory demos/feedback/site --port 4186
npm test --workspace @testwalker/demo-feedback
```

Planning and preview need no Jev key. Stop preview before testing on the same port. Regression tests use installed Rust executables. See [scope, reports and replay](../../testwalker-web/docs/testing.md).
