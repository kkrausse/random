import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";

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
const buildId = Date.now().toString(36);

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

const workerOutput = worker.outputs[0];
if (!workerOutput) {
  console.error("Analysis worker build did not produce output.");
  process.exit(1);
}

const worklet = await Bun.build({
  entrypoints: ["./public/feature-worklet.ts"],
  target: "browser",
  format: "esm",
  minify: true,
});
assertBuild(worklet, "feature worklet");

const workletOutput = worklet.outputs[0];
if (!workletOutput) {
  console.error("Feature worklet build did not produce output.");
  process.exit(1);
}

const writeHashedAsset = async (baseName: string, output: Bun.BuildArtifact) => {
  const buffer = Buffer.from(await output.arrayBuffer());
  const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
  const fileName = `${baseName}.${hash}.js`;
  await writeFile(`./dist/${fileName}`, buffer);
  return `./${fileName}`;
};

const analysisWorkerUrl = await writeHashedAsset("analysis-worker", workerOutput);
const featureWorkletUrl = await writeHashedAsset("feature-worklet", workletOutput);
const indexHtml = await readFile("./dist/index.html", "utf8");

await writeFile(
  "./dist/index.html",
  indexHtml
    .replace('"./analysis-worker.js"', `"${analysisWorkerUrl}"`)
    .replace('"./feature-worklet.js"', `"${featureWorkletUrl}"`)
    .replace('"dev"', `"${buildId}"`),
);
