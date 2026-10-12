import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import type { Json } from "./types.js";

export async function loadHooks(path: string): Promise<Json> {
  return tsImport(pathToFileURL(resolve(path)).href, import.meta.url);
}
