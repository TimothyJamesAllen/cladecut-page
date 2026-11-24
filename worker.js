// The engine runs here, apart from the page, so that the page stays responsive. The page sends messages
// ({ id, type, ... }) and gets one answer for each ({ id, ok, result } or { id, ok: false, error }), and progress
// messages ({ progress: text }) on the way.
import { createEngine, matchingTips, MITOGENOME_PATTERN } from "./engine.js?v=23a4f0e";

let engine = null, labels = [], files = {};
const ready = fetch("cladecut.wasm?v=23a4f0e").then((r) => { if (!r.ok) throw new Error("cannot load cladecut.wasm"); return r.arrayBuffer(); }).then(createEngine).then((e) => (engine = e));
const progress = (text) => postMessage({ progress: text });

// the bytes of a file or a text; a file compressed with gzip is read as it was before compression
async function bytesOf(source) {
  if (typeof source === "string") return new TextEncoder().encode(source);
  const head = new Uint8Array(await source.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) return new Uint8Array(await new Response(source.stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer());
  return new Uint8Array(await source.arrayBuffer());
}

async function loadAlignment(source) {
  engine.beginAlignment();
  if (typeof source === "string") { engine.feedAlignment(source); engine.endAlignment(); return; }
  let stream = source.stream(); const head = new Uint8Array(await source.slice(0, 2).arrayBuffer());
  if (head[0] === 0x1f && head[1] === 0x8b) stream = stream.pipeThrough(new DecompressionStream("gzip"));
  const reader = stream.getReader(); let done = 0, last = 0;
  for (;;) { const { value, done: end } = await reader.read(); if (end) break;
    engine.feedAlignment(value); done += value.length;
    if (done - last > 20e6) { last = done; progress(`reading the alignment: ${Math.round(done / 1e6)} MB`); } }
  engine.endAlignment();
}

const handlers = {
  // the files: tree (needed), names, alignment, choices; File objects or texts
  async load({ tree, names, fasta, pattern }) {
    await ready; files = { names: !!names, fasta: !!fasta };
    progress("reading the tree"); labels = engine.loadTree(await bytesOf(tree));
    engine.setText("mitogenomes", matchingTips(labels, pattern || MITOGENOME_PATTERN));
    let header = null;
    if (names) { progress("reading the names table"); engine.setText("names", await bytesOf(names)); header = engine.namesHeader(); }
    if (fasta) { progress("reading the alignment"); await loadAlignment(fasta); }
    return { tips: labels.length, header, mitogenomes: matchingTips(labels, pattern || MITOGENOME_PATTERN).split("\n").filter(Boolean).length };
  },
  async run({ options, choices }) {
    engine.setText("choices", choices || "");
    progress("reducing the tree");
    const t0 = performance.now(); engine.setOptions(options); engine.run(0); engine.setSeconds((performance.now() - t0) / 1000);
    const rows = engine.rows().split("\n").filter(Boolean).map((line) => { const f = line.split("\t");
      return { id: f[0], rep: f[1], tips: +f[2], flags: +f[3], names: f[4] === "1", sequences: f[5] === "1", tree: f[6] === "1", better: f[7] === "1", reasons: f[8] || "" }; });
    const [head, values] = engine.file("summary").trimEnd().split("\n").map((l) => l.split("\t"));
    const summary = Object.fromEntries(head.map((h, i) => [h, values[i]]));
    return { report: engine.file("report"), rows, summary };
  },
  async cluster({ index }) { return engine.cluster(index); },
  async where({ tip }) { return engine.clusterOf(tip); },
  async file({ name }) { return engine.file(name); },
};

onmessage = async (event) => {
  const { id, type, ...args } = event.data;
  try { postMessage({ id, ok: true, result: await handlers[type](args) }); }
  catch (e) { postMessage({ id, ok: false, error: e.message || String(e) }); }
};
