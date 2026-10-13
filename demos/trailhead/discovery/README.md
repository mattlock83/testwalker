# Discover Trailhead

This example explores the local synthetic site with the independent [discovery tool](../../../testwalker-discover/README.md). Discovery uses Crawlee and Playwright without a decision key; it does not run the authored Trailhead regression model.

For the automatic launcher, run `./demos/trailhead/discover.sh --headed` from the repository root. It starts and stops Trailhead's backend and website and saves a new timestamped model. Additional discovery flags override its defaults. The manual commands below are useful when you manage the site or output paths yourself.

## Run

After the repository's Node build, start the site from the repository root in one terminal:

```bash
npx --no-install testwalker-web serve --directory demos/trailhead/site \
  --app demos/trailhead/app.ts --port 4191
```

In another terminal, choose a new output name and collect navigation, controls and empty-form outcomes:

```bash
npx --no-install testwalker-discover discover-url \
  --url http://127.0.0.1:4191/ \
  --output demos/trailhead/trailhead-draft.model.json \
  --depth 10 --max-pages 100 --max-actions 4000 \
  --settle-ms 100 --click-buttons --probe-empty-forms
```

Open the printed `Report:` path under `demos/trailhead/artifact/<timestamped run>/`. The other outputs are the model draft and `.discovery.json` inventory. Current captures include screenshots and JSON network exchanges, without page HTML or DOM snapshot files.

Replay may create multiple synthetic bookings. Stop/restart this preview server to restore its in-memory fixture. Use reset hooks for a real integration with persistent backend state.

## Comparison fixtures

- [reference.json](reference.json) is an independent comparison based on the authored business model.
- [comparison.json](comparison.json) records historical discovery measurements.
- [compare.mjs](compare.mjs) compares an inventory with that reference:

```bash
node demos/trailhead/discovery/compare.mjs \
  demos/trailhead/artifact/RUN/trailhead-draft.discovery.json
```

Replace `RUN` with the discovery run folder printed by the CLI. These are discovery metrics, not test PASS/FAIL or verified GraphWalker coverage. Older local artifacts may have formats different from current capture output; the current tool's [reference](../../../testwalker-discover/docs/discovery.md) is authoritative.

## Review the generated model

The draft records what was observed. It does not infer booking arithmetic, valid/invalid partitions, inventory correctness or refund idempotency. Review deferred/terminal routes, merge or distinguish states as needed, and add independent business constraints before property testing.

The authored [Trailhead model](../model.json) remains the complete runnable demonstration, including explicit backend reset and ledger hooks. Do not substitute observed behavior for its expected rules merely to make tests pass.
