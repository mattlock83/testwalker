// Verify real archives in an unrelated install: no workspace links, source paths or Cargo.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const temp = await mkdtemp(join(tmpdir(), "testwalker-local-packages-"));
try {
  const dependencies = {};
  const workspaceLock = JSON.parse(
    await readFile(join(root, "package-lock.json"), "utf8"),
  );
  const packages = Object.fromEntries(
    Object.entries(workspaceLock.packages).filter(
      ([path, entry]) => path.startsWith("node_modules/") && !entry.link,
    ),
  );
  for (const [name, directory] of [
    ["@testwalker/core", "core"],
    ["@testwalker/web", "testwalker-web"],
    ["@testwalker/discover", "testwalker-discover"],
  ]) {
    const pkg = JSON.parse(
      await readFile(join(root, directory, "package.json"), "utf8"),
    );
    const archive = join(
      root,
      ".packages",
      `testwalker-${name.split("/")[1]}-${pkg.version}.tgz`,
    );
    dependencies[name] = `file:${archive}`;
    packages[`node_modules/${name}`] = {
      version: pkg.version,
      resolved: `file:${archive}`,
      integrity:
        "sha512-" +
        createHash("sha512")
          .update(await readFile(archive))
          .digest("base64"),
      ...(pkg.dependencies ? { dependencies: pkg.dependencies } : {}),
      ...(pkg.bin ? { bin: pkg.bin } : {}),
      ...(pkg.engines ? { engines: pkg.engines } : {}),
    };
  }
  await writeFile(
    join(temp, "package.json"),
    JSON.stringify({ private: true, type: "module", dependencies }),
  );
  // Keep normal dependencies pinned to the repository lock, replacing only local packages.
  await writeFile(
    join(temp, "package-lock.json"),
    JSON.stringify({
      lockfileVersion: 3,
      requires: true,
      packages: { "": { dependencies }, ...packages },
    }),
  );
  execFileSync(
    npm,
    ["ci", "--offline", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: temp, stdio: "inherit" },
  );
  const env = { ...process.env, PATH: "" };
  delete env.TESTWALKER_BIN;
  delete env.TESTWALKER_CORE_BIN;
  await writeFile(
    join(temp, "probe.mjs"),
    `
import assert from 'node:assert/strict';
import {frameworkPath, workerPath} from '@testwalker/core';
import {CoreClient, Hooks, serve} from '@testwalker/web';
import {main as web} from '@testwalker/web/cli';
import {buildModel} from '@testwalker/discover';
import {main as discover} from '@testwalker/discover/cli';
assert.equal(typeof Hooks, 'function'); assert.equal(typeof serve, 'function');
assert.equal(typeof buildModel, 'function'); assert.equal(typeof discover, 'function');
assert.ok(frameworkPath().startsWith(process.cwd())); assert.ok(workerPath().startsWith(process.cwd()));
const core = new CoreClient();
try { assert.ok(await core.request('core.info')); } finally { await core.close(); }
assert.equal(await web(['plan', '--model', './model.json']), 0);
assert.equal(await discover(['--help']), 0);
`,
  );
  await copyFile(
    join(root, "demos/hello-world/model.json"),
    join(temp, "model.json"),
  );
  const output = execFileSync(process.execPath, ["probe.mjs"], {
    cwd: temp,
    env,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.match(output, /no Jev or Rust needed/);
  for (const command of [
    "testwalker",
    "testwalker-web",
    "testwalker-discover",
  ]) {
    const help = execFileSync(
      process.execPath,
      [join(temp, "node_modules/.bin", command), "--help"],
      { cwd: temp, env, encoding: "utf8" },
    );
    assert.ok(help.includes(command));
  }
  const selftest = execFileSync(
    process.execPath,
    [join(temp, "node_modules/.bin/testwalker"), "self-test"],
    { cwd: temp, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  assert.match(selftest, /PASS/);
  console.log(
    "Local archives passed: module imports, CLI entry points, planning, worker RPC and native self-test without PATH or checkout links.",
  );
} finally {
  await rm(temp, { recursive: true, force: true });
}
