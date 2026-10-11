import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserTarget } from "../src/browser.js";
import { Inconclusive, type Json, type Rpc } from "../src/types.js";
import { chromium } from "playwright";
import { createServer } from "node:http";
import { once } from "node:events";

const chrome = { skip: !process.env.TESTWALKER_BROWSER_TESTS };
function decisionClient(actionLabel = "Continue") {
  const requests: Json[] = [];
  let override: ((params: Json) => Promise<void>) | undefined;
  const core: Rpc = {
    async request(method, params = {}) {
      if (method === "decision.answer") {
        assert.equal(params.threshold, 0.8);
        return params.result.answers[params.name].choice;
      }
      assert.equal(method, "decision.ask");
      requests.push(params);
      await override?.(params);
      return {
        answers: Object.fromEntries(
          Object.entries(params.questions).map(
            ([name, question]: [string, any]) => {
              if (name.startsWith("action_"))
                return [
                  name,
                  {
                    type: "score",
                    score:
                      question.instructions.control.label === actionLabel
                        ? 3
                        : 0,
                    confidence: 1,
                    probabilities:
                      question.instructions.control.label === actionLabel
                        ? { 0: 0, 1: 0, 2: 0, 3: 1 }
                        : { 0: 1, 1: 0, 2: 0, 3: 0 },
                  },
                ];
              const candidate = Object.entries(question.criteria).find(
                ([key, control]: [string, any]) =>
                  key !== "NONE" &&
                  (name === "action"
                    ? control.includes(`: ${actionLabel}`)
                    : control.label === question.instructions.business_field),
              );
              assert.ok(
                candidate,
                `Test provider has no candidate for ${name}`,
              );
              return [name, { choice: candidate[0] }];
            },
          ),
        ),
      };
    },
  };
  return {
    core,
    requests,
    setOverride(value: typeof override) {
      override = value;
    },
  };
}
const formParams = (fields: Json, input: Json): Json => ({
  edge: {
    sourceVertexId: "entry",
    targetVertexId: "result",
    properties: { business: { intent: "Review the supplied form details." } },
  },
  fields,
  input,
});
const navParams = {
  edge: {
    sourceVertexId: "home",
    targetVertexId: "next",
    properties: { business: { intent: "Continue" } },
  },
  fields: {},
};

