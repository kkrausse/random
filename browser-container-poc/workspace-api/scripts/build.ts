import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
await rm(resolve(root, "dist/lib"), { recursive: true, force: true });
for (const [entry, target] of [["index.ts", "browser"], ["react.tsx", "browser"], ["assets.ts", "node"], ["server.ts", "node"]] as const) {
  const result = await Bun.build({ entrypoints: [resolve(root, "src", entry)], outdir: resolve(root, "dist/lib"),
    target, format: "esm", jsx: { runtime: "automatic", development: false }, external: ["react", "react/jsx-runtime", "@kev-browser-agent-kit/workspace"], sourcemap: "external" });
  if (!result.success) throw new AggregateError(result.logs, `Build failed: ${entry}`);
}
const types = Bun.spawn(["bun", "x", "--no-install", "tsc", "-p", "tsconfig.build.json"], { cwd: root, stdout: "inherit", stderr: "inherit" });
if (await types.exited) throw Error("Declaration build failed");
