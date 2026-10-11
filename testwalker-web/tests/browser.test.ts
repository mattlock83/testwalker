import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserTarget } from "../src/browser.js";

test("Invalid literal inputs are preserved; submission runs once despite uncertain action verification", async () => {
  const target = new BrowserTarget({
    request: async () => {
      throw new Error("Unexpected decision");
    },
  });
  const intents: any[] = [];
  (target as any).actor = {
    act: async (intent: string, options: any) => {
      intents.push({ intent, options });
      return {
        success: false,
        verificationProbability: 0.1,
        actions: [
          {
            selector: "runtime-locator",
            target: { role: "textbox" },
            operationConfidence: 1,
          },
        ],
      };
    },
  };
  (target as any).page = { locator: () => ({ inputValue: async () => "" }) };
  const params = {
    edge: { properties: { business: { intent: "Submit the name." } } },
    fields: { Name: { required: true } },
    input: { Name: "" },
  };
  await target.execute(params, async () => null);
  assert.equal(intents.length, 2);
  assert.deepEqual(intents[0].options.fields, { Name: "" });
  assert.equal(intents[1].options.maxSteps, 1);
  (target as any).page = {
    locator: () => ({ inputValue: async () => "Corrected input" }),
  };
  await assert.rejects(
    target.execute(params, async () => null),
    /exact input/,
  );
  assert.equal(intents.length, 3, "Do not submit modified data");
});

test("No action and low operation confidence remain inconclusive", async () => {
  const target = new BrowserTarget({ request: async () => {} });
  const params = {
    edge: {
      sourceVertexId: "form",
      targetVertexId: "form",
      properties: { business: { intent: "Review." } },
    },
    fields: {},
  };
  (target as any).actor = {
    act: async () => ({ success: false, actions: [] }),
  };
  await assert.rejects(
    target.execute(params, async () => null),
    /did not execute/,
  );
  (target as any).actor = {
    act: async () => ({
      success: true,
      actions: [{ operationConfidence: 0.6 }],
    }),
  };
  await assert.rejects(
    target.execute(params, async () => null),
    /operation confidence/,
  );
});
