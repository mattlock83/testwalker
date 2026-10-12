import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { buildModel } from "../src/discovery.js";
import { writeDiscoveryReport } from "../src/report.js";
import type { Json } from "../src/types.js";

async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-report-"));
  const malicious = "</script><script>globalThis.injected=true</script>";
  const pages = {
    entry: {
      url: "https://example.test/",
      title: "Entry",
      headings: ["Entry"],
      forms: [],
      buttons: [],
      alerts: [],
    },
    form: {
      url: "https://example.test/form",
      title: malicious,
      headings: [malicious],
      forms: [],
      buttons: [],
      alerts: [],
    },
  };
  const transitions = [
    {
      source: "entry",
      target: "form",
      intent: "Follow Form.",
      visit: "visit-0001",
    },
  ];
  const model = buildModel(pages, transitions, []);
  const path = join(temp, "draft.discovery.json"),
    artifacts = join(temp, "draft.discovery");
  await mkdir(join(artifacts, "visit-0001"), { recursive: true });
  const inventory: Json = {
    seeds: ["https://example.test/"],
    pages,
    transitions,
    operations: 2,
    limits: { max_actions: 2 },
    stop_reason: "action budget",
    artifact_root: "draft.discovery",
    review: [malicious],
    failed: [
      {
        source: "entry",
        visit: "visit-0001",
        intent: "Follow Form.",
        error: "Replay unsettled",
      },
    ],
    actions: [
      {
        status: "deferred",
        source: "form",
        intent: "Choose Save.",
        reason: "action budget",
      },
    ],
    pending: [
      {
        status: "deferred",
        source: "form",
        intent: "Choose Save.",
        reason: "action budget",
      },
    ],
    visits: [
      {
        id: "visit-0001",
        source: "entry",
        state: "form",
        url: pages.form.url,
        intent: "Follow Form.",
        steps: [{ kind: "link", label: "Form" }],
        capture_errors: [],
        artifacts: {
          "network.json": "visit-0001/network.json",
          "screenshot.png": "javascript:alert(1)",
        },
      },
    ],
  };
  await writeFile(path, JSON.stringify(inventory));
  await writeFile(
    join(artifacts, "visit-0001/network.json"),
    JSON.stringify({
      requests: [
        {
          url: "https://example.test/data",
          method: "GET",
          response: {
            status: 200,
            body: {
              status: "captured",
              value: { unsafe: malicious, big: "a".repeat(4000) },
            },
          },
        },
      ],
      omitted_requests: 0,
    }),
  );
  const modelPath = join(temp, "draft.json");
  await writeFile(modelPath, JSON.stringify(model));
  return { temp, malicious, model, modelPath, inventory, path, artifacts };
}

