// bun site/cli.js [scene.js] > canvas.excalidraw : the same canvas the page shows, as an Excalidraw file (for git, or to open in Excalidraw).
import "../scripts/excs.js";
import { canvas } from "./diagram.js";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(process.argv[2] ?? new URL("./scene.js", import.meta.url).pathname).href);
const rows = typeof mod.default === "string" ? [[mod.default]] : mod.default;
const elements = canvas(rows.map((/** @type {string[]} */ r) => r.map((t) => globalThis.EXCS.build(t).elements)));
process.stdout.write(JSON.stringify({ type: "excalidraw", version: 2, source: "https://excalidraw.com", elements, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} }));
