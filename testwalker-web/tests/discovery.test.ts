import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
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
import { jsonBody } from "../src/discovery-evidence.js";

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
  "Crawlee discovers one layer, captures DOM/screenshots/JSON, and respects sitemap scope",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const temp = await mkdtemp(join(tmpdir(), "testwalker-discovery-test-"));
    const site = join(temp, "site");
    const { mkdir } = await import("node:fs/promises");
    await mkdir(site);
    await writeFile(
      join(site, "index.html"),
      '<html><h1>Entry</h1><a href="/next.html">Next</a><a href="https://example.invalid/">Outside</a><form id="person"><label>Name<input name="Name" minlength="2"></label></form><button form="person">Submit</button><script>fetch("/data.json").then(r=>r.json()); document.querySelector("form").onsubmit = e => {e.preventDefault(); document.body.insertAdjacentHTML("beforeend", "<p role=status>Accepted</p>");};</script></html>',
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
      const visit = result.inventory.visits[0],
        base = join(temp, "url.discovery");
      assert.match(
        await readFile(join(base, visit.artifacts["page.html"]), "utf8"),
        /Entry/,
      );
      assert.ok(
        JSON.parse(
          await readFile(join(base, visit.artifacts["dom.json"]), "utf8"),
        ).documents.length,
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
