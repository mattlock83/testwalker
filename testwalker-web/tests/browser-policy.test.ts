import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserTarget } from "../src/browser.js";
import { StaleSnapshot, type Control } from "../src/controls.js";
import { Inconclusive, type Json } from "../src/types.js";

const journey = {
  edge: {
    sourceVertexId: "home",
    targetVertexId: "booking",
    properties: { business: { intent: "Begin a booking" } },
  },
  fields: {},
  input: {},
};

function executor(
  options: {
    candidateAnswers?: Array<string | null>;
    candidateConfidences?: number[];
    candidateScoreOverrides?: Json[];
    controls?: Array<Partial<Control>>;
    focusedAnswer?: string;
    focusedRejected?: boolean;
    rejected?: boolean;
    providerError?: boolean;
    answerError?: string;
    staleAfterDecision?: boolean;
    maxActions?: number;
  } = {},
) {
  const calls: string[] = [];
  const requests: Json[] = [];
  const validated: Json[] = [];
  const clicked: string[] = [];
  let mutations = 0;
  let resolutions = 0;
  let freshnessChecks = 0;
  const control: Control = {
    id: "snapshot-f0-c0",
    frame: 0,
    role: "button",
    label: "Book now",
    tag: "button",
    type: "button",
    value: null,
    href: null,
    in_navigation: false,
    form: null,
    context: "Start your booking",
    operations: ["CLICK"],
    readOnly: false,
    disabled: false,
  };
  const candidateAnswers = options.candidateAnswers ?? ["USE"];
  const controls = candidateAnswers.map((_, index) => ({
    ...control,
    id: `snapshot-f0-c${index}`,
    label: `Book option ${index + 1}`,
    ...options.controls?.[index],
  }));
  const target = new BrowserTarget(
    {
      async request(method, params) {
        calls.push(method);
        if (method === "decision.ask") {
          if (options.providerError)
            throw new Inconclusive("Provider unavailable");
          requests.push(params!);
          if (params?.questions.action)
            return {
              answers: {
                action: {
                  choice: options.focusedAnswer ?? "a0",
                  confidence: options.focusedRejected ? 0.6 : 0.9,
                },
              },
            };
          return {
            answers: Object.fromEntries(
              candidateAnswers.flatMap((choice, index) => {
                if (choice === null) return [];
                const level =
                  choice === "USE" ? "3" : choice === "SKIP" ? "0" : choice;
                const probabilities = Object.fromEntries(
                  ["0", "1", "2", "3"].map((key) => [
                    key,
                    key === level ? 0.9 : 0.1 / 3,
                  ]),
                );
                return [
                  [
                    `action_${index}`,
                    {
                      type: "score",
                      score: Number(level),
                      confidence:
                        options.candidateConfidences?.[index] ??
                        (options.rejected ? 0.6 : 0.9),
                      probabilities,
                      ...options.candidateScoreOverrides?.[index],
                    },
                  ],
                ];
              }),
            ),
          };
        }
        assert.equal(method, "decision.answer");
        assert.equal(params?.threshold, 0.8);
        validated.push(structuredClone(params!));
        if (options.answerError) throw new Inconclusive(options.answerError);
        const answer = params?.result.answers[params?.name];
        const invalid = () =>
          new Inconclusive(`Invalid or refused Jev answer for ${params?.name}`);
        if (!answer) throw invalid();
        let probability = answer.confidence;
        if (params?.name !== "action") {
          const keys = Object.keys(params!.choices);
          assert.deepEqual(keys, ["0", "1", "2", "3"]);
          const probabilities = answer.probabilities;
          if (
            !keys.includes(answer.choice) ||
            !probabilities ||
            Object.keys(probabilities).length !== keys.length ||
            !keys.every(
              (key) =>
                Number.isFinite(probabilities[key]) &&
                probabilities[key] >= 0 &&
                probabilities[key] <= 1,
            ) ||
            !Number.isFinite(answer.confidence) ||
            answer.confidence < 0 ||
            answer.confidence > 1
          )
            throw invalid();
          probability = probabilities[answer.choice];
          const values = Object.values(probabilities) as number[];
          if (
            Math.abs(values.reduce((sum, value) => sum + value, 0) - 1) >=
              0.02 ||
            values.some((value) => value > probability + 1e-6)
          )
            throw invalid();
        }
        if (
          answer.confidence < params!.threshold ||
          probability < params!.threshold
        )
          throw new Inconclusive("Confidence below threshold", {
            uncertain_decision: true,
            answer,
          });
        // Deliberately allow malformed focused answers through this fake to test the final guard.
        return answer.choice;
      },
    },
    {},
    false,
    { actions_per_journey: options.maxActions ?? 25 },
  );
  (target as any).snapshot = {
    controls,
    page: {
      url: "https://example.test/",
      title: "Home",
      text: "Begin a booking",
    },
    async assertFresh() {
      freshnessChecks++;
      if (options.staleAfterDecision && freshnessChecks > 1)
        throw new StaleSnapshot("The page changed after observation");
    },
    async resolve(id: string) {
      resolutions++;
      assert.ok(controls.some((control) => control.id === id));
      return {
        async click() {
          mutations++;
          clicked.push(id);
        },
        async dispose() {},
      };
    },
  };
  return {
    target,
    calls,
    requests,
    validated,
    clicked,
    get mutations() {
      return mutations;
    },
    get resolutions() {
      return resolutions;
    },
    get freshnessChecks() {
      return freshnessChecks;
    },
    execute(params: Json = journey) {
      return target.execute(params, async () => {
        throw new Error(
          "An unchanged observed page does not need another state decision",
        );
      });
    },
  };
}

