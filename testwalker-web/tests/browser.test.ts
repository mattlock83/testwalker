import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserTarget } from "../src/browser.js";
import { Inconclusive } from "../src/types.js";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";

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
  (target as any).page = {
    locator: () => ({
      inputValue: async () => "",
      evaluateHandle: async () => ({
        evaluate: async () => false,
        dispose: async () => {},
      }),
    }),
  };
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

test(
  "A standard form submits invalid data once through its bound controls; ambiguous submitters still require Jev",
  {
    skip: !process.env.TESTWALKER_BROWSER_TESTS,
  },
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<form id="unrelated"><input name="other"><button>Review</button></form>
      <form id="active" novalidate><input id="age" name="age"><button id="send">Review</button>
      <button disabled>Disabled submit</button><button style="display:none">Hidden submit</button></form>
      <input id="name" form="active" name="name"><div id="errors" role="alert"></div>
      <script>window.attempts=[];window.unrelated=0;
      document.getElementById('unrelated').onsubmit=e=>{e.preventDefault();window.unrelated++};
      document.getElementById('active').onsubmit=e=>{e.preventDefault();window.attempts.push({
        name:document.getElementById('name').value,age:document.getElementById('age').value});
        document.getElementById('errors').textContent='Invalid data';};</script>`);
      const target = new BrowserTarget({
        request: async () => {
          throw new Error("Unexpected decision");
        },
      });
      target.page = page;
      let fallbackCalls = 0;
      (target as any).actor = {
        act: async (_intent: string, options: any) => {
          if (!options.fields) {
            fallbackCalls++;
            throw new Inconclusive("AI required for ambiguous form");
          }
          await page.locator("#name").fill(String(options.fields.Name));
          await page.locator("#age").fill(String(options.fields.Age));
          return {
            actions: [
              {
                selector: "#name",
                target: { role: "textbox" },
                operationConfidence: 1,
              },
              {
                selector: "#age",
                target: { role: "textbox" },
                operationConfidence: 1,
              },
            ],
          };
        },
      };
      const params = {
        edge: {
          properties: { business: { intent: "Review the supplied details." } },
        },
        fields: { Name: { required: true }, Age: { minimum: 1, maximum: 6 } },
        input: { Name: "", Age: 7 },
      };
      await target.execute(params, async () => null);
      await target.execute(params, async () => null);
      const attempts = await page.evaluate(() => (window as any).attempts);
      assert.deepEqual(attempts, [
        { name: "", age: "7" },
        { name: "", age: "7" },
      ]);
      assert.equal(await page.evaluate(() => (window as any).unrelated), 0);
      assert.equal(fallbackCalls, 0);
      assert.equal(
        target.trace.filter((entry) => entry.operation === "submit").length,
        2,
      );
      await page.locator("#active").evaluate((form) => {
        const button = document.createElement("button");
        button.textContent = "Save draft";
        form.append(button);
      });
      await assert.rejects(
        target.execute(params, async () => null),
        /AI required/,
      );
      assert.equal(fallbackCalls, 1);
      assert.equal(
        (await page.evaluate(() => (window as any).attempts)).length,
        2,
        "Never arbitrarily click the first submitter when multiple business operations exist",
      );
    } finally {
      await browser.close();
    }
  },
);

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

test(
  "Observation waits for a delayed form request and captures one coherent resulting state",
  {
    skip: !process.env.TESTWALKER_BROWSER_TESTS,
  },
  async () => {
    const server = createServer((request, response) => {
      if (request.url === "/save") {
        setTimeout(() => response.end("saved"), 250);
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(`<title>Entry</title><h1>Entry</h1><form novalidate><input id="name"><button>Save</button></form>
      <script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();
      await (await fetch('/save')).text();history.pushState(null,'','#saved');document.title='Saved';
      document.body.innerHTML='<h1>Saved</h1><div role="status">Profile saved</div>';};</script>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address() as { port: number };
    const target = new BrowserTarget({
      request: async () => {
        throw new Error("Unexpected decision");
      },
    });
    try {
      await target.start();
      await target.reset(`http://127.0.0.1:${address.port}/`);
      (target as any).actor = {
        act: async (_intent: string, options: any) => {
          assert.ok(
            options.fields,
            "A unique standard form does not require another decision",
          );
          await target.page!.locator("#name").fill(options.fields.Name);
          return {
            actions: [
              {
                selector: "#name",
                target: { role: "textbox" },
                operationConfidence: 1,
              },
            ],
          };
        },
      };
      await target.execute(
        {
          edge: { properties: { business: { intent: "Save name" } } },
          fields: { Name: { required: true } },
          input: { Name: "Alex" },
        },
        async () => null,
      );
      const snapshot = await target.observe();
      assert.equal(snapshot.title, "Saved");
      assert.ok(snapshot.url.endsWith("#saved"));
      assert.deepEqual(snapshot.semantics.status, ["Profile saved"]);
      assert.ok(snapshot.accessibility_tree.includes("Saved"));
      assert.equal((target as any).pendingRequests.size, 0);
    } finally {
      await target.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test("Ambiguous equivalent links are grouped before a single navigation action; confidence remains enforced", async () => {
  const calls: any[] = [];
  let uncertain = false;
  let href = "http://example.test/equipment";
  const target = new BrowserTarget({
    request: async (method, params) => {
      calls.push({ method, params });
      if (method === "decision.ask") return { answers: {} };
      assert.equal(params?.threshold, 0.8);
      if (uncertain) throw new Inconclusive("Uncertain destination");
      return "d0";
    },
  });
  target.observe = async () => ({
    url: "http://example.test/river",
    title: "River",
    semantics: {
      available_links: [
        {
          label: "Equipment guide",
          href,
          in_navigation: false,
        },
        {
          label: "Equipment",
          href,
          in_navigation: true,
        },
        { label: "Home", href: "http://example.test/", in_navigation: true },
      ],
    },
  });
  const intents: string[] = [];
  let attempts = 0;
  let rejectNext = true;
  (target as any).actor = {
    act: async (intent: string) => {
      intents.push(intent);
      attempts++;
      if (rejectNext) {
        rejectNext = false;
        throw new Error("Jev target confidence 0.520 is below 0.8");
      }
      return { actions: [{ operationConfidence: 1 }], success: true };
    },
  };
  const params = {
    edge: {
      sourceVertexId: "river",
      targetVertexId: "equipment",
      properties: { business: { intent: "Visit the equipment guide." } },
    },
    fields: {},
  };
  await target.execute(params, async () => null);
  assert.equal(calls[0].params.evidence.destinations.length, 2);
  assert.equal(calls[0].params.evidence.destinations[0].links.length, 2);
  assert.match(intents[1], /accessible name "Equipment" inside navigation/);
  assert.equal(target.trace[0].operation, "navigation_disambiguation");
  await target.execute(params, async () => null);
  assert.equal(
    calls.length,
    2,
    "An unchanged observed hint needs no destination reclassification",
  );
  assert.match(intents[2], /accessible name "Equipment" inside navigation/);
  assert.equal(target.trace[2].operation, "navigation_hint");
  href = "http://example.test/equipment-new";
  rejectNext = true;
  uncertain = true;
  await assert.rejects(
    target.execute(params, async () => null),
    /Uncertain destination/,
  );
  assert.equal(
    attempts,
    4,
    "No browser action follows an uncertain destination",
  );
});

test("Target disambiguation never retries form entry or failed browser operations", async () => {
  let attempts = 0;
  const target = new BrowserTarget({
    request: async () => {
      throw new Error("Unexpected retry");
    },
  });
  (target as any).actor = {
    act: async () => {
      attempts++;
      throw new Error("Jev target confidence for Name (0.520) is below 0.8");
    },
  };
  await assert.rejects(
    target.execute(
      {
        edge: { properties: { business: { intent: "Submit." } } },
        fields: { Name: { required: true } },
        input: { Name: "" },
      },
      async () => null,
    ),
    /target confidence/,
  );
  assert.equal(attempts, 1);
  (target as any).actor = {
    act: async () => {
      attempts++;
      throw new Error("Click timed out after an operation");
    },
  };
  await assert.rejects(
    target.execute(
      {
        edge: {
          sourceVertexId: "form",
          targetVertexId: "form",
          properties: { business: { intent: "Continue." } },
        },
        fields: {},
      },
      async () => null,
    ),
    /Click timed out/,
  );
  assert.equal(attempts, 2);
});
