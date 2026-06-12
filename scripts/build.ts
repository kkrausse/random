import { mkdir, rm } from "node:fs/promises";

const assertBuild = (result: Bun.BuildOutput, label: string) => {
  if (result.success) return;

  console.error(`Failed to build ${label}.`);
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
};

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

assertBuild(
  await Bun.build({
    entrypoints: ["./public/index.html"],
    outdir: "./dist",
    minify: true,
  }),
  "index",
);

const worker = await Bun.build({
  entrypoints: ["./public/analysis-worker.ts"],
  target: "browser",
  format: "esm",
  minify: true,
});
assertBuild(worker, "analysis worker");

if (!worker.outputs[0]) {
  console.error("Analysis worker build did not produce output.");
  process.exit(1);
}

await Bun.write("./dist/analysis-worker.js", worker.outputs[0]);
await Bun.write("./dist/feature-worklet.js", Bun.file("./public/feature-worklet.js"));
