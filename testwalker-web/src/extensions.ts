import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tsImport } from "tsx/esm/api";
import assert from "node:assert/strict";
import type { Page } from "playwright";
import {
  Defect,
  Inconclusive,
  message,
  edges,
  states,
  type Json,
  type Model,
  type Rpc,
} from "./types.js";

export const EVENTS = [
  "before_run",
  "after_run",
  "before_walk",
  "after_walk",
  "before_reset",
  "after_reset",
  "before_state",
  "after_state",
  "before_transition",
  "after_transition",
  "before_case",
  "after_case",
] as const;
export interface HookContext {
  model: Model;
  states: ReturnType<typeof states>;
  edges: ReturnType<typeof edges>;
  url: string;
  page: Page | undefined;
  core: Rpc;
  phase: string;
  walk?: number;
  element?: Json;
  element_id?: string;
  data: Json;
  invalid: Json[];
  result?: Json;
  error?: Inconclusive;
  scratch: Json;
  report?: Json;
  check(condition: unknown, description: string): asserts condition;
}
export async function loadExtension(
  path: string,
): Promise<{ module: Json; metadata: Json }> {
  const absolute = resolve(path);
  const sha256 = createHash("sha256")
    .update(await readFile(absolute))
    .digest("hex");
  const module = await tsImport(pathToFileURL(absolute).href, import.meta.url);
  return { module, metadata: { path: absolute, sha256 } };
}
export class Hooks {
  readonly scratch: Json = {};
  readonly events: Json[] = [];
  constructor(
    readonly module: Json = {},
    readonly metadata: Json = { path: null, sha256: null },
  ) {
    for (const event of EVENTS)
      if (module[event] !== undefined && typeof module[event] !== "function") {
        throw new Error(`Hook ${event} must be a function`);
      }
  }
  static async load(path?: string): Promise<Hooks> {
    if (!path) return new Hooks();
    const { module, metadata } = await loadExtension(path);
    return new Hooks(module, metadata);
  }
  async fire(event: string, context: HookContext): Promise<void> {
    if (!EVENTS.includes(event as (typeof EVENTS)[number]))
      throw new Inconclusive(`Unknown hook: ${event}`);
    if (!this.module[event]) return;
    const entry: Json = {
      event,
      phase: context.phase,
      element: context.element_id,
    };
    this.events.push(entry);
    try {
      await this.module[event](context);
      entry.status = "PASS";
    } catch (error) {
      const fault =
        error instanceof Inconclusive
          ? error
          : error instanceof assert.AssertionError
            ? new Defect(`Hook ${event}: ${message(error)}`)
            : new Inconclusive(`Hook ${event}: ${message(error)}`);
      entry.status = fault.status;
      entry.error = fault.message;
      throw fault;
    }
  }
}
export class StrategyProvider {
  constructor(
    private factory?: (context: Json, fallback: Json) => Promise<Json> | Json,
  ) {}
  static async load(path?: string): Promise<StrategyProvider> {
    if (!path) return new StrategyProvider();
    const { module } = await loadExtension(path);
    if (typeof module.input_strategy !== "function")
      throw new Error("Export input_strategy(context, defaultDomain)");
    return new StrategyProvider(module.input_strategy);
  }
  async build(context: Json, fallback: Json): Promise<Json> {
    const domain = this.factory
      ? await this.factory(structuredClone(context), structuredClone(fallback))
      : fallback;
    if (!domain || typeof domain !== "object" || Array.isArray(domain))
      throw new Error("Strategy must return a JSON domain");
    // JSON serialization must not silently turn nonfinite numbers into null.
    JSON.stringify(domain, (_key, value) => {
      if (typeof value === "number" && !Number.isFinite(value))
        throw new Error("Strategy contains a nonfinite number");
      if (typeof value === "function" || typeof value === "undefined")
        throw new Error("Strategy must contain JSON values");
      return value;
    });
    return domain;
  }
}
