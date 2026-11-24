// The page: files and settings, the summary, the list of clusters, one cluster, the choices, the downloads.
// The engine runs in worker.js; this file only shows what it returns and passes on what the expert chooses.
import { drawTree } from "./treeview.js?v=1662ad1";

const $ = (id) => document.getElementById(id);
const worker = new Worker("worker.js?v=1662ad1", { type: "module" });
let nextId = 1; const waiting = new Map();
worker.onmessage = (e) => {
  if (e.data.progress) { status(e.data.progress); return; }
  const w = waiting.get(e.data.id); waiting.delete(e.data.id);
  if (e.data.ok) w.resolve(e.data.result); else w.reject(new Error(e.data.error));
};
const ask = (type, args = {}) => new Promise((resolve, reject) => { const id = nextId++; waiting.set(id, { resolve, reject }); worker.postMessage({ id, type, ...args }); });

let statusTarget = $("files-status");
const status = (text) => { statusTarget.textContent = text; };
const showError = (text) => { $("error").textContent = text; $("error").hidden = !text; };

// ---- state
const state = {
  files: { tree: null, names: null, fasta: null, keep: null },     // File objects, or { name, text } for the example
  shown: {},                                            // tip label -> label by name, where names are shown
  loaded: null,                                         // what the worker read: tips, header
  rows: [], report: "", selected: null, cluster: null,
  choices: [],                                          // { choice, tip, tip2, note }
  lastK: 0, splitsAtLastRun: 0, lastReps: null, lastOptions: null,
};

// ---- the files
async function readFiles(files) {
  showError(""); statusTarget = $("files-status");
  if (!files.tree) { showError("Choose a tree file first."); return; }
  const source = (f) => (f ? (typeof f.text === "string" ? f.text : f) : null);      // the example's texts, or File objects
  try {
    const t0 = performance.now();
    state.loaded = await ask("load", { tree: source(files.tree), names: source(files.names), fasta: source(files.fasta), keep: source(files.keep) });
    state.files = files;
    status(`${state.loaded.tips.toLocaleString()} tips read in ${((performance.now() - t0) / 1000).toFixed(1)} s` +
           (files.names ? "; names table read" : "") + (files.fasta ? "; alignment read" : ""));
    setUpSettings();
  } catch (e) { showError(e.message); status(""); }
}

function setUpSettings() {
  $("settings").hidden = false; const header = state.loaded.header;
  for (const el of document.querySelectorAll(".names-only")) el.hidden = !header;
  if (header) {
    const options = (sel, extra) => { sel.innerHTML = extra; header.forEach((h, i) => { if (i === 0) return; const o = document.createElement("option"); o.value = h; o.textContent = h; sel.appendChild(o); }); };
    options($("name-column"), ""); options($("keep-taxa"), '<option value="">none</option>'); options($("flag-ranks"), ""); options($("label-columns"), "");
    for (const o of $("label-columns").options) if (["family", "species"].includes(o.value.toLowerCase())) o.selected = true;
    const pick = (sel, wanted) => { const o = [...sel.options].find((x) => wanted.includes(x.value.toLowerCase())); if (o) o.selected = true; };
    pick($("name-column"), ["species"]); for (const o of $("flag-ranks").options) if (["species", "genus", "family"].includes(o.value.toLowerCase())) o.selected = true;
  }
  $("mito-count").textContent = state.loaded.mitogenomes ? `(${state.loaded.mitogenomes.toLocaleString()} tips look like mitogenomes)` : "(no tip looks like a mitogenome)";
}

// R rounds a half to the even number, as the command does
const roundEven = (x) => { const f = Math.floor(x), d = x - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };
const name = (f) => (f ? f.name : null);

