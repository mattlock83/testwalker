# Trailhead discovery comparison

`reference.json` is an independent reference based on the existing authored Trailhead model, with 20 workflow states, 148 directed state-pairs and three business data sets. The catalogue, adventure information, booking form/review, pickup widget, member form and validation were reviewed in the browser. Booking/cancellation requirements retain the authored specification, and the full discovery runs exercised those flows with disposable synthetic bookings. This reference is deliberately separate from the generated observations; automatically copying observed behaviour into expected rules would hide bugs.

The runs use only Crawlee/Playwright discovery. No Jev, AI, or Trailhead-specific discovery hooks drive them. `comparison.json` records the gaps, failures and reference hash. The detailed models, screenshots, HTML, DOM and network payloads are in ignored `demos/artifacts/discovery-trailhead/`.

| Run                                     | Reference states reached | Reference state-pairs actually executed | Discovery failures |
| --------------------------------------- | ------------------------ | --------------------------------------- | ------------------ |
| Baseline, before changes                | 11/20                    | 10/148                                  | 1                  |
| Full-route replay and settling          | 12/20                    | 81/148                                  | 0                  |
| Buttons, shadow options and empty forms | 15/20                    | 106/148                                 | 0                  |
| Full booking and cancellation flows     | 20/20                    | 146/148                                 | 0                  |
| Remembered form examples for correction | 20/20                    | 148/148                                 | 0                  |
| Final isolated-context/lifecycle repeat | 20/20                    | 148/148                                 | 0                  |

These counts are comparison metrics, not passing tests or GraphWalker coverage. The baseline reported 118 transitions, but only 11 were executed: others were inferred from link URLs. The updated tool requires executed visit evidence. Multiple observed states can map to one business state (e.g. the same form with its popup opened or different errors); the final run has 24 observed states and 239 executed transitions across 240 visits (1,058 navigation/replay operations), with zero capture errors. It inventories all three forms and exits normally with status 0.

The earlier controls-only run excluded booking/cancellation confirmation. Subsequent full runs include all synthetic demo flows. The full run reached every reference state but initially missed correcting rejected booking/profile forms. Those screens clear text inputs whose numeric/choice constraints exist only in prose. A generic cache of initial examples (grouped by editable field names, labels and types) closed both gaps, without interpreting hints as business rules.

## Repeat the comparison

From the repository root, start the website in a separate terminal:

```bash
npx --no-install testwalker-web serve --directory demos/trailhead/site \
  --app demos/trailhead/app.ts --port 4191
```

Run discovery (choose a fresh output filename):

```bash
npx --no-install testwalker-discover discover-url --url http://127.0.0.1:4191/ \
  --output demos/artifacts/discovery-trailhead/repeat.model.json \
  --depth 10 --max-pages 100 --max-actions 4000 --settle-ms 100 \
  --click-buttons --probe-empty-forms

node demos/trailhead/discovery/compare.mjs \
  demos/artifacts/discovery-trailhead/repeat.discovery.json
```

These commands exercise all synthetic demo workflows. Full-route replay creates multiple disposable bookings. Stop/restart the demo server to restore its in-memory fixtures. On another site, supply appropriate values or setup hooks and review confirmation side effects before enabling button/form exploration.

## Gaps addressed

- Wait for initial rendering and settle after each replayed action.
- Replay prior links, buttons and form submissions before the next action. Opening a URL alone loses client-side booking state.
- Explore non-submit buttons with explicit opt-in, including nested open shadow-root options. Exclude specific buttons by their exact visible labels.
- Probe an empty form beside the default submission to discover rejection screens.
- Restore initial form examples after rejection screens clear prefilled inputs, while honoring explicit overrides.
- Handle native boolean checkboxes, radio selections, selects and fieldsets.
- Group states structurally so changing booking references and rendered values do not create a new state for every replay.
- Save field help text, HTML constraints and grouped `suggested_data_sets`. Sample form data stays in journey descriptions; selectors and executable code stay outside the model.
- Report executed journeys instead of inventing outcomes from href destinations.
- Replay each queued branch in its own browser context and apply configured context settings.
- Release browser, event-manager and queue resources after repeated discovery calls; avoid unrequested proxy tunnels that keep the CLI alive. Explicitly configured proxies remain supported.

## What still needs a person

Discovery captures observable navigation and provisional input metadata. It cannot infer conservation-gift arithmetic, refund idempotency, backend inventory correctness, intentional valid/invalid partitions, or which errors mean acceptance/rejection. Trailhead describes most input constraints in prose rather than HTML attributes. The inventory preserves those hints; it does not silently convert them into formal requirements. Review them in GraphWalker and add independent rules and data sets before using Hegel campaigns.

The existing model remains the runnable demo. This reference is a comparison fixture, and the generated drafts are seeds for review. Discovery does not certify a site or replace framework execution.

## Validation

The existing regression suite passed (84 passed, 18 opt-in browser tests skipped). The eight focused discovery checks passed with browser testing enabled, including shadow options, route replay, associated submit controls, empty probes, button exclusions, read-only mode, sitemap scope, native form controls, context configuration and rejected-form recovery. Type checking and diff checks passed. The reference and the generated models validated through the existing Rust JSON-RPC API; the reference graph also planned successfully. No Rust source was changed.

The final generated draft is `demos/artifacts/discovery-trailhead/final.json`; its inventory is `final.discovery.json` and captures are under `final.discovery/`. These local evidence files are ignored by Git. The frozen reference and comparison summary are tracked. No Jev calls were needed.
