// Types for a diagram file (globals from core.js). `bun dg.ts <file.js>` type-checks against these.
type Colour = string; // a name (gray blue teal yellow green violet cyan orange pink lime indigo red white) or any CSS colour
// plus: a vector ADDED onto each of these tokens (e.g. + e_k), drawn as a band of that colour under every square
type Tok = ([count: number, colour: Colour, caption?: string, shown?: number, plus?: Colour | Colour[]] | "…")[];
interface NodeOpts {
  ink?: Colour;          // border / text colour
  sw?: number;           // border width
  tok?: Tok;             // token squares drawn inside (data)
  img?: [src: string, w: number, h: number]; // picture inside (path relative to the diagram file)
  out?: boolean;         // a final output: no edge out is fine
  src?: boolean;         // a source that is not an input (no edge in is fine)
  def?: string;          // this op is an abstraction defined by the diagram with this title (drawn with a double border);
                         // edges into it are labelled with that diagram's input ports (each exactly once), edges out with its output ports
  port?: string;         // in a defining diagram: the name of this input (I) or output (out: true)
  side?: "left" | "right"; // meant to be on that side (also on G, for everything inside): dg.ts reports a box placed on the wrong side
  ref?: boolean;         // drawn for comparison only (faded): not an input/output of the diagram, skipped by the flow lints
}
interface Node extends NodeOpts { id: string; kind: "data" | "op"; s: string; input?: boolean; param?: string; w?: string }
// Placement: rows of ids, top to bottom; each row's ids left to right. An array inside a row is a column (stacked,
// centred), an array inside that a row again, and so on. Name every direct content once. Without rows: by flow.
type Rows = (string | Rows)[];
interface GroupOpts {
  rows?: Rows;           // where its direct contents go (ids of boxes and groups directly inside it)
  gap?: [x: number, y: number]; // space between neighbours (default 50 across, 70 down)
  side?: "left" | "right";
  deck?: boolean; big?: boolean;
  fill?: Colour;         // background tint (e.g. "#fff4e6"): marks a region such as "the context frames"
  ink?: Colour; sw?: number; // border colour / width; sw makes the border solid
}
interface Group extends GroupOpts { id: string; kind: "group"; title: string; kids: Item[] }
type Item = Node | Group;
// E(from, "id@aux"): the edge ends on the token segment of id whose caption starts with "aux"; "id@cls..patches" spans
// from the "cls" segment through the "patches" one (so a CONCAT needs no box: each input lands on its own tokens)
interface EdgeOpts { ink?: Colour; sw?: number }
interface Edge extends EdgeOpts { from: string; to: string; s: string }
interface Link { a: string; b: string; s: string }
interface Spec {
  sub?: string;                         // line(s) under the title
  nodes: Item[];
  edges: (Edge | string)[];             // E(...) or "a>b>c" chains
  links?: Link[];                       // L(a, b, "same weights"): dashed, no data flow
  weights?: Record<string, Colour>;     // op colour by whose weights: { trunk: "blue", ... } (also the legend)
  rows?: Rows;                          // where the top-level boxes and groups go (as G's rows)
  gap?: [x: number, y: number];
  titleSize?: number;
}
/** data: dotted box */ declare function D(id: string, s: string, o?: NodeOpts): Node;
/** a model input (thick dotted border) */ declare function I(id: string, s: string, ink?: Colour, o?: NodeOpts): Node;
/** a learned tensor used as data; w = its weights key */ declare function P(id: string, s: string, w: string, o?: NodeOpts): Node;
declare const Pm: typeof P;
/** a transformation; w = whose weights (colour) */ declare function O(id: string, s: string, w?: string, o?: NodeOpts): Node;
/** an outline round part of the graph; deck = stacked cards (one per image / frame) */ declare function G(id: string, title: string, kids: Item[], o?: GroupOpts): Group;
/** data flow from -> to */ declare function E(from: string, to: string, s?: string, o?: EdgeOpts): Edge;
/** same weights: dashed line, no arrowheads */ declare function L(a: string, b: string, s?: string): Link;
/** the page's name, shown as the browser tab "diagram: <s>": say specifically what this page shows */ declare function title(s: string): void;
/** one diagram (call several times for several side by side) */ declare function diagram(title: string, spec: Spec): void;
