// Local real-model integration check, ported from ../dictation-server/scripts/verify.ts.
// Streams a real LibriSpeech utterance (fixtures/librispeech-sample.flac, decoded with ffmpeg).
// Run: bun scripts/verify.ts [http://127.0.0.1:19876]
import { join } from "node:path";
import assert from "node:assert/strict";

const url = process.argv[2] ?? "http://127.0.0.1:19876";
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
  const audioStart = Math.round(performance.now() - recording.start);
  if (bytes) for (let offset = 0; offset < bytes.length; offset += 5120) {
    recording.ws.send(bytes.slice(offset, offset + 5120));
    await pause(80);
  }
  const stop = performance.now();
  recording.ws.send(JSON.stringify({ type: "stop", recordingId: recording.id }));
  await wait(() => recording.received.some(e => e.type === "done" || e.type === "error"));
  const flushMs = Math.round(performance.now() - stop);
  const received = recording.received;
  assert(!received.some(e => e.type === "error"), JSON.stringify(received));
  assert.equal(received.at(-2).type, "final");
  assert.equal(received.at(-1).type, "done");
  assert.equal(received.filter(e => e.type === "final").length, 1);
  received.forEach((event, index) => assert.equal(event.sequence, index));
  assert.equal(received.findLast(e => e.type === "ack")?.bytes, bytes?.length, "Acknowledged bytes do not match sent audio");
  const mine = events.filter(e => e.recordingId === recording.id);
  const firstPartial = mine.find(e => e.type === "partial" && e.text)?.ms;
  console.log(JSON.stringify({ readyMs: mine.find(e => e.type === "ready").ms,
    // Measured from the first audio frame; the fixture has ~0.4 s of leading silence.
    firstPartialMs: firstPartial === undefined ? undefined : firstPartial - audioStart,
    partials: mine.filter(e => e.type === "partial").length, flushMs, final: received.at(-2).text }));
  return received.at(-2).text as string;
}
async function settled(message: string) {
  const deadline = Date.now() + 10_000;
  while ((await (await fetch(`${url}/v1/status`)).json() as any).state !== "ready") {
    assert(Date.now() < deadline, message);
    await pause(20);
  }
}

const status = await (await fetch(`${url}/v1/status`)).json() as any;
console.log(JSON.stringify({ modelId: status.modelId, state: status.state }));
const ffmpeg = Bun.spawn(["ffmpeg", "-loglevel", "error", "-i", join(import.meta.dir, "../fixtures/librispeech-sample.flac"),
  "-f", "f32le", "-ar", "16000", "-ac", "1", "-"], { stdout: "pipe", stderr: "inherit" });
const audio = new Uint8Array(await new Response(ffmpeg.stdout).arrayBuffer());
assert.equal(await ffmpeg.exited, 0);
assert(audio.length, "Missing fixture audio");
const first = await connect();
await ready(first);
const competing = await connect();
await wait(() => competing.received.some(e => e.type === "error"));
assert.equal(competing.received.at(-1).code, "busy");
const text = await finish(first, audio);
assert.match(text.toLowerCase(), /^going along slushy country roads/);
assert.match(text.toLowerCase(), /immediately afterwards[.!]?$/);
const partials = first.received.filter(e => e.type === "partial").map(e => e.text as string);
assert(partials.length > 5 && partials.some(partial => partial && partial.length < text.length / 2), "Transcript was not incremental");
const second = await connect();
await ready(second);
assert.equal(await finish(second), "", "Decoder leaked previous text into silence");
const canceled = await connect();
await ready(canceled);
canceled.ws.send(audio.slice(0, 5120));
canceled.ws.send(JSON.stringify({ type: "cancel", recordingId: canceled.id }));
await wait(() => canceled.ws.readyState === WebSocket.CLOSED);
assert(!canceled.received.some(e => e.type === "final" || e.type === "done"), "Canceled recording emitted a final");
await settled("Cancellation did not reset decoder");
const third = await connect();
await ready(third);
assert.equal(await finish(third), "");
const invalid = await connect();
await ready(invalid);
invalid.ws.send(new Uint8Array([0, 0, 192, 127]));
await wait(() => invalid.received.some(e => e.type === "error"));
assert.equal(invalid.received.at(-1).code, "invalid_audio");
await settled("Invalid audio did not reset decoder");
const flooded = await connect();
await ready(flooded);
for (let i = 0; i < 200; i++) flooded.ws.send(new Uint8Array(6400));
await wait(() => flooded.received.some(e => e.type === "error"));
assert.equal(flooded.received.at(-1).code, "overload");
await settled("Overload did not reset decoder");
const again = await connect();
await ready(again);
assert.equal(await finish(again, audio), text, "Second pass over the same audio changed the transcript");
console.log("PASS: model reuse, timed audio, incremental partials, acks, busy, final ordering/tail, warm reset, cancel, invalid audio, queue overload");
process.exit(0);
