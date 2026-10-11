/** Adapter-specific values are JSON; the authoritative schemas live in Rust's OpenRPC. */
export type Json = Record<string, any>;
export interface Rpc {
  request(method: string, params?: Json): Promise<any>;
}
export interface Element extends Json {
  id: string;
  properties: { business: Json };
}
export interface Model extends Json {
  models: Array<{
    id: string;
    name: string;
    startElementId: string;
    generator: string;
    properties: { business: Json };
    vertices: Element[];
    edges: Element[];
  }>;
}
export type Verdict = "PASS" | "FAIL" | "INCONCLUSIVE";
export class Inconclusive extends Error {
  readonly status: Verdict = "INCONCLUSIVE";
  constructor(
    message: string,
    readonly result: Json = {},
  ) {
    super(message);
  }
}
export class Defect extends Inconclusive {
  override readonly status: Verdict = "FAIL";
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
export function business(model: Model): Json {
  return model.models[0].properties.business;
}
export function states(model: Model): Record<string, Element> {
  return Object.fromEntries(
    model.models[0].vertices.map((state) => [state.id, state]),
  );
}
export function edges(model: Model): Record<string, Element> {
  return Object.fromEntries(
    model.models[0].edges.map((edge) => [edge.id, edge]),
  );
}
