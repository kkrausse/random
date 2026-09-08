import { expect, test } from "bun:test";
import { OpenCodeAPI } from "../src/api";
test("SSE handles split UTF-8/CRLF and multiline data through injected fetch", async () => {
  const abort = new AbortController(),
    events: string[] = [],
    calls: string[] = [];
  let ready = 0;
  const wire =
    'data: {"type":"server.connected",\r\ndata: "data":{}}\r\n\r\ndata: {"type":"session.text.delta","data":{"sessionID":"s","delta":"é🌱"}}\r\n\r\n';
  const bytes = new TextEncoder().encode(wire);
  const api = new OpenCodeAPI({
    url: "https://endpoint.test/nested?scope=kept#hash",
    async fetch(input) {
      calls.push(input);
      return new Response(
        new ReadableStream({
          start(c) {
            for (const byte of bytes) c.enqueue(new Uint8Array([byte]));
            c.close();
          },
        }),
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await api.events(
    abort.signal,
    () => ready++,
    (e) => {
      events.push(JSON.stringify(e));
      if (e.type === "session.text.delta") abort.abort();
    },
  );
  expect(ready).toBe(1);
  expect(events[1]).toContain("é🌱");
  expect(calls).toEqual(["https://endpoint.test/nested/api/event?scope=kept"]);
});
test("endpoint query and string/init authenticated transport survive API paths", async () => {
  const abort = new AbortController();
  const api = new OpenCodeAPI({
    url: "https://endpoint.test/guest/?route=a&route=b&limit=999#ignored",
    async fetch(input, init) {
      expect(typeof input).toBe("string");
      const url = new URL(input);
      expect(url.pathname).toBe("/guest/api/session");
      expect(url.searchParams.getAll("route")).toEqual(["a", "b"]);
      expect(url.searchParams.get("limit")).toBe("2");
      expect(url.hash).toBe("");
      expect(init?.signal).toBe(abort.signal);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
      expect(JSON.parse(String(init?.body))).toEqual({ directory: "/workspace" });
      return Response.json({});
    },
  });
  await api.request("session?limit=2", abort.signal, { directory: "/workspace" });
});
test("native failure envelopes reject instead of silently reporting connected", async () => {
  const api = new OpenCodeAPI({
    url: "https://endpoint.test",
    async fetch() {
      return new Response(
        'event: effect/httpapi/stream/failure\ndata: {"message":"denied"}\n\n',
        { headers: { "content-type": "text/event-stream" } },
      );
    },
  });
  await expect(
    api.events(
      new AbortController().signal,
      () => {},
      () => {},
    ),
  ).rejects.toThrow("denied");
});
