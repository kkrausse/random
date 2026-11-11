// Types for a diagram file (globals from core.js). `bun dg.ts <file.js>` type-checks against these.
type Colour = string; // a name (gray blue teal yellow green violet cyan orange pink lime indigo red white) or any CSS colour
type Tok = ([count: number, colour: Colour, caption?: string, shown?: number] | "…")[];
interface NodeOpts {
  ink?: Colour;          // border / text colour
  sw?: number;           // border width
  tok?: Tok;             // token squares drawn inside (data)
  img?: [src: string, w: number, h: number]; // picture inside (path relative to the diagram file)
  out?: boolean;         // a final output: no edge out is fine
  src?: boolean;         // a source that is not an input (no edge in is fine)
}
interface Node extends NodeOpts { id: string; kind: "data" | "op"; s: string; input?: boolean; param?: string; w?: string }
interface GroupOpts {
  deck?: boolean; big?: boolean;
  entries?: string[];    // ids of its ENTERING boxes, kept in one row at its top
  fill?: Colour;         // background tint (e.g. "#fff4e6"): marks a region such as "the context frames"
  ink?: Colour; sw?: number; // border colour / width; sw makes the border solid
}
interface Group extends GroupOpts { id: string; kind: "group"; title: string; kids: Item[] }
type Item = Node | Group;
interface EdgeOpts { ink?: Colour; sw?: number; short?: boolean; hidden?: boolean }
interface Edge extends EdgeOpts { from: string; to: string; s: string }
interface Link { a: string; b: string; s: string }
interface Spec {
  sub?: string;                         // line(s) under the title
  nodes: Item[];
  edges: (Edge | string)[];             // E(...) or "a>b>c" chains
  links?: Link[];                       // L(a, b, "same weights"): dashed, no data flow
  weights?: Record<string, Colour>;     // op colour by whose weights: { trunk: "blue", ... } (also the legend)
  mirror?: boolean;                     // flip the finished layout left <-> right
  elk?: Record<string, string>;         // extra ELK root options
  titleSize?: number;
}
/** data: dotted box */ declare function D(id: string, s: string, o?: NodeOpts): Node;
/** a model input: data pinned to the top row */ declare function I(id: string, s: string, ink?: Colour, o?: NodeOpts): Node;
/** a learned tensor used as data; w = its weights key */ declare function P(id: string, s: string, w: string, o?: NodeOpts): Node;
declare const Pm: typeof P;
/** a transformation; w = whose weights (colour) */ declare function O(id: string, s: string, w?: string, o?: NodeOpts): Node;
/** an outline round part of the graph; deck = stacked cards (one per image / frame) */ declare function G(id: string, title: string, kids: Item[], o?: GroupOpts): Group;
/** data flow from -> to */ declare function E(from: string, to: string, s?: string, o?: EdgeOpts): Edge;
/** same weights: dashed line, no arrowheads */ declare function L(a: string, b: string, s?: string): Link;
/** the page's name, shown as the browser tab "diagram: <s>": say specifically what this page shows */ declare function title(s: string): void;
/** one diagram (call several times for several side by side) */ declare function diagram(title: string, spec: Spec): void;
