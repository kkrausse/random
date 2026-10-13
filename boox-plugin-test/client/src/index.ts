// Shared Reading Context client for OpenCode Server v2.
//
// A small normalized layer over the official `@opencode/client`, exposing only what the Chrome
// extension and the Android app need. Every argument and result is plain JSON-serializable data so
// the same functions can be called across the Android WebView bridge (see android-bridge.ts).

import { OpenCode } from "@opencode/client";
import type { SessionInfo, SessionMessageInfo, V2Event } from "@opencode/client";

export interface ConnectionConfig {
  /** Server origin, e.g. `http://raspberrypi.example.ts.net:41137`. */
  baseUrl: string;
  /** HTTP Basic password (user is always `opencode`). Empty sends no Authorization header. */
  password: string;
  /** OpenCode location: the absolute workdir on the server. */
  directory: string;
}

export interface ModelRef {
  providerId: string;
  modelId: string;
  /** Omitted or empty means the model's default variant. */
  variant?: string;
}

export interface Model {
  providerId: string;
  modelId: string;
  name: string;
  variants: string[];
}

export interface Usage {
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  /** USD. */
  cost: number;
}

export interface Session {
  id: string;
  /** Empty until the server has generated one. */
  title: string;
  /** Epoch milliseconds. */
  created: number;
  updated: number;
  model?: ModelRef;
  /** Server-side totals for the whole session, title generation included. */
  usage: Usage;
  outcome?: "succeeded" | "failed" | "interrupted";
}

export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  /** False while an assistant step is still running. User messages are always complete. */
  complete: boolean;
  created: number;
  /** Assistant only. One assistant message is one provider step; tool-only steps have empty text. */
  model?: ModelRef;
  usage?: Usage;
  durationMs?: number;
  /** Names of tools this step called. */
  tools?: string[];
  /** Provider or step failure, when the step ended in one (an interrupt is not an error). */
  error?: string;
}

export interface Conversation {
  session: Session;
  /** Oldest first, at most the latest 200. */
  messages: Message[];
  /** True while the server is still working on this session. */
  busy: boolean;
  /** Failure message when the most recent run failed. */
  error?: string;
}

export type SessionEvent =
  /** The event stream is open. `reconnected` means events may have been missed: reload. */
  | { kind: "connected"; reconnected: boolean }
  /** The stream dropped; the client keeps retrying on its own. */
  | { kind: "disconnected"; message: string }
  /** The server started working on a prompt. */
  | { kind: "busy" }
  /** A new assistant message (one provider step) started. */
  | { kind: "message"; messageId: string; model: ModelRef }
  /** The model is reasoning before answering. */
  | { kind: "reasoning"; messageId: string }
  /**
   * More answer text. `text` is everything received for this message so far; when `fromStart` is
   * false the subscription joined mid-message and `text` lacks the beginning until `text.done`.
   */
  | { kind: "text.delta"; messageId: string; delta: string; text: string; fromStart: boolean }
  /** The authoritative full text of a finished text part. */
  | { kind: "text.done"; messageId: string; text: string }
  | { kind: "tool"; messageId: string; tool: string; status: "started" | "completed" | "failed" }
  /** The provider call failed and the server scheduled another attempt. */
  | { kind: "retry"; attempt: number; message: string }
  /** The session is waiting on a permission prompt or question that these UIs cannot answer. */
  | { kind: "blocked"; reason: "permission" | "question"; message: string }
  | { kind: "usage"; usage: Usage }
  | { kind: "title"; title: string }
  /** The run finished. Reload messages for the canonical transcript. */
  | { kind: "idle"; outcome: "succeeded" | "interrupted" }
  /** The run failed. Terminal, like `idle`. */
  | { kind: "error"; message: string };

export interface Subscription {
  /** Resolves true once the stream is first connected, false if closed before that. */
  ready: Promise<boolean>;
  close: () => void;
}

export interface RequestFailure {
  method: string;
  path: string;
  /** Set for HTTP errors. */
  status?: number;
  /** Set for network errors. */
  message?: string;
}