test(
  "Native forms bind all fields together, preserve invalid data and submit once through the associated form",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const decisions = decisionClient("Save draft");
    const target = new BrowserTarget(decisions.core);
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent(`<form id="unrelated"><label>Other<input></label><button>Review</button></form>
      <form id="active" novalidate><label>Age<input id="age"></label><button>Review</button>
      <button disabled>Disabled</button><button style="display:none">Hidden</button></form>
      <label>Name<input id="name" form="active"></label><div role="alert" id="errors"></div>
      <script>window.attempts=[];window.unrelated=0;
      document.getElementById('unrelated').onsubmit=e=>{e.preventDefault();window.unrelated++};
      document.getElementById('active').onsubmit=e=>{e.preventDefault();window.attempts.push({name:document.getElementById('name').value,age:document.getElementById('age').value});document.getElementById('errors').textContent='Invalid data'};</script>`);
      const params = formParams(
        { Name: { required: true }, Age: { minimum: 1, maximum: 6 } },
        { Name: "", Age: 7 },
      );
      await target.execute(params, async () => {
        throw new Error("Unexpected state check before form entry");
      });
      assert.equal(
        decisions.requests.length,
        1,
        "All fields share one request; native submit adds none",
      );
      assert.equal(Object.keys(decisions.requests[0].questions).length, 2);
      await target.observe();
      await target.execute(params, async () => null);
      assert.deepEqual(await page.evaluate(() => (window as any).attempts), [
        { name: "", age: "7" },
        { name: "", age: "7" },
      ]);
      assert.equal(await page.evaluate(() => (window as any).unrelated), 0);
      await page.locator("#active").evaluate((form) => {
        const button = document.createElement("button");
        button.textContent = "Save draft";
        form.append(button);
      });
      await target.execute(params, async () => null);
      assert.ok(
        decisions.requests.at(-1)!.questions.action_0,
        "Multiple submit operations need a fresh Jev decision",
      );
      assert.equal(
        (await page.evaluate(() => (window as any).attempts)).length,
        3,
      );
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Changing an earlier field during a later fill is detected before submission",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const target = new BrowserTarget(decisionClient().core);
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent(`<form novalidate><label>Name<input id="name"></label><label>Age<input id="age"></label><button>Continue</button></form>
      <script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};
      document.querySelector('#age').oninput=()=>document.querySelector('#name').value='Repaired';</script>`);
      await assert.rejects(
        target.execute(
          formParams(
            { Name: { required: true }, Age: {} },
            { Name: "", Age: 7 },
          ),
          async () => null,
        ),
        /exact input/,
      );
      assert.equal(await page.evaluate(() => (window as any).submits), 0);
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Native checkboxes, radio controls and select labels retain literal input semantics",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const target = new BrowserTarget(decisionClient().core);
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent(`<form><label>Agree<input type="checkbox"></label><label>Preferred<input type="radio"></label>
      <label>Journey<select><option value="ridge">Ridge walk</option><optgroup disabled><option value="river">River paddle</option></optgroup></select></label><button>Continue</button></form>
      <script>window.submits=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++};</script>`);
      const fields = { Agree: {}, Preferred: {}, Journey: {} };
      await target.execute(
        formParams(fields, {
          Agree: false,
          Preferred: true,
          Journey: "Ridge walk",
        }),
        async () => null,
      );
      assert.equal(
        await page.locator('input[type="checkbox"]').isChecked(),
        false,
      );
      assert.equal(await page.locator('input[type="radio"]').isChecked(), true);
      assert.equal(await page.evaluate(() => (window as any).submits), 1);
      await assert.rejects(
        target.execute(
          formParams(fields, {
            Agree: true,
            Preferred: true,
            Journey: "River paddle",
          }),
          async () => null,
        ),
        /literal select option/,
      );
      assert.equal(await page.evaluate(() => (window as any).submits), 1);
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Navigation groups duplicate destinations and reuses a binding only with unchanged decision context",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const decisions = decisionClient("Continue");
    const target = new BrowserTarget(decisions.core);
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent(`<h1>Start</h1><p id="context">Choose the current journey</p><nav><a href="https://example.test/next">Continue</a></nav><a href="https://example.test/next">Continue</a>
      <script>window.clicked=[];document.querySelectorAll('a').forEach(a=>a.onclick=e=>{e.preventDefault();window.clicked.push(a.textContent)});</script>`);
      await target.observe();
      const identify = async () => {
        throw new Error(
          "An unchanged checkpoint needs no pre-navigation Jev call",
        );
      };
      await target.execute(navParams, identify);
      assert.equal(
        Object.keys(decisions.requests[0].questions).length,
        1,
        "One independently assessed destination",
      );
      await target.execute(navParams, identify);
      assert.equal(
        decisions.requests.length,
        1,
        "A fresh identical control plan can reuse the resolved binding",
      );
      await page
        .locator("#context")
        .evaluate(
          (element) =>
            (element.textContent = "The surrounding instructions changed"),
        );
      await target.execute(navParams, async () => "home");
      assert.equal(
        decisions.requests.length,
        2,
        "Changed decision evidence invalidates the cached choice",
      );
      assert.deepEqual(await page.evaluate(() => (window as any).clicked), [
        "Continue",
        "Continue",
        "Continue",
      ]);
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Only a changed checkpoint triggers detection of a hook-completed transition",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const target = new BrowserTarget({
      request: async () => {
        throw new Error("A completed hook needs no action decision");
      },
    });
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent("<h1>Before hook</h1>");
      await target.observe();
      await page.setContent("<h1>After hook</h1>");
      let checked = 0;
      await target.execute(navParams, async (evidence) => {
        checked++;
        assert.match(evidence.text, /After hook/);
        return "next";
      });
      assert.equal(checked, 1);
      assert.equal(target.trace.at(-1)!.operation, "hook_transition_observed");
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Different link labels remain distinct actions even when their URLs match",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const decisions = decisionClient("Continue");
    const target = new BrowserTarget(decisions.core);
    try {
      const page = (target.page = await browser.newPage());
      for (const href of ["#", "https://example.test/workflow"]) {
        await page.setContent(`<nav><a href="${href}" onclick="event.preventDefault();window.chosen='wrong'">Cancel</a></nav>
        <a href="${href}" onclick="event.preventDefault();window.chosen='right'">Continue</a>`);
        await target.execute(navParams, async () => null);
        assert.equal(
          Object.keys(decisions.requests.at(-1)!.questions).length,
          2,
        );
        assert.equal(
          await page.evaluate(() => (window as any).chosen),
          "right",
        );
      }
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "A hook-opened popup replaces the observed page and closing it restores the opener",
  chrome,
  async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      response.end(
        request.url === "/popup"
          ? '<h1>Popup complete</h1><button onclick="window.close()">Close</button>'
          : '<h1>Original page</h1><button onclick="window.clicked=true">Continue</button>',
      );
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const decisions = decisionClient();
    const target = new BrowserTarget(decisions.core);
    try {
      await target.start();
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      await target.reset(url);
      const original = target.page!;
      await target.observe();
      const popupReady = original.waitForEvent("popup");
      await original.evaluate(() => window.open("/popup"));
      const popup = await popupReady;
      await popup.waitForLoadState("domcontentloaded");
      assert.equal(target.page, popup);
      let checked = 0;
      await target.execute(navParams, async (evidence) => {
        checked++;
        assert.match(evidence.text, /Popup complete/);
        return "next";
      });
      assert.equal(checked, 1);
      assert.equal(decisions.requests.length, 0);
      assert.equal(
        await original.evaluate(() => (window as any).clicked),
        undefined,
      );

      await popup.close();
      assert.equal(target.page, original);
      await target.execute(navParams, async (evidence) => {
        assert.match(evidence.text, /Original page/);
        return "home";
      });
      assert.equal(
        await original.evaluate(() => (window as any).clicked),
        true,
      );
      await target.reset(url);
      assert.ok(original.isClosed());
      assert.notEqual(target.page, original);
      assert.equal(target.context!.pages().length, 1);
      assert.equal((target as any).pendingRequests.size, 0);
      const current = target.page!;
      await target.observe();
      decisions.setOverride(async () => {
        const ready = current.waitForEvent("popup");
        await current.evaluate(() => window.open("/popup"));
        await (await ready).waitForLoadState("domcontentloaded");
      });
      await assert.rejects(
        target.execute(
          {
            ...navParams,
            edge: {
              ...navParams.edge,
              properties: { business: { intent: "Continue after reset" } },
            },
          },
          async () => null,
        ),
        /active test page changed/,
      );
      assert.equal(
        await current.evaluate(() => (window as any).clicked),
        undefined,
        "Opening a popup during a pending decision invalidates the original action",
      );
    } finally {
      await target.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
    assert.equal(target.page, undefined);
  },
);

