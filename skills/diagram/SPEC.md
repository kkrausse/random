# diagram: spec

Replaces the Excalidraw skill for dataflow / architecture diagrams.

## Must
- **The agent writes the graph and where things go.** One `.js` file: `diagram(title, { nodes, edges, rows })`.
  Placement is exact and deterministic: `rows` (on the diagram and on each group) lists ids in rows and columns,
  like a page layout. No coordinates, sizes, imports or setup. Lines are routed automatically (libavoid,
  orthogonal, around the boxes).
- **Live.** The viewer page re-runs the file every 2 s and redraws when it changed. Works on file:// and hosted.
  No server, no build.
- **Fast agent feedback, one command.** `bun dg.ts <file.js>` does all of this in ~1 s:
  - type-checks the file (tsgo);
  - lints the graph: unknown or duplicate ids, implicit inputs, dead ends, rows problems, upward flow, overlaps,
    lines through boxes;
  - writes a PNG (all diagrams, or `--only` one, or `--focus <id>` crop at 1:1);
  - prints a short report.
  `--pub <slug>` also publishes, so the user's open page updates.
- **The viewer only views.** It supports:
  - pan (wheel or drag with Space held) and zoom (Ctrl/pinch + wheel);
  - click to select a box or group, drag on empty space to box-select, Shift to add;
  - Ctrl/Cmd+C copies one line per selected item (`id kind "label" ← inputs → outputs`), to paste back to the agent.
  No editing and no drawing.
- **Vocabulary**:
  - data: dotted border, with tokens drawn inside;
  - input: data with a thick dotted border;
  - param: a learned tensor;
  - op: solid box, coloured by whose weights it uses;
  - group: dashed outline, or a "deck" of stacked cards;
  - edge: a ball at the source and an arrowhead at the receiver;
  - link: a dashed line with no heads ("same weights").
- **Exact routes.** Every line is the router's orthogonal route, drawn as given.

## Not
Hand editing, Excalidraw export, a server or watcher, a framework.
