import { readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type { BrowserContextOptions, LaunchOptions } from "playwright";
import type { Json } from "./types.js";

export const DEFAULT_THRESHOLD = 0.8;
export interface BrowserSettings {
  launch?: LaunchOptions;
  context?: BrowserContextOptions;
  cdp_url?: string;
  action_timeout_ms?: number;
  navigation_timeout_ms?: number;
  settle_ms?: number;
  settle_timeout_ms?: number;
}
export function httpUrl(value: unknown): string {
  if (typeof value !== "string" || /\s/.test(value))
    throw new Error("Supply an HTTP(S) URL");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error("Supply an HTTP(S) URL without embedded credentials");
  }
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
    if (
      ![
        "launch",
        "context",
        "cdp_url",
        "action_timeout_ms",
        "navigation_timeout_ms",
        "settle_ms",
        "settle_timeout_ms",
      ].includes(key)
    ) {
      throw new Error(`Unknown browser setting: ${key}`);
    }
  }
  for (const key of ["launch", "context"]) {
    if (
      config[key] !== undefined &&
      (!config[key] ||
        typeof config[key] !== "object" ||
        Array.isArray(config[key]))
    ) {
      throw new Error(`${key} must be an object`);
    }
  }
  for (const key of [
    "action_timeout_ms",
    "navigation_timeout_ms",
    "settle_timeout_ms",
  ]) {
    if (
      config[key] !== undefined &&
      (!Number.isInteger(config[key]) || config[key] <= 0)
    ) {
      throw new Error(`${key} must be a positive integer`);
    }
  }
  if (
    config.settle_ms !== undefined &&
    (!Number.isInteger(config.settle_ms) || config.settle_ms < 0)
  )
    throw new Error("settle_ms must be a nonnegative integer");
  if ((config.settle_timeout_ms ?? 5000) < (config.settle_ms ?? 150))
    throw new Error("settle_timeout_ms must be at least settle_ms");
  if (config.cdp_url) config.cdp_url = httpUrl(config.cdp_url);
  if (config.launch?.executablePath) {
    config.launch.executablePath = resolve(
      dirname(resolve(path)),
      config.launch.executablePath,
    );
  }
  return config;
}
