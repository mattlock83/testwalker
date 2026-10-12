import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import {
  BrowserTarget,
  serve,
  CoreClient,
  loadBrowserSettings,
  type Json,
  type Rpc,
} from "@testwalker/web";

test(
  "The adapter executes real controls, browser events, custom calendar/dropdown and form validation",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const server = await serve(
      fileURLToPath(new URL("../site", import.meta.url)),
    );
    const browser = await chromium.launch({ channel: "chrome" });
    const settings = await loadBrowserSettings(
      fileURLToPath(new URL("../browser.json", import.meta.url)),
    );
    const model = JSON.parse(
      await readFile(new URL("../model.json", import.meta.url), "utf8"),
    ).models[0];
    let desired: Json = {};
    const rpc: Rpc = {
      async request(method, params = {}) {
        if (method === "decision.answer") {
          const answer = params.result.answers[params.name];
          assert.ok(answer.confidence >= params.threshold);
          assert.ok(Object.hasOwn(params.choices, answer.choice));
          return answer.choice;
        }
        assert.equal(method, "decision.ask");
        return {
          answers: Object.fromEntries(
            Object.entries(params.questions).map(([name, q]: [string, any]) => {
              if (name.startsWith("action_")) {
                const score =
                  q.instructions.control.label === desired.target ? 3 : 0;
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
              let choice: string | undefined;
              if (name === "input_action")
                choice = desired.submit ? "SUBMIT" : "EDIT";
              else if (name.startsWith("field_"))
                choice = Object.entries(q.criteria).find(
                  ([, control]: [string, any]) =>
                    control.label === q.instructions.business_field,
                )?.[0];
              else if (name === "checked")
                choice = desired.checked ? "checked" : "unchecked";
              else if (name === "fixture")
                choice =
                  desired.fixture === ""
                    ? "CLEAR"
                    : Object.entries(q.criteria).find(
                        ([, fixture]: [string, any]) =>
                          fixture.alias === desired.fixture,
                      )?.[0];
              else if (name === "destination")
                choice = Object.entries(q.criteria).find(
                  ([, control]: [string, any]) =>
                    control.label === desired.drop,
                )?.[0];
              else if (name === "option")
                choice = Object.entries(q.criteria).find(
                  ([, option]: [string, any]) =>
                    option.label === desired.option,
                )?.[0];
              else if (name === "selection") choice = "READY";
              else if (name.startsWith("option_"))
                choice = desired.options?.includes(q.instructions.option.label)
                  ? "include"
                  : "exclude";
              assert.ok(choice, `No deterministic response for ${name}`);
              return [name, { choice, confidence: 1 }];
            }),
          ),
        };
      },
    };
    const page = await browser.newPage();
    const target = new BrowserTarget(rpc, settings);
    target.page = page;
    async function scenario(name: string) {
      await page.goto(`${server.url}/controls.html?scenario=${name}`);
    }
    async function execute(id: string, wanted: Json = {}) {
      desired = wanted;
      const edge = model.edges.find((edge: Json) => edge.id === `e_${id}`);
      assert.ok(edge, id);
      const input =
        edge.properties.business.example ??
        Object.fromEntries(
          Object.entries(
            model.properties.business["data sets"][
              edge.properties.business["data set"]
            ] ?? {},
          ).map(([name, field]: [string, any]) => [name, field.example]),
        );
      const fields = Object.fromEntries(
        Object.keys(input).map((name) => [
          name,
          { description: name, "trim spaces": false },
        ]),
      );
      await target.execute({ edge, fields, input }, async () => null);
      return (await target.observe()).text;
    }
    try {
      await scenario("checkbox");
      assert.match(
        await execute("check_newsletter", {
          target: "Newsletter",
          checked: true,
        }),
        /Newsletter: on/,
      );
      assert.match(
        await execute("uncheck_newsletter", {
          target: "Newsletter",
          checked: false,
        }),
        /Newsletter: off/,
      );
      assert.match(
        await execute("enable_priority", {
          target: "Priority notifications",
          checked: true,
        }),
        /Priority notifications: on/,
      );
      assert.match(
        await execute("disable_priority", {
          target: "Priority notifications",
          checked: false,
        }),
        /Priority notifications: off/,
      );
      assert.equal(
        await page.getByLabel("Disabled newsletter").isChecked(),
        false,
      );
      assert.equal(
        await page.getByLabel("Read-only consent").isChecked(),
        true,
      );
      await scenario("radio");
      await execute("choose_express", {
        target: "Express delivery",
        checked: true,
      });
      assert.equal(
        await page.getByLabel("Economy delivery").isChecked(),
        false,
      );
      await execute("choose_economy", {
        target: "Economy delivery",
        checked: true,
      });
      assert.equal(
        await page.getByLabel("Express delivery").isChecked(),
        false,
      );
      await scenario("select");
      assert.match(
        await execute("shipping_express", {
          target: "Shipping",
          option: "Express shipping",
        }),
        /Shipping: Express shipping/,
      );
      await execute("shipping_standard", {
        target: "Shipping",
        option: "Standard shipping",
      });
      assert.match(
        await execute("extras_choose", {
          target: "Extras",
          options: ["Meals", "Insurance"],
        }),
        /Extras: Meals, Insurance/,
      );
      assert.match(
        await execute("extras_clear", { target: "Extras", options: [] }),
        /Extras: none/,
      );
      await scenario("date");
      assert.match(
        await execute("date_enter"),
        /Travel date accepted: 2030-06-15/,
      );
      assert.match(
        await execute("date_out_of_range"),
        /Travel date rejected: 2030-07-01/,
      );
      assert.match(await execute("date_clear"), /No travel date selected/);
      await scenario("calendar");
      await execute("calendar_open", { target: "Choose appointment date" });
      assert.equal(
        await page.getByRole("heading", { name: "June 2030" }).isVisible(),
        true,
      );
      await execute("calendar_next", { target: "Next month" });
      await execute("calendar_pick", { target: "15 July 2030" });
      assert.equal(await page.getByRole("dialog").isVisible(), false);
      assert.match(
        (await page.getByRole("status").textContent()) ?? "",
        /15 July 2030/,
      );
      await scenario("upload");
      assert.match(
        await execute("upload_one", {
          target: "Supporting documents",
          fixture: "travel note",
        }),
        /Supporting documents: sample-note.txt/,
      );
      assert.match(
        await execute("upload_many", {
          target: "Supporting documents",
          fixture: "travel documents",
        }),
        /sample-note.txt, sample-receipt.txt/,
      );
      await execute("upload_clear", {
        target: "Supporting documents",
        fixture: "",
      });
      assert.equal(
        await page
          .getByLabel("Supporting documents", { exact: true })
          .evaluate((input: HTMLInputElement) => input.files?.length),
        0,
      );
      await scenario("slider");
      assert.match(await execute("volume_set"), /Volume: 75%/);
      await execute("volume_restore");
      assert.match(await execute("volume_minimum"), /Volume: 0%/);
      assert.match(await execute("volume_maximum"), /Volume: 100%/);
      await execute("volume_reset");
      assert.match(await execute("gain_set"), /Gain: 70%/);
      assert.match(await execute("gain_restore"), /Gain: 50%/);
      await scenario("color");
      assert.match(await execute("color_set"), /Accent colour: #336699/);
      const events = await page
        .getByRole("list", { name: "Historical browser events" })
        .textContent();
      assert.match(events ?? "", /input/);
      assert.match(events ?? "", /change/);
      await execute("color_restore");
      await scenario("drag");
      assert.match(
        await execute("drag_complete", {
          target: "Travel checklist",
          drop: "Completed work",
        }),
        /Travel checklist is in Completed work/,
      );
      assert.equal(
        await page
          .getByRole("list", { name: "Completed work", exact: true })
          .getByRole("listitem")
          .count(),
        1,
      );
      assert.match(
        await execute("drag_restore", {
          target: "Travel checklist",
          drop: "Backlog",
        }),
        /Travel checklist is in Backlog/,
      );
      await scenario("dropdown");
      await execute("dropdown_open", { target: "Choose collection slot" });
      const dropdown = await target.observe();
      assert.deepEqual(dropdown.semantics.selection_lists[0].controllers, [
        { label: "Choose collection slot", expanded: true },
      ]);
      assert.equal(
        dropdown.semantics.selection_lists[0].options[0].selected,
        true,
      );
      assert.equal(
        dropdown.semantics.selection_lists[0].options[2].disabled,
        true,
      );
      assert.equal(await page.getByRole("listbox").isVisible(), true);
      await execute("dropdown_evening", { target: "Evening collection" });
      assert.equal(await page.getByRole("listbox").isVisible(), false);
      assert.match(
        (await page.getByRole("status").textContent()) ?? "",
        /Evening collection/,
      );
      await scenario("form");
      assert.match(
        await execute("registration_submit", { submit: true }),
        /Registered Alex with alex@example.com/,
      );
      await execute("registration_clear_success", {
        target: "Clear registration",
      });
      assert.match(
        await execute("registration_reject", { submit: true }),
        /Registration rejected/,
      );
      assert.equal(await page.getByRole("alert").isVisible(), true);
      await execute("registration_clear_error", {
        target: "Clear registration",
      });
      assert.equal(await page.getByRole("alert").isVisible(), false);
    } finally {
      await target.close();
      await browser.close();
      await server.close();
    }
  },
);

test(
  "The registration form agrees with selected Hegel constraint samples",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const server = await serve(
      fileURLToPath(new URL("../site", import.meta.url)),
    );
    const browser = await chromium.launch({ channel: "chrome" }),
      core = new CoreClient();
    try {
      const fields = JSON.parse(
        await readFile(new URL("../model.json", import.meta.url), "utf8"),
      ).models[0].properties.business["data sets"].Registration;
      const page = await browser.newPage();
      for (const [field, definition] of Object.entries(fields)) {
        const samples = await core.request("property.samples", {
          fields: { [field]: definition },
        });
        for (const sample of samples) {
          const input = {
            ...Object.fromEntries(
              Object.entries(fields).map(
                ([name, definition]: [string, any]) => [
                  name,
                  definition.example,
                ],
              ),
            ),
            [field]: sample[1],
          };
          await page.goto(`${server.url}/controls.html?scenario=form`);
          for (const [name, value] of Object.entries(input))
            await page.getByLabel(name, { exact: true }).fill(String(value));
          await page
            .getByRole("button", { name: "Register", exact: true })
            .click();
          const invalid =
            (await core.request("property.validate", { fields, input }))
              .violations.length > 0;
          assert.equal(
            await page.getByRole("alert").isVisible(),
            invalid,
            JSON.stringify(input),
          );
        }
      }
    } finally {
      await browser.close();
      await server.close();
      await core.close();
    }
  },
);
