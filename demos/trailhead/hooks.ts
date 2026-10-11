/** Optional fixture, custom picker and independent ledger assertions. Never loaded from the model. */
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  Defect,
  Inconclusive,
  type HookContext,
  type Json,
} from "@testwalker/web";

export async function api(
  ctx: HookContext,
  path = "state",
  body?: Json,
): Promise<Json> {
  const response = await fetch(new URL(`/api/trailhead/${path}`, ctx.url), {
    signal: AbortSignal.timeout(5000),
    ...(body
      ? {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok)
    throw new Inconclusive(`Fixture API failed with HTTP ${response.status}`);
  return (await response.json()) as Json;
}
const ledger = (state: Json) => ({
  bookings: state.bookings,
  refunds: state.refunds,
  remaining: state.remaining,
});
export function before_run(ctx: HookContext): void {
  Object.assign(ctx.scratch, {
    resets: 0,
    checkpoints: [],
    picker_selections: [],
    pending: null,
    walks: [],
    cases: [],
  });
}
export function before_walk(ctx: HookContext): void {
  ctx.scratch.walks.push({ walk: ctx.walk, status: "RUNNING" });
}
export function after_walk(ctx: HookContext): void {
  ctx.scratch.walks.at(-1).status =
    ctx.error instanceof Defect
      ? "FAIL"
      : ctx.error
        ? "INCONCLUSIVE"
        : "COMPLETED";
}
export function before_case(ctx: HookContext): void {
  ctx.scratch.cases.push({
    journey: ctx.element_id,
    input: { ...ctx.data },
    expected_invalid: Boolean(ctx.invalid.length),
    status: "RUNNING",
  });
}
export function after_case(ctx: HookContext): void {
  ctx.scratch.cases.at(-1).status =
    ctx.result?.status ??
    (ctx.error instanceof Defect ? "FAIL" : "INCONCLUSIVE");
}
export async function before_reset(ctx: HookContext): Promise<void> {
  const seeded = await api(ctx, "reset", {
    defect: process.env.TRAILHEAD_DEMO_BUG ?? "",
  });
  ctx.check(
    !seeded.bookings.length && !seeded.refunds.length,
    "Fixture reset must empty the ledger",
  );
  ctx.check(
    Object.values(seeded.remaining).every((value) => value === seeded.capacity),
    "Fixture capacity is restored",
  );
  ctx.scratch.resets++;
  ctx.scratch.pending = null;
}
export async function selectPickup(
  ctx: HookContext,
  value: string,
): Promise<void> {
  if (!ctx.page)
    throw new Inconclusive("A test tab must be open before selecting a pickup");
  // All widget selectors belong to this explicit application hook, never the business model.
  // A browser-side expression avoids tsx adding Node-only helpers to nested functions.
  const selected: Json = await ctx.page.evaluate(`(value => {
    const widget = document.querySelector('pickup-picker');
    const root = widget?.shadowRoot;
    const visible = element => element && element.getClientRects().length > 0 && !element.hidden;
    if (!visible(widget) || !root) return {error: 'Pickup widget unavailable'};
    const opener = widget.querySelector('button[aria-haspopup="listbox"]');
    const list = root.querySelector('[role="listbox"]');
    if (!visible(opener) || !list) return {error: 'Pickup controls unavailable'};
    if (list.hidden) opener.click();
    const option = [...root.querySelectorAll('[role="option"]')].find(element => element.dataset.value === value);
    if (!visible(option)) return {error: 'Requested pickup unavailable'};
    option.click(); return {selected: value};
  })(${JSON.stringify(value)})`);
  if (selected.selected !== value)
    throw new Inconclusive("Custom pickup selection failed", selected);
  const expected =
    value === "Marina pier" ? "booking_pickup" : "booking_details";
  await ctx.page.waitForFunction(
    ({ expected, value }) =>
      document.querySelector<HTMLElement>("#app")?.dataset.state === expected &&
      document.querySelector("#pickup-summary")?.textContent ===
        `Selected pickup: ${value}`,
    { expected, value },
    { timeout: 5000 },
  );
  ctx.scratch.picker_selections.push({ phase: ctx.phase, value });
}
export async function before_transition(ctx: HookContext): Promise<void> {
  if (
    ["choose_marina_pickup", "choose_city_pickup"].includes(
      ctx.element_id ?? "",
    )
  ) {
    await selectPickup(
      ctx,
      ctx.element_id === "choose_marina_pickup"
        ? "Marina pier"
        : "City visitor centre",
    );
  }
  const watched = [
    "confirm_booking",
    "confirm_cancellation",
    ...Object.keys(ctx.edges).filter((id) =>
      /^(booking_|cancellation_).*_submit_/.test(id),
    ),
  ];
  if (watched.includes(ctx.element_id ?? ""))
    ctx.scratch.pending = {
      edge: ctx.element_id,
      before: await api(ctx),
      data: { ...ctx.data },
      phase: ctx.phase,
    };
}
export async function after_state(ctx: HookContext): Promise<void> {
  if (ctx.result?.status !== "PASS" || !ctx.scratch.pending) return;
  const { before, edge, data } = ctx.scratch.pending;
  const id = ctx.element_id ?? "";
  if (
    ![
      "booking_review",
      "booking_error",
      "booking_confirmed",
      "cancellation_review",
      "cancellation_error",
      "cancellation_done",
    ].includes(id)
  )
    return;
  const state = await api(ctx);
  let checked: string | undefined;
  if (
    edge.includes("_submit_") &&
    [
      "booking_review",
      "booking_error",
      "cancellation_review",
      "cancellation_error",
    ].includes(id)
  ) {
    ctx.check(
      isDeepStrictEqual(ledger(state), ledger(before)),
      "Review or rejected input must not change inventory or payments",
    );
    checked = "review has no booking, inventory or refund side effects";
  } else if (edge === "confirm_booking" && id === "booking_confirmed") {
    ctx.check(
      state.bookings.length === before.bookings.length + 1,
      "Confirmation creates exactly one booking",
    );
    const created = state.bookings.at(-1);
    const expected = Object.fromEntries(
      Object.entries(data).map(([name, value]) => [name, String(value).trim()]),
    );
    ctx.check(
      isDeepStrictEqual(created.data, expected),
      "Persisted booking matches supplied business values",
    );
    ctx.check(created.status === "confirmed", "Persisted booking is confirmed");
    // Independent specification, including exact decimal half-up gift rounding. Do not import app calculations.
    const price: Record<string, number> = {
      "Ridge walk": 8000,
      "River paddle": 12000,
    };
    const [whole, fraction = ""] = String(data["Conservation contribution"])
      .replace(/^\+/, "")
      .split(".");
    const gift =
      Number(
        BigInt(whole || "0") * 100n + BigInt((fraction + "00").slice(0, 2)),
      ) + (Number(fraction[2] ?? "0") >= 5 ? 1 : 0);
    ctx.check(
      created.total_cents ===
        Number(data["Party size"]) * price[data.Adventure] + gift,
      "Persisted charge equals party price plus one conservation gift",
    );
    const remaining = { ...before.remaining };
    remaining[data.Adventure] -= Number(data["Party size"]);
    ctx.check(
      isDeepStrictEqual(state.remaining, remaining),
      "Confirmation reserves exactly the submitted places",
    );
    ctx.check(
      isDeepStrictEqual(state.refunds, before.refunds),
      "Confirmation must not create a refund",
    );
    checked =
      "confirmation persists one booking and reserves its exact inventory";
  } else if (edge === "confirm_cancellation" && id === "cancellation_done") {
    const original = before.bookings.at(-1),
      updated = state.bookings.at(-1);
    ctx.check(
      state.bookings.length === before.bookings.length,
      "Cancellation must not create a booking",
    );
    ctx.check(
      updated.id === original.id && updated.status === "cancelled",
      "Existing booking must be cancelled",
    );
    const refunds = state.refunds.filter(
      (refund: Json) => refund.booking_id === original.id,
    );
    ctx.check(
      refunds.length === 1,
      "Cancellation issues exactly one refund for this booking",
    );
    ctx.check(
      state.refunds.length === before.refunds.length + 1,
      "No unrelated or duplicate refund is issued",
    );
    ctx.check(
      refunds[0].amount_cents === original.total_cents,
      "Refund returns the full original charge",
    );
    ctx.check(
      refunds[0].reason === String(data["Cancellation reason"]).trim(),
      "Refund records supplied cancellation reason",
    );
    const remaining = { ...before.remaining };
    remaining[original.data.Adventure] += Number(original.data["Party size"]);
    ctx.check(
      isDeepStrictEqual(state.remaining, remaining),
      "Cancellation releases exactly the reserved places",
    );
    checked =
      "cancellation records one full refund and releases its exact inventory";
  }
  if (checked) {
    ctx.scratch.checkpoints.push({
      phase: ctx.phase,
      state: ctx.element_id,
      check: checked,
    });
    ctx.scratch.pending = null;
  }
}
export async function after_run(ctx: HookContext): Promise<void> {
  const report = {
    resets: ctx.scratch.resets ?? 0,
    checks: ctx.scratch.checkpoints ?? [],
    custom_picker: ctx.scratch.picker_selections ?? [],
    final_backend: await api(ctx),
    walks: ctx.scratch.walks ?? [],
    cases: ctx.scratch.cases ?? [],
  };
  if (ctx.report?.directory)
    await writeFile(
      join(ctx.report.directory, "trailhead-hook-audit.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
}
