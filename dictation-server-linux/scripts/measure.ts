// Measurements on the real model and GPU: cold start, repeated recordings in one process, one long
// real-time recording, and the idle exit. Spawns its own service; needs ffmpeg and nvidia-smi.
// Run: bun scripts/measure.ts [port=19877]
import { join } from "node:path";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const port = process.argv[2] ?? "19877";
const url = `http://127.0.0.1:${port}`;
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const median = (values: number[]) => values.toSorted((a, b) => a - b)[values.length >> 1]!;
const round = (value: number) => Math.round(value);

function gpuMiB(pid?: number) {
  const rows = Bun.spawnSync(["nvidia-smi", "--query-compute-apps=pid,used_memory", "--format=csv,noheader,nounits"]).stdout.toString()
    .trim().split("\n").filter(Boolean).map(row => row.split(",").map(Number));
  return pid === undefined ? rows.reduce((sum, row) => sum + row[1]!, 0) : rows.find(row => row[0] === pid)?.[1] ?? 0;
}
const rssMiB = (pid: number) => round(Number(readFileSync(`/proc/${pid}/status`, "utf8").match(/VmRSS:\s+(\d+)/)![1]) / 1024);

async function launch(...flags: string[]) {
  const start = performance.now();
  const child = Bun.spawn([join(import.meta.dir, "../run.sh"), "--port", port, ...flags], { stdout: "ignore", stderr: "ignore" });
  let alive = 0;
  for (;;) {
    assert(child.exitCode === null && performance.now() - start < 30_000, "Service did not become ready");
    try {
      if (!alive && (await fetch(`${url}/healthz`)).ok) alive = performance.now() - start;
      if (alive && (await (await fetch(`${url}/v1/status`)).json() as any).state === "ready") break;
    } catch {}
    await pause(5);
  }
  return { child, aliveMs: round(alive), readyMs: round(performance.now() - start) };
}

// One recording. Real time sends 80 ms frames on a microphone's schedule; otherwise frames go as fast
// as acknowledgments allow (one second in flight, like a browser replaying buffered audio).
async function record(audio: Uint8Array, realtime: boolean) {
  const id = crypto.randomUUID();
  const ws = new WebSocket(`${url.replace(/^http/, "ws")}/v1/stream`);
  const sentAt: number[] = [];
  const chunks: { at: number; ms: number }[] = [];
  let slow = false, acked = 0, final: string | undefined, failure: string | undefined, ready = false, done = false, firstPartial = 0;
  const begun = performance.now();
  ws.onmessage = event => {
    const value = JSON.parse(String(event.data));
    if (value.type === "ready") ready = true;
    if (value.type === "partial" && value.text && !firstPartial) firstPartial = performance.now();
    if (value.type === "ack") {
      // Only the frame that completes a chunk runs inference; the rest are acknowledged at once,
      // or wait behind it. Count the frame that ran.
      const ms = performance.now() - sentAt[acked]!;
      if (realtime && ms > 5 && !slow) chunks.push({ at: acked * 0.08, ms });
      slow = ms > 5;
      acked++;
    }
    if (value.type === "final") final = value.text;
    if (value.type === "error") failure = value.code;
    if (value.type === "done") done = true;
  };
  ws.onopen = () => ws.send(JSON.stringify({ type: "start", version: 1, recordingId: id, sampleRate: 16000, channels: 1, format: "f32le" }));
  const until = async (condition: () => boolean) => { while (!condition()) { assert(!failure, failure); await pause(1); } };
  await until(() => ready);
  const readyMs = performance.now() - begun;
  const audioStart = performance.now();
  for (let offset = 0, frame = 0; offset < audio.length; offset += 5120, frame++) {
    if (realtime) await pause(audioStart + (frame + 1) * 80 - performance.now());
    else await until(() => frame - acked < 12);
    sentAt.push(performance.now());
    ws.send(audio.subarray(offset, offset + 5120));
  }
  await until(() => acked === sentAt.length);
  const stop = performance.now();
  ws.send(JSON.stringify({ type: "stop", recordingId: id }));
  await until(() => done);
  return { text: final!, readyMs, chunks, flushMs: performance.now() - stop, firstPartialMs: firstPartial - audioStart, wallMs: performance.now() - begun };
}

