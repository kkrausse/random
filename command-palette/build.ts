import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;
const outdir = join(root, "dist");

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });

const result = await Bun.build({
  entrypoints: [join(root, "src/background.ts"), join(root, "src/palette.tsx")],
  outdir,
  target: "browser",
  format: "esm",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  minify: true,
  sourcemap: "external"
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const css = Bun.spawnSync(
  [join(root, "node_modules/.bin/tailwindcss"), "-i", join(root, "src/styles.css"), "-o", join(outdir, "palette.css"), "--minify"],
  { cwd: root, stdout: "inherit", stderr: "pipe" }
);
if (css.exitCode !== 0) {
  console.error(css.stderr.toString());
  process.exit(1);
}

for (const asset of ["manifest.json", "palette.html"]) {
  cpSync(join(root, asset), join(outdir, asset));
}

console.log(`Built ${result.outputs.length} files and palette.css in command-palette/dist`);
