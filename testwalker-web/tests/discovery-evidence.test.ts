import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page, Request, Response } from "playwright";
import { VisitEvidence } from "../src/discovery-evidence.js";

test("Evidence limits count only JSON exchanges, including GET responses and failed JSON requests", async () => {
  const directory = await mkdtemp(join(tmpdir(), "testwalker-json-evidence-"));
  const page = new EventEmitter();
  const record = { id: "visit-0001", artifacts: {}, capture_errors: [] };
  const evidence = new VisitEvidence(page as unknown as Page, directory, record, {
    screenshots: false,
    maxNetworkRequests: 3,
  });
  const request = (url: string, contentType = ""): Request =>
    ({
      url: () => url,
      method: () => (contentType ? "POST" : "GET"),
      resourceType: () => "fetch",
      headers: () => ({ "content-type": contentType }),
      postDataBuffer: () => (contentType ? Buffer.from('{"test":true}') : null),
      timing: () => ({ startTime: 42 }),
      failure: () => ({ errorText: "connection closed" }),
    }) as unknown as Request;
  const respond = (req: Request, contentType: string): void => {
    page.emit("response", {
      request: () => req,
      status: () => 200,
      headers: () => ({ "content-type": contentType }),
      body: async () => {
        assert.match(contentType, /json/i, "Non-JSON bodies must not be read");
        return Buffer.from('{"ok":true}');
      },
    } as unknown as Response);
    page.emit("requestfinished", req);
  };
  try {
    for (let i = 0; i < 10; i++) {
      const asset = request(`https://example.test/asset-${i}`);
      page.emit("request", asset);
      respond(asset, "text/html");
    }
    const get = request("https://example.test/data");
    page.emit("request", get);
    respond(get, "Application/JSON; charset=utf-8");
    const post = request(
      "https://example.test/submit",
      "application/problem+json",
    );
    page.emit("request", post);
    respond(post, "text/html");
    const failed = request("https://example.test/failed", "application/json");
    page.emit("request", failed);
    page.emit("requestfailed", failed);
    const omitted = request("https://example.test/omitted", "application/json");
    page.emit("request", omitted);
    respond(omitted, "application/json");
    await evidence.finish();
    const network = JSON.parse(
      await readFile(join(directory, "network.json"), "utf8"),
    );
    assert.equal(network.requests.length, 3);
    assert.equal(network.omitted_requests, 1);
    assert.deepEqual(network.requests[0].response.body.value, { ok: true });
    assert.deepEqual(network.requests[1].request_body.value, { test: true });
    assert.equal(network.requests[1].response.body.status, "not_json");
    assert.equal(network.requests[2].status, "failed");
    assert.equal(network.requests[2].failure.errorText, "connection closed");
    assert.deepEqual(await readdir(directory), ["network.json"]);
    assert.deepEqual(record.capture_errors, []);
    assert.equal(page.listenerCount("request"), 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
