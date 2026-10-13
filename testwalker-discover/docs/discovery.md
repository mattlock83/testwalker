# Discovery reference

Start with [the package guide](../README.md) for setup and a local example. Commands below run from the repository root.

## Output location

`--output` selects the generated model file, normalized to `.model.json`. For `--output models/site.model.json`, discovery saves the inventory, `index.html` and per-visit screenshots/JSON captures under `models/artifact/<timestamped run>/`. Each run name contains a UTC timestamp, process ID and sequence number. The CLI prints all paths. Existing model files are not overwritten; choose a new model name for another crawl.

The public discovery functions use the same layout. Inventory asset paths are relative to the run folder, so moving the model together with its artifact folder preserves viewer links. `report --inventory FILE` defaults to `index.html` in that inventory's run folder; use `--output` with a new filename to rebuild it.

## Scope and replay

URL mode stays on the seed origin and explores links and native forms up to `--depth`:

```bash
npx --no-install testwalker-discover discover-url \
  --url http://localhost:3000/ --output models/site.model.json \
  --depth 2 --max-pages 50 --max-actions 200
```

Each queued branch starts in a fresh browser context at its entry URL and replays the preceding links, buttons, select changes and submissions. This preserves client-side workflow state. Backend writes can repeat during replay; provide reset hooks where needed.

Sitemap mode accepts a local XML `urlset` and inspects only listed URLs. It follows no unlisted links and submits no forms. Expand sitemap indexes before supplying the file. All seeds must share an origin; redirects are checked against scope. Page assets may load, while external data requests/writes are blocked.

The crawler waits for structural UI stability, tracked requests and visible busy indicators before acting and observing. Timeouts produce unresolved-action evidence. Forms and buttons are not retried automatically, and transitions are not invented from href values.

## Exploration options

| Flag                                    | Default | Meaning                                                                    |
| --------------------------------------- | ------- | -------------------------------------------------------------------------- |
| `--depth N`                             | 1       | Maximum interaction depth from an entry URL. Zero inspects only the entry. |
| `--max-pages N`                         | 50      | Limit observed states.                                                     |
| `--max-actions N`                       | 200     | Limit navigation/interaction operations, including replay.                 |
| `--max-state-variants N`                | 4       | Limit expansion of repetitive state families; maximum 100.                 |
| `--click-buttons`                       | Off     | Explore enabled non-submit buttons and accessible custom choices.          |
| `--probe-empty-forms`                   | Off     | Add one empty probe per explored submit control.                           |
| `--no-submit-forms`                     | Off     | Disable form submissions and standalone select interaction.                |
| `--exclude-buttons 'Label,Other label'` | None    | Exclude exact visible button labels.                                       |
| `--values FILE`                         | None    | Override global or page-specific field samples.                            |
| `--hooks FILE`                          | None    | Load explicit JS/TS discovery hooks.                                       |

Each visible enabled submit control is explored separately. Native standalone selects explore enabled options, skipping disabled groups/options. Multiple selects sample one option at a time rather than every combination. Empty probes keep select/radio values where a native control cannot represent an empty choice.

Samples reuse observed values and HTML attributes where available. Initial examples are remembered for matching forms, allowing later correction after errors clear fields. Explicit overrides take precedence. This does not infer independent business validity.

Covered controls remain inventoried but are deferred instead of clicked through an overlay. Native actionability checks also cover scrolling and pointer interception. Open shadow-root controls are supported; iframes, closed shadow roots, opaque widgets and drag/drop require custom handling.

## Observed states and draft models

State identity uses URL, headings/page label, current alerts, control structure, links and standalone select values. Editable samples and arbitrary changing body text do not define a new state on their own. Review data-dependent states that this grouping can merge.

State families group repetitive variants to bound expansion. Distinct observed states and incoming journeys are retained even when their outgoing actions are deferred. This is a sampling limit, not proof that variants are equivalent.

Only successfully observed transitions enter the model. The export uses identifier names without spaces, readable business descriptions/intents, and numeric Studio coordinates in `properties.x`/`properties.y`. An exact entry/fragment alias can be merged when the full UI snapshot is identical and unambiguous; raw observations remain in the inventory.

