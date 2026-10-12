import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { BrowserContextOptions, LaunchOptions } from "playwright";
import type { Json } from "./types.js";

export interface BrowserSettings {
  launch?: LaunchOptions;
  context?: BrowserContextOptions;
}
export function httpUrl(value: unknown): string {
  if (typeof value !== "string" || /\s/.test(value))
    throw new Error("Supply an HTTP(S) URL");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Supply an HTTP(S) URL without embedded credentials");
  return url.href;
}
export async function loadBrowserSettings(
  path?: string,
): Promise<BrowserSettings> {
  if (!path) return {};
  const config: Json = JSON.parse(await readFile(path, "utf8"));
  if (!config || Array.isArray(config) || typeof config !== "object")
    throw new Error("Browser config must be an object");
  for (const key of Object.keys(config)) {
    if (!["launch", "context"].includes(key))
      throw new Error(`Unknown discovery browser setting: ${key}`);
    if (
      !config[key] ||
      typeof config[key] !== "object" ||
      Array.isArray(config[key])
    )
      throw new Error(`${key} must be an object`);
  }
  if (config.launch?.executablePath)
    config.launch.executablePath = resolve(
      dirname(resolve(path)),
      config.launch.executablePath,
    );
  return config;
}
