// Loads the engine (cladecut.wasm) and gives it a plain interface. Works in a browser and under Node.
//
//   const engine = await createEngine(bytesOfCladecutWasm);
//   const labels = engine.loadTree(newickText);                 // the tip labels, in the order of the tree
//   engine.beginAlignment(); engine.feedAlignment(chunk); ...; engine.endAlignment();
//   engine.setText("names", text);                              // also "choices", "keep", "prefer", "mitogenomes"
//   engine.setOptions([["--retention", "0.1"], ["--names", "names.tsv"], ["--flags", ""]]);
//   engine.run(seconds);                                        // the options are those of the command cladecut
//   engine.file("clusters");                                    // clusters, medoids, summary, tree, flags, report, messages
//
// A failure throws an Error with the engine's reason.

const FILES = { clusters: 0, medoids: 1, summary: 2, tree: 3, flags: 4, report: 5, messages: 6 };
// the labels that count as mitogenomes unless another pattern is given (as in the command)
export const MITOGENOME_PATTERN = "^[A-Z]{4}\\d{5}$";

export async function createEngine(wasmBytes) {
  const module = await WebAssembly.compile(wasmBytes);
  let memory = null;
  // The few system calls the engine's C library asks for: writing goes to the console, the rest does nothing.
  const wasi = {
    fd_write(fd, iovs, count, written) {
      const view = new DataView(memory.buffer); let text = "", total = 0;
      for (let i = 0; i < count; i++) { const ptr = view.getUint32(iovs + 8 * i, true), len = view.getUint32(iovs + 8 * i + 4, true);
        text += new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len)); total += len; }
      view.setUint32(written, total, true); if (text) console.log(text.replace(/\n$/, "")); return 0;
    },
    fd_close() { return 0; },
    fd_seek() { return 70; },          // not seekable
  };
  const imports = { wasi_snapshot_preview1: {} };
  for (const need of WebAssembly.Module.imports(module)) {
    if (need.module !== "wasi_snapshot_preview1") throw new Error("the engine asks for " + need.module + "." + need.name);
    imports.wasi_snapshot_preview1[need.name] = wasi[need.name] || (() => 52);      // 52: not supported
  }
  const instance = await WebAssembly.instantiate(module, imports);
  const x = instance.exports; memory = x.memory; x._initialize();
  const encoder = new TextEncoder(), decoder = new TextDecoder();

  // copy bytes (or a string) into the engine's memory for the length of one call
  function withBytes(data, use) {
    const bytes = typeof data === "string" ? encoder.encode(data) : data;
    const ptr = x.cc_alloc(bytes.length); new Uint8Array(memory.buffer, ptr, bytes.length).set(bytes);
    try { return use(ptr, bytes.length); } finally { x.cc_free(ptr); }
  }
  const error = () => decoder.decode(new Uint8Array(memory.buffer, x.cc_error_ptr(), x.cc_error_len()));
  const output = () => decoder.decode(new Uint8Array(memory.buffer, x.cc_out_ptr(), x.cc_out_len()));
  const check = (ok) => { if (!ok) throw new Error(error()); };

  return {
    // Reads a tree from Newick text and returns its tip labels. Everything loaded before is dropped.
    loadTree(text) { check(withBytes(text, (p, n) => x.cc_load_tree(p, n))); const out = output(); return out ? out.slice(0, -1).split("\n") : []; },
    beginAlignment() { check(x.cc_fasta_begin()); },
    // Takes the next block of an aligned FASTA file (bytes or text), in order.
    feedAlignment(chunk) { check(withBytes(chunk, (p, n) => x.cc_fasta_feed(p, n))); },
    endAlignment() { check(x.cc_fasta_end()); },
    setText(what, text) { withBytes(what, (wp, wn) => withBytes(text, (p, n) => x.cc_set_text(wp, wn, p, n))); },
    // options as pairs of [option, value], as for the command; the value of a switch is ""
    setOptions(pairs) { x.cc_clear_options(); for (const [key, value] of pairs) withBytes(key, (kp, kn) => withBytes(String(value ?? ""), (vp, vn) => x.cc_set_option(kp, kn, vp, vn))); },
    run(seconds = 0) { x.cc_set_seconds(seconds); check(x.cc_run()); },
    setSeconds(seconds) { x.cc_set_seconds(seconds); },
    // The text of a file of the last run, or null where the run wrote no such file.
    file(name) { if (!(name in FILES)) throw new Error("no file " + name); return x.cc_file(FILES[name]) ? output() : null; },
    // for the page: one line per cluster; the header of the names table; one cluster with its part of the tree
    rows() { check(x.cc_rows()); return output(); },
    namesHeader() { check(x.cc_names_header()); return output().split("\t"); },
    cluster(i) { check(x.cc_cluster(i)); return output(); },
    reference(draws = 10) { check(x.cc_reference(draws)); return Object.fromEntries(output().trim().split("\n").map((l) => { const [k, v] = l.split("\t"); return [k, +v]; })); },
    clusterOf(label) { return withBytes(label, (p, n) => x.cc_cluster_of(p, n)); },
    // for the tests of the build
    testDivision(variant, K, window, which) { return x.cc_test_division(variant, K, window, which); },
    arithmeticIsPlain() { return x.cc_arithmetic_is_plain() === 1; },
    memoryBytes() { return memory.buffer.byteLength; },
  };
}

// The tips whose labels match a pattern (the mitogenomes), one per line, for setText("mitogenomes", ...).
export function matchingTips(labels, pattern = MITOGENOME_PATTERN) {
  const re = new RegExp(pattern); return labels.filter((l) => re.test(l)).join("\n");
}