function options(k) {
  const o = [];
  if (k) o.push(["--k", String(k)]);
  else if ($("size-kind").value === "share") o.push(["--retention", $("size-value").value + "%"]);
  else o.push(["--k", $("size-value").value]);
  if (state.files.names) {
    o.push(["--names", name(state.files.names)], ["--name-column", $("name-column").value]);
    if ($("keep-taxa").value) o.push(["--keep-taxa", $("keep-taxa").value]);
    const ranks = [...$("flag-ranks").selectedOptions].map((x) => x.value); if (ranks.length) o.push(["--flag-ranks", ranks.join(",")]);
  }
  if (state.files.fasta) o.push(["--fasta", name(state.files.fasta)]);
  if (state.files.keep) o.push(["--keep", name(state.files.keep)]);
  if (state.files.names && $("label-mode").value !== "off" && labelSpec()) o.push(["--label-columns", labelSpec()]);
  if ($("rate").value !== "on") o.push(["--rate-correction", $("rate").value]);
  if ($("mito").checked) o.push(["--prioritize-mitogenomes", ""]);
  if ($("age-limit").value) o.push(["--age-limit", $("age-limit").value]);
  if (state.choices.length) o.push(["--choices", "choices.tsv"]);
  o.push(["--flags", ""]);
  return o;
}
const splits = () => state.choices.filter((c) => c.choice === "separate").length;
// names shown for tips: the columns chosen, and whether the ID follows
const labelSpec = () => [...$("label-columns").selectedOptions].map((x) => x.value).join(",");
const nameOf = (id) => state.shown[id] || id;
async function updateLabels() {
  state.shown = {};
  if (state.files.names && $("label-mode").value !== "off" && labelSpec()) {
    const tipColumn = null;
    try { state.shown = await ask("labels", { spec: labelSpec(), keepId: $("label-mode").value === "with-id", tipColumn }); } catch (e) { showError(e.message); } }
  if (state.rows.length) { drawRows(); if (state.selected) openCluster(state.selected.index); }
}

