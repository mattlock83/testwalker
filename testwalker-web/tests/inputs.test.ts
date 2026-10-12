import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { planInput } from "../src/inputs.js";
import { loadBrowserSettings } from "../src/config.js";
import type { Control } from "../src/controls.js";

const control = (
  operations: string[],
  extra: Partial<Control> = {},
): Control => ({
  id: "test",
  frame: 0,
  tag: "input",
  type: "text",
  role: "textbox",
  label: "Test input",
  value: "",
  href: null,
  in_navigation: false,
  form: null,
  context: "",
  operations,
  readOnly: false,
  disabled: false,
  ...extra,
});

test("Slider plans reject out-of-range, non-finite and off-step literals before editing", async () => {
  const range = control(["RANGE"], {
    type: "range",
    minimum: 0,
    maximum: 100,
    step: 5,
  });
  for (const value of [-1, 101, 52, NaN, Infinity, "", true])
    await assert.rejects(planInput(range, value, {}), /range or step/);
  for (const value of [0, 5, 75, 100])
    assert.equal(((await planInput(range, value, {})) as any).value, value);
  assert.equal(
    (
      (await planInput(
        control(["RANGE"], { step: 0.5, minimum: 1, maximum: 3 }),
        1.5,
        {},
      )) as any
    ).value,
    1.5,
  );
});

test("Native dates must be real ISO calendar dates; range violations remain enterable for application validation", async () => {
  const date = control(["FILL"], { type: "date" });
  for (const value of [
    "2030-02-30",
    "0000-01-01",
    "2030-13-01",
    "June 15 2030",
    "15/06/2030",
  ])
    await assert.rejects(planInput(date, value, {}), /real calendar dates/);
  for (const value of ["", "2030-06-15", "2030-07-01", "2028-02-29"])
    assert.equal(((await planInput(date, value, {})) as any).value, value);
});

test("Colour and checkbox plans preserve typed inputs and reject unsupported values", async () => {
  assert.deepEqual(await planInput(control(["COLOR"]), "#ABCDEF", {}), {
    operation: "COLOR",
    value: "#abcdef",
  });
  for (const value of ["red", "#123", "#12345678", "#nothex"])
    await assert.rejects(planInput(control(["COLOR"]), value, {}), /#RRGGBB/);
  await assert.rejects(
    planInput(control(["CHECK"]), "true", {}),
    /must be boolean/,
  );
  await assert.rejects(
    planInput(control(["FILL"], { readOnly: true }), "text", {}),
    /not editable/,
  );
});

test("Upload configuration resolves fixture paths beside its config and rejects unknown, missing and multiple files", async () => {
  const folder = await mkdtemp(join(tmpdir(), "testwalker-upload-"));
  try {
    await writeFile(join(folder, "note.txt"), "Synthetic note");
    const path = join(folder, "browser.json");
    await writeFile(
      path,
      JSON.stringify({
        uploads: {
          note: ["note.txt"],
          pair: ["note.txt", "note.txt"],
          missing: ["absent.txt"],
          directory: ["."],
        },
      }),
    );
    assert.equal(
      (
        (await planInput(
          control(["RANGE"], {
            type: "range",
            minimum: 0,
            maximum: 100,
            step: 5,
            stepBase: 51,
          }),
          56,
          {},
        )) as any
      ).value,
      56,
    );
    const settings = await loadBrowserSettings(path);
    const upload = control(["UPLOAD"], { type: "file", multiple: false });
    assert.deepEqual(await planInput(upload, "note", settings), {
      operation: "UPLOAD",
      paths: [join(folder, "note.txt")],
      names: ["note.txt"],
    });
    assert.deepEqual(await planInput(upload, "", settings), {
      operation: "UPLOAD",
      paths: [],
      names: [],
    });
    for (const value of ["toString", "constructor", "unknown", "/etc/passwd"])
      await assert.rejects(
        planInput(upload, value, settings),
        /Unknown upload fixture/,
      );
    await assert.rejects(planInput(upload, "pair", settings), /only one file/);
    await assert.rejects(planInput(upload, "missing", settings), /unavailable/);
    await assert.rejects(
      planInput(upload, "directory", settings),
      /regular files/,
    );
    for (const uploads of [
      [],
      "file.txt",
      { note: "file.txt" },
      { note: [] },
      { " ": ["file.txt"] },
    ]) {
      await writeFile(path, JSON.stringify({ uploads }));
      await assert.rejects(loadBrowserSettings(path), /upload/i);
    }
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
