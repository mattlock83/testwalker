import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { ElementHandle } from "playwright";
import type { BrowserSettings } from "./config.js";
import type { Control } from "./controls.js";
import { Inconclusive, type Json } from "./types.js";

export type InputPlan =
  | { operation: "FILL"; value: string; trim: boolean }
  | { operation: "CHECK"; value: boolean; radio: boolean }
  | { operation: "SELECT"; index: number }
  | { operation: "UPLOAD"; paths: string[]; names: string[] }
  | {
      operation: "RANGE";
      value: number;
      minimum: number;
      maximum: number;
      continuous: boolean;
    }
  | { operation: "COLOR"; value: string };

/** Build and validate the entire literal input plan before touching any field. */
export async function planInput(
  control: Control,
  value: unknown,
  settings: BrowserSettings,
  field: Json = {},
): Promise<InputPlan> {
  if (control.disabled || control.readOnly)
    throw new Inconclusive(`Control is not editable: ${control.label}`);
  if (!["string", "number", "boolean"].includes(typeof value))
    throw new Inconclusive(`Missing literal input for ${control.label}`);
  if (control.operations.includes("CHECK")) {
    if (typeof value !== "boolean")
      throw new Inconclusive(
        `Checkbox/radio input must be boolean: ${control.label}`,
      );
    return {
      operation: "CHECK",
      value,
      radio: control.type === "radio" || control.role === "radio",
    };
  }
  if (control.operations.includes("SELECT")) {
    const matches = (control.options ?? []).flatMap((option, index) =>
      !option.disabled &&
      (option.value === String(value) || option.label === String(value))
        ? [index]
        : [],
    );
    if (matches.length !== 1)
      throw new Inconclusive(
        `No unique literal select option for ${control.label}`,
      );
    return { operation: "SELECT", index: matches[0] };
  }
  if (control.operations.includes("UPLOAD")) {
    if (typeof value !== "string")
      throw new Inconclusive("Upload input must name a configured fixture");
    const paths =
      value === ""
        ? []
        : settings.uploads && Object.hasOwn(settings.uploads, value)
          ? settings.uploads[value]
          : undefined;
    if (!paths) throw new Inconclusive(`Unknown upload fixture: ${value}`);
    if (!control.multiple && paths.length > 1)
      throw new Inconclusive("This file input accepts only one file");
    for (const path of paths) {
      let file;
      try {
        file = await stat(path);
      } catch {
        throw new Inconclusive(
          `Upload fixture file is unavailable: ${basename(path)}`,
        );
      }
      if (!file.isFile())
        throw new Inconclusive("Upload fixtures must be regular files");
    }
    return {
      operation: "UPLOAD",
      paths,
      names: paths.map((path) => basename(path)),
    };
  }
  if (control.operations.includes("RANGE")) {
    const number =
      typeof value === "boolean" || String(value).trim() === ""
        ? NaN
        : Number(value);
    const minimum = control.minimum ?? 0,
      maximum = control.maximum ?? 100;
    const step = control.step;
    if (
      ![number, minimum, maximum].every(Number.isFinite) ||
      number < minimum ||
      number > maximum ||
      minimum > maximum ||
      (step !== undefined &&
        (!Number.isFinite(step) ||
          step <= 0 ||
          Math.abs(
            (number - (control.stepBase ?? minimum)) / step -
              Math.round((number - (control.stepBase ?? minimum)) / step),
          ) > 1e-7))
    )
      throw new Inconclusive(
        `Literal slider value is outside its range or step: ${control.label}`,
      );
    return {
      operation: "RANGE",
      value: number,
      minimum,
      maximum,
      continuous: control.type === "range" && control.step === undefined,
    };
  }
  if (control.operations.includes("COLOR")) {
    if (typeof value !== "string" || !/^#[0-9a-f]{6}$/i.test(value))
      throw new Inconclusive("Native colour values must use #RRGGBB");
    return { operation: "COLOR", value: value.toLowerCase() };
  }
  if (!control.operations.includes("FILL"))
    throw new Inconclusive(`No editable operation for ${control.label}`);
  if (control.type === "date" && value !== "") {
    const date = String(value);
    const parsed = Date.parse(date + "T00:00:00Z");
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      date.startsWith("0000") ||
      !Number.isFinite(parsed) ||
      new Date(parsed).toISOString().slice(0, 10) !== date
    )
      throw new Inconclusive(
        "Native dates must be real calendar dates in YYYY-MM-DD format",
      );
  }
  return {
    operation: "FILL",
    value: String(value),
    trim: field["trim spaces"] !== false,
  };
}

