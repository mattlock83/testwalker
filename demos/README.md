# Demo applications

Each example supplies its own website, GraphWalker business model, browser configuration and TypeScript regression tests. Only Trailhead needs runtime application code. They consume the Rust framework and shared [@testwalker/web adapter](../testwalker-web/README.md).

| Demo | Features | Application code | Wrapper port |
| --- | --- | --- | --- |
| [Hello World](hello-world/README.md) | Two navigation options, one required Name input | None | 4185 |
| [Booking](booking/README.md) | Four menu pages, review/confirmation, name/email/places | None | 4183 |
| [Feedback](feedback/README.md) | Enquiry acceptance/rejection and length boundaries | None | 4186 |
| [Trailhead](trailhead/README.md) | 148 journeys, profiles, booking/refund ledger, custom pickup | `app.ts`, `hooks.ts` | 4184 |

## Setup and CLI

Build Rust and install/build Node as described in the [root guide](../README.md#build-and-run). Put `core/target/release` on PATH or supply `--framework PATH`. Copy a demo's `run.json.example` to its ignored `run.local.json`, then set `decision.api_key` to your Jev key. Existing native run JSON files remain usable; old Python properties files are no longer used. Browser settings are in `browser.json`.

```bash
npx --no-install testwalker-web demo --directory demos/booking --port 4183 --headed
npx --no-install testwalker-web demo --directory demos/feedback --port 4186 --headed
npx --no-install testwalker-web demo --directory demos/hello-world --port 4185 --headed
```

The CLI starts/stops the local website and passes provider configuration to Rust through stdin. Reports go to `demos/artifacts/DEMO/`; Rust owns all HTML/JSON/JUnit/replay output. The browser closes on completion. Defaults use 100% graph coverage, focused Hegel inputs and confidence 0.80. The larger model uses a larger configured route budget.

Convenient npm scripts select each demo's port and optional extensions:

```bash
npm run demo --workspace @testwalker/demo-booking -- --headed --max-input-attempts 2 --no-shrink
npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --generator predefined_path --edge-coverage 0 --state-coverage 0 \
  --max-input-attempts 2 --no-shrink --max-calls 1000
```

These scripts are tiny launch conveniences; users can invoke the Node CLI or Rust CLI directly. Bash is needed only for those wrappers, not for the adapter.

## Choose scope and replay

`--max-input-attempts 2` selects two property attempts; excluded phases are outside scope. `--input-mode generated --cases 1` samples broad per-field/combined domains instead of focused constraint partitions. `--input-mode none` disables separate campaigns while keeping form journeys on the graph. `--max-calls` limits all Jev calls, including navigation/setup/assertions. `--threshold` overrides 0.80. Full coverage is measured from verified states/edges, not merely planned visits.

```bash
# No key, browser or server needed for planning:
npx --no-install testwalker-web plan --model demos/booking/model.json \
  --config demos/booking/run.json.example
# Replay with the effective model and recipe saved in a report:
npx --no-install testwalker-web demo --directory demos/trailhead \
  --app demos/trailhead/app.ts --hooks demos/trailhead/hooks.ts \
  --model /path/to/report/model.json --replay /path/to/report/replays/case.json --headed
```

Omit exploration overrides during replay. See [the testing guide](../testwalker-web/docs/testing.md) for counting, confidence, outcomes and triage.

## Hooks and preview

Rust triggers lifecycle hooks over JSON-RPC. The TypeScript adapter invokes explicitly supplied JS/TS exports. Trailhead resets fixtures before each case, operates its real bespoke pickup list before two transitions, and checks persisted bookings, inventory and refunds after successful UI states. Jev still verifies the destination. See [the walkthrough](trailhead/README.md#how-the-custom-hook-is-called).

```bash
npx --no-install testwalker-web serve --directory demos/booking/site --port 4183
npx --no-install testwalker-web serve --directory demos/trailhead/site \
  --app demos/trailhead/app.ts --port 4184
```

Preview and [standalone discovery](../testwalker-discover/README.md) need no Jev key. Run regression checks with `npm test`, or `npm test --workspace @testwalker/demo-trailhead`. Set `TESTWALKER_BROWSER_TESTS=1` to include local Chrome checks. Tests stay under the owning example's `tests/`; shared launcher checks live in `demos/tests/`.

## Repeated live verification

On 11 October 2026, the direct Playwright/Jev executor passed three live Chrome runs of each demo, with seeds 42, 43 and 44 and confidence 0.80. Every run used `new_york_street_sweeper`, 100% edge/state coverage, `--max-steps 2000 --cases 1 --no-shrink`. These checks cover the full graphs with a small selected property scope, not every Hegel phase.

| Demo | Passed runs | Verified edges / states per run | Property attempts per run | Jev calls per run |
| --- | --- | --- | --- | --- |
| Hello World | 3 / 3 | 8 / 4 | 6 focused | 31 |
| Booking | 3 / 3 | 35 / 8 | 6 focused | 72–75 |
| Feedback | 3 / 3 | 4 / 3 | 6 focused | 23 |
| Trailhead | 3 / 3 | 148 / 20 | 2 generated | 420–432 |

Reports, screenshots and replay recipes remain in the ignored `demos/artifacts/` directory. The combined index at `direct-playwright-confirmed-20261011/summary.json` lists the twelve passing report directories and executor digests. Booking was repeated after correcting equivalent Home links that reload the current URL; the other demos passed before that correction. The test browsers and temporary servers closed at completion.

The twelve reports contain 1,389 passed tests, 60 Hegel attempts and 1,389 valid screenshots. Their 1,401 JUnit cases include twelve run outcomes, with zero failures, errors or skips.

### Trailhead performance comparison

A fresh PlayJev baseline and the direct executor both passed the same seed-42 route: 148 edges, 20 states, two generated property attempts and 355 reported tests.

| Measurement | PlayJev baseline | Direct Playwright/Jev |
| --- | --- | --- |
| End-to-end elapsed time | 444.4 s | 211.0 s |
| Jev calls | 881 | 425 |
| JSON report size | 35.9 MB | 25.4 MB |

This was about **2.1 times faster with 52% fewer calls** in one local comparison; API latency and website behaviour affect other runs. The independent report comparison confirmed identical planned paths, test inputs and hook results, all five global rules verified, 355 screenshots per run and no JUnit failures, errors or skips. Rust and the 0.80 confidence threshold were unchanged. The baseline and replacement reports are indexed under `direct-playwright-baseline-20261011/` and `direct-playwright-ranked-20261011/` respectively.
