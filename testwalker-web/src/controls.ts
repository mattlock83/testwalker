import { createHash } from "node:crypto";
import type { ElementHandle, Frame, JSHandle, Page } from "playwright";
import { Inconclusive, type Json } from "./types.js";

export interface Control {
  id: string;
  frame: number;
  role: string;
  label: string;
  tag: string;
  type: string;
  value: string | boolean | null;
  href: string | null;
  target?: string;
  download?: string | null;
  in_navigation: boolean;
  form: string | null;
  context: string;
  operations: string[];
  readOnly: boolean;
  disabled: boolean;
  options?: Array<{ value: string; label: string; disabled: boolean }>;
}

export class StaleSnapshot extends Inconclusive {}

interface FrameEvidence {
  page: Json;
  controls: Control[];
  signature: string;
}
interface RetainedFrame extends FrameEvidence {
  fresh(): boolean;
  resolve(index: number): Element;
}
interface CapturedFrame {
  frame: Frame;
  handle: JSHandle<RetainedFrame>;
  evidence: FrameEvidence;
}

let sequence = 0;

/** Runs inside one document. Reading evidence and retaining its controls is atomic. */
function retainDocument({ frame, prefix }: { frame: number; prefix: string }) {
  const forms = new WeakMap<Element, string>();
  let nextForm = 0;
  const clean = (value: string | null | undefined) =>
    (value ?? "").replace(/\s+/g, " ").trim();
  const rendered = (element: Element) => {
    const box = element.getBoundingClientRect();
    return Boolean(
      box.width &&
        box.height &&
        element.checkVisibility({
          checkOpacity: true,
          checkVisibilityCSS: true,
        }),
    );
  };
  const ancestor = (element: Element, selector: string): Element | null => {
    let current: Element | null = element;
    while (current) {
      if (current.matches(selector)) return current;
      current =
        current.parentElement ??
        ((current.getRootNode() as ShadowRoot).host || null);
    }
    return null;
  };
  const text = (element: Element) =>
    (element as HTMLElement).innerText ?? element.textContent ?? "";
  const referenced = (element: Element, attribute: string) =>
    (element.getAttribute(attribute) ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => {
        const root = element.getRootNode() as Document | ShadowRoot;
        return root.getElementById(id);
      })
      .filter((node): node is HTMLElement => node !== null);
  const label = (element: Element): string => {
    const labelledBy = referenced(element, "aria-labelledby")
      .map(text)
      .join(" ");
    if (clean(labelledBy)) return clean(labelledBy);
    if (element.hasAttribute("aria-label"))
      return clean(element.getAttribute("aria-label"));
    const associated = (element as HTMLInputElement).labels;
    if (associated?.length)
      return clean(
        [...associated]
          .map((label) => {
            // A select's options and a text area's value are not its label.
            const copy = label.cloneNode(true) as Element;
            for (const control of copy.querySelectorAll(
              "input,textarea,select,[contenteditable]",
            ))
              control.remove();
            return text(copy);
          })
          .join(" "),
      );
    if (element instanceof HTMLInputElement) {
      if (["submit", "reset", "button"].includes(element.type))
        return clean(
          element.value || (element.type === "submit" ? "Submit" : "Reset"),
        );
      if (element.type === "image") return clean(element.alt);
      return clean(element.title || element.placeholder);
    }
    const content = clean(text(element));
    if (content) return content;
    return clean(
      [...element.querySelectorAll("img[alt]")]
        .map((image) => image.getAttribute("alt"))
        .join(" ") || element.getAttribute("title"),
    );
  };
  const disabled = (element: Element) =>
    element.matches(":disabled") ||
    Boolean(ancestor(element, '[aria-disabled="true"],[inert]'));
  const formIdentity = (element: Element) => {
    const form = (element as HTMLInputElement).form;
    if (!form) return null;
    if (!forms.has(form)) forms.set(form, `f${frame}-form${nextForm++}`);
    return forms.get(form)!;
  };
  const describe = (element: Element, index: number): Control | null => {
    const editable =
      Boolean((element as HTMLElement).isContentEditable) &&
      !(element.parentElement as HTMLElement | null)?.isContentEditable;
    if (
      !editable &&
      !element.matches("input,textarea,select,button,a[href],summary,[role]")
    )
      return null;
    if (!element.isConnected || !rendered(element) || disabled(element))
      return null;
    const tag = element.localName;
    const roleAttribute = (element.getAttribute("role") ?? "").split(/\s+/)[0];
    const input = element instanceof HTMLInputElement;
    const textarea = element instanceof HTMLTextAreaElement;
    const select = element instanceof HTMLSelectElement;
    const button = element instanceof HTMLButtonElement;
    const type = input || button ? element.type : "";
    if (type === "hidden") return null;
    const checkable = input && ["checkbox", "radio"].includes(type);
    const nativeButton =
      button ||
      (input && ["submit", "reset", "button", "image"].includes(type));
    const link =
      element instanceof HTMLAnchorElement && element.hasAttribute("href");
    const readOnly =
      Boolean((input || textarea) && element.readOnly) ||
      element.getAttribute("aria-readonly") === "true";
    const operations: string[] = [];
    if (checkable && !readOnly) operations.push("CHECK");
    else if (select && !readOnly) operations.push("SELECT");
    else if (
      !readOnly &&
      (textarea ||
        editable ||
        (input && !nativeButton && !["file", "range", "color"].includes(type)))
    )
      operations.push("FILL");
    if (
      !readOnly &&
      (nativeButton ||
        link ||
        [
          "button",
          "link",
          "tab",
          "menuitem",
          "menuitemcheckbox",
          "menuitemradio",
          "option",
          "checkbox",
          "radio",
          "switch",
          "combobox",
        ].includes(roleAttribute) ||
        tag === "summary")
    )
      operations.push("CLICK");
    if (!input && !textarea && !select && !editable && !operations.length)
      return null;
    const role =
      roleAttribute ||
      (checkable
        ? type
        : select
          ? "combobox"
          : nativeButton || tag === "summary"
            ? "button"
            : link
              ? "link"
              : "textbox");
    const region = ancestor(
      element,
      "fieldset,form,section,[role=group],[role=dialog]",
    );
    const heading = region?.querySelector("legend,h1,h2,h3,h4,[role=heading]");
    const context = clean(
      [region?.getAttribute("aria-label"), heading ? text(heading) : ""]
        .filter(Boolean)
        .join(" · "),
    ).slice(0, 400);
    return {
      id: `${prefix}-f${frame}-c${index}`,
      frame,
      role,
      label: label(element).slice(0, 1000),
      tag,
      type,
      value: checkable
        ? element.checked
        : input || textarea || select
          ? element.value
          : editable
            ? text(element)
            : element.hasAttribute("aria-checked")
              ? element.getAttribute("aria-checked") === "true"
              : null,
      href: link ? element.href : null,
      ...(link
        ? {
            target: element.getAttribute("target") ?? "",
            download: element.getAttribute("download"),
          }
        : {}),
      in_navigation: Boolean(ancestor(element, 'nav,[role="navigation"]')),
      form: formIdentity(element),
      context,
      operations,
      readOnly,
      disabled: false,
      ...(select
        ? {
            options: [...element.options].map((option) => ({
              value: option.value,
              label: option.label,
              disabled:
                option.disabled ||
                (option.parentElement instanceof HTMLOptGroupElement &&
                  option.parentElement.disabled),
            })),
          }
        : {}),
    };
  };
  const identity = (
    element: Element,
    { id: _id, value: _value, ...control }: Control,
    interaction = false,
  ) =>
    JSON.stringify({
      control: interaction ? { ...control, context: undefined } : control,
      attributes: element
        .getAttributeNames()
        .filter(
          (name) =>
            !["class", "style", "value", "checked", "aria-checked"].includes(
              name,
            ) &&
            !(
              interaction &&
              [
                "aria-invalid",
                "aria-describedby",
                "aria-errormessage",
              ].includes(name)
            ),
        )
        .sort()
        .map((name) => [name, element.getAttribute(name)]),
    });
  const read = () => {
    const elements: Element[] = [];
    const shadows: ShadowRoot[] = [];
    const walk = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll("*")) {
        elements.push(element);
        if (element.shadowRoot) {
          shadows.push(element.shadowRoot);
          walk(element.shadowRoot);
        }
      }
    };
    walk(document);
    const nodes: Element[] = [];
    const controls: Control[] = [];
    for (const element of elements) {
      const control = describe(element, controls.length);
      if (control) {
        nodes.push(element);
        controls.push(control);
      }
    }
    const messages = (role: string) =>
      elements
        .filter(
          (element) =>
            element.getAttribute("role") === role && rendered(element),
        )
        .slice(0, 20)
        .map((element) => text(element).slice(0, 4000));
    const invalid_fields = elements
      .filter(
        (element) =>
          element.getAttribute("aria-invalid") === "true" && rendered(element),
      )
      .slice(0, 50)
      .map((element) => ({
        label: label(element),
        explanation: referenced(element, "aria-describedby")
          .map(text)
          .join(" ")
          .slice(0, 4000),
        validation_messages: [
          ...new Set([
            ...referenced(element, "aria-errormessage"),
            ...referenced(element, "aria-describedby").filter((message) =>
              ancestor(message, '[role="alert"]'),
            ),
          ]),
        ]
          .map(text)
          .filter(Boolean),
      }));
    const semantics = {
      alerts: messages("alert"),
      status: messages("status"),
      invalid_fields,
      editable_fields: controls
        .filter((control) =>
          control.operations.some((operation) =>
            ["FILL", "CHECK", "SELECT"].includes(operation),
          ),
        )
        .map((control) => ({
          label: control.label,
          current_value: control.value,
        })),
      available_links: controls
        .filter((control) => control.role === "link")
        .map((control) => ({
          label: control.label,
          href: control.href,
          in_navigation: control.in_navigation,
        })),
      available_buttons: controls
        .filter((control) => control.role === "button")
        .map((control) => ({ label: control.label })),
      visible_options: elements
        .filter(
          (element) =>
            element.getAttribute("role") === "option" && rendered(element),
        )
        .slice(0, 100)
        .map((element) => ({ label: label(element) })),
    };
    // innerText includes offscreen rendered evidence. Shadow trees need their own text.
    const page = {
      url: location.href,
      title: document.title,
      text: [
        document.body?.innerText ?? "",
        ...shadows.map((root) =>
          [...root.children].filter(rendered).map(text).join("\n"),
        ),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 80000),
      semantics,
    };
    const signature = JSON.stringify({
      page,
      controls: controls.map(({ id: _id, ...control }) => control),
      identities: nodes.map((node, index) => identity(node, controls[index])),
      // Static relationships also matter to the independently captured ARIA
      // tree, even if changing them leaves rendered text unchanged.
      structure: elements.map((element) => [
        element.localName,
        ...element
          .getAttributeNames()
          .filter(
            (name) =>
              name.startsWith("aria-") ||
              ["role", "id", "alt", "title", "hidden"].includes(name),
          )
          .sort()
          .map((name) => [name, element.getAttribute(name)]),
      ]),
      frame_hosts: elements
        .filter((element) => element.matches("iframe,frame"))
        .map((element) => ({
          src: element.getAttribute("src"),
          visible: rendered(element),
        })),
    });
    return { page, controls, nodes, signature };
  };
  const captured = read();
  const identities = captured.nodes.map((node, index) =>
    identity(node, captured.controls[index], true),
  );
  return {
    page: captured.page,
    controls: captured.controls,
    signature: captured.signature,
    fresh() {
      const current = read();
      return (
        current.signature === captured.signature &&
        current.nodes.every((node, index) => node === captured.nodes[index])
      );
    },
    resolve(index: number) {
      const node = captured.nodes[index];
      const current = node && describe(node, index);
      if (!current || identity(node, current, true) !== identities[index])
        throw new Error("The observed control was detached or changed");
      return node;
    },
  };
}

