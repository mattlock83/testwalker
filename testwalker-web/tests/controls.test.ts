import { test } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { captureControls, StaleSnapshot } from "../src/controls.js";

const browserTest = { skip: !process.env.TESTWALKER_BROWSER_TESTS };

test(
  "Visible custom options are recorded separately from closed lists and native select choices",
  browserTest,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<select><option>Native choice</option></select>
        <div role="listbox"><button role="option">North hub</button><button role="option" disabled>Unavailable hub</button></div>
      <div role="listbox" hidden><button role="option">South hub</button></div>`);
      const snapshot = await captureControls(page);
      try {
        assert.deepEqual(snapshot.page.semantics.visible_options, [
          { label: "North hub" },
          { label: "Unavailable hub" },
        ]);
        assert.equal(
          snapshot.controls.some(
            (control) => control.label === "Unavailable hub",
          ),
          false,
        );
      } finally {
        await snapshot.dispose();
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  "Controls retain duplicate links, accessible names, native operations and form associations",
  browserTest,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`
      <nav><a href="https://example.com/visit">Visit</a></nav>
      <main><a href="https://example.com/visit" target="_blank" download="visit.pdf">Visit</a>
      <form id="booking"><fieldset><legend>Plan a visit</legend>
      <label for="name">Legal name</label><input id="name" aria-labelledby="preferred-name">
      <span id="preferred-name">Preferred name</span>
      <label><input type="checkbox" name="terms">Accept terms</label>
      <label>Adventure<select><option value="ridge">Ridge walk</option>
      <optgroup disabled label="Unavailable"><option value="river">River paddle</option></optgroup></select></label>
      <button>Review</button></fieldset></form>
      <label for="external">Email</label><input id="external" form="booking">
      <div contenteditable="true" aria-label="Notes"><span>Editable notes</span></div>
      <input aria-label="Read only" readonly value="Fixed">
      <input aria-label="Hidden" hidden><input type="hidden" value="secret">
      <button disabled>Disabled</button><fieldset disabled><input aria-label="Disabled by fieldset"></fieldset>
      <div aria-disabled="true"><button>Disabled ancestor</button></div>
      <button style="opacity:0">Invisible</button>
      <input aria-label="Offscreen" style="position:absolute;top:3000px">
      </main>`);
      const snapshot = await captureControls(page);
      try {
        const links = snapshot.controls.filter(
          (control) => control.role === "link",
        );
        assert.equal(links.length, 2);
        assert.notEqual(links[0].id, links[1].id);
        assert.deepEqual(
          links.map(({ target, download }) => ({ target, download })),
          [
            { target: "", download: null },
            { target: "_blank", download: "visit.pdf" },
          ],
        );
        assert.deepEqual(
          links.map((control) => control.in_navigation),
          [true, false],
        );
        assert.equal(
          await (
            await snapshot.resolve(links[0].id)
          ).evaluate((element) => Boolean((element as Element).closest("nav"))),
          true,
        );
        const name = snapshot.controls.find(
          (control) => control.label === "Preferred name",
        )!;
        const email = snapshot.controls.find(
          (control) => control.label === "Email",
        )!;
        const review = snapshot.controls.find(
          (control) => control.label === "Review",
        )!;
        assert.ok(name.form);
        assert.equal(name.form, email.form);
        assert.equal(name.form, review.form);
        assert.equal(name.context, "Plan a visit");
        assert.deepEqual(name.operations, ["FILL"]);
        assert.deepEqual(
          snapshot.controls.find((control) => control.type === "checkbox")
            ?.operations,
          ["CHECK"],
        );
        const select = snapshot.controls.find(
          (control) => control.tag === "select",
        )!;
        assert.equal(select.label, "Adventure");
        assert.deepEqual(select.operations, ["SELECT"]);
        assert.deepEqual(select.options, [
          { value: "ridge", label: "Ridge walk", disabled: false },
          { value: "river", label: "River paddle", disabled: true },
        ]);
        assert.deepEqual(
          snapshot.controls.find((control) => control.label === "Notes")
            ?.operations,
          ["FILL"],
        );
        assert.equal(
          snapshot.controls.filter(
            (control) => control.value === "Editable notes",
          ).length,
          1,
        );
        assert.equal(
          snapshot.controls.find((control) => control.label === "Read only")
            ?.readOnly,
          true,
        );
        assert.ok(
          snapshot.controls.some((control) => control.label === "Offscreen"),
        );
        assert.ok(
          !snapshot.controls.some((control) =>
            /Hidden|Disabled|Invisible/.test(control.label),
          ),
        );
        await assert.rejects(snapshot.resolve("#external"), /not observed/);
        await assert.rejects(
          snapshot.resolve("snapshot999-f0-c0"),
          /not observed/,
        );
        await snapshot.assertFresh();
        await page.locator("#name").evaluate((element) => {
          (element as HTMLElement).style.transform = "translateX(10px)";
        });
        await snapshot.assertFresh();
        const same = await captureControls(page);
        try {
          assert.equal(same.fingerprint, snapshot.fingerprint);
          assert.notEqual(same.controls[0].id, snapshot.controls[0].id);
        } finally {
          await same.dispose();
        }
      } finally {
        await snapshot.dispose();
      }
    } finally {
      await browser.close();
    }
  },
);

test(
  "Control snapshots include open shadow roots and cross-origin frames with current validation evidence",
  browserTest,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(`<h1>Contact</h1><div id="shadow"></div>
      <label for="subject">Subject</label><input id="subject" aria-invalid="true" aria-describedby="help error" aria-errormessage="specific">
      <p id="help">Ordinary instructions are not rejection.</p>
      <div role="alert"><p id="error">Subject must contain four characters.</p></div>
      <p id="specific">Enter a longer subject.</p><div role="status">Ready</div>
      <dl><dt>Accessibility notes</dt><dd>Step-free path requested.</dd>
      <dt>Travel preference</dt><dd>Shared picnic</dd></dl>
      <iframe sandbox="allow-scripts" srcdoc="<label>Frame field<input></label><button>Frame submit</button>"></iframe>
      <iframe style="display:none" srcdoc="<input aria-label='Hidden frame field'>"></iframe>`);
      await page.evaluate(() => {
        document
          .querySelector("#shadow")!
          .attachShadow({ mode: "open" }).innerHTML =
          '<span id="shadow-label">Shadow field</span><input aria-labelledby="shadow-label"><button>Shadow submit</button>';
      });
      await page.frameLocator("iframe").first().locator("input").waitFor();
      const snapshot = await captureControls(page);
      try {
        const shadow = snapshot.controls.find(
          (control) => control.label === "Shadow field",
        )!;
        const framed = snapshot.controls.find(
          (control) => control.label === "Frame field",
        )!;
        assert.ok(shadow);
        assert.ok(framed);
        assert.notEqual(framed.frame, shadow.frame);
        assert.ok(
          !snapshot.controls.some(
            (control) => control.label === "Hidden frame field",
          ),
        );
        const invalid = snapshot.page.semantics.invalid_fields[0];
        assert.equal(invalid.label, "Subject");
        assert.match(invalid.explanation, /Ordinary instructions/);
        assert.deepEqual(invalid.validation_messages, [
          "Enter a longer subject.",
          "Subject must contain four characters.",
        ]);
        assert.deepEqual(snapshot.page.semantics.alerts, [
          "Subject must contain four characters.",
        ]);
        assert.deepEqual(snapshot.page.semantics.status, ["Ready"]);
        assert.match(snapshot.page.text, /Frame submit/);
        assert.match(snapshot.page.text, /Shadow submit/);
        assert.match(
          snapshot.page.accessibility_tree,
          /- term: Accessibility notes\s+- definition: Step-free path requested\./,
        );
        assert.match(
          snapshot.page.accessibility_tree,
          /- term: Travel preference\s+- definition: Shared picnic/,
        );
        assert.match(
          snapshot.page.accessibility_tree,
          /textbox "Shadow field"/,
        );
        assert.match(snapshot.page.accessibility_tree, /textbox "Frame field"/);
        assert.doesNotMatch(
          snapshot.page.accessibility_tree,
          /Hidden frame field/,
        );
        await snapshot.assertFresh();
        await (await snapshot.resolve(shadow.id)).fill("shadow input");
        const subject = snapshot.controls.find(
          (control) => control.label === "Subject",
        )!;
        await page.locator("#subject").evaluate((element) => {
          element.removeAttribute("aria-invalid");
          element.removeAttribute("aria-describedby");
          element.removeAttribute("aria-errormessage");
        });
        await (
          await snapshot.resolve(subject.id)
        ).fill("Still the same form control");
        await (await snapshot.resolve(framed.id)).fill("frame input");
        assert.equal(
          await page.locator("#shadow input").inputValue(),
          "shadow input",
        );
        assert.equal(
          await page
            .frameLocator("iframe")
            .first()
            .locator("input")
            .inputValue(),
          "frame input",
        );
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
  "Snapshots reject changed context, replaced nodes and detached or disabled controls without selecting replacements",
  browserTest,
  async () => {
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const page = await browser.newPage();
      await page.setContent(
        '<h1>Original</h1><label>Name<input id="name"></label><button id="save">Save</button>',
      );
      const first = await captureControls(page);
      try {
        await page
          .locator("h1")
          .evaluate((element) => (element.textContent = "Changed context"));
        await assert.rejects(first.assertFresh(), StaleSnapshot);
      } finally {
        await first.dispose();
      }
      const second = await captureControls(page);
      const name = second.controls.find((control) => control.label === "Name")!;
      try {
        await page
          .locator("#name")
          .evaluate((element) => element.replaceWith(element.cloneNode(true)));
        await assert.rejects(second.assertFresh(), StaleSnapshot);
        await assert.rejects(second.resolve(name.id), StaleSnapshot);
      } finally {
        await second.dispose();
      }
      const third = await captureControls(page);
      const save = third.controls.find((control) => control.label === "Save")!;
      try {
        await page
          .locator("#save")
          .evaluate(
            (element) => ((element as HTMLButtonElement).disabled = true),
          );
        await assert.rejects(third.resolve(save.id), StaleSnapshot);
      } finally {
        await third.dispose();
      }
      await assert.rejects(third.resolve(save.id), StaleSnapshot);
      const fourth = await captureControls(page);
      try {
        await page
          .locator("#name")
          .evaluate((element) =>
            element.setAttribute("name", "different_business_field"),
          );
        await assert.rejects(
          fourth.resolve(fourth.controls[0].id),
          StaleSnapshot,
        );
      } finally {
        await fourth.dispose();
      }
    } finally {
      await browser.close();
    }
  },
);
