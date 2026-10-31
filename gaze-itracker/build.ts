// Static page in dist/: index.html + main.js. The model runs on diesel2 (server/server.py),
// which also serves this dist/ directory.
import { cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
const r = await Bun.build({ entrypoints: ["src/main.ts"], outdir: "dist", target: "browser", format: "esm", minify: true });
if (!r.success) throw new AggregateError(r.logs, "build failed");
await cp("index.html", "dist/index.html");
console.log("built dist/");
