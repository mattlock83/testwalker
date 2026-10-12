import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { BrowserTarget } from "../src/browser.js";
import { captureControls, StaleSnapshot } from "../src/controls.js";
import { Inconclusive, type Json, type Rpc } from "../src/types.js";

const chrome = { skip: !process.env.TESTWALKER_BROWSER_TESTS };
function provider(mode = "EDIT", confidence = 1): Rpc {
  return {
    async request(method, params = {}) {
      if (method === "decision.answer") {
        const answer = params.result.answers[params.name];
        if (
          !answer ||
          answer.confidence < params.threshold ||
          !Object.hasOwn(params.choices, answer.choice)
        )
          throw new Inconclusive("Invalid or uncertain operation");
        return answer.choice;
      }
      assert.equal(method, "decision.ask");
      return {
        answers: Object.fromEntries(
          Object.entries(params.questions).map(([name, q]: [string, any]) => {
            const choice =
              name === "input_action"
                ? mode
                : Object.entries(q.criteria).find(
                    ([, control]: [string, any]) =>
                      control.label === q.instructions.business_field,
                  )?.[0];
            assert.ok(choice);
            return [name, { choice, confidence }];
          }),
        ),
      };
    },
  };
}
const params = (input: Json): Json => ({
  edge: {
    sourceVertexId: "entry",
    targetVertexId: "edited",
    properties: {
      business: {
        intent: "Set the supplied controls without submitting a form.",
      },
    },
  },
  fields: Object.fromEntries(
    Object.keys(input).map((name) => [
      name,
      { description: name, "trim spaces": false },
    ]),
  ),
  input,
});

test(
  "Literal edit actions preserve text areas and continuous sliders without submitting, even with a one-action allowance",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    const target = new BrowserTarget(provider(), {}, false, {
      actions_per_journey: 1,
    });
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent(
        '<form><label>Notes<textarea>Original</textarea></label><label>Precision<input type="range" step="any" value="50"></label><button>Submit</button></form><script>window.submits=0;window.changes=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();window.submits++};document.addEventListener("change",()=>window.changes++);</script>',
      );
      await target.execute(
        params({ Notes: "  Synthetic\nnotes  " }),
        async () => null,
      );
      assert.equal(
        await page.getByLabel("Notes").inputValue(),
        "  Synthetic\nnotes  ",
      );
      await target.observe();
      await target.execute(params({ Precision: 50.125 }), async () => null);
      assert.equal(await page.getByLabel("Precision").inputValue(), "50.125");
      assert.equal(await page.evaluate(() => (window as any).submits), 0);
      assert.equal(await page.evaluate(() => (window as any).changes), 1);
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Invalid slider, colour, date and fixture plans leave every preceding field untouched",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      for (const input of [
        { Name: "changed", Volume: 52 },
        { Name: "changed", Colour: "red" },
        { Name: "changed", Date: "2030-02-30" },
        { Name: "changed", Attachment: "unconfigured" },
      ]) {
        const target = new BrowserTarget(provider());
        const page = (target.page = await browser.newPage());
        try {
          await page.setContent(
            '<form><label>Name<input value="Original"></label><label>Volume<input type="range" min="0" max="100" step="5" value="50"></label><label>Colour<input type="color" value="#225577"></label><label>Date<input type="date"></label><label>Attachment<input type="file"></label><button>Submit</button></form>',
          );
          await assert.rejects(
            target.execute(params(input), async () => null),
            Inconclusive,
          );
          assert.equal(
            await page.getByLabel("Name", { exact: true }).inputValue(),
            "Original",
          );
        } finally {
          await target.close();
          await page.close();
        }
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  "Uncertain editing/submission intent cannot mutate fields or submit",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" }),
      target = new BrowserTarget(provider("EDIT", 0.7));
    try {
      const page = (target.page = await browser.newPage());
      await page.setContent('<label>Name<input value="Original"></label>');
      await assert.rejects(
        target.execute(params({ Name: "changed" }), async () => null),
        /uncertain operation/,
      );
      assert.equal(await page.getByLabel("Name").inputValue(), "Original");
    } finally {
      await target.close();
      await browser.close();
    }
  },
);