test(
  "An observed popup during field entry prevents submitting the original form",
  chrome,
  async () => {
    const server = createServer((request, response) => {
      response.setHeader("content-type", "text/html");
      if (request.url === "/popup") {
        response.end("<h1>Popup active</h1>");
        return;
      }
      response.end(`<form><label>First<input id="first"></label>
      <label>Second<input id="second" value="untouched"></label><button>Save</button></form>
      <script>window.submissions=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submissions++};
      const triggeringField=new URL(location.href).searchParams.get('trigger');
      document.getElementById(triggeringField).oninput=()=>{if(!window.opened){window.opened=true;window.open('/popup')}};</script>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const decisions = decisionClient();
    const target = new BrowserTarget(decisions.core);
    try {
      await target.start();
      const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/`;
      for (const trigger of ["first", "second"]) {
        await target.reset(`${url}?trigger=${trigger}`);
        const original = target.page!;
        await target.observe();
        const popupReady = original.waitForEvent("popup");
        await assert.rejects(
          target.execute(
            formParams(
              { First: {}, Second: {} },
              { First: "Alex", Second: "Taylor" },
            ),
            async () => null,
          ),
          /active test page changed/,
        );
        const popup = await popupReady;
        assert.equal(target.page, popup);
        assert.equal(await original.locator("#first").inputValue(), "Alex");
        // Playwright reports a popup after its initial response starts loading.
        // Fields entered before that notification may already have changed;
        // once the page switch is observed, the original form must not submit.
        assert.ok(
          ["untouched", "Taylor"].includes(
            await original.locator("#second").inputValue(),
          ),
        );
        assert.equal(
          await original.evaluate(() => (window as any).submissions),
          0,
        );
      }
      assert.equal(
        decisions.requests.length,
        2,
        "Each case binds once without a mutation retry",
      );
    } finally {
      await target.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);

test(
  "Observation waits for a delayed form request and captures one coherent state",
  chrome,
  async () => {
    const server = createServer((request, response) => {
      if (request.url === "/save") {
        setTimeout(() => response.end("saved"), 250);
        return;
      }
      response.setHeader("content-type", "text/html");
      response.end(`<title>Entry</title><h1>Entry</h1><form><label>Name<input></label><button>Save</button></form>
      <script>document.querySelector('form').onsubmit=async e=>{e.preventDefault();await(await fetch('/save')).text();
      history.pushState(null,'','#saved');document.title='Saved';document.body.innerHTML='<h1>Saved</h1><div role="status">Profile saved</div>';};</script>`);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const target = new BrowserTarget(decisionClient().core);
    try {
      await target.start();
      await target.reset(
        `http://127.0.0.1:${(server.address() as { port: number }).port}/`,
      );
      await target.observe();
      await target.execute(
        formParams({ Name: {} }, { Name: "Alex" }),
        async () => null,
      );
      const snapshot = await target.observe();
      assert.equal(snapshot.title, "Saved");
      assert.ok(snapshot.url.endsWith("#saved"));
      assert.deepEqual(snapshot.semantics.status, ["Profile saved"]);
      assert.match(snapshot.accessibility_tree, /Saved/);
      assert.equal((target as any).pendingRequests.size, 0);
    } finally {
      await target.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  },
);