export async function enterInput(
  handle: ElementHandle,
  plan: InputPlan,
): Promise<void> {
  switch (plan.operation) {
    case "CHECK":
      // Radios are cleared by selecting a sibling; check the complete group afterward.
      if (!plan.radio || plan.value) await handle.setChecked(plan.value);
      return;
    case "SELECT":
      await handle.selectOption({ index: plan.index });
      return;
    case "UPLOAD":
      await handle.setInputFiles(plan.paths);
      return;
    case "FILL":
      await handle.fill(plan.value);
      return;
    case "COLOR":
      // Native colour pickers are OS UI. Set the native value through trusted
      // adapter code and fire its standard events; never run model/provider code.
      await handle.evaluate((element, value) => {
        if (
          !(element instanceof HTMLInputElement) ||
          element.type !== "color" ||
          element.disabled ||
          element.getAttribute("aria-readonly") === "true"
        )
          throw new Error("Colour input is no longer actionable");
        element.value = value;
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      }, plan.value);
      return;
    case "RANGE": {
      if (plan.continuous) {
        await handle.evaluate((element, value) => {
          if (
            !(element instanceof HTMLInputElement) ||
            element.type !== "range" ||
            element.step !== "any" ||
            element.disabled ||
            element.getAttribute("aria-readonly") === "true"
          )
            throw new Error("Continuous slider is no longer actionable");
          element.valueAsNumber = value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }, plan.value);
        return;
      }
      const read = () =>
        handle.evaluate((element) => {
          const value =
            element instanceof HTMLInputElement
              ? element.value
              : (element as Element).getAttribute("aria-valuenow");
          return value === null || value.trim() === "" ? NaN : Number(value);
        });
      let actual = await read();
      if (!Number.isFinite(actual))
        throw new Inconclusive("The slider has no numeric current value");
      // Real keyboard interaction works with native ranges and accessible ARIA sliders.
      if (Math.abs(plan.value - plan.minimum) < Math.abs(plan.value - actual)) {
        await handle.press("Home");
        actual = await read();
      } else if (
        Math.abs(plan.maximum - plan.value) < Math.abs(plan.value - actual)
      ) {
        await handle.press("End");
        actual = await read();
      }
      for (let steps = 0; Math.abs(actual - plan.value) > 1e-7; steps++) {
        if (steps >= 1000)
          throw new Inconclusive(
            "Slider exceeded the keyboard interaction allowance",
          );
        const previous = actual;
        await handle.press(actual < plan.value ? "ArrowUp" : "ArrowDown");
        actual = await read();
        if (
          !Number.isFinite(actual) ||
          actual === previous ||
          (plan.value - previous) * (plan.value - actual) < -1e-7
        )
          throw new Inconclusive(
            "The slider cannot reach the exact supplied value using its keyboard steps",
          );
      }
      return;
    }
  }
}

export async function matchesInput(
  handle: ElementHandle,
  plan: InputPlan,
): Promise<boolean> {
  const actual = await handle.evaluate((element) => {
    if (element instanceof HTMLTextAreaElement) return element.value;
    if (element instanceof HTMLInputElement) {
      if (["checkbox", "radio"].includes(element.type)) return element.checked;
      if (element.type === "file")
        return [...(element.files ?? [])].map((file) => file.name);
      return element.value;
    }
    if (element instanceof HTMLSelectElement)
      return [...element.selectedOptions].map((option) => option.index);
    if ((element as Element).getAttribute("role") === "slider")
      return (element as Element).getAttribute("aria-valuenow");
    if ((element as Element).hasAttribute("aria-checked"))
      return (element as Element).getAttribute("aria-checked") === "true";
    return (element as HTMLElement).innerText;
  });
  switch (plan.operation) {
    case "CHECK":
      return actual === plan.value;
    case "SELECT":
      return (
        Array.isArray(actual) && actual.length === 1 && actual[0] === plan.index
      );
    case "UPLOAD":
      return JSON.stringify(actual) === JSON.stringify(plan.names);
    case "RANGE":
      return (
        actual !== null &&
        String(actual).trim() !== "" &&
        Number(actual) === plan.value
      );
    case "COLOR":
      return actual === plan.value;
    case "FILL":
      return (
        (plan.trim ? String(actual).trim() : String(actual)) ===
        (plan.trim ? plan.value.trim() : plan.value)
      );
  }
}
