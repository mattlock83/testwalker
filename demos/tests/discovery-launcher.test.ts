import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const demos = fileURLToPath(new URL("..", import.meta.url));
const sites = [
  "hello-world",
  "booking",
  "feedback",
  "controls",
  "trailhead",
  "saucedemo",
];
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "discovery launcher "));
  const cli = join(temp, "discovery cli.mjs"),
    capture = join(temp, "capture.json");
  await writeFile(
    cli,
    `import { writeFile } from 'node:fs/promises';
const args = process.argv.slice(2), options = {};
for (let i=1; i<args.length; i++) {
  const [flag, ...value] = args[i].split('=');
  options[flag] = value.length ? value.join('=') : args[i+1]?.startsWith('--') ? true : args[++i];
}
if (!options['--help']) {
  if (process.env.SITE !== 'saucedemo') {
    const response = await fetch(options['--url']);
    if (!response.ok) process.exit(98);
    if (process.env.SITE === 'trailhead') {
      const state = await (await fetch(new URL('api/trailhead/state', options['--url']))).json();
      if (state.bookings.length) process.exit(97);
    }
  }
  await writeFile(process.env.CAPTURE, JSON.stringify({args, options}));
}
process.exit(Number(process.env.RESULT ?? 0));
`,
  );
  return { temp, cli, capture };
}

for (const site of sites) {
  test(`${site} discovery script hosts its site, forwards options and cleans up without Jev`, async () => {
    const f = await fixture();
    try {
      const child = spawn(
        join(demos, site, "discover.sh"),
        [
          "--headed",
          "--depth",
          "0",
          "--exclude-buttons",
          "Label with spaces,Another label",
        ],
        {
          cwd: f.temp,
          env: {
            ...process.env,
            TESTWALKER_DISCOVER_CLI: f.cli,
            SITE: site,
            CAPTURE: f.capture,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.stdout.resume();
      const [code] = await once(child, "exit");
      assert.equal(code, 0, stderr);
      const { options, args } = JSON.parse(await readFile(f.capture, "utf8"));
      assert.equal(args[0], "discover-url");
      assert.equal(options["--depth"], "0");
      assert.equal(options["--headed"], true);
      assert.equal(
        options["--exclude-buttons"],
        "Label with spaces,Another label",
      );
      assert.equal(dirname(options["--output"]), join(demos, site));
      assert.match(options["--output"], /discovered-.*\.model\.json$/);
      assert.ok(!args.includes("--app"));
      if (site === "saucedemo") {
        assert.equal(options["--url"], "https://www.saucedemo.com/");
        assert.equal(
          options["--values"],
          join(demos, site, "discovery/values.json"),
        );
      } else await assert.rejects(fetch(options["--url"]));
    } finally {
      await rm(f.temp, { recursive: true, force: true });
    }
  });
}

test("Discovery script preserves failure status and stops its server with explicit output and port overrides", async () => {
  const f = await fixture();
  try {
    const child = spawn(
      join(demos, "trailhead/discover.sh"),
      ["--output=custom model.json", "--port=0"],
      {
        cwd: f.temp,
        env: {
          ...process.env,
          TESTWALKER_DISCOVER_CLI: f.cli,
          SITE: "trailhead",
          CAPTURE: f.capture,
          RESULT: "2",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    child.stdout.resume();
    child.stderr.resume();
    const [code] = await once(child, "exit");
    assert.equal(code, 2);
    const { options } = JSON.parse(await readFile(f.capture, "utf8"));
    assert.equal(options["--output"], "custom model.json");
    await assert.rejects(fetch(options["--url"]));
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});

test("Discovery script help starts no local site and needs no provider configuration", () => {
  for (const site of sites) {
    const result = spawnSync(join(demos, site, "discover.sh"), ["--help"], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Web Discover/);
    assert.match(result.stdout, /web-discover discover-url --url URL/);
    assert.ok(!result.stdout.includes("Website:"));
  }
});

test("Stopping discovery terminates the child and releases the local server", async () => {
  const f = await fixture();
  try {
    await writeFile(
      f.cli,
      `import { writeFile } from 'node:fs/promises';
const args = process.argv.slice(2), url = args[args.indexOf('--url') + 1];
await writeFile(process.env.CAPTURE, JSON.stringify({url}));
console.log('ready'); setInterval(() => {}, 1000);
`,
    );
    const child = spawn(join(demos, "hello-world/discover.sh"), [], {
      env: {
        ...process.env,
        TESTWALKER_DISCOVER_CLI: f.cli,
        CAPTURE: f.capture,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const exited = once(child, "exit");
    const ready = new Promise<void>((resolve) => {
      child.stdout.on("data", (chunk) => {
        if (String(chunk).includes("ready")) resolve();
      });
    });
    child.stderr.resume();
    try {
      await ready;
      const { url } = JSON.parse(await readFile(f.capture, "utf8"));
      assert.equal((await fetch(url)).status, 200);
      child.kill("SIGTERM");
      assert.equal((await exited)[0], 143);
      await assert.rejects(fetch(url));
    } finally {
      if (child.exitCode === null) child.kill("SIGTERM");
      await exited;
    }
  } finally {
    await rm(f.temp, { recursive: true, force: true });
  }
});
