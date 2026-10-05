import { afterEach, expect, test } from "bun:test";
import { DictationController, type DictationState } from "./dictation";
import type { TerminalConnection } from "./connection";

const originals = new Map<string, PropertyDescriptor | undefined>();
function replace(name: string, value: unknown) {
  if (!originals.has(name)) originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
  Object.defineProperty(globalThis, name, { configurable: true, value });
}
afterEach(() => {
  for (const [name, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
  originals.clear();
});

async function until(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

function harness() {
  const sockets: FakeSocket[] = [];
  const pastes: string[] = [];
  const states: DictationState[] = [];
  const startup: string[] = [];
  const warm: boolean[] = [];
  const submitted: string[] = [];
  const notices: string[] = [];
  const counts = { modules: 0, microphoneRequests: 0, microphoneStopped: false };
  const track = { readyState: "live", enabled: true, stop() { this.readyState = "ended"; counts.microphoneStopped = true; }, addEventListener() {} };
  const audio: { node?: FakeNode } = {};
  const terminal = { listener: () => {}, attachment: { sessionId: "session", attachmentId: "first" } as { sessionId: string; attachmentId: string } | undefined };

  class FakeSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    readyState = 0;
    bufferedAmount = 0;
    onopen?: () => void;
    onclose?: () => void;
    onerror?: () => void;
    onmessage?: (event: { data: string }) => void;
    sent: (string | Uint8Array)[] = [];
    constructor(_url: string) { sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.(); }
    send(data: string | Uint8Array) { this.sent.push(data); }
    emit(event: object) { this.onmessage?.({ data: JSON.stringify(event) }); }
    close() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  }
  class FakeNode {
    onprocessorerror?: () => void;
    port = { onmessage: (_event: { data: any }) => {}, postMessage: (message: string) => {
      if (message === "stop") queueMicrotask(() => this.port.onmessage({ data: { type: "drained" } }));
    }, close() {} };
    constructor() { audio.node = this; }
    connect() {}
    disconnect() {}
  }
  class FakeContext {
    audioWorklet = { addModule: async (_path: string) => { counts.modules++; } };
    onstatechange: (() => void) | null = null;
    state = "running";
    destination = {};
    // Graph setup must not wait for this promise; some mobile browsers settle it late.
    resume = () => new Promise<void>(() => {});
    close = async () => {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  replace("isSecureContext", true);
  replace("navigator", { mediaDevices: { getUserMedia: async () => {
    counts.microphoneRequests++;
    return { getTracks: () => [track], getAudioTracks: () => [track] };
  } } });
  replace("window", { AudioContext: FakeContext, AudioWorkletNode: FakeNode, addEventListener() {} });
  replace("AudioContext", FakeContext);
  replace("AudioWorkletNode", FakeNode);
  replace("WebSocket", FakeSocket);
  replace("location", { protocol: "https:", host: "example.test" });
  const page = { hidden: false, hide: () => {} };
  replace("document", { get hidden() { return page.hidden; },
    addEventListener(type: string, listener: () => void) { if (type === "visibilitychange") page.hide = () => { page.hidden = true; listener(); }; } });

  const connection = { get attachment() { return terminal.attachment; }, terminalStopped: false,
    onAttachmentChange(listener: () => void) { terminal.listener = listener; return () => {}; } } as unknown as TerminalConnection;
  const controller = new DictationController(connection, {
    state: value => states.push(value), startup: text => startup.push(text), warm: active => warm.push(active),
    preview() {}, notice: text => notices.push(text), clearControl() {}, paste: text => pastes.push(text),
  });
  return { controller, sockets, pastes, states, startup, warm, submitted, notices, counts, track, audio, terminal, page };
}

test("records before ready, paces by inference acks, and replays after disconnect without duplicate paste", async () => {
  const { controller, sockets, pastes, states, startup, warm, submitted, counts, track, audio, terminal } = harness();
  expect(counts.modules).toBe(1);
  expect(counts.microphoneRequests).toBe(0);
  expect(controller.submitAfterStop(() => submitted.push(pastes.join("")))).toBe(false);
  controller.toggle();
  await until(() => !!audio.node);
  const node = audio.node!;
  expect(counts.modules).toBe(1);
  expect(counts.microphoneRequests).toBe(1);
  expect(startup).toContain("Audio startup…");
  const first = sockets[0]!;
  // 16 frames = 81,920 bytes; only 12 fit in the one-second inference window.
  for (let i = 0; i < 16; i++) node!.port.onmessage({ data: { type: "audio", bytes: new Uint8Array(5120).buffer } });
  expect(states.at(-1)).toBe("waiting");
  expect(first.sent).toEqual([]);
  first.open();
  const firstId = JSON.parse(first.sent[0] as string).recordingId;
  first.emit({ type: "ready", recordingId: firstId, sequence: 0 });
  expect(first.sent.filter(value => value instanceof Uint8Array)).toHaveLength(12);
  first.emit({ type: "ack", recordingId: firstId, sequence: 1, bytes: 5120 });
  expect(first.sent.filter(value => value instanceof Uint8Array)).toHaveLength(13);
  first.emit({ type: "partial", recordingId: firstId, sequence: 2, text: "hello " });
  expect(pastes).toEqual(["hello "]);
  first.close();

  await until(() => sockets.length === 2);
  const second = sockets[1]!;
  second.open();
  const secondId = JSON.parse(second.sent[0] as string).recordingId;
  expect(secondId).not.toBe(firstId);
  second.emit({ type: "ready", recordingId: secondId, sequence: 0 });
  expect(second.sent.filter(value => value instanceof Uint8Array)).toHaveLength(12);
  second.emit({ type: "partial", recordingId: secondId, sequence: 1, text: "hello " });
  expect(pastes).toEqual(["hello "]);
  expect(controller.submitAfterStop(() => submitted.push(pastes.join("")))).toBe(true);
  expect(controller.submitAfterStop(() => submitted.push("duplicate"))).toBe(true);
  await until(() => states.at(-1) === "finishing");
  for (let i = 1; i <= 16; i++) second.emit({ type: "ack", recordingId: secondId, sequence: i + 1, bytes: i * 5120 });
  await until(() => typeof second.sent.at(-1) === "string" && JSON.parse(second.sent.at(-1) as string).type === "stop");
  second.emit({ type: "final", recordingId: secondId, sequence: 18, text: "hello world" });
  expect(submitted).toEqual([]);
  second.emit({ type: "done", recordingId: secondId, sequence: 19 });
  expect(submitted).toEqual(["hello world"]);
  expect(pastes).toEqual(["hello ", "world"]);
  expect(states.at(-1)).toBe("idle");
  expect(warm.at(-1)).toBe(true);
  expect(track.enabled).toBe(false);
  expect(counts.microphoneStopped).toBe(false);

  controller.toggle();
  await until(() => audio.node !== node);
  expect(counts.microphoneRequests).toBe(1);
  expect(track.enabled).toBe(true);
  expect(warm.at(-1)).toBe(false);
  expect(controller.submitAfterStop(() => submitted.push("canceled"))).toBe(true);
  terminal.attachment = undefined;
  terminal.listener();
  controller.cancel();
  expect(counts.microphoneStopped).toBe(true);
  expect(submitted).toEqual(["hello world"]);
});

// Reported from a phone: tap, speak, stop while the service was still loading, and nothing came back.
test("a recording stopped before ready is still transcribed, also when the page is hidden meanwhile", async () => {
  const { controller, sockets, pastes, states, audio, page } = harness();
  controller.toggle();
  await until(() => !!audio.node);
  for (let i = 0; i < 3; i++) audio.node!.port.onmessage({ data: { type: "audio", bytes: new Uint8Array(5120).buffer } });
  controller.toggle();
  await until(() => states.at(-1) === "finishing");
  page.hide();
  const socket = sockets[0]!;
  socket.open();
  const id = JSON.parse(socket.sent[0] as string).recordingId;
  expect(socket.sent).toHaveLength(1);
  socket.emit({ type: "loading", recordingId: id, sequence: 0 });
  socket.emit({ type: "ready", recordingId: id, sequence: 1 });
  expect(socket.sent.filter(value => value instanceof Uint8Array)).toHaveLength(3);
  for (let i = 1; i <= 3; i++) socket.emit({ type: "ack", recordingId: id, sequence: i + 1, bytes: i * 5120 });
  expect(JSON.parse(socket.sent.at(-1) as string).type).toBe("stop");
  socket.emit({ type: "final", recordingId: id, sequence: 5, text: "hello world" });
  socket.emit({ type: "done", recordingId: id, sequence: 6 });
  expect(pastes).toEqual(["hello world"]);
  expect(states.at(-1)).toBe("idle");
});

test("a tap while the microphone is still starting says that nothing was recorded", () => {
  const { controller, states, notices } = harness();
  controller.toggle();
  controller.toggle();
  expect(states.at(-1)).toBe("idle");
  expect(notices).toEqual(["Nothing recorded · microphone was still starting"]);
});
