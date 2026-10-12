import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/discovery.js";
import { SNAPSHOT } from "../src/discovery-snapshot.js";
import { chromium } from "playwright";

test("Same-heading variants describe observed read-only selections and open options without depending on entered values", () => {
  const pages = Object.fromEntries(
    ["North hub", "South hub"].flatMap((location, locationIndex) =>
      [false, true].map((open) => [
        `${locationIndex}-${open}`,
        {
          url: `https://example.test/#delivery-${locationIndex}`,
          page_label: "Choose delivery",
          headings: ["Choose delivery"],
          text: `Choose delivery\nSelected location: ${location}`,
          alerts: [],
          forms: [
            {
              label: "Contact",
              fields: [
                {
                  label: "Name",
                  type: "text",
                  visible: true,
                  value: "intentionally invalid secret",
                },
              ],
            },
          ],
          buttons: [
            { label: "Change location", role: null, visible: true },
            ...(open
              ? [
                  { label: "North hub", role: "option", visible: true },
                  { label: "South hub", role: "option", visible: true },
                ]
              : []),
          ],
        },
      ]),
    ),
  );
  const model = buildModel(pages, [], []).models[0];
  const descriptions = model.vertices.map(
    (vertex) => vertex.properties.business.description,
  );
  assert.equal(new Set(descriptions).size, 4);
  assert.ok(descriptions[0].includes("Selected location: North hub"));
  assert.ok(descriptions[0].includes("No selection-list options"));
  assert.ok(descriptions[1].includes("selection list is currently open"));
  assert.ok(descriptions[2].includes("Selected location: South hub"));
  assert.ok(
    descriptions.every((description) => !description.includes("secret")),
  );
});

test("Definition-list values and validation feedback disambiguate observed states on other sites", () => {
  const base = {
    url: "https://example.test/status",
    headings: ["Request status"],
    forms: [],
    buttons: [],
    text: "Request status",
  };
  const pages = {
    queued: {
      ...base,
      displayed_values: [{ label: "Stage", value: "Queued" }],
      alerts: [],
    },
    review: {
      ...base,
      displayed_values: [{ label: "Stage", value: "In review" }],
      alerts: [],
    },
    invalid: {
      ...base,
      displayed_values: [{ label: "Stage", value: "In review" }],
      alerts: ["Missing consent"],
    },
  };
  const model = buildModel(pages, [], []).models[0];
  const descriptions = model.vertices.map(
    (vertex) => vertex.properties.business.description,
  );
  assert.equal(new Set(descriptions).size, 3);
  assert.ok(descriptions[0].includes("Stage: Queued"));
  assert.ok(descriptions[2].includes("Missing consent"));
});

test(
  "Browser capture reads displayed definition values without treating editable examples as state facts",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<h1>Request status</h1><dl><dt>Stage</dt><dd>Queued</dd></dl><form><label>Name<input value="private editable example"></label></form>',
      );
      const snapshot = await page.evaluate<{
        displayed_values: Array<{ label: string; value: string }>;
      }>(`(${SNAPSHOT})()`);
      assert.deepEqual(snapshot.displayed_values, [
        { label: "Stage", value: "Queued" },
      ]);
      assert.ok(
        !JSON.stringify(snapshot.displayed_values).includes(
          "private editable example",
        ),
      );
    } finally {
      await browser.close();
    }
  },
);
