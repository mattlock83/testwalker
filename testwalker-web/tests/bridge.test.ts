import { test } from "node:test";
import assert from "node:assert/strict";
import { DecisionBridge } from "../src/bridge.js";
import { Inconclusive } from "../src/types.js";

test("PlayJev transport forwards evidence and questions to Rust without a provider key", async () => {
  const calls: any[] = [];
  const bridge = new DecisionBridge({
    async request(method, params) {
      calls.push({ method, params });
      return {
        model: "jev-latest",
        answers: { ready: { type: "noul", noul: 0.95 } },
        usage: { input_tokens: 9 },
      };
    },
  });
  await bridge.start();
  try {
    const denied = await fetch(bridge.baseUrl + "/systemone", {
      method: "POST",
      body: "{}",
    });
    assert.equal(denied.status, 403);
    assert.equal(calls.length, 0);
    const response = await fetch(bridge.baseUrl + "/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${bridge.token}` },
      body: JSON.stringify({
        state: "rendered tree",
        questions: { ready: { type: "noul" } },
      }),
    });
    assert.equal(response.status, 200);
    assert.equal(((await response.json()) as any).answers.ready.noul, 0.95);
    assert.deepEqual(calls, [
      {
        method: "decision.ask",
        params: {
          evidence: "rendered tree",
          questions: { ready: { type: "noul" } },
        },
      },
    ]);
  } finally {
    await bridge.close();
  }
});
test("A Rust budget refusal is nonretryable and retains its diagnostic", async () => {
  const bridge = new DecisionBridge({
    async request() {
      throw new Inconclusive("The model-call budget is exhausted");
    },
  });
  await bridge.start();
  try {
    const response = await fetch(bridge.baseUrl + "/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${bridge.token}` },
      body: '{"state":{},"questions":{}}',
    });
    assert.equal(response.status, 409);
    assert.match(await response.text(), /budget is exhausted/);
  } finally {
    await bridge.close();
  }
});
