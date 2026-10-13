import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Hooks,
  StrategyProvider,
  type HookContext,
} from "../src/extensions.js";
import { WebAdapter } from "../src/adapter.js";
import { Defect, Inconclusive } from "../src/types.js";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

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

test("Hook faults retain their declared verdict across separate SDK module instances", async () => {
  const temp = await mkdtemp(join(tmpdir(), "testwalker-sdk-copy-"));
  try {
    const copy = join(temp, "types-copy.mjs");
    await writeFile(
      copy,
      await readFile(new URL("../dist/types.js", import.meta.url)),
    );
    const sdk = await import(pathToFileURL(copy).href);
    assert.notEqual(sdk.Defect, Defect);
    for (const [error, status] of [
      [new sdk.Defect("Definite hook failure"), "FAIL"],
      [new sdk.Inconclusive("Unknown hook outcome"), "INCONCLUSIVE"],
    ]) {
      const hooks = new Hooks({
        after_case: () => {
          throw error;
        },
      });
      await assert.rejects(
        hooks.fire("after_case", { phase: "property" } as HookContext),
        (fault: unknown) =>
          fault instanceof Inconclusive && fault.status === status,
      );
      assert.equal(error instanceof Defect, status === "FAIL");
    }
    assert.equal(
      { status: "FAIL", message: "Unbranded error" } instanceof Defect,
      false,
    );
  } finally {
    await rm(temp, { recursive: true, force: true });
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

test("Case attachments separate hook evidence across failures in different phases", async () => {
  const adapter = new WebAdapter({ request: async () => {} });
  (adapter as any).model = { models: [{ vertices: [], edges: [] }] };
  (adapter as any).hooks = new Hooks({
    after_case: (ctx: HookContext) => {
      ctx.check(false, ctx.data.Name);
    },
  });
  await adapter.call("run.event", {
    type: "planned",
    data: {
      tests: [
        { id: "first", kind: "property" },
        { id: "second", kind: "property" },
      ],
      steps: [],
      cases: [],
    },
  });
  const ranges = [];
  for (const id of ["first", "second"]) {
    await adapter.call("run.event", { type: "test.begin", data: { id } });
    await assert.rejects(
      adapter.call("target.hook", {
        event: "after_case",
        context: { phase: "property", data: { Name: id } },
      }),
      Defect,
    );
    ranges.push(
      (
        await adapter.call("run.event", {
          type: "test.end",
          data: { id, status: "FAIL" },
        })
      ).hook_range,
    );
  }
  assert.deepEqual(ranges, [
    [0, 1],
    [1, 2],
  ]);
});
