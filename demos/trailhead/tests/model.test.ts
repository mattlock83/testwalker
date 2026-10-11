import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { CoreClient, serve } from "@testwalker/web";

test("The local business model plans every edge, state and focused property partition", async () => {
  const core = new CoreClient();
  try {
    const document = JSON.parse(
      await readFile(new URL("../model.json", import.meta.url), "utf8"),
    );
    const config = JSON.parse(
      await readFile(new URL("../run.json.example", import.meta.url), "utf8"),
    );
    const model = (await core.request("model.validate", { model: document }))
      .document.models[0];
    const plan = await core.request("run.plan", {
      model: document,
      options: config.options,
    });
    assert.ok(plan.planning.complete);
    assert.deepEqual(
      new Set(
        plan.planned_path
          .filter((step: any) => step.kind === "edge")
          .map((step: any) => step.id),
      ),
      new Set(model.edges.map((edge: any) => edge.id)),
    );
    assert.deepEqual(
      new Set(
        plan.planned_path
          .filter((step: any) => step.kind === "state")
          .map((step: any) => step.id),
      ),
      new Set(model.vertices.map((state: any) => state.id)),
    );
    assert.equal(plan.scope.input_mode, "focused");
    assert.ok(plan.scope.property_selection.available_phases > 0);
    assert.equal(
      plan.scope.property_selection.selected_phases,
      plan.scope.property_selection.available_phases,
    );
    assert.equal(plan.scope.property_selection.excluded_phases, 0);
    for (const check of plan.tests.filter(
      (check: any) => check.kind === "property",
    ))
      assert.equal(check.phase.max_examples, 1);
    for (const edge of model.edges) {
      assert.equal("selector" in edge.properties.business, false);
      assert.equal("actions" in edge.properties.business, false);
      if (edge.properties.business["data set"])
        await core.request("graph.setup", {
          model: document,
          state: edge.sourceVertexId,
        });
    }
  } finally {
    await core.close();
  }
});
test("The local website has its own document root", async () => {
  const server = await serve(
    fileURLToPath(new URL("../site", import.meta.url)),
    0,
    fileURLToPath(new URL("../app.ts", import.meta.url)),
  );
  try {
    const response = await fetch(server.url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /text\/html/);
    assert.match(await response.text(), /<html/i);
  } finally {
    await server.close();
  }
});
