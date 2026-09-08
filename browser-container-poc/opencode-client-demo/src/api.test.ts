import { expect, test } from "bun:test";
import { OpenCodeAPI, type NativeEvent } from "./api";
import { createMockEndpoint } from "./mock";

test("reusable entry imports without a DOM or network side effects", async () => {
  const { mountOpenCodeClient } = await import("./client");
  expect(typeof mountOpenCodeClient).toBe("function");
});

test("V2 routes, envelopes, location, pagination and model switching", async () => {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const api = new OpenCodeAPI({ url: "https://guest.invalid/proxy/", fetch: (async (input, init) => {
    const url = new URL(String(input)); calls.push({ url, init });
    if (url.pathname.endsWith("/model") && init?.method === "POST") return new Response(null, { status: 204 });
    if (init?.method === "POST") return Response.json({ data: { id: "ses_new" } });
    if (url.searchParams.has("cursor")) return Response.json({ data: [{ id: "ses_second" }], cursor: {} });
    return Response.json({ data: [{ id: "ses_first" }], cursor: { next: "opaque+/=" } });
  }) as typeof fetch }, "/workspace/a b");
  expect((await api.list()).map(s => s.id)).toEqual(["ses_first", "ses_second"]);
  expect(calls[0].url.pathname).toBe("/proxy/api/session");
  expect(calls[0].url.searchParams.get("directory")).toBe("/workspace/a b");
  expect(calls[1].url.searchParams.get("cursor")).toBe("opaque+/=");
  expect(calls[1].url.searchParams.has("order")).toBe(false);
  expect((await api.create("Title")).id).toBe("ses_new");
  expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ title: "Title", location: { directory: "/workspace/a b" } });
  await api.model("ses_new", { providerID: "p", id: "m" });
  expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ model: { providerID: "p", id: "m" } });
  await api.prompt("ses_new", "hello");
  expect(JSON.parse(String(calls.at(-1)!.init!.body))).toEqual({ text: "hello" });
  await api.interrupt("ses_new");
  expect(calls.at(-1)!.url.pathname).toBe("/proxy/api/session/ses_new/interrupt");
  expect(calls.at(-1)!.init!.method).toBe("POST");
});

test("SSE handles byte-split UTF-8, CRLF, comments, multiline data and reader cancellation", async () => {
  let cancelled = false, ready = 0;
  const events: NativeEvent[] = [];
  const controller = new AbortController();
  const wire = ': heartbeat\r\nevent: message\r\ndata: {"type":"server.connected",\r\ndata: "data":{}}\r\n\r\ndata: {"type":"session.text.delta","data":{"sessionID":"ses_a","delta":"🌍"}}\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  const api = new OpenCodeAPI({ url: "https://guest.invalid", fetch: (async (_input: RequestInfo | URL) => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } })) as typeof fetch });
  await api.events(controller.signal, () => ready++, e => { events.push(e); if (events.length === 2) controller.abort(); });
  expect(ready).toBe(1); expect(events[1].data.delta).toBe("🌍"); expect(cancelled).toBe(true);
});

test("explicit fixture streams a response, history persists, interrupt stops generation", async () => {
  const api = new OpenCodeAPI(createMockEndpoint());
  const abort = new AbortController();
  const events: NativeEvent[] = [];
  let connected!: () => void, completed!: () => void;
  const ready = new Promise<void>(resolve => connected = resolve);
  const done = new Promise<void>(resolve => completed = resolve);
  const stream = api.events(abort.signal, connected, e => { events.push(e); if (e.type === "session.execution.succeeded") completed(); });
  await ready;
  const session = await api.create("test");
  await api.prompt(session.id, "hello"); await done;
  expect(events.filter(e => e.type === "session.text.delta").map(e => e.data.delta).join("")).toBe("Fixture response: hello");
  expect((await api.history(session.id))[1].content![0].text).toBe("Fixture response: hello");
  await api.prompt(session.id, "cancel this"); await api.interrupt(session.id);
  expect(events.some(e => e.type === "session.execution.interrupted")).toBe(true);
  const snapshot = JSON.stringify(await api.history(session.id));
  await Bun.sleep(100);
  expect(JSON.stringify(await api.history(session.id))).toBe(snapshot);
  abort.abort(); await stream;
});

test("HTTP and SSE failures surface, and request cancellation reaches injected fetch", async () => {
  const abort = new AbortController();
  let received: AbortSignal | null | undefined;
  const api = new OpenCodeAPI({ url: "https://guest.invalid", fetch: (async (_, init) => { received = init?.signal; return new Response("denied", { status: 401 }); }) as typeof fetch });
  await expect(api.prompt("ses_a", "hello", abort.signal)).rejects.toThrow("HTTP 401: denied");
  expect(received).toBe(abort.signal);
  const failure = new OpenCodeAPI({ url: "https://guest.invalid", fetch: (async (_input: RequestInfo | URL) => new Response('event: effect/httpapi/stream/failure\ndata: []\n\n', { headers: { "content-type": "text/event-stream" } })) as typeof fetch });
  await expect(failure.events(abort.signal, () => {}, () => {})).rejects.toThrow("V2 event stream failed");
});

test("aborting an idle subscription cancels its pending read; unexpected EOF fails", async () => {
  const controller = new AbortController();
  let cancelled = false;
  let markReady!: () => void;
  const ready = new Promise<void>(resolve => markReady = resolve);
  const api = new OpenCodeAPI({ url: "https://guest.invalid", fetch: (async (_input: RequestInfo | URL) => new Response(new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","data":{}}\n\n')); },
    cancel() { cancelled = true; },
  }), { headers: { "content-type": "text/event-stream" } })) as typeof fetch });
  const stream = api.events(controller.signal, markReady, () => {});
  await ready; controller.abort(); await stream;
  expect(cancelled).toBe(true);
  const closed = new OpenCodeAPI({ url: "https://guest.invalid", fetch: (async (_input: RequestInfo | URL) => new Response("", { headers: { "content-type": "text/event-stream" } })) as typeof fetch });
  await expect(closed.events(new AbortController().signal, () => {}, () => {})).rejects.toThrow("event connection closed");
});
