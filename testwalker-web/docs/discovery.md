# Discover a draft model

JavaScript Crawlee owns the queue, browser lifecycle and navigation. Discovery uses Playwright inspection and native form interaction, without Jev, an LLM, or the Rust executable. It produces a draft to review, not an inferred business specification.

Start the demo website:

```bash
npx --no-install testwalker-web serve --directory demos/booking/site --port 4183
```

In another terminal, visit the entry page and follow links/submit forms one layer deep:

```bash
npx --no-install testwalker-web discover-url --url http://127.0.0.1:4183/ \
  --output discovered-booking.json --depth 1 --headed
```

The URL mode stays on the seed's origin, applies the depth limit, and uses default field values. It inventories buttons and custom widgets without blindly clicking them. It submits each discovered form once per queued exploration; failed requests are not retried because submission may already have occurred. Nested form outcomes replay the prior submission route. Fixture resets and non-idempotent applications require suitable discovery hooks.

For a supplied sitemap:

```bash
npx --no-install testwalker-web discover-sitemap --sitemap /path/to/sitemap.xml \
  --output discovered-site.json --headed
```

Only listed URLs are visited; links outside the list are never followed and forms are not submitted. Supply a `urlset` XML file, expanding sitemap indexes separately. All seed URLs must share an origin. Redirects are checked against the same scope. Normal page assets may be loaded; external data requests/writes are blocked. A URL mode depth of zero also avoids following links and submitting forms.

## Captured evidence

Beside `discovered-site.json`, discovery writes `discovered-site.discovery.json` (inventory) and `discovered-site.discovery/` (visit artifacts):

| Artifact | Contents |
| --- | --- |
| `screenshot.png` | Full-page rendered screenshot. |
| `page.html` | Current serialized HTML. |
| `dom.json` | Chromium DOM snapshot, including live form values, shadow DOM and layout. |
| `network.json` | Called URLs/methods/status/timing and JSON request/response bodies. |

JSON capture is limited to 1 MiB per body and 1,000 requests per visit by default. Non-JSON bodies are not saved. Oversize, unavailable, failed or incomplete requests are explicitly marked. Streaming or unconsumed bodies may remain incomplete. Capture errors are recorded without pretending an artifact exists. These captures do not perform accessibility checks.

`--no-screenshots`, `--no-dom`, `--no-network`, `--max-json-bytes`, and `--max-network-requests` tune evidence. `--max-pages` defaults to 50, `--max-actions` to 200 (navigation plus replayed submissions), `--timeout-ms` to 10,000 and `--settle-ms` to 300. Output files must not already exist.

## Values and custom calls

`--values values.json` supports global and page-specific overrides:

```json
{
  "defaults": {"Email address": "alex@example.test"},
  "pages": {"http://localhost:3000/enquiry": {"Subject": "A sample enquiry"}}
}
```

Keys match field names; use labels for unnamed fields. Checkbox values must be booleans. Radio values name the selected option. Custom handling can be supplied with `--hooks discovery-hooks.ts`:

```ts
import type {DiscoveryContext} from '@testwalker/web';

export async function before_submit(ctx: DiscoveryContext) {
  ctx.values['Email address'] = 'specific@example.test';
  // Set ctx.skip = true to avoid submission, or perform a custom operation
  // and set ctx.handled = true to replace the default fill/submit operation.
}
```

Supported events are `before_visit`, `after_visit`, `before_submit`, `after_submit`. Context supplies `page`, `url`, `form`, `values`, `snapshot` where applicable, shared `scratch`, `skip` and `handled`. Visit hooks can perform explicit browser/API setup; `skip`/`handled` control form submission. Hooks are trusted JavaScript/TypeScript and must be explicitly loaded.

Public functions `discoverUrl(url, options)` and `discoverSitemap(path, options)` allow a separate authoring tool to invoke discovery. Increase `depth` for bounded recursive URL exploration. Review unreachable states/dead ends reported in the inventory, merge/refine states, define data sets and add independent business rules in GraphWalker before running the model. No UI selectors or executable code are emitted into the graph.
