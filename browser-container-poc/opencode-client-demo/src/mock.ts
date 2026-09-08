import type { ClientEndpoint, Message, ModelInfo, NativeEvent, SessionInfo } from "./api";

/** In-memory HTTP/SSE fixture: never contacts a server or runs a model. */
export function createMockEndpoint(): ClientEndpoint {
  const sessions: SessionInfo[] = [{ id: "ses_fixture", title: "Fixture conversation" }];
  const history = new Map<string, Message[]>([["ses_fixture", [{ id: "msg_welcome", type: "assistant", content: [{ type: "text", text: "Explicit mock mode. Messages are deterministic fixtures; no model or runtime is running." }] }]]]);
  const models: ModelInfo[] = [{ id: "fixture/demo", providerID: "fixture", modelID: "demo", name: "Demo fixture", enabled: true }];
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const jobs = new Map<string, ReturnType<typeof setInterval>>();
  let serial = 0;
  const encode = (event: NativeEvent) => new TextEncoder().encode(`event: message\r\ndata: ${JSON.stringify(event)}\r\n\r\n`);
  const emit = (type: string, data: NativeEvent["data"]) => { for (const stream of streams) stream.enqueue(encode({ type, data })); };
  const stop = (id: string) => { clearInterval(jobs.get(id)); jobs.delete(id); };
  const fixtureFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    init?.signal?.throwIfAborted();
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const path = url.pathname.slice(5).split("/");
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = (data: unknown) => Response.json(data);
    if (path[0] === "event") {
      let controller: ReadableStreamDefaultController<Uint8Array>;
      const cleanup = () => { streams.delete(controller); init?.signal?.removeEventListener("abort", abort); if (!streams.size) for (const id of jobs.keys()) stop(id); };
      const abort = () => { cleanup(); controller.close(); };
      return new Response(new ReadableStream<Uint8Array>({ start(c) { controller = c; streams.add(c); c.enqueue(encode({ type: "server.connected", data: {} })); init?.signal?.addEventListener("abort", abort, { once: true }); }, cancel: cleanup }), { headers: { "Content-Type": "text/event-stream" } });
    }
    if (path[0] === "model") return json({ data: models });
    if (path[0] !== "session") return new Response("Unknown fixture route", { status: 404 });
    if (!path[1]) {
      if (init?.method !== "POST") return json({ data: sessions, cursor: {} });
      const session = { id: `ses_fixture_${++serial}`, title: body.title || "New fixture session" };
      sessions.unshift(session); history.set(session.id, []); return json({ data: session });
    }
    const id = decodeURIComponent(path[1]);
    const messages = history.get(id);
    if (!messages) return new Response("Unknown session", { status: 404 });
    if (path[2] === "message") return json({ data: messages, cursor: {} });
    if (path[2] === "model") { sessions.find(s => s.id === id)!.model = body.model; return new Response(null, { status: 204 }); }
    if (path[2] === "interrupt") { stop(id); emit("session.execution.interrupted", { sessionID: id }); return json({ interrupted: true }); }
    if (path[2] === "prompt") {
      stop(id);
      messages.push({ id: `msg_${++serial}`, type: "user", text: body.text });
      const message: Message = { id: `msg_${++serial}`, type: "assistant", content: [{ type: "text", text: "" }] };
      messages.push(message);
      emit("session.execution.started", { sessionID: id });
      const chunks = `Fixture response: ${body.text}`.match(/.{1,8}/gs) || [];
      jobs.set(id, setInterval(() => {
        const delta = chunks.shift();
        if (delta !== undefined) { message.content![0].text += delta; emit("session.text.delta", { sessionID: id, assistantMessageID: message.id, ordinal: 0, delta }); }
        else { stop(id); emit("session.text.ended", { sessionID: id, assistantMessageID: message.id, ordinal: 0, text: message.content![0].text }); emit("session.execution.succeeded", { sessionID: id }); }
      }, 40));
      return json({ data: { id: `msg_${serial}`, type: "user" } });
    }
    return new Response("Unknown fixture route", { status: 404 });
  };
  return { url: "https://opencode-fixture.invalid", fetch: fixtureFetch as typeof fetch };
}
