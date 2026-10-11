import { test } from "node:test";
import assert from "node:assert/strict";
import { Decisions, Oracle } from "../src/oracle.js";
import type { Json, Model } from "../src/types.js";

const model: Model = {
  models: [
    {
      id: "test",
      name: "Test",
      startElementId: "form",
      generator: "random()",
      properties: { business: { rules: [], "data sets": {} } },
      edges: [],
      vertices: ["form", "done"].map((id) => ({
        id,
        properties: {
          business: {
            description: id,
            rules: id === "done" ? ["A greeting is displayed."] : [],
          },
        },
      })),
    },
  ],
};
function client(answer: string, unresolved = false) {
  const calls: Json[] = [];
  return {
    calls,
    async request(method: string, params: Json = {}) {
      calls.push({ method, ...params });
      if (method === "decision.ask")
        return {
          answers: Object.fromEntries(
            Object.keys(params.questions).map((name) => [
              name,
              {
                choice:
                  name === "state" ? answer : unresolved ? "uncertain" : "met",
              },
            ]),
          ),
        };
      return params.result.answers[params.name].choice;
    },
  };
}
test("State identification considers every state and has no expected-state or navigation-intent bias", async () => {
  const core = client("s0"),
    oracle = new Oracle(new Decisions(core), model);
  const result = await oracle.check(
    { text: "Entry form", semantics: {} },
    "done",
  );
  assert.equal(result.observed, "form");
  assert.equal(result.checks[0].status, "broken");
  const request = core.calls.find((call) => call.method === "decision.ask")!;
  assert.deepEqual(Object.keys(request.questions.state.criteria), [
    "s0",
    "s1",
    "UNKNOWN",
  ]);
  assert.equal("expected" in request.evidence, false);
});
test("Insufficient state or requirement evidence remains unresolved", async () => {
  assert.equal(
    (
      await new Oracle(new Decisions(client("UNKNOWN")), model).check(
        {},
        "done",
      )
    ).observed,
    null,
  );
  const result = await new Oracle(
    new Decisions(client("s1", true)),
    model,
  ).check({ text: "Done" }, "done");
  assert.equal(result.checks[0].status, "uncertain");
});
test("Confidence defaults to 0.80 and explicit overrides reach the Rust answer validator", async () => {
  for (const threshold of [undefined, 0.9]) {
    const core = client("s0");
    await new Oracle(new Decisions(core, threshold), model).identify({});
    assert.equal(
      core.calls.find((call) => call.method === "decision.answer")!.threshold,
      threshold ?? 0.8,
    );
  }
});
test("Global audits preserve later batch contradictions and never pass absent evidence", async () => {
  let globalCalls = 0;
  const core = {
    async request(method: string, params: Json = {}) {
      if (method === "decision.answer")
        return params.result.answers[params.name].choice;
      return {
        answers: Object.fromEntries(
          Object.keys(params.questions).map((name) => [
            name,
            {
              choice: name.startsWith("scope_")
                ? "OTHER"
                : name.startsWith("relevance_")
                  ? "relevant"
                  : (++globalCalls,
                    params.evidence.executed_scenarios.some((scenario: Json) =>
                      scenario.visible_text.startsWith("Late contradiction"),
                    )
                      ? "broken"
                      : "met"),
            },
          ]),
        ),
      };
    },
  };
  const oracle = new Oracle(new Decisions(core), model);
  assert.equal(
    (await oracle.audit([], ["Full refund"]))[0].status,
    "uncertain",
  );
  assert.equal(globalCalls, 0, "Absent evidence cannot be asserted as support");
  const records = Array.from({ length: 12 }, (_, i) => ({
    status: "PASS",
    observed: "done",
    expected: "done",
    input: { index: i },
    evidence: {
      text:
        (i === 11
          ? "Late contradiction: refund missing. "
          : "Refund displayed. ") + "x".repeat(1750),
    },
  }));
  const [result] = await oracle.audit(records, ["Full refund"]);
  assert.equal(result.status, "broken");
  assert.deepEqual(
    result.batch_answers.map((entry: Json) => entry.status),
    ["met", "broken"],
  );
  assert.equal(globalCalls, 2);
});
