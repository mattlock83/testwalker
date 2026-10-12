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

test("Observed selection-list options keep their roles in state evidence", async () => {
  const core = client("s0");
  await new Oracle(new Decisions(core), model).identify({
    text: "Choose a delivery point",
    semantics: {
      visible_options: [{ label: "North hub" }, { label: "South hub" }],
    },
  });
  const evidence = core.calls.find(
    (call) => call.method === "decision.ask",
  )!.evidence;
  assert.deepEqual(evidence.accessibility.visible_options, [
    { label: "North hub" },
    { label: "South hub" },
  ]);
  assert.deepEqual(
    evidence.elements.map((element: Json) => element.role),
    ["option", "option"],
  );
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

test("Uncertain mixed audit batches are checked per scenario without discarding uncertainty or contradictions", async () => {
  for (const outcomes of [
    ["not_applicable", "met"],
    ["met", "uncertain"],
    ["met", "broken"],
    ["not_applicable", "not_applicable"],
    ["met", "LOW_CONFIDENCE"],
  ]) {
    let focused = 0;
    const core = {
      async request(method: string, params: Json = {}) {
        if (method === "decision.answer") {
          assert.equal(params.threshold, 0.8);
          const answer = params.result.answers[params.name].choice;
          if (answer === "LOW_CONFIDENCE")
            throw new Error("Confidence below 0.80");
          return answer;
        }
        const names = Object.keys(params.questions);
        if (names[0].startsWith("scenario_")) focused++;
        return {
          answers: Object.fromEntries(
            names.map((name) => [
              name,
              {
                choice:
                  name === "global"
                    ? "uncertain"
                    : outcomes[Number(name.split("_")[1])],
              },
            ]),
          ),
        };
      },
    };
    const oracle = new Oracle(new Decisions(core), model);
    const result = (
      await oracle.audit(
        outcomes.map((_, i) => ({
          status: "PASS",
          observed: "done",
          input: { index: i },
          evidence: { text: `Observed scenario ${i}` },
        })),
        ["Invalid details are rejected"],
      )
    )[0];
    const expected = outcomes.includes("broken")
      ? "broken"
      : outcomes.includes("uncertain") ||
          outcomes.includes("LOW_CONFIDENCE") ||
          !outcomes.includes("met")
        ? "uncertain"
        : "met";
    assert.equal(result.status, expected);
    assert.equal(focused, 1, "One decomposition, never repeated until a pass");
    assert.equal(result.batch_answers[0].scenario_checks.length, 2);
    assert.equal(result.batch_answers[0].initial_answer.choice, "uncertain");
  }
});

test("Audit provenance distinguishes a new submission from values retained during navigation", async () => {
  const local = structuredClone(model);
  local.models[0].edges = [
    { id: "submit", properties: { business: { "data set": "Names" } } },
    {
      id: "return",
      properties: { business: { intent: "Return to the form" } },
    },
    {
      id: "fixed",
      properties: { business: { example: { Name: "Alex" } } },
    },
  ];
  const calls: Json[] = [];
  const core = {
    async request(method: string, params: Json = {}) {
      if (method === "decision.answer")
        return params.result.answers[params.name].choice;
      calls.push(params);
      return { answers: { global: { choice: "met" } } };
    },
  };
  await new Oracle(new Decisions(core), local).audit(
    [
      { kind: "edge", id: "submit" },
      {
        kind: "state",
        status: "PASS",
        observed: "done",
        input: { Name: "" },
        violations: [{ field: "Name" }],
      },
      { kind: "edge", id: "return" },
      {
        kind: "state",
        status: "PASS",
        observed: "form",
        input: { Name: "" },
        violations: [{ field: "Name" }],
      },
      {
        journey: "submit",
        status: "PASS",
        observed: "done",
        input: { Name: "x" },
      },
      {
        journey: "fixed",
        status: "PASS",
        observed: "done",
        input: { Name: "Alex" },
      },
    ],
    ["Name validation"],
  );
  const scenarios = calls[0].evidence.executed_scenarios;
  assert.equal(scenarios[0].transition.type, "data_submission");
  assert.deepEqual(scenarios[0].submitted_values, { Name: "" });
  assert.equal(scenarios[1].transition.type, "navigation");
  assert.equal(scenarios[1].submitted_values, undefined);
  assert.deepEqual(scenarios[1].retained_business_values, { Name: "" });
  assert.deepEqual(scenarios[1].input_violations, []);
  assert.equal(scenarios[2].transition.data_set, "Names");
  assert.equal(scenarios[3].transition.type, "data_submission");
  assert.equal(scenarios[3].transition.data_set, null);
  assert.deepEqual(scenarios[3].submitted_values, { Name: "Alex" });
});
