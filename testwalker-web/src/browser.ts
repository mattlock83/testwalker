import {
  chromium,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import { playjev, type ActResult, type PlayJevPage } from "@filed/playjev";
import { DecisionBridge } from "./bridge.js";
import type { BrowserSettings } from "./config.js";
import { DEFAULT_THRESHOLD, httpUrl } from "./config.js";
import { Inconclusive, type Json, type Rpc } from "./types.js";
import { observe } from "./observation.js";

export class BrowserTarget {
  browser?: Browser;
  context?: BrowserContext;
  page?: Page;
  private actor?: PlayJevPage;
  private bridge: DecisionBridge;
  private owned = false;
  readonly trace: Json[] = [];
  readonly threshold: number;
  readonly maxActions: number;
  constructor(
    readonly core: Rpc,
    readonly settings: BrowserSettings = {},
    readonly headed = false,
    limits: Json = {},
  ) {
    this.threshold = limits.confidence ?? DEFAULT_THRESHOLD;
    this.maxActions = limits.actions_per_journey ?? 25;
    if (
      !Number.isFinite(this.threshold) ||
      this.threshold <= 0.5 ||
      this.threshold > 1
    ) {
      throw new Error("Confidence must be above 0.5 through 1");
    }
    if (!Number.isInteger(this.maxActions) || this.maxActions < 1)
      throw new Error("Invalid action allowance");
    this.bridge = new DecisionBridge(core);
  }
  async start(): Promise<void> {
    await this.bridge.start();
    try {
      this.owned = !this.settings.cdp_url;
      this.browser = this.settings.cdp_url
        ? await chromium.connectOverCDP(this.settings.cdp_url)
        : await chromium.launch({
            channel: "chrome",
            ...this.settings.launch,
            headless: !this.headed,
          });
    } catch (error) {
      await this.bridge.close();
      throw error;
    }
  }
  private bind(page: Page): void {
    this.page = page;
    this.actor = playjev(page, {
      apiKey: this.bridge.token,
      baseUrl: this.bridge.baseUrl,
      maxRetries: 0,
      requestTimeoutMs: 120_000,
      minTargetConfidence: this.threshold,
    });
  }
  async reset(url: string): Promise<void> {
    if (!this.browser) throw new Inconclusive("Browser has not started");
    await this.context?.close();
    this.context = await this.browser.newContext({
      viewport: { width: 1120, height: 780 },
      ...this.settings.context,
    });
    this.context.setDefaultTimeout(this.settings.action_timeout_ms ?? 15_000);
    this.context.setDefaultNavigationTimeout(
      this.settings.navigation_timeout_ms ?? 30_000,
    );
    this.context.on("page", (page) => {
      this.bind(page);
      page.on("dialog", (dialog) => void dialog.dismiss());
    });
    const page = await this.context.newPage();
    this.bind(page);
    await page.goto(httpUrl(url), { waitUntil: "domcontentloaded" });
    this.trace.push({ operation: "reset", url: page.url() });
  }
  async observe(): Promise<Json> {
    if (!this.page) throw new Inconclusive("No owned test page");
    return observe(this.page);
  }
  private async act(intent: string, options: Json = {}): Promise<ActResult> {
    if (!this.actor) throw new Inconclusive("No owned test page");
    // The model defines one transition. Never let an action-verification retry
    // submit a newly reached form or advance past its modeled checkpoint.
    const result = await this.actor.act(intent, {
      maxSteps: 1,
      minTargetConfidence: this.threshold,
      minVerificationProbability: this.threshold,
      ...options,
    });
    this.trace.push({ operation: "act", intent, ...result });
    // PlayJev's action verification is diagnostic. In particular, an intentionally
    // blank field can look unchanged. Exact entry below and the framework's state
    // oracle determine the test outcome; never repair or retry invalid test data.
    if (!result.actions.length)
      throw new Inconclusive("PlayJev did not execute a browser action", {
        action: result,
      });
    if (
      result.actions.some(
        (action) => action.operationConfidence < this.threshold,
      )
    ) {
      throw new Inconclusive(
        "PlayJev operation confidence is below the configured threshold",
        { action: result },
      );
    }
    return result;
  }
  async execute(
    params: Json,
    identify: (page: Json) => Promise<string | null>,
  ): Promise<void> {
    const intent = params.edge.properties.business.intent;
    const hasFields = Object.keys(params.fields).length > 0;
    if (!hasFields) {
      // Hooks can already have completed a custom widget operation. Verify the actual state before acting.
      if (
        params.edge.sourceVertexId !== params.edge.targetVertexId &&
        (await identify(await this.observe())) === params.edge.targetVertexId
      )
        return;
      await this.act(
        intent +
          " When equivalent controls lead to the same destination, prefer the main navigation " +
          "control whose visible text most directly names this journey.",
      );
      return;
    }
    const fields = Object.fromEntries(
      Object.entries(params.fields).map(([name]) => {
        const value = params.input[name];
        if (!["string", "number", "boolean"].includes(typeof value))
          throw new Inconclusive(`Missing literal input: ${name}`);
        return [name, value];
      }),
    );
    if (Object.keys(fields).length + 1 > this.maxActions) {
      throw new Inconclusive(
        "Journey exceeds the browser action allowance before input entry",
      );
    }
    const filled = await this.act(
      "Fill the supplied business fields with their exact caller-supplied values. Do not submit.",
      { fields },
    );
    if (filled.actions.length !== Object.keys(fields).length)
      throw new Inconclusive("Not all business fields were filled");
    // Validate exact entry against runtime-resolved locators, never selectors from the model.
    for (const [index, [name, wanted]] of Object.entries(fields).entries()) {
      const action = filled.actions[index];
      let locator = this.page!.locator(action.selector);
      if (action.target.frameIndex !== undefined && action.target.selector) {
        const frame = this.page!.frames().filter(
          (frame) => frame !== this.page!.mainFrame(),
        )[action.target.frameIndex];
        if (!frame) throw new Inconclusive(`Field frame disappeared: ${name}`);
        locator = frame.locator(action.target.selector);
      }
      const actual =
        action.target.role === "checkbox"
          ? await locator.isChecked()
          : await locator.inputValue();
      const normalize = (value: unknown) =>
        params.fields[name]["trim spaces"] === false
          ? String(value)
          : String(value).trim();
      if (normalize(actual) !== normalize(wanted))
        throw new Inconclusive(
          `Browser did not enter the exact input for ${name}`,
        );
    }
    await this.act(
      `Submit the current form once without changing any field values. ${intent}`,
      { maxSteps: 1 },
    );
  }
  async close(keepOpen = false): Promise<void> {
    try {
      await this.context?.close();
      if (this.owned) await this.browser?.close();
      if (keepOpen)
        throw new Inconclusive(
          "This adapter closes its test context at exit; use --headed and the captured screenshots for inspection",
        );
    } finally {
      await this.bridge.close();
    }
  }
}
