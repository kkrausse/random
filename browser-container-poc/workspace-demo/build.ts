import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export const root = import.meta.dir;
export async function diagnosticBundle() {
  const result = await Bun.build({ entrypoints: [resolve(root, "src/diagnostics.ts")], target: "browser", format: "iife" });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return result.outputs[0]!.text();
}
export async function bundle() {
  return (await browserAssets()).main;
}
export async function browserAssets() {
  const result = await Bun.build({ entrypoints: [resolve(root, "src/main.tsx")], target: "browser", format: "esm", splitting: true, outdir: resolve(root, "dist/assets"), publicPath: "/assets/", minify: false });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  const files = new Map<string, string>();
  for (const output of result.outputs) files.set("/assets/" + output.path.split("/").at(-1), await output.text());
  const main = files.get("/assets/main.js")!;
  // Only the static normal-app graph is public. Lazy editor chunks require server policy.
  const publicPaths = new Set<string>();
  const scan = new Bun.Transpiler({ loader: "js" });
  const visit = (path: string) => {
    if (publicPaths.has(path) || !files.has(path)) return;
    publicPaths.add(path);
    for (const item of scan.scan(files.get(path)!).imports) if (item.kind !== "dynamic-import") visit(new URL(item.path, "http://build" + path).pathname);
  };
  visit("/assets/main.js");
  return { main, files, publicPaths };
}
export async function styles() {
  const child = Bun.spawn([process.execPath, "x", "--no-install", "@tailwindcss/cli", "-i", `${root}/src/styles.css`, "--minify"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [css, errors, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit) throw Error(errors);
  return css;
}
if (import.meta.main) {
  await mkdir(resolve(root, "dist"), { recursive: true });
  await Bun.write(resolve(root, "dist/diagnostics.js"), await diagnosticBundle());
  for (const [path, contents] of (await browserAssets()).files) await Bun.write(resolve(root, "dist" + path), contents);
  await Promise.all([Bun.write(resolve(root, "dist/index.html"), Bun.file(resolve(root, "index.html"))), Bun.write(resolve(root, "dist/app.js"), await bundle()), Bun.write(resolve(root, "dist/app.css"), await styles())]);
  console.log("Built dist/index.html, dist/app.js and dist/app.css (React host + OpenCode client)");
}