test("A confident action executes one observed control without an extra state or completion decision", async () => {
  const run = executor();
  await run.execute();
  assert.deepEqual(run.calls, ["decision.ask", "decision.answer"]);
  assert.equal(run.mutations, 1);
  assert.equal(run.resolutions, 1);
});

test("Native score adaptation preserves provider score, confidence and probabilities for the existing core gate", async () => {
  const run = executor({ candidateConfidences: [0.87] });
  await run.execute();
  assert.equal(run.requests[0].questions.action_0.type, "score");
  assert.deepEqual(run.validated[0].result.answers.action_0, {
    type: "score",
    score: 3,
    confidence: 0.87,
    probabilities: { "0": 0.1 / 3, "1": 0.1 / 3, "2": 0.1 / 3, "3": 0.9 },
    choice: "3",
  });
});

test("Confident unrelated, contextual and merely plausible scores never click or request clarification", async () => {
  for (const candidateAnswers of [["0"], ["1"], ["2"], ["0", "1", "2"]]) {
    const run = executor({ candidateAnswers });
    await assert.rejects(run.execute(), Inconclusive);
    assert.equal(run.requests.length, 1);
    assert.equal(run.resolutions, 0);
    assert.equal(run.mutations, 0);
  }
});

test("Malformed scores, probability keys and nonfinite or out-of-range numbers cannot cause an action or clarification", async () => {
  for (const override of [
    { type: "choice" },
    { score: Number.NaN },
    { score: Number.POSITIVE_INFINITY },
    { score: -1 },
    { score: 4 },
    { confidence: Number.NaN },
    { confidence: 1.1 },
    { probabilities: { "0": 0, "1": 0, "2": 0, "4": 1 } },
    { probabilities: { "0": 0, "1": 0, "2": 0, "3": Number.NaN } },
    { probabilities: { "0": -0.1, "1": 0, "2": 0, "3": 1.1 } },
    { probabilities: { "0": 0, "1": 0, "2": 0, "3": 0.6 } },
  ]) {
    const run = executor({ candidateScoreOverrides: [override] });
    await assert.rejects(run.execute(), Inconclusive);
    assert.equal(run.requests.length, 1);
    assert.equal(run.resolutions, 0);
    assert.equal(run.mutations, 0);
  }
});

