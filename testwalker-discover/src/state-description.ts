import type { Json } from "./types.js";

const text = (value: unknown) =>
  String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
const quote = (value: unknown) => JSON.stringify(text(value));

/** Describe visible state, never editable examples or inferred business outcomes. */
function features(page: Json): Map<string, string> {
  const result = new Map<string, string>();
  const facts = [...(page.displayed_values ?? [])];
  // Older captures and ordinary prose also expose short labelled read-only facts.
  for (const line of (page.text ?? "").split("\n")) {
    const match = /^([^:]{2,80}):\s*(\S.{0,220})$/.exec(line.trim());
    if (match) facts.push({ label: match[1], value: match[2] });
  }
  for (const fact of facts)
    if (text(fact.label) && text(fact.value))
      result.set(
        `display:${text(fact.label)}`,
        `Displayed ${text(fact.label)}: ${text(fact.value)}.`,
      );
  const options = (page.buttons ?? [])
    .filter(
      (button: Json) => button.role === "option" && button.visible !== false,
    )
    .map((button: Json) => text(button.label));
  result.set(
    "selection-popup",
    options.length
      ? `A selection list is currently open with visible options: ${options.map(quote).join(", ")}.`
      : "No selection-list options are currently visible.",
  );
  for (const select of page.selects ?? []) {
    const choices = select.options
      .filter((option: Json) => select.values.includes(option.value))
      .map((option: Json) => text(option.label));
    result.set(
      `selection:${text(select.label)}`,
      `The ${text(select.label)} selection is ${choices.map(quote).join(", ") || "empty"}.`,
    );
  }
  result.set(
    "feedback",
    page.alerts?.length
      ? `Current feedback: ${page.alerts.map(quote).join("; ")}.`
      : "No validation or status feedback is currently displayed.",
  );
  result.set(
    "headings",
    `Visible headings: ${(page.headings ?? []).map(quote).join(", ")}.`,
  );
  result.set(
    "controls",
    `Visible controls: ${(page.buttons ?? []).map((button: Json) => quote(button.label) + (button.disabled ? " (disabled)" : "")).join(", ") || "none"}.`,
  );
  const url = new URL(page.url);
  result.set(
    "route",
    `The browser route is ${quote(url.pathname + url.search + url.hash)}.`,
  );
  return result;
}

/** Select a small set of observed distinctions between same-heading variants. */
export function stateDescriptions(
  pages: Record<string, Json>,
  labelFor: (page: Json) => string,
): Record<string, string[]> {
  const groups = new Map<string, Array<[string, Json]>>();
  for (const entry of Object.entries(pages)) {
    const label = labelFor(entry[1]);
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(entry);
  }
  const output: Record<string, string[]> = {};
  for (const entries of groups.values()) {
    const profiles = entries.map(([, page]) => features(page));
    const candidates = [
      ...new Set(profiles.flatMap((profile) => [...profile.keys()])),
    ];
    const pairs: Array<[number, number]> = [];
    for (let a = 0; a < entries.length; a++)
      for (let b = a + 1; b < entries.length; b++) pairs.push([a, b]);
    let pending = pairs;
    const chosen: string[] = [];
    while (pending.length && chosen.length < 8) {
      let best: string | undefined,
        score = 0;
      for (const key of candidates.filter((key) => !chosen.includes(key))) {
        // A missing labelled value cannot be asserted reliably from prose alone.
        if (profiles.some((profile) => !profile.has(key))) continue;
        const count = pending.filter(
          ([a, b]) => profiles[a].get(key) !== profiles[b].get(key),
        ).length;
        if (count > score) {
          best = key;
          score = count;
        }
      }
      if (!best) break;
      chosen.push(best);
      pending = pending.filter(
        ([a, b]) => profiles[a].get(best!) === profiles[b].get(best!),
      );
    }
    entries.forEach(([id], index) => {
      output[id] = chosen.map((key) => profiles[index].get(key)!);
    });
  }
  return output;
}
