# Testwalker discovery

Discovery explores a website with Crawlee and Playwright, then writes a GraphWalker model draft and an HTML results viewer. It is a separate package and needs neither the Rust framework nor a Jev key.

The output records observed behavior. Review the navigation and add independent business rules before treating it as a test specification.

## Setup and first run

Requires Node.js 22 or later, npm and Google Chrome. From the repository root:

```bash
npm ci
npm run build --workspace @testwalker/discover
```

To explore an already hosted site, replace the URL below with its address:

```bash
npx --no-install testwalker-discover discover-url \
  --url https://your-test-site.example/ --output models/site.model.json \
  --depth 1 --headed
```

For a working local example, build the web package to host Hello World, then run its discovery script:

```bash
npm run build --workspace @testwalker/web
./demos/hello-world/discover.sh --headed
```

The script starts the site on a free port, explores it, saves a timestamped model draft and closes the server. It also explores buttons and empty form submissions. No separate server terminal or Rust build is needed. The web package only hosts this example; discovery itself has no web-adapter dependency.

For direct CLI commands, choose a new output name for each run; existing output files are not overwritten. Demo scripts choose a new timestamped filename automatically.

## Output

With `--output models/hello-world.model.json`, the tool writes:

```text
models/
  hello-world.model.json
  artifact/
    2026-10-13T02-19-25.969Z-49708-0/
      hello-world.discovery.json
      index.html
      visit-0001/
        screenshot.png
        network.json
      visit-0002/
        ...
```

The model stays at the requested path. The inventory, viewer and visit assets share a run folder under `artifact/` beside that model. Run names use a UTC timestamp, process ID and sequence number to avoid collisions. Asset files are created when capture is enabled and available. The CLI prints the exact model, inventory and report paths.

A stem or `.json` output name is normalized to `.model.json`. The model and inventory are different files; supply the model to Testwalker after review.

Open `index.html` directly in a browser. It shows URL-grouped or observed-state graphs, visits, screenshots, issues and JSON request/response previews. Keep the model and its `artifact/` run folder together when sharing them. Page HTML and DOM snapshots are not saved.

## Sitemap mode

```bash
npx --no-install testwalker-discover discover-sitemap \
  --sitemap /path/to/sitemap.xml --output models/site.model.json
```

The input is a local XML `urlset` file. Expand sitemap indexes separately. All listed URLs must share an origin. Sitemap mode inspects only those URLs, follows no unlisted links and submits no forms. If the site has no sitemap, use URL mode.

## Exploration options

URL mode follows in-scope links and submits native forms within `--depth`, default 1. Add `--click-buttons` to explore non-submit buttons and accessible custom options. Add `--probe-empty-forms` to observe rejection screens beside default submissions. These actions can change application data; use a suitable test environment.

Field samples come from observed values and HTML attributes where available, with defaults and optional `--values` overrides. Discovery records constraints as suggestions, not independent validation rules or Hegel campaigns. See [options, values and hooks](docs/discovery.md).

Discovery can leave terminal or deferred states. A draft therefore may not support a complete GraphWalker traversal until reviewed. A successful crawl does not mean the generated model is complete or the website passed tests.

## Rebuild a viewer without crawling

```bash
npx --no-install testwalker-discover report \
  --inventory models/artifact/RUN/hello-world.discovery.json \
  --model models/hello-world.model.json \
  --output models/artifact/RUN/rebuilt/index.html
```

Replace `RUN` with the timestamped folder printed by discovery. Omitting `--output` places the viewer beside the first inventory; choose a new filename to rebuild an existing viewer. Repeat `--inventory` to combine runs with the same seeds. Without `--model`, the viewer builds a draft from the supplied observations. The output must be new.

## Configuration and development

`--browser-config` accepts discovery's own Playwright `launch` and `context` settings. Execution-adapter settings such as uploads, CDP and settling keys are not accepted in that file; discovery has separate CLI settling flags. See the [reference](docs/discovery.md#browser-and-evidence-options).

The public API includes `discoverUrl`, `discoverUrls`, `discoverSitemap`, `buildModel` and `writeDiscoveryReport`; all exports are in [src/index.ts](src/index.ts). Explicit JS/TS hooks support visit and form setup.

```bash
npm run check --workspace @testwalker/discover
npm test --workspace @testwalker/discover
TESTWALKER_BROWSER_TESTS=1 npm test --workspace @testwalker/discover
```

These regression tests need no framework executable or decision key. The opt-in browser tests need Chrome.
