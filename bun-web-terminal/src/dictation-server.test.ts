import { afterEach, expect, test } from "bun:test";
import { DictationProxy } from "./dictation-server";
import type { Attachment, Session } from "./sessions";
import { audioFormat } from "./dictation-protocol";

const disposals: (() => void)[] = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); });
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => boolean) {
  for (let i = 0; i < 200 && !condition(); i++) await pause(5);
  expect(condition()).toBe(true);
}
function fixture() {
  const received: any[] = [];
  let remote: Bun.ServerWebSocket<undefined> | undefined;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch(request, server) { return server.upgrade(request) ? undefined : new Response("no"); },
    websocket: {
      open(socket) { remote = socket; },
      message(_socket, message) { received.push(typeof message === "string" ? JSON.parse(message) : message); },
    },
  });
  const sent: any[] = [];
  const listeners = new Set<() => void>();
  const attachment: Attachment = { id: crypto.randomUUID(), input() {}, resize() {}, acknowledge: () => true,
    onClose(callback) { listeners.add(callback); return () => { listeners.delete(callback); }; },
    close() { for (const listener of listeners) listener(); },
  };
  const session = { id: "$test", attachment } as Session;
  const start = { type: "start", version: 1, recordingId: crypto.randomUUID(), sessionId: session.id, attachmentId: attachment.id, ...audioFormat };
  let closed = false;
  const proxy = new DictationProxy({ send(text) { sent.push(JSON.parse(String(text))); }, close() { closed = true; } },
    new Map([[session.id, session]]), { connect: async () => new WebSocket(`ws://127.0.0.1:${server.port}`) });
  disposals.push(() => { proxy.close(); server.stop(true); });
  return { proxy, start, sent, received, attachment, closed: () => closed,
    emit: (type: string, sequence: number, text?: string) => remote!.send(JSON.stringify({ type, sequence, recordingId: start.recordingId, text })),
  };
}

test("proxy strips terminal identity and orders audio before stop", async () => {
  const f = fixture();
  f.proxy.message(JSON.stringify(f.start));
  await until(() => f.received.length === 1);
  expect(f.received[0].sessionId).toBeUndefined();
  expect(f.received[0].attachmentId).toBeUndefined();
  f.emit("ready", 0);
  await until(() => f.sent.length === 1);
  f.proxy.message(new Uint8Array(5120));
  f.proxy.message(JSON.stringify({ type: "stop", recordingId: f.start.recordingId }));
  await until(() => f.received.length === 3);
  expect(f.received[1].length).toBe(5120);
  expect(f.received[2].type).toBe("stop");
  f.emit("final", 1, "hello");
  f.emit("done", 2);
  await until(f.closed);
  expect(f.sent.map(event => event.type)).toEqual(["ready", "final", "done"]);
});

test("attachment takeover immediately cancels and rejects late transcripts", async () => {
  const f = fixture();
  f.proxy.message(JSON.stringify(f.start));
  await until(() => f.received.length === 1);
  f.emit("ready", 0);
  await until(() => f.sent.length === 1);
  f.attachment.close();
  expect(f.closed()).toBe(true);
  expect(f.sent.at(-1).code).toBe("attachment_lost");
  f.emit("partial", 1, "stale text ");
  await pause(20);
  expect(f.sent.map(event => event.type)).toEqual(["ready", "error"]);
});

test("wrong attachment and audio before readiness fail closed", () => {
  const f = fixture();
  f.proxy.message(JSON.stringify({ ...f.start, attachmentId: "old" }));
  expect(f.closed()).toBe(true);
  expect(f.received).toEqual([]);
  const g = fixture();
  g.proxy.message(new Uint8Array(5120));
  expect(g.sent.at(-1).type).toBe("error");
});

test("cancel while starting cannot leave an upstream recording", async () => {
  const f = fixture();
  f.proxy.message(JSON.stringify(f.start));
  f.proxy.message(JSON.stringify({ type: "cancel", recordingId: f.start.recordingId }));
  await pause(30);
  expect(f.closed()).toBe(true);
  expect(f.received).toEqual([]);
});

test("service event disorder fails the recording", async () => {
  const f = fixture();
  f.proxy.message(JSON.stringify(f.start));
  await until(() => f.received.length === 1);
  f.emit("partial", 0, "too early");
  await until(f.closed);
  expect(f.sent.at(-1).code).toBe("protocol_error");
});
