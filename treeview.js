// Draws the part of the tree around one cluster: its own tips in full, neighbouring clusters as triangles.
// nodes: [{ id, parent, length, kind ("tip", "inner", "cluster"), label, tips }], the top first, a node before those
// below it. Returns the places of the tips drawn, for clicking: [{ label, x, y }].
export function drawTree(canvas, nodes, { representative, inCluster, marks }) {
  const ratio = window.devicePixelRatio || 1, width = canvas.clientWidth, rowHeight = 16;
  const byId = new Map(nodes.map((n) => [n.id, { ...n, kids: [] }]));
  let top = null; for (const n of byId.values()) { if (n.parent && byId.has(n.parent)) byId.get(n.parent).kids.push(n); else top = n; }
  // depth from the top, and the order of the leaves
  const leaves = []; let deepest = 0;
  (function place(n, depth) { n.depth = depth; deepest = Math.max(deepest, depth);
    if (!n.kids.length) { n.row = leaves.length; leaves.push(n); return; }
    n.kids.forEach((k) => place(k, depth + k.length)); n.row = (n.kids[0].row + n.kids[n.kids.length - 1].row) / 2; })(top, 0);
  const height = Math.max(60, leaves.length * rowHeight + 20);
  canvas.style.height = height + "px"; canvas.width = width * ratio; canvas.height = height * ratio;
  const g = canvas.getContext("2d"); g.setTransform(ratio, 0, 0, ratio, 0, 0); g.clearRect(0, 0, width, height);
  g.font = "12px system-ui, sans-serif"; g.textBaseline = "middle";
  const labelSpace = 230, scale = deepest > 0 ? (width - labelSpace - 20) / deepest : 0;
  const X = (d) => 10 + d * scale, Y = (row) => 10 + row * rowHeight + rowHeight / 2;
  const places = [];
  (function draw(n) {
    const x = X(n.depth), y = Y(n.row);
    if (n.kids.length) {
      g.strokeStyle = "#888"; g.lineWidth = 1; g.beginPath(); g.moveTo(x, Y(n.kids[0].row)); g.lineTo(x, Y(n.kids[n.kids.length - 1].row)); g.stroke();
      for (const k of n.kids) { const inside = inCluster(k); g.strokeStyle = inside ? "#1f5fbf" : "#888"; g.lineWidth = inside ? 2 : 1;
        g.beginPath(); g.moveTo(x, Y(k.row)); g.lineTo(X(k.depth), Y(k.row)); g.stroke(); draw(k); }
      return; }
    if (n.kind === "cluster") {                    // a neighbouring cluster, as a triangle sized by its number of tips
      const h = Math.min(rowHeight * 0.45, 3 + Math.log2(n.tips + 1)); g.fillStyle = "#ddd"; g.strokeStyle = "#999";
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + 18, y - h); g.lineTo(x + 18, y + h); g.closePath(); g.fill(); g.stroke();
      g.fillStyle = "#666"; g.fillText(`${n.label} (${n.tips} tips)`, x + 24, y); return; }
    const isRep = n.label === representative, m = marks(n.label);
    g.fillStyle = isRep ? "#b3261e" : "#1f5fbf"; g.beginPath(); g.arc(x, y, isRep ? 4.5 : 3, 0, 2 * Math.PI); g.fill();
    g.fillStyle = isRep ? "#b3261e" : "#222"; g.font = (isRep ? "bold " : "") + "12px system-ui, sans-serif";
    g.fillText(n.label + (m ? "  " + m : ""), x + 8, y); g.font = "12px system-ui, sans-serif";
    places.push({ label: n.label, x, y });
  })(top);
  return places;
}
