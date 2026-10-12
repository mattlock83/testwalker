# SauceDemo discovery comparison

Discovery visits the live https://www.saucedemo.com/ application using Crawlee
and Playwright. It does not clone application source, call Jev/AI, or use custom
navigation hooks. `values.json` supplies the published demo credentials and
synthetic customer details. The checkout requests names and postcode, not card
details.

The checked-in [`../model.json`](../model.json) was regenerated on 12 October
2026 using only the improved discovery tool. It contains **63 observed states
and 135 journeys**, up from the earlier baseline of 40 states and 94 journeys.
It remains an observed draft requiring independent business rules and review.
[`summary.json`](summary.json) records this regeneration; [`comparison.json`](comparison.json)
retains the earlier exploration results. Detailed inventories and screenshots
are in ignored `demos/artifacts/discovery-saucedemo/`.

## Latest regeneration

| Pass | States | Executed transitions | Visits | Replay operations | Failures |
| --- | --- | --- | --- | --- | --- |
| Broad menus, sorting and cart exploration | 60 | 118 | 119 | 479 | 0 |
| Focused checkout and empty-form validation | 17 | 47 | 48 | 204 | 0 |

The union deduplicates observed states and journeys; counts from the passes
cannot simply be added. It includes all four sort choices, all six product
pages, the cart, checkout information/rejection, order review, completion and
PDF generation. Both passes had zero capture errors. All 167 visits have
screenshots and JSON-only network evidence; no HTML or DOM files were captured.
The combined model validated through the existing Rust JSON-RPC API.

The broad pass reached its 60-state limit. It lists 141 actions deferred by the
state budget, 532 by variant sampling and 36 covered controls. The focused pass
exhausted its queue with 45 explicitly excluded controls and 30 variant-limited
actions. These are per-run observed frontiers, not missing test counts for the
combined graph. This is bounded discovery, not complete application coverage.
The summary groups pending reasons; each linked inventory retains action details.

## Repeat the improved discovery

From the repository root, build the adapter:

```bash
npm run build
```

Repeat the broad regeneration pass:

```bash
npx --no-install testwalker-discover discover-url \
  --url https://www.saucedemo.com/ \
  --output demos/artifacts/discovery-saucedemo/repeat-explore.model.json \
  --depth 8 --max-pages 60 --max-actions 1200 --max-state-variants 2 \
  --settle-ms 600 --timeout-ms 10000 --click-buttons --probe-empty-forms \
  --values demos/saucedemo/discovery/values.json
```

Or explore menus and sorting with a smaller sampling budget:

```bash
npx --no-install testwalker-discover discover-url \
  --url https://www.saucedemo.com/ \
  --output demos/artifacts/discovery-saucedemo/repeat-menu.model.json \
  --depth 3 --max-pages 40 --max-actions 180 --max-state-variants 1 \
  --settle-ms 400 --timeout-ms 10000 --click-buttons \
  --exclude-buttons 'Add to cart' \
  --values demos/saucedemo/discovery/values.json
```

Focus on the checkout chain and rejection screens:

```bash
npx --no-install testwalker-discover discover-url \
  --url https://www.saucedemo.com/ \
  --output demos/artifacts/discovery-saucedemo/repeat-workflow.model.json \
  --depth 8 --max-pages 40 --max-actions 400 --max-state-variants 1 \
  --settle-ms 600 --timeout-ms 10000 --click-buttons --probe-empty-forms \
  --exclude-buttons 'Add to cart,Open Menu' \
  --values demos/saucedemo/discovery/values.json
```

Choose new output names each time. Add `--headed` to watch. For cart combinations,
remove `Add to cart` from the exclusions and raise `--max-state-variants` and the
action budget. Defaults sample four structural variants per state family;
limits preserve incoming observations and explicitly list deferred outgoing
actions. They do not prove that cart contents are equivalent.

Each branch starts in a fresh context and replays its login/earlier actions.
This can repeat demo purchases. Discovery stays on the seed origin and blocks
external navigation/data writes. Published passwords are absent from generated
journey prose; configure authentication before executing a reviewed graph.