Draft rules describe observed structure, not independently expected business behavior. Fixed scalar form examples preserve replay inputs. Proposed dictionaries appear as `suggested_data_sets` in the inventory, not Hegel campaigns. Add accepted/rejected states, constraints and independent rules during review.

Terminal states, disconnected routes and the sampled frontier can prevent full graph traversal. In particular, New York Street Sweeper needs strong connectivity. Use the inventory's warnings and deferred actions to refine the model before execution. See [business model authoring](../../core/docs/model-format.md).

## Browser and evidence options

| Flag                       | Default | Meaning                                   |
| -------------------------- | ------- | ----------------------------------------- |
| `--headed`                 | Off     | Show the owned browser.                   |
| `--browser-config FILE`    | None    | Discovery launch/context settings.        |
| `--timeout-ms N`           | 10000   | Navigation, action and settling deadline. |
| `--settle-ms N`            | 300     | Structural quiet interval.                |
| `--no-screenshots`         | Off     | Disable full-page screenshot capture.     |
| `--no-network`             | Off     | Disable JSON network evidence.            |
| `--max-json-bytes N`       | 1048576 | Maximum captured bytes per JSON body.     |
| `--max-network-requests N` | 1000    | Maximum JSON exchanges per visit.         |

Discovery browser configuration accepts only these two objects:

```json
{
  "launch": { "channel": "chrome" },
  "context": {
    "viewport": { "width": 1280, "height": 900 },
    "ignoreHTTPSErrors": false
  }
}
```

Relative executable paths resolve beside the file. Explicit launch/context proxies are honored; otherwise routing is direct. Discovery owns its browser and does not attach through CDP.

Artifacts include screenshots and `network.json`, but no saved page HTML or DOM snapshots. Network records include endpoint, method, HTTP status and timing only for exchanges with a JSON request or response Content-Type (`application/json` or `+json`). GET APIs returning JSON are included.

| Body status   | Meaning                                                                                    |
| ------------- | ------------------------------------------------------------------------------------------ |
| `no_body`     | There was no payload, commonly for a GET request.                                          |
| `not_json`    | That side has a nonempty non-JSON body; it is not saved. The other side may still be JSON. |
| `unavailable` | A JSON body could not be read.                                                             |

Capture also marks oversize, failed and incomplete exchanges. These are evidence availability flags, not application pass/fail verdicts.

The viewer bounds inline previews to 50 exchanges per visit, 2000 bytes per body and 2 MiB overall. Capture files preserve the separately configured full JSON evidence; large files are linked rather than loaded inline. Keep the artifact directory together.

## Values and hooks

`--values values.json` supports global and page-specific overrides:

```json
{
  "defaults": { "Email address": "alex@example.com" },
  "pages": {
    "http://localhost:3000/enquiry": { "Subject": "A sample enquiry" }
  }
}
```

Keys match field names, or labels for unnamed fields. Checkbox values are booleans; radio values identify the chosen option.

A module passed with `--hooks` may export `before_visit`, `after_visit`, `before_submit` and `after_submit`. Context supplies `page`, `url`, `form`, `values`, `snapshot` where applicable, shared `scratch`, `skip` and `handled`:

```ts
import type { DiscoveryContext } from "@testwalker/discover";

export async function before_submit(ctx: DiscoveryContext) {
  ctx.values["Email address"] = "specific@example.com";
}
```

Visit hooks can perform browser/API setup. In a submission hook, set `skip` to avoid submission, or perform a custom operation and set `handled` to replace the default fill/submit. Hooks are explicitly loaded code, not model content.

## Review and reuse output

The inventory records visits, executed journeys, failures and pending actions with their routes and reasons. Pending work covers only the observed frontier; it cannot describe unknown pages. Discovery success does not establish business correctness.

Use `testwalker-discover report` to rebuild a viewer without crawling. Use `discoverUrl`, `discoverUrls` or `discoverSitemap` from the public API to integrate discovery into a separate authoring tool.

Local example commands and comparison fixtures are documented under [Trailhead discovery](../../demos/trailhead/discovery/README.md) and [Sauce Demo discovery](../../demos/saucedemo/discovery/README.md).