test("A malformed or missing candidate assessment prevents interaction even when another candidate is supported", async () => {
  for (const candidateAnswers of [
    ["USE", null],
    [null, "USE"],
    ["USE", "unexpected"],
  ]) {
    const run = executor({ candidateAnswers });
    await assert.rejects(run.execute(), Inconclusive);
    assert.equal(run.requests.length, 1);
    assert.equal(run.resolutions, 0);
    assert.equal(run.mutations, 0);
  }
});

test("Rejected, absent and malformed action choices cause no browser mutations or clarification", async () => {
  for (const options of [
    { candidateAnswers: ["SKIP"] },
    { candidateAnswers: [null] },
    { candidateAnswers: ["NONE"] },
    { candidateAnswers: ["a0"] },
    { candidateAnswers: ["use"] },
    { candidateAnswers: ["unexpected"] },
  ]) {
    const run = executor(options);
    await assert.rejects(run.execute(), Inconclusive);
    assert.equal(
      run.calls.filter((method) => method === "decision.ask").length,
      1,
    );
    assert.equal(run.mutations, 0);
    assert.equal(run.resolutions, 0);
  }
});

test("One focused clarification may resolve a valid uncertain candidate before a single action", async () => {
  const run = executor({
    candidateAnswers: ["SKIP", "USE", "SKIP"],
    candidateConfidences: [0.95, 0.78, 0.95],
    focusedAnswer: "a1",
  });
  await run.execute();
  assert.equal(run.requests.length, 2);
  assert.deepEqual(Object.keys(run.requests[1].questions.action.criteria), [
    "a1",
    "NONE",
  ]);
  assert.deepEqual(run.clicked, ["snapshot-f0-c1"]);
  assert.equal(run.mutations, 1);
});

test("Clarification remains bounded and rejects uncertain, absent, malformed or out-of-scope choices", async () => {
  for (const options of [
    { focusedRejected: true },
    { focusedAnswer: "NONE" },
    { focusedAnswer: "a0" },
    { focusedAnswer: "a999" },
    { focusedAnswer: "a" },
    { focusedAnswer: "a01" },
    { focusedAnswer: "a1e0" },
  ]) {
    const run = executor({
      candidateAnswers: ["SKIP", "USE"],
      candidateConfidences: [0.95, 0.78],
      ...options,
    });
    await assert.rejects(run.execute(), Inconclusive);
    assert.equal(run.requests.length, 2);
    assert.deepEqual(Object.keys(run.requests[1].questions.action.criteria), [
      "a1",
      "NONE",
    ]);
    assert.equal(run.resolutions, 0);
    assert.equal(run.mutations, 0);
  }
});

test("Decision validation or budget failures do not trigger clarification", async () => {
  for (const answerError of [
    "Invalid or refused Jev answer for action_0",
    "Decision allowance exhausted",
  ]) {
    const run = executor({ answerError });
    await assert.rejects(run.execute(), Inconclusive);
    assert.deepEqual(run.calls, ["decision.ask", "decision.answer"]);
    assert.equal(run.requests.length, 1);
    assert.equal(run.resolutions, 0);
    assert.equal(run.mutations, 0);
  }
});

test("Independent action assessments stay in one provider request when one observed control qualifies", async () => {
  const run = executor({ candidateAnswers: ["SKIP", "USE", "SKIP"] });
  await run.execute();
  assert.deepEqual(run.calls, [
    "decision.ask",
    "decision.answer",
    "decision.answer",
    "decision.answer",
  ]);
  assert.deepEqual(Object.keys(run.requests[0].questions), [
    "action_0",
    "action_1",
    "action_2",
  ]);
  assert.deepEqual(run.clicked, ["snapshot-f0-c1"]);
});

test("Several qualifying actions require one focused decision and still execute exactly once", async () => {
  const run = executor({
    candidateAnswers: ["USE", "SKIP", "USE"],
    focusedAnswer: "a2",
  });
  await run.execute();
  assert.equal(run.requests.length, 2);
  assert.deepEqual(Object.keys(run.requests[1].questions.action.criteria), [
    "a0",
    "a2",
    "NONE",
  ]);
  assert.deepEqual(run.clicked, ["snapshot-f0-c2"]);
});

