/** Static assets deliberately use no remote libraries or resources. */
export const BODY = String.raw`
<header><div class="brand"><span class="mark">↗</span><div><strong>testwalker <span>discover</span></strong><small>Observed journeys · model draft</small></div></div><nav id="downloads"></nav></header>
<main>
  <div class="heading"><div><p class="eyebrow">EXPLORATION REPORT</p><h1>See what discovery found.</h1><p id="sources" class="muted"></p></div><span class="pill" id="outcome"></span></div>
  <div id="stats" class="stats"></div>
  <section class="panel graph-panel"><div class="section-heading"><div><h2>Navigation graph</h2><p class="muted">Select a page or journey to inspect its evidence.</p></div><div class="tools"><label>View <select id="graph-mode"><option value="pages">Pages</option><option value="states">Observed states</option></select></label><button id="zoom-out" aria-label="Zoom out">−</button><button id="zoom-in" aria-label="Zoom in">+</button><button id="fit">Fit</button></div></div><div id="graph" tabindex="0" aria-label="Interactive navigation graph"><svg id="graph-svg" role="img" aria-label="Observed navigation"></svg></div><p class="graph-note muted" id="graph-note"></p></section>
  <section class="panel explorer"><div class="section-heading"><h2>Explore the evidence</h2><button id="clear-filter" hidden>Clear graph filter</button></div><div id="tabs" class="tabs" role="tablist" aria-label="Evidence category"></div><div class="search"><input id="search" type="search" aria-label="Search evidence" placeholder="Search states, actions, URLs or reasons"><span id="list-count" class="muted"></span></div><div class="explorer-body"><div id="list" role="tabpanel"></div><article id="detail"><p class="empty">Select an item to inspect its journey and evidence.</p></article></div></section>
  <section class="panel"><div class="section-heading"><h2>Run limits and review notes</h2></div><div id="runs" class="run-grid"></div><details class="review"><summary>Review the observed draft</summary><ul id="review"></ul></details></section>
  <footer>Discovery records observed behaviour. Add independent business rules before running tests.</footer>
</main>`;

