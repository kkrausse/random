// End-to-end check of the shared client against a throwaway local OpenCode v2 server whose only
// provider is the local fake (scripts/mock-provider.ts). No real model is ever contacted.
//
//   bun run verify                      # scratch under client/.scratch
//   SCRATCH=/some/dir bun run verify

import { createReadingClient } from "../src/index";
import type { SessionEvent } from "../src/index";
import { MOCK_MODEL, startDevServer } from "./dev-server";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;

function check(name: string, pass: boolean, detail?: unknown) {
  if (!pass) failures++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${detail === undefined ? "" : ` ${JSON.stringify(detail)}`}`);
}

async function waitFor(what: string, done: () => boolean, timeoutMs = 15_000) {
  const started = Date.now();
  while (!done()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(50);
  }
}

const server = await startDevServer();
try {
  const config = { baseUrl: server.baseUrl, password: server.password, directory: server.directory };
  const requestFailures: unknown[] = [];
  // Lets the script cut the event stream to exercise reconnection.
  const streams: AbortController[] = [];
  const droppableFetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    if (!String(input).endsWith("/api/event")) return fetch(input, init);
    const controller = new AbortController();
    init?.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    streams.push(controller);
    return fetch(input, { ...init, signal: controller.signal });
  }) as typeof fetch;
  const client = createReadingClient(config, {
    fetch: droppableFetch,
    onRequestFailure: (failure) => requestFailures.push(failure)
  });
  const model = { providerId: MOCK_MODEL.providerID, modelId: MOCK_MODEL.id, variant: "high" };

  check("checkConnection", Boolean((await client.checkConnection()).version));
  const wrong = await createReadingClient({ ...config, password: "wrong" }).checkConnection()
    .then(() => "", (error: Error) => error.message);
  check("wrong password is a readable 401", wrong.includes("HTTP 401"), wrong);
  const dead = await createReadingClient({ ...config, baseUrl: "http://127.0.0.1:9" }).checkConnection()
    .then(() => "", (error: Error) => error.message);
  check("unreachable server is a readable error", dead.startsWith("Cannot reach OpenCode"), dead);

  // The catalog settles a moment after the location first loads; wait for the mock-only list.
  let models = await client.listModels();
  for (let attempt = 0; attempt < 20 && models.some((item) => item.providerId !== "mock"); attempt++) {
    await sleep(250);
    models = await client.listModels();
  }
  check("listModels", models.length === 2 && models[0].providerId === "mock", models);
  check("model variants", models.find((item) => item.modelId === "mock-1")?.variants.join() === "low,high");

  const session = await client.createSession({ model });
  check("createSession carries model and variant", session.model?.modelId === "mock-1" && session.model.variant === "high", session);

  const events: SessionEvent[] = [];
  const subscription = client.subscribe(session.id, (event) => events.push(event));
  check("subscription ready", await subscription.ready);
  const other = await client.createSession({ model });
  const otherEvents: SessionEvent[] = [];
  const otherSubscription = client.subscribe(other.id, (event) => otherEvents.push(event));
  await otherSubscription.ready;

  // Plain prompt: streamed deltas, then idle.
  const first = await client.sendPrompt(session.id, "Explain this passage.");
  check("sendPrompt returns the user message id", first.messageId.startsWith("msg_"), first);
  const early = await client.loadConversation(session.id, { pendingMessageId: first.messageId });
  check("conversation is busy right after the prompt", early.busy);
  await waitFor("idle", () => events.some((event) => event.kind === "idle"));
  const deltas = events.filter((event) => event.kind === "text.delta");
  const done = events.find((event) => event.kind === "text.done");
  check("busy event", events.some((event) => event.kind === "busy"));
  check("message event carries the model", events.some((event) => event.kind === "message" && event.model.modelId === "mock-1"));
  check("text deltas arrived from the start", deltas.length > 0 && deltas.every((event) => event.kind === "text.delta" && event.fromStart), deltas.length);
  const lastDelta = deltas[deltas.length - 1];
  check("accumulated delta text equals the final text",
    lastDelta?.kind === "text.delta" && done?.kind === "text.done" && lastDelta.text === done.text, done);
  check("usage event", events.some((event) => event.kind === "usage" && event.usage.input > 0));
  check("events are filtered by session", otherEvents.every((event) => event.kind === "connected"), otherEvents);

  const conversation = await client.loadConversation(session.id, { pendingMessageId: first.messageId });
  check("conversation idle after the run", !conversation.busy);
  check("messages are user then assistant", conversation.messages.map((message) => message.role).join() === "user,assistant", conversation.messages);
  const reply = conversation.messages[1];
  check("assistant message text, model, tokens, cost, duration",
    reply.text.startsWith("Mock reply") && reply.complete && reply.model?.variant === "high"
    && reply.usage!.input === 100 && reply.usage!.output === 25 && reply.usage!.cacheRead === 20
    && reply.usage!.cost > 0 && typeof reply.durationMs === "number", reply);
  check("session totals include tokens and cost", conversation.session.usage.input >= 100 && conversation.session.usage.cost > 0, conversation.session.usage);

  // Reasoning and a tool call.
  events.length = 0;
  await client.sendPrompt(session.id, 'Look around. [[reasoning]] [[tool:glob {"pattern":"*"}]]');
  await waitFor("idle", () => events.some((event) => event.kind === "idle"));
  check("tool started and completed",
    events.some((event) => event.kind === "tool" && event.tool === "glob" && event.status === "started")
    && events.some((event) => event.kind === "tool" && event.tool === "glob" && event.status === "completed"));
  check("reasoning event", events.some((event) => event.kind === "reasoning"));
  const withTool = await client.listMessages(session.id);
  check("tool step is its own assistant message", withTool.some((message) => message.tools?.join() === "glob" && !message.text), withTool.length);

  // Interrupt a slow reply.
  events.length = 0;
  await client.sendPrompt(session.id, "Take your time. [[slow]]");
  await waitFor("streamed text", () => events.some((event) => event.kind === "text.delta"));
  check("busy while streaming", (await client.loadConversation(session.id)).busy);
  check("interrupt", (await client.interrupt(session.id)).interrupted);
  await waitFor("interrupted idle", () => events.some((event) => event.kind === "idle"));
  const idle = events.find((event) => event.kind === "idle");
  check("idle outcome is interrupted", idle?.kind === "idle" && idle.outcome === "interrupted", idle);
  const interrupted = await client.loadConversation(session.id);
  const partial = interrupted.messages[interrupted.messages.length - 1];
  check("interrupted conversation is idle with partial text and no error",
    !interrupted.busy && partial.role === "assistant" && partial.complete && partial.text.startsWith("slow0") && !partial.error, partial);

  // Switch model on the session.
  await client.setModel(session.id, { providerId: "mock", modelId: "mock-2" });
  check("setModel", (await client.getSession(session.id)).model?.modelId === "mock-2");
  events.length = 0;
  await client.sendPrompt(session.id, "And again.");
  await waitFor("idle", () => events.some((event) => event.kind === "idle"));
  check("next reply uses the switched model", events.some((event) => event.kind === "message" && event.model.modelId === "mock-2"));

  // Provider failure: the server retries; the client reports it and Stop still works.
  events.length = 0;
  await client.sendPrompt(session.id, "Break. [[fail]]");
  await waitFor("retry", () => events.some((event) => event.kind === "retry"));
  check("retry event carries the provider message", events.some((event) => event.kind === "retry" && event.message.includes("mock provider failure")));
  await client.interrupt(session.id);
  await waitFor("idle after failed run", () => events.some((event) => event.kind === "idle"));

  // A model that does not exist fails the run outright.
  const broken = await client.createSession({ model: { providerId: "mock", modelId: "missing" } });
  const brokenEvents: SessionEvent[] = [];
  const brokenSubscription = client.subscribe(broken.id, (event) => brokenEvents.push(event));
  await brokenSubscription.ready;
  await client.sendPrompt(broken.id, "Hello?");
  await waitFor("error", () => brokenEvents.some((event) => event.kind === "error" || event.kind === "idle"));
  check("unknown model ends in an error event", brokenEvents.some((event) => event.kind === "error"), brokenEvents);
  const failed = await client.loadConversation(broken.id);
  check("failed conversation reports the error and is idle", !failed.busy && Boolean(failed.error), failed.error);
  brokenSubscription.close();

  const sessions = await client.listSessions();
  check("listSessions newest first with titles and usage",
    sessions.length === 3 && sessions.some((item) => item.id === session.id && item.usage.cost > 0 && item.title !== ""),
    sessions.map((item) => ({ title: item.title, updated: item.updated, cost: item.usage.cost })));

  // The checked-in policy must leave the model only read-only and web tools.
  const offered = [...new Set(server.provider.requests.flatMap((request) => request.tools))].sort();
  check("policy offers only read-only and web tools", offered.join() === "glob,grep,read,webfetch,websearch", offered);
  check("every provider request went to the mock", server.provider.requests.every((request) => request.path.endsWith("/chat/completions")));

  const missing = await client.getSession("ses_missing").then(() => "", (error: Error) => error.message);
  check("missing session is a readable error", missing.includes("Session not found"), missing);
  check("request failures were reported for diagnostics", requestFailures.length > 0, requestFailures);

  // Reconnect after the stream drops, and keep delivering events afterwards.
  events.length = 0;
  streams.forEach((controller) => controller.abort());
  await waitFor("disconnected", () => events.some((event) => event.kind === "disconnected"));
  await waitFor("reconnected", () => events.some((event) => event.kind === "connected" && event.reconnected));
  await client.sendPrompt(session.id, "Still there?");
  await waitFor("idle after reconnect", () => events.some((event) => event.kind === "idle"));
  check("stream reconnects and delivers events again", events.some((event) => event.kind === "text.done"));

  subscription.close();
  otherSubscription.close();
  const before = events.length;
  await sleep(300);
  check("no events after close", events.length === before);
} finally {
  await server.stop();
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