test("Equivalent links with independently approved actions choose navigation without another provider request", async () => {
  const run = executor({
    candidateAnswers: ["USE", "USE"],
    controls: [
      {
        role: "link",
        label: "Discard changes",
        href: "https://example.test/account",
        in_navigation: false,
      },
      {
        role: "link",
        label: "My account",
        href: "https://example.test/account",
        in_navigation: true,
      },
    ],
  });
  await run.execute();
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.clicked, ["snapshot-f0-c1"]);
});

test("An unapproved navigation link cannot represent an approved alternative with the same URL", async () => {
  const run = executor({
    candidateAnswers: ["SKIP", "USE"],
    controls: [
      {
        role: "link",
        label: "Cancel",
        href: "https://example.test/workflow",
        in_navigation: true,
      },
      {
        role: "link",
        label: "Continue",
        href: "https://example.test/workflow",
        in_navigation: false,
      },
    ],
  });
  await run.execute();
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.clicked, ["snapshot-f0-c1"]);
});

test("Approved home links matching the current page URL choose navigation without a focused decision", async () => {
  const run = executor({
    candidateAnswers: ["USE", "USE"],
    controls: [
      {
        role: "link",
        label: "Start again",
        href: "https://example.test/",
        in_navigation: false,
      },
      {
        role: "link",
        label: "Home",
        href: "https://example.test/",
        in_navigation: true,
      },
    ],
  });
  await run.execute();
  assert.equal(run.requests.length, 1);
  assert.deepEqual(run.clicked, ["snapshot-f0-c1"]);
});

test("Approved links with different browsing targets still require a focused decision", async () => {
  const run = executor({
    candidateAnswers: ["USE", "USE"],
    controls: [
      {
        role: "link",
        label: "Open here",
        href: "https://example.test/account",
        target: "",
      },
      {
        role: "link",
        label: "Open new tab",
        href: "https://example.test/account",
        target: "_blank",
      },
    ],
    focusedAnswer: "a1",
  });
  await run.execute();
  assert.equal(run.requests.length, 2);
  assert.deepEqual(run.clicked, ["snapshot-f0-c1"]);
});

test("Focused decisions cannot select rejected candidates, malformed IDs or low-confidence actions", async () => {
  for (const options of [
    { focusedAnswer: "NONE" },
    { focusedAnswer: "a1" },
    { focusedAnswer: "a999" },
    { focusedAnswer: "a" },
    { focusedAnswer: "a00" },
    { focusedAnswer: "a1e0" },
    { focusedRejected: true },
  ]) {
    const run = executor({
      candidateAnswers: ["USE", "SKIP", "USE"],
      ...options,
    });
    await assert.rejects(run.execute(), Inconclusive);
    assert.equal(run.requests.length, 2);
    assert.equal(run.resolutions, 0);
    assert.equal(run.mutations, 0);
  }
});

test("A page changing while a decision is pending prevents the action and is never retried", async () => {
  const run = executor({ staleAfterDecision: true });
  await assert.rejects(run.execute(), StaleSnapshot);
  assert.deepEqual(run.calls, ["decision.ask", "decision.answer"]);
  assert.equal(run.freshnessChecks, 2);
  assert.equal(run.mutations, 0);
  assert.equal(run.resolutions, 0);
});

test("Provider failures stop before interaction without repeating the decision", async () => {
  const run = executor({ providerError: true });
  await assert.rejects(run.execute(), /Provider unavailable/);
  assert.deepEqual(run.calls, ["decision.ask"]);
  assert.equal(run.mutations, 0);
  assert.equal(run.resolutions, 0);
});

test("The input and submission action budget is checked before any fields are changed", async () => {
  const run = executor({ maxActions: 1 });
  await assert.rejects(
    run.execute({
      ...journey,
      fields: { Name: { required: true } },
      input: { Name: "" },
    }),
    /action allowance/,
  );
  assert.deepEqual(run.calls, []);
  assert.equal(run.mutations, 0);
  assert.equal(run.resolutions, 0);
});
