# Testwalker discover

An independent TypeScript/JavaScript package that explores a website with Crawlee
and Playwright, generates a GraphWalker model draft, and writes a static results
viewer. It has no dependency on `@testwalker/web`, the Rust framework, Jev, or
another decision API. Nothing is published.

## Run locally

Requires Node.js 22+, npm and Google Chrome. From the repository root:

```bash
npm ci
npm run build --workspace @testwalker/discover
npx --no-install testwalker-discover discover-url \
  --url https://www.saucedemo.com/ --output artifacts/sauce.model.json \
  --depth 8 --max-pages 60 --max-actions 1200 --max-state-variants 2 \
  --click-buttons --probe-empty-forms --settle-ms 600 \
  --values demos/saucedemo/discovery/values.json
```

The CLI prints paths to the model, inventory and `artifacts/sauce.discovery/index.html`.
The GraphWalker draft is `sauce.model.json`; the separate observation inventory is
`sauce.discovery.json`. Supplying `--output sauce.json` or `--output sauce` also
writes `sauce.model.json`. Names use unique `v_`/`e_` identifiers without spaces.
Business descriptions and intents keep the full readable text. Vertex coordinates
are saved in `properties.x` and `properties.y` so Studio opens a spaced workflow
layout instead of placing every state at the origin.
Open that HTML directly in your browser. No server, key, CDN or internet connection
is needed to view the results. Keep the report with its screenshots and network
files when moving or sharing it.

For a sitemap, only listed URLs are inspected and no forms are submitted:

```bash
npx --no-install testwalker-discover discover-sitemap \
  --sitemap sitemap.xml --output artifacts/site.model.json
```

## Results viewer

The viewer shows observed states and journeys, visits, failed discovery actions,
deferred actions and configured limits. The default graph groups states by URL;
switch to **Observed states** to inspect variants. Select a node or edge to filter
its evidence. Search and category tabs expose screenshots, replayed routes,
settling diagnostics and JSON request/response previews. Full model, inventory and
network files are linked alongside the details.

Only screenshots and JSON network exchanges are captured; page HTML and DOM
snapshots are not saved. JSON previews are bounded to keep the report manageable:
up to 50 exchanges per visit, 2,000 UTF-8 bytes per body and 2 MiB of body previews
per report. Full network JSON remains in the original capture files. Captures
over 8 MiB are linked without loading inline previews.

Discovery records behaviour for review. It does not decide whether business rules
are correct or execute Hegel tests. Deferred actions describe an observed frontier,
not an inventory of every possible application behaviour.

## View existing or combined discovery runs

No recrawl is needed:

```bash
npx --no-install testwalker-discover report \
  --inventory demos/artifacts/discovery-saucedemo/regenerated-2026-10-12-explore.discovery.json \
  --inventory demos/artifacts/discovery-saucedemo/regenerated-2026-10-12-workflow.discovery.json \
  --model demos/saucedemo/model.json \
  --output demos/artifacts/discovery-saucedemo/overview/index.html
```

Repeated `--inventory` arguments combine runs sharing the same seeds. Without
`--model`, the report builds a draft from the supplied observations. Output paths
must be new; discovery and report generation never overwrite existing files.

## Configuration and hooks

`--browser-config browser.json` accepts independent Playwright Chromium settings:

```json
{
  "launch": { "channel": "chrome" },
  "context": { "viewport": { "width": 1280, "height": 900 }, "ignoreHTTPSErrors": false }
}
```

Discovery owns its browser and does not attach to CDP. Tune settling with
`--settle-ms` and `--timeout-ms`, and observe the run with `--headed`.

Public exports include `discoverUrl`, `discoverUrls`, `discoverSitemap`, `buildModel`,
`writeDiscoveryReport`, `DiscoveryContext`, `DiscoveryOptions`, `DiscoveryError`
and `BrowserSettings`. Hooks are explicitly loaded JS/TS modules with
`before_visit`, `after_visit`, `before_submit` and `after_submit` functions.
[Detailed discovery options and examples](docs/discovery.md).

The generated models are inputs to GraphWalker or the separate Testwalker
framework after review. No selectors or executable code are written into them.

## Development

```bash
npm run check --workspace @testwalker/discover
npm test --workspace @testwalker/discover
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/discover
```

Tests and fixtures are entirely within this package and require no framework
executable or decision key.