let version = "";              // the version of the page, where it was bundled with one (version.txt)
fetch("version.txt").then((r) => (r.ok ? r.text() : "")).then((t) => { version = t.trim(); if (version) $("version").textContent = "Page: " + version; }).catch(() => {});
function choicesText(command) {
  return ["# cladecut choices 1", ...(version ? ["# page: " + version] : []), "# command: " + command, "choice\ttip\ttip2\tnote",
          ...state.choices.map((c) => [c.choice, c.tip, c.tip2 || "", (c.note || "").replace(/[\t\n]/g, " ")].join("\t"))].join("\n") + "\n";
}
function commandLine(opts) {
  const q = (x) => (/^[\w.,%\/-]+$/.test(x) ? x : "'" + x.replace(/'/g, "'\\''") + "'");
  return ["cladecut", q(name(state.files.tree)), ...opts.flatMap(([k, v]) => (v === "" ? [k] : [k, q(v)])), "-o", "out"].join(" ");
}

// A run from the settings: K as the settings give it, one more for every split chosen. A run again: the K of the
// last run, one more for every split chosen since.
async function run(fromSettings) {
  showError(""); statusTarget = $("run-status");
  let k = 0;
  if (fromSettings) { if (splits()) { const v = +$("size-value").value; k = ($("size-kind").value === "share" ? Math.max(1, roundEven(v / 100 * state.loaded.tips)) : v) + splits(); } }
  else k = state.lastK + splits() - state.splitsAtLastRun;
  const opts = options(k), command = commandLine(opts);
  for (const b of document.querySelectorAll("button")) b.disabled = true;
  try {
    const t0 = performance.now();
    const res = await ask("run", { options: opts, choices: state.choices.length ? choicesText(command) : "" });
    const before = state.lastReps, beforeK = state.lastK;
    state.rows = res.rows; state.report = res.report; state.lastK = res.rows.length; state.splitsAtLastRun = splits(); state.lastOptions = opts;
    state.lastReps = new Set(res.rows.map((r) => r.rep));
    statusTarget.dataset.done = `done in ${((performance.now() - t0) / 1000).toFixed(1)} s`; status(statusTarget.dataset.done);
    $("result").hidden = false; $("report").textContent = res.report.trimEnd(); showSummary(res.summary, res.rows);
    if (before && !fromSettings) {
      const moved = [...state.lastReps].filter((r) => !before.has(r)).length;
      $("changed").textContent = `What changed: ${beforeK.toLocaleString()} → ${state.lastK.toLocaleString()} representatives; ` +
        (moved === 1 ? "1 representative is new" : `${moved.toLocaleString()} representatives are new`) + ", the others stay.";
      $("changed").hidden = false;
    } else $("changed").hidden = true;
    await updateLabels(); showCounts(); showList(); showChoices(); showDownloads(command);
    // show the cluster of the last choice, or else the cluster that holds the representative shown before
    const last = state.choices[state.choices.length - 1], tip = !fromSettings && last ? last.tip : state.selected && state.selected.rep;
    if (tip) { const i = await ask("where", { tip }); if (i > 0) openCluster(i); else $("cluster").hidden = true; }
  } catch (e) { showError("The run could not be done, and the previous result is kept: " + e.message); status(""); }
  for (const b of document.querySelectorAll("button")) b.disabled = false;
}

// ---- the results: plain tables and numbered figures
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text !== undefined) e.textContent = text; return e; };
const pct = (x) => (x === 0 || x === 100 ? x.toFixed(0) : x.toFixed(1)) + "%";
const sig = (x) => (+x).toPrecision(3);
function table(caption, head, rows, note) {
  const box = el("div", "result-block"); box.appendChild(el("h3", null, caption));
  const t = el("table", "results" + (head ? "" : " pairs"));
  if (head) { const tr = el("tr"); for (const h of head) tr.appendChild(el("th", null, h)); t.appendChild(tr); }
  for (const r of rows) { const row = el("tr"); r.forEach((v, j) => row.appendChild(el(j === 0 && !head ? "th" : "td", j === 0 || !head ? null : "num", v))); t.appendChild(row); }
  box.appendChild(t); if (note) box.appendChild(el("p", "hint", note)); return box;
}
let figures = 0;
function histogram(caption, items, yLabel, labels) {  // items: [{ name, value, hint, label }]; vertical bars on one axis from zero; labels: print each value above its bar
  const W = 520, H = 200, left = 56, bottom = 34, top = 10, right = 10, w = W - left - right, h = H - top - bottom;
  const max = Math.max(...items.map((i) => i.value), 1), step = Math.pow(10, Math.floor(Math.log10(max))), unit = max / step > 5 ? step * 2 : max / step > 2 ? step : step / 2;
  const ticks = []; for (let y = 0; y <= max + 1e-9; y += unit) ticks.push(y); const ymax = ticks[ticks.length - 1] < max ? ticks[ticks.length - 1] + unit : ticks[ticks.length - 1];
  if (ticks[ticks.length - 1] < ymax) ticks.push(ymax);
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"); svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.setAttribute("class", "figure");
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.appendChild(e); return e; };
  const Y = (v) => top + h - (h * v) / ymax, slot = w / items.length;
  for (const t of ticks) { add("line", { x1: left, x2: left + w, y1: Y(t), y2: Y(t), class: t === 0 ? "axis" : "grid" }); add("text", { x: left - 6, y: Y(t) + 4, class: "tick", "text-anchor": "end" }, t.toLocaleString()); }
  items.forEach((it, i) => { const x = left + i * slot + slot * 0.18, bw = slot * 0.64, y = Y(it.value);
    const bar = add("rect", { x, y, width: bw, height: Math.max(0, top + h - y), class: "bar-fill" }); const tip = document.createElementNS(ns, "title"); tip.textContent = it.hint || `${it.name}: ${it.value.toLocaleString()}`; bar.appendChild(tip);
    add("text", { x: x + bw / 2, y: top + h + 16, class: "tick", "text-anchor": "middle" }, it.name);
    if (labels) add("text", { x: x + bw / 2, y: y - 4, class: "value", "text-anchor": "middle" }, it.label); });
  add("text", { x: 14, y: top + h / 2, class: "tick", transform: `rotate(-90 14 ${top + h / 2})`, "text-anchor": "middle" }, yLabel);
  const box = el("figure", "result-block"); box.appendChild(svg); box.appendChild(el("figcaption", null, `Figure ${++figures}. ${caption}`)); return box;
}
function showSummary(s, rows) {
  const view = $("summary-view"); view.innerHTML = ""; figures = 0; const n = +s.tips, K = +s.K, num = (x) => (+x).toLocaleString();
  const strength = +s.rate_correction, flagged = rows.filter((r) => r.flags > 0).length;
  const run = [["Tips in the tree", num(n)], ["Representatives (K)", `${num(K)} (${pct(100 * K / n)} of the tips)`],
    ["Clusters chosen on", strength >= 1 ? "branch lengths corrected for rate" : strength > 0 ? `branch lengths corrected for rate part way (${strength})` : "the tree's own branch lengths"],
    ["Largest cluster", num(s.largest_cluster) + " tips"], ["Clusters of one tip", `${num(rows.filter((r) => r.tips === 1).length)} (${pct(+s.singletons_pct)})`]];
  if (+s.taxa_kept > 0) run.push(["Names kept, each with a representative", num(s.taxa_kept)]);
  if (+s.kept_tips > 0) run.push(["Tips kept as representatives", num(s.kept_tips)]);
  if (s.never_tips) run.push(["Tips that may never be representatives", num(s.never_tips)]);
  if (s.pairs_separated) run.push(["Pairs of tips kept apart", num(s.pairs_separated)]);
  run.push(["Clusters to look at", `${num(flagged)} (${pct(100 * flagged / K)}); ${num(rows.filter((r) => r.flags >= 2).length)} with two reasons or more`]);
  run.push(["Exact", s.exact === "TRUE" ? "yes: the best division for these settings" : "not certified"]);
  view.appendChild(table("Table 1. Run summary", null, run));
  // how good: against the same number of tips drawn at random (filled in when worked out)
  const ref = el("div"); ref.id = "reference";
  const head = ["Measure (on the tree's own branch lengths)", "This run", `Random tips (${num(K)}, mean of 10 draws)`];
  ref.appendChild(table("Table 2. How good is the reduction?", head, [["Mean distance from a tip to the nearest representative (lower is better)", "…", "…"], ["Branch length kept (higher is better)", pct(+s.pd_kept_pct), "…"]],
    "Working out the reference values…")); view.appendChild(ref);
  ask("reference").then((r) => { ref.innerHTML = ""; ref.appendChild(table("Table 2. How good is the reduction?", head,
    [["Mean distance from a tip to the nearest representative (lower is better)", sig(r.nearest), sig(r.random_nearest)], ["Branch length kept (higher is better)", pct(r.pd), pct(r.random_pd)]],
    (r.random_nearest > r.nearest ? `This run's representatives are ${(r.random_nearest / r.nearest).toFixed(1)} times closer to the tips than ${num(K)} tips drawn at random. ` : `On this tree, ${num(K)} tips drawn at random are as close to the tips as this run's representatives. `) +
    (r.pd >= r.random_pd ? `They span ${(r.pd / r.random_pd).toFixed(1)} times as much of the tree's branch length.` : `Random tips span a little more of the tree's branch length (${pct(r.random_pd)} against ${pct(r.pd)}): the representatives are chosen to be close to the tips they stand for, not to span the most length.`)));
    status(statusTarget.dataset.done || ""); }).catch(() => { ref.querySelector(".hint").textContent = "The reference values could not be worked out."; status(statusTarget.dataset.done || ""); });
  // figures
  const figs = el("div", "figures");
  const bins = [[1, 1, "1"], [2, 2, "2"], [3, 5, "3–5"], [6, 10, "6–10"], [11, 20, "11–20"], [21, 50, "21–50"], [51, 100, "51–100"], [101, 500, "101–500"], [501, Infinity, ">500"]];
  figs.appendChild(histogram("Cluster sizes: the number of clusters of each size (tips per cluster).", bins.map(([lo, hi, name]) => { const inBin = rows.filter((r) => r.tips >= lo && r.tips <= hi); const tips = inBin.reduce((a, r) => a + r.tips, 0);
    return { name, value: inBin.length, hint: `${inBin.length.toLocaleString()} clusters of ${name} tips, holding ${tips.toLocaleString()} tips (${pct(100 * tips / n)})` }; }), "clusters"));
  if (s.identical_to_representative_pct !== undefined && s.identical_to_representative_pct !== "") {
    const I = +s.identical_to_representative_pct, w1 = +s["within_0.01_pct"], w2 = +s["within_0.022_pct"], w5 = +s["within_0.05_pct"];
    const parts = [["identical", I], ["≤1%", w1 - I], ["1–2.2%", w2 - w1], ["2.2–5%", w5 - w2], [">5%", 100 - w5]];
    figs.appendChild(histogram(`Difference from the representative in sequence: the share of tips by the share of sites that differ (representatives count as identical; mean ${pct(100 * +s.mean_sequence_distance_to_representative)}` +
      (+s.tips_not_judged > 0 ? `; ${num(s.tips_not_judged)} tips share too few sites to compare` : "") + ").", parts.map(([name, v]) => ({ name, value: v, hint: `${name}: ${pct(v)} of tips`, label: pct(v) })), "% of tips", true));
  }
  view.appendChild(figs);
  const reasons = [["names", "the representative is the only tip of its family, genus or species, while most of the cluster shares another"], ["sequences", "the representative differs at more than 10% of sites from most of the cluster"],
    ["tree", "the representative sits on one of the longest 0.1% of branches"], ["better", "the representative's sequence covers less than half the alignment, while another tip's is complete"]];
  view.appendChild(table("Table 3. Clusters to look at, by reason (a cluster can have several)", ["Reason", "Clusters"], reasons.map(([k, name]) => [name, rows.filter((r) => r[k]).length.toLocaleString()])));
}

