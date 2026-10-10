// The JS mel front end against the features ort-bench dumped from nemo128.onnx (cache/dump).
// usage: bun check-mel.ts
import { logMel } from "./src/mel";
const cache = `${import.meta.dir}/../cache`;
const f32 = async (p: string) => new Float32Array(await Bun.file(p).arrayBuffer());
const fb = await f32(`${cache}/onnx-tdt-v2/melfb-257x128.f32`);
for (const [clip, frames] of [["a07", 701], ["a14", 1370], ["a56", 5611]] as const) {
  const audio = await f32(`${cache}/audio/${clip}.f32`);
  const want = await f32(`${cache}/dump/${clip}.feat-128x${frames}.f32`);
  const t = performance.now();
  const got = logMel(audio, fb);
  const ms = performance.now() - t;
  let worst = 0, sum = 0;
  for (let i = 0; i < want.length; i++) { const d = Math.abs(got.features[i] - want[i]); worst = Math.max(worst, d), sum += d; }
  console.log(`${clip}: frames ${got.frames} (want ${frames}), max abs diff ${worst.toExponential(2)}, mean ${(sum / want.length).toExponential(2)}, ${ms.toFixed(1)} ms`);
}
