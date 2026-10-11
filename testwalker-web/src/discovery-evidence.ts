import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page, Request, Response } from "playwright";
import { message, type Json } from "./types.js";

export function jsonBody(
  body: Buffer | null,
  contentType: string,
  limit: number,
): Json {
  const media = contentType.split(";")[0].trim().toLowerCase();
  if (media !== "application/json" && !media.endsWith("+json"))
    return { status: "not_json" };
  if (!body) return { status: "unavailable" };
  if (body.length > limit) return { status: "too_large", bytes: body.length };
  try {
    return { status: "captured", value: JSON.parse(body.toString("utf8")) };
  } catch {
    return { status: "invalid_json" };
  }
}
export class VisitEvidence {
  private requests = new Map<Request, Json>();
  private tasks: Promise<void>[] = [];
  private network: Json = { requests: [], omitted_requests: 0 };
  private finished = false;
  constructor(
    readonly page: Page,
    readonly directory: string,
    readonly record: Json,
    readonly options: Json,
  ) {
    if (options.network !== false) {
      page.on("request", this.onRequest);
      page.on("response", this.onResponse);
      page.on("requestfailed", this.onFailed);
      page.on("requestfinished", this.onFinished);
    }
  }
  private onRequest = (request: Request): void => {
    if (this.requests.size >= (this.options.maxNetworkRequests ?? 1000)) {
      this.network.omitted_requests++;
      return;
    }
    const entry = {
      id: this.requests.size + 1,
      url: request.url(),
      method: request.method(),
      resource_type: request.resourceType(),
      status: "pending",
      request_body: jsonBody(
        request.postDataBuffer(),
        request.headers()["content-type"] ?? "",
        this.options.maxJsonBytes ?? 1048576,
      ),
    };
    this.requests.set(request, entry);
    this.network.requests.push(entry);
  };
  private onResponse = (response: Response): void => {
    const entry = this.requests.get(response.request());
    if (!entry) return;
    const contentType = response.headers()["content-type"] ?? "";
    entry.response = {
      status: response.status(),
      content_type: contentType,
      body: { status: "pending" },
    };
    this.tasks.push(
      (async () => {
        let body: Json;
        try {
          const limit = this.options.maxJsonBytes ?? 1048576;
          const length = Number(response.headers()["content-length"]);
          body =
            jsonBody(null, contentType, limit).status === "not_json"
              ? { status: "not_json" }
              : length > limit
                ? { status: "too_large", bytes: length }
                : jsonBody(await response.body(), contentType, limit);
        } catch (error) {
          body = { status: "unavailable", error: message(error) };
        }
        if (!this.finished) entry.response.body = body;
      })(),
    );
  };
  private onFailed = (request: Request): void => {
    const entry = this.requests.get(request);
    if (entry)
      Object.assign(entry, { status: "failed", failure: request.failure() });
  };
  private onFinished = (request: Request): void => {
    const entry = this.requests.get(request);
    if (entry)
      Object.assign(entry, { status: "finished", timing: request.timing() });
  };
  async finish(): Promise<void> {
    if (this.finished) return;
    await mkdir(this.directory, { recursive: true });
    const capture = async (name: string, operation: () => Promise<unknown>) => {
      try {
        await operation();
        this.record.artifacts[name] = `${this.record.id}/${name}`;
      } catch (error) {
        this.record.capture_errors.push({
          artifact: name,
          error: message(error),
        });
      }
    };
    if (this.options.screenshots !== false)
      await capture("screenshot.png", () =>
        this.page.screenshot({
          path: join(this.directory, "screenshot.png"),
          fullPage: true,
          timeout: 5000,
        }),
      );
    if (this.options.dom !== false) {
      await capture("page.html", async () =>
        writeFile(join(this.directory, "page.html"), await this.page.content()),
      );
      await capture("dom.json", async () => {
        const cdp = await this.page.context().newCDPSession(this.page);
        try {
          const snapshot = await cdp.send("DOMSnapshot.captureSnapshot", {
            computedStyles: [],
            includeDOMRects: true,
          });
          await writeFile(
            join(this.directory, "dom.json"),
            JSON.stringify(snapshot),
          );
        } finally {
          await cdp.detach();
        }
      });
    }
    if (this.options.network !== false) {
      this.page.off("request", this.onRequest);
      this.page.off("response", this.onResponse);
      this.page.off("requestfailed", this.onFailed);
      this.page.off("requestfinished", this.onFinished);
      let timer: NodeJS.Timeout | undefined;
      try {
        await Promise.race([
          Promise.allSettled(this.tasks),
          new Promise((resolve) => {
            timer = setTimeout(resolve, 2000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
      this.finished = true;
      for (const entry of this.network.requests) {
        if (entry.status === "pending") entry.status = "incomplete";
        if (entry.response?.body.status === "pending")
          entry.response.body = { status: "incomplete" };
      }
      await capture("network.json", () =>
        writeFile(
          join(this.directory, "network.json"),
          JSON.stringify(this.network, null, 2),
        ),
      );
    }
    this.finished = true;
    this.record.captured_at = new Date().toISOString();
  }
}
