#!/usr/bin/env bun
// bun dg.ts <diagram.js> [--only <title>] [--focus <id>] [--png <out.png>] [--pub <slug>]
// Type-checks, lints, lays out and renders a diagram file; prints a short report. --pub publishes the file's folder.
import ELK from "elkjs/lib/elk.bundled.js";
import { Resvg } from "@resvg/resvg-js";
import { dirname, resolve, basename } from "path";
import "./core.js";

const t0 = performance.now();
if (process.argv[2] === "--lib") {  // publish the viewer (index.html, core.js, elk.js) as slug "diagram"
  const d = `${process.env.CLAUDE_JOB_DIR ? process.env.CLAUDE_JOB_DIR + "/tmp" : "/tmp"}/dg-lib`;
  Bun.spawnSync(["rm", "-rf", d]); Bun.spawnSync(["mkdir", "-p", d]);
  for (const f of ["index.html", "core.js", "elk.js"]) await Bun.write(`${d}/${f}`, Bun.file(`${import.meta.dir}/${f}`));
  const p = Bun.spawnSync([`${import.meta.dir}/../../scripts/deploy-artifact.sh`, d, "diagram"], { stdout: "pipe", stderr: "pipe" });
  console.log((p.stdout.toString() + p.stderr.toString()).trim().split("\n").pop()); process.exit(p.exitCode ?? 0);
}
const argv = process.argv.slice(2), opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv.splice(i, 2)[1] : undefined; };
const only = opt("--only"), focus = opt("--focus"), pub = opt("--pub"), scaleArg = opt("--scale");
const file = argv[0];
if (!file) { console.error("usage: bun dg.ts <diagram.js> [--only <title>] [--focus <id>] [--png out.png] [--pub <slug>]"); process.exit(2); }
const path = resolve(file), dir = dirname(path), here = import.meta.dir;
const tmp = process.env.CLAUDE_JOB_DIR ? `${process.env.CLAUDE_JOB_DIR}/tmp` : "/tmp";
const png = opt("--png") ?? `${tmp}/dg-${basename(path, ".js")}${only ? "-" + only : ""}${focus ? "-" + focus : ""}.png`;

// type check in parallel (tsgo, the native TypeScript)
const tc = Bun.spawn([`${here}/node_modules/.bin/tsgo`, "--ignoreConfig", "--noEmit", "--strict", "false", "--allowJs", "--checkJs", "--skipLibCheck", "--target", "esnext",
  "--lib", "esnext", "--types", "", "--pretty", "false", path, `${here}/dg.d.ts`], { stdout: "pipe", stderr: "pipe" });

// run the file
const G_: any = globalThis, DG = G_.DG;
DG.reset();
import { runInThisContext } from "vm";
try { runInThisContext(await Bun.file(path).text(), { filename: path }); } catch (e: any) {  // real file name + line numbers
  const at = String(e.stack).split("\n").find((l) => l.includes(basename(path))) ?? "";
  console.log(`ERROR running ${basename(path)}: ${e.message} ${at.trim()}`); process.exit(1);
}
const titles = DG.all.map((d: any) => d.title);
if (only && !titles.includes(only)) { console.log(`--only ${only}: no such diagram (have: ${titles.join(", ")})`); process.exit(1); }
const page = await DG.layoutPage(DG.all, ELK, { only });
const types = (await new Response(tc.stdout).text()).trim().split("\n").filter(Boolean).map((l) => l.replace(/^\S*?([^/\s]+\.js)\(/, "$1("));

// render
let view;
if (focus) {
  const it = page.items.find((i: any) => i.id === focus);
  if (!it) { console.log(`--focus ${focus}: no such id`); process.exit(1); }
  const b = DG.bbox([it]), W = 1800, H = 1300;
  view = { x: b.x + b.w / 2 - W / 2, y: b.y + b.h / 2 - H / 2, w: W, h: H };
}
const svg = DG.toSvg(page, DG.all, { view, img: (s: string) => resolve(dir, s) });
const B = view ?? DG.bbox(page.items), long = Math.max(B.w, B.h);
const scale = scaleArg ? +scaleArg : focus ? 1 : Math.min(1, 6000 / long);
const r = new Resvg(svg, { fitTo: { mode: "zoom", value: scale }, font: { loadSystemFonts: true, defaultFontFamily: "DejaVu Sans Mono" } });
for (const href of r.imagesToResolve()) { try { r.resolveImage(href, Buffer.from(await Bun.file(href).arrayBuffer())); } catch {} }
const out = r.render();
await Bun.write(png, out.asPng());

// report
const n = (t: string) => page.items.filter((i: any) => i.t === t && !i.legend && !String(i.id).startsWith("legend.")).length;
console.log(`${DG.all.filter((d: any) => !only || d.title === only).map((d: any) => d.title).join(", ")}: ${n("node")} boxes, ${n("group")} groups, ${n("edge")} edges` +
  ` · ${out.width}×${out.height} px PNG (scale ${scale.toFixed(2)}): ${png}`);
const issues = [...types.map((l) => `type: ${l}`), ...(DG.meta.title ? [] : ['no title("…") call: give the page a specific name (it is the browser tab)']), ...page.lint];
if (issues.length) { console.log(`${issues.length} issue(s):`); for (const l of issues.slice(0, 40)) console.log("  " + l); if (issues.length > 40) console.log(`  … ${issues.length - 40} more`); }
else console.log("no issues");
if (pub) {
  const p = Bun.spawnSync([`${here}/../../scripts/deploy-artifact.sh`, dir, pub], { stdout: "pipe", stderr: "pipe" });
  const url = (p.stdout.toString() + p.stderr.toString()).match(/https:\S+/)?.[0];
  console.log(url ? `published: ${url.replace(/\/artifacts\/.*/, "")}/artifacts/diagram/?s=../${pub}/${basename(path)}` : `publish failed: ${p.stderr}`);
}
console.log(`${Math.round(performance.now() - t0)} ms`);
process.exit(0);