export interface ReadingClientOptions {
  fetch?: typeof fetch;
  /** Called for every failed HTTP request, for local diagnostics. Never receives bodies. */
  onRequestFailure?: (failure: RequestFailure) => void;
  /** Per-request timeout for everything except the event stream. Default 120000. */
  requestTimeoutMs?: number;
}

export interface ReadingClient {
  /** Authenticated reachability check. */
  checkConnection: () => Promise<{ version: string }>;
  /** Active, enabled models for the configured directory. */
  listModels: () => Promise<Model[]>;
  /** Most recently updated first. Default limit 50. */
  listSessions: (options?: { limit?: number }) => Promise<Session[]>;
  /** The model is a property of the session in v2: choose it here, or later with `setModel`. */
  createSession: (options?: { model?: ModelRef; title?: string }) => Promise<Session>;
  getSession: (sessionId: string) => Promise<Session>;
  setModel: (sessionId: string, model: ModelRef) => Promise<void>;
  /** Queues the prompt and returns at once; the reply arrives through `subscribe`. */
  sendPrompt: (sessionId: string, text: string) => Promise<{ messageId: string }>;
  interrupt: (sessionId: string) => Promise<{ interrupted: boolean }>;
  listMessages: (sessionId: string) => Promise<Message[]>;
  /**
   * Session, messages, and busy state in one call. Pass the `messageId` returned by `sendPrompt`
   * as `pendingMessageId` so a prompt the server has not yet picked up still counts as busy.
   */
  loadConversation: (sessionId: string, options?: { pendingMessageId?: string }) => Promise<Conversation>;
  /** Normalized events for one session. Reconnects until closed. */
  subscribe: (sessionId: string, onEvent: (event: SessionEvent) => void) => Subscription;
}

const MESSAGE_LIMIT = 200;
// The server sends a heartbeat comment every 15 seconds.
const STREAM_STALL_MS = 45_000;
const RECONNECT_MAX_MS = 10_000;

