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
import { randomUUID } from "node:crypto";
import { join, dirname, basename, resolve } from "node:path";
import { chromium, type Page, type ElementHandle } from "playwright";
import { httpUrl, type BrowserSettings } from "./config.js";
import { loadHooks } from "./hooks.js";
import { VisitEvidence } from "./discovery-evidence.js";
import { writeDiscoveryReport } from "./report.js";
import { stateDescriptions } from "./state-description.js";
import {
  studioName,
  studioLayout,
  discoveryPaths,
  entryAliases,
} from "./model-export.js";
import { SNAPSHOT, BUTTONS, SELECTS } from "./discovery-snapshot.js";
import {
  DiscoveryState,
  stateIdentity as identity,
  stateFamily,
  discoveryHash as hash,
} from "./discovery-state.js";
import { DiscoveryError, message, type Json, type Model } from "./types.js";

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
  maxStateVariants?: number;
  headed?: boolean;
  screenshots?: boolean;
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
const prose = (value: unknown) =>
  String(value)
    .replace(/\s+/g, " ")
    .replace(/querySelector|document\.|xpath=|css=|=>|\{\{/g, " ")
    .slice(0, 1500)
    .trim() || "Unnamed page";
const canonical = (value: string) => httpUrl(value);
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
  const aliases = entryAliases(pages, transitions);
  if (Object.keys(aliases).length) {
    const note =
      "The returned fragment route has an identical full UI snapshot to the entry URL; both are represented by one model state. Raw URLs and visits remain in the discovery inventory.";
    if (!review.includes(note)) review.push(note);
    pages = Object.fromEntries(
      Object.entries(pages).filter(([id]) => !aliases[id]),
    );
  }
  const labelFor = (page: Json) =>
    prose(
      page.page_label ||
        page.headings[0] ||
        page.title ||
        new URL(page.url).pathname,
    );
  const distinctions = stateDescriptions(pages, labelFor);
  const vertices = Object.entries(pages).map(([id, page], index) => {
    const label = labelFor(page);
    const rules = [`The visitor sees ${label}.`];
    for (const form of page.forms) {
      const fields = form.fields.filter(
        (field: Json) =>
          field.visible &&
          field.actionable !== false &&
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
    const exposedButtons = page.buttons.filter(
      (button: Json) => button.actionable !== false,
    );
    if (exposedButtons.length)
      rules.push(
        prose(
          "The page offers these controls: " +
            exposedButtons.map((button: Json) => button.label).join(", "),
        ),
      );
    const selections = (page.selects ?? [])
      .filter((select: Json) => select.actionable !== false)
      .map((select: Json) => ({
        label: prose(select.label),
        choices: select.options
          .filter((option: Json) => select.values.includes(option.value))
          .map((option: Json) => prose(option.label))
          .join(", "),
      }));
    for (const selection of selections)
      rules.push(
        `The ${selection.label} selection is ${selection.choices || "empty"}.`,
      );
    const selectionLabel = selections.length
      ? " — " +
        selections
          .map(
            (selection: Json) =>
              `${selection.label}: ${selection.choices || "empty"}`,
          )
          .join("; ")
      : "";
    return {
      id,
      name: studioName("v", index, `${label}${selectionLabel}`),
      properties: {
        business: {
          description:
            `The visitor is viewing ${label}${selectionLabel}. ${distinctions[id].map(prose).join(" ")}`.trim(),
          rules: rules.slice(0, 30),
        },
      },
    };
  });
  const seen = new Set<string>();
  const edges: Json[] = [];
  for (const transition of transitions) {
    const intent = prose(transition.intent);
    const source = aliases[transition.source] ?? transition.source;
    const target = aliases[transition.target] ?? transition.target;
    const example = fixedFormExample(transition, review);
    const key = hash([source, target, intent, ...(example ? [example] : [])]);
    transition.edge_id = "journey_" + key;
    if (seen.has(key)) continue;
    seen.add(key);
    if (edges.length >= 500) {
      review.push(
        "Graph edge limit reached; inspect remaining inventory transitions.",
      );
      break;
    }
    edges.push({
      id: transition.edge_id,
      name: studioName("e", edges.length, intent),
      sourceVertexId: source,
      targetVertexId: target,
      properties: {
        business: {
          intent,
          ...(example ? { example } : {}),
        },
      },
    });
  }
  studioLayout(vertices, edges);
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
  const canReturn = new Set<string>([start]);
  const returning = [start];
  for (let cursor = 0; cursor < returning.length; cursor++)
    for (const edge of edges.filter(
      (edge) => edge.targetVertexId === returning[cursor],
    ))
      if (!canReturn.has(edge.sourceVertexId)) {
        canReturn.add(edge.sourceVertexId);
        returning.push(edge.sourceVertexId);
      }
  if (canReturn.size !== vertices.length || reachable.size !== vertices.length)
    review.push(
      "The observed graph is not strongly connected: some states cannot return to the entry. New York Street Sweeper cannot traverse it; review the model before requesting full single-walk edge coverage.",
    );
  // Global prose must be observable at a checkpoint. Graph completion is
  // already enforced by the core's coverage gate, not inferred from one page.
  const observed = Object.values(pages);
  const globalRule = observed.every((page) =>
    page.headings?.some((heading: string) => heading.trim()),
  )
    ? "The current page has a visible heading."
    : observed.every((page) => page.title?.trim())
      ? "The browser page has a nonempty title."
      : "The browser page has an HTTP or HTTPS URL.";
  return {
    models: [
      {
        id: "discovered_site",
        name: "Discovered_site_review_required",
        startElementId: start,
        generator: "quick_random(edge_coverage(100))",
        properties: {
          business: {
            version: 3,
            purpose:
              "Draft from observed UI; review navigation and add independent business rules before testing.",
            "entry path": entry.pathname + entry.search + entry.hash,
            rules: [globalRule],
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

/** Fixed replay inputs are observed examples, not inferred validation domains. */
function fixedFormExample(
  transition: Json,
  review: string[],
): Json | undefined {
  if (!transition.form) return;
  const fields = transition.form.fields.filter(editableField);
  if (!fields.length) return;
  const example: Json = {};
  const values = transition.values ?? {};
  for (const field of fields) {
    const source = field.name || field.label;
    const name = prose(field.label || source);
    if (Object.hasOwn(example, name)) {
      review.push(
        "A form has ambiguous repeated field labels; review input bindings before replay.",
      );
      return;
    }
    const value =
      field.type === "radio" && Object.hasOwn(values, source)
        ? values[source] === field.value
        : values[source];
    if (
      !["string", "number", "boolean"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value)) ||
      String(value).length > 2000
    ) {
      review.push(
        "An observed form input cannot be represented as a scalar fixed example; review this journey before replay.",
      );
      return;
    }
    example[name] = value;
  }
  if (Object.keys(example).length > 20) {
    review.push(
      "An observed form exceeds the framework's 20-field fixed example limit; review this journey before replay.",
    );
    return;
  }
  return example;
}

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
class CoveredControl extends DiscoveryError {}

async function clickControl(element: ElementHandle): Promise<void> {
  // A native trial performs scrolling/actionability checks without dispatching a
  // click. It catches coverage that only becomes apparent after scrolling.
  try {
    await element.click({ trial: true, timeout: 400 });
  } catch (error) {
    if (message(error).includes("intercepts pointer events"))
      throw new CoveredControl(
        "Control is covered after scrolling; click was not performed",
        {
          reason: "covered control after scrolling",
          error: message(error),
        },
      );
    // A moving control can outlast the short trial. Preserve Playwright's normal
    // wait for this case; no actual click has been attempted yet.
    if (!(error instanceof Error) || error.name !== "TimeoutError") throw error;
  }
  await element.click();
}

async function submit(
  page: Page,
  step: Json,
  allows: (url: string) => boolean,
  hooks: Json,
  scratch: Json,
  state: DiscoveryState,
): Promise<Json> {
  const snapshot = await state.snapshot(step.source);
  if (identity(snapshot) !== step.source)
    throw new DiscoveryError(
      "Discovery replay source changed; form was not submitted",
    );
  const form = snapshot.forms[step.form];
  if (!form || !allows(form.action))
    throw new DiscoveryError("Form action is outside discovery scope");
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
    throw new DiscoveryError("Form submission skipped by discovery hook");
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
      if (!input) throw new DiscoveryError("Form control disappeared");
      if (field.tag === "select")
        await input.selectOption(
          Array.isArray(value) ? value.map(String) : String(value),
        );
      else if (field.type === "checkbox") {
        if (typeof value !== "boolean")
          throw new DiscoveryError("Checkbox values must be booleans");
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
      (step.submitter === undefined || field.index === step.submitter) &&
      field.visible &&
      !field.disabled &&
      ["submit", "image"].includes(field.type),
  );
  if (!submitField)
    throw new DiscoveryError(
      "Form has no observable submit control; provide a discovery hook",
    );
  if (submitField.action && !allows(submitField.action))
    throw new DiscoveryError("Submit control is outside scope");
  const submitHandle = await page.evaluateHandle(
    ({ form, index }) => document.forms[form].elements[index],
    { form: step.form, index: submitField.index },
  );
  try {
    const submitter = submitHandle.asElement();
    if (!submitter) throw new DiscoveryError("Submit control disappeared");
    await clickControl(submitter);
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
  state: DiscoveryState,
): Promise<void> {
  if (step.kind === "form") {
    step.values = await submit(page, step, allows, hooks, scratch, state);
    return;
  }
  const snapshot = await state.snapshot(step.source);
  if (identity(snapshot) !== step.source)
    throw new DiscoveryError(
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
      throw new DiscoveryError("Discovery link changed or left scope");
    if (!link.actionable)
      throw new CoveredControl("Link is covered; action was not performed", {
        reason: "covered control",
      });
    const handle = await page.evaluateHandle(
      (index) => document.querySelectorAll("a[href]")[index],
      link.dom_index,
    );
    try {
      const element = handle.asElement();
      if (!element) throw new DiscoveryError("Discovery link disappeared");
      await clickControl(element);
    } finally {
      await handle.dispose();
    }
  } else if (step.kind === "select") {
    const select = snapshot.selects.find(
      (item: Json) => item.index === step.index,
    );
    if (
      !select ||
      select.label !== step.label ||
      select.disabled ||
      !select.actionable ||
      !select.options.some(
        (option: Json) => option.value === step.value && !option.disabled,
      )
    )
      throw new DiscoveryError("Discovery selection changed or is unavailable");
    const handle = await page.evaluateHandle<HTMLSelectElement>(
      `(${SELECTS})()[${step.index}]`,
    );
    try {
      const element = handle.asElement();
      if (!element) throw new DiscoveryError("Discovery select disappeared");
      await element.selectOption(step.value);
    } finally {
      await handle.dispose();
    }
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
      throw new DiscoveryError("Discovery control changed or is unavailable");
    if (!button.actionable)
      throw new CoveredControl("Control is covered; action was not performed", {
        reason: "covered control",
      });
    const handle = await page.evaluateHandle<HTMLElement>(
      `(${BUTTONS})()[${step.index}]`,
    );
    try {
      const element = handle.asElement();
      if (!element) throw new DiscoveryError("Discovery control disappeared");
      await clickControl(element);
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
  if (options.browser && "cdp_url" in options.browser)
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
    ["maxStateVariants", options.maxStateVariants ?? 4, 1, 100],
    ["timeoutMs", options.timeoutMs ?? 10000, 100, 120000],
    ["settleMs", options.settleMs ?? 300, 0, 10000],
    ["maxJsonBytes", options.maxJsonBytes ?? 1048576, 1, 10485760],
    ["maxNetworkRequests", options.maxNetworkRequests ?? 1000, 1, 10000],
  ] as const) {
    if (!Number.isInteger(value) || value < min || value > max)
      throw new Error(`${label} must be ${min}–${max}`);
  }
  if ((options.settleMs ?? 300) >= (options.timeoutMs ?? 10000))
    throw new Error("settleMs must be less than timeoutMs");
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
  const { output, inventoryPath, artifactRoot } = discoveryPaths(
    options.output,
  );
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
    version: 3,
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
    actions: [],
    limits: {
      max_pages: maxPages,
      max_actions: maxActions,
      max_state_variants: options.maxStateVariants ?? 4,
    },
    operations: 0,
    review: [
      "Observed labels and HTML constraints are provisional. Add independent business rules and data sets.",
      "Button exploration is opt-in; review side effects before enabling it. Open shadow roots are inspected; closed roots require hooks.",
      "States are grouped by URL, page labels/headings, alerts, control disabled status, links and standalone selections; changing body/form data are evidence, not separate states.",
    ],
  };
  const hooks = options.hooks ? await loadHooks(options.hooks) : {};
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
  const families = new Map<string, number>();
  const readiness = new Map<string, DiscoveryState>();
  const actions = new Map<string, Json>();
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
            inventory.stop_reason =
              Object.keys(inventory.pages).length >= maxPages
                ? "state budget"
                : "action budget";
            crawler.stop();
            throw new Error("Discovery budget reached");
          }
          inventory.operations++;
          const action = actions.get(request.uniqueKey);
          if (action) action.status = "running";
          readiness.set(
            request.uniqueKey,
            new DiscoveryState(
              page,
              options.settleMs ?? 300,
              options.timeoutMs ?? 10000,
            ),
          );
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
            intent: data.intent ?? "Inspect seed URL",
            steps: data.steps ?? [],
            action_id: request.uniqueKey,
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
          const state = readiness.get(request.uniqueKey)!;
          for (const step of data.steps ?? []) {
            inventory.operations++;
            await replayStep(page, step, allows, hooks, scratch, state);
          }
          if (!allows(page.url()))
            throw new DiscoveryError("Page left discovery scope");
          const snapshot = await state.snapshot();
          const id = identity(snapshot);
          snapshot.url = canonical(snapshot.url);
          inventory.pages[id] ??= snapshot;
          capture.record.state = id;
          const action = actions.get(request.uniqueKey);
          if (action)
            Object.assign(action, {
              status: "executed",
              target: id,
              visit: capture.record.id,
            });
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
          if (!expanded.has(id)) {
            expanded.add(id);
            const family = stateFamily(snapshot),
              variants = families.get(family) ?? 0;
            const deferred =
              data.depth >= depth
                ? "depth limit"
                : variants >= (options.maxStateVariants ?? 4)
                  ? "state variant limit"
                  : undefined;
            if (!deferred) families.set(family, variants + 1);
            const enqueue = async (
              step: Json,
              intent: string,
              kind: string,
              reason = deferred,
            ) => {
              const steps = [...(data.steps ?? []), step];
              const key = "action:" + hash([id, step]);
              if (actions.has(key)) return;
              const action: Json = {
                id: key,
                source: id,
                url: snapshot.url,
                depth: data.depth + 1,
                intent,
                kind,
                step,
                replay_steps: steps.length,
                status: reason ? "deferred" : "queued",
                ...(reason ? { reason } : {}),
              };
              actions.set(key, action);
              inventory.actions.push(action);
              if (reason) return;
              await queue.addRequest({
                url: request.url,
                uniqueKey: key,
                userData: {
                  depth: data.depth + 1,
                  source: id,
                  steps,
                  intent,
                  kind,
                },
              });
            };
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
                const submitters = form.fields.filter(
                  (field: Json) =>
                    field.visible &&
                    !field.disabled &&
                    ["submit", "image"].includes(field.type),
                );
                // A form can offer different journeys, such as Cancel and Continue.
                // Replay the exact submit control rather than always choosing the first.
                for (const submitter of submitters.length
                  ? submitters
                  : [undefined]) {
                  const formDeferred = options.excludeButtons?.includes(
                    submitter?.label,
                  )
                    ? "excluded control"
                    : submitter?.actionable === false ||
                        form.fields.some(
                          (field: Json) =>
                            editableField(field) && field.actionable === false,
                        )
                      ? "covered control"
                      : deferred;
                  const step = {
                    kind: "form",
                    source: id,
                    form: form.index,
                    submitter: submitter?.index,
                    values,
                  };
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
                    formDeferred,
                  );
                  if (options.probeEmptyForms) {
                    const empty: Json = { ...values };
                    for (const field of form.fields) {
                      if (!editableField(field) || field.type === "radio")
                        continue;
                      if (
                        field.tag === "select" &&
                        !field.options.some(
                          (option: Json) => option.value === "",
                        )
                      )
                        continue;
                      empty[field.name || field.label] =
                        field.type === "checkbox" ? false : "";
                    }
                    await enqueue(
                      { ...step, values: empty },
                      `Submit ${label} with all editable text fields empty.`,
                      "empty form probe; outcome requires review",
                      formDeferred,
                    );
                  }
                }
              }
            if (options.submitForms !== false && !sitemap)
              for (const select of snapshot.selects)
                if (!select.disabled)
                  for (const option of select.options)
                    if (
                      !option.disabled &&
                      !select.values.includes(option.value)
                    )
                      await enqueue(
                        {
                          kind: "select",
                          source: id,
                          index: select.index,
                          label: select.label,
                          value: option.value,
                        },
                        `Select ${prose(option.label)} for ${prose(select.label)}.`,
                        "native selection",
                        select.actionable ? deferred : "covered control",
                      );
            for (const control of [
              ...snapshot.links,
              ...snapshot.buttons,
              ...snapshot.selects,
            ])
              if (control.actionable === false)
                inventory.blocked.push({
                  source: id,
                  label: control.label,
                  reason:
                    "Control is covered; revisit after dismissing the overlay",
                });
            const linked = new Set<string>();
            for (const [index, link] of [...snapshot.links.entries()].sort(
              (a, b) => Number(b[1].actionable) - Number(a[1].actionable),
            ))
              if (
                !link.download &&
                allows(link.url) &&
                !linked.has(hash([link.label, link.url]))
              ) {
                linked.add(hash([link.label, link.url]));
                await enqueue(
                  {
                    kind: "link",
                    source: id,
                    index,
                    label: link.label,
                    url: link.url,
                  },
                  `Click the link labelled "${prose(link.label)}".`,
                  "executed hyperlink",
                  link.actionable ? deferred : "covered control",
                );
              }
            if (
              options.clickButtons &&
              !sitemap &&
              options.submitForms !== false
            )
              for (const button of snapshot.buttons)
                if (!button.disabled && !button.href && !button.submit)
                  await enqueue(
                    {
                      kind: "button",
                      source: id,
                      index: button.index,
                      label: button.label,
                    },
                    `Click the control labelled "${prose(button.label)}".`,
                    "executed control",
                    options.excludeButtons?.includes(button.label)
                      ? "excluded control"
                      : button.actionable
                        ? deferred
                        : "covered control",
                  );
          }
        } catch (error) {
          if (error instanceof CoveredControl) {
            const action = actions.get(request.uniqueKey);
            if (action)
              Object.assign(action, {
                status: "deferred",
                reason: error.result.reason,
                diagnostic: error.result.error,
                visit: capture.record.id,
              });
            capture.record.deferred = error.result;
            inventory.blocked.push({
              source: data.source,
              intent: data.intent,
              reason: error.result.reason,
              visit: capture.record.id,
            });
            return;
          }
          capture.record.error = message(error);
          if (error instanceof DiscoveryError)
            capture.record.diagnostic = error.result;
          throw error;
        } finally {
          readiness.get(request.uniqueKey)?.close();
          readiness.delete(request.uniqueKey);
          await capture.finish();
          captures.delete(request.uniqueKey);
        }
      },
      failedRequestHandler: async ({ request }, error) => {
        if (!request.userData.budget_pending)
          inventory.failed.push({
            url: request.url,
            source: request.userData.source,
            intent: request.userData.intent,
            action_id: request.uniqueKey,
            visit: inventory.visits.find(
              (visit: Json) => visit.action_id === request.uniqueKey,
            )?.id,
            error: message(error),
          });
        const action = actions.get(request.uniqueKey);
        if (action && !request.userData.budget_pending)
          Object.assign(action, { status: "failed", error: message(error) });
        readiness.get(request.uniqueKey)?.close();
        readiness.delete(request.uniqueKey);
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
    for (const url of seeds) {
      const action: Json = {
        id: "url:" + url,
        source: null,
        url,
        depth: 0,
        intent: "Inspect seed URL",
        kind: "seed",
        replay_steps: 0,
        status: "queued",
      };
      actions.set(action.id, action);
      inventory.actions.push(action);
    }
    await crawler.run(
      seeds.map((url) => ({
        url,
        uniqueKey: "url:" + url,
        userData: { depth: 0, steps: [] },
      })),
    );
    if (!Object.keys(inventory.pages).length)
      throw new DiscoveryError("No pages could be inspected", {
        failed: inventory.failed,
        blocked: inventory.blocked,
      });
    inventory.pending = inventory.actions
      .filter(
        (action: Json) =>
          action.status === "queued" ||
          action.status === "running" ||
          action.status === "deferred",
      )
      .map((action: Json) => ({
        ...action,
        reason: action.reason ?? inventory.stop_reason ?? "crawl stopped",
      }));
    if (inventory.pending.length)
      inventory.review.push(
        `${inventory.pending.length} known actions remain unexecuted; inspect pending for individual reasons. This is a bounded draft, not complete coverage.`,
      );
    inventory.suggested_data_sets = suggestedDataSets(inventory.pages);
    const model = buildModel(
      inventory.pages,
      inventory.transitions,
      inventory.review,
    );
    inventory.artifact_root = basename(artifactRoot);
    const reportPath = join(artifactRoot, "index.html");
    await writeDiscoveryReport(
      model,
      [{ inventory, path: inventoryPath, artifactDirectory: artifactStage }],
      {
        output: join(artifactStage, "index.html"),
        baseDirectory: artifactRoot,
        modelPath: output,
      },
    );
    await mkdir(dirname(output), { recursive: true });
    await rename(artifactStage, artifactRoot);
    await writeFile(output, JSON.stringify(model, null, 2) + "\n", {
      flag: "wx",
    });
    await writeFile(inventoryPath, JSON.stringify(inventory, null, 2) + "\n", {
      flag: "wx",
    });
    return {
      model,
      inventory,
      output,
      inventory_path: inventoryPath,
      report_path: reportPath,
    };
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
