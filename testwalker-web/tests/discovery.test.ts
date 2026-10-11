import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "../src/server.js";
import {
  discoverUrl,
  discoverSitemap,
  sitemapUrls,
  buildModel,
  suggestedDataSets,
} from "../src/discovery.js";
import { stateFamily, stateIdentity } from "../src/discovery-state.js";
import { jsonBody } from "../src/discovery-evidence.js";

test("Discovery rejects a quiet window that cannot fit within its timeout", async () => {
  await assert.rejects(
    discoverUrl("https://example.test", {
      output: "unused.json",
      settleMs: 300,
      timeoutMs: 200,
    }),
    /settleMs must be less/,
  );
});

test("Sorting retains distinct selections while reordered links share an expansion family", () => {
  const page = {
    url: "https://example.test/products",
    title: "Shop",
    page_label: "Products",
    headings: [],
    alerts: [],
    buttons: [],
    forms: [],
    links: [
      { label: "Alpha", url: "https://example.test/a", actionable: true },
      { label: "Beta", url: "https://example.test/b", actionable: true },
    ],
    selects: [
      {
        label: "Order",
        values: ["az"],
        options: [{ value: "az" }, { value: "za" }],
        disabled: false,
        actionable: true,
      },
    ],
  };
  const sorted = {
    ...page,
    links: [...page.links].reverse(),
    selects: [{ ...page.selects[0], values: ["za"] }],
  };
  assert.notEqual(stateIdentity(page), stateIdentity(sorted));
  assert.equal(stateFamily(page), stateFamily(sorted));
  const scrolled = {
    ...page,
    links: page.links.map((link) => ({ ...link, actionable: false })),
    selects: page.selects.map((select) => ({ ...select, actionable: false })),
  };
  assert.equal(
    stateIdentity(page),
    stateIdentity(scrolled),
    "Viewport exposure must not change logical state",
  );
});

