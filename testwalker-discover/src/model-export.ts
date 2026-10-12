import { graphlib, layout } from "@dagrejs/dagre";
import { resolve } from "node:path";
import type { Json } from "./types.js";

/** A returned fragment route may expose the exact same UI as the seed URL. */
export function entryAliases(
  pages: Record<string, Json>,
  transitions: Json[],
): Record<string, string> {
  const [entryId, entry] = Object.entries(pages)[0] ?? [];
  if (!entry || transitions.some((transition) => transition.target === entryId))
    return {};
  const entryUrl = new URL(entry.url);
  if (entryUrl.hash) return {};
  // Compare the entire captured snapshot, including text and form values. Never
  // merge different hash screens merely because their headings/controls match.
  const snapshot = (page: Json) => {
    const url = new URL(page.url);
    url.hash = "";
    return JSON.stringify({ ...page, url: url.href });
  };
  const initial = snapshot(entry);
  const candidates = Object.entries(pages).filter(([id, page]) => {
    const url = new URL(page.url);
    url.hash = "";
    return (
      id !== entryId &&
      new URL(page.url).hash &&
      url.href === entryUrl.href &&
      transitions.some((transition) => transition.target === id) &&
      snapshot(page) === initial
    );
  });
  // Multiple matching fragments may have route semantics we cannot infer.
  return candidates.length === 1 ? { [candidates[0][0]]: entryId } : {};
}

/** Studio names are identifiers; the full prose stays in business metadata. */
export function studioName(
  prefix: "v" | "e",
  index: number,
  label: string,
): string {
  const suffix = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 52)
    .replace(/_+$/g, "");
  return `${prefix}_${index + 1}_${suffix || "Unnamed"}`;
}

/** Lay out forward navigation; return/menu edges must not stretch the workflow. */
export function studioLayout(vertices: Json[], edges: Json[]): void {
  const levels = new Map<string, number>();
  const outgoing = new Map(
    vertices.map((vertex) => [vertex.id, [] as string[]]),
  );
  for (const edge of edges)
    outgoing.get(edge.sourceVertexId)?.push(edge.targetVertexId);
  for (const root of vertices) {
    if (levels.has(root.id)) continue;
    levels.set(root.id, 0);
    const queue = [root.id];
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const source = queue[cursor];
      for (const target of outgoing.get(source) ?? []) {
        if (!outgoing.has(target) || levels.has(target)) continue;
        levels.set(target, levels.get(source)! + 1);
        queue.push(target);
      }
    }
  }
  const graph = new graphlib.Graph()
    .setGraph({
      rankdir: "LR",
      ranker: "network-simplex",
      nodesep: 90,
      ranksep: 180,
      marginx: 80,
      marginy: 80,
    })
    .setDefaultEdgeLabel(() => ({}));
  for (const vertex of vertices)
    graph.setNode(vertex.id, {
      // Match Studio's single-line label sizing, with room around the node.
      width: Math.max(60, vertex.name.length * 7.5 + 24),
      height: 40,
    });
  for (const edge of edges) {
    if (levels.get(edge.targetVertexId)! > levels.get(edge.sourceVertexId)!)
      graph.setEdge(edge.sourceVertexId, edge.targetVertexId);
  }
  layout(graph);
  for (const vertex of vertices) {
    const point = graph.node(vertex.id);
    Object.assign(vertex.properties, {
      x: Math.round(point.x),
      y: Math.round(point.y),
    });
  }
}

export function discoveryPaths(requested: string): {
  output: string;
  inventoryPath: string;
  artifactRoot: string;
} {
  const absolute = resolve(requested);
  if (/\.discovery(?:\.json)?$/i.test(absolute))
    throw new Error(
      "Choose a model output filename, not a discovery inventory",
    );
  const stem = absolute.replace(/(?:\.model)?\.json$/i, "");
  return {
    output: `${stem}.model.json`,
    inventoryPath: `${stem}.discovery.json`,
    artifactRoot: `${stem}.discovery`,
  };
}
