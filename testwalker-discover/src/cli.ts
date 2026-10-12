import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import {
  discoverUrl,
  discoverSitemap,
  buildModel,
  type DiscoveryOptions,
} from "./discovery.js";
import { httpUrl, loadBrowserSettings } from "./config.js";
import { writeDiscoveryReport, type ReportRun } from "./report.js";
import type { Json, Model } from "./types.js";

const HELP = `Testwalker discovery — standalone Crawlee + Playwright; no Jev or Rust needed.

testwalker-discover discover-url --url URL --output SITE.model.json [--depth 1]
testwalker-discover discover-sitemap --sitemap SITEMAP.xml --output SITE.model.json
testwalker-discover report --inventory INVENTORY.json [--inventory ANOTHER.json] [--model MODEL.json] [--output index.html]

Discovery writes a model, inventory, screenshots, JSON network evidence, and
SITE.discovery/index.html. Model filenames always end in .model.json;
inventory files end in .discovery.json. Open the report directly; no server is needed.

Exploration: --depth N --max-pages N --max-actions N --max-state-variants N
--click-buttons --probe-empty-forms --exclude-buttons 'Label,Other label'
--no-submit-forms --values VALUES.json --hooks HOOKS.ts
Browser: --headed --browser-config BROWSER.json --timeout-ms N --settle-ms N
Evidence: --no-screenshots --no-network --max-json-bytes N --max-network-requests N
Output files must not already exist. Discovery records behaviour for review;
it does not determine application pass/fail or generate independent business rules.
`;
const stringOptions = [
  "url",
  "output",
  "sitemap",
  "depth",
  "max-pages",
  "max-actions",
  "max-state-variants",
  "timeout-ms",
  "settle-ms",
  "exclude-buttons",
  "values",
  "hooks",
  "browser-config",
  "max-json-bytes",
  "max-network-requests",
  "model",
];
const booleanOptions = [
  "headed",
  "click-buttons",
  "probe-empty-forms",
  "no-submit-forms",
  "no-screenshots",
  "no-network",
  "help",
];
export async function main(argv = process.argv.slice(2)): Promise<number> {
  const command = argv[0] ?? "help";
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    allowPositionals: false,
    options: {
      ...Object.fromEntries(
        stringOptions.map((name) => [name, { type: "string" as const }]),
      ),
      ...Object.fromEntries(
        booleanOptions.map((name) => [name, { type: "boolean" as const }]),
      ),
      help: { type: "boolean", short: "h" },
      inventory: { type: "string", multiple: true },
    },
  });
  const v = values as Json;
  if (["help", "--help", "-h"].includes(command) || v.help) {
    console.log(HELP);
    return 0;
  }
  if (positionals.length) throw new Error("Unexpected positional arguments");
  if (command === "report") {
    if (!v.inventory?.length)
      throw new Error("Supply --inventory INVENTORY.json");
    const runs: ReportRun[] = await Promise.all(
      v.inventory.map(async (path: string) => ({
        path: resolve(path),
        inventory: JSON.parse(await readFile(path, "utf8")),
      })),
    );
    for (const { inventory } of runs) {
      if (
        !inventory.pages ||
        !Array.isArray(inventory.visits) ||
        !Array.isArray(inventory.transitions)
      )
        throw new Error(
          "Supply a discovery inventory, not the model or summary",
        );
    }
    if (
      new Set(runs.map((run) => JSON.stringify(run.inventory.seeds))).size !== 1
    )
      throw new Error("Combined reports must share the same seeds");
    const pages = Object.assign({}, ...runs.map((run) => run.inventory.pages));
    const model: Model = v.model
      ? JSON.parse(await readFile(v.model, "utf8"))
      : buildModel(
          pages,
          runs.flatMap((run) => run.inventory.transitions),
          [],
        );
    const output =
      v.output ??
      join(
        dirname(runs[0].path),
        runs[0].inventory.artifact_root ??
          basename(runs[0].path).replace(/\.discovery\.json$/, ".discovery"),
        "index.html",
      );
    const report = await writeDiscoveryReport(model, runs, {
      output,
      modelPath: v.model,
    });
    console.log(`Report: ${report}`);
    return 0;
  }
  if (!["discover-url", "discover-sitemap"].includes(command))
    throw new Error(`Unknown command: ${command}`);
  if (!v.output) throw new Error("Supply --output MODEL.json");
  const number = (key: string, fallback: number) =>
    v[key] === undefined ? fallback : Number(v[key]);
  const options: DiscoveryOptions = {
    output: v.output,
    headed: Boolean(v.headed),
    depth: number("depth", 1),
    maxPages: number("max-pages", 50),
    maxActions: number("max-actions", 200),
    maxStateVariants: number("max-state-variants", 4),
    timeoutMs: number("timeout-ms", 10000),
    settleMs: number("settle-ms", 300),
    maxJsonBytes: number("max-json-bytes", 1048576),
    maxNetworkRequests: number("max-network-requests", 1000),
    clickButtons: Boolean(v["click-buttons"]),
    probeEmptyForms: Boolean(v["probe-empty-forms"]),
    submitForms: !v["no-submit-forms"],
    screenshots: !v["no-screenshots"],
    network: !v["no-network"],
    excludeButtons: v["exclude-buttons"]
      ?.split(",")
      .map((label: string) => label.trim()),
    hooks: v.hooks,
    browser: await loadBrowserSettings(v["browser-config"]),
    values: v.values ? JSON.parse(await readFile(v.values, "utf8")) : undefined,
  };
  const result =
    command === "discover-url"
      ? await discoverUrl(httpUrl(v.url), options)
      : await discoverSitemap(v.sitemap, options);
  console.log(
    `GraphWalker model: ${result.output}\nDiscovery inventory: ${result.inventory_path}\nReport: ${result.report_path}`,
  );
  return 0;
}
