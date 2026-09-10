import { $ } from "bun";
await $`rm -rf dist`;
await $`bunx tsc --emitDeclarationOnly`;
// Build the runtime implementation directly: Bun 1.4's sideEffects optimization
// incorrectly drops a re-export-only root entry. Declarations use src/index.ts.
for (const [entry, name] of [
  ["src/controller.ts", "index.js"],
  ["src/react.tsx", "react.js"],
  ["src/editor.tsx", "editor.js"],
]) {
  const result = await Bun.build({
    entrypoints: [entry!],
    outdir: "dist",
    naming: name!,
    target: "browser",
    jsx: { runtime: "automatic", development: false },
    external: ["react", "react/jsx-runtime", "@kev-browser-agent-kit/workspace", "@kev-browser-agent-kit/workspace/react"],
  });
  if (!result.success) throw new AggregateError(result.logs);
}
await Bun.write("dist/styles.css", Bun.file("src/styles.css"));
await Bun.write("dist/editor.css", `${await Bun.file("src/styles.css").text()}\n${await Bun.file("src/editor.css").text()}`);
