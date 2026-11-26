// Builds <FaplexEmbed> for other apps: dist-embed/faplex-embed.js (ES module; React comes from the
// host) and faplex-embed.css. `bun scripts/build-embed.ts [outdir]`
import { rm } from "node:fs/promises";
import { join } from "node:path";
const root = join(import.meta.dir, "..");
const outdir = process.argv[2] ?? join(root, "dist-embed");
await rm(outdir, { recursive: true, force: true });
const tailwind = (await import("bun-plugin-tailwind")).default;
const r = await Bun.build({
  entrypoints: [join(root, "src/embed/entry.ts")],
  outdir,
  target: "browser",
  format: "esm",
  minify: true,
  naming: "faplex-embed.[ext]",
  external: ["react", "react-dom", "react/jsx-runtime", "react-dom/client"],
  plugins: [tailwind],
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
});
if (!r.success) { for (const l of r.logs) console.error(l); process.exit(1); }
for (const o of r.outputs) console.log(`${o.path} ${(o.size / 1024).toFixed(0)} KB`);
