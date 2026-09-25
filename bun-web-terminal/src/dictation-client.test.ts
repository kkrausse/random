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

test("records before ready, paces by inference acks, and replays after disconnect without duplicate paste", async () => {
  const sockets: FakeSocket[] = [];
  const pastes: string[] = [];
  const states: DictationState[] = [];
  let node!: FakeNode;
  let attachmentListener = () => {};
  let attachment = { sessionId: "session", attachmentId: "first" };

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
    constructor() { node = this; }
    connect() {}
    disconnect() {}
  }
  class FakeContext {
    audioWorklet = { addModule: async (_path: string) => {} };
    onstatechange: (() => void) | null = null;
    state = "running";
    destination = {};
    resume = async () => {};
    close = async () => {};
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  replace("isSecureContext", true);
  replace("navigator", { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop() {}, addEventListener() {} }] }) } });
  replace("window", { AudioContext: FakeContext, AudioWorkletNode: FakeNode, addEventListener() {} });
  replace("AudioContext", FakeContext);
  replace("AudioWorkletNode", FakeNode);
  replace("WebSocket", FakeSocket);
  replace("location", { protocol: "https:", host: "example.test" });
  replace("document", { addEventListener() {} });

  const connection = { get attachment() { return attachment; }, terminalStopped: false,
    onAttachmentChange(listener: () => void) { attachmentListener = listener; return () => {}; } } as unknown as TerminalConnection;
  const controller = new DictationController(connection, {
    state: value => states.push(value), preview() {}, notice() {}, clearControl() {}, paste: text => pastes.push(text),
  });
  controller.toggle();
  await until(() => !!node);
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
  controller.toggle();
  await until(() => states.at(-1) === "finishing");
  for (let i = 1; i <= 16; i++) second.emit({ type: "ack", recordingId: secondId, sequence: i + 1, bytes: i * 5120 });
  await until(() => typeof second.sent.at(-1) === "string" && JSON.parse(second.sent.at(-1) as string).type === "stop");
  second.emit({ type: "final", recordingId: secondId, sequence: 18, text: "hello world" });
  second.emit({ type: "done", recordingId: secondId, sequence: 19 });
  expect(pastes).toEqual(["hello ", "world"]);
  expect(states.at(-1)).toBe("idle");
  attachment = { sessionId: "session", attachmentId: "next" };
  attachmentListener();
});
