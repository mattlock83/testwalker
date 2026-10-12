import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { CoreClient } from "@testwalker/web";

test("The controls model is selector-free and plans all states, edges and selected Hegel cases", async () => {
  const model = JSON.parse(
    await readFile(new URL("../model.json", import.meta.url), "utf8"),
  );
  const config = JSON.parse(
    await readFile(new URL("../run.json.example", import.meta.url), "utf8"),
  );
  const core = new CoreClient();
  try {
    const normalized = await core.request("model.validate", { model });
    const plan = await core.request("run.plan", {
      model,
      options: config.options,
    });
    assert.equal(plan.planning.complete, true);
    assert.deepEqual(
      new Set(
        plan.planned_path
          .filter((step: any) => step.kind === "edge")
          .map((step: any) => step.id),
      ),
      new Set(normalized.document.models[0].edges.map((edge: any) => edge.id)),
    );
    assert.deepEqual(
      new Set(
        plan.planned_path
          .filter((step: any) => step.kind === "state")
          .map((step: any) => step.id),
      ),
      new Set(
        normalized.document.models[0].vertices.map((state: any) => state.id),
      ),
    );
    assert.ok(plan.tests.some((test: any) => test.kind === "property"));
    for (const edge of model.models[0].edges) {
      assert.equal("selector" in edge.properties.business, false);
      assert.equal("actions" in edge.properties.business, false);
    }
    assert.ok(
      model.models[0].edges.some(
        (edge: any) => edge.properties.business.example?.["Travel date"],
      ),
    );
  } finally {
    await core.close();
  }
});
