import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { BrowserTarget } from "../src/browser.js";
import { Inconclusive, type Json, type Rpc } from "../src/types.js";
import { StaleSnapshot } from "../src/controls.js";
import { createServer } from "node:http";
import { once } from "node:events";

const chrome = { skip: !process.env.TESTWALKER_BROWSER_TESTS };
const journey = (intent: string): Json => ({
  edge: {
    sourceVertexId: "before",
    targetVertexId: "after",
    properties: { business: { intent } },
  },
  fields: {},
});

// Deterministic provider responses exercise browser behavior, while keeping the
// same confidence/choice validation boundary used by the real Rust service.
function provider(
  choose: (name: string, question: Json) => string,
  beforeOptions?: (params: Json) => Promise<void>,
  confidence = 1,
) {
  const requests: Json[] = [];
  const core: Rpc = {
    async request(method, params = {}) {
      if (method === "decision.answer") {
        const answer = params.result.answers[params.name];
        if (!answer || !Object.hasOwn(params.choices, answer.choice))
          throw new Inconclusive("Invalid option answer");
        if (answer.confidence < params.threshold)
          throw new Inconclusive("Confidence below threshold");
        return answer.choice;
      }
      assert.equal(method, "decision.ask");
      requests.push(params);
      const optionsRequest = !Object.keys(params.questions).some((name) =>
        name.startsWith("action_"),
      );
      if (optionsRequest) await beforeOptions?.(params);
      return {
        answers: Object.fromEntries(
          Object.entries(params.questions).map(
            ([name, question]: [string, any]) => {
              if (name.startsWith("action_")) {
                const score =
                  question.instructions.control.label === "Sort products"
                    ? 3
                    : 0;
                return [
                  name,
                  {
                    type: "score",
                    score,
                    confidence: 1,
                    probabilities: {
                      0: score === 0 ? 1 : 0,
                      1: 0,
                      2: 0,
                      3: score === 3 ? 1 : 0,
                    },
                  },
                ];
              }
              return [name, { choice: choose(name, question), confidence }];
            },
          ),
        ),
      };
    },
  };
  return { core, requests };
}

const html = `<form><label>Sort products<select id="sort">
  <option value="same">Alphabetical</option>
  <option value="same">Reverse alphabetical</option>
  <option disabled value="disabled">Unavailable</option>
  <optgroup disabled label="Unavailable group"><option value="group">Group unavailable</option></optgroup>
  </select></label><button>Submit</button></form>
  <label>Disabled<select disabled><option>Reverse alphabetical</option></select></label>
  <script>window.events=[];window.submits=0;
  document.getElementById('sort').oninput=()=>window.events.push('input');
  document.getElementById('sort').onchange=()=>window.events.push('change');
  document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};</script>`;