test("Namespaced sitemap URLs are deduplicated; indexes, entities and malformed entries are rejected", () => {
  assert.deepEqual(
    sitemapUrls(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.test/a?a=1&amp;b=2</loc></url><url><loc>https://example.test/a?a=1&amp;b=2</loc></url></urlset>',
    ),
    ["https://example.test/a?a=1&b=2"],
  );
  for (const value of [
    '<!DOCTYPE a [<!ENTITY b "x">]><urlset/>',
    "<sitemapindex/>",
    "<urlset><url><loc>x</loc><loc>y</loc></url></urlset>",
  ])
    assert.throws(() => sitemapUrls(value));
});
test("Draft graphs contain prose and observed journeys, with unreachable/dead-end warnings", () => {
  const review: string[] = [];
  const page = {
    url: "https://example.test/",
    title: "Entry",
    text: "",
    headings: ["Entry"],
    forms: [],
    buttons: [],
  };
  const model = buildModel(
    { entry: page, other: { ...page, headings: ["Other"] } },
    [],
    review,
  );
  assert.equal(model.models[0].vertices.length, 2);
  assert.equal(model.models[0].edges.length, 0);
  assert.ok(review.some((text) => text.includes("unreachable")));
  assert.ok(review.some((text) => text.includes("no outgoing")));
});
test("JSON capture distinguishes non-JSON, unavailable, malformed and oversize bodies", () => {
  assert.equal(jsonBody(Buffer.from("{}"), "text/html", 10).status, "not_json");
  assert.equal(jsonBody(null, "application/json", 10).status, "unavailable");
  assert.equal(
    jsonBody(Buffer.from("bad"), "application/json", 10).status,
    "invalid_json",
  );
  assert.equal(
    jsonBody(Buffer.from("{}"), "application/json", 1).status,
    "too_large",
  );
  assert.deepEqual(
    jsonBody(Buffer.from('{"ok":true}'), "application/problem+json", 20).value,
    { ok: true },
  );
});
test("Form proposals preserve hints without inventing business constraints or password examples", () => {
  const fields = [
    {
      name: "Name",
      label: "Traveller",
      type: "text",
      tag: "input",
      visible: true,
      required: false,
      hint: "2–60 characters",
      minLength: null,
      maxLength: null,
      value: "Alex",
    },
    {
      name: "Password",
      label: "Password",
      type: "password",
      tag: "input",
      visible: true,
      required: true,
      value: "do-not-publish",
    },
    {
      name: "Gift",
      label: "Gift",
      type: "number",
      tag: "input",
      visible: true,
      required: true,
      step: "0.01",
      min: "0",
      max: "50",
      value: "1.25",
    },
  ];
  const proposals = suggestedDataSets({
    entry: { forms: [{ fields }] },
    rejection: { forms: [{ fields }] },
  });
  const forms = Object.values<any>(proposals);
  assert.equal(forms.length, 1);
  assert.deepEqual(forms[0].states, ["entry", "rejection"]);
  assert.equal(forms[0].fields.Name.required, false);
  assert.equal(forms[0].fields.Name["minimum length"], undefined);
  assert.match(forms[0].fields.Name.description, /2–60/);
  assert.equal(forms[0].fields.Password.example, undefined);
  assert.equal(forms[0].fields.Gift.type, "number");
  assert.equal(forms[0].fields.Gift.maximum, 50);
});
test(
  "Crawlee discovers one layer, captures only screenshots/JSON traffic, and respects sitemap scope",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-test-"));
    const site = join(temp, "site");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(site);
    await writeFile(
      join(site, "index.html"),
      '<html><h1>Entry</h1><div aria-hidden="true"><a href="/hidden.html">Hidden link</a><button>Hidden control</button></div><div inert><a href="/hidden.html">Inert link</a></div><a href="/next.html">Next</a><a href="https://example.invalid/">Outside</a><form id="person"><label>Name<input name="Name" minlength="2"></label></form><button form="person">Submit</button><script>fetch("/data.json").then(r=>r.json()); document.querySelector("form").onsubmit = e => {e.preventDefault(); document.body.insertAdjacentHTML("beforeend", "<p role=status>Accepted</p>");};</script></html>',
    );
    await writeFile(
      join(site, "next.html"),
      '<html><h1>Next</h1><a href="/deep.html">Deeper</a></html>',
    );
    await writeFile(
      join(site, "deep.html"),
      "<html><h1>Beyond depth</h1></html>",
    );
    await writeFile(join(site, "data.json"), '{"synthetic":true}');
    const server = await serve(site);
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "url.json"),
        depth: 1,
      });
      const pages = Object.values<any>(result.inventory.pages);
      assert.ok(pages.some((page) => page.headings.includes("Next")));
      assert.ok(pages.some((page) => page.text.includes("Accepted")));
      assert.ok(!pages.some((page) => page.headings.includes("Beyond depth")));
      assert.ok(
        !pages[0].links.some((link: any) => /Hidden|Inert/.test(link.label)),
      );
      assert.ok(
        !pages[0].buttons.some(
          (button: any) => button.label === "Hidden control",
        ),
      );
      const visit = result.inventory.visits[0],
        base = join(temp, "url.discovery");
      assert.deepEqual(
        (await readdir(join(base, visit.id))).sort(),
        ["network.json", "screenshot.png"],
      );
      assert.equal(
        (await readFile(join(base, visit.artifacts["screenshot.png"])))
          .subarray(1, 4)
          .toString(),
        "PNG",
      );
      const network = JSON.parse(
        await readFile(join(base, visit.artifacts["network.json"]), "utf8"),
      );
      assert.ok(
        network.requests.some(
          (entry: any) => entry.response?.body.value?.synthetic,
        ),
        JSON.stringify(network),
      );
      assert.equal(network.requests.length, 1, "HTML navigation is omitted");
      assert.equal(network.requests[0].url, server.url + "/data.json");
      await assert.rejects(
        discoverUrl(server.url, { output: join(temp, "url.json") }),
        /exists/,
      );
      const sitemap = join(temp, "sitemap.xml");
      await writeFile(
        sitemap,
        `<urlset><url><loc>${server.url}/</loc></url></urlset>`,
      );
      const listed = await discoverSitemap(sitemap, {
        output: join(temp, "sitemap.json"),
        clickButtons: true,
        probeEmptyForms: true,
      });
      assert.equal(Object.keys(listed.inventory.pages).length, 1);
      assert.equal(listed.inventory.transitions.length, 0);
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Discovery replays JavaScript buttons, shadow options and form routes before following links",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-routes-"));
    await writeFile(
      join(temp, "index.html"),
      `<h1>Entry</h1><button onclick="start()">Begin</button><div id="content"></div>
  <script>
  const content = document.querySelector('#content');
  function start() {
    document.querySelector('h1').textContent='Details';
    content.innerHTML='<form aria-label="Person"><label>Name<input name="Name" required minlength="2"></label><button>Review</button></form>';
    content.querySelector('form').onsubmit=e=>{e.preventDefault();content.innerHTML='<h2>Review</h2><button onclick="finish()">Finish</button>';};
    const widget=document.createElement('custom-choice'); content.prepend(widget);
    const root=widget.attachShadow({mode:'open'});
    root.innerHTML='<button type="button">Open options</button><div hidden><button role="option" type="button">Choose B</button><button role="option" type="button" aria-disabled="true">Unavailable</button></div>';
    root.querySelector('button').onclick=()=>root.querySelector('div').hidden=false;
    root.querySelector('[role=option]').onclick=()=>{root.querySelector('div').hidden=true;document.querySelector('h1').textContent='Details B';};
  }
  function finish(){document.querySelector('h1').textContent='Finished';content.innerHTML='<a href="#receipt" onclick="receipt()">Receipt</a>';}
  function receipt(){document.querySelector('h1').textContent='Receipt';content.innerHTML='<p role=status>Done</p>';}
  </script>`,
    );
    const server = await serve(temp);
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "draft.json"),
        depth: 5,
        clickButtons: true,
        probeEmptyForms: true,
        settleMs: 50,
        maxActions: 300,
      });
      const pages = Object.values<any>(result.inventory.pages);
      for (const heading of ["Details B", "Finished", "Receipt"])
        assert.ok(
          pages.some((p) => p.headings.includes(heading)),
          heading,
        );
      assert.equal(
        result.inventory.failed.length,
        0,
        JSON.stringify(result.inventory.failed),
      );
      assert.ok(
        result.inventory.transitions.every((t: any) => t.visit),
        "All transitions have executed visit evidence",
      );
      assert.ok(
        result.inventory.transitions.some((t: any) =>
          t.evidence.includes("empty form probe"),
        ),
      );
      assert.ok(!JSON.stringify(result.model).includes("querySelector"));
      assert.ok(
        !result.inventory.transitions.some(
          (transition: any) => transition.intent === "Choose Unavailable.",
        ),
      );
      assert.ok(
        result.inventory.pages &&
          pages.some((p) =>
            p.forms.some((f: any) =>
              f.fields.some((v: any) => v.minLength === "2"),
            ),
          ),
      );
      const excluded = await discoverUrl(server.url, {
        output: join(temp, "excluded.json"),
        depth: 3,
        clickButtons: true,
        excludeButtons: ["Finish"],
        settleMs: 50,
      });
      assert.ok(
        !excluded.inventory.transitions.some(
          (t: any) => t.intent === "Choose Finish.",
        ),
      );
      assert.ok(
        !Object.values<any>(excluded.inventory.pages).some((p) =>
          p.headings.includes("Finished"),
        ),
      );
      const readOnly = await discoverUrl(server.url, {
        output: join(temp, "read-only.json"),
        depth: 3,
        clickButtons: true,
        submitForms: false,
        settleMs: 50,
      });
      assert.equal(readOnly.inventory.transitions.length, 0);
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Discovery explores every submit control and replays the selected control through subsequent forms",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(
      join(tmpdir(), "testwalker-discovery-submitters-"),
    );
    await writeFile(
      join(temp, "index.html"),
      `<h1>Details</h1><form id="details" aria-label="Details">
      <label>Name<input name="Name" value="Alex"></label>
      <button name="cancel">Cancel</button></form>
      <input form="details" type="submit" name="proceed" value="Continue">
      <script>document.forms[0].onsubmit=e=>{
        e.preventDefault();
        if(e.submitter.name==='cancel'){document.body.innerHTML='<h1>Cancelled</h1>';return;}
        if(!document.forms[0].elements.Name.value){
          if(!document.querySelector('[role=alert]'))document.body.insertAdjacentHTML('beforeend','<p role=alert>Name is required</p>');
          return;
        }
        document.body.innerHTML='<h1>Review</h1><form><button name="back">Back</button><button name="finish">Finish</button></form>';
        document.forms[0].onsubmit=e=>{e.preventDefault();document.body.innerHTML=e.submitter.name==='finish'?'<h1>Complete</h1>':'<h1>Returned</h1>';};
      };</script>`,
    );
    const server = await serve(temp);
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "draft.json"),
        depth: 3,
        probeEmptyForms: true,
        settleMs: 50,
      });
      assert.deepEqual(result.inventory.failed, []);
      const pages = Object.values<any>(result.inventory.pages);
      for (const heading of ["Cancelled", "Review", "Complete", "Returned"])
        assert.ok(
          pages.some((page) => page.headings.includes(heading)),
          heading,
        );
      assert.ok(pages.some((page) => page.alerts.includes("Name is required")));
      assert.ok(
        result.inventory.transitions.some((t: any) =>
          t.intent.startsWith("Submit Continue with these form details"),
        ),
      );
      assert.ok(
        result.inventory.transitions.some((t: any) =>
          t.intent.startsWith(
            "Submit Continue with all editable text fields empty",
          ),
        ),
      );
      assert.ok(
        !JSON.stringify(result.model).includes("Submit proceed"),
        "Use the visible input button caption",
      );
      const excluded = await discoverUrl(server.url, {
        output: join(temp, "excluded.json"),
        depth: 1,
        settleMs: 30,
        excludeButtons: ["Cancel"],
        screenshots: false,
        network: false,
      });
      assert.ok(
        !excluded.inventory.transitions.some((t: any) =>
          t.intent.startsWith("Submit Cancel"),
        ),
      );
      assert.ok(
        excluded.inventory.transitions.some((t: any) =>
          t.intent.startsWith("Submit Continue"),
        ),
      );
      assert.ok(
        excluded.inventory.pending.some(
          (a: any) =>
            a.intent.startsWith("Submit Cancel") &&
            a.reason === "excluded control",
        ),
      );
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Generic native forms handle fieldsets, boolean checkboxes and existing radio selections",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-native-"));
    await writeFile(
      join(temp, "index.html"),
      `<h1>Preferences</h1>
  <form><fieldset><legend>Options</legend>
  <label><input type="checkbox" name="Consent" required>Consent</label>
  <label><input type="radio" name="Channel" value="email">Email</label>
  <label><input type="radio" name="Channel" value="sms" checked>SMS</label>
  <label>Category<select name="Category"><option value="a">Alpha</option><option value="b" selected>Beta</option></select></label>
  </fieldset><button>Save</button></form>
  <script>document.querySelector('form').onsubmit=e=>{e.preventDefault();
    const values=Object.fromEntries(new FormData(e.target));
    document.body.innerHTML='<h1>Saved</h1><p>'+JSON.stringify(values)+'</p>';
  };</script>`,
    );
    const server = await serve(temp);
    const seenHeaders: unknown[] = [];
    server.server.on("request", (request) =>
      seenHeaders.push(request.headers["x-discovery-fixture"]),
    );
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "draft.json"),
        depth: 1,
        settleMs: 50,
        probeEmptyForms: true,
        browser: {
          context: {
            extraHTTPHeaders: { "x-discovery-fixture": "generic-context" },
          },
        },
      });
      assert.equal(
        result.inventory.failed.length,
        0,
        JSON.stringify(result.inventory.failed),
      );
      const outcome = Object.values<any>(result.inventory.pages).find((page) =>
        page.headings.includes("Saved"),
      );
      assert.ok(outcome);
      assert.match(outcome.text, /"Consent":"on"/);
      assert.match(outcome.text, /"Channel":"sms"/);
      assert.match(outcome.text, /"Category":"b"/);
      const values = result.inventory.transitions[0].values;
      assert.equal(values.Consent, true);
      assert.equal(values.Channel, "sms");
      assert.ok(
        seenHeaders.includes("generic-context"),
        "Browser context settings are applied",
      );
      const empty = result.inventory.transitions.find((transition: any) =>
        transition.evidence.includes("empty form probe"),
      );
      assert.equal(
        empty.values.Channel,
        "sms",
        "Empty probes preserve radio selection",
      );
      assert.equal(Object.keys(values).length, 3);
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Discovery restores observed examples when an empty form loses its prefilled choices",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(
      join(tmpdir(), "testwalker-discovery-recovery-"),
    );
    await writeFile(
      join(temp, "index.html"),
      `<h1>Choose a bundle</h1><main></main><script>
  function render(empty=false) {
    document.querySelector('main').innerHTML='<form><label>Bundle<input name="Bundle" value="'+(empty?'':'blue')+'"></label><label>Quantity<input name="Quantity" value="'+(empty?'':'2')+'"></label><button>Continue</button></form>';
    document.querySelector('form').onsubmit=e=>{e.preventDefault();
      const data=Object.fromEntries(new FormData(e.target));
      if(data.Bundle==='blue' && data.Quantity==='2') {
        location.hash='saved';document.querySelector('h1').textContent='Saved';document.querySelector('main').innerHTML='<p>Accepted</p>';
      } else {location.hash='rejected';document.querySelector('h1').textContent='Choose again';render(true);}
    };
  }
  render();</script>`,
    );
    const server = await serve(temp);
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "draft.json"),
        depth: 2,
        probeEmptyForms: true,
        settleMs: 50,
      });
      assert.equal(
        result.inventory.failed.length,
        0,
        JSON.stringify(result.inventory.failed),
      );
      assert.ok(
        result.inventory.transitions.some(
          (transition: any) =>
            result.inventory.pages[transition.source].headings.includes(
              "Choose again",
            ) &&
            result.inventory.pages[transition.target].headings.includes(
              "Saved",
            ) &&
            transition.values.Bundle === "blue" &&
            transition.values.Quantity === "2",
        ),
      );
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Discovery waits for async UI, avoids covered controls, and replays standalone selections",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-ui-"));
    await writeFile(
      join(temp, "index.html"),
      `<title>Generic shop</title>
      <span style="font-size:24px;font-weight:400">Products</span>
      <h1 id="state">Loading</h1>
      <a href="/next.html" role="button">Next</a><a href="/next.html">Next</a>
      <label>Order<select name="order"><option value="a">Ascending</option>
        <option value="d">Descending</option><optgroup disabled><option value="x">Unavailable</option></optgroup></select></label>
      <button onclick="openMenu()">Menu</button>
      <button style="position:absolute;top:1200px" onclick="document.querySelector('#state').textContent='Far action'">Offscreen action</button>
      <button style="position:absolute;left:700px;top:100px;width:200px;height:40px">Partially covered</button>
      <div style="position:absolute;left:780px;top:100px;width:40px;height:40px;z-index:2;background:red"></div>
      <button id="covered" onclick="document.querySelector('#state').textContent='Wrong action'">Underlying</button>
      <script>
      document.body.setAttribute('aria-busy','true');
      fetch("/ready.json").then(r=>r.json()).then(()=>{setTimeout(()=>{document.querySelector("#state").textContent="Ready";document.body.removeAttribute("aria-busy")},80)});
      document.querySelector('select').onchange=e=>document.querySelector('#state').textContent='Order '+e.target.value;
      function openMenu(){
        const overlay=document.createElement('div');overlay.id='overlay';
        overlay.style='position:fixed;inset:0;background:white;z-index:100';
        overlay.innerHTML='<button>Close menu</button>';
        overlay.querySelector('button').onclick=()=>overlay.remove();
        document.body.append(overlay);
      }
      </script>`,
    );
    await writeFile(join(temp, "next.html"), "<h1>Next page</h1>");
    await writeFile(join(temp, "ready.json"), "{}");
    const server = await serve(temp);
    const handlers = server.server.listeners("request");
    server.server.removeAllListeners("request");
    server.server.on("request", (request, response) => {
      const deliver = () =>
        handlers.forEach((handler) =>
          handler.call(server.server, request, response),
        );
      if (request.url === "/ready.json") setTimeout(deliver, 200);
      else deliver();
    });
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "draft.json"),
        depth: 2,
        clickButtons: true,
        settleMs: 30,
        timeoutMs: 2000,
        maxActions: 100,
        screenshots: false,
      });
      assert.deepEqual(result.inventory.failed, []);
      const pages = Object.values<any>(result.inventory.pages);
      assert.ok(!pages.some((p) => p.headings.includes("Loading")));
      assert.ok(
        pages.some((p) => p.selects.some((s: any) => s.values.includes("d"))),
      );
      assert.ok(
        result.inventory.transitions.some(
          (t: any) => t.evidence === "native selection",
        ),
      );
      assert.ok(
        result.model.models[0].vertices.some((v: any) =>
          v.properties.business.rules.includes(
            "The Order selection is Descending.",
          ),
        ),
      );
      const menuVertex = result.model.models[0].vertices.find(
        (v: any) =>
          v.id ===
          Object.entries(result.inventory.pages).find(([, p]: any) =>
            p.buttons.some((b: any) => b.label === "Close menu"),
          )?.[0],
      );
      assert.ok(
        !menuVertex.properties.business.rules.some((rule: string) =>
          rule.includes("Underlying"),
        ),
      );
      assert.ok(
        !result.inventory.transitions.some((t: any) =>
          t.intent.includes("Unavailable"),
        ),
      );
      assert.ok(
        result.inventory.blocked.some(
          (b: any) => b.label === "Underlying" && b.reason.includes("covered"),
        ),
      );
      const menu = pages.find((p) =>
        p.buttons.some((b: any) => b.label === "Close menu"),
      );
      const menuId = Object.entries(result.inventory.pages).find(
        ([, p]) => p === menu,
      )![0];
      assert.ok(
        !result.inventory.transitions.some(
          (t: any) =>
            t.source === menuId &&
            ["Choose Underlying.", "Choose Offscreen action."].includes(
              t.intent,
            ),
        ),
      );
      assert.ok(
        result.inventory.transitions.some(
          (t: any) => t.source === menuId && t.intent === "Choose Close menu.",
        ),
      );
      const entry = result.model.models[0].startElementId;
      assert.ok(
        result.inventory.actions.some(
          (a: any) =>
            a.source === entry &&
            a.intent === "Choose Partially covered." &&
            a.reason === "covered control",
        ),
      );
      assert.equal(
        result.inventory.actions.filter(
          (a: any) => a.source === entry && a.intent.includes("Next"),
        ).length,
        1,
      );
      assert.ok(
        result.inventory.pending.every(
          (p: any) => p.source && p.intent && p.reason,
        ),
      );
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Repetitive states retain observations and explicitly defer their known frontier",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(
      join(tmpdir(), "testwalker-discovery-frontier-"),
    );
    await writeFile(
      join(temp, "index.html"),
      `<title>Generic shop</title>
      <span style="font-size:24px;font-weight:400">Products</span>
      <button onclick="this.textContent='Count '+(++window.count)">Count 0</button><script>window.count=0</script>`,
    );
    const server = await serve(temp);
    try {
      const options = {
        depth: 5,
        clickButtons: true,
        settleMs: 20,
        screenshots: false,
        network: false,
      };
      const variants = await discoverUrl(server.url, {
        ...options,
        output: join(temp, "variants.json"),
        maxStateVariants: 2,
      });
      assert.equal(Object.keys(variants.inventory.pages).length, 3);
      assert.equal(variants.inventory.transitions.length, 2);
      assert.equal(variants.inventory.pending.length, 1);
      assert.equal(variants.inventory.pending[0].reason, "state variant limit");
      assert.equal(variants.inventory.pending[0].intent, "Choose Count 2.");
      assert.match(variants.model.models[0].vertices[0].name, /Products/);
      const budget = await discoverUrl(server.url, {
        ...options,
        output: join(temp, "budget.json"),
        maxStateVariants: 100,
        maxActions: 3,
      });
      assert.equal(budget.inventory.operations, 3);
      assert.equal(budget.inventory.pending.length, 1);
      assert.equal(budget.inventory.pending[0].reason, "action budget");
      assert.equal(budget.inventory.pending[0].status, "queued");
      assert.deepEqual(budget.inventory.failed, []);
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);

test(
  "Unsettled actions keep diagnostics and evidence without inventing graph transitions",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(
      join(tmpdir(), "testwalker-discovery-unsettled-"),
    );
    await writeFile(
      join(temp, "index.html"),
      "<h1>Ready</h1><button onclick=\"document.body.setAttribute('aria-busy','true')\">Wait forever</button>",
    );
    const server = await serve(temp);
    try {
      const result = await discoverUrl(server.url, {
        output: join(temp, "draft.json"),
        depth: 1,
        clickButtons: true,
        settleMs: 20,
        timeoutMs: 1500,
        network: false,
      });
      assert.equal(result.inventory.transitions.length, 0);
      assert.equal(result.inventory.failed.length, 1);
      assert.equal(result.inventory.failed[0].intent, "Choose Wait forever.");
      const failed = result.inventory.visits.find(
        (v: any) => v.id === result.inventory.failed[0].visit,
      );
      assert.match(failed.error, /did not settle/);
      assert.equal(failed.diagnostic.busy, true);
      assert.ok(failed.artifacts["screenshot.png"]);
      assert.equal(
        result.inventory.actions.find((a: any) => a.kind === "executed control")
          .status,
        "failed",
      );
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
