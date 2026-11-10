import { box, text, row, col, arrow } from "x";

export const title = "example";

// a function is a reusable shape: one trained layer, drawn the same way for every i
const layer = (/** @type {number} */ i) => row(40, box(`sa${i}`, `self-attention ${i}\n372 × 1024`, { bg: "blue" }), box(`ff${i}`, `feed-forward ${i}`, { bg: "orange" }));

export default [
  col(50,
    row(60, box("q", "query strip\n176 × 512 × 3 px"), box("c", "calibration frame k", { bg: "green" })),
    box("fz", "FROZEN blocks 1 – 12\nout: 361 × 1024", { bg: "gray", w: 420 }),
    layer(1), layer(2),
    text("note", "the head reads the readout token only", { ink: "gray" })),
  arrow("q", "fz"), arrow("c", "fz", "", { dashed: true }),
  arrow("fz", "sa1", "361 × 1024"), arrow("sa1", "ff1"), arrow("ff1", "sa2"), arrow("sa2", "ff2"),
];
