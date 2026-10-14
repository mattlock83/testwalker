import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { frameworkPath, workerPath } from "../index.js";

test("Native package resolves its own CLI and worker without PATH", () => {
  assert.match(frameworkPath(), /native[/\\]testwalker(?:\.exe)?$/);
  assert.match(workerPath(), /native[/\\]testwalker-core(?:\.exe)?$/);
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../bin/testwalker.js", import.meta.url)), "--help"],
    { encoding: "utf8", env: { ...process.env, PATH: "" } },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /testwalker run/);
  const worker = spawnSync(
    process.execPath,
    [fileURLToPath(new URL("../bin/testwalker-core.js", import.meta.url))],
    {
      encoding: "utf8",
      input:
        '{"jsonrpc":"2.0","id":1,"method":"core.info","params":{}}\n{"jsonrpc":"2.0","id":2,"method":"core.shutdown","params":{}}\n',
      env: { ...process.env, PATH: "" },
    },
  );
  assert.equal(worker.status, 0, worker.stderr);
  assert.equal(JSON.parse(worker.stdout.trim().split("\n")[0]).id, 1);
});

test("Missing and incompatible native builds give actionable package errors", async () => {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-package-errors-"));
  try {
    await mkdir(join(temp, "node"));
    await writeFile(join(temp, "package.json"), '{"type":"module"}');
    await copyFile(
      new URL("../index.js", import.meta.url),
      join(temp, "node/index.js"),
    );
    const probe = [
      "--input-type=module",
      "-e",
      "import {frameworkPath} from './node/index.js'; frameworkPath();",
    ];
    const missing = spawnSync(process.execPath, probe, {
      cwd: temp,
      encoding: "utf8",
    });
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /not built.*npm run build/);
    await mkdir(join(temp, "native"));
    await writeFile(
      join(temp, "native/platform.json"),
      '{"platform":"other-os","arch":"other-arch"}',
    );
    const incompatible = spawnSync(process.execPath, probe, {
      cwd: temp,
      encoding: "utf8",
    });
    assert.equal(incompatible.status, 1);
    assert.match(
      incompatible.stderr,
      /built for other-os\/other-arch; rebuild/,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
