import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import type { Json, Model } from "./types.js";
import { STYLE, SCRIPT, BODY } from "./report-template.js";
import { entryAliases } from "./model-export.js";

export interface ReportRun {
  inventory: Json;
  path: string;
  /** While a crawl is staging its evidence, read from this directory. */
  artifactDirectory?: string;
}
export interface ReportOptions {
  output: string;
  modelPath?: string;
  /** Final location when the HTML is being written into a staging directory. */
  baseDirectory?: string;
}
const artifactPath = (value: unknown): string | undefined =>
  typeof value === "string" &&
  /^visit-\d+\/(screenshot\.png|network\.json)$/.test(value)
    ? value
    : undefined;
const href = (base: string, path: string): string =>
  relative(base, resolve(path)).split(sep).map(encodeURIComponent).join("/");

/** Self-contained viewer: no fetch, CDN, framework, or decision service. */
export async function writeDiscoveryReport(
  model: Model,
  runs: ReportRun[],
  options: ReportOptions,
): Promise<string> {
  const output = resolve(options.output);
  const base = resolve(options.baseDirectory ?? dirname(output));
  const vertices = model.models[0].vertices;
  const nodes = vertices.map((node) => {
    const page =
      runs.map((run) => run.inventory.pages[node.id]).find(Boolean) ?? {};
    return {
      id: node.id,
      name: page.page_label || page.headings?.[0] || page.title || node.name,
      studio_name: node.name,
      url: page.url ?? "",
      title: page.page_label ?? page.title,
      rules: node.properties?.business?.rules ?? [],
      alerts: page.alerts ?? [],
      forms: (page.forms ?? []).map((form: Json) => ({
        label: form.label,
        fields: form.fields.map((field: Json) => ({
          name: field.name,
          label: field.label,
          type: field.type,
          required: field.required,
          hint: field.hint,
          minimum: field.min,
          maximum: field.max,
        })),
      })),
    };
  });
  const visits: Json[] = [],
    actions: Json[] = [],
    issues: Json[] = [];
  const summaries: Json[] = [];
  const transitions: Json[] = [];
  // Previews are bounded; original JSON files remain available in full.
  let previewBudget = 2 * 1024 * 1024;
  const bodyPreview = (body: Json | undefined): Json | undefined => {
    if (!body) return undefined;
    const result: Json = {
      status: body.status,
      bytes: body.bytes,
      error: body.error,
    };
    if (body.status === "captured") {
      const encoded = JSON.stringify(body.value, null, 2);
      const length = Math.min(2000, previewBudget);
      if (length)
        result.preview = new TextDecoder().decode(
          Buffer.from(encoded).subarray(0, length),
          { stream: true },
        );
      result.truncated = encoded.length > (result.preview?.length ?? 0);
      previewBudget -= Buffer.byteLength(result.preview ?? "");
    }
    return result;
  };
  for (const [runIndex, run] of runs.entries()) {
    const inventory = run.inventory;
    const aliases = entryAliases(inventory.pages, inventory.transitions);
    const stateId = (id: string | null) =>
      id &&
      !vertices.some((vertex) => vertex.id === id) &&
      vertices.some((vertex) => vertex.id === aliases[id])
        ? aliases[id]
        : id;
    const artifacts = resolve(
      dirname(run.path),
      inventory.artifact_root ??
        basename(run.path).replace(/\.discovery\.json$/, ".discovery"),
    );
    const readDirectory = run.artifactDirectory ?? artifacts;
    const pendingCounts: Json = {};
    for (const action of inventory.pending ?? [])
      pendingCounts[action.reason] = (pendingCounts[action.reason] ?? 0) + 1;
    summaries.push({
      name: basename(run.path),
      inventory: href(base, run.path),
      states: Object.keys(inventory.pages).length,
      transitions: inventory.transitions.length,
      visits: inventory.visits.length,
      operations: inventory.operations,
      limits: inventory.limits,
      stop: inventory.stop_reason ?? "Queue exhausted",
      pending: (inventory.pending ?? []).length,
      pending_reasons: pendingCounts,
    });
    for (const visit of inventory.visits ?? []) {
      const screenshot = artifactPath(visit.artifacts?.["screenshot.png"]);
      const networkFile = artifactPath(visit.artifacts?.["network.json"]);
      const network: Json = { available: Boolean(networkFile) };
      if (networkFile) {
        network.href = href(base, join(artifacts, networkFile));
        try {
          const file = join(readDirectory, networkFile);
          if ((await stat(file)).size > 8 * 1024 * 1024)
            network.note = "Large capture: open the JSON file for details.";
          else {
            const captured = JSON.parse(await readFile(file, "utf8"));
            network.count = captured.requests.length;
            network.omitted = captured.omitted_requests ?? 0;
            network.requests = captured.requests
              .slice(0, 50)
              .map((entry: Json) => ({
                url: entry.url,
                method: entry.method,
                request_content_type: entry.request_content_type,
                status: entry.status,
                resource_type: entry.resource_type,
                failure: entry.failure,
                timing: entry.timing,
                request_body: bodyPreview(entry.request_body),
                response: entry.response
                  ? {
                      status: entry.response.status,
                      content_type: entry.response.content_type,
                      body: bodyPreview(entry.response.body),
                    }
                  : undefined,
              }));
            if (captured.requests.length > 50)
              network.note =
                "Showing the first 50 exchanges; open JSON for the full capture.";
          }
        } catch {
          network.note =
            "Capture unavailable here; use the original run artifacts.";
        }
      }
      visits.push({
        key: `${runIndex}/${visit.id}`,
        id: visit.id,
        run: runIndex,
        url: visit.url,
        source: stateId(visit.source),
        state: stateId(visit.state),
        observed_state: visit.state,
        intent: visit.intent,
        depth: visit.depth,
        steps: visit.steps,
        error: visit.error,
        diagnostic: visit.diagnostic,
        deferred: visit.deferred,
        capture_errors: visit.capture_errors ?? [],
        screenshot: screenshot
          ? href(base, join(artifacts, screenshot))
          : undefined,
        network,
      });
    }
    const candidates = inventory.actions ?? inventory.pending ?? [];
    for (const [index, action] of candidates.entries())
      actions.push({
        key: `${runIndex}/${index}`,
        run: runIndex,
        source: stateId(action.source),
        target: stateId(action.target),
        status: action.status,
        intent: action.intent,
        kind: action.kind,
        reason: action.reason ?? inventory.stop_reason ?? "Crawl stopped",
        error: action.error,
        diagnostic: action.diagnostic,
        visit: action.visit ? `${runIndex}/${action.visit}` : undefined,
        route_length: action.route_length ?? action.steps?.length,
      });
    for (const [index, failure] of (inventory.failed ?? []).entries())
      issues.push({
        ...failure,
        key: `${runIndex}/failure/${index}`,
        run: runIndex,
        type: "Discovery action",
        visit: failure.visit ? `${runIndex}/${failure.visit}` : undefined,
      });
    for (const visit of inventory.visits ?? [])
      for (const [index, error] of (visit.capture_errors ?? []).entries())
        issues.push({
          ...error,
          key: `${runIndex}/${visit.id}/capture/${index}`,
          run: runIndex,
          type: "Evidence capture",
          intent: visit.intent,
          visit: `${runIndex}/${visit.id}`,
        });
    for (const transition of inventory.transitions ?? [])
      transitions.push({
        ...transition,
        source: stateId(transition.source),
        target: stateId(transition.target),
        visit: transition.visit ? `${runIndex}/${transition.visit}` : undefined,
      });
  }
  const edges = model.models[0].edges.map((edge) => {
    const intent = edge.properties?.business?.intent;
    return {
      id: edge.id,
      source: edge.sourceVertexId,
      target: edge.targetVertexId,
      intent,
      visits: [
        ...new Set(
          transitions
            .filter(
              (transition) =>
                transition.edge_id === edge.id ||
                (transition.source === edge.sourceVertexId &&
                  transition.target === edge.targetVertexId &&
                  transition.intent === intent),
            )
            .map((transition) => transition.visit)
            .filter(Boolean),
        ),
      ],
    };
  });
  const data = {
    title: "Discovery results",
    generated: new Date().toISOString(),
    seeds: [...new Set(runs.flatMap((run) => run.inventory.seeds))],
    entry: model.models[0].startElementId,
    nodes,
    edges,
    visits,
    actions,
    issues,
    runs: summaries,
    review: [...new Set(runs.flatMap((run) => run.inventory.review ?? []))],
    model: options.modelPath ? href(base, options.modelPath) : undefined,
  };
  const encoded = JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Testwalker discovery results</title><style>${STYLE}</style></head><body>${BODY}<script id="report-data" type="application/json">${encoded}</script><script>${SCRIPT}</script></body></html>`;
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html, { flag: "wx" });
  return output;
}
