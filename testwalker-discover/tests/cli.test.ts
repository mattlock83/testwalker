import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadBrowserSettings } from "../src/config.js";

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
