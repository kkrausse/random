// Runs the built Android bundle (app/src/main/assets/reading-client.js) in headless Chrome against
// the throwaway mock-backed server. The page lives at the server's own origin and carries the bundle
// in an inline script, which is what the app's WebView gets from loadDataWithBaseURL, and
// window.AndroidHost is stubbed with the three callbacks the app provides.
//
//   bun run build:android && bun run verify:bridge
//   CHROME=/path/to/chrome SCRATCH=/some/dir bun run verify:bridge

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { MOCK_MODEL, startDevServer } from "./dev-server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const bundle = await Bun.file(join(import.meta.dir, "..", "..", "app", "src", "main", "assets", "reading-client.js")).text();

// Everything below the stub runs inside the page and only talks to window.ReadingBridge.
const pageScenario = async (config: { baseUrl: string; password: string; directory: string }, model: unknown) => {
  const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const events: Array<{ subscriptionId: string; event: { kind: string; [key: string]: unknown } }> = [];
  const hostCalls = { nonString: 0 };
  const strings = (...values: unknown[]) => {
    if (values.some((value) => typeof value !== "string")) hostCalls.nonString++;
  };
  (window as any).AndroidHost = {
    resolve(callId: string, resultJson: string) { strings(callId, resultJson); pending.get(callId)?.resolve(JSON.parse(resultJson)); },
    reject(callId: string, message: string) { strings(callId, message); pending.get(callId)?.reject(new Error(message)); },
    event(subscriptionId: string, eventJson: string) { strings(subscriptionId, eventJson); events.push({ subscriptionId, event: JSON.parse(eventJson) }); }
  };
  let nextId = 0;
  const call = (method: string, args: unknown = {}) => new Promise<any>((resolve, reject) => {
    const callId = `call-${++nextId}`;
    pending.set(callId, { resolve, reject });
    (window as any).ReadingBridge.call(callId, method, JSON.stringify(args));
  });
  const waitFor = async (kind: string, timeoutMs = 15000) => {
    const started = Date.now();
    while (!events.some((entry) => entry.event.kind === kind)) {
      if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${kind}`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  };

  const out: Record<string, unknown> = {};
  out.beforeConfigure = await call("listModels").then(() => "", (error: Error) => error.message);
  out.configure = await call("configure", config);
  out.connection = await call("checkConnection");
  let models = await call("listModels");
  for (let attempt = 0; attempt < 20 && models.some((item: any) => item.providerId !== "mock"); attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    models = await call("listModels");
  }
  out.models = models;
  const session = await call("createSession", { model });
  out.session = session;
  out.subscribe = await call("subscribe", { subscriptionId: "sub-1", sessionId: session.id });
  const prompt = await call("sendPrompt", { sessionId: session.id, text: "Explain this passage." });
  out.prompt = prompt;
  await waitFor("idle");
  out.eventKinds = [...new Set(events.map((entry) => entry.event.kind))];
  out.subscriptionIds = [...new Set(events.map((entry) => entry.subscriptionId))];
  out.finalText = events.filter((entry) => entry.event.kind === "text.done").map((entry) => entry.event.text);
  out.conversation = await call("loadConversation", { sessionId: session.id, pendingMessageId: prompt.messageId });
  out.messages = await call("listMessages", { sessionId: session.id });
  await call("setModel", { sessionId: session.id, model: { providerId: "mock", modelId: "mock-2" } });
  out.switched = (await call("getSession", { sessionId: session.id })).model;
  events.length = 0;
  await call("sendPrompt", { sessionId: session.id, text: "Take your time. [[slow]]" });
  await waitFor("text.delta");
  out.interrupt = await call("interrupt", { sessionId: session.id });
  await waitFor("idle");
  out.interruptedIdle = events.find((entry) => entry.event.kind === "idle")?.event;
  out.unsubscribe = await call("unsubscribe", { subscriptionId: "sub-1" });
  events.length = 0;
  await call("sendPrompt", { sessionId: session.id, text: "Anyone listening?" });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  out.eventsAfterUnsubscribe = events.length;
  out.sessions = await call("listSessions", { limit: 10 });
  out.unknownMethod = await call("nope").then(() => "", (error: Error) => error.message);
  out.missingArgument = await call("sendPrompt", { sessionId: session.id }).then(() => "", (error: Error) => error.message);
  out.nonStringHostCalls = hostCalls.nonString;
  return out;
};

let failures = 0;
function check(name: string, pass: boolean, detail?: unknown) {
  if (!pass) failures++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

const server = await startDevServer();
const profile = join(server.scratch, "chrome-profile");
mkdirSync(profile, { recursive: true });
const chrome = Bun.spawn([
  process.env.CHROME || "google-chrome", "--headless=new", "--remote-debugging-port=0",
  `--user-data-dir=${profile}`, "--no-first-run", "--disable-gpu", "about:blank"
], { stdout: "ignore", stderr: "pipe" });

try {
  // Chrome prints its DevTools endpoint on stderr.
  let stderr = "";
  const reader = chrome.stderr.getReader();
  const decoder = new TextDecoder();
  while (!/DevTools listening on (ws:\/\/\S+)/.test(stderr)) {
    const { done, value } = await reader.read();
    if (done) throw new Error(`Chrome exited before DevTools was ready:\n${stderr}`);
    stderr += decoder.decode(value);
  }
  reader.releaseLock();
  const port = new URL(stderr.match(/DevTools listening on (ws:\/\/\S+)/)![1]).port;
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json() as { webSocketDebuggerUrl: string };

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const waiting = new Map<number, (message: any) => void>();
  const listeners = new Map<string, (params: any) => void>();
  socket.onmessage = (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id) waiting.get(data.id)?.(data);
    else listeners.get(data.method)?.(data.params);
  };
  const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, (message) => message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });

  // Answer the page load ourselves with a document that carries the bundle in an inline classic
  // <script>, under the server's URL. That is what WebView.loadDataWithBaseURL(serverUrl, html, ...)
  // does: the server's origin without the server's own web UI or its Content-Security-Policy.
  const pageUrl = `${server.baseUrl}/reading-context-bridge`;
  const html = `<!doctype html><title>bridge</title><script>${bundle}</script>`;
  listeners.set("Fetch.requestPaused", (params) => void send("Fetch.fulfillRequest", {
    requestId: params.requestId,
    responseCode: 200,
    responseHeaders: [{ name: "content-type", value: "text/html; charset=utf-8" }],
    body: Buffer.from(html).toString("base64")
  }));
  await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: pageUrl }] });
  await send("Page.navigate", { url: pageUrl });
  await sleep(500);
  await send("Fetch.disable");
  const loaded = await send("Runtime.evaluate", { expression: "typeof window.ReadingBridge?.call + ' ' + location.origin", returnByValue: true });
  check("bundle loads from an inline classic script on the server origin",
    loaded.result?.value === `function ${server.baseUrl}`, loaded.result?.value);

  const config = { baseUrl: server.baseUrl, password: server.password, directory: server.directory };
  const model = { providerId: MOCK_MODEL.providerID, modelId: MOCK_MODEL.id, variant: "low" };
  const evaluated = await send("Runtime.evaluate", {
    expression: `(${pageScenario.toString()})(${JSON.stringify(config)}, ${JSON.stringify(model)})`,
    awaitPromise: true,
    returnByValue: true
  });
  if (evaluated.exceptionDetails) throw new Error(evaluated.exceptionDetails.exception?.description || "page scenario failed");
  const out = evaluated.result.value;

  check("calls before configure are rejected", out.beforeConfigure === "Call configure first.", out.beforeConfigure);
  check("configure", out.configure?.configured === true);
  check("checkConnection", Boolean(out.connection?.version), out.connection);
  check("listModels", out.models?.length === 2 && out.models[0].providerId === "mock", out.models);
  check("createSession with model and variant", out.session?.model?.variant === "low", out.session);
  check("subscribe resolves connected", out.subscribe?.connected === true, out.subscribe);
  check("sendPrompt", String(out.prompt?.messageId).startsWith("msg_"), out.prompt);
  check("events: connected, busy, message, text.delta, text.done, usage, idle",
    ["connected", "busy", "message", "text.delta", "text.done", "usage", "idle"].every((kind) => out.eventKinds.includes(kind)), out.eventKinds);
  check("events carry the subscription id", out.subscriptionIds.join() === "sub-1", out.subscriptionIds);
  check("streamed final text", String(out.finalText?.[0]).startsWith("Mock reply"), out.finalText);
  check("loadConversation", out.conversation?.busy === false && out.conversation.messages.length === 2
    && out.conversation.messages[1].usage.input === 100 && out.conversation.session.usage.cost > 0, out.conversation?.session);
  check("listMessages", out.messages?.length === 2 && out.messages[1].role === "assistant");
  check("setModel", out.switched?.modelId === "mock-2", out.switched);
  check("interrupt", out.interrupt?.interrupted === true && out.interruptedIdle?.outcome === "interrupted", out.interruptedIdle);
  check("unsubscribe stops events", out.unsubscribe === null && out.eventsAfterUnsubscribe === 0, out.eventsAfterUnsubscribe);
  check("listSessions", out.sessions?.length === 1 && out.sessions[0].id === out.session.id);
  check("unknown method is rejected", out.unknownMethod === "Unknown method: nope", out.unknownMethod);
  check("missing argument is rejected", out.missingArgument === "Missing argument: text", out.missingArgument);
  check("AndroidHost only ever receives strings", out.nonStringHostCalls === 0);
  socket.close();
} finally {
  chrome.kill();
  await chrome.exited;
  await server.stop();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
