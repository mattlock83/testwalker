// Combine tool-generated inventories without authoring rules or browser interactions.
import { access, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { buildModel } from "web-discover";

const [output, summaryOutput, ...inputs] = process.argv.slice(2);
if (!output || !summaryOutput || !inputs.length)
  throw new Error(
    "Usage: node combine.mjs MODEL.json SUMMARY.json INVENTORY.json [...]",
  );
for (const path of [output, summaryOutput]) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === "ENOENT") continue;
    throw error;
  }
  throw new Error(`Output already exists: ${path}`);
}
const inventories = await Promise.all(
  inputs.map(async (path) => JSON.parse(await readFile(path, "utf8"))),
);
if (new Set(inventories.map((item) => JSON.stringify(item.seeds))).size !== 1)
  throw new Error("Inventories must share the same seeds");

const pages = {};
for (const inventory of inventories)
  for (const [id, page] of Object.entries(inventory.pages)) pages[id] ??= page;
if (Object.keys(pages).length > 100)
  throw new Error("Combined draft exceeds the framework's 100-state limit");
// Recompute reachability/dead ends for the union; per-run warnings can be stale.
const review = [
  ...new Set(
    inventories
      .flatMap((item) => item.review)
      .filter((warning) => !warning.startsWith("State ")),
  ),
];
const model = buildModel(
  pages,
  inventories.flatMap((item) => item.transitions),
  review,
);
const encoded = JSON.stringify(model, null, 2) + "\n";
await writeFile(output, encoded, { flag: "wx" });
const summary = {
  source: inventories[0].seeds,
  model: output,
  sha256: createHash("sha256").update(encoded).digest("hex"),
  states: model.models[0].vertices.length,
  journeys: model.models[0].edges.length,
  observed_urls: [...new Set(Object.values(pages).map((page) => page.url))],
  runs: inventories.map((item, index) => ({
    inventory: inputs[index],
    artifacts: join(dirname(inputs[index]), item.artifact_root),
    depth: item.depth,
    states: Object.keys(item.pages).length,
    executed_transitions: item.transitions.length,
    visits: item.visits.length,
    replay_operations: item.operations,
    failed: item.failed,
    pending: item.pending,
    capture_errors: item.visits.flatMap((visit) => visit.capture_errors),
    unresolved_visits: item.visits
      .filter((visit) => !visit.state)
      .map((visit) => ({
        visit: visit.id,
        source: visit.source,
        source_url: item.pages[visit.source]?.url,
        source_controls: item.pages[visit.source]?.buttons.map(
          (button) => button.label,
        ),
        artifacts: visit.artifacts,
      })),
    review: item.review,
    blocked_endpoints: [...new Set(item.blocked.map((entry) => entry.url))],
  })),
  review,
};
await writeFile(summaryOutput, JSON.stringify(summary, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  `${output}: ${summary.states} states, ${summary.journeys} journeys`,
);