const ffmpeg = Bun.spawnSync(["ffmpeg", "-loglevel", "error", "-i", join(import.meta.dir, "../fixtures/librispeech-sample.flac"), "-f", "f32le", "-ar", "16000", "-ac", "1", "-"]);
const audio = new Uint8Array(ffmpeg.stdout);
assert(audio.length, "Missing fixture audio");
const baseline = gpuMiB();
console.log(`GPU memory in use by other processes: ${baseline} MiB`);

console.log("\n## cold start (run.sh launch -> healthz, -> model ready)");
const cold: number[] = [];
for (let i = 0; i < 5; i++) {
  const { child, aliveMs, readyMs } = await launch("--idle-minutes", "0");
  cold.push(readyMs);
  console.log(`run ${i + 1}: healthz ${aliveMs} ms, ready ${readyMs} ms, GPU ${gpuMiB(child.pid)} MiB, RSS ${rssMiB(child.pid)} MiB`);
  child.kill();
  await child.exited;
}
console.log(`median ready ${median(cold)} ms`);

console.log("\n## 20 consecutive recordings in one process (13.7 s fixture, sent as fast as acknowledged)");
const { child } = await launch("--idle-minutes", "0.1");
const before = { gpu: gpuMiB(child.pid), rss: rssMiB(child.pid) };
const cycles: Awaited<ReturnType<typeof record>>[] = [];
for (let i = 0; i < 20; i++) cycles.push(await record(audio, false));
assert(cycles.every(cycle => cycle.text === cycles[0]!.text), "Transcript changed between recordings");
console.log(`transcript (identical 20 times): ${cycles[0]!.text}`);
console.log(`wall ms per recording: ${cycles.map(cycle => round(cycle.wallMs)).join(" ")}`);
console.log(`start -> ready ms: ${cycles.map(cycle => round(cycle.readyMs)).join(" ")}`);
console.log(`GPU ${before.gpu} -> ${gpuMiB(child.pid)} MiB, RSS ${before.rss} -> ${rssMiB(child.pid)} MiB`);

console.log("\n## one real-time recording, fixture x14 = 192 s");
const long = new Uint8Array(audio.length * 14);
for (let i = 0; i < 14; i++) long.set(audio, i * audio.length);
const beforeLong = { gpu: gpuMiB(child.pid), rss: rssMiB(child.pid) };
const result = await record(long, true);
const repeats = result.text.match(/slushy country roads/g)?.length ?? 0;
console.log(`first partial ${round(result.firstPartialMs)} ms after first frame, flush ${round(result.flushMs)} ms, ${result.text.length} characters, sentence found ${repeats}/14 times`);
for (let minute = 0; minute * 60 < 192; minute++) {
  const ms = result.chunks.filter(chunk => chunk.at >= minute * 60 && chunk.at < minute * 60 + 60).map(chunk => chunk.ms);
  console.log(`minute ${minute + 1}: ${ms.length} chunks, frame -> ack median ${round(median(ms))} ms, max ${round(Math.max(...ms))} ms`);
}
console.log(`GPU ${beforeLong.gpu} -> ${gpuMiB(child.pid)} MiB, RSS ${beforeLong.rss} -> ${rssMiB(child.pid)} MiB`);
console.log(`transcript tail: …${result.text.slice(-160)}`);
assert.equal(repeats, 14, "Long recording lost or garbled a repetition");

console.log("\n## idle exit (--idle-minutes 0.1)");
const idleSince = performance.now();
const code = await child.exited;
console.log(`exited with status ${code} ${((performance.now() - idleSince) / 1000).toFixed(1)} s after the last recording; GPU now ${gpuMiB()} MiB (baseline ${baseline})`);
assert.equal(code, 0);
await assert.rejects(fetch(`${url}/healthz`));
process.exit(0);