// ---- the list of clusters (only the rows in view are drawn)
let shown = [];
function showCounts() { for (const k of ["names", "sequences", "tree", "better"]) $("n-" + k).textContent = "(" + state.rows.filter((r) => r[k]).length.toLocaleString() + ")"; }
function showList() {
  const only = $("only-flagged").checked, kinds = [...document.querySelectorAll(".kind")].filter((x) => x.checked).map((x) => x.value), find = $("find").value.trim().toLowerCase();
  shown = state.rows.map((r, i) => ({ ...r, index: i + 1 })).filter((r) => (!only || kinds.some((k) => r[k])) && (!find || r.id.toLowerCase() === find || r.rep.toLowerCase().includes(find) || nameOf(r.rep).toLowerCase().includes(find)));
  const sort = $("sort").value;
  if (sort === "flags") shown.sort((a, b) => b.flags - a.flags || b.tips - a.tips || a.index - b.index);
  else if (sort === "tips") shown.sort((a, b) => b.tips - a.tips || a.index - b.index);
  $("list-space").style.height = shown.length * 24 + "px";
  $("list-count").textContent = `${shown.length.toLocaleString()} of ${state.rows.length.toLocaleString()} clusters shown` + (only ? `; ${state.rows.filter((r) => r.flags >= 2).length.toLocaleString()} meet two conditions or more, and come first` : "") + (find ? " (press Enter to open the cluster that holds a tip)" : "");
  drawRows();
}
function drawRows() {
  const list = $("list"), first = Math.floor(list.scrollTop / 24), last = Math.min(shown.length, first + Math.ceil(list.clientHeight / 24) + 2);
  for (const el of [...list.querySelectorAll(".item")]) el.remove();
  for (let i = first; i < last; i++) { const r = shown[i], el = document.createElement("div");
    el.className = "item" + (state.selected && state.selected.id === r.id ? " selected" : ""); el.style.top = i * 24 + "px";
    for (const t of [r.id, nameOf(r.rep), r.tips, r.flags, r.reasons.split("; ")[0] + (r.flags > 1 ? " …" : "")]) { const s = document.createElement("span"); s.textContent = t; el.appendChild(s); }
    el.title = (nameOf(r.rep) !== r.rep ? r.rep + "\n" : "") + r.reasons.split("; ").join("\n"); el.onclick = () => openCluster(r.index); list.appendChild(el); }
}

