import test from "node:test";
import assert from "node:assert/strict";
import { OpenCodeClient } from "./api";
import { DEFAULT_SETTINGS } from "./common";

test("streamEvents parses chunked SSE data with authenticated fetch", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let request: RequestInfo | URL;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    request = input;
    requestInit = init;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: {"type":"session.text.`));
        controller.enqueue(encoder.encode(`delta","data":{"sessionID":"s1","delta":"Hello"}}\n\n`));
      }
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const abort = new AbortController();
    const events = [];
    let opened = false;
    const client = new OpenCodeClient({ ...DEFAULT_SETTINGS, serverPassword: "secret" });
    await client.streamEvents(abort.signal, (event) => {
      events.push(event);
      abort.abort();
    }, () => opened = true);

    assert.equal(request, `${DEFAULT_SETTINGS.serverUrl}/api/event`);
    assert.equal(new Headers(requestInit.headers).get("Authorization"), "Basic b3BlbmNvZGU6c2VjcmV0");
    assert.equal(opened, true);
    assert.deepEqual(events, [{
      type: "session.text.delta",
      data: { sessionID: "s1", delta: "Hello" }
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sessionUsage returns OpenCode session token and cost totals", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: {
      cost: 0.012345,
      tokens: {
        input: 1200,
        output: 340,
        reasoning: 56,
        cache: { read: 900, write: 78 }
      }
    }
  }), { status: 200 })) as unknown as typeof fetch;

  try {
    const usage = await new OpenCodeClient(DEFAULT_SETTINGS).sessionUsage("session-1");
    assert.deepEqual(usage, {
      input: 1200,
      output: 340,
      reasoning: 56,
      cacheRead: 900,
      cacheWrite: 78,
      cost: 0.012345
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