test(
  "A native select change can navigate normally before independent destination observation",
  chrome,
  async () => {
    const server = createServer((request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end(
        request.url === "/result"
          ? "<title>Selection result</title><h1>Reverse alphabetical</h1>"
          : html +
              "<script>document.getElementById('sort').onchange=()=>location.assign('/result');</script>",
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const run = await fixture(provider(() => "o1"));
    try {
      const address = server.address() as { port: number };
      await run.page.goto(`http://127.0.0.1:${address.port}/`);
      await run.target.execute(
        journey("Select reverse alphabetical sorting."),
        async () => null,
      );
      await run.page.waitForURL("**/result");
      const observation = await run.target.observe();
      assert.equal(observation.title, "Selection result");
      assert.match(observation.text, /Reverse alphabetical/);
      assert.equal(run.target.trace.at(-1)!.operation, "select");
    } finally {
      await run.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

async function fixture(decisions: ReturnType<typeof provider>, content = html) {
  const browser = await chromium.launch({ channel: "chrome" });
  const target = new BrowserTarget(decisions.core);
  try {
    const page = (target.page = await browser.newPage());
    await page.setContent(content);
    return {
      page,
      target,
      close: async () => {
        await target.close();
        await browser.close();
      },
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

test(
  "Standalone native selection uses labels, disambiguates duplicate values, and dispatches normal events without submission",
  chrome,
  async () => {
    const decisions = provider((_, question) => {
      assert.deepEqual(Object.keys(question.criteria), ["o0", "o1", "NONE"]);
      return Object.entries(question.criteria).find(
        ([, option]: [string, any]) => option.label === "Reverse alphabetical",
      )![0];
    });
    const run = await fixture(decisions);
    try {
      await run.target.execute(
        journey("Sort products in reverse alphabetical order."),
        async () => null,
      );
      assert.equal(
        await run.page
          .locator("#sort")
          .evaluate((select: HTMLSelectElement) => select.selectedIndex),
        1,
      );
      assert.deepEqual(await run.page.evaluate(() => (window as any).events), [
        "input",
        "change",
      ]);
      assert.equal(await run.page.evaluate(() => (window as any).submits), 0);
      assert.equal(
        decisions.requests.length,
        2,
        "One batched action decision and one option choice",
      );
      assert.equal(run.target.trace.at(-1)!.operation, "select");
      assert.equal(
        run.target.trace.at(-1)!.options[0].label,
        "Reverse alphabetical",
      );
      assert.ok(
        decisions.requests[1].evidence.selects[0].options.some(
          (option: Json) => option.disabled,
        ),
      );
    } finally {
      await run.close();
    }
  },
);

test(
  "Validated selection bindings are reused only with matching current evidence",
  chrome,
  async () => {
    const decisions = provider(() => "o1");
    const run = await fixture(decisions);
    try {
      const params = journey("Select reverse alphabetical sorting.");
      await run.target.execute(params, async () => null);
      await run.page.locator("#sort").evaluate((select: HTMLSelectElement) => {
        select.selectedIndex = 0;
      });
      await run.target.observe();
      await run.target.execute(params, async () => null);
      assert.equal(
        decisions.requests.length,
        2,
        "An identical observed starting configuration reuses the validated plan",
      );
      await run.page.locator("#sort").evaluate((select: HTMLSelectElement) => {
        select.selectedIndex = 0;
        select.options[1].label = "Newest first";
      });
      await run.target.observe();
      await run.target.execute(
        journey("Select newest first sorting."),
        async () => null,
      );
      assert.equal(
        decisions.requests.length,
        4,
        "Changed option evidence requires fresh decisions",
      );
    } finally {
      await run.close();
    }
  },
);

for (const failure of [
  "none",
  "invalid",
  "confidence",
  "provider",
  "stale",
] as const) {
  test(
    `Native select ${failure} stops before any selection or submission`,
    chrome,
    async () => {
      let run: Awaited<ReturnType<typeof fixture>>;
      const decisions = provider(
        () =>
          failure === "none" ? "NONE" : failure === "invalid" ? "o3" : "o1",
        async () => {
          if (failure === "provider")
            throw new Inconclusive("Provider unavailable");
          if (failure === "stale")
            await run.page
              .locator("#sort")
              .evaluate((select: HTMLSelectElement) => {
                select.options[1].label = "Changed option";
              });
        },
        failure === "confidence" ? 0.7 : 1,
      );
      run = await fixture(decisions);
      try {
        await assert.rejects(
          run.target.execute(
            journey("Select reverse alphabetical sorting."),
            async () => null,
          ),
          failure === "stale" ? StaleSnapshot : Inconclusive,
        );
        assert.equal(
          await run.page
            .locator("#sort")
            .evaluate((select: HTMLSelectElement) => select.selectedIndex),
          0,
        );
        assert.deepEqual(
          await run.page.evaluate(() => (window as any).events),
          [],
        );
        assert.equal(await run.page.evaluate(() => (window as any).submits), 0);
      } finally {
        await run.close();
      }
    },
  );
}

test(
  "Multi-select applies the complete set and allows clearing; uncertain membership causes no partial mutation",
  chrome,
  async () => {
    let mode = "both";
    const decisions = provider((name) =>
      name === "selection"
        ? "READY"
        : mode === "unknown" && name === "option_1"
          ? "UNKNOWN"
          : mode === "both"
            ? "include"
            : "exclude",
    );
    const run = await fixture(
      decisions,
      html.replace('id="sort"', 'id="sort" multiple'),
    );
    try {
      await run.target.execute(
        journey("Select alphabetical and reverse alphabetical."),
        async () => null,
      );
      assert.deepEqual(
        await run.page
          .locator("#sort")
          .evaluate((select: HTMLSelectElement) =>
            [...select.selectedOptions].map((option) => option.index),
          ),
        [0, 1],
      );
      mode = "unknown";
      await run.target.observe();
      await assert.rejects(
        run.target.execute(
          journey("Remove one unclear sorting choice."),
          async () => null,
        ),
        /remains ambiguous/,
      );
      assert.deepEqual(
        await run.page
          .locator("#sort")
          .evaluate((select: HTMLSelectElement) =>
            [...select.selectedOptions].map((option) => option.index),
          ),
        [0, 1],
      );
      mode = "clear";
      await run.target.execute(
        journey("Clear all sorting choices."),
        async () => null,
      );
      assert.equal(
        await run.page
          .locator("#sort")
          .evaluate(
            (select: HTMLSelectElement) => select.selectedOptions.length,
          ),
        0,
      );
      assert.deepEqual(await run.page.evaluate(() => (window as any).events), [
        "input",
        "change",
        "input",
        "change",
      ]);
    } finally {
      await run.close();
    }
  },
);

test(
  "A multi-select request requiring disabled options is refused as a whole",
  chrome,
  async () => {
    const decisions = provider((name) =>
      name === "selection" ? "UNKNOWN" : "exclude",
    );
    const run = await fixture(
      decisions,
      html.replace('id="sort"', 'id="sort" multiple'),
    );
    try {
      await assert.rejects(
        run.target.execute(
          journey("Select the unavailable option."),
          async () => null,
        ),
        /cannot be determined/,
      );
      assert.deepEqual(
        await run.page.evaluate(() => (window as any).events),
        [],
      );
    } finally {
      await run.close();
    }
  },
);