export class ControlSnapshot {
  readonly controls: Control[];
  readonly page: Json;
  readonly fingerprint: string;
  private disposed = false;
  private readonly bindings = new Map<
    string,
    { frame: CapturedFrame; index: number }
  >();
  private readonly resolved = new Set<ElementHandle>();

  constructor(
    private readonly browserPage: Page,
    private readonly frames: CapturedFrame[],
    private readonly allFrames: Frame[],
  ) {
    this.controls = frames.flatMap((frame) => frame.evidence.controls);
    for (const frame of frames)
      frame.evidence.controls.forEach((control, index) =>
        this.bindings.set(control.id, { frame, index }),
      );
    const main = frames.find(
      (frame) => frame.frame === browserPage.mainFrame(),
    )!;
    const children = frames.filter((frame) => frame !== main);
    this.page = {
      ...main.evidence.page,
      text: [
        main.evidence.page.text,
        ...children.map((frame) => frame.evidence.page.text),
      ]
        .filter(Boolean)
        .join("\n")
        .slice(0, 80000),
      accessibility_tree: frames
        .map((frame) => frame.evidence.page.accessibility_tree)
        .join("\n"),
      semantics: Object.fromEntries(
        Object.keys(main.evidence.page.semantics).map((key) => [
          key,
          frames.flatMap((frame) => frame.evidence.page.semantics[key] ?? []),
        ]),
      ),
      ...(children.length
        ? {
            frames: children.map((frame) => ({
              url: frame.evidence.page.url,
              title: frame.evidence.page.title,
            })),
          }
        : {}),
    };
    this.fingerprint = createHash("sha256")
      .update(JSON.stringify(frames.map((frame) => frame.evidence.signature)))
      .digest("hex");
  }

