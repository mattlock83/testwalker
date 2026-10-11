import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  CoreClient,
  serve,
  type HookContext,
  Hooks,
  Defect,
} from "@testwalker/web";
import { TrailheadStore, CAPACITY, bookingData } from "../app.js";

const document = JSON.parse(
  await readFile(new URL("../model.json", import.meta.url), "utf8"),
);
const dictionaries = document.models[0].properties.business["data sets"];
const example = (name: string) =>
  Object.fromEntries(
    Object.entries<any>(dictionaries[name]).map(([label, field]) => [
      label,
      field.example,
    ]),
  );

for (const dataset of [
  "Adventure party",
  "Member profile",
  "Cancellation request",
]) {
  test(`Backend agrees with independent Hegel constraint partitions: ${dataset}`, async () => {
    const core = new CoreClient(),
      fields = dictionaries[dataset];
    try {
      for (const [name, field] of Object.entries(fields))
        for (const [, value] of await core.request("property.samples", {
          fields: { [name]: field },
        })) {
          const data = { ...example(dataset), [name]: value },
            store = new TrailheadStore();
          const submit =
            dataset === "Adventure party"
              ? () => bookingData(data)
              : dataset === "Member profile"
                ? () => store.saveProfile(data)
                : () =>
                    store.cancel(
                      store.confirm(example("Adventure party"), "boundary").id,
                      data,
                    );
          const violations = (
            await core.request("property.validate", { fields, input: data })
          ).violations;
          if (violations.length) assert.throws(submit);
          else assert.doesNotThrow(submit);
        }
    } finally {
      await core.close();
    }
  });
}
test("Bookings/refunds are idempotent, round half-up in cents and reset independently", () => {
  const store = new TrailheadStore(),
    other = new TrailheadStore();
  const data = {
    ...example("Adventure party"),
    Adventure: "River paddle",
    "Party size": 3,
    "Conservation contribution": "1.005",
  };
  const created = store.confirm(data, "unique", "Marina pier");
  assert.equal(created.total_cents, 36101);
  assert.deepEqual(store.confirm(data, "unique"), created);
  assert.equal(store.remaining["River paddle"], CAPACITY - 3);
  assert.equal(other.bookings.length, 0);
  const refund = store.cancel(created.id, {
    "Cancellation reason": "  Plans changed  ",
  });
  assert.deepEqual(
    store.cancel(created.id, { "Cancellation reason": "Plans changed" }),
    refund,
  );
  assert.equal(store.refunds.length, 1);
  assert.equal(refund.amount_cents, 36101);
  assert.equal(store.remaining["River paddle"], CAPACITY);
  assert.equal(store.reset().bookings.length, 0);
});
async function fixture(
  fn: (
    ctx: HookContext,
    hooks: Hooks,
    server: Awaited<ReturnType<typeof serve>>,
  ) => Promise<void>,
) {
  const server = await serve(
    fileURLToPath(new URL("../site", import.meta.url)),
    0,
    fileURLToPath(new URL("../app.ts", import.meta.url)),
  );
  const hooks = await Hooks.load(
      fileURLToPath(new URL("../hooks.ts", import.meta.url)),
    ),
    core = new CoreClient();
  const ctx: HookContext = {
    model: document,
    states: Object.fromEntries(
      document.models[0].vertices.map((state: any) => [state.id, state]),
    ),
    edges: Object.fromEntries(
      document.models[0].edges.map((edge: any) => [edge.id, edge]),
    ),
    core,
    page: undefined,
    phase: "graph",
    url: server.url,
    data: {},
    invalid: [],
    scratch: hooks.scratch,
    check(condition, text) {
      if (!condition) throw new Defect(text);
    },
  };
  try {
    await hooks.fire("before_run", ctx);
    await hooks.fire("before_reset", ctx);
    await fn(ctx, hooks, server);
  } finally {
    await server.close();
    await core.close();
  }
}
async function post(ctx: HookContext, path: string, data: any): Promise<any> {
  const response = await fetch(ctx.url + "/api/trailhead/" + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
  assert.equal(response.status, 200);
  return response.json();
}
async function checkpoint(ctx: HookContext, hooks: Hooks, id: string) {
  ctx.element_id = id;
  ctx.element = ctx.states[id];
  ctx.result = { status: "PASS" };
  await hooks.fire("after_state", ctx);
}
async function transition(ctx: HookContext, hooks: Hooks, id: string) {
  ctx.element_id = id;
  ctx.element = ctx.edges[id];
  await hooks.fire("before_transition", ctx);
}
async function confirm(ctx: HookContext, hooks: Hooks) {
  ctx.data = example("Adventure party");
  await transition(ctx, hooks, "booking_details_submit_valid");
  await checkpoint(ctx, hooks, "booking_review");
  await transition(ctx, hooks, "confirm_booking");
  const created = await post(ctx, "bookings", {
    data: ctx.data,
    token: "hook-check",
    pickup: "Marina pier",
  });
  await checkpoint(ctx, hooks, "booking_confirmed");
  return created;
}
test("Async hooks verify review, inventory and refund through the real fixture API", async () =>
  fixture(async (ctx, hooks) => {
    const booking = await confirm(ctx, hooks);
    ctx.data = { "Cancellation reason": "Plans changed" };
    await transition(ctx, hooks, "cancellation_details_submit_valid");
    await checkpoint(ctx, hooks, "cancellation_review");
    await transition(ctx, hooks, "confirm_cancellation");
    await post(ctx, "cancellations", {
      booking_id: booking.id,
      data: ctx.data,
    });
    await checkpoint(ctx, hooks, "cancellation_done");
    assert.equal(ctx.scratch.checkpoints.length, 4);
    const state = (await (
      await fetch(ctx.url + "/api/trailhead/state")
    ).json()) as any;
    assert.equal(state.remaining["Ridge walk"], CAPACITY);
    assert.equal(state.refunds.length, 1);
  }));
for (const defect of ["inventory", "refund"])
  test(`Hooks catch injected ${defect} bug despite UI PASS`, async () =>
    fixture(async (ctx, hooks) => {
      await post(ctx, "reset", { defect });
      if (defect === "inventory")
        await assert.rejects(confirm(ctx, hooks), /reserves exactly/);
      else {
        const booking = await confirm(ctx, hooks);
        ctx.data = { "Cancellation reason": "Plans changed" };
        await transition(ctx, hooks, "confirm_cancellation");
        await post(ctx, "cancellations", {
          booking_id: booking.id,
          data: ctx.data,
        });
        await assert.rejects(
          checkpoint(ctx, hooks, "cancellation_done"),
          /exactly one refund/,
        );
      }
    }));
test("Review hook detects premature persistence", async () =>
  fixture(async (ctx, hooks) => {
    ctx.data = example("Adventure party");
    await transition(ctx, hooks, "booking_details_submit_valid");
    await post(ctx, "bookings", { data: ctx.data, token: "too-early" });
    await assert.rejects(
      checkpoint(ctx, hooks, "booking_review"),
      /must not change inventory/,
    );
  }));