To combine inventories from the same implementation into a separate draft:

```bash
node demos/saucedemo/discovery/combine.mjs \
  demos/artifacts/discovery-saucedemo/repeat-model.json \
  demos/artifacts/discovery-saucedemo/repeat-summary.json \
  demos/artifacts/discovery-saucedemo/repeat-explore.discovery.json \
  demos/artifacts/discovery-saucedemo/repeat-workflow.discovery.json
```

The helper uses the framework model builder to union only observed states and
journeys. It does not author business rules or visit the site.

## Learnings applied to the generic explorer

- Explore each enabled submit control and replay the selected one. Choosing the
  first control previously explored Cancel but missed Continue.
- Respect hidden, inert and aria-hidden ancestors, preserving DOM positions for
  faithful replay after filtering.
- Check click exposure, fixed overlays and native scrolling/actionability before
  clicking. Covered controls are deferred with evidence; menu controls can still
  be explored. Native trial clicks do not dispatch an interaction.
- Explore enabled native select options outside forms. Record the selected
  value as a distinct state and a plain-language rule. Disabled option groups
  are skipped. Sorting order alone does not create a new expansion family.
- Wait for a quiet structural UI, tracked requests and explicit busy indicators,
  bounded by a timeout. Replay waits for the expected source before acting.
- Prioritize forms and avoid duplicate label/destination links and anchor/button
  representations. Sample repetitive families without deleting their observed
  states or incoming journeys.
- Prefer headings or prominent visible text for names, giving Products,
  Your Cart and product names rather than calling every state Swag Labs.
- Record every known candidate action and its status. `pending` distinguishes
  budget, depth, variant, exclusion and coverage limits. Failed/unsettled visits
  keep route, error, diagnostics and artifacts.

These changes contain no SauceDemo selectors, labels or business rules. Crawlee
still owns the queue and browser lifecycle. Rust was unchanged.

## Earlier follow-up results

[`comparison.json`](comparison.json) records exact counts, reasons, evidence
paths and native model validation. Runs used different focuses/budgets, so the
counts are coverage observations, not a performance benchmark.

The smaller menu passes exercised all four sorting choices and opened menus
without action failures. The extended final pass also executed a real menu close
journey, but retained three unresolved replays: the expected open menu was closed
when the next action was due. Those failed attempts retain expected/observed
controls and visit evidence for review; they are not application failure verdicts. The workflow pass reached checkout information,
missing-first-name validation, review, confirmation and PDF generation with no
action failures. Its PDF journey returned to the stable Generate PDF order
control; the transient Generating... screen was not emitted as a graph state.
A smaller final run checks explicit state-variant deferral on the finished code.

An intermediate broad run exposed the off-screen menu interception problem;
its failed visits are retained for comparison. Another intermediate run caught
viewport exposure leaking into logical state identity; those properties are now
separate so scrolling alone does not change the logical state. Neither
intermediate run is presented as complete coverage.

## Remaining limits

- These are bounded discovery runs: unknown pages and hypothetical future
  combinations are not enumerated. Earlier extended-menu runs retained three
  source-state replay failures; neither new regeneration pass reproduced them.
  Check every `pending` reason before deciding what to explore next.
- The account is `standard_user`; other accounts and all invalid credential
  combinations remain outside these runs.
- Unmarked delayed work may need a longer quiet window or a hook. Closed shadow
  roots, iframes, drag/drop and unlabelled bespoke widgets require custom handling.
- Empty-input probes observe rejection screens; they are not Hegel campaigns.
  HTML `required: false` does not prove a field is optional when JavaScript
  performs validation.
- Authentication, sorting correctness, cart totals and order/refund rules need
  independent expectations. The focused checkout can complete an empty-cart
  order; observing that is not a verdict on whether it should be allowed.
- State grouping and variant sampling are heuristics. Review data-dependent
  states and raise limits where combinations matter.
