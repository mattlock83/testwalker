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

The URL mode stays on the seed's origin, applies the depth limit, and uses default field values. Buttons are inventoried by default. Add `--click-buttons` to explore enabled non-submit buttons and custom options, including open shadow roots. Review side effects before enabling it; discovery can submit or confirm actions. `--exclude-buttons 'Delete account,Place order'` excludes exact visible labels. The built-in scanner handles native forms in the main document and these open-shadow-root controls. Iframes, closed shadow roots, unlabelled widgets and interactions such as drag/drop need custom handling.

Each enabled, visible submit control is explored separately. For example, a form with Cancel and Continue produces both journeys; subsequent replay uses the exact control originally selected. Input submit controls use their visible caption in the model.

Add `--probe-empty-forms` to try one empty-input submission beside the default submission for each submit control in an explored form state. This discovers rejection screens; it is not a property-based test or proof of a validation rule. Native select controls without an empty option and radio selections retain their value. Forms and buttons are never automatically retried after failure.

For forms with the same editable field names, labels and types, discovery remembers the initial sample values. When a rejection screen clears prefilled choices, the next default submission restores those examples. Explicit global/page overrides take precedence. This reuses observed data; it does not infer validation rules. Native checkboxes use boolean values, and fieldsets are not treated as editable inputs.

Native selects outside forms are explored automatically in URL mode: each enabled option is selected and the resulting state is observed. Disabled options and disabled option groups are skipped. The selected value is part of state identity; replay restores earlier selections before continuing. Multiple selects are sampled one option at a time, not as every possible combination. `--no-submit-forms` also disables standalone select interaction.

The scanner checks whether the normal click point of controls in the viewport is exposed. Controls covered by a menu or overlay are retained in the inventory and deferred, rather than clicked through the overlay. An exposed close/menu control can lead back to a state where they are usable. For off-screen controls, it also checks for fixed/sticky layers covering the projected scroll position; A short native trial click then checks actual scrolling/actionability without dispatching a click. Pointer interception discovered at this point defers the action with diagnostics and evidence. This is a useful filter, not a guarantee that every custom widget is actionable.

Each queued replay has a fresh browser context, with settings from `--browser-config` applied. Explicit launch/context proxies are honored; otherwise discovery uses direct Playwright routing.

Every queued action starts from its original entry URL and replays the full route (links, buttons and submissions) before performing the new action. Before each interaction and final observation, discovery waits for a quiet UI: the structural snapshot must stop changing for `--settle-ms`, tracked document/script/fetch/XHR requests must finish, and visible busy/progress indicators must clear. The wait is bounded by `--timeout-ms`. Replay also waits for the expected source state before acting. A timeout records an unresolved action with diagnostics and evidence; it does not retry the action or invent a graph transition. Unmarked delayed work cannot always be detected; increase `--settle-ms` or use a hook for applications with unusual completion signals. This preserves JavaScript state such as a booking draft or authenticated workflow. Backend writes can repeat during replay: use disposable environments and suitable fixture/reset hooks for non-idempotent applications. Crawlee still owns the queue and browser lifecycle.

Only executed transitions enter the draft graph. A link's URL alone does not prove which state it reaches. Every transition identifies the evidence visit. State identity includes URL, page label/headings, alerts, control structure/disabled status, links and standalone select values. Click exposure is separate from logical state identity, so scrolling alone does not invalidate replay. Body text and changing form values remain evidence rather than defining separate states; review data-dependent states that this grouping merges. Generated form/control rules omit covered controls, while the inventory retains them. Labels prefer actual headings, then short prominent visible text, then the document title.

Forms are queued before navigation and buttons so small budgets can reach validation and workflow states. Identical label/destination links are queued once per state; an anchor also exposed as a button is followed once. Separate contextual buttons, such as multiple product actions, remain separate.

`--max-state-variants` defaults to **4**. It limits expansion of repetitive state families sharing the URL, page label/headings, links (ignoring order and normalizing numeric label variations), form/select structure and button types. Button captions, alerts and selected values can distinguish observed states without forcing every variant to spawn another full set of branches. All distinct observed states and their incoming journeys remain in the graph. Their outgoing candidate actions are explicitly deferred when the family limit is reached. This is a sampling heuristic: raise it up to 100 when state-dependent combinations are important; it does not prove business equivalence.

For a supplied sitemap:

```bash
npx --no-install testwalker-web discover-sitemap --sitemap /path/to/sitemap.xml \
  --output discovered-site.json --headed
```

