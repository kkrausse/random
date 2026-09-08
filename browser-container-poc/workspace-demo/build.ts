import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export const root = import.meta.dir;
export async function bundle() {
  const entry = resolve(root, "src/main.ts");
  const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: false });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return result.outputs[0]!.text();
}
if (import.meta.main) {
  await mkdir(resolve(root, "dist"), { recursive: true });
  await Promise.all([Bun.write(resolve(root, "dist/index.html"), Bun.file(resolve(root, "index.html"))), Bun.write(resolve(root, "dist/app.js"), await bundle())]);
  console.log("Built dist/index.html and dist/app.js (includes OpenCode client)");
}
