import { test } from "node:test";
import assert from "node:assert/strict";
import { basename, dirname, join, resolve } from "node:path";
import { buildModel } from "../src/discovery.js";
import { discoveryPaths, entryAliases } from "../src/model-export.js";

test("Global draft rules describe observable page evidence, with title and URL fallbacks", () => {
  const page = (headings: string[], title: string) => ({
    url: "https://example.test/",
    headings,
    title,
    forms: [],
    buttons: [],
  });
  for (const [pages, rule] of [
    [
      { entry: page(["Welcome"], "Home") },
      "The current page has a visible heading.",
    ],
    [
      { entry: page(["Welcome"], "Home"), next: page([], "Details") },
      "The browser page has a nonempty title.",
    ],
    [{ entry: page([], "") }, "The browser page has an HTTP or HTTPS URL."],
  ] as const) {
    const model = buildModel(pages, [], []).models[0];
    assert.deepEqual(model.properties.business.rules, [rule]);
  }
});

test("Only an unambiguous, fully identical returned entry fragment is merged; observed evidence is retained", () => {
  const seed = {
    url: "https://example.test/",
    title: "Home",
    headings: ["Home"],
    text: "Home content",
    forms: [],
    buttons: [],
  };
  const pages = {
    seed,
    home: { ...seed, url: "https://example.test/#home" },
    next: {
      ...seed,
      url: "https://example.test/#next",
      text: "Different content",
    },
  };
  const transitions = [
    { source: "seed", target: "home", intent: "Follow Home." },
    { source: "home", target: "next", intent: "Follow Next." },
    { source: "next", target: "home", intent: "Follow Home." },
  ];
  assert.deepEqual(entryAliases(pages, transitions), { home: "seed" });
  const review: string[] = [];
  const model = buildModel(pages, transitions, review).models[0];
  assert.deepEqual(
    model.vertices.map((vertex) => vertex.id),
    ["seed", "next"],
  );
  assert.equal(model.startElementId, "seed");
  assert.ok(
    model.edges.some(
      (edge) =>
        edge.sourceVertexId === "next" && edge.targetVertexId === "seed",
    ),
  );
  assert.ok(
    model.edges.every(
      (edge) =>
        edge.sourceVertexId !== "home" && edge.targetVertexId !== "home",
    ),
  );
  assert.ok(!review.some((note) => note.includes("not strongly connected")));
  assert.equal(
    transitions[2].target,
    "home",
    "Inventory must keep the original observed state",
  );
  assert.equal(Object.keys(pages).length, 3);
  assert.deepEqual(
    entryAliases(
      { ...pages, home: { ...pages.home, text: "Different content" } },
      transitions,
    ),
    {},
  );
  assert.deepEqual(
    entryAliases(
      { ...pages, home: { ...pages.home, url: "https://example.test/other" } },
      transitions,
    ),
    {},
  );
  assert.deepEqual(
    entryAliases(
      { ...pages, welcome: { ...seed, url: "https://example.test/#welcome" } },
      [
        ...transitions,
        { source: "next", target: "welcome", intent: "Follow Welcome." },
      ],
    ),
    {},
  );
  const genuine = buildModel(
    { ...pages, home: { ...pages.home, text: "Different content" } },
    transitions,
    review,
  ).models[0];
  assert.equal(genuine.vertices.length, 3);
  assert.ok(review.some((note) => note.includes("not strongly connected")));
});

test("Studio exports use unique identifiers and preserve prose with a non-overlapping workflow layout", () => {
  const pages = Object.fromEntries(
    [
      "Home & café",
      "Sign in / register",
      "订单",
      "Home & café",
      "Unlinked page",
      "Menu page",
    ].map((label, index) => [
      `state-${index}`,
      {
        url: `https://example.test/${index}`,
        headings: [label],
        forms: [],
        buttons: [],
      },
    ]),
  );
  const transitions = [
    {
      source: "state-0",
      target: "state-1",
      intent: "Follow Sign in / register.",
    },
    { source: "state-1", target: "state-2", intent: "Choose Continue." },
    { source: "state-2", target: "state-3", intent: "Complete the order." },
    { source: "state-3", target: "state-0", intent: "Return Home." },
    { source: "state-0", target: "state-5", intent: "Follow Menu page." },
    {
      source: "state-1",
      target: "state-2",
      intent: "Submit a different example.",
    },
    {
      source: "state-1",
      target: "state-1",
      intent: "Leave required input missing.",
    },
  ];
  const model = buildModel(pages, transitions, []);
  const { vertices, edges } = model.models[0];
  const names = [...vertices, ...edges].map((element) => element.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[ve]_\d+_[A-Za-z0-9_]+$/);
  assert.match(vertices[0].properties.business.description, /Home & café/);
  assert.equal(edges[0].properties.business.intent, transitions[0].intent);
  for (const vertex of vertices) {
    assert.ok(Number.isFinite(vertex.properties.x));
    assert.ok(Number.isFinite(vertex.properties.y));
    for (const other of vertices.filter((v) => v.id !== vertex.id)) {
      const minimumX =
        (vertex.name.length * 7.5 + 24 + other.name.length * 7.5 + 24) / 2;
      assert.ok(
        Math.abs(vertex.properties.x - other.properties.x) >= minimumX ||
          Math.abs(vertex.properties.y - other.properties.y) >= 40,
        "Studio nodes must not overlap",
      );
    }
  }
  for (let i = 1; i < 4; i++)
    assert.ok(
      vertices[i].properties.x > vertices[i - 1].properties.x,
      "Forward workflow advances left to right despite return and self-loop edges",
    );
  assert.equal(
    vertices[5].properties.x,
    vertices[1].properties.x,
    "Menu pages stay beside the entry rather than being pushed past the workflow",
  );
  assert.deepEqual(
    buildModel(pages, transitions, []),
    model,
    "Layout must be deterministic",
  );
});

test("Model filenames are normalized and each discovery gets a model-local timestamped artifact folder", () => {
  const roots = new Set<string>();
  for (const path of [
    "models with spaces/trailhead",
    "models with spaces/trailhead.json",
    "models with spaces/trailhead.model.json",
  ]) {
    const paths = discoveryPaths(path);
    assert.equal(
      paths.output,
      resolve("models with spaces/trailhead.model.json"),
    );
    assert.equal(
      dirname(paths.artifactRoot),
      resolve("models with spaces/artifact"),
    );
    assert.match(
      basename(paths.artifactRoot),
      /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z-\d+-\d+$/,
    );
    assert.equal(
      paths.inventoryPath,
      join(paths.artifactRoot, "trailhead.discovery.json"),
    );
    roots.add(paths.artifactRoot);
  }
  assert.equal(
    roots.size,
    3,
    "Run folders must be unique even within the same millisecond",
  );
  assert.throws(
    () => discoveryPaths("artifacts/trailhead.discovery.json"),
    /inventory/,
  );
});
