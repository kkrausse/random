// Local real-model integration check; generates a known fixture using macOS say.
// Run: bun scripts/verify.ts [http://127.0.0.1:19876]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

const url = process.argv[2] ?? "http://127.0.0.1:19876";
const directory = await mkdtemp(join(tmpdir(), "dictation-fixture-"));
const events: any[] = [];
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const id = crypto.randomUUID();
  const ws = new WebSocket(`${url.replace(/^http/, "ws")}/v1/stream`);
  const received: any[] = [];
  const start = performance.now();
  ws.onmessage = event => {
    const value = JSON.parse(String(event.data));
    received.push(value);
    events.push({ ...value, ms: Math.round(performance.now() - start) });
  };
  await wait(() => ws.readyState === WebSocket.OPEN);
  ws.send(JSON.stringify({ type: "start", version: 1, recordingId: id, sampleRate: 16000, channels: 1, format: "f32le" }));
  return { ws, id, received, start };
}
async function wait(condition: () => boolean, timeout = 120_000) {
  const deadline = Date.now() + timeout;
  while (!condition()) { assert(Date.now() < deadline, "Timed out"); await pause(20); }
}
async function ready(recording: Awaited<ReturnType<typeof connect>>) {
  await wait(() => recording.received.some(e => e.type === "ready" || e.type === "error"));
  assert(!recording.received.some(e => e.type === "error"), JSON.stringify(recording.received));
}
async function finish(recording: Awaited<ReturnType<typeof connect>>, bytes?: Uint8Array) {
  if (bytes) for (let offset = 0; offset < bytes.length; offset += 5120) {
    recording.ws.send(bytes.slice(offset, offset + 5120));
    await pause(80);
  }
  const stop = performance.now();
  recording.ws.send(JSON.stringify({ type: "stop", recordingId: recording.id }));
  await wait(() => recording.received.some(e => e.type === "done" || e.type === "error"));
  const received = recording.received;
  assert(!received.some(e => e.type === "error"), JSON.stringify(received));
  assert.equal(received.at(-2).type, "final");
  assert.equal(received.at(-1).type, "done");
  assert.equal(received.filter(e => e.type === "final").length, 1);
  received.forEach((event, index) => assert.equal(event.sequence, index));
  console.log(JSON.stringify({ readyMs: Math.round(events.find(e => e.recordingId === recording.id && e.type === "ready").ms),
    firstPartialMs: events.find(e => e.recordingId === recording.id && e.type === "partial" && e.text)?.ms,
    flushMs: Math.round(performance.now() - stop), final: received.at(-2).text }));
  return received.at(-2).text as string;
}

try {
  const fixture = join(directory, "fixture.wav");
  const say = Bun.spawn(["say", "-v", "Samantha", "-o", fixture, "--file-format=WAVE", "--data-format=LEF32@16000", "The quick brown fox jumps over the lazy dog."], { stderr: "inherit" });
  assert.equal(await say.exited, 0);
  const wav = Buffer.from(await Bun.file(fixture).arrayBuffer());
  let audio: Uint8Array | undefined;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4);
    if (wav.toString("ascii", offset, offset + 4) === "data") { audio = wav.subarray(offset + 8, offset + 8 + size); break; }
    offset += 8 + size + size % 2;
  }
  assert(audio?.length, "Missing WAV data");
  const first = await connect();
  await ready(first);
  const competing = await connect();
  await wait(() => competing.received.some(e => e.type === "error"));
  assert.equal(competing.received.at(-1).code, "busy");
  const text = await finish(first, audio);
  assert.match(text.toLowerCase(), /quick brown fox/);
  assert.match(text.toLowerCase(), /dog[.!]?$/);
  const second = await connect();
  await ready(second);
  assert.equal(await finish(second), "", "Decoder leaked previous text into silence");
  const canceled = await connect();
  await ready(canceled);
  canceled.ws.send(audio.slice(0, 5120));
  canceled.ws.send(JSON.stringify({ type: "cancel", recordingId: canceled.id }));
  await wait(() => canceled.ws.readyState === WebSocket.CLOSED);
  const resetDeadline = Date.now() + 10_000;
  while ((await (await fetch(`${url}/v1/status`)).json() as any).state !== "ready") {
    assert(Date.now() < resetDeadline, "Cancellation did not reset decoder");
    await pause(20);
  }
  const third = await connect();
  await ready(third);
  assert.equal(await finish(third), "");
  const invalid = await connect();
  await ready(invalid);
  invalid.ws.send(new Uint8Array([0, 0, 192, 127]));
  await wait(() => invalid.received.some(e => e.type === "error"));
  assert.equal(invalid.received.at(-1).code, "invalid_audio");
  const readyDeadline = Date.now() + 10_000;
  while ((await (await fetch(`${url}/v1/status`)).json() as any).state !== "ready") {
    assert(Date.now() < readyDeadline, "Invalid audio did not reset decoder");
    await pause(20);
  }
  const flooded = await connect();
  await ready(flooded);
  for (let i = 0; i < 200; i++) flooded.ws.send(new Uint8Array(6400));
  await wait(() => flooded.received.some(e => e.type === "error"));
  assert.equal(flooded.received.at(-1).code, "overload");
  console.log("PASS: model reuse, timed audio, busy, final ordering/tail, warm reset, cancel, invalid audio, queue overload");
} finally {
  await rm(directory, { recursive: true, force: true });
}
