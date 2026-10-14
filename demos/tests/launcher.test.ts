import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, chmod, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { once } from "node:events";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const demos = fileURLToPath(new URL("..", import.meta.url));
async function run(
  script: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  cwd: string,
) {
  const child = spawn(script, args, {
    env,
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const [code] = await once(child, "exit");
  return { code, stdout, stderr };
}

for (const code of [0, 1, 2])
  test(`Sauce Demo test script targets the external site and preserves exit ${code}`, async () => {
    const temp = await mkdtemp(join(tmpdir(), "sauce-launcher-"));
    try {
      const framework = join(temp, "framework"),
        capture = join(temp, "capture.json"),
        config = join(temp, "run.json");
      await writeFile(
        framework,
        `#!/usr/bin/env node
const fs = require('node:fs');
(async () => {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  fs.writeFileSync(process.env.CAPTURE, JSON.stringify({ args: process.argv.slice(2), config: JSON.parse(input) }));
  process.exit(Number(process.env.RESULT));
})();\n`,
      );
      await chmod(framework, 0o755);
      await writeFile(
        config,
        JSON.stringify({ decision: { api_key: "synthetic-key" } }),
      );
      const result = await run(
        join(demos, "saucedemo/test.sh"),
        ["--config", config, "--headed"],
        {
          ...process.env,
          TESTWALKER_BIN: framework,
          CAPTURE: capture,
          RESULT: String(code),
        },
        temp,
      );
      assert.equal(result.code, code, result.stderr);
      const observed = JSON.parse(await readFile(capture, "utf8"));
      assert.equal(observed.args[0], "run");
      assert.ok(observed.args.includes(join(demos, "saucedemo/model.json")));
      assert.equal(observed.config.target.url, "https://www.saucedemo.com/");
      assert.equal(
        observed.args[observed.args.indexOf("--input-mode") + 1],
        "none",
      );
      assert.ok(observed.args.includes("--adapter-arg=--headed"));
      assert.ok(!result.stdout.includes("Website:"));
      assert.ok(
        !(result.stdout + result.stderr + observed.args.join(" ")).includes(
          "synthetic-key",
        ),
      );
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
async function freePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, "127.0.0.1");
  await once(socket, "listening");
  const port = (socket.address() as any).port;
  const closed = once(socket, "close");
  socket.close();
  await closed;
  return port;
}
for (const site of [
  "hello-world",
  "booking",
  "feedback",
  "controls",
  "trailhead",
]) {
  for (const code of [0, 1, 2])
    for (const headed of [false, true])
      test(`${site} launcher: exit ${code}, headed ${headed}, cleanup and secret-free argv`, async () => {
        const temp = await mkdtemp(join(tmpdir(), "testwalker-launcher-"));
        const port = await freePort();
        const framework = join(temp, "framework with spaces"),
          capture = join(temp, "capture.json"),
          config = join(temp, "run.json");
        try {
          await writeFile(
            framework,
            `#!/usr/bin/env node
const fs = require('node:fs');
(async () => {
  let input = ''; for await (const chunk of process.stdin) input += chunk;
  const config = JSON.parse(input);
  const response = await fetch(config.target.url); if (!response.ok) process.exit(99);
  const html = await response.text(); if (!html.includes(process.env.TITLE)) process.exit(98);
  if (process.env.SITE === 'trailhead') { const state = await (await fetch(config.target.url + 'api/trailhead/state')).json(); if (state.bookings.length) process.exit(97); }
  fs.writeFileSync(process.env.CAPTURE, JSON.stringify({args: process.argv.slice(2), config}));
  process.exit(Number(process.env.RESULT));
})();\n`,
          );
          await chmod(framework, 0o755);
          await writeFile(
            config,
            JSON.stringify({
              decision: {
                api_key: "synthetic-key",
                threshold: 0.8,
                max_calls: 42,
              },
            }),
          );
          const result = await run(
            join(demos, site, "test.sh"),
            [
              "--config",
              config,
              "--port",
              String(port),
              ...(headed
                ? [
                    "--headed",
                    "--threshold",
                    "0.75",
                    "--max-calls",
                    "50",
                    "--max-input-attempts",
                    "2",
                  ]
                : []),
            ],
            {
              ...process.env,
              TESTWALKER_BIN: framework,
              CAPTURE: capture,
              RESULT: String(code),
              SITE: site,
              TITLE: {
                "hello-world": "Hello world",
                booking: "Fieldnotes",
                feedback: "Studio inbox",
                controls: "Controls lab",
                trailhead: "TRAILHEAD",
              }[site],
            },
            temp,
          );
          assert.equal(result.code, code, result.stderr);
          const observed = JSON.parse(await readFile(capture, "utf8"));
          assert.equal(observed.args[0], "run");
          assert.ok(observed.args.includes(join(demos, site, "model.json")));
          assert.ok(
            observed.args.includes(
              "--adapter-arg=" +
                fileURLToPath(import.meta.resolve("@testwalker/web/adapter")),
            ),
          );
          assert.equal(
            observed.args.includes("--adapter-arg=--headed"),
            headed,
          );
          assert.equal(
            observed.args.includes("--adapter-arg=--hooks"),
            site === "trailhead",
          );
          if (site === "trailhead")
            assert.ok(
              observed.args.includes(
                "--adapter-arg=" + join(demos, site, "hooks.ts"),
              ),
            );
          const confidence = headed ? 0.75 : 0.8,
            calls = headed ? 50 : 42;
          assert.deepEqual(observed.config.target.limits, {
            confidence,
            model_calls: calls,
          });
          assert.equal(observed.config.decision.threshold, confidence);
          assert.equal(observed.config.decision.max_calls, calls);
          assert.ok(
            !(result.stdout + result.stderr + observed.args.join(" ")).includes(
              "synthetic-key",
            ),
          );
          await assert.rejects(fetch(`http://127.0.0.1:${port}/`));
        } finally {
          await rm(temp, { recursive: true, force: true });
        }
      });
  test(`${site} plan needs no API key, server or browser`, async () => {
    const temp = await mkdtemp(join(tmpdir(), "testwalker-plan-"));
    try {
      const framework = join(temp, "framework");
      await writeFile(framework, '#!/bin/sh\nprintf "%s\\n" "$@"\n');
      await chmod(framework, 0o755);
      const result = await run(
        join(demos, site, "test.sh"),
        ["--plan"],
        { ...process.env, TESTWALKER_BIN: framework },
        temp,
      );
      assert.equal(result.code, 0, result.stderr);
      assert.match(result.stdout, /--plan/);
      assert.ok(!result.stdout.includes("Website:"));
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
}
