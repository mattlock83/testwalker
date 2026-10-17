# Discover Sauce Demo

The independent [web-discover tool](https://github.com/mattlock83/web-discover) can explore the external demo site with synthetic input values, without Jev or Rust. Commands run from the repository root after the Node build.

For the automatic launcher, run `./demos/saucedemo/discover.sh --headed` from the repository root. It loads the included synthetic values and explores the hosted site and saves a new timestamped model. Additional discovery flags override its defaults. The manual commands below are useful when you manage the site or output paths yourself.

## Collect a draft

The included [values.json](values.json) supplies the demo login and synthetic checkout names/postcode:

```bash
npx --no-install web-discover discover-url \
  --url https://www.saucedemo.com/ \
  --output demos/saucedemo/sauce-draft.model.json \
  --values demos/saucedemo/discovery/values.json \
  --depth 8 --max-pages 60 --max-actions 1200 \
  --max-state-variants 2 --settle-ms 600 \
  --click-buttons --probe-empty-forms
```

Use a new output name on each run. Add `--headed` to watch. Open the printed `Report:` path under `demos/saucedemo/artifact/<timestamped run>/` to inspect visits, screenshots, JSON network exchanges, failures and deferred actions.

This command can perform synthetic demo checkout and replay earlier submissions. It inventories observed behavior; it does not classify business outcomes as PASS/FAIL or add Hegel campaigns.

For a smaller menu/sorting sample, reduce depth and exclude item-addition buttons:

```bash
npx --no-install web-discover discover-url \
  --url https://www.saucedemo.com/ \
  --output demos/saucedemo/sauce-menu.model.json \
  --values demos/saucedemo/discovery/values.json \
  --depth 3 --max-pages 40 --max-actions 200 \
  --click-buttons --exclude-buttons 'Add to cart'
```

## Combine observations

The viewer can combine inventories with identical seed lists. Replace `DRAFT_RUN` and `MENU_RUN` with the timestamped run folders printed by discovery:

```bash
npx --no-install web-discover report \
  --inventory demos/saucedemo/artifact/DRAFT_RUN/sauce-draft.discovery.json \
  --inventory demos/saucedemo/artifact/MENU_RUN/sauce-menu.discovery.json \
  --output artifacts/sauce-overview/index.html
```

The included [combine.mjs](combine.mjs) is a demo helper that combines inventories into one draft and summary, without authoring new rules:

```bash
node demos/saucedemo/discovery/combine.mjs \
  artifacts/sauce-combined.model.json artifacts/sauce-combined-summary.json \
  demos/saucedemo/artifact/DRAFT_RUN/sauce-draft.discovery.json demos/saucedemo/artifact/MENU_RUN/sauce-menu.discovery.json
```

All outputs must be new. These commands require your own collected inventories; generated report bundles are not checked into the repository.

## Review before execution

The checked-in [model](../model.json) is a previous discovery draft with 63 states and 135 journeys. It contains terminal states and ambiguous actions, so it is not a complete regression model. See [the execution guide](../README.md) for its current limitations and configuration.

Review state distinctions, outgoing routes, acceptance/rejection states and independent business rules before expecting full graph execution. Fixed observed inputs are replay examples, not validation specifications. Add reviewed data sets to enable Hegel campaigns.

[comparison.json](comparison.json) and [summary.json](summary.json) retain historical collection records. Their artifact paths refer to ignored local runs, not files required by a fresh checkout. The discovery package's [reference](https://github.com/mattlock83/web-discover/blob/main/docs/discovery.md) describes current behavior and limits.
