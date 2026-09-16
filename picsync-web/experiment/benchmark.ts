import { Worker, isMainThread, parentPort, workerData } from "node:worker_threads";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { cpus, platform, arch } from "node:os";
import { basename, resolve } from "node:path";
import { parseArgs } from "node:util";
import { decodeStrip } from "./decode-strip.js";
import { stitchStrips } from "./stitch-strips.js";

const modernURL = new URL("libraw.js", import.meta.resolve("libraw-modern"));

if (!isMainThread) {
  try {
    const { default: createModule } = await import(modernURL.href);
    const result = await decodeStrip(() => createModule({ wasmBinary: workerData.wasm }), workerData);
    parentPort!.postMessage(result, [result.rgb.buffer]);
  } catch (error) {
    parentPort!.postMessage({ error: error instanceof Error ? error.message : String(error) });
  } finally {
    parentPort!.close();
  }
} else {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2), allowPositionals: true,
    options: { rounds: { type: "string", default: "3" }, warmups: { type: "string", default: "1" },
      output: { type: "string" } },
  });
  const rounds = Number(values.rounds), warmups = Number(values.warmups);
  if (!positionals.length || !Number.isInteger(rounds) || rounds < 1 ||
      !Number.isInteger(warmups) || warmups < 0) {
    throw new Error("Usage: bun experiment/benchmark.ts [--rounds 3] [--warmups 1] [--output report.json] file.ARW ...");
  }
  const wasm = new Uint8Array(await readFile(new URL("libraw.wasm", modernURL)));
  const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
  type Strip = Awaited<ReturnType<typeof decodeStrip>>;
  async function run(bytes: Uint8Array, halfSize: boolean, count: number) {
    const workers: Worker[] = [];
    const started = performance.now();
    try {
      const strips: Strip[] = await Promise.all(Array.from({ length: count }, (_, index) =>
        new Promise<Strip>((resolve, reject) => {
          // A fresh worker/heap each time, like the browser. Input and WASM file
          // reads are outside the timer; worker startup, cloning and init are in it.
          const worker = new Worker(new URL(import.meta.url), {
            workerData: { bytes, wasm, halfSize, count, index },
          });
          workers.push(worker);
          let received = false;
          const timer = setTimeout(() => reject(new Error("Worker timed out after 120s")), 120000);
          worker.once("error", error => { clearTimeout(timer); reject(error); });
          worker.once("exit", code => {
            clearTimeout(timer);
            if (!received) reject(new Error(`Worker exited without output (${code})`));
          });
          worker.once("message", data => {
            received = true;
            clearTimeout(timer);
            if (data.error) reject(new Error(data.error)); else resolve(data);
          });
        })));
      const decoded = performance.now();
      const { rgba, width, height } = stitchStrips(strips);
      const packed = performance.now();
      return { count, width, height, decodeMs: decoded - started,
        packMs: packed - decoded, totalMs: packed - started,
        sha256: sha256(rgba),
        strips: strips.map(({ openMs, imageMs }) => ({ openMs, imageMs })) };
    } finally {
      await Promise.all(workers.map(worker => worker.terminate()));
    }
  }
  const results = [];
  for (const file of positionals) {
    const bytes = new Uint8Array(await readFile(resolve(file)));
    for (const halfSize of [true, false]) {
      let reference: string | undefined;
      for (let round = -warmups; round < rounds; round++) {
        // Rotate order to distribute warm cache / thermal / ordering effects.
        const order = [1, 2, 4];
        const offset = Math.max(0, round) % order.length;
        for (const count of [...order.slice(offset), ...order.slice(0, offset)]) {
          const result = await run(bytes, halfSize, count);
          reference ??= result.sha256;
          if (reference !== result.sha256) throw new Error(`${basename(file)}: ${count}-worker output differs from baseline`);
          console.error(`${basename(file)} ${halfSize ? "half" : "full"} ${count} worker(s) ${round < 0 ? "warmup" : `round ${round + 1}`}: ${result.totalMs.toFixed(0)} ms, pixels match`);
          if (round >= 0) results.push({ name: basename(file), inputSha256: sha256(bytes), halfSize, round: round + 1, ...result });
        }
      }
    }
  }
  const report = { timestamp: new Date().toISOString(), runtime: process.versions,
    platform: platform(), arch: arch(), cpu: cpus()[0]?.model, logicalCPUs: cpus().length,
    decoder: "libraw-wasm@1.6.0", wasmSha256: sha256(wasm), rounds, warmups, results };
  const json = JSON.stringify(report, null, 2) + "\n";
  if (values.output) await writeFile(values.output, json);
  else console.log(json);
}
