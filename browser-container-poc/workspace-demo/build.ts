import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

export const root = import.meta.dir;
export async function bundle() {
  const entry = resolve(root, "src/main.tsx");
  const result = await Bun.build({ entrypoints: [entry], target: "browser", format: "esm", minify: false });
  if (!result.success) throw new Error(result.logs.map(String).join("\n"));
  return result.outputs[0]!.text();
}
export async function styles() {
  const child = Bun.spawn([process.execPath, "x", "--no-install", "@tailwindcss/cli", "-i", `${root}/src/styles.css`, "--minify"], { cwd: root, stdout: "pipe", stderr: "pipe" });
  const [css, errors, exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit) throw Error(errors);
  return css;
}
if (import.meta.main) {
  await mkdir(resolve(root, "dist"), { recursive: true });
  await Promise.all([Bun.write(resolve(root, "dist/index.html"), Bun.file(resolve(root, "index.html"))), Bun.write(resolve(root, "dist/app.js"), await bundle()), Bun.write(resolve(root, "dist/app.css"), await styles())]);
  console.log("Built dist/index.html, dist/app.js and dist/app.css (React host + OpenCode client)");
}
