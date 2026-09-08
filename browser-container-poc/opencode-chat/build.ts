import { $ } from "bun";
await $`rm -rf dist`;
await $`bunx tsc --emitDeclarationOnly`;
// Build the runtime implementation directly: Bun 1.4's sideEffects optimization
// incorrectly drops a re-export-only root entry. Declarations use src/index.ts.
for (const [entry, name] of [
  ["src/controller.ts", "index.js"],
  ["src/react.tsx", "react.js"],
]) {
  const result = await Bun.build({
    entrypoints: [entry!],
    outdir: "dist",
    naming: name!,
    target: "browser",
    external: ["react", "react/jsx-runtime"],
  });
  if (!result.success) throw new AggregateError(result.logs);
}
await Bun.write("dist/styles.css", Bun.file("src/styles.css"));