export const STYLE = String.raw`
:root {
  color-scheme: light;
  --ink: #152d33;
  --muted: #637678;
  --line: #dce5e3;
  --accent: #077a68;
  --soft: #eaf6f1;
  --amber: #936318;
  --bad: #ad403a;
}
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  background: #f4f7f5;
  color: var(--ink);
  font:
    14px/1.5 -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    sans-serif;
}
header {
  background: #142e34;
  color: white;
  padding: 22px 4vw;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 20px;
}
.brand {
  display: flex;
  align-items: center;
  gap: 14px;
}
.brand strong {
  font-size: 22px;
  letter-spacing: -0.7px;
}
.brand strong span {
  font-weight: 400;
  color: #8ddfbc;
}
.brand small {
  display: block;
  color: #acbfbe;
  font-size: 12px;
}
.mark {
  display: grid;
  place-items: center;
  background: #a5edc9;
  color: #123e34;
  border-radius: 12px;
  width: 42px;
  height: 42px;
  font-size: 28px;
}
nav {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
}
nav a {
  color: #dcefea;
  text-decoration: none;
  border: 1px solid #4a6567;
  border-radius: 7px;
  padding: 7px 12px;
}
main {
  max-width: 1480px;
  padding: 30px 4vw;
  margin: auto;
}
h1 {
  font-size: 34px;
  line-height: 1.2;
  letter-spacing: -1px;
  margin: 7px 0 10px;
}
h2 {
  font-size: 18px;
  margin: 0;
}
h3 {
  font-size: 16px;
  margin: 18px 0 8px;
}
p {
  margin: 6px 0;
}
.eyebrow {
  font-size: 11px;
  letter-spacing: 2px;
  color: var(--accent);
  font-weight: 700;
}
.heading,
.section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 15px;
}
.heading {
  margin-bottom: 25px;
}
.muted {
  color: var(--muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.pill {
  white-space: nowrap;
  background: var(--soft);
  color: var(--accent);
  padding: 7px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
}
.pill.warn {
  background: #fff2d9;
  color: var(--amber);
}
.stats {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 12px;
  margin-bottom: 22px;
}
.stat {
  background: white;
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 17px 20px;
}
.stat b {
  display: block;
  font-size: 29px;
  letter-spacing: -1px;
}
.stat span {
  color: var(--muted);
  font-size: 12px;
}
.stat.warning b {
  color: var(--amber);
}
.stat.error b {
  color: var(--bad);
}
.panel {
  border: 1px solid var(--line);
  border-radius: 13px;
  background: white;
  overflow: hidden;
  margin-bottom: 22px;
}
.section-heading {
  padding: 18px 22px;
  border-bottom: 1px solid var(--line);
}
.tools {
  display: flex;
  align-items: center;
  gap: 7px;
}
button,
select,
input {
  font: inherit;
}
button,
select {
  border: 1px solid var(--line);
  background: white;
  color: var(--ink);
  border-radius: 6px;
  padding: 6px 11px;
  cursor: pointer;
}
button:hover,
button:focus-visible {
  border-color: var(--accent);
  background: var(--soft);
}
label {
  color: var(--muted);
  font-size: 12px;
}
select {
  margin-left: 5px;
}
a {
  color: var(--accent);
}
#graph {
  height: 410px;
  overflow: auto;
  background: linear-gradient(#fafcfb, #f1f6f3);
  cursor: grab;
}
#graph-svg {
  display: block;
  min-width: 100%;
  min-height: 100%;
}
.graph-note {
  padding: 0 22px 10px;
}
.node rect {
  fill: white;
  stroke: #bacdca;
  stroke-width: 1.5;
  rx: 10;
}
.node:hover rect,
.node.selected rect {
  fill: #e4f5ec;
  stroke: var(--accent);
  stroke-width: 2.5;
}
.node text {
  fill: var(--ink);
  font-size: 13px;
  pointer-events: none;
}
.node .sub {
  fill: var(--muted);
  font-size: 10px;
}
.node {
  cursor: pointer;
}
.edge {
  fill: none;
  stroke: #b7cac6;
  stroke-width: 1.7;
  cursor: pointer;
  pointer-events: stroke;
}
.edge:hover,
.edge.selected {
  stroke: var(--accent);
  stroke-width: 3;
}
.tabs {
  display: flex;
  border-bottom: 1px solid var(--line);
  padding: 0 20px;
  gap: 20px;
  overflow: auto;
}
.tabs button {
  border: 0;
  border-radius: 0;
  padding: 14px 0;
  background: none;
  white-space: nowrap;
  border-bottom: 3px solid transparent;
  color: var(--muted);
}
.tabs button[aria-selected="true"] {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 650;
}
.search {
  display: flex;
  gap: 15px;
  align-items: center;
  padding: 13px 20px;
  border-bottom: 1px solid var(--line);
}
input {
  width: 100%;
  max-width: 550px;
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 9px 12px;
  background: #f9fbfa;
}
.explorer-body {
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr);
  min-height: 430px;
}
#list {
  border-right: 1px solid var(--line);
  max-height: 750px;
  overflow: auto;
  padding: 8px;
}
#list button {
  display: block;
  text-align: left;
  width: 100%;
  border: 0;
  border-radius: 7px;
  padding: 11px;
  margin-bottom: 3px;
  overflow-wrap: anywhere;
}
#list button.active {
  background: var(--soft);
  box-shadow: inset 3px 0 var(--accent);
}
.list-title {
  font-weight: 600;
}
.list-sub {
  font-size: 11px;
  color: var(--muted);
  margin-top: 4px;
}
.badge {
  font-size: 10px;
  background: #edf2f0;
  border-radius: 4px;
  padding: 2px 5px;
  margin-left: 6px;
}
.badge.error {
  background: #ffebe7;
  color: var(--bad);
}
.badge.warn {
  background: #fff2d9;
  color: var(--amber);
}
#detail {
  padding: 22px;
  min-width: 0;
  overflow-wrap: anywhere;
}
#detail h2 {
  font-size: 21px;
  line-height: 1.3;
}
#detail ul {
  padding-left: 20px;
}
.empty {
  padding: 25px;
  color: var(--muted);
}
.screenshot {
  display: block;
  width: 100%;
  max-height: 620px;
  object-fit: contain;
  object-position: top;
  background: #f8faf9;
  border: 1px solid var(--line);
  border-radius: 8px;
  margin: 12px 0;
}
.links {
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
  margin: 10px 0;
}
.notice {
  background: #fff5e6;
  padding: 10px 14px;
  border-radius: 7px;
  border-left: 3px solid #d2a74d;
  margin: 12px 0;
}
.notice.error {
  background: #fff0ec;
  border-color: #c75b4c;
}
.steps {
  padding-left: 22px;
}
.steps li {
  margin: 7px 0;
}
.json {
  font:
    12px/1.6 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  background: #f3f6f4;
  border: 1px solid var(--line);
  border-radius: 6px;
  padding: 12px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 350px;
  overflow: auto;
}
details {
  margin: 9px 0;
}
summary {
  cursor: pointer;
  font-weight: 600;
  overflow-wrap: anywhere;
}
.request {
  border: 1px solid var(--line);
  border-radius: 7px;
  padding: 10px 12px;
}
.run-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(270px, 1fr));
  gap: 18px;
  padding: 20px 22px;
}
.run {
  background: #f7faf8;
  border: 1px solid var(--line);
  border-radius: 9px;
  padding: 15px;
}
.run h3 {
  margin-top: 0;
}
.run dt {
  float: left;
  color: var(--muted);
}
.run dd {
  text-align: right;
  margin-bottom: 5px;
}
.review {
  padding: 0 22px 15px;
}
.review li {
  margin: 8px 0;
}
footer {
  color: var(--muted);
  font-size: 12px;
  margin: 22px 0;
}
#detail .visit-choice {
  margin: 4px 4px 4px 0;
}
.error-text {
  color: var(--bad);
}
@media (max-width: 850px) {
  .stats {
    grid-template-columns: repeat(3, 1fr);
  }
  .explorer-body {
    grid-template-columns: 240px minmax(0, 1fr);
  }
  h1 {
    font-size: 28px;
  }
  .heading {
    align-items: flex-start;
  }
  .section-heading {
    flex-wrap: wrap;
  }
}
@media (max-width: 600px) {
  main {
    padding: 20px 12px;
  }
  header {
    padding: 18px 14px;
    flex-wrap: wrap;
  }
  .explorer-body {
    grid-template-columns: 1fr;
  }
  #list {
    max-height: 260px;
    border-right: 0;
    border-bottom: 1px solid var(--line);
  }
  .stats {
    gap: 7px;
  }
  .stat {
    padding: 12px;
  }
  .stat b {
    font-size: 24px;
  }
  .heading {
    display: block;
  }
  .heading .pill {
    display: inline-block;
    margin-top: 8px;
  }
  .tabs {
    gap: 14px;
  }
  .tools {
    flex-wrap: wrap;
  }
  #graph {
    height: 330px;
  }
}
`;

