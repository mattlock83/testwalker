import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { serve, observe, Hooks, type HookContext } from "@testwalker/web";
import { selectPickup } from "../hooks.js";

test(
  "Real custom pickup hook operates the widget, and invalid field evidence clears on correction",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const server = await serve(
      fileURLToPath(new URL("../site", import.meta.url)),
      0,
      fileURLToPath(new URL("../app.ts", import.meta.url)),
    );
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.goto(server.url + "/#booking_details");
      const context = {
        page,
        scratch: { picker_selections: [] },
        phase: "graph",
      } as unknown as HookContext;
      // Load the same module path as the executable adapter, so tsx's transformation is exercised.
      const hooks = await Hooks.load(
        fileURLToPath(new URL("../hooks.ts", import.meta.url)),
      );
      context.element_id = "choose_marina_pickup";
      context.edges = {};
      await hooks.fire("before_transition", context);
      assert.equal(
        await page.locator("#pickup-summary").innerText(),
        "Selected pickup: Marina pier",
      );
      await selectPickup(context, "City visitor centre");
      assert.equal(
        await page.locator("#pickup-summary").innerText(),
        "Selected pickup: City visitor centre",
      );
      await page
        .getByLabel("Email address", { exact: true })
        .fill("alex@example.test");
      const name = page.getByLabel("Lead traveller", { exact: true });
      for (const [value, message] of [
        ["", "is required"],
        ["a", "is too short"],
        ["a".repeat(61), "is too long"],
      ]) {
        await name.fill(value);
        await page
          .getByRole("button", { name: "Review adventure", exact: true })
          .click();
        await page.getByRole("alert").filter({ hasText: message }).waitFor();
        await name.scrollIntoViewIfNeeded();
        const evidence = await observe(page);
        const invalid = evidence.semantics.invalid_fields.find(
          (field: any) => field.label === "Lead traveller",
        );
        assert.ok(
          invalid.validation_messages.some((text: string) =>
            text.includes(message),
          ),
        );
      }
      await name.fill("Alex Morgan");
      await page
        .getByRole("button", { name: "Review adventure", exact: true })
        .click();
      await page
        .getByRole("heading", { name: "Review your adventure", exact: true })
        .waitFor();
      const evidence = await observe(page);
      assert.deepEqual(evidence.semantics.alerts, []);
      assert.deepEqual(evidence.semantics.invalid_fields, []);
    } finally {
      await browser.close();
      await server.close();
    }
  },
);
