// The page: import ./scene.js (or ?s=other.js) fresh, build it, show it in regular Excalidraw. Static files, no server.
// "copy for LLM" (Ctrl/Cmd+Shift+C): the selection (or everything) as one short line per element.
import { build } from "x";

const name = new URLSearchParams(location.search).get("s") ?? "scene.js";
const msg = (/** @type {string} */ t) => { const m = document.getElementById("msg"); if (m) m.textContent = t; };
/** @type {any} */ let api;

const [React, { createRoot }, X] = await Promise.all([import("react"), import("react-dom/client"), import("@excalidraw/excalidraw")]);
let elements;
try {
  const mod = await import(new URL(`./${name}?v=${Date.now()}`, location.href).href);
  elements = X.convertToExcalidrawElements(build(mod.default), { regenerateIds: false });
  document.title = mod.title ?? name;
} catch (e) {
  msg(String(/** @type {any} */ (e)?.stack ?? e));
  throw e;
}
createRoot(/** @type {HTMLElement} */ (document.getElementById("root"))).render(React.createElement(X.Excalidraw, {
  initialData: { elements, files: {}, appState: { viewBackgroundColor: "#ffffff" } },
  excalidrawAPI: (/** @type {any} */ a) => {
    api = a;
    // text was measured before Excalidraw's font loaded: measure it again once it has, or labels get clipped
    document.fonts.ready.then(() => setTimeout(() => a.updateScene({ elements: X.restoreElements(a.getSceneElements(), null, { refreshDimensions: true, repairBindings: true }) }), 300));
    setTimeout(() => a.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.95, animate: false }), 50);
  },
}));

// ---- copy for LLM
const r = (/** @type {number} */ n) => Math.round(n);
const q = (/** @type {string} */ s) => JSON.stringify(s.replace(/\n/g, "⏎")).slice(1, -1);
function lines(/** @type {any[]} */ all, /** @type {Set<string>} */ sel) {
  const byId = new Map(all.map((e) => [e.id, e]));
  const nm = (/** @type {any} */ e) => e.customData?.x ? e.id : "*" + e.id.slice(0, 5);  // * = drawn by hand
  const label = (/** @type {any} */ e) => {
    const t = (e.boundElements ?? []).map((b) => byId.get(b.id)).find((b) => b?.type === "text");
    return t ? ` "${q(t.originalText ?? t.text)}"` : "";
  };
  const out = [];
  for (const e of all) {
    if (e.isDeleted || (sel.size && !sel.has(e.id))) continue;
    if (e.type === "text" && e.containerId && byId.has(e.containerId)) continue;  // folded into its container
    const st = [e.backgroundColor !== "transparent" && e.backgroundColor, e.strokeStyle !== "solid" && e.strokeStyle].filter(Boolean).join(" ");
    if (e.type === "arrow" || e.type === "line") {
      const pts = e.points.map((/** @type {number[]} */ p) => `${r(e.x + p[0])},${r(e.y + p[1])}`);
      const a = e.startBinding ? nm(byId.get(e.startBinding.elementId) ?? { id: e.startBinding.elementId }) : pts[0];
      const b = e.endBinding ? nm(byId.get(e.endBinding.elementId) ?? { id: e.endBinding.elementId }) : pts[pts.length - 1];
      const via = pts.length > 2 ? ` via ${pts.slice(1, -1).join(" ")}` : "";
      out.push(`${nm(e)} ${e.type} ${a} -> ${b}${via}${st ? " " + st : ""}${label(e)}`);
    } else if (e.type === "text") {
      out.push(`${nm(e)} text ${r(e.x)},${r(e.y)} "${q(e.originalText ?? e.text)}"`);
    } else if (e.type === "freedraw") {
      out.push(`${nm(e)} freedraw ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)}`);
    } else {
      out.push(`${nm(e)} ${e.type} ${r(e.x)},${r(e.y)} ${r(e.width)}x${r(e.height)}${st ? " " + st : ""}${label(e)}`);
    }
  }
  return out;
}
async function copy() {
  if (!api) return;
  const all = api.getSceneElements(), sel = new Set(Object.keys(api.getAppState().selectedElementIds ?? {}));
  const body = lines(all, sel);
  const t = `# ${name}: ${sel.size ? body.length + " selected" : "everything"}  (id type x,y wxh [fill] "label"; * = drawn by hand)\n` + body.join("\n") + "\n";
  try { await navigator.clipboard.writeText(t); } catch {
    const ta = Object.assign(document.createElement("textarea"), { value: t });
    document.body.append(ta); ta.select(); document.execCommand("copy"); ta.remove();
  }
  const b = /** @type {HTMLElement} */ (document.getElementById("copy"));
  b.textContent = `copied ${body.length}`; setTimeout(() => (b.textContent = "copy for LLM"), 1200);
}
document.getElementById("copy")?.addEventListener("click", copy);
window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === "c") { e.preventDefault(); e.stopPropagation(); copy(); }
}, true);
