import type { ChatEndpoint, SessionMessageInfo } from "../src/types";
export function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
export const user = (id: string, text = id, time = 1): SessionMessageInfo => ({
  id,
  type: "user",
  text,
  time: { created: time },
});
export function fixture() {
  let stream: ReadableStreamDefaultController<Uint8Array>;
  let seq = 0,
    cancels = 0;
  const calls: { url: URL; init: RequestInit }[] = [];
  const histories: Record<string, SessionMessageInfo[]> = { s1: [], s2: [] };
  const permissions: unknown[] = [],
    questions: unknown[] = [];
  let active: Record<string, unknown> = {};
  let override:
    | ((
        url: URL,
        init: RequestInit,
      ) => Promise<Response> | Response | undefined)
    | undefined;
  const emit = (type: string, data: unknown = {}) =>
    stream.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({ id: `evt_${++seq}`, created: seq, type, data })}\r\n\r\n`,
      ),
    );
  const endpoint: ChatEndpoint = {
    url: "https://injected.invalid/proxy/",
    async fetch(input, init = {}) {
      if (typeof input !== "string")
        throw new Error("Expected string-only transport");
      const url = new URL(input);
      calls.push({ url, init });
      const result = override?.(url, init);
      if (result) return result;
      const path = url.pathname.replace("/proxy/api/", "");
      if (path === "event")
        return new Response(
          new ReadableStream({
            start(c) {
              stream = c;
              emit("server.connected");
            },
            cancel() {
              cancels++;
            },
          }),
          { headers: { "content-type": "text/event-stream" } },
        );
      if (path === "session" && !init.method)
        return json({
          data: [
            { id: "s1", title: "First" },
            { id: "s2", title: "Second" },
          ],
          cursor: {},
        });
      if (path === "session" && init.method === "POST")
        return json({ data: { id: "new", title: "New" } });
      if (path === "model/default") return json({ data: null });
      if (path === "model")
        return json({
          data: [{ id: "m", providerID: "p", name: "Model", enabled: true }],
        });
      if (path === "session/active") return json({ data: active });
      const id = path.split("/")[1]!;
      if (path.endsWith("/message"))
        return json({ data: [...(histories[id] ?? [])].reverse(), cursor: {} });
      if (path.endsWith("/permission")) return json({ data: permissions });
      if (path.endsWith("/question")) return json({ data: questions });
      return new Response(null, { status: 204 });
    },
  };
  return {
    endpoint,
    calls,
    histories,
    permissions,
    questions,
    emit,
    get cancels() {
      return cancels;
    },
    set active(value: Record<string, unknown>) {
      active = value;
    },
    set override(value: typeof override) {
      override = value;
    },
    close() {
      stream.close();
    },
  };
}
export const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