// ---- one cluster
async function openCluster(index) {
  const text = await ask("cluster", { index }); const lines = text.trimEnd().split("\n").map((l) => l.split("\t"));
  const head = lines.find((l) => l[0] === "cluster"), columns = lines.find((l) => l[0] === "columns").slice(1);
  const tips = lines.filter((l) => l[0] === "tip").map((l) => l.slice(1)), nodes = lines.filter((l) => l[0] === "node").map((l) => ({ id: +l[1], parent: +l[2], length: +l[3], kind: l[4], label: l[5], tips: +l[6] }));
  const row = state.rows[index - 1];
  state.selected = { id: head[1], rep: head[2], index }; drawRows();
  $("cluster").hidden = false; $("cluster-title").textContent = `Cluster ${head[1]}: ${(+head[3]).toLocaleString()} tips, represented by ${nameOf(head[2])}`;
  $("cluster-reasons").textContent = row.reasons ? "To look at: " + row.reasons + "." : "Nothing plainly wrong here.";
  const [a, b, na, nb] = [head[4], head[5], head[6], head[7]];
  $("split").disabled = !a;
  $("split-hint").textContent = a
    ? `The cluster comes from two branches of the tree: one with ${na} tips (central tip ${a}) and one with ${nb} tips (central tip ${b}). ` +
      `Splitting it adds the choice that ${a} and ${b} may not share a cluster, and the next run has one more representative ` +
      `(${(state.lastK + splits() - state.splitsAtLastRun + 1).toLocaleString()} in all) to make room for it. The cluster is then usually divided into those two branches, each with its own representative; the rest of the tree is worked out again.`
    : "A cluster of one tip cannot be split.";
  $("split").onclick = () => addChoice({ choice: "separate", tip: a, tip2: b, note: `split ${head[1]}` });
  // the table of its tips
  const table = $("tips"); table.innerHTML = ""; const tr = document.createElement("tr");
  const byName = Object.keys(state.shown).length > 0;
  for (const c of [...(byName ? ["name"] : []), ...columns, ""]) { const th = document.createElement("th"); th.textContent = c === "difference" ? "difference from the representative" : c; tr.appendChild(th); }
  table.appendChild(tr);
  const marksOf = new Map(tips.map((t) => [t[0], t[t.length - 1]]));
  for (const t of tips) { const r = document.createElement("tr"); if (t[0] === head[2]) r.className = "rep"; r.dataset.tip = t[0];
    if (byName) r.appendChild(el("td", null, nameOf(t[0])));
    t.forEach((v, j) => { const td = document.createElement("td"); const c = columns[j];
      td.textContent = c === "difference" && v ? (100 * v).toFixed(2) + "%" : c === "coverage" && v ? Math.round(100 * v) + "%" : v; r.appendChild(td); });
    const td = document.createElement("td");
    if (t[0] !== head[2]) { const k = document.createElement("button"); k.textContent = "make representative"; k.onclick = () => addChoice({ choice: "keep", tip: t[0], note: `instead of ${head[2]}` }); td.appendChild(k); }
    const nv = document.createElement("button"); nv.textContent = "never"; nv.title = "this tip may never be a representative"; nv.onclick = () => addChoice({ choice: "never", tip: t[0], note: "" }); td.appendChild(nv);
    r.appendChild(td); table.appendChild(r); }
  // its part of the tree
  // a branch is drawn as part of the cluster when every tip below it is in the cluster
  const inside = new Set(tips.map((t) => t[0])), kids = new Map(), all = new Map();
  for (const n of nodes) { if (!kids.has(n.parent)) kids.set(n.parent, []); kids.get(n.parent).push(n); }
  for (const n of [...nodes].reverse()) all.set(n.id, n.kind === "tip" ? inside.has(n.label) : n.kind === "cluster" ? false : (kids.get(n.id) || []).every((k) => all.get(k.id)));
  const places = drawTree($("tree-view"), nodes, { representative: head[2], inCluster: (n) => all.get(n.id), marks: (l) => (inside.has(l) ? (marksOf.get(l) || "") : ""), nameOf });
  $("tree-view").onclick = (e) => { const r = $("tree-view").getBoundingClientRect(), y = e.clientY - r.top, hit = places.find((p) => Math.abs(p.y - y) < 8); if (!hit) return;
    for (const el of table.querySelectorAll("tr")) el.classList.toggle("lit", el.dataset.tip === hit.label);
    const lit = table.querySelector("tr.lit"); if (lit) lit.scrollIntoView({ block: "nearest" }); };
}

