import {
  PlaywrightCrawler,
  RequestQueue,
  Configuration,
  Log,
  LogLevel,
} from "crawlee";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rename,
  rm,
  access,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { join, dirname, basename, resolve } from "node:path";
import { chromium, type Page } from "playwright";
import { httpUrl, type BrowserSettings } from "./config.js";
import { loadExtension } from "./extensions.js";
import { VisitEvidence } from "./discovery-evidence.js";
import { SNAPSHOT, BUTTONS } from "./discovery-snapshot.js";
import { Inconclusive, message, type Json, type Model } from "./types.js";

export interface DiscoveryOptions {
  output: string;
  depth?: number;
  submitForms?: boolean;
  clickButtons?: boolean;
  probeEmptyForms?: boolean;
  excludeButtons?: string[];
  maxPages?: number;
  maxActions?: number;
  timeoutMs?: number;
  settleMs?: number;
  headed?: boolean;
  screenshots?: boolean;
  dom?: boolean;
  network?: boolean;
  maxJsonBytes?: number;
  maxNetworkRequests?: number;
  browser?: BrowserSettings;
  values?: { defaults?: Json; pages?: Record<string, Json> };
  hooks?: string;
}
export interface DiscoveryContext {
  page: Page;
  url: string;
  form?: Json;
  values: Json;
  snapshot?: Json;
  scratch: Json;
  skip: boolean;
  handled: boolean;
}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
const prose = (value: unknown) =>
  String(value)
    .replace(/\s+/g, " ")
    .replace(/querySelector|document\.|xpath=|css=|=>|\{\{/g, " ")
    .slice(0, 1500)
    .trim() || "Unnamed page";
const canonical = (value: string) => httpUrl(value);
const identity = (page: Json) =>
  "page_" +
  hash({
    url: page.url,
    title: page.title,
    headings: page.headings,
    alerts: page.alerts,
    buttons: page.buttons.map((button: Json) => [button.label, button.role]),
    forms: page.forms.map((form: Json) => ({
      label: form.label,
      fields: form.fields.map((field: Json) => [field.label, field.type]),
    })),
  });
export function sitemapUrls(xml: string): string[] {
  if (Buffer.byteLength(xml) > 10_000_000)
    throw new Error("Sitemap exceeds 10 MB");
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Sitemap DTDs and entities are unsupported");
  if (XMLValidator.validate(xml) !== true)
    throw new Error("Invalid sitemap XML");
  const parsed = new XMLParser({
    removeNSPrefix: true,
    parseTagValue: false,
    isArray: (name) => ["url", "loc"].includes(name),
  }).parse(xml);
  if (!parsed.urlset || !Array.isArray(parsed.urlset.url))
    throw new Error("Supply a sitemap urlset; expand indexes separately");
  const urls = parsed.urlset.url.map((item: Json) => {
    if (
      !Array.isArray(item.loc) ||
      item.loc.length !== 1 ||
      typeof item.loc[0] !== "string"
    )
      throw new Error("Each URL needs exactly one loc");
    return canonical(item.loc[0].trim());
  });
  if (!urls.length) throw new Error("Sitemap contains no URLs");
  return [...new Set<string>(urls)];
}
export function buildModel(
  pages: Record<string, Json>,
  transitions: Json[],
  review: string[],
): Model {
  const vertices = Object.entries(pages).map(([id, page], index) => {
    const label = prose(
      page.headings[0] ?? page.title ?? new URL(page.url).pathname,
    );
    const rules = [`The visitor sees ${label}.`];
    for (const form of page.forms) {
      const fields = form.fields.filter(
        (field: Json) =>
          field.visible &&
          !["hidden", "submit", "button", "reset"].includes(field.type),
      );
      if (fields.length)
        rules.push(
          prose(
            "The page offers a form with fields: " +
              fields.map((field: Json) => field.label).join(", "),
          ),
        );
    }
    if (page.buttons.length)
      rules.push(
        prose(
          "The page offers these controls: " +
            page.buttons.map((button: Json) => button.label).join(", "),
        ),
      );
    return {
      id,
      name: `Page ${index + 1}: ${label}`,
      properties: {
        business: {
          description: `The visitor is viewing ${label}.`,
          rules: rules.slice(0, 30),
        },
      },
    };
  });
  const seen = new Set<string>();
  const edges: Json[] = [];
  for (const transition of transitions) {
    const intent = prose(transition.intent);
    const key = hash([transition.source, transition.target, intent]);
    if (seen.has(key)) continue;
    seen.add(key);
    if (edges.length >= 500) {
      review.push(
        "Graph edge limit reached; inspect remaining inventory transitions.",
      );
      break;
    }
    transition.edge_id = "journey_" + key;
    edges.push({
      id: transition.edge_id,
      name: `Journey ${edges.length + 1}: ${intent.slice(0, 150)}`,
      sourceVertexId: transition.source,
      targetVertexId: transition.target,
      properties: { business: { intent } },
    });
  }
  const start = vertices[0].id;
  const entry = new URL(Object.values(pages)[0].url);
  const reachable = new Set<string>();
  const pending = [start];
  while (pending.length) {
    const id = pending.shift()!;
    if (reachable.has(id)) continue;
    reachable.add(id);
    pending.push(
      ...edges
        .filter((edge) => edge.sourceVertexId === id)
        .map((edge) => edge.targetVertexId),
    );
  }
  for (const vertex of vertices) {
    if (!reachable.has(vertex.id))
      review.push(
        `State ${vertex.id} is unreachable from entry; add real journeys or split the model.`,
      );
    if (!edges.some((edge) => edge.sourceVertexId === vertex.id))
      review.push(
        `State ${vertex.id} has no outgoing journeys; review termination.`,
      );
  }
  return {
    models: [
      {
        id: "discovered_site",
        name: "Discovered site — review required",
        startElementId: start,
        generator: "quick_random(edge_coverage(100))",
        properties: {
          business: {
            version: 3,
            purpose:
              "Draft from observed UI; review navigation and add independent business rules before testing.",
            "entry path": entry.pathname + entry.search + entry.hash,
            rules: ["Each journey reaches its described destination."],
            "data sets": {},
          },
        },
        vertices,
        edges: edges as Model["models"][0]["edges"],
      },
    ],
  };
}
const editableField = (field: Json): boolean =>
  field.visible &&
  !field.disabled &&
  !field.readonly &&
  ["input", "select", "textarea"].includes(field.tag) &&
  !["hidden", "submit", "image", "button", "reset", "file"].includes(
    field.type,
  );

const formIdentity = (form: Json): string =>
  hash(
    form.fields
      .filter(editableField)
      .map((field: Json) => [field.name, field.label, field.type]),
  );

export function suggestedDataSets(pages: Record<string, Json>): Json {
  const proposals: Json = {};
  for (const [state, page] of Object.entries<Json>(pages))
    for (const form of page.forms) {
      const fields = form.fields.filter(editableField);
      if (!fields.length) continue;
      const key = "form_" + formIdentity(form);
      const proposal = (proposals[key] ??= {
        states: [],
        fields: {},
        review:
          "HTML constraints only. Review hints, requiredness, choices and accepted/rejected states before adding this data set to the model.",
      });
      proposal.states.push(state);
      for (const field of fields) {
        const description: Json = {
          description: prose(
            field.label + (field.hint ? ": " + field.hint : ""),
          ),
          type:
            field.tag === "select"
              ? "choice"
              : field.type === "email"
                ? "email"
                : ["number", "range"].includes(field.type)
                  ? field.step === "any" ||
                    (field.step !== null &&
                      field.step !== undefined &&
                      !Number.isInteger(Number(field.step)))
                    ? "number"
                    : "whole number"
                  : "text",
          required: field.required,
        };
        for (const [html, business] of [
          ["minLength", "minimum length"],
          ["maxLength", "maximum length"],
          ["min", "minimum"],
          ["max", "maximum"],
        ])
          if (
            field[html] !== null &&
            field[html] !== undefined &&
            Number.isFinite(Number(field[html]))
          )
            description[business] = Number(field[html]);
        if (field.tag === "select")
          description.options = field.options
            .filter((option: Json) => !option.disabled)
            .map((option: Json) => option.label);
        if (
          !["password", "checkbox", "radio"].includes(field.type) &&
          field.value
        )
          description.example = field.value;
        proposal.fields[field.name || field.label] ??= description;
      }
    }
  return proposals;
}
function fieldValue(field: Json): unknown {
  if (field.type === "checkbox")
    return Boolean(field.checked || field.required);
  if (field.value) return field.value;
  if (field.tag === "select")
    return (
      field.options.find((option: Json) => !option.disabled && option.value)
        ?.value ?? ""
    );
  if (field.type === "radio") return field.value;
  if (field.type === "email") return "alex@example.test";
  if (field.type === "number" || field.type === "range")
    return field.min ?? "1";
  if (field.type === "url") return "https://example.test";
  const special: Record<string, string> = {
    tel: "0400000000",
    password: "Example-Test-42!",
    date: "2030-01-15",
    "datetime-local": "2030-01-15T10:00",
    month: "2030-01",
    week: "2030-W03",
    time: "10:00",
    color: "#336699",
  };
  if (special[field.type]) return field.min || field.max || special[field.type];
  return "Alex Morgan"
    .padEnd(Number(field.minLength ?? 0), "a")
    .slice(0, Number(field.maxLength ?? 100));
}
async function submit(
  page: Page,
  step: Json,
  allows: (url: string) => boolean,
  hooks: Json,
  scratch: Json,
): Promise<Json> {
  const snapshot: Json = await page.evaluate(`(${SNAPSHOT})()`);
  if (identity(snapshot) !== step.source)
    throw new Inconclusive(
      "Discovery replay source changed; form was not submitted",
    );
  const form = snapshot.forms[step.form];
  if (!form || !allows(form.action))
    throw new Inconclusive("Form action is outside discovery scope");
  const context: DiscoveryContext = {
    page,
    url: page.url(),
    form,
    values: structuredClone(step.values),
    scratch,
    skip: false,
    handled: false,
  };
  await hooks.before_submit?.(context);
  if (context.skip)
    throw new Inconclusive("Form submission skipped by discovery hook");
  if (context.handled) {
    await hooks.after_submit?.(context);
    return context.values;
  }
  for (const field of form.fields) {
    if (!editableField(field)) continue;
    const value =
      context.values[field.name || field.label] ?? fieldValue(field);
    // form.elements also includes fieldsets and controls associated through form=.
    const handle = await page.evaluateHandle(
      ({ form, index }) => document.forms[form].elements[index],
      { form: step.form, index: field.index },
    );
    try {
      const input = handle.asElement();
      if (!input) throw new Inconclusive("Form control disappeared");
      if (field.tag === "select")
        await input.selectOption(
          Array.isArray(value) ? value.map(String) : String(value),
        );
      else if (field.type === "checkbox") {
        if (typeof value !== "boolean")
          throw new Inconclusive("Checkbox values must be booleans");
        await input.setChecked(value);
      } else if (field.type === "radio") {
        if (String(value) === field.value) await input.check();
      } else await input.fill(String(value));
    } finally {
      await handle.dispose();
    }
  }
  const submitField = form.fields.find(
    (field: Json) =>
      field.visible &&
      !field.disabled &&
      ["submit", "image"].includes(field.type),
  );
  if (!submitField)
    throw new Inconclusive(
      "Form has no observable submit control; provide a discovery hook",
    );
  if (submitField.action && !allows(submitField.action))
    throw new Inconclusive("Submit control is outside scope");
  const submitHandle = await page.evaluateHandle(
    ({ form, index }) => document.forms[form].elements[index],
    { form: step.form, index: submitField.index },
  );
  try {
    const submitter = submitHandle.asElement();
    if (!submitter) throw new Inconclusive("Submit control disappeared");
    await submitter.click();
  } finally {
    await submitHandle.dispose();
  }
  await page.waitForLoadState("domcontentloaded");
  await hooks.after_submit?.(context);
  return context.values;
}
async function replayStep(
  page: Page,
  step: Json,
  allows: (url: string) => boolean,
  hooks: Json,
  scratch: Json,
): Promise<void> {
  if (step.kind === "form") {
    step.values = await submit(page, step, allows, hooks, scratch);
    return;
  }
  const snapshot: Json = await page.evaluate(`(${SNAPSHOT})()`);
  if (identity(snapshot) !== step.source)
    throw new Inconclusive(
      "Discovery replay source changed; action was not performed",
    );
  if (step.kind === "link") {
    const link = snapshot.links[step.index];
    if (
      !link ||
      link.label !== step.label ||
      link.url !== step.url ||
      !allows(link.url)
    )
      throw new Inconclusive("Discovery link changed or left scope");
    await page
      .locator("a[href]")
      .filter({ visible: true })
      .nth(step.index)
      .click();
  } else {
    const button = snapshot.buttons.find(
      (item: Json) => item.index === step.index,
    );
    if (
      !button ||
      button.label !== step.label ||
      button.disabled ||
      button.submit
    )
      throw new Inconclusive("Discovery control changed or is unavailable");
    const handle = await page.evaluateHandle<HTMLElement>(
      `(${BUTTONS})()[${step.index}]`,
    );
    try {
      const element = handle.asElement();
      if (!element) throw new Inconclusive("Discovery control disappeared");
      await element.click();
    } finally {
      await handle.dispose();
    }
  }
  await page.waitForLoadState("domcontentloaded");
}
export async function discoverSitemap(
  sitemap: string,
  options: DiscoveryOptions,
): Promise<Json> {
  return discoverUrls(
    sitemapUrls(await readFile(sitemap, "utf8")),
    { ...options, depth: 0, submitForms: false },
    true,
  );
}
export async function discoverUrl(
  url: string,
  options: DiscoveryOptions,
): Promise<Json> {
  return discoverUrls([canonical(url)], options);
}
export async function discoverUrls(
  seeds: string[],
  options: DiscoveryOptions,
  sitemap = false,
): Promise<Json> {
  if (options.browser?.cdp_url)
    throw new Error("Crawlee discovery launches its own browser; omit cdp_url");
  if (options.values !== undefined) {
    const overrides = options.values as Json;
    const object = (value: unknown): value is Json =>
      !!value && typeof value === "object" && !Array.isArray(value);
    if (
      !object(overrides) ||
      Object.keys(overrides).some((key) => !["defaults", "pages"].includes(key))
    ) {
      throw new Error(
        "Discovery values must contain defaults and/or pages objects",
      );
    }
    if (overrides.pages !== undefined && !object(overrides.pages))
      throw new Error("pages must be an object");
    for (const fields of [
      overrides.defaults ?? {},
      ...Object.values(overrides.pages ?? {}),
    ]) {
      if (!object(fields))
        throw new Error("Each values entry must be an object");
      for (const value of Object.values(fields)) {
        const scalar = (item: unknown) =>
          typeof item === "string" ||
          typeof item === "boolean" ||
          (typeof item === "number" && Number.isFinite(item));
        if (
          !scalar(value) &&
          !(
            Array.isArray(value) &&
            value.every((item) => typeof item === "string")
          )
        ) {
          throw new Error(
            "Field overrides must be text, finite numbers, booleans or lists of option values",
          );
        }
      }
    }
  }
  if (
    options.excludeButtons &&
    (!Array.isArray(options.excludeButtons) ||
      options.excludeButtons.some(
        (label) => typeof label !== "string" || !label.trim(),
      ))
  )
    throw new Error("excludeButtons must be a list of nonempty control labels");
  const depth = options.depth ?? 1,
    maxPages = options.maxPages ?? 50,
    maxActions = options.maxActions ?? 200;
  for (const [label, value, min, max] of [
    ["depth", depth, 0, 10],
    ["maxPages", maxPages, 1, 100],
    ["maxActions", maxActions, 1, 10000],
    ["timeoutMs", options.timeoutMs ?? 10000, 100, 120000],
    ["settleMs", options.settleMs ?? 300, 0, 10000],
    ["maxJsonBytes", options.maxJsonBytes ?? 1048576, 1, 10485760],
    ["maxNetworkRequests", options.maxNetworkRequests ?? 1000, 1, 10000],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${label} must be ${min}–${max}`);
  }
  seeds = [...new Set(seeds.map(canonical))];
  if (!seeds.length || seeds.length > maxPages)
    throw new Error("Supply 1–maxPages seed URLs");
  const origins = new Set(seeds.map((url) => new URL(url).origin));
  if (origins.size !== 1) throw new Error("Use one origin per model");
  const allows = (value: string) => {
    try {
      const url = canonical(value);
      return sitemap ? seeds.includes(url) : origins.has(new URL(url).origin);
    } catch {
      return false;
    }
  };
  const output = resolve(options.output),
    inventoryPath = output.replace(/\.json$/, "") + ".discovery.json";
  const artifactRoot = output.replace(/\.json$/, "") + ".discovery";
  if (/\.discovery(?:\.json)?$/.test(output))
    throw new Error("Choose a model output filename");
  for (const path of [output, inventoryPath, artifactRoot]) {
    try {
      await access(path);
    } catch {
      continue;
    }
    throw new Error("Discovery output exists; choose a new filename");
  }
  const staging = await mkdtemp(join(tmpdir(), "testwalker-discovery-"));
  const artifactStage = join(staging, "artifacts");
  await mkdir(artifactStage);
  const inventory: Json = {
    version: 2,
    engine: "crawlee",
    seeds,
    scope: sitemap ? seeds : "same origin",
    depth,
    pages: {},
    transitions: [],
    visits: [],
    failed: [],
    blocked: [],
    pending: [],
    operations: 0,
    review: [
      "Observed labels and HTML constraints are provisional. Add independent business rules and data sets.",
      "Button exploration is opt-in; review side effects before enabling it. Open shadow roots are inspected; closed roots require hooks.",
      "States are grouped by URL, headings, alerts and control structure; changing data values are evidence, not separate states.",
    ],
  };
  const hooks = options.hooks
    ? (await loadExtension(options.hooks)).module
    : {};
  for (const event of [
    "before_visit",
    "after_visit",
    "before_submit",
    "after_submit",
  ]) {
    if (hooks[event] !== undefined && typeof hooks[event] !== "function")
      throw new Error(`Discovery hook ${event} must be a function`);
  }
  const scratch: Json = {};
  const settings = new Configuration({
    persistStorage: false,
    storageClientOptions: { localDataDirectory: join(staging, "storage") },
  });
  const queue = await RequestQueue.open(randomUUID(), { config: settings });
  const captures = new Map<string, VisitEvidence>();
  const contexts = new WeakSet<object>();
  const expanded = new Set<string>();
  const formExamples = new Map<string, Json>();
  // Crawlee installs an implicit local proxy even without a configured proxy.
  // Its tunnel sockets can outlive a closed browser and keep the CLI alive.
  // Use the supported launcher extension to retain Playwright's direct routing
  // unless the caller explicitly needs a launch or per-context proxy.
  const launcher = Object.create(chromium) as typeof chromium;
  launcher.launch = (launchOptions) =>
    chromium.launch(
      options.browser?.launch?.proxy || options.browser?.context?.proxy
        ? launchOptions
        : { ...launchOptions, proxy: undefined },
    );
  const crawler = new PlaywrightCrawler(
    {
      requestQueue: queue,
      maxConcurrency: 1,
      maxRequestRetries: 0,
      navigationTimeoutSecs: (options.timeoutMs ?? 10000) / 1000,
      requestHandlerTimeoutSecs: 120,
      log: new Log({ level: LogLevel.WARNING }),
      launchContext: {
        // Each replay owns its browser context; the complete action route restores client state.
        useIncognitoPages: true,
        launcher,
        launchOptions: {
          channel: "chrome",
          ...options.browser?.launch,
          headless: !options.headed,
        },
      },
      browserPoolOptions: {
        prePageCreateHooks: [
          async (_id, _controller, pageOptions) => {
            if (pageOptions)
              Object.assign(pageOptions, {
                serviceWorkers: "block",
                ...options.browser?.context,
              });
          },
        ],
      },
      preNavigationHooks: [
        async ({ page, request }, gotoOptions) => {
          gotoOptions.waitUntil = "domcontentloaded";
          const data = request.userData;
          if (
            inventory.operations + 1 + (data.steps?.length ?? 0) > maxActions ||
            Object.keys(inventory.pages).length >= maxPages
          ) {
            data.budget_pending = true;
            inventory.pending.push({ url: request.url, depth: data.depth });
            crawler.stop();
            throw new Error("Discovery budget reached");
          }
          inventory.operations++;
          if (!contexts.has(page.context())) {
            contexts.add(page.context());
            await page.context().route("**/*", async (route) => {
              const outgoing = route.request();
              const navigation = outgoing.isNavigationRequest();
              const writes = !["GET", "HEAD"].includes(outgoing.method());
              const externalData =
                (writes ||
                  ["fetch", "xhr"].includes(outgoing.resourceType())) &&
                !origins.has(new URL(outgoing.url()).origin);
              if (
                (navigation && !allows(outgoing.url())) ||
                externalData ||
                (writes && (sitemap || options.submitForms === false))
              ) {
                inventory.blocked.push({
                  url: outgoing.url(),
                  reason: "Navigation outside discovery scope",
                });
                await route.abort();
              } else if (!navigation) await route.continue();
              else {
                // Route every redirect separately so a permitted seed cannot escape scope.
                try {
                  const response = await route.fetch({
                    maxRedirects: 0,
                    timeout: options.timeoutMs ?? 10000,
                  });
                  const location = response.headers().location;
                  if (
                    response.status() >= 300 &&
                    response.status() < 400 &&
                    location
                  ) {
                    const target = new URL(location, outgoing.url()).href;
                    if (
                      !allows(target) ||
                      (writes && [307, 308].includes(response.status()))
                    ) {
                      inventory.blocked.push({
                        url: target,
                        reason:
                          "Redirect outside scope or requires method replay",
                      });
                      await route.abort();
                    } else
                      await route.fulfill({
                        contentType: "text/html",
                        body: `<script>location.replace(${JSON.stringify(target).replaceAll("<", "\\u003c")})</script>`,
                      });
                  } else await route.fulfill({ response });
                  await response.dispose();
                } catch (error) {
                  inventory.blocked.push({
                    url: outgoing.url(),
                    reason: message(error),
                  });
                  await route.abort();
                }
              }
            });
          }
          page.on("dialog", (dialog) => void dialog.dismiss());
          const record: Json = {
            id: `visit-${String(inventory.visits.length + 1).padStart(4, "0")}`,
            url: request.url,
            depth: data.depth,
            source: data.source ?? null,
            artifacts: {},
            capture_errors: [],
          };
          inventory.visits.push(record);
          captures.set(
            request.uniqueKey,
            new VisitEvidence(
              page,
              join(artifactStage, record.id),
              record,
              options,
            ),
          );
          page.setDefaultTimeout(options.timeoutMs ?? 10000);
          await hooks.before_visit?.({
            page,
            url: request.url,
            values: {},
            scratch,
            skip: false,
            handled: false,
          });
        },
      ],
      requestHandler: async ({ page, request }) => {
        const data = request.userData,
          capture = captures.get(request.uniqueKey)!;
        try {
          await hooks.after_visit?.({
            page,
            url: page.url(),
            snapshot: await page.evaluate(`(${SNAPSHOT})()`),
            values: {},
            scratch,
            skip: false,
            handled: false,
          });
          await page.waitForTimeout(options.settleMs ?? 300);
          for (const step of data.steps ?? []) {
            inventory.operations++;
            await replayStep(page, step, allows, hooks, scratch);
            await page.waitForTimeout(options.settleMs ?? 300);
          }
          if (!allows(page.url()))
            throw new Inconclusive("Page left discovery scope");
          const snapshot: Json = await page.evaluate(`(${SNAPSHOT})()`);
          const id = identity(snapshot);
          snapshot.url = canonical(snapshot.url);
          inventory.pages[id] ??= snapshot;
          capture.record.state = id;
          if (data.source)
            inventory.transitions.push({
              source: data.source,
              target: id,
              intent: data.intent,
              evidence: data.kind,
              values: data.steps?.at(-1)?.values ?? {},
              form:
                data.steps?.at(-1)?.kind === "form"
                  ? inventory.pages[data.source].forms[data.steps.at(-1).form]
                  : undefined,
              visit: capture.record.id,
            });
          if (!expanded.has(id) && data.depth < depth) {
            expanded.add(id);
            const enqueue = async (
              step: Json,
              intent: string,
              kind: string,
            ) => {
              const steps = [...(data.steps ?? []), step];
              await queue.addRequest({
                url: request.url,
                uniqueKey: "action:" + hash([id, step]),
                userData: {
                  depth: data.depth + 1,
                  source: id,
                  steps,
                  intent,
                  kind,
                },
              });
            };
            for (const [index, link] of snapshot.links.entries())
              if (!link.download && allows(link.url))
                await enqueue(
                  {
                    kind: "link",
                    source: id,
                    index,
                    label: link.label,
                    url: link.url,
                  },
                  `Follow ${prose(link.label)}.`,
                  "executed hyperlink",
                );
            if (
              options.clickButtons &&
              !sitemap &&
              options.submitForms !== false
            )
              for (const button of snapshot.buttons)
                if (
                  !button.disabled &&
                  !button.submit &&
                  !options.excludeButtons?.includes(button.label)
                )
                  await enqueue(
                    {
                      kind: "button",
                      source: id,
                      index: button.index,
                      label: button.label,
                    },
                    `Choose ${prose(button.label)}.`,
                    "executed control",
                  );
            if (options.submitForms !== false)
              for (const form of snapshot.forms) {
                if (!allows(form.action)) {
                  inventory.blocked.push({
                    url: form.action,
                    reason: "Form outside scope",
                  });
                  continue;
                }
                const values = {
                  ...options.values?.defaults,
                  ...options.values?.pages?.[snapshot.url],
                };
                const formKey = formIdentity(form);
                const remembered = formExamples.get(formKey) ?? {};
                for (const field of form.fields.filter(editableField)) {
                  const key = field.name || field.label;
                  const selected =
                    field.type === "radio"
                      ? form.fields.find(
                          (candidate: Json) =>
                            editableField(candidate) &&
                            candidate.type === "radio" &&
                            candidate.name === field.name &&
                            candidate.checked,
                        )
                      : undefined;
                  values[key] ??=
                    selected || field.value || field.type === "checkbox"
                      ? fieldValue(selected ?? field)
                      : (remembered[key] ?? fieldValue(field));
                }
                if (!formExamples.has(formKey))
                  formExamples.set(formKey, structuredClone(values));
                const step = {
                  kind: "form",
                  source: id,
                  form: form.index,
                  values,
                };
                const submitter = form.fields.find((field: Json) =>
                  ["submit", "image"].includes(field.type),
                );
                const label = prose(submitter?.label ?? form.label);
                const details = form.fields
                  .filter(
                    (field: Json) =>
                      editableField(field) && field.type !== "password",
                  )
                  .map(
                    (field: Json) =>
                      `${prose(field.label)}: ${prose(JSON.stringify(values[field.name || field.label]))}`,
                  )
                  .join("; ");
                await enqueue(
                  step,
                  `Submit ${label} with these form details: ${details}.`,
                  "form submission",
                );
                if (options.probeEmptyForms) {
                  const empty: Json = { ...values };
                  for (const field of form.fields) {
                    if (!editableField(field) || field.type === "radio")
                      continue;
                    if (
                      field.tag === "select" &&
                      !field.options.some((option: Json) => option.value === "")
                    )
                      continue;
                    empty[field.name || field.label] =
                      field.type === "checkbox" ? false : "";
                  }
                  await enqueue(
                    { ...step, values: empty },
                    `Submit ${label} with all editable text fields empty.`,
                    "empty form probe; outcome requires review",
                  );
                }
              }
          }
        } finally {
          await capture.finish();
          captures.delete(request.uniqueKey);
        }
      },
      failedRequestHandler: async ({ request }, error) => {
        if (!request.userData.budget_pending)
          inventory.failed.push({ url: request.url, error: message(error) });
        const capture = captures.get(request.uniqueKey);
        if (capture) {
          capture.record.error = message(error);
          await capture.finish();
          captures.delete(request.uniqueKey);
        }
      },
    },
    settings,
  );
  try {
    await crawler.run(
      seeds.map((url) => ({
        url,
        uniqueKey: "url:" + url,
        userData: { depth: 0, steps: [] },
      })),
    );
    if (!Object.keys(inventory.pages).length)
      throw new Inconclusive("No pages could be inspected", {
        failed: inventory.failed,
        blocked: inventory.blocked,
      });
    inventory.suggested_data_sets = suggestedDataSets(inventory.pages);
    const model = buildModel(
      inventory.pages,
      inventory.transitions,
      inventory.review,
    );
    inventory.artifact_root = basename(artifactRoot);
    await mkdir(dirname(output), { recursive: true });
    await rename(artifactStage, artifactRoot);
    await writeFile(output, JSON.stringify(model, null, 2) + "\n", {
      flag: "wx",
    });
    await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + "\n", {
      flag: "wx",
    });
    return { model, inventory, output, inventory_path: inventoryPath };
  } finally {
    try {
      await crawler.teardown();
      await settings.getEventManager().close();
      await queue.drop();
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
}
