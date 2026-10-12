import { createHash } from "node:crypto";
import type { Page, Request } from "playwright";
import { SNAPSHOT } from "./discovery-snapshot.js";
import { DiscoveryError, type Json } from "./types.js";

export const discoveryHash = (value: unknown): string =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);

export function stateIdentity(page: Json): string {
  return (
    "page_" +
    discoveryHash({
      url: page.url,
      title: page.title,
      headings: page.headings,
      page_label: page.page_label,
      alerts: page.alerts,
      buttons: page.buttons.map((b: Json) => [b.label, b.role, b.disabled]),
      links: page.links?.map((link: Json) => [link.label, link.url]),
      forms: page.forms.map((form: Json) => ({
        label: form.label,
        fields: form.fields.map((f: Json) => [
          f.label,
          f.type,
          f.disabled,
          f.readonly,
          f.required,
        ]),
      })),
      selects: page.selects?.map((s: Json) => [
        s.label,
        s.values,
        s.options,
        s.disabled,
      ]),
    })
  );
}

// Only expansion is bounded by this coarse family. Distinct observed states and
// their incoming journeys are retained, with unexpanded actions listed explicitly.
export function stateFamily(page: Json): string {
  return discoveryHash({
    url: page.url,
    headings: page.headings,
    page_label: page.page_label,
    links: page.links
      .map((link: Json) => [link.label.replace(/\d+/g, "#"), link.url])
      .sort((a: string[], b: string[]) =>
        JSON.stringify(a).localeCompare(JSON.stringify(b)),
      ),
    forms: page.forms.map((form: Json) => ({
      label: form.label,
      fields: form.fields.map((f: Json) => [f.label, f.type]),
    })),
    selects: page.selects.map((s: Json) => [s.label, s.options]),
    buttons: page.buttons.map((b: Json) => [b.role, b.type, b.submit]),
  });
}

/** Bounded structural settling, rather than a fixed sleep after every action. */
export class DiscoveryState {
  private readonly active = new Set<Request>();
  private readonly requested = (request: Request) => {
    if (["document", "script", "fetch", "xhr"].includes(request.resourceType()))
      this.active.add(request);
  };
  private readonly finished = (request: Request) => this.active.delete(request);

  constructor(
    private readonly page: Page,
    private readonly quietMs: number,
    private readonly timeoutMs: number,
  ) {
    page.on("request", this.requested);
    page.on("requestfinished", this.finished);
    page.on("requestfailed", this.finished);
  }

  async snapshot(expected?: string): Promise<Json> {
    const deadline = Date.now() + this.timeoutMs;
    let signature = "",
      quietSince = Date.now();
    let latest: Json | undefined;
    while (Date.now() <= deadline) {
      // A navigation can destroy the execution context between load and inspection.
      try {
        latest = await this.page.evaluate(`(${SNAPSHOT})()`);
      } catch (error) {
        if (!String(error).includes("Execution context was destroyed"))
          throw error;
        signature = "";
        latest = undefined;
      }
      if (latest) {
        const current = discoveryHash({
          state: stateIdentity(latest),
          busy: latest.busy,
          exposure: [...latest.buttons, ...latest.links, ...latest.selects].map(
            (control: Json) => control.actionable,
          ),
          fields: latest.forms.map((form: Json) =>
            form.fields.map((field: Json) => [field.value, field.checked]),
          ),
        });
        if (current !== signature || this.active.size || latest.busy) {
          quietSince = Date.now();
          signature = current;
        }
        if (
          !this.active.size &&
          !latest.busy &&
          Date.now() - quietSince >= this.quietMs &&
          (!expected || stateIdentity(latest) === expected)
        )
          return latest;
      }
      await this.page.waitForTimeout(
        Math.min(50, Math.max(1, deadline - Date.now())),
      );
    }
    throw new DiscoveryError(
      expected
        ? "Discovery replay source did not become ready; action was not performed"
        : "Discovery UI did not settle within the timeout; state was not expanded",
      {
        expected,
        observed: latest && stateIdentity(latest),
        active_requests: this.active.size,
        busy: latest?.busy ?? false,
        observation: latest,
      },
    );
  }

  close(): void {
    this.page.off("request", this.requested);
    this.page.off("requestfinished", this.finished);
    this.page.off("requestfailed", this.finished);
  }
}