test(
  "Widget evidence includes hidden labelled uploads and readonly state; own file/value changes permit verification but invalidate fresh decisions",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<label>Attachment<input type="file" hidden multiple accept=".txt"></label><input type="file" hidden aria-label="Opaque upload"><label>Readonly<input type="checkbox" aria-readonly="true" checked></label><label>Volume<input type="range" min="-5" max="15" step="2" value="5"></label><div role="list" aria-label="Backlog"><div role="listitem" draggable="true" aria-label="Task">Task</div></div><div role="list" aria-label="Ready">Ready</div><table aria-label="Files"><tr><th>File name</th><th>Size (bytes)</th></tr><tr><td>note.txt<span hidden>Hidden value</span></td><td>14</td></tr><tr><td><textarea>Editable value is not outcome evidence</textarea></td><td>Control</td></tr></table>',
      );
      const snapshot = await captureControls(page);
      try {
        assert.deepEqual(snapshot.page.semantics.tables[0].headers, [
          ["File name", "Size (bytes)"],
        ]);
        assert.deepEqual(snapshot.page.semantics.tables[0].rows, [
          ["note.txt", "14"],
          ["", "Control"],
        ]);
        assert.deepEqual(
          snapshot.controls.find((control) => control.label === "Backlog")!
            .members,
          ["Task"],
        );
        const upload = snapshot.controls.find(
          (control) => control.label === "Attachment",
        )!;
        assert.deepEqual(upload.operations, ["UPLOAD"]);
        assert.equal(upload.multiple, true);
        assert.equal(
          snapshot.controls.some(
            (control) => control.label === "Opaque upload",
          ),
          false,
        );
        assert.equal(
          snapshot.page.semantics.widgets.find(
            (control: Json) => control.label === "Readonly",
          ).readOnly,
          true,
        );
        assert.deepEqual(
          snapshot.controls.find((control) => control.label === "Task")!
            .operations,
          ["DRAG"],
        );
        assert.ok(
          snapshot.controls
            .find((control) => control.label === "Ready")!
            .operations.includes("DROP"),
        );
        const handle = await snapshot.resolve(upload.id);
        await handle.setInputFiles({
          name: "note.txt",
          mimeType: "text/plain",
          buffer: Buffer.from("Synthetic note"),
        });
        await handle.dispose();
        const retained = await snapshot.resolve(upload.id);
        assert.equal(
          await retained.evaluate(
            (input: HTMLInputElement) => input.files?.[0].name,
          ),
          "note.txt",
        );
        await retained.dispose();
        await assert.rejects(snapshot.assertFresh(), StaleSnapshot);
      } finally {
        await snapshot.dispose();
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  "Disabled widgets remain assertion evidence without becoming executable controls",
  chrome,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<label><input type="checkbox" disabled>Newsletter</label><div aria-disabled="true"><div role="switch" aria-label="Alerts" aria-checked="false">Alerts</div></div><label><input type="checkbox" aria-readonly="true" checked>Consent</label>',
      );
      const snapshot = await captureControls(page);
      try {
        for (const label of ["Newsletter", "Alerts"]) {
          assert.equal(
            snapshot.controls.some((control) => control.label === label),
            false,
          );
          const widget = snapshot.page.semantics.widgets.find(
            (control: Json) => control.label === label,
          );
          assert.equal(widget.disabled, true);
          assert.deepEqual(widget.operations, []);
        }
        const consent = snapshot.page.semantics.widgets.find(
          (control: Json) => control.label === "Consent",
        );
        assert.equal(consent.readOnly, true);
        assert.equal(consent.value, true);
        assert.deepEqual(consent.operations, []);
      } finally {
        await snapshot.dispose();
      }
    } finally {
      await browser.close();
    }
  },
);
