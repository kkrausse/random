import test from "node:test";
import assert from "node:assert/strict";
import { OpenCodeClient } from "./api";
import { DEFAULT_SETTINGS } from "./common";

test("streamEvents parses stable chunked SSE data with authentication and directory", async () => {
  const originalFetch = globalThis.fetch;
  const encoder = new TextEncoder();
  let request: RequestInfo | URL;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    request = input;
    requestInit = init;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: {"type":"message.part.`));
        controller.enqueue(encoder.encode(`updated","properties":{"part":{"id":"p1","sessionID":"s1","messageID":"m1","type":"text","text":"Hello"},"delta":"o"}}\n\n`));
      }
    }), { status: 200 });
  }) as typeof fetch;

  try {
    const abort = new AbortController();
    const events = [];
    const client = new OpenCodeClient({ ...DEFAULT_SETTINGS, serverPassword: "secret" });
    await client.streamEvents(abort.signal, (event) => {
      events.push(event);
      abort.abort();
    }, () => {});

    assert.equal(request, `${DEFAULT_SETTINGS.serverUrl}/event?directory=${encodeURIComponent(DEFAULT_SETTINGS.directory)}`);
    assert.equal(new Headers(requestInit.headers).get("Authorization"), "Basic b3BlbmNvZGU6c2VjcmV0");
    assert.equal(events[0].type, "message.part.updated");
    assert.equal(events[0].properties?.part?.text, "Hello");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sessionUsage sums stable assistant message token and cost totals", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { info: { id: "u1", role: "user", time: {} }, parts: [{ type: "text", text: "Hi" }] },
    { info: { id: "a1", role: "assistant", time: { completed: 1 }, cost: 0.01,
      tokens: { input: 1200, output: 300, reasoning: 50, cache: { read: 900, write: 70 } } }, parts: [] },
    { info: { id: "a2", role: "assistant", time: { completed: 2 }, cost: 0.002345,
      tokens: { input: 100, output: 40, reasoning: 6, cache: { read: 20, write: 8 } } }, parts: [] }
  ]), { status: 200 })) as unknown as typeof fetch;

  try {
    assert.deepEqual(await new OpenCodeClient(DEFAULT_SETTINGS).sessionUsage("session-1"), {
      input: 1300,
      output: 340,
      reasoning: 56,
      cacheRead: 920,
      cacheWrite: 78,
      cost: 0.012345
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("models flattens active models from stable providers", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    providers: [{ models: {
      active: { id: "gpt-5", providerID: "openai", name: "GPT-5", status: "active",
        variants: { low: { reasoningEffort: "low" }, high: { reasoningEffort: "high" } } },
      retired: { id: "old", providerID: "openai", name: "Old", status: "deprecated" }
    } }],
    default: { openai: "gpt-5" }
  }), { status: 200 })) as unknown as typeof fetch;

  try {
    assert.deepEqual(await new OpenCodeClient(DEFAULT_SETTINGS).models(), [{
      name: "GPT-5", providerId: "openai", modelId: "gpt-5", variants: ["low", "high"]
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("messages parses stable info and parts records", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify([{
    info: { id: "u1", role: "user", time: { created: 1 } },
    parts: [{ type: "text", text: "Question" }]
  }, {
    info: { id: "a1", role: "assistant", providerID: "openai", modelID: "gpt-5",
      time: { created: 2, completed: 3 } },
    parts: [{ type: "text", text: "Answer" }]
  }]), { status: 200 })) as unknown as typeof fetch;

  try {
    assert.deepEqual(await new OpenCodeClient(DEFAULT_SETTINGS).messages("session-1"), [{
      id: "u1", role: "You", text: "Question", complete: true
    }, {
      id: "a1", role: "OpenCode", text: "Answer", complete: true,
      model: { providerID: "openai", id: "gpt-5" }
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("sendMessage uses stable async prompt contract", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInfo | URL;
  let requestInit: RequestInit | undefined;
  globalThis.fetch = (async (input, init) => {
    request = input;
    requestInit = init;
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    await new OpenCodeClient(DEFAULT_SETTINGS).sendMessage("session-1", "Hello");
    assert.equal(request, `${DEFAULT_SETTINGS.serverUrl}/session/session-1/prompt_async?directory=${encodeURIComponent(DEFAULT_SETTINGS.directory)}`);
    assert.equal(requestInit?.method, "POST");
    assert.deepEqual(JSON.parse(String(requestInit?.body)), {
      model: { providerID: DEFAULT_SETTINGS.modelProvider, modelID: DEFAULT_SETTINGS.modelId },
      variant: DEFAULT_SETTINGS.modelVariant,
      parts: [{ type: "text", text: "Hello" }]
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("interruptSession posts to the stable abort endpoint", async () => {
  const originalFetch = globalThis.fetch;
  let request: RequestInfo | URL;
  globalThis.fetch = (async (input) => {
    request = input;
    return new Response("true", { status: 200 });
  }) as typeof fetch;

  try {
    await new OpenCodeClient(DEFAULT_SETTINGS).interruptSession("session-1");
    assert.equal(request, `${DEFAULT_SETTINGS.serverUrl}/session/session-1/abort?directory=${encodeURIComponent(DEFAULT_SETTINGS.directory)}`);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
