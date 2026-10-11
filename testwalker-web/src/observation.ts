import type { Page } from "playwright";
import type { Json } from "./types.js";
import { captureControls } from "./controls.js";

/** Read a coherent rendered checkpoint using the same DOM evidence as execution. */
export async function observe(page: Page): Promise<Json> {
  const snapshot = await captureControls(page);
  try {
    return snapshot.page;
  } finally {
    await snapshot.dispose();
  }
}
