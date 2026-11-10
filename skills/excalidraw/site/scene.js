// @ts-check
// Example scene. Edit this file and reload the page: there is no build.
import { lanes, box, label, squares, col, plus, arrow, render, T, B, L, R, C } from "./diagram.js";

const g = lanes(["in", "model", "side"], { gx: 60, gy: 24 });
g.row({ "in:side": label("A small example: lanes, a spanning box, a token strip, a band, arrows", { fs: 18 }) }, { ax: "l" });
const img = box("input image\n176×512"), enc = box("ENCODER (frozen)\nblocks 1 → 8", { bg: C.gray });
const r0 = g.row({ in: img, model: enc, side: col([squares([{ n: 1, color: C.purple }, { n: 8, color: C.dblue }, { bar: 60, color: C.dgreen }]), label("361 tokens", { fs: 10 })]) });
const blk = box("BLOCK (trained)\nx += Attn(x); x += MLP(x)", { bg: C.blue }), add = plus(), side = box("side branch\n× gate", { bg: C.yellow });
g.row({ model: blk });
const r2 = g.row({ model: add, side });
g.row({ "in:side": box("a box across all three lanes (stretch: true)", { bg: C.green, stretch: true }) });
g.band(r0, r2, { label: "a band around rows" });
arrow(R(img), L(enc)); arrow(B(enc), T(blk), { sw: 4 }); arrow(B(blk), T(add), { sw: 4 });
arrow(R(blk), T(side), { via: "hv", label: "Q" }); arrow(L(side), R(add), { color: C.dorange, label: "added" });

export const title = "diagram.js example";
export default render(g.node());
