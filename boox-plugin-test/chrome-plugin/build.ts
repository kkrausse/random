import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const outdir = join(root, "dist");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [
    join(root, "src/background.ts"),
    join(root, "src/content.ts"),
    join(root, "src/sidepanel.tsx")
  ],
  outdir,
  target: "browser",
  format: "esm",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  minify: false,
  sourcemap: "external"
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

for (const asset of ["manifest.json", "sidepanel.css", "sidepanel.html"]) {
  cpSync(join(root, asset), join(outdir, asset));
}

console.log(`Built ${result.outputs.length} scripts and source maps in chrome-plugin/dist`);
