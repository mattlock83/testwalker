// Compare observed navigation with an independent business model. No browser/Jev.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const referenceText = await readFile(
  new URL("./reference.json", import.meta.url),
  "utf8",
);
const reference = JSON.parse(referenceText).models[0];
const expectedStates = reference.vertices.map((vertex) => vertex.id);
const expectedPairs = new Set(
  reference.edges.map(
    (edge) => `${edge.sourceVertexId}->${edge.targetVertexId}`,
  ),
);
const results = [];
for (const path of process.argv.slice(2)) {
  const inventory = JSON.parse(await readFile(path, "utf8"));
  // Trailhead exposes its workflow states in URL fragments. Do not use its DOM
  // data-state attribute or any such mapping in the generic discovery tool.
  const state = (id) =>
    new URL(inventory.pages[id].url).hash.slice(1) || "home";
  const states = new Set(Object.keys(inventory.pages).map(state));
  const pairs = new Set(
    inventory.transitions.map((t) => `${state(t.source)}->${state(t.target)}`),
  );
  const executed = inventory.transitions.filter(
    (t) => t.visit || !t.evidence.includes("review outcome"),
  );
  const executedPairs = new Set(
    executed.map((t) => `${state(t.source)}->${state(t.target)}`),
  );
  results.push({
    path,
    observed_states: Object.keys(inventory.pages).length,
    matched_states: expectedStates.filter((id) => states.has(id)).length,
    missing_states: expectedStates.filter((id) => !states.has(id)),
    reported_transitions: inventory.transitions.length,
    executed_transitions: executed.length,
    matched_pairs: [...expectedPairs].filter((pair) => pairs.has(pair)).length,
    executed_matched_pairs: [...expectedPairs].filter((pair) =>
      executedPairs.has(pair),
    ).length,
    missing_pairs: [...expectedPairs].filter((pair) => !pairs.has(pair)),
    visits: inventory.visits.length,
    operations: inventory.operations,
    failures: inventory.failed,
    pending: inventory.pending,
    proposed_forms: Object.keys(inventory.suggested_data_sets ?? {}).length,
  });
}
console.log(
  JSON.stringify(
    {
      reference_sha256: createHash("sha256")
        .update(referenceText)
        .digest("hex"),
      reference_states: expectedStates.length,
      reference_pairs: expectedPairs.size,
      note: "State-pair comparison measures navigation reachability, not business-rule correctness or formal test coverage. Multiple observed states can map to one reference state.",
      results,
    },
    null,
    2,
  ),
);
