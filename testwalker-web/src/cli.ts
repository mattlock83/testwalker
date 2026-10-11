#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "./server.js";
import { discoverUrl, discoverSitemap } from "./discovery.js";
import { loadBrowserSettings, DEFAULT_THRESHOLD, httpUrl } from "./config.js";
import type { Json } from "./types.js";

export function argumentsFor(argv: string[]): {
  command: string;
  values: Json;
  native: string[];
} {
  const first = argv.shift() ?? "help";
  const command = ["--help", "-h"].includes(first) ? "help" : first,
    values: Json = {},
    native: string[] = [];
  const flags = new Set([
    "headed",
    "debug",
    "plan",
    "no-submit-forms",
    "click-buttons",
    "probe-empty-forms",
    "no-screenshots",
    "no-network",
  ]);
  const fields = new Set([
    "directory",
    "url",
    "sitemap",
    "config",
    "browser-config",
    "app",
    "hooks",
    "port",
    "model",
    "framework",
    "output",
    "max-calls",
    "threshold",
    "cdp-url",
    "strategy-provider",
    "depth",
    "max-pages",
    "max-actions",
    "max-state-variants",
    "timeout-ms",
    "settle-ms",
    "values",
    "max-json-bytes",
    "max-network-requests",
    "exclude-buttons",
  ]);
  while (argv.length) {
    const arg = argv.shift()!,
      [key, ...inline] = arg.replace(/^--/, "").split("=");
    if (arg === "--help" || arg === "-h") {
      values.help = true;
      continue;
    }
    if (arg.startsWith("--") && flags.has(key)) {
      values[key] = true;
      continue;
    }
    if (arg.startsWith("--") && fields.has(key)) {
      const value = inline.length ? inline.join("=") : argv.shift();
      if (value === undefined || value.startsWith("--"))
        throw new Error(`Missing value for --${key}`);
      values[key] = value;
      continue;
    }
    native.push(arg);
  }
  return { command, values, native };
}
async function childRun(
  executable: string,
  args: string[],
  config: Json,
): Promise<number> {
  const child = spawn(executable, args, {
    stdio: ["pipe", "inherit", "inherit"],
  });
  const complete = new Promise<number>((resolve, reject) => {
    child.stdin.on("error", reject);
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 2));
  });
  const interrupt = () => child.kill("SIGINT"),
    terminate = () => child.kill("SIGTERM");
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", terminate);
  try {
    child.stdin.end(JSON.stringify(config) + "\n");
    return await complete;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
const HELP = `Testwalker web adapter (Node.js + Playwright + Jev; no Python or MCP)

testwalker-web demo --directory DEMO [--config RUN_JSON] [--app APP.ts] [--hooks HOOKS.ts] [--headed]
testwalker-web run --model MODEL --url URL --config RUN_JSON [--hooks HOOKS.ts]
testwalker-web plan --model MODEL [--config RUN_JSON]
testwalker-web serve --directory SITE [--app APP.ts] [--port 4173]
testwalker-web discover-url --url URL --output MODEL.json [--depth 1] [--values VALUES.json] [--hooks HOOKS.ts]
testwalker-web discover-sitemap --sitemap SITEMAP.xml --output MODEL.json

Native execution: --framework EXECUTABLE, --browser-config BROWSER.json, --max-calls N,
--threshold N (default 0.80), --strategy-provider INPUTS.ts, --output DIRECTORY.
Graph/Hegel/replay flags pass to Rust, e.g. --max-input-attempts 2 --generator new_york_street_sweeper.
Discovery: --click-buttons --probe-empty-forms --max-pages N --max-actions N --max-state-variants N (default 4)
--settle-ms N --timeout-ms N --no-submit-forms --no-screenshots --no-network.
Discovery never calls Jev. All tests, verdicts, HTML/JSON/JUnit and replay are owned by Rust.
`;
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const { command, values: v, native } = argumentsFor([...argv]);
  if (command === "help" || v.help) {
    console.log(HELP);
    return 0;
  }
  if (command === "serve") {
    if (!v.directory) throw new Error("Supply --directory SITE");
    const server = await serve(v.directory, Number(v.port ?? 4173), v.app);
    console.log(`Website: ${server.url}/`);
    await new Promise<void>((resolve) => {
      const stop = () => {
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
        resolve();
      };
      process.on("SIGINT", stop);
      process.on("SIGTERM", stop);
    });
    await server.close();
    return 0;
  }
  if (command.startsWith("discover-")) {
    if (!["discover-url", "discover-sitemap"].includes(command) || !v.output)
      throw new Error("Supply discovery mode and --output MODEL.json");
    const options = {
      output: v.output,
      headed: Boolean(v.headed),
      depth: Number(v.depth ?? 1),
      maxPages: Number(v["max-pages"] ?? 50),
      maxActions: Number(v["max-actions"] ?? 200),
      maxStateVariants: Number(v["max-state-variants"] ?? 4),
      timeoutMs: Number(v["timeout-ms"] ?? 10000),
      settleMs: Number(v["settle-ms"] ?? 300),
      maxJsonBytes: Number(v["max-json-bytes"] ?? 1048576),
      maxNetworkRequests: Number(v["max-network-requests"] ?? 1000),
      submitForms: !v["no-submit-forms"],
      clickButtons: Boolean(v["click-buttons"]),
      excludeButtons: v["exclude-buttons"]
        ?.split(",")
        .map((label: string) => label.trim()),
      probeEmptyForms: Boolean(v["probe-empty-forms"]),
      screenshots: !v["no-screenshots"],
      network: !v["no-network"],
      browser: await loadBrowserSettings(v["browser-config"]),
      hooks: v.hooks,
      values: v.values
        ? JSON.parse(await readFile(v.values, "utf8"))
        : undefined,
    };
    const result =
      command === "discover-url"
        ? await discoverUrl(httpUrl(v.url), options)
        : await discoverSitemap(v.sitemap, options);
    console.log(`Draft: ${result.output}\nInventory: ${result.inventory_path}`);
    return 0;
  }
  if (!["run", "demo", "plan"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  const directory = v.directory ? resolve(v.directory) : undefined;
  if (command === "demo" && !directory)
    throw new Error("Supply --directory DEMO");
  const model = v.model
    ? resolve(v.model)
    : directory
      ? join(directory, "model.json")
      : undefined;
  if (!model) throw new Error("Supply --model MODEL");
  const planning = command === "plan" || Boolean(v.plan);
  const configPath =
    v.config ??
    (directory
      ? join(directory, planning ? "run.json.example" : "run.local.json")
      : undefined);
  const config: Json = configPath
    ? JSON.parse(await readFile(configPath, "utf8"))
    : {};
  if (
    native.includes("--keep-target-open") ||
    config.options?.keep_target_open
  ) {
    throw new Error(
      "The TypeScript adapter does not support --keep-target-open; use --headed and report screenshots",
    );
  }
  config.target ??= {};
  config.target.limits ??= {};
  if (v["max-actions"] !== undefined)
    config.target.limits.actions_per_journey = Number(v["max-actions"]);
  if (v["max-calls"] !== undefined) {
    config.decision ??= {};
    config.decision.max_calls = Number(v["max-calls"]);
  }
  if (v.threshold !== undefined) {
    config.decision ??= {};
    config.decision.threshold = Number(v.threshold);
  }
  config.target.limits.confidence =
    config.decision?.threshold ?? DEFAULT_THRESHOLD;
  config.target.limits.model_calls = config.decision?.max_calls ?? 1000;
  config.options ??= {};
  config.options.evaluator ??= "adapter";
  if (
    !planning &&
    (!config.decision?.api_key || config.decision.api_key === "your-jev-key")
  ) {
    throw new Error(
      "Set decision.api_key in the native run JSON configuration",
    );
  }
  let server: Awaited<ReturnType<typeof serve>> | undefined;
  try {
    if (!planning) {
      if (command === "demo") {
        server = await serve(
          join(directory!, "site"),
          Number(v.port ?? 4173),
          v.app,
        );
        config.target.url = server.url + "/";
        console.log(`Website: ${config.target.url}`);
      } else config.target.url = httpUrl(v.url);
    }
    const args = ["run", "--model", model, "--config", "-", ...native];
    if (planning) args.push("--plan");
    else {
      const adapter = fileURLToPath(new URL("./main.js", import.meta.url));
      args.push("--adapter", process.execPath, "--adapter-arg=" + adapter);
      const browserConfig =
        v["browser-config"] ??
        (directory ? join(directory, "browser.json") : undefined);
      for (const [key, value] of [
        ["config", browserConfig],
        ["hooks", v.hooks],
        ["cdp-url", v["cdp-url"]],
        ["strategy-provider", v["strategy-provider"]],
      ])
        if (value)
          args.push(
            `--adapter-arg=--${key}`,
            `--adapter-arg=${resolveOrUrl(key, value)}`,
          );
      for (const flag of ["headed", "debug"])
        if (v[flag]) args.push(`--adapter-arg=--${flag}`);
      const output =
        v.output ??
        (directory
          ? join(dirname(directory), "artifacts", directory.split("/").at(-1)!)
          : "artifacts");
      args.push("--output", resolve(output));
      if (v["strategy-provider"]) args.push("--custom-strategies");
    }
    return await childRun(
      v.framework ?? process.env.TESTWALKER_BIN ?? "testwalker",
      args,
      config,
    );
  } finally {
    await server?.close();
  }
}
function resolveOrUrl(key: string, value: string): string {
  return key === "cdp-url" ? httpUrl(value) : resolve(value);
}
if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  }
}
