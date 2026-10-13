import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrowserSettings } from "../src/config.js";
import { buildModel } from "../src/discovery.js";

const bin = fileURLToPath(
  new URL("../../node_modules/.bin/testwalker-discover", import.meta.url),
);
test("Standalone installed CLI needs no framework or decision key and rejects unknown options", () => {
  const help = spawnSync(process.execPath, [bin, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /no Jev or Rust needed/);
  assert.match(help.stdout, /index.html/);
  const bad = spawnSync(
    process.execPath,
    [bin, "discover-url", "--max-call", "10"],
    { encoding: "utf8" },
  );
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /Unknown option/);
});
test("Discovery browser configuration has its own launch/context schema", async () => {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-config-"));
  try {
    const file = join(temp, "browser.json");
    await writeFile(
      file,
      JSON.stringify({
        launch: { executablePath: "./chrome" },
        context: { viewport: { width: 800, height: 600 } },
      }),
    );
    const settings = await loadBrowserSettings(file);
    assert.equal(settings.launch?.executablePath, join(temp, "chrome"));
    for (const invalid of [
      { cdp_url: "http://localhost:9222" },
      { context: [] },
      null,
    ]) {
      await writeFile(file, JSON.stringify(invalid));
      await assert.rejects(loadBrowserSettings(file));
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("Report CLI finds run-local assets and defaults beside the timestamped inventory", async () => {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-run-"));
  const run = join(temp, "artifact", "2026-10-13T02-19-25.969Z-49708-0");
  const inventoryPath = join(run, "site.discovery.json"),
    modelPath = join(temp, "site.model.json");
  try {
    const pages = {
      home: {
        url: "https://example.test/",
        title: "Home",
        headings: ["Home"],
        forms: [],
        buttons: [],
        alerts: [],
      },
    };
    const inventory = {
      seeds: ["https://example.test/"],
      pages,
      transitions: [],
      artifact_root: ".",
      visits: [
        {
          id: "visit-0001",
          state: "home",
          artifacts: { "network.json": "visit-0001/network.json" },
        },
      ],
    };
    await mkdir(join(run, "visit-0001"), { recursive: true });
    await writeFile(inventoryPath, JSON.stringify(inventory));
    await writeFile(modelPath, JSON.stringify(buildModel(pages, [], [])));
    await writeFile(
      join(run, "visit-0001/network.json"),
      JSON.stringify({
        requests: [
          {
            url: "https://example.test/api",
            method: "GET",
            response: {
              status: 200,
              body: { status: "captured", value: { synthetic: true } },
            },
          },
        ],
      }),
    );
    for (const output of [undefined, join(temp, "rebuilt", "index.html")]) {
      const result = spawnSync(
        process.execPath,
        [
          bin,
          "report",
          "--inventory",
          inventoryPath,
          "--model",
          modelPath,
          ...(output ? ["--output", output] : []),
        ],
        { encoding: "utf8" },
      );
      assert.equal(result.status, 0, result.stderr);
      const html = await readFile(output ?? join(run, "index.html"), "utf8");
      const data = JSON.parse(
        html.match(/type="application\/json">([\s\S]*?)<\/script>/)![1],
      );
      assert.equal(
        data.model,
        output ? "../site.model.json" : "../../site.model.json",
      );
      assert.equal(
        data.runs[0].inventory,
        output
          ? "../artifact/2026-10-13T02-19-25.969Z-49708-0/site.discovery.json"
          : "site.discovery.json",
      );
      assert.equal(
        data.visits[0].network.href,
        output
          ? "../artifact/2026-10-13T02-19-25.969Z-49708-0/visit-0001/network.json"
          : "visit-0001/network.json",
      );
      assert.match(
        data.visits[0].network.requests[0].response.body.preview,
        /synthetic/,
      );
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
