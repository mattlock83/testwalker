import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm, chmod, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { loadBrowserSettings } from "../src/config.js";

test("Browser settling configuration rejects impossible waits and supports disabling the wait", async () => {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-browser-config-"));
  const path = join(temp, "browser.json");
  try {
    for (const invalid of [
      { settle_ms: -1 },
      { settle_ms: 1.5 },
      { settle_timeout_ms: 0 },
      { settle_ms: 300, settle_timeout_ms: 200 },
      { settle_timeout_ms: 100 },
    ]) {
      await writeFile(path, JSON.stringify(invalid));
      await assert.rejects(loadBrowserSettings(path), /settle_/);
    }
    await writeFile(
      path,
      JSON.stringify({ settle_ms: 0, settle_timeout_ms: 1 }),
    );
    assert.deepEqual(await loadBrowserSettings(path), {
      settle_ms: 0,
      settle_timeout_ms: 1,
    });
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("The installed symlink CLI prints help and rejects unsupported retention before starting a target", () => {
  const bin = fileURLToPath(
    new URL("../../node_modules/.bin/testwalker-web", import.meta.url),
  );
  const help = spawnSync(process.execPath, [bin, "--help"], {
    encoding: "utf8",
  });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Playwright \+ Jev/);
  const run = spawnSync(
    process.execPath,
    [bin, "run", "--model", "model.json", "--keep-target-open"],
    { encoding: "utf8" },
  );
  assert.equal(run.status, 2);
  assert.match(run.stderr, /does not support/);
});

test("Web CLI delegates model-local output defaults to Rust and preserves explicit output overrides", async () => {
  const temp = await realpath(
    await mkdtemp(join(tmpdir(), "testwalker-output-")),
  );
  const framework = join(temp, "framework"),
    config = join(temp, "run.json");
  const bin = fileURLToPath(
    new URL("../../node_modules/.bin/testwalker-web", import.meta.url),
  );
  try {
    await writeFile(
      framework,
      "#!/usr/bin/env node\n(async()=>{for await (const chunk of process.stdin) {} process.stdout.write(JSON.stringify(process.argv.slice(2)));})();\n",
    );
    await chmod(framework, 0o755);
    await writeFile(
      config,
      JSON.stringify({ decision: { api_key: "synthetic-key" } }),
    );
    // The supplied model is outside the optional demo directory and invocation cwd.
    const model = join(temp, "external model.json");
    await writeFile(model, "{}");
    for (const output of [undefined, "custom output"]) {
      const run = spawnSync(
        process.execPath,
        [
          bin,
          "run",
          "--directory",
          join(temp, "demo"),
          "--model",
          model,
          "--url",
          "http://localhost:3000/",
          "--config",
          config,
          "--framework",
          framework,
          ...(output ? ["--output", output] : []),
        ],
        { cwd: temp, encoding: "utf8" },
      );
      assert.equal(run.status, 0, run.stderr);
      const args: string[] = JSON.parse(run.stdout);
      assert.equal(args[args.indexOf("--model") + 1], model);
      const index = args.indexOf("--output");
      if (output) assert.equal(args[index + 1], join(temp, output));
      else
        assert.equal(
          index,
          -1,
          "The launcher must not replace the native model-local default",
        );
    }
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test("Initial callbacks wait for async TypeScript module loading; hook console output cannot corrupt stdout", async () => {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-adapter-startup-"));
  await writeFile(join(temp, "package.json"), '{"type":"module"}');
  await writeFile(
    join(temp, "hooks.ts"),
    'await new Promise(resolve => setTimeout(resolve, 50)); console.log("loaded hooks"); export function before_run() {}',
  );
  const child = spawn(process.execPath, [
    fileURLToPath(new URL("../dist/main.js", import.meta.url)),
    "--hooks",
    join(temp, "hooks.ts"),
  ]);
  let stderr = "";
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const exited = once(child, "exit");
  try {
    const reply = once(child.stdout, "data");
    child.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "run.event",
        params: {
          type: "planned",
          data: { tests: [], steps: [], cases: [] },
        },
      }) + "\n",
    );
    const [bytes] = await reply;
    assert.deepEqual(JSON.parse(bytes.toString()), {
      jsonrpc: "2.0",
      id: 1,
      result: {},
    });
    child.stdin.end();
    assert.equal((await exited)[0], 0);
    assert.match(stderr, /loaded hooks/);
  } finally {
    child.kill();
    await rm(temp, { recursive: true, force: true });
  }
});
