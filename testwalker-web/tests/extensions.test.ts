import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Hooks,
  StrategyProvider,
  type HookContext,
} from "../src/extensions.js";
import { WebAdapter } from "../src/adapter.js";
import { Defect, Inconclusive } from "../src/types.js";

test("Async hook errors retain definite defects separately from unavailable infrastructure", async () => {
  for (const [error, status] of [
    [new Defect("Missing refund"), "FAIL"],
    [new Error("Fixture unavailable"), "INCONCLUSIVE"],
  ] as const) {
    const hooks = new Hooks({
      before_case: async () => {
        await Promise.resolve();
        throw error;
      },
    });
    await assert.rejects(
      hooks.fire("before_case", { phase: "property" } as HookContext),
      (fault: unknown) =>
        fault instanceof Inconclusive && fault.status === status,
    );
    assert.equal(hooks.events[0].status, status);
  }
});

test("Hooks cannot mutate the oracle model or authoritative input snapshots", async () => {
  const model = {
    models: [
      {
        vertices: [
          {
            id: "form",
            properties: { business: { rules: ["Original requirement"] } },
          },
        ],
        edges: [],
      },
    ],
  };
  const adapter = new WebAdapter({ request: async () => {} });
  (adapter as any).model = model;
  (adapter as any).hooks = new Hooks({
    before_case: (ctx: HookContext) => {
      ctx.states.form.properties.business.rules[0] = "Weakened requirement";
      ctx.data.Name = "Repaired";
    },
  });
  const context = { data: { Name: "" } };
  await adapter.call("target.hook", { event: "before_case", context });
  assert.equal(
    model.models[0].vertices[0].properties.business.rules[0],
    "Original requirement",
  );
  assert.equal(context.data.Name, "");
});

test("Custom strategies return JSON domains while retaining native defaults and partition constraints", async () => {
  const context = { field_name: "Party size", partition: "maximum +1" };
  const strategy = new StrategyProvider(async (supplied) => {
    supplied.partition = "changed locally";
    return { kind: "integer", minimum: 7, maximum: 10 };
  });
  assert.deepEqual(await strategy.build(context, { kind: "default" }), {
    kind: "integer",
    minimum: 7,
    maximum: 10,
  });
  assert.equal(context.partition, "maximum +1");
  await assert.rejects(
    new StrategyProvider(() => ({ kind: "literal", value: Infinity })).build(
      context,
      {},
    ),
    /nonfinite/,
  );
});