test("Offline report combines visit IDs safely, bounds JSON previews, and uses relative evidence links", async () => {
  const f = await fixture();
  try {
    const output = join(f.temp, "overview", "index.html");
    await writeDiscoveryReport(
      f.model,
      [
        { path: f.path, inventory: f.inventory },
        { path: f.path, inventory: f.inventory },
      ],
      { output, modelPath: f.modelPath },
    );
    const html = await readFile(output, "utf8");
    assert.ok(
      !html.includes(f.malicious),
      "Captured text cannot terminate a script",
    );
    const data = JSON.parse(
      html.match(/type="application\/json">([\s\S]*?)<\/script>/)![1],
    );
    assert.equal(data.visits.length, 2);
    assert.notEqual(data.visits[0].key, data.visits[1].key);
    assert.deepEqual(data.edges[0].visits, ["0/visit-0001", "1/visit-0001"]);
    assert.equal(
      data.visits[0].network.href,
      "../draft.discovery/visit-0001/network.json",
    );
    assert.equal(
      data.visits[0].screenshot,
      undefined,
      "Unsafe artifact references are rejected",
    );
    assert.equal(
      data.visits[0].network.requests[0].response.body.preview.length,
      2000,
    );
    assert.equal(
      data.visits[0].network.requests[0].response.body.truncated,
      true,
    );
    assert.equal(data.review[0], f.malicious);
    await assert.rejects(
      writeDiscoveryReport(f.model, [], { output }),
      /EEXIST/,
    );
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test(
  "Viewer works from file without network: graph, search, tabs and JSON evidence",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const f = await fixture();
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const output = join(f.artifacts, "index.html");
      await writeDiscoveryReport(
        f.model,
        [{ path: f.path, inventory: f.inventory }],
        { output, modelPath: f.modelPath },
      );
      const context = await browser.newContext({ offline: true });
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(output).href);
      await page
        .getByRole("heading", { name: "See what discovery found." })
        .waitFor();
      assert.equal(await page.locator("#stats .stat").count(), 6);
      assert.equal(await page.locator("#graph-svg .node").count(), 2);
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      assert.equal(
        await page
          .locator("#graph")
          .evaluate((graph) => graph.scrollHeight <= graph.clientHeight + 1),
        true,
      );
      await page.locator("#graph-svg .node").nth(1).click();
      assert.match(await page.locator("#list-count").innerText(), /1 items/);
      await page.getByRole("button", { name: "Clear graph filter" }).click();
      await page.getByRole("tab", { name: "Journeys 1" }).click();
      await page.locator("#list button").first().click();
      assert.match(await page.locator("#detail").innerText(), /Follow Form/);
      assert.equal(
        await page
          .locator("#detail a", { hasText: "Open full network JSON" })
          .getAttribute("href"),
        "visit-0001/network.json",
      );
      await page.getByRole("tab", { name: "Deferred 1" }).click();
      await page.locator("#list button").click();
      assert.match(await page.locator("#detail").innerText(), /action budget/);
      await page.getByRole("tab", { name: "Issues 1" }).click();
      await page.locator("#list button").click();
      assert.match(
        await page.locator("#detail").innerText(),
        /Replay unsettled/,
      );
      await page.getByRole("tab", { name: "States 2" }).click();
      await page.getByRole("searchbox").fill("/form");
      assert.equal(await page.locator("#list button").count(), 1);
      await page.locator("#graph-mode").selectOption("states");
      assert.equal(await page.locator("#graph-svg .node").count(), 2);
      assert.equal(
        await page.evaluate(() => (globalThis as any).injected),
        undefined,
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
      await rm(f.temp, { recursive: true, force: true });
    }
  },
);

test("Merged entry aliases retain returned visits and journey evidence in the viewer", async () => {
  const f = await fixture();
  try {
    const page = {
      url: "https://example.test/",
      title: "Home",
      headings: ["Home"],
      forms: [],
      buttons: [],
      alerts: [],
    };
    f.inventory.pages = {
      entry: page,
      returned: { ...page, url: "https://example.test/#home" },
    };
    f.inventory.transitions = [
      {
        source: "entry",
        target: "returned",
        intent: "Follow Home.",
        visit: "visit-0001",
      },
    ];
    f.inventory.visits[0].state = "returned";
    const model = buildModel(f.inventory.pages, f.inventory.transitions, []);
    const output = join(f.temp, "aliases", "index.html");
    await writeDiscoveryReport(
      model,
      [{ inventory: f.inventory, path: f.path }],
      { output },
    );
    const html = await readFile(output, "utf8");
    const data = JSON.parse(
      html.match(/type="application\/json">([\s\S]*?)<\/script>/)![1],
    );
    assert.equal(data.nodes.length, 1);
    assert.equal(data.visits[0].state, "entry");
    assert.equal(data.visits[0].observed_state, "returned");
    assert.deepEqual(data.edges[0].visits, ["0/visit-0001"]);
    assert.equal(f.inventory.visits[0].state, "returned");
    assert.equal(
      data.runs[0].states,
      2,
      "Raw observation count remains separate from model states",
    );
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
