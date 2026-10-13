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

test("Select configuration survives state and outcome checks without exposing text inputs or implying an open list", async () => {
  const core = client("s1");
  const select = {
    label: "Delivery points",
    role: "listbox",
    form: "f0-form0",
    multiple: true,
    disabled: false,
    readOnly: false,
    selected_labels: ["North hub", "South hub"],
    options: [
      { label: "North hub", value: "n", selected: true, disabled: false },
      { label: "South hub", value: "s", selected: true, disabled: false },
      { label: "Island hub", value: "i", selected: false, disabled: true },
    ],
  };
  const page = {
    text: "Details",
    accessibility_tree: "Entered text",
    semantics: {
      editable_fields: [{ label: "Name", current_value: "Entered text" }],
      selects: [select],
      visible_options: [],
    },
  };
  await new Oracle(new Decisions(core), model).check(page, "done");
  const requests = core.calls.filter((call) => call.method === "decision.ask");
  assert.ok(requests.length >= 2);
  for (const request of requests) {
    assert.deepEqual(request.evidence.accessibility.selects, [select]);
    assert.equal(
      request.evidence.accessibility.editable_fields[0].current_value,
      undefined,
    );
    assert.equal(request.evidence.accessibility_tree, undefined);
    assert.equal(
      request.evidence.elements.some((e: Json) => e.role === "option"),
      false,
    );
    const element = request.evidence.elements.find(
      (e: Json) => e.role === "listbox",
    );
    assert.deepEqual(element.options, select.options);
    assert.deepEqual(element.operations, ["SELECT"]);
  }
  assert.equal(
    page.semantics.editable_fields[0].current_value,
    "Entered text",
    "Evidence filtering must not mutate the observation",
  );
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
        evidence: {
          semantics: {
            invalid_fields: [
              { label: "Name", validation_messages: ["Name is required."] },
            ],
          },
        },
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
  assert.deepEqual(scenarios[0].validation_fields, [
    { label: "Name", validation_messages: ["Name is required."] },
  ]);
  assert.equal(scenarios[1].transition.type, "navigation");
  assert.equal(scenarios[1].submitted_values, undefined);
  assert.deepEqual(scenarios[1].retained_business_values, { Name: "" });
  assert.deepEqual(scenarios[1].input_violations, []);
  assert.equal(scenarios[2].transition.data_set, "Names");
  assert.equal(scenarios[3].transition.type, "data_submission");
  assert.equal(scenarios[3].transition.data_set, null);
  assert.deepEqual(scenarios[3].submitted_values, { Name: "Alex" });
});

test("Comparison evidence keeps original inputs and marks trimmed references as derived, without treating them as observations", async () => {
  const local = structuredClone(model);
  local.models[0].vertices[1].properties.business.rules = [
    "The displayed name matches the supplied name after trimming surrounding spaces.",
  ];
  const calls: Json[] = [];
  const core = {
    async request(method: string, params: Json = {}) {
      if (method === "decision.answer")
        return params.result.answers[params.name].choice;
      calls.push(params);
      return {
        answers: Object.fromEntries(
          Object.keys(params.questions).map((name) => [
            name,
            {
              choice:
                name === "state"
                  ? "s1"
                  : name.startsWith("kind_")
                    ? "comparison"
                    : "uncertain",
            },
          ]),
        ),
      };
    },
  };
  const input = { Name: "  Alex  ", Notes: "  First\nSecond  " };
  const result = await new Oracle(new Decisions(core), local).check(
    { text: "No output available", semantics: {} },
    "done",
    input,
  );
  assert.equal(
    result.checks[0].status,
    "uncertain",
    "Reference calculations cannot establish an observed result",
  );
  const comparison = calls.find(
    (call) => call.evidence.submitted_business_data,
  );
  assert.ok(comparison);
  assert.deepEqual(comparison.evidence.submitted_business_data, input);
  assert.deepEqual(comparison.evidence.whitespace_trimmed_reference, {
    Name: "Alex",
    Notes: "First\nSecond",
  });
  assert.equal(input.Name, "  Alex  ");
  assert.match(
    comparison.questions.rule_0.instructions.interpretation,
    /derived solely from supplied data, not observed output/,
  );
});

test("Large audit scope choices identify dictionaries by their fields and retain all eligible outcomes", async () => {
  const local = structuredClone(model);
  local.models[0].properties.business["data sets"] = {
    "Booking party": { Traveller: { type: "text" }, Email: { type: "email" } },
  };
  local.models[0].edges = [
    {
      id: "submit",
      targetVertexId: "done",
      properties: {
        business: { "data set": "Booking party", "rejected at": "form" },
      },
    },
  ];
  const calls: Json[] = [];
  const core = {
    async request(method: string, params: Json = {}) {
      if (method === "decision.answer")
        return params.result.answers[params.name].choice;
      calls.push(params);
      return {
        answers: Object.fromEntries(
          Object.keys(params.questions).map((name) => [
            name,
            { choice: name.startsWith("scope_") ? "data_0" : "met" },
          ]),
        ),
      };
    },
  };
  const records = Array.from({ length: 12 }, (_, index) => ({
    journey: "submit",
    status: "PASS",
    observed: index % 2 ? "done" : "form",
    input: { Traveller: `Visitor ${index}` },
    evidence: { text: "x".repeat(1800) },
  }));
  const result = await new Oracle(new Decisions(core), local).audit(records, [
    "Invalid traveller details are rejected.",
  ]);
  assert.match(calls[0].questions.scope_0.criteria.data_0, /Traveller, Email/);
  assert.deepEqual(
    new Set(result[0].evidence_states),
    new Set(["done", "form"]),
  );
  assert.equal(result[0].status, "met");
});
