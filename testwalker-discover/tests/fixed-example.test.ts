import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModel } from "../src/discovery.js";

test("Observed form values become fixed examples without creating inferred property domains", () => {
  const field = (name: string, label: string, type = "text") => ({
    name,
    label,
    type,
    tag: "input",
    visible: true,
    actionable: true,
  });
  const form = {
    label: "Contact",
    fields: [
      field("first_name", "First name"),
      field("consent", "Consent", "checkbox"),
      { ...field("hidden", "Opaque field"), type: "hidden" },
    ],
  };
  const page = {
    url: "https://example.test/",
    headings: ["Contact request"],
    forms: [form],
    buttons: [],
  };
  const model = buildModel(
    {
      entry: page,
      done: {
        ...page,
        url: "https://example.test/done",
        headings: ["Request received"],
        forms: [],
      },
    },
    [
      {
        source: "entry",
        target: "done",
        intent: "Submit the request.",
        form,
        values: { first_name: " Alex ", consent: true, hidden: "opaque" },
      },
      {
        source: "entry",
        target: "entry",
        intent: "Submit empty input.",
        form,
        values: { first_name: "", consent: false, hidden: "opaque" },
      },
    ],
    [],
  ).models[0];
  assert.deepEqual(model.edges[0].properties.business.example, {
    "First name": " Alex ",
    Consent: true,
  });
  assert.deepEqual(model.edges[1].properties.business.example, {
    "First name": "",
    Consent: false,
  });
  assert.deepEqual(model.properties.business["data sets"], {});
  assert.equal(model.edges[0].properties.business["data set"], undefined);
  assert.equal(model.edges[0].properties.business["accepted at"], undefined);
});

test("Unsupported fixed inputs are reviewed rather than silently dropping part of a form", () => {
  const form = {
    fields: [
      {
        name: "choices",
        label: "Choices",
        tag: "select",
        type: "select-multiple",
        visible: true,
      },
    ],
  };
  const page = {
    url: "https://example.test/",
    headings: ["Choices"],
    forms: [form],
    buttons: [],
  };
  const review: string[] = [];
  const model = buildModel(
    { entry: page },
    [
      {
        source: "entry",
        target: "entry",
        intent: "Submit choices.",
        form,
        values: { choices: ["a", "b"] },
      },
    ],
    review,
  );
  assert.equal(model.models[0].edges[0].properties.business.example, undefined);
  assert.ok(review.some((note) => note.includes("scalar fixed example")));
});

test("Radio choices retain per-option booleans and distinct fixed scenarios keep their own journeys", () => {
  const form = {
    fields: ["Alpha", "Beta"].map((label) => ({
      name: "choice",
      label,
      value: label.toLowerCase(),
      tag: "input",
      type: "radio",
      visible: true,
    })),
  };
  const page = {
    url: "https://example.test/",
    headings: ["Choice"],
    forms: [form],
    buttons: [],
  };
  const transition = {
    source: "entry",
    target: "entry",
    intent: "Submit the selection.",
    form,
  };
  const model = buildModel(
    { entry: page },
    [
      { ...transition, values: { choice: "alpha" } },
      { ...transition, values: { choice: "beta" } },
      { ...transition, values: { choice: "beta" } },
    ],
    [],
  ).models[0];
  assert.equal(model.edges.length, 2);
  assert.notEqual(model.edges[0].id, model.edges[1].id);
  assert.deepEqual(model.edges[0].properties.business.example, {
    Alpha: true,
    Beta: false,
  });
  assert.deepEqual(model.edges[1].properties.business.example, {
    Alpha: false,
    Beta: true,
  });
  const review: string[] = [];
  const missing = buildModel({ entry: page }, [transition], review).models[0];
  assert.equal(missing.edges[0].properties.business.example, undefined);
  assert.ok(review.some((note) => note.includes("scalar fixed example")));
});