export const SCRIPT = String.raw`
"use strict";
const data = JSON.parse(document.getElementById("report-data").textContent);
const byId = new Map(data.nodes.map((n) => [n.id, n]));
const visitsById = new Map(data.visits.map((v) => [v.key, v]));
const pending = data.actions.filter((a) =>
  ["queued", "running", "deferred"].includes(a.status),
);
const $ = (id) => document.getElementById(id);
const el = (tag, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = String(text);
  if (cls) e.className = cls;
  return e;
};
const link = (text, url) => {
  const a = el("a", text);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener";
  return a;
};
const button = (text, fn) => {
  const b = el("button", text);
  b.type = "button";
  b.onclick = fn;
  return b;
};
const json = (title, value, parent) => {
  if (value === undefined) return;
  const d = el("details");
  d.append(
    el("summary", title),
    el("pre", JSON.stringify(value, null, 2), "json"),
  );
  parent.append(d);
};
const nodeName = (id) => byId.get(id)?.name || id || "Seed";
const shortName = (n) => (n?.title || n?.name || "").replace(/^Page \d+: /, "");
$("sources").textContent = data.seeds.join(" · ");
const bounded =
  data.runs.some((r) => r.stop !== "Queue exhausted") || pending.length > 0;
$("outcome").textContent = bounded
  ? "Bounded discovery · review required"
  : "Discovery complete · review required";
if (bounded) $("outcome").classList.add("warn");
if (data.model) $("downloads").append(link("GraphWalker model (.model.json)", data.model));
for (const [i, run] of data.runs.entries())
  $("downloads").append(link("Inventory " + (i + 1), run.inventory));
for (const [title, count, cls] of [
  ["Observed states", data.nodes.length],
  ["Journeys", data.edges.length],
  ["Visits", data.visits.length],
  ["Discovery issues", data.issues.length, "error"],
  ["Deferred actions", pending.length, "warning"],
  [
    "JSON exchanges",
    data.visits.reduce((n, v) => n + (v.network.count || 0), 0),
  ],
]) {
  const card = el("div", undefined, "stat " + (count ? cls || "" : ""));
  card.append(el("b", count.toLocaleString()), el("span", title));
  $("stats").append(card);
}
for (const run of data.runs) {
  const card = el("div", undefined, "run");
  card.append(el("h3", run.name), el("p", run.stop, "muted"));
  const dl = el("dl");
  for (const [k, v] of Object.entries({
    States: run.states,
    Transitions: run.transitions,
    Visits: run.visits,
    "Replay operations": run.operations,
    "Deferred actions": run.pending,
  })) {
    dl.append(el("dt", k), el("dd", v));
  }
  card.append(dl);
  json("Configured limits", run.limits, card);
  json("Deferred reasons", run.pending_reasons, card);
  card.append(link("Open full inventory", run.inventory));
  $("runs").append(card);
}
for (const note of data.review) $("review").append(el("li", note));
let tab = "states",
  selectedKey = "",
  scope = null,
  graphMode = "pages",
  zoom = 1,
  graphNodes = [],
  graphEdges = [],
  graphWidth = 1200,
  graphHeight = 600;
const categories = [
  ["states", "States", data.nodes],
  ["journeys", "Journeys", data.edges],
  ["visits", "Visits", data.visits],
  ["deferred", "Deferred", pending],
  ["issues", "Issues", data.issues],
];
const items = () => categories.find((c) => c[0] === tab)[2];
const itemKey = (item) => item.key || item.id;
const titleFor = (item) =>
  tab === "states"
    ? item.name
    : tab === "visits"
      ? item.id + " · " + (item.intent || "Inspect page")
      : item.intent || item.error || item.reason || item.type;
const hintFor = (item) =>
  tab === "states"
    ? item.url
    : tab === "journeys"
      ? shortName(byId.get(item.source)) +
        " → " +
        shortName(byId.get(item.target))
      : item.reason || item.url || item.error || item.type;
function setTab(value) {
  tab = value;
  selectedKey = "";
  renderTabs();
  renderList();
}
function renderTabs() {
  $("tabs").replaceChildren();
  for (const [id, label, list] of categories) {
    const b = button(label + " " + list.length, () => setTab(id));
    b.setAttribute("role", "tab");
    b.setAttribute("aria-selected", String(id === tab));
    $("tabs").append(b);
  }
}
function matchesScope(item) {
  if (!scope) return true;
  if (scope.edges)
    return tab === "journeys"
      ? scope.edges.includes(item.id)
      : tab === "visits"
        ? scope.visits.includes(item.key)
        : scope.nodes.includes(item.id || item.source || item.state);
  const ids = scope.nodes;
  return tab === "states"
    ? ids.includes(item.id)
    : tab === "journeys"
      ? ids.includes(item.source) || ids.includes(item.target)
      : ids.includes(item.state) || ids.includes(item.source);
}
function renderList() {
  const q = $("search").value.toLowerCase();
  const list = items().filter(
    (item) =>
      matchesScope(item) && JSON.stringify(item).toLowerCase().includes(q),
  );
  $("list").replaceChildren();
  $("list-count").textContent = list.length + " items";
  for (const item of list) {
    const b = button("", () => select(item));
    b.dataset.key = itemKey(item);
    b.classList.toggle("active", selectedKey === itemKey(item));
    b.append(
      el("div", titleFor(item), "list-title"),
      el("div", hintFor(item), "list-sub"),
    );
    if (item.status || item.type)
      b.append(
        el(
          "span",
          item.status || item.type,
          "badge " +
            (tab === "issues" ? "error" : tab === "deferred" ? "warn" : ""),
        ),
      );
    $("list").append(b);
  }
  if (!list.length) $("list").append(el("p", "No matching evidence.", "empty"));
}
function showVisit(visit, parent) {
  if (!visit) return;
  const group = el("div");
  group.append(
    el("h3", visit.id + " · Run " + (visit.run + 1)),
    el("p", visit.intent || "Inspect seed URL"),
    el("p", visit.url, "muted"),
  );
  if (visit.error) group.append(el("p", visit.error, "notice error"));
  if (visit.deferred)
    group.append(el("p", visit.deferred.reason || "Deferred", "notice"));
  if (visit.screenshot) {
    const img = el("img", undefined, "screenshot");
    img.src = visit.screenshot;
    img.alt = "Screenshot after " + (visit.intent || "inspecting seed URL");
    img.loading = "lazy";
    group.append(img, link("Open screenshot", visit.screenshot));
  } else
    group.append(el("p", "No screenshot captured for this visit.", "muted"));
  if (visit.steps?.length) {
    const d = el("details");
    d.append(
      el("summary", "Replayed route · " + visit.steps.length + " actions"),
    );
    const ol = el("ol", undefined, "steps");
    for (const step of visit.steps) {
      const li = el("li", step.intent || step.label || step.kind || "Action");
      json("Action details", step, li);
      ol.append(li);
    }
    d.append(ol);
    group.append(d);
  }
  json("Settling diagnostics", visit.diagnostic, group);
  if (visit.capture_errors.length)
    json("Capture errors", visit.capture_errors, group);
  const network = visit.network;
  group.append(el("h3", "JSON network evidence"));
  if (!network.available)
    group.append(
      el("p", "Network capture was disabled or unavailable.", "muted"),
    );
  else {
    group.append(link("Open full network JSON", network.href));
    if (network.count !== undefined)
      group.append(
        el(
          "p",
          network.count +
            " JSON exchanges · " +
            (network.omitted || 0) +
            " omitted by capture limit",
          "muted",
        ),
      );
    if (network.note) group.append(el("p", network.note, "notice"));
    for (const entry of network.requests || []) {
      const d = el("details", undefined, "request");
      d.append(
        el(
          "summary",
          entry.method +
            " " +
            entry.url +
            " · " +
            (entry.response?.status || entry.status),
        ),
      );
      if (entry.request_body?.status === "no_body")
        d.append(el("p", "Request has no body.", "muted"));
      else if (entry.request_body?.status === "not_json")
        d.append(el("p", "Request body omitted: " + (entry.request_content_type || "no JSON Content-Type") + ".", "muted"));
      else json("Request body", entry.request_body, d);
      json("Response", entry.response, d);
      json(
        "Timing / failure",
        { timing: entry.timing, failure: entry.failure },
        d,
      );
      group.append(d);
    }
  }
  parent.append(group);
}
function visitChoices(keys, parent) {
  const relevant = keys.map((key) => visitsById.get(key)).filter(Boolean);
  if (!relevant.length) {
    parent.append(
      el("p", "No executed visit evidence for this item.", "muted"),
    );
    return;
  }
  const controls = el("div", undefined, "links");
  const target = el("div");
  for (const visit of relevant) {
    const b = button("Run " + (visit.run + 1) + " / " + visit.id, () => {
      target.replaceChildren();
      showVisit(visit, target);
    });
    b.className = "visit-choice";
    controls.append(b);
  }
  parent.append(controls, target);
  showVisit(relevant[0], target);
}
function select(item) {
  selectedKey = itemKey(item);
  renderList();
  const detail = $("detail");
  detail.replaceChildren(el("h2", titleFor(item)));
  if (tab === "states") {
    detail.append(el("p", item.url, "muted"));
    if (item.alerts.length)
      detail.append(el("p", item.alerts.join(" · "), "notice"));
    const rules = el("ul");
    for (const rule of item.rules) rules.append(el("li", rule));
    detail.append(rules);
    json("Observed form fields", item.forms, detail);
    detail.append(el("h3", "Visit evidence"));
    visitChoices(
      data.visits.filter((v) => v.state === item.id).map((v) => v.key),
      detail,
    );
    scopeHighlight([item.id]);
  } else if (tab === "journeys") {
    detail.append(
      el("p", nodeName(item.source) + " → " + nodeName(item.target), "muted"),
    );
    visitChoices(item.visits, detail);
    scopeHighlight([item.source, item.target]);
  } else if (tab === "visits") showVisit(item, detail);
  else {
    detail.append(
      el(
        "p",
        item.reason || item.error || item.type,
        "notice " + (tab === "issues" ? "error" : ""),
      ),
    );
    if (item.source)
      detail.append(el("p", "Source: " + nodeName(item.source), "muted"));
    json("Action / diagnostics", item, detail);
    if (item.visit) showVisit(visitsById.get(item.visit), detail);
  }
}
function scopeHighlight(ids) {
  for (const g of $("graph-svg").querySelectorAll(".node"))
    g.classList.toggle(
      "selected",
      g._node.ids.some((id) => ids.includes(id)),
    );
}
const ns = "http://www.w3.org/2000/svg";
const svgEl = (tag, attrs = {}) => {
  const e = document.createElementNS(ns, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
};
function renderGraph() {
  const groups = new Map();
  for (const node of data.nodes) {
    const key = graphMode === "pages" ? node.url : node.id;
    if (!groups.has(key))
      groups.set(key, { key, ids: [], label: shortName(node), url: node.url });
    groups.get(key).ids.push(node.id);
  }
  graphNodes = [...groups.values()];
  const membership = new Map(
    graphNodes.flatMap((n) => n.ids.map((id) => [id, n.key])),
  );
  const pairs = new Map();
  for (const edge of data.edges) {
    const a = membership.get(edge.source),
      b = membership.get(edge.target);
    if (!a || !b) continue;
    const key = JSON.stringify([a, b]);
    if (!pairs.has(key)) pairs.set(key, { source: a, target: b, edges: [] });
    pairs.get(key).edges.push(edge);
  }
  graphEdges = [...pairs.values()];
  const level = new Map();
  const start = membership.get(data.entry);
  if (start) level.set(start, 0);
  const queue = start ? [start] : [];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graphEdges.filter((e) => e.source === id)) {
      if (!level.has(edge.target)) {
        level.set(edge.target, level.get(id) + 1);
        queue.push(edge.target);
      }
    }
  }
  for (const n of graphNodes)
    if (!level.has(n.key)) level.set(n.key, Math.max(0, ...level.values()) + 1);
  const maxLevel = Math.max(0, ...level.values());
  const columns = Array.from({ length: maxLevel + 1 }, () => []);
  for (const n of graphNodes) columns[level.get(n.key)].push(n);
  graphWidth = Math.max(1000, columns.length * 240);
  graphHeight = Math.max(430, ...columns.map((c) => c.length * 100 + 80));
  for (const [column, rows] of columns.entries())
    for (const [row, node] of rows.entries()) {
      node.x = 60 + column * 240;
      node.y = 40 + row * ((graphHeight - 80) / Math.max(rows.length, 1));
    }
  const positions = new Map(graphNodes.map((n) => [n.key, n]));
  const svg = $("graph-svg");
  svg.replaceChildren();
  svg.setAttribute("viewBox", "0 0 " + graphWidth + " " + graphHeight);
  const defs = svgEl("defs");
  const marker = svgEl("marker", {
    id: "arrow",
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 5,
    markerHeight: 5,
    orient: "auto-start-reverse",
  });
  marker.append(svgEl("path", { d: "M 0 0 L 10 5 L 0 10 z", fill: "#8daaa1" }));
  defs.append(marker);
  svg.append(defs);
  for (const edge of graphEdges) {
    const a = positions.get(edge.source),
      b = positions.get(edge.target);
    const same = a === b;
    const x1 = a.x + 175,
      y1 = a.y + 25,
      x2 = b.x,
      y2 = b.y + 25;
    const d = same
      ? "M " +
        (a.x + 30) +
        " " +
        a.y +
        " C " +
        a.x +
        " " +
        (a.y - 40) +
        " " +
        (a.x + 150) +
        " " +
        (a.y - 40) +
        " " +
        (a.x + 130) +
        " " +
        a.y
      : "M " +
        x1 +
        " " +
        y1 +
        " C " +
        (x1 + 60) +
        " " +
        y1 +
        " " +
        (x2 - 60) +
        " " +
        y2 +
        " " +
        x2 +
        " " +
        y2;
    const p = svgEl("path", {
      d,
      class: "edge",
      "marker-end": "url(#arrow)",
      tabindex: 0,
      role: "button",
      "aria-label":
        a.label + " to " + b.label + " · " + edge.edges.length + " journeys",
    });
    const title = svgEl("title");
    title.textContent =
      edge.edges.length + " observed journeys: " + a.label + " → " + b.label;
    p.append(title);
    const choose = () => {
      scope = {
        nodes: [...a.ids, ...b.ids],
        edges: edge.edges.map((e) => e.id),
        visits: [...new Set(edge.edges.flatMap((e) => e.visits))],
      };
      $("clear-filter").hidden = false;
      setTab("journeys");
      select(edge.edges[0]);
    };
    p.onclick = choose;
    p.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    };
    svg.append(p);
  }
  for (const node of graphNodes) {
    const g = svgEl("g", {
      class: "node",
      transform: "translate(" + node.x + "," + node.y + ")",
      tabindex: 0,
      role: "button",
      "aria-label": node.label,
    });
    g._node = node;
    g.append(svgEl("rect", { width: 175, height: 57 }));
    const title = svgEl("title");
    title.textContent = node.label + " · " + node.ids.length + " states";
    const text = svgEl("text", { x: 12, y: 22 });
    text.textContent =
      node.label.length > 23 ? node.label.slice(0, 22) + "…" : node.label;
    const sub = svgEl("text", { x: 12, y: 42, class: "sub" });
    sub.textContent =
      graphMode === "pages"
        ? node.ids.length +
          " observed state" +
          (node.ids.length === 1 ? "" : "s")
        : node.ids[0].slice(0, 21);
    g.append(title, text, sub);
    const choose = () => {
      scope = { nodes: node.ids };
      $("clear-filter").hidden = false;
      setTab("states");
      select(byId.get(node.ids[0]));
    };
    g.onclick = choose;
    g.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        choose();
      }
    };
    svg.append(g);
  }
  $("graph-note").textContent =
    graphNodes.length +
    " " +
    (graphMode === "pages" ? "URL groups" : "observed states") +
    " · " +
    data.edges.length +
    " executed journeys. Page groups combine observed variants; they do not assert business equivalence.";
  applyZoom();
}
function applyZoom() {
  const frame = $("graph");
  const fit = Math.min(frame.clientWidth, frame.clientHeight * graphWidth / graphHeight);
  const size = fit * zoom;
  $("graph-svg").style.minWidth = "0";
  $("graph-svg").style.minHeight = "0";
  $("graph-svg").style.margin = "auto";
  $("graph-svg").style.width = size + "px";
  $("graph-svg").style.height = (size * graphHeight) / graphWidth + "px";
}
$("graph-mode").onchange = (e) => {
  graphMode = e.target.value;
  zoom = 1;
  renderGraph();
};
$("zoom-in").onclick = () => {
  zoom = Math.min(8, zoom * 1.3);
  applyZoom();
};
$("zoom-out").onclick = () => {
  zoom = Math.max(0.5, zoom / 1.3);
  applyZoom();
};
$("fit").onclick = () => {
  zoom = 1;
  applyZoom();
  $("graph").scrollTo(0, 0);
};
$("clear-filter").onclick = () => {
  scope = null;
  $("clear-filter").hidden = true;
  renderList();
};
$("search").oninput = renderList;
window.addEventListener("resize", applyZoom);
renderTabs();
renderList();
renderGraph();
if (data.nodes.length) select(data.nodes[0]);
`;