// ---- choices
function addChoice(c) {
  if (state.choices.some((x) => x.choice === c.choice && x.tip === c.tip && (x.tip2 || "") === (c.tip2 || ""))) return;
  state.choices.push(c); showChoices();
}
function showChoices() {
  const ul = $("choices"); ul.innerHTML = "";
  if (!state.choices.length) { ul.innerHTML = "<li class='hint'>No choices yet. Open a cluster and use its buttons, or read a choices file.</li>"; return; }
  const words = { keep: (c) => `${c.tip} must be a representative`, never: (c) => `${c.tip} may never be a representative`, separate: (c) => `split: ${c.tip} and ${c.tip2} may not share a cluster (one more representative)` };
  state.choices.forEach((c, i) => { const li = document.createElement("li"); li.textContent = words[c.choice](c) + (c.note ? ` — ${c.note}` : "");
    const x = document.createElement("button"); x.textContent = "remove"; x.onclick = () => { state.choices.splice(i, 1); showChoices(); }; li.appendChild(x); ul.appendChild(li); });
}
function readChoices(text) {           // for the list on the page; the engine reads the same text again when it runs
  const out = []; let header = false;
  for (const line of text.split(/\r?\n/)) { if (!line.trim() || line.startsWith("#")) continue; const f = line.split("\t");
    if (!header) { if (f[0] !== "choice" || f[1] !== "tip") throw new Error("the choices file has no header line (choice, tip, tip2, note)"); header = true; continue; }
    if (!["keep", "never", "separate"].includes(f[0])) throw new Error(`'${f[0]}' is not a choice (keep, never or separate)`);
    out.push({ choice: f[0], tip: f[1], tip2: f[2] || "", note: f.slice(3).join("\t") }); }
  return out;
}

