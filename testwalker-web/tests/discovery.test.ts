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
      '<html><h1>Entry</h1><a href="/next.html">Next</a><a href="https://example.invalid/">Outside</a><form><label>Name<input name="Name" minlength="2"></label><button>Submit</button></form><script>fetch("/data.json").then(r=>r.json()); document.querySelector("form").onsubmit = e => {e.preventDefault(); document.body.insertAdjacentHTML("beforeend", "<p role=status>Accepted</p>");};</script></html>',
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
      });
      assert.equal(Object.keys(listed.inventory.pages).length, 1);
      assert.equal(listed.inventory.transitions.length, 0);
    } finally {
      await server.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
);