  async assertFresh(): Promise<void> {
    if (this.disposed)
      throw new StaleSnapshot("The browser snapshot has been disposed");
    const currentFrames = this.browserPage.frames();
    if (
      currentFrames.length !== this.allFrames.length ||
      currentFrames.some((frame, i) => frame !== this.allFrames[i])
    )
      throw new StaleSnapshot("The page's frames changed after observation");
    try {
      for (const frame of this.frames)
        if (!(await frame.handle.evaluate((snapshot) => snapshot.fresh())))
          throw new StaleSnapshot("The page changed after observation");
    } catch (error) {
      if (error instanceof StaleSnapshot) throw error;
      throw new StaleSnapshot("The page changed after observation");
    }
  }

  async resolve(id: string): Promise<ElementHandle> {
    if (this.disposed)
      throw new StaleSnapshot("The browser snapshot has been disposed");
    const binding = this.bindings.get(id);
    if (!binding)
      throw new Inconclusive("The selected control was not observed", {
        control_id: id,
      });
    try {
      const handle = await binding.frame.handle.evaluateHandle(
        (snapshot, index) => snapshot.resolve(index),
        binding.index,
      );
      const element = handle.asElement();
      if (!element) {
        await handle.dispose();
        throw new StaleSnapshot("The observed control is no longer available");
      }
      this.resolved.add(element);
      return element;
    } catch (error) {
      if (error instanceof StaleSnapshot) throw error;
      throw new StaleSnapshot("The observed control was detached or changed", {
        control_id: id,
      });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await Promise.allSettled(
      [...this.resolved, ...this.frames.map((frame) => frame.handle)].map(
        (handle) => handle.dispose(),
      ),
    );
    this.resolved.clear();
  }
}

/** Capture observed DOM references, including open shadow roots and child frames. */
export async function captureControls(page: Page): Promise<ControlSnapshot> {
  await page.waitForLoadState("domcontentloaded");
  const allFrames = page.frames();
  const frames: CapturedFrame[] = [];
  const visibleFrames = new Map<Frame, boolean>();
  const prefix = `snapshot${++sequence}`;
  try {
    const frameVisible = async (frame: Frame): Promise<boolean> => {
      if (visibleFrames.has(frame)) return visibleFrames.get(frame)!;
      const parent = frame.parentFrame();
      if (!parent) return true;
      if (!(await frameVisible(parent))) {
        visibleFrames.set(frame, false);
        return false;
      }
      const embedding = await frame.frameElement();
      try {
        const visible = await embedding.evaluate((node) => {
          const element = node as Element;
          const box = element.getBoundingClientRect();
          return Boolean(
            box.width &&
              box.height &&
              element.checkVisibility({
                checkOpacity: true,
                checkVisibilityCSS: true,
              }),
          );
        });
        visibleFrames.set(frame, visible);
        return visible;
      } finally {
        await embedding.dispose();
      }
    };
    for (const [index, frame] of allFrames.entries()) {
      if (!(await frameVisible(frame))) continue;
      // tsx decorates nested function names with __name. Keep this trusted static
      // browser function self-contained in both source and compiled execution.
      const script = `(() => { const __name = fn => fn;
        return (${retainDocument.toString()})(${JSON.stringify({ frame: index, prefix })}); })()`;
      const handle = await frame.evaluateHandle<RetainedFrame>(script);
      try {
        // Both readings follow the retained DOM capture. assertFresh below
        // rejects changes during this interval instead of mixing page states.
        const [captured, accessibility_tree] = await Promise.all([
          handle.evaluate(({ page, controls, signature }) => ({
            page,
            controls,
            signature,
          })),
          frame.locator("body").ariaSnapshot(),
        ]);
        const evidence = {
          ...captured,
          page: { ...captured.page, accessibility_tree },
        };
        frames.push({ frame, handle, evidence });
      } catch (error) {
        await handle.dispose().catch(() => {});
        throw error;
      }
    }
    const snapshot = new ControlSnapshot(page, frames, allFrames);
    await snapshot.assertFresh();
    return snapshot;
  } catch (error) {
    await Promise.allSettled(frames.map((frame) => frame.handle.dispose()));
    if (error instanceof Inconclusive) throw error;
    throw new StaleSnapshot(
      "The page changed while its controls were being captured",
      { cause: error instanceof Error ? error.message : String(error) },
    );
  }
}
