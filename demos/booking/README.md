# Booking

A workshop website with Home, Workshops, Our studio and Visit navigation. Eight states and 35 journeys cover form entry, rejection, review and confirmation.

The [model](model.json) specifies customer-name length, email format, a 1–4 place limit and AUD 45 per place. The plain HTML site needs no custom runtime hook; the shared web adapter executes the model.

## Shell scripts

After [repository setup](../../README.md#build-and-run), run from the repository root:

```bash
./demos/booking/test.sh --headed
./demos/booking/discover.sh --headed
```

Testing uses the existing model and `run.local.json` with your Jev key. Discovery needs no key and writes a new timestamped draft beside the existing model, with its viewer and captures under `artifact/`. Both scripts accept extra CLI options. The local site is started and stopped automatically; discovery uses a free port. See [the script guide](../README.md#shell-scripts) for overrides.

## Run

After [setup](../../README.md#build-and-run), run from the repository root. Create the configuration once and set `decision.api_key`:

```bash
cp demos/booking/run.json.example demos/booking/run.local.json
```

Edit `decision.api_key` in the new file, then run:

```bash
npm run demo --workspace @testwalker/demo-booking -- --headed
```

The wrapper uses port 4183 and closes its site and browser after execution. Reports go to `demos/booking/artifact/`. Defaults cover the full graph and 50 focused input phases, including form correction from an error state.

For two selected inputs, append `--max-input-attempts 2 --no-shrink`. For graph only, append `--input-mode none`. Use another `--port` if a preview is already running.

## Plan, preview and regression checks

```bash
npx --no-install testwalker-web plan --directory demos/booking
npx --no-install testwalker-web serve --directory demos/booking/site --port 4183
npm test --workspace @testwalker/demo-booking
```

Planning and preview need no Jev key. Stop preview before testing on its port. Regression tests use installed Rust executables and deterministic checks. See [test scope and results](../../testwalker-web/docs/testing.md).
