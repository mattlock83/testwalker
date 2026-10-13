# Booking

A workshop website with Home, Workshops, Our studio and Visit navigation. Eight states and 35 journeys cover form entry, rejection, review and confirmation.

The [model](model.json) specifies customer-name length, email format, a 1–4 place limit and AUD 45 per place. The plain HTML site needs no custom runtime hook; the shared web adapter executes the model.

## Run

After [setup](../../README.md#build-and-run), run from the repository root. Create the configuration once and set `decision.api_key`:

```bash
cp demos/booking/run.json.example demos/booking/run.local.json
```

Edit `decision.api_key` in the new file, then run:

```bash
./demos/booking/test.sh --headed
```

The script uses port 4183 and closes its site and browser after execution. Reports go to `demos/booking/artifact/`. Defaults cover the full graph and 50 focused input phases, including form correction from an error state.

For two selected inputs, append `--max-input-attempts 2 --no-shrink`. For graph only, append `--input-mode none`. Use another `--port` if a preview is already running.

## Discover a model draft

Discovery needs no Jev key or Rust executable. After building the Node packages, run from the repository root:

```bash
./demos/booking/discover.sh --headed
```

The script starts and stops the local site automatically, using a free port. It writes a new `discovered-<timestamp>-<pid>.model.json` beside the existing model, with its viewer and captures under `artifact/`. Review the draft before executing it; the existing model is unchanged. Both `test.sh` and `discover.sh` accept CLI options; see [the script guide](../README.md#shell-scripts) for overrides.

## Plan, preview and regression checks

```bash
npx --no-install testwalker-web plan --directory demos/booking
npx --no-install testwalker-web serve --directory demos/booking/site --port 4183
npm test --workspace @testwalker/demo-booking
```

Planning and preview need no Jev key. Stop preview before testing on its port. Regression tests use installed Rust executables and deterministic checks. See [test scope and results](../../testwalker-web/docs/testing.md).