Only listed URLs are visited; links outside the list are never followed and forms are not submitted. Supply a `urlset` XML file, expanding sitemap indexes separately. All seed URLs must share an origin. Redirects are checked against the same scope. Normal page assets may be loaded; external data requests/writes are blocked. A URL mode depth of zero also avoids following links and submitting forms.

## Captured evidence

Beside `discovered-site.json`, discovery writes `discovered-site.discovery.json` (inventory) and `discovered-site.discovery/` (visit artifacts):

| Artifact         | Contents                                                                  |
| ---------------- | ------------------------------------------------------------------------- |
| `screenshot.png` | Full-page rendered screenshot.                                            |
| `network.json`   | JSON request/response bodies with endpoint, method, status and timing.     |

Discovery does not save page HTML or DOM snapshots. Network evidence includes only exchanges whose request or response Content-Type is `application/json` or ends in `+json`. This includes GET APIs returning JSON. HTML, CSS, scripts, images and other non-JSON traffic are omitted entirely and do not consume the capture limit. Non-JSON bodies in an otherwise JSON exchange are marked `not_json` and are not saved.

JSON capture is limited to 1 MiB per body and 1,000 JSON exchanges per visit by default. Oversize, unavailable, failed or incomplete requests are explicitly marked. Streaming or unconsumed bodies may remain incomplete. Capture errors are recorded without pretending an artifact exists. Field inventory includes labels, HTML constraints and accessible help text. `suggested_data_sets` in the inventory groups form fields into provisional business schemas, ready to review. These are not added as Hegel campaigns to the model: discovery cannot infer independent validation rules or reliably classify accepted/rejected outcomes. Form journey intents retain non-password sample values so the draft describes what was tried. Passwords are omitted from those intents; configure authentication explicitly before running a reviewed model.

Inventory version 3 adds `actions`, listing each known seed/action with status (`queued`, `executed`, `failed`, or `deferred`), source, intent and replay length. `pending` lists all known unexecuted actions, with reasons such as action/state budget, depth limit, state variant limit, covered control or explicit exclusion. It describes the observed frontier, not hypothetical branches on pages never visited. Failed actions link to a visit with the attempted route, error and settling diagnostics. Only observed successful transitions enter the graph; discovery does not decide application pass/fail.

`--no-screenshots`, `--no-network`, `--max-json-bytes`, and `--max-network-requests` tune evidence. `--max-pages` defaults to 50, `--max-actions` to 200 (navigation plus every replayed link, control and submission), `--timeout-ms` to 10,000 and `--settle-ms` to 300. Output files must not already exist.

## Values and custom calls

`--values values.json` supports global and page-specific overrides:

```json
{
  "defaults": { "Email address": "alex@example.test" },
  "pages": {
    "http://localhost:3000/enquiry": { "Subject": "A sample enquiry" }
  }
}
```

Keys match field names; use labels for unnamed fields. Checkbox values must be booleans. Radio values name the selected option. Custom handling can be supplied with `--hooks discovery-hooks.ts`:

```ts
import type { DiscoveryContext } from "@testwalker/web";

export async function before_submit(ctx: DiscoveryContext) {
  ctx.values["Email address"] = "specific@example.test";
  // Set ctx.skip = true to avoid submission, or perform a custom operation
  // and set ctx.handled = true to replace the default fill/submit operation.
}
```

Supported events are `before_visit`, `after_visit`, `before_submit`, `after_submit`. Context supplies `page`, `url`, `form`, `values`, `snapshot` where applicable, shared `scratch`, `skip` and `handled`. Visit hooks can perform explicit browser/API setup; `skip`/`handled` control form submission. Hooks are trusted JavaScript/TypeScript and must be explicitly loaded.

Public functions `discoverUrl(url, options)` and `discoverSitemap(path, options)` allow a separate authoring tool to invoke discovery. Increase `depth` for bounded recursive URL exploration. Review unreachable states/dead ends reported in the inventory, merge/refine states, define data sets and add independent business rules in GraphWalker before running the model. No UI selectors or executable code are emitted into the graph.

## Repeatable discovery comparison

[Trailhead comparison](../../demos/trailhead/discovery/README.md) and [SauceDemo comparison](../../demos/saucedemo/discovery/README.md) record the independent reference, baseline gaps and discovery-only commands. No Jev, AI, or site-specific discovery hooks are required.
