# Trailhead

A synthetic travel centre with **20 states, 148 journeys and three business data sets**: browse adventures/equipment/policies, manage a member profile, review/confirm a booking, and cancel it for a full refund. No real payments or customer records are involved.

The [model](model.json) is the business specification, with no selectors, scripts or page objects. The TypeScript [backend](app.ts) serves the demo, and explicitly loaded [hooks](hooks.ts) supply custom controls and independent ledger assertions.

## Run

From the repository root after the [build/setup](../../README.md#build-and-run), with `decision.api_key` set in `demos/trailhead/run.local.json`:

```bash
# A short scenario: 14 distinct journeys, plus two focused property inputs
npx --no-install testwalker-web demo --directory demos/trailhead \
  --app demos/trailhead/app.ts --hooks demos/trailhead/hooks.ts --port 4184 --headed \
  --generator predefined_path --edge-coverage 0 --state-coverage 0 \
  --max-input-attempts 2 --no-shrink --max-calls 1000
```

It selects the Marina pickup, rejects/corrects oversized party input, reviews/confirms a booking, rejects/corrects cancellation input, refunds it, then rejects/corrects a profile email. Zero coverage targets allow that deliberately short route; a pass does not claim all 148 edges.

```bash
# Full graph, just two broader generated inputs
npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --generator new_york_street_sweeper --edge-coverage 100 --state-coverage 100 --max-steps 1000 \
  --input-mode generated --cases 1 --max-input-attempts 2 --no-shrink --max-calls 4000
# Full graph and default focused Hegel partitions
npm run demo --workspace @testwalker/demo-trailhead -- --headed --max-calls 10000
```

Focused mode offers 186 phases across seven source-state campaigns. `--cases` is per generated phase. All calls, including browser actions, are accounted for by Rust. Confidence defaults to 0.80. An uncertain Jev verdict stays INCONCLUSIVE for human review; an exact hook contradiction is FAIL. See [scope and triage](../../testwalker-web/docs/testing.md).

## How the custom hook is called

```mermaid
sequenceDiagram
  participant R as Rust framework
  participant A as TypeScript adapter
  participant H as Trailhead hooks.ts
  participant P as Playwright / website
  R->>A: target.hook(before_reset)
  A->>H: await before_reset(context)
  H->>P: Reset synthetic backend ledger
  R->>A: target.hook(before_transition)
  A->>H: await before_transition(context)
  H->>P: Open pickup widget and click shadow-DOM option
  R->>A: target.execute(intent)
  A->>P: Observe already completed hook destination
  R->>A: target.observe / target.evaluate
  A->>R: Nested decision.ask for independent Jev checks
  R->>A: target.hook(after_state)
  A->>H: await after_state(context)
  H->>P: Check backend inventory / charge / refund
  H-->>R: Success, or typed defect through adapter
  R->>R: Credit verified coverage; write results
```

The pickup code operates the actual widget; it does not directly alter business state. It handles `choose_marina_pickup` and `choose_city_pickup`. Their selectors live only in the loaded hook. The adapter independently checks the destination before deciding whether further browser action is needed.

`before_reset` restores fixtures for each walk and property attempt. `after_state` checks that review/rejection has no ledger side effects, confirmation creates one booking and reserves exactly the requested places, and cancellation creates one full refund and releases inventory. Gift rounding is independently asserted using exact decimal half-up cents. Grouped graph journeys share state; property attempts use fresh browser contexts plus reset/setup paths.

The hooks write `trailhead-hook-audit.json` alongside framework reports. They import only `@testwalker/web`, not another example or Rust source. The backend has its own in-memory ledger per server instance.

## Demonstrate a hidden backend bug

The page can claim success while these exact assertions catch missing inventory or duplicate refunds:

```bash
TRAILHEAD_DEMO_BUG=inventory npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --generator predefined_path --edge-coverage 0 --state-coverage 0 --input-mode none --max-calls 1000
TRAILHEAD_DEMO_BUG=refund npm run demo --workspace @testwalker/demo-trailhead -- --headed \
  --generator predefined_path --edge-coverage 0 --state-coverage 0 --input-mode none --max-calls 1000
```

Remove the environment prefix for the healthy backend. For preview without Jev:

```bash
npx --no-install testwalker-web serve --directory demos/trailhead/site --app demos/trailhead/app.ts --port 4184
```

## Regression checks

```bash
export PATH="$PWD/core/target/release:$PATH"
npm test --workspace @testwalker/demo-trailhead
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/demo-trailhead
```

These checks use Hegel through the public Rust RPC interface, fixture HTTP calls, deterministic hook assertions, injected defects, and optional real Chrome widget/validation evidence. No Jev key is required for regression tests. Model-driven runs above do require a key. The adapter's package contains no Trailhead code or assets.

The TypeScript adapter passed three full live Jev runs at 0.80 confidence with seeds 42, 43 and 44: all 148 edges and 20 states, two generated Hegel input attempts, all five global rules, and the backend/picker hooks. They used 888, 875 and 892 decision calls respectively with `new_york_street_sweeper`, `--cases 1 --max-input-attempts 2 --no-shrink`. This verifies the full graph with two selected property inputs; it does not claim all available property phases. See the [repeated verification results](../README.md#repeated-live-verification). The short scenario above also passed with 14 edges and two focused input attempts.
