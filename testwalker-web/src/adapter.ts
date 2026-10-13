import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BrowserTarget } from "./browser.js";
import { Hooks, StrategyProvider, type HookContext } from "./extensions.js";
import { Decisions, Oracle } from "./oracle.js";
import { loadBrowserSettings } from "./config.js";
import {
  Defect,
  Inconclusive,
  message,
  states,
  edges,
  type Json,
  type Model,
  type Rpc,
} from "./types.js";

export interface AdapterOptions {
  config?: string;
  hooks?: string;
  strategyProvider?: string;
  headed?: boolean;
  cdpUrl?: string;
}
export class WebAdapter {
  private model?: Model;
  private url = "";
  browser?: BrowserTarget;
  private oracle?: Oracle;
  private hooks = new Hooks();
  private strategy = new StrategyProvider();
  private report: Json = {};
  private byId: Record<string, Json> = {};
  private active?: Json;
  private traceStart = 0;
  private hookStart = 0;
  private screenshotCount = 0;
  private screenshots = true;
  private closed = false;
  private artifacts?: Json[];
  constructor(
    readonly core: Rpc,
    readonly options: AdapterOptions = {},
  ) {}
  async load(): Promise<void> {
    this.hooks = await Hooks.load(this.options.hooks);
    this.strategy = await StrategyProvider.load(this.options.strategyProvider);
  }
  async call(method: string, params: Json): Promise<any> {
    switch (method) {
      case "target.strategy":
        return this.strategy.build(params.context, params.default);
      case "run.event":
        return this.event(params.type, params.data);
      case "target.initialize": {
        if (this.model)
          throw new Inconclusive("Web adapter already initialized");
        if (params.protocol_version !== "1")
          throw new Inconclusive("Unsupported adapter protocol version");
        const validated = await this.core.request("model.validate", {
          model: params.model,
        });
        this.model = validated.document;
        this.url = params.config.url;
        this.screenshots = params.config.screenshots ?? true;
        const settings = await loadBrowserSettings(this.options.config);
        if (this.options.cdpUrl) settings.cdp_url = this.options.cdpUrl;
        this.browser = new BrowserTarget(
          this.core,
          settings,
          this.options.headed,
          params.config.limits,
        );
        await this.browser.start();
        this.oracle = new Oracle(
          new Decisions(this.core, this.browser.threshold),
          this.model!,
        );
        return {
          capabilities: {
            screenshots: true,
            isolated_checkpoints: false,
            evaluator: "web",
            artifacts: true,
          },
        };
      }
      case "target.reset":
        await this.requireBrowser().reset(this.url);
        return {};
      case "target.execute":
        await this.requireBrowser().execute(
          params,
          async (page) => (await this.oracle!.identify(page)).observed,
        );
        return { executed: true };
      case "target.observe":
        return this.requireBrowser().observe();
      case "target.evaluate":
        return this.requireBrowser().measure("evaluation", () =>
          this.oracle!.check(
            params.observation,
            params.expected,
            params.input,
            params.violations,
          ),
        );
      case "target.audit":
        return this.requireBrowser().measure("audit", () =>
          this.oracle!.audit(params.records, params.rules),
        );
      case "target.hook": {
        if (!this.model && params.event === "after_run") return {};
        if (params.event === "after_run" && params.context.result)
          Object.assign(this.report, params.context.result);
        await this.hooks.fire(params.event, this.context(params.context));
        return {};
      }
      case "target.close":
        await this.close(params.keep_open);
        return {};
      case "target.artifacts":
        return this.artifactPage(params);
      default:
        throw new Inconclusive(`Unsupported web callback: ${method}`);
    }
  }
  private requireBrowser(): BrowserTarget {
    if (!this.browser)
      throw new Inconclusive("Framework has not initialized the browser");
    return this.browser;
  }
  private context(values: Json): HookContext {
    if (!this.model)
      throw new Inconclusive("Framework has not initialized the model");
    const error = values.error
      ? new (values.error.status === "FAIL" ? Defect : Inconclusive)(
          values.error.message,
          values.error.result,
        )
      : undefined;
    const model = structuredClone(this.model);
    return {
      model,
      states: states(model),
      edges: edges(model),
      core: this.core,
      url: this.url,
      page: this.browser?.page,
      phase: values.phase ?? "graph",
      walk: values.walk,
      element: structuredClone(values.element),
      element_id: values.element?.id,
      data: structuredClone(values.data ?? {}),
      invalid: structuredClone(values.invalid ?? []),
      result: structuredClone(values.result),
      error,
      report: structuredClone(this.report),
      scratch: this.hooks.scratch,
      check(condition, description) {
        if (!condition) throw new Defect(description);
      },
    };
  }
  private async screenshot(): Promise<Json> {
    if (!this.screenshots || !this.report.directory) return {};
    const relative = `screenshots/${String(++this.screenshotCount).padStart(6, "0")}.png`;
    try {
      await mkdir(join(this.report.directory, "screenshots"), {
        recursive: true,
      });
      if (!this.browser?.page) throw new Error("No test tab to capture");
      await this.browser.measure("screenshot", () =>
        this.browser!.page!.screenshot({
          path: join(this.report.directory, relative),
        }),
      );
      return { screenshot: relative, screenshot_at: new Date().toISOString() };
    } catch (error) {
      return { screenshot_error: message(error) };
    }
  }
  private async event(type: string, data: Json): Promise<Json> {
    const snapshot = structuredClone(data);
    switch (type) {
      case "planned":
        this.report = snapshot;
        this.byId = Object.fromEntries(
          snapshot.tests.map((test: Json) => [test.id, test]),
        );
        console.error(
          `Planned ${snapshot.tests.length} tests. Inventory: ${snapshot.directory ?? "(memory)"}`,
        );
        break;
      case "test.begin":
        this.active = this.byId[data.id];
        this.traceStart = this.browser?.trace.length ?? 0;
        this.hookStart = this.hooks.events.length;
        if (this.active)
          Object.assign(this.active, snapshot, { attempt_indices: [] });
        break;
      case "step":
        this.report.steps.push(snapshot);
        break;
      case "step.result":
        Object.assign(this.report.steps[data.index], snapshot.entry);
        console.error(`${data.entry.status} · ${data.entry.name}`);
        break;
      case "case": {
        const attachments =
          data.attempted === false ? {} : await this.screenshot();
        this.active?.attempt_indices.push(this.report.cases.length);
        this.report.cases.push({ ...snapshot, ...attachments });
        console.error(
          `${data.status} · ${data.source} · ${JSON.stringify(data.input)}`,
        );
        return attachments;
      }
      case "test.end": {
        const attachments: Json = {
          trace_range: [this.traceStart, this.browser?.trace.length ?? 0],
          hook_range: [this.hookStart, this.hooks.events.length],
        };
        if (this.active?.kind === "graph" && data.status !== "SKIPPED")
          Object.assign(attachments, await this.screenshot());
        if (this.active?.kind === "property") {
          const attempts: Json[] = this.active.attempt_indices
            .map((i: number) => this.report.cases[i])
            .filter((entry: Json) => entry.attempted !== false);
          const selected =
            attempts.findLast((entry) => entry.status === data.status) ??
            attempts.at(-1);
          for (const key of ["screenshot", "screenshot_at", "screenshot_error"])
            if (selected?.[key]) attachments[key] = selected[key];
        }
        if (this.active) Object.assign(this.active, snapshot, attachments);
        this.active = undefined;
        return attachments;
      }
      default:
        throw new Inconclusive(`Unknown framework event: ${type}`);
    }
    return {};
  }
  private artifactPage(params: Json): Json {
    const { offset, limit } = params;
    if (
      !Number.isInteger(offset) ||
      offset < 0 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 128
    ) {
      throw new Inconclusive(
        "Artifact pages require offset >= 0 and limit 1–128",
      );
    }
    this.artifacts ??= [
      ...(this.browser?.trace ?? []).map((data) => ({ kind: "trace", data })),
      {
        kind: "trace",
        data: {
          operation: "performance",
          timings: this.browser?.timings ?? {},
        },
      },
      ...this.hooks.events.map((data) => ({ kind: "hook", data })),
    ];
    if (offset > this.artifacts.length)
      throw new Inconclusive("Artifact offset outside captured evidence");
    const end = Math.min(offset + limit, this.artifacts.length);
    return {
      entries: this.artifacts.slice(offset, end),
      next_offset: end < this.artifacts.length ? end : null,
      ...(offset === 0 ? { metadata: { hooks: this.hooks.metadata } } : {}),
    };
  }
  async close(keepOpen = false): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (keepOpen && !this.options.headed) {
      await this.browser?.close();
      throw new Inconclusive("Keeping a browser open requires --headed");
    }
    await this.browser?.close(keepOpen);
  }
}
