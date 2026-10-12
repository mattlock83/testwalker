/** Discovery owns observations, not test verdicts or the execution protocol. */
export type Json = Record<string, any>;
export interface Model extends Json {
  models: Array<{
    id: string;
    name: string;
    startElementId: string;
    generator: string;
    properties: { business: Json };
    vertices: Array<Json & { id: string; name: string }>;
    edges: Array<
      Json & { id: string; sourceVertexId: string; targetVertexId: string }
    >;
  }>;
}
export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly result: Json = {},
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