// ---- downloads
async function showDownloads(command) {
  const ul = $("downloads"); ul.innerHTML = ""; $("command").textContent = command;
  const items = [["cladecut_clusters.csv", "clusters"], ["cladecut_medoids.csv", "medoids"], ["cladecut_summary.tsv", "summary"], ["cladecut_reduced_tree.nwk", "tree"], ["cladecut_flags.csv", "flags"], ["cladecut_reduced_tree_named.nwk", "named_tree"]];
  for (const [file, what] of items) { if (what === "named_tree" && !(await ask("file", { name: what }))) continue;
    const li = document.createElement("li"); const b = document.createElement("button"); b.textContent = file;
    b.onclick = async () => save(file, await ask("file", { name: what })); li.appendChild(b); ul.appendChild(li);
    ask("file", { name: what }).then(async (text) => { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
      const code = document.createElement("code"); code.textContent = "  SHA-256 " + [...new Uint8Array(h)].map((x) => x.toString(16).padStart(2, "0")).join(""); li.appendChild(code); }); }
  if (state.choices.length) { const li = document.createElement("li"); const b = document.createElement("button"); b.textContent = "choices.tsv"; b.onclick = () => save("choices.tsv", choicesText(command)); li.appendChild(b); ul.appendChild(li); }
}
function save(file, text) { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" })); a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); }

// ---- a small simulated example, made here: a tree, names that follow its clades, sequences evolved down it
function example() {
  let s = 7; const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); const n = 300, sites = 400;
  let parts = Array.from({ length: n }, (_, i) => ({ text: null, tips: [i] }));
  const label = (i) => (i % 23 === 0 ? `MITO${String(i).padStart(5, "0")}` : `tip${String(i + 1).padStart(3, "0")}`);
  const nodes = parts.map((p, i) => ({ tip: i, kids: [], len: 0 })); let pool = [...nodes];
  while (pool.length > 1) { const a = pool.splice(Math.floor(rand() * pool.length), 1)[0], b = pool.splice(Math.floor(rand() * pool.length), 1)[0];
    a.len = 0.002 + 0.03 * rand() ** 2; b.len = 0.002 + 0.03 * rand() ** 2; pool.push({ kids: [a, b], len: 0 }); }
  const root = pool[0]; const bases = "ACGT"; const seqs = new Array(n);
  const genus = new Array(n).fill(""), species = new Array(n).fill(""); let g = 0, sp = 0;
  (function walk(node, seq, depth, gen, spec) {
    const mine = seq.split("").map((c) => (rand() < node.len ? bases[Math.floor(rand() * 4)] : c)).join("");
    if (gen === null && depth > 0.03 && node.kids.length) gen = `Genus${String(++g).padStart(2, "0")}`;
    if (gen !== null && spec === null && depth > 0.06 && node.kids.length) spec = `${gen} sp. ${++sp}`;     // species are clades inside genera
    if (node.tip !== undefined) { seqs[node.tip] = rand() < 0.15 ? "-".repeat(150) + mine.slice(150) : mine; genus[node.tip] = gen || ""; species[node.tip] = spec || (gen ? gen + " sp." : ""); return; }
    node.kids.forEach((k) => walk(k, mine, depth + k.len, gen, spec)); })(root, Array.from({ length: sites }, () => bases[Math.floor(rand() * 4)]).join(""), 0, null, null);
  const newick = (node) => (node.tip !== undefined ? label(node.tip) : `(${newick(node.kids[0])},${newick(node.kids[1])})`) + (node === root ? "" : ":" + node.len.toFixed(6));
  const named = genus.map((x) => (x && rand() < 0.75 ? x : ""));
  return {
    tree: { name: "example_tree.nwk", text: newick(root) + ";" },
    names: { name: "example_names.tsv", text: "tip\tspecies\tgenus\n" + genus.map((x, i) => `${label(i)}\t${named[i] ? species[i] : ""}\t${named[i]}`).join("\n") + "\n" },
    fasta: { name: "example_alignment.fasta", text: seqs.map((q, i) => `>${label(i)}\n${q}`).join("\n") + "\n" },
  };
}

