import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { CoreClient, serve } from "@testwalker/web";

test(
  "Real form accepts/rejects Hegel boundary inputs, escapes HTML and offers two navigation options",
  { skip: !process.env.TESTWALKER_BROWSER_TESTS },
  async () => {
    const core = new CoreClient(),
      server = await serve(fileURLToPath(new URL("../site", import.meta.url)));
    const browser = await chromium.launch({ channel: "chrome" });
    try {
      const model = JSON.parse(
        await readFile(new URL("../model.json", import.meta.url), "utf8"),
      );
      const fields = model.models[0].properties.business["data sets"].Greeting;
      const samples = await core.request("property.samples", {
        fields: { Name: fields.Name },
      });
      const page = await browser.newPage();
      await page.goto(server.url);
      assert.equal(
        await page.getByRole("navigation").getByRole("link").count(),
        2,
      );
      for (const value of [
        ...samples.map((sample: any) => sample[1]),
        "  Alex  ",
        "😀😀",
        "<script>alert(1)</script>",
      ]) {
        await page.getByRole("link", { name: "Greeting", exact: true }).click();
        await page.getByLabel("Name", { exact: true }).fill(String(value));
        await page
          .getByRole("button", { name: "Say hello", exact: true })
          .click();
        const violations = (
          await core.request("property.validate", {
            fields,
            input: { Name: value },
          })
        ).violations;
        if (violations.length) await page.getByRole("alert").waitFor();
        else
          assert.equal(
            await page.getByRole("status").textContent(),
            `Hello, ${String(value).trim()}!`,
          );
        assert.equal(await page.locator("main script").count(), 0);
      }
    } finally {
      await browser.close();
      await server.close();
      await core.close();
    }
  },
);