export function emptyUsage(): Usage {
  return { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

export function addUsage(left: Usage, right: Usage | undefined): Usage {
  if (!right) return left;
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    reasoning: left.reasoning + right.reasoning,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    cost: left.cost + right.cost
  };
}

interface ApiTokens {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: { read?: number; write?: number };
}

function usageFrom(tokens: ApiTokens | undefined, cost: number | undefined): Usage {
  return {
    input: tokens?.input || 0,
    output: tokens?.output || 0,
    reasoning: tokens?.reasoning || 0,
    cacheRead: tokens?.cache?.read || 0,
    cacheWrite: tokens?.cache?.write || 0,
    cost: cost || 0
  };
}

function modelRefFrom(model: { id: string; providerID: string; variant?: string } | undefined): ModelRef | undefined {
  if (!model?.id || !model.providerID) return undefined;
  // The server reports "default" when no variant was chosen.
  const variant = model.variant && model.variant !== "default" ? { variant: model.variant } : {};
  return { providerId: model.providerID, modelId: model.id, ...variant };
}

function apiModel(model: ModelRef) {
  return {
    providerID: model.providerId,
    id: model.modelId,
    ...(model.variant ? { variant: model.variant } : {})
  };
}

export function sessionFromApi(info: SessionInfo): Session {
  const model = modelRefFrom(info.model);
  return {
    id: info.id,
    title: info.title || "",
    created: info.time?.created || 0,
    updated: info.time?.updated || 0,
    ...(model ? { model } : {}),
    usage: usageFrom(info.tokens, info.cost),
    ...(info.outcome ? { outcome: info.outcome } : {})
  };
}

/** Keeps user and assistant messages (oldest first) and drops the server's bookkeeping entries. */
export function messagesFromApi(raw: SessionMessageInfo[]): Message[] {
  const messages: Message[] = [];
  for (const item of raw) {
    if (item.type === "user") {
      messages.push({
        id: item.id, role: "user", text: item.text || "", complete: true, created: item.time?.created || 0
      });
    } else if (item.type === "assistant") {
      const content = item.content || [];
      const tools = content.flatMap((part) => part.type === "tool" ? [part.name] : []);
      const model = modelRefFrom(item.model);
      const completed = item.time?.completed;
      const failed = item.error && item.error.type !== "aborted" ? item.error.message : "";
      messages.push({
        id: item.id,
        role: "assistant",
        text: content.flatMap((part) => part.type === "text" ? [part.text || ""] : []).join(""),
        complete: Boolean(completed),
        created: item.time?.created || 0,
        ...(model ? { model } : {}),
        usage: usageFrom(item.tokens, item.cost),
        ...(completed ? { durationMs: Math.max(0, completed - item.time.created) } : {}),
        ...(tools.length ? { tools } : {}),
        ...(failed ? { error: failed } : {})
      });
    }
  }
  return messages;
}

/** Per-subscription memory needed to turn the server's granular events into `SessionEvent`s. */
export interface EventState {
  /** Text parts received so far, per assistant message, keyed by part ordinal. */
  texts: Map<string, { parts: Map<number, string>; fromStart: boolean }>;
  /** Tool call id to tool name. */
  tools: Map<string, string>;
  running: boolean;
}

export function newEventState(): EventState {
  return { texts: new Map(), tools: new Map(), running: false };
}

function joinedText(parts: Map<number, string>): string {
  return [...parts.keys()].sort((a, b) => a - b).map((ordinal) => parts.get(ordinal)).join("");
}

/** Maps one server event to zero or more normalized events for `sessionId`. */
export function normalizeEvent(state: EventState, sessionId: string, event: V2Event): SessionEvent[] {
  if (event.type === "form.created") {
    return event.data.form.sessionID === sessionId
      ? [{ kind: "blocked", reason: "question", message: event.data.form.title || "OpenCode asked a question." }]
      : [];
  }
  const data = event.data as { sessionID?: string } | undefined;
  if (!data || data.sessionID !== sessionId) return [];

  switch (event.type) {
    case "session.execution.started":
      state.running = true;
      return [{ kind: "busy" }];
    case "session.step.started": {
      state.running = true;
      const model = modelRefFrom(event.data.model);
      return model ? [{ kind: "message", messageId: event.data.assistantMessageID, model }] : [];
    }
    case "session.reasoning.started":
      return [{ kind: "reasoning", messageId: event.data.assistantMessageID }];
    case "session.text.started": {
      const entry = state.texts.get(event.data.assistantMessageID)
        || { parts: new Map<number, string>(), fromStart: event.data.ordinal === 0 };
      entry.parts.set(event.data.ordinal, "");
      state.texts.set(event.data.assistantMessageID, entry);
      return [];
    }
    case "session.text.delta": {
      const { assistantMessageID: messageId, ordinal, delta } = event.data;
      const entry = state.texts.get(messageId) || { parts: new Map<number, string>(), fromStart: false };
      entry.parts.set(ordinal, (entry.parts.get(ordinal) || "") + delta);
      state.texts.set(messageId, entry);
      state.running = true;
      return [{ kind: "text.delta", messageId, delta, text: joinedText(entry.parts), fromStart: entry.fromStart }];
    }
    case "session.text.ended": {
      const { assistantMessageID: messageId, ordinal, text } = event.data;
      const entry = state.texts.get(messageId) || { parts: new Map<number, string>(), fromStart: ordinal === 0 };
      entry.parts.set(ordinal, text);
      // The finished part is whole, so a mid-message join is repaired if it was the first part.
      if (ordinal === 0) entry.fromStart = true;
      state.texts.set(messageId, entry);
      return [{ kind: "text.done", messageId, text: joinedText(entry.parts) }];
    }
    case "session.step.ended":
    case "session.step.failed":
      state.texts.delete(event.data.assistantMessageID);
      return [];
    case "session.tool.input.started":
      state.tools.set(event.data.id, event.data.name);
      return [{ kind: "tool", messageId: event.data.assistantMessageID, tool: event.data.name, status: "started" }];
    case "session.tool.success":
    case "session.tool.failed": {
      const tool = state.tools.get(event.data.id) || "";
      state.tools.delete(event.data.id);
      return [{
        kind: "tool",
        messageId: event.data.assistantMessageID,
        tool,
        status: event.type === "session.tool.success" ? "completed" : "failed"
      }];
    }
    case "session.retry.scheduled":
      return [{ kind: "retry", attempt: event.data.attempt, message: event.data.error?.message || "" }];
    case "permission.asked":
      return [{
        kind: "blocked",
        reason: "permission",
        message: event.data.message || `OpenCode asked for permission: ${event.data.action}`
      }];
    case "session.usage.updated":
      return [{ kind: "usage", usage: usageFrom(event.data.tokens, event.data.cost) }];
    case "session.renamed":
      return [{ kind: "title", title: event.data.title }];
    case "session.execution.succeeded":
      state.running = false;
      return [{ kind: "idle", outcome: "succeeded" }];
    case "session.execution.interrupted":
      state.running = false;
      return [{ kind: "idle", outcome: "interrupted" }];
    case "session.execution.failed":
      state.running = false;
      return [{ kind: "error", message: event.data.error?.message || "OpenCode run failed." }];
    case "session.idle":
      // Only matters if the execution events above were not seen for this run.
      if (!state.running) return [];
      state.running = false;
      return [{ kind: "idle", outcome: "succeeded" }];
    default:
      return [];
  }
}

/** Turns anything the official client throws into an Error with a readable message. */
export function describeError(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const value = error as { _tag?: string; reason?: string; message?: string; cause?: unknown };
  if (value._tag === "UnauthorizedError") {
    return "OpenCode returned HTTP 401: the server password is missing or wrong.";
  }
  if (value._tag) return `OpenCode error: ${value.message || value._tag}`;
  if (value.reason === "Transport") {
    const cause = value.cause as { name?: string; message?: string } | undefined;
    if (cause?.name === "AbortError" || cause?.name === "TimeoutError") return "OpenCode request timed out.";
    return `Cannot reach OpenCode: ${cause?.message || "network error"}`;
  }
  if (value.reason === "UnexpectedStatus") {
    const status = (value.cause as { status?: number } | undefined)?.status;
    return `OpenCode returned HTTP ${status ?? "error"}.`;
  }
  return value.message || String(error);
}

function basicAuthorization(password: string): string {
  const bytes = new TextEncoder().encode(`opencode:${password}`);
  return `Basic ${btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))}`;
}

function instrumentedFetch(options: ReadingClientOptions): typeof fetch {
  const base = options.fetch || ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.requestTimeoutMs ?? 120_000;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const path = new URL(url).pathname;
    const method = init?.method || "GET";
    const outer = init?.signal;
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (outer?.aborted) abort();
    else outer?.addEventListener("abort", abort, { once: true });
    // The event stream stays open indefinitely; its liveness is watched by `subscribe`.
    const timer = path.endsWith("/api/event") ? null : setTimeout(abort, timeoutMs);
    try {
      const response = await base(input, { ...init, signal: controller.signal });
      if (!response.ok) options.onRequestFailure?.({ method, path, status: response.status });
      return response;
    } catch (error) {
      if (!outer?.aborted) {
        options.onRequestFailure?.({
          method, path, message: error instanceof Error ? error.message : String(error)
        });
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }) as typeof fetch;
}

export function createReadingClient(config: ConnectionConfig, options: ReadingClientOptions = {}): ReadingClient {
  const directory = config.directory.trim();
  const password = config.password.trim();
  const api = OpenCode.make({
    baseUrl: config.baseUrl.trim().replace(/\/+$/, ""),
    fetch: instrumentedFetch(options),
    headers: {
      Accept: "application/json, text/event-stream",
      ...(password ? { Authorization: basicAuthorization(password) } : {})
    }
  });
  const location = { directory };

  const call = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw new Error(describeError(error), { cause: error });
    }
  };

  const rawMessages = async (sessionId: string) => {
    // Newest first so a long chat keeps its latest messages, then flipped to reading order.
    const response = await api.message.list({ sessionID: sessionId, limit: MESSAGE_LIMIT, order: "desc" });
    return response.data.slice().reverse();
  };

  const listModels = () => call(async () => {
    // Right after a server start the catalog for a location is briefly empty while it loads.
    for (let attempt = 0; ; attempt++) {
      const response = await api.model.list({ location });
      const models = response.data.filter((model) => model.status === "active" && model.enabled);
      if (models.length || attempt === 3) {
        return models.map((model) => ({
          providerId: model.providerID,
          modelId: model.id,
          name: model.name || model.id,
          variants: model.variants.map((variant) => variant.id)
        }));
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  });

  const subscribe = (sessionId: string, onEvent: (event: SessionEvent) => void): Subscription => {
    let closed = false;
    let controller: AbortController | null = null;
    let wake = () => {};
    let everConnected = false;
    let markReady: (connected: boolean) => void = () => {};
    const ready = new Promise<boolean>((resolve) => { markReady = resolve; });

    const run = async () => {
      let attempt = 0;
      while (!closed) {
        const state = newEventState();
        const active = new AbortController();
        controller = active;
        let lastActivity = Date.now();
        let failure = "OpenCode event stream disconnected.";
        const watchdog = setInterval(() => {
          if (Date.now() - lastActivity <= STREAM_STALL_MS) return;
          failure = "OpenCode event stream stalled.";
          active.abort();
        }, 5_000);
        try {
          const events = api.event.subscribe({
            signal: active.signal,
            onActivity: () => { lastActivity = Date.now(); }
          });
          for await (const event of events) {
            if (closed) break;
            lastActivity = Date.now();
            if (event.type === "server.connected") {
              attempt = 0;
              onEvent({ kind: "connected", reconnected: everConnected });
              everConnected = true;
              markReady(true);
              continue;
            }
            for (const normalized of normalizeEvent(state, sessionId, event)) onEvent(normalized);
          }
        } catch (error) {
          failure = describeError(error);
        } finally {
          clearInterval(watchdog);
          active.abort();
        }
        if (closed) break;
        onEvent({ kind: "disconnected", message: failure });
        const delay = Math.min(1_000 * 2 ** attempt, RECONNECT_MAX_MS);
        attempt++;
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, delay);
          wake = () => { clearTimeout(timer); resolve(); };
        });
      }
      markReady(false);
    };
    void run();

    return {
      ready,
      close: () => {
        closed = true;
        controller?.abort();
        wake();
      }
    };
  };

  return {
    checkConnection: () => call(async () => ({ version: (await api.server.info()).version })),
    listModels,
    listSessions: (listOptions) => call(async () => {
      const response = await api.session.list({
        directory, limit: listOptions?.limit ?? 50, order: "desc", parentID: null
      });
      return response.data.map(sessionFromApi);
    }),
    createSession: (createOptions) => call(async () => sessionFromApi(await api.session.create({
      location,
      ...(createOptions?.model?.modelId ? { model: apiModel(createOptions.model) } : {}),
      ...(createOptions?.title ? { title: createOptions.title } : {})
    }))),
    getSession: (sessionId) => call(async () => sessionFromApi(await api.session.get({ sessionID: sessionId }))),
    setModel: (sessionId, model) => call(() => api.session.switchModel({ sessionID: sessionId, model: apiModel(model) })),
    sendPrompt: (sessionId, text) => call(async () => {
      const queued = await api.session.prompt({ sessionID: sessionId, text });
      return { messageId: queued.id };
    }),
    interrupt: (sessionId) => call(async () => {
      const result = await api.session.interrupt({ sessionID: sessionId });
      return { interrupted: Boolean(result.interrupted) };
    }),
    listMessages: (sessionId) => call(async () => messagesFromApi(await rawMessages(sessionId))),
    loadConversation: (sessionId, loadOptions) => call(async () => {
      const [info, raw, active] = await Promise.all([
        api.session.get({ sessionID: sessionId }),
        rawMessages(sessionId),
        api.session.active()
      ]);
      const messages = messagesFromApi(raw);
      const last = raw[raw.length - 1];
      const pending = loadOptions?.pendingMessageId;
      // `active` is authoritative once the server has picked the prompt up; before that the
      // queued prompt is not yet a message, which is what `pendingMessageId` covers.
      const busy = Boolean(active[sessionId]) || Boolean(pending && !raw.some((item) => item.id === pending));
      const error = last?.type === "idle" && last.outcome === "failed" ? last.error?.message || "OpenCode run failed." : "";
      return { session: sessionFromApi(info), messages, busy, ...(error ? { error } : {}) };
    }),
    subscribe
  };
}