// ---- wiring
$("read-files").onclick = () => readFiles({ tree: $("tree-file").files[0] || null, names: $("names-file").files[0] || null, fasta: $("fasta-file").files[0] || null, keep: $("keep-file").files[0] || null });
for (const id of ["label-columns", "label-mode"]) $(id).onchange = updateLabels;
$("example").onclick = () => { $("size-value").value = 10; readFiles(example()); };
$("choices-file").onchange = async () => { const f = $("choices-file").files[0]; if (!f) return; try { state.choices = readChoices(await f.text()); showChoices(); } catch (e) { showError(e.message); } };
$("run").onclick = () => run(true);
$("rerun").onclick = () => run(false);
$("undo").onclick = () => { state.choices.pop(); showChoices(); };
$("save-choices").onclick = () => save("choices.tsv", choicesText(commandLine(options(state.lastK + splits() - state.splitsAtLastRun))));
for (const id of ["only-flagged", "sort", "find"]) $(id).oninput = showList;
// Enter in the search box opens the cluster that holds the tip, whether or not it is a representative
$("find").onkeydown = async (e) => { if (e.key !== "Enter" || !state.rows.length) return; const v = $("find").value.trim();
  const byId = state.rows.findIndex((r) => r.id.toLowerCase() === v.toLowerCase()); const i = byId >= 0 ? byId + 1 : await ask("where", { tip: v });
  if (i > 0) { await openCluster(i); $("cluster").scrollIntoView(); if (byId < 0) for (const el of $("tips").querySelectorAll("tr")) el.classList.toggle("lit", el.dataset.tip === v); }
  else showError(`No tip or cluster is called ${v}.`); };
for (const el of document.querySelectorAll(".kind")) el.oninput = showList;
$("list").onscroll = drawRows;
showChoices();

// files given in the address, from the same place as the page: ?tree=...&names=...&fasta=...
const params = new URLSearchParams(location.search);
if (params.get("tree")) {
  const get = async (key) => { const path = params.get(key); if (!path) return null; const r = await fetch(path); if (!r.ok) throw new Error("cannot load " + path); return new File([await r.blob()], path.split("/").pop()); };
  (async () => { try { status("loading the files named in the address"); const files = { tree: await get("tree"), names: await get("names"), fasta: await get("fasta"), keep: await get("keep") }; await readFiles(files);
    if (params.get("run")) run(true); } catch (e) { showError(e.message); } })();
}
