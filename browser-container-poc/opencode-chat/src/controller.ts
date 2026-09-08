import { OpenCodeAPI, type Page, type Message, type NativeEvent } from "./api";
import { createV2SessionReducer } from "./vendor/reducer";
import type {
  ChatController,
  ChatOptions,
  ChatSnapshot,
  PermissionRequest,
  QuestionRequest,
  QuestionAnswers,
} from "./types";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) freeze(item);
  }
  return value;
}

/** Owns only its local state and injected HTTP requests. Creation never creates a session by default. */
export function createChatController(options: ChatOptions): ChatController {
  if (!options.directory?.trim())
    throw new Error("Caller directory is required");
  const api = new OpenCodeAPI(options.endpoint, options.directory);
  const reducer = createV2SessionReducer();
  let state: ChatSnapshot = freeze({
    connection: "connecting",
    sessionID: options.sessionID,
    sessions: [],
    models: [],
    messages: [],
    execution: "unknown",
    interruptRequested: false,
    sending: false,
    loading: true,
    loadingOlder: false,
    hasOlder: false,
    permissions: [],
    questions: [],
  });
  const listeners = new Set<() => void>();
  let disposed = false,
    generation = 0,
    selection = 0,
    revision = 0;
  let connection = new AbortController(),
    scope = new AbortController();
  let older: string | undefined | null, hydration: Promise<void> | undefined;
  let requestEvents: NativeEvent[] = [];
  const answered = new Set<string>();
  let recovery: ReturnType<typeof setTimeout> | undefined;
  let mutation: symbol | undefined;
  const publish = (patch: Partial<ChatSnapshot>) => {
    if (disposed) return;
    state = freeze({ ...state, ...patch });
    for (const listener of listeners) listener();
  };
  const check = () => {
    if (disposed) throw new Error("Chat controller is disposed");
  };
  const signal = () => AbortSignal.any([connection.signal, scope.signal]);
  const path = (id = state.sessionID) => {
    if (!id) throw new Error("Select a session first");
    return `session/${encodeURIComponent(id)}`;
  };
  const valid = (g: number, s: number) =>
    !disposed && g === generation && s === selection;
  async function action<T>(fn: () => Promise<T>): Promise<T> {
    check();
    const g = generation,
      s = selection;
    try {
      return await fn();
    } catch (e) {
      if (valid(g, s)) publish({ error: errorText(e) });
      throw e;
    }
  }
  function recover() {
    if (disposed || recovery || state.connection !== "connected") return;
    const g = generation,
      s = selection;
    recovery = setTimeout(() => {
      recovery = undefined;
      if (!valid(g, s)) return;
      void hydrate().catch((e) => {
        if (valid(g, s)) publish({ error: errorText(e) });
      });
    }, 120);
  }
  async function hydrate(): Promise<void> {
    if (hydration) return hydration;
    if (!state.sessionID) return;
    const g = generation,
      s = selection,
      rev = revision,
      base = path(),
      sig = signal();
    requestEvents = [];
    const task = (async () => {
      const [page, permissions, questions, active] = await Promise.all([
        api.request<Page<Message>>(
          `${base}/message?order=desc&limit=${options.pageSize ?? 50}`,
          sig,
        ),
        api.request<{ data: PermissionRequest[] }>(`${base}/permission`, sig),
        api.request<{ data: QuestionRequest[] }>(`${base}/question`, sig),
        api.request<{ data: Record<string, { type: string }> }>(
          "session/active",
          sig,
        ),
      ]);
      if (!valid(g, s)) return;
      // HTTP snapshots have no shared SSE cursor. Never replay overlapping deltas:
      // they may already be persisted. Refetch after the overlap instead.
      const messages = [...page.data].reverse();
      const ids = new Set(messages.map((m) => m.id));
      const prefix = state.messages.filter((m) => !ids.has(m.id));
      const first = messages[0]?.time.created ?? 0;
      const previous = prefix.filter((m) => m.time.created < first);
      if (!previous.length) older = page.cursor.next;
      publish({
        messages: [...previous, ...messages],
        hasOlder: !!older,
        permissions: permissions.data
          .filter((r) => !answered.has(`permission:${r.id}`))
          .map((request) => ({
            submitting: false,
            ...state.permissions.find((p) => p.request.id === request.id),
            request,
          })),
        questions: questions.data
          .filter((r) => !answered.has(`question:${r.id}`))
          .map((request) => ({
            submitting: false,
            ...state.questions.find((p) => p.request.id === request.id),
            request,
          })),
        ...(revision === rev
          ? {
              execution: active.data[state.sessionID!]
                ? ("running" as const)
                : ("idle" as const),
              ...(!active.data[state.sessionID!]
                ? { interruptRequested: false }
                : {}),
            }
          : {}),
        loading: false,
      });
      for (const e of requestEvents) requestEvent(e);
      if (revision !== rev) recover();
    })();
    hydration = task;
    try {
      await task;
    } finally {
      if (hydration === task) hydration = undefined;
    }
  }
  function requestEvent(e: NativeEvent) {
    if (e.type === "permission.asked")
      publish({
        permissions: [
          ...state.permissions.filter((p) => p.request.id !== e.data.id),
          { request: e.data, submitting: false },
        ],
      });
    if (e.type === "question.asked")
      publish({
        questions: [
          ...state.questions.filter((p) => p.request.id !== e.data.id),
          { request: e.data, submitting: false },
        ],
      });
    if (e.type === "permission.replied") {
      answered.add(`permission:${e.data.requestID}`);
      publish({
        permissions: state.permissions.filter(
          (p) => p.request.id !== e.data.requestID,
        ),
      });
    }
    if (e.type === "question.replied" || e.type === "question.rejected") {
      answered.add(`question:${e.data.requestID}`);
      publish({
        questions: state.questions.filter(
          (p) => p.request.id !== e.data.requestID,
        ),
      });
    }
  }
  function event(e: NativeEvent) {
    if (
      !("data" in e) ||
      !("sessionID" in e.data) ||
      e.data.sessionID !== state.sessionID
    )
      return;
    revision++;
    requestEvent(e);
    if (hydration && /^(permission|question)\./.test(e.type))
      requestEvents.push(e);
    if (e.type === "session.execution.started")
      publish({ execution: "running" });
    if (e.type === "session.retry.scheduled")
      publish({ execution: "retrying" });
    if (e.type === "session.status")
      publish({
        execution:
          e.data.status.type === "idle"
            ? "idle"
            : e.data.status.type === "retry"
              ? "retrying"
              : "running",
        ...(e.data.status.type === "idle" ? { interruptRequested: false } : {}),
      });
    if (e.type === "session.model.selected") publish({ model: e.data.model });
    if (/^session\.execution\.(succeeded|failed|interrupted)$/.test(e.type)) {
      publish({
        execution: "idle",
        interruptRequested: false,
        ...("error" in e.data
          ? { error: errorText(JSON.stringify(e.data.error)) }
          : {}),
      });
      recover();
    }
    if (hydration) {
      recover();
      return;
    }
    const before = state.messages;
    const reduced = reducer.reduce(before, e);
    if (reduced?.touched.length) publish({ messages: reduced.messages });
    if (
      reduced &&
      "assistantMessageID" in e.data &&
      /\.(delta|success|failed)$/.test(e.type)
    ) {
      const id = e.data.assistantMessageID,
        old = before.find((m) => m.id === id),
        next = reduced.messages.find((m) => m.id === id);
      if (
        old?.type === "assistant" &&
        next?.type === "assistant" &&
        old.content.every((p, i) => next.content[i] === p)
      )
        recover();
    }
    if (
      reduced?.missing ||
      (reduced && !reduced.touched.length && "assistantMessageID" in e.data)
    )
      recover();
    if (
      e.type === "session.input.promoted" ||
      e.type === "session.model.selected"
    )
      recover();
    if (
      /^session\.(text|reasoning|tool\.input)\.ended$/.test(e.type) ||
      e.type === "session.step.ended"
    )
      recover();
  }
  async function selectSession(id: string) {
    check();
    scope.abort();
    scope = new AbortController();
    selection++;
    hydration = undefined;
    mutation = undefined;
    if (recovery) clearTimeout(recovery);
    recovery = undefined;
    if (state.sessionID) reducer.clear(state.sessionID);
    answered.clear();
    older = undefined;
    publish({
      sessionID: id,
      model: state.sessions.find((s) => s.id === id)?.model,
      messages: [],
      permissions: [],
      questions: [],
      loading: true,
      loadingOlder: false,
      hasOlder: false,
      execution: "unknown",
      sending: false,
      interruptRequested: false,
    });
    const g = generation,
      s = selection;
    try {
      await action(hydrate);
    } finally {
      if (valid(g, s)) publish({ loading: false });
    }
  }
  async function reconnect() {
    check();
    generation++;
    connection.abort();
    scope.abort();
    connection = new AbortController();
    scope = new AbortController();
    mutation = undefined;
    hydration = undefined;
    if (recovery) clearTimeout(recovery);
    recovery = undefined;
    const g = generation,
      ctl = connection,
      selectionAtStart = selection;
    if (state.sessionID) reducer.clear(state.sessionID);
    publish({
      connection: "connecting",
      loading: true,
      error: undefined,
      execution: "unknown",
      sending: false,
    });
    let resolve!: () => void, reject!: (e: unknown) => void;
    const marker = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void marker.catch(() => {});
    const timer = setTimeout(() => {
      reject(new Error("OpenCode event handshake timed out"));
      ctl.abort();
    }, options.handshakeTimeoutMs ?? 15000);
    ctl.signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("Connection cancelled"));
      },
      { once: true },
    );
    void api
      .events(
        ctl.signal,
        () => {
          clearTimeout(timer);
          resolve();
        },
        (e) => {
          if (g === generation && !ctl.signal.aborted) event(e);
        },
      )
      .catch((e) => {
        clearTimeout(timer);
        reject(e);
        if (g !== generation || disposed || ctl.signal.aborted) return;
        publish({
          connection: "disconnected",
          execution: "unknown",
          error: errorText(e),
        });
        ctl.abort();
      });
    try {
      await marker;
      const [sessions, models] = await Promise.all([
        api.list(ctl.signal),
        api.models(ctl.signal),
      ]);
      if (g !== generation || disposed) return;
      publish({ sessions, models, connection: "connected" });
      if (selection !== selectionAtStart) return;
      const id = state.sessionID ?? sessions[0]?.id;
      if (id) await selectSession(id);
      else if (options.autoCreateSession) await controller.createSession();
      else publish({ loading: false, execution: "idle" });
    } catch (e) {
      if (g === generation && !disposed) {
        publish({
          connection: "disconnected",
          loading: false,
          error: errorText(e),
        });
        ctl.abort();
      }
      throw e;
    }
  }
  async function reply(
    kind: "permission" | "question",
    id: string,
    suffix: string,
    body: unknown,
  ) {
    await action(async () => {
      const list = kind === "permission" ? state.permissions : state.questions;
      const entry = list.find((p) => p.request.id === id);
      if (!entry) throw new Error("Request is no longer pending");
      if (entry.submitting) throw new Error("Response is already submitting");
      const g = generation,
        s = selection;
      const update = (error?: string, submitting = false, remove = false) => {
        if (!valid(g, s)) return;
        if (kind === "permission")
          publish({
            permissions: state.permissions.flatMap((p) =>
              p.request.id !== id
                ? [p]
                : remove
                  ? []
                  : [{ ...p, error, submitting }],
            ),
          });
        else
          publish({
            questions: state.questions.flatMap((p) =>
              p.request.id !== id
                ? [p]
                : remove
                  ? []
                  : [{ ...p, error, submitting }],
            ),
          });
      };
      update(undefined, true);
      try {
        await api.request(
          `${path()}/${kind}/${encodeURIComponent(id)}/${suffix}`,
          signal(),
          body,
        );
        if (valid(g, s)) answered.add(`${kind}:${id}`);
        update(undefined, false, true);
      } catch (e) {
        update(errorText(e));
        throw e;
      }
    });
  }
  const controller: ChatController = {
    ready: undefined as unknown as Promise<void>,
    getSnapshot: () => state,
    subscribe(notify) {
      check();
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    selectSession,
    reconnect,
    async createSession(title) {
      return action(async () => {
        if (mutation) throw new Error("A session operation is pending");
        const token = (mutation = Symbol());
        const g = generation,
          s = selection;
        try {
          const session = await api.create(title ?? "New chat", signal());
          if (valid(g, s)) {
            publish({ sessions: [session, ...state.sessions] });
            await selectSession(session.id);
          }
          return session.id;
        } finally {
          if (mutation === token) mutation = undefined;
        }
      });
    },
    async loadOlder() {
      await action(async () => {
        if (!older || state.loadingOlder) return;
        const cursor = older,
          g = generation,
          s = selection;
        publish({ loadingOlder: true });
        try {
          const page = await api.request<Page<Message>>(
            `${path()}/message?cursor=${encodeURIComponent(cursor)}`,
            signal(),
          );
          if (!valid(g, s)) return;
          if (page.cursor.next === cursor)
            throw new Error("Repeated history cursor");
          older = page.cursor.next;
          const ids = new Set(state.messages.map((m) => m.id));
          publish({
            messages: [...page.data]
              .reverse()
              .filter((m) => !ids.has(m.id))
              .concat([...state.messages]),
            hasOlder: !!older,
          });
        } finally {
          if (valid(g, s)) publish({ loadingOlder: false });
        }
      });
    },
    async send(draft) {
      await action(async () => {
        if (!draft.text.trim()) throw new Error("Enter a message");
        if (
          state.connection !== "connected" ||
          state.loading ||
          state.sending ||
          mutation ||
          state.execution !== "idle"
        )
          throw new Error("Chat is not ready to send");
        const g = generation,
          s = selection,
          base = path();
        publish({ sending: true, error: undefined });
        try {
          await api.request(`${base}/prompt`, signal(), { text: draft.text });
          if (valid(g, s)) {
            try {
              await hydrate();
            } catch (e) {
              // Prompt acceptance is known. Do not present a refresh failure as
              // a failed submission, which would invite duplicate resubmission.
              if (valid(g, s))
                publish({
                  error: `Message accepted; refresh failed: ${errorText(e)}`,
                  execution: "unknown",
                });
            }
          }
        } finally {
          if (valid(g, s)) publish({ sending: false });
        }
      });
    },
    async selectModel(model) {
      await action(async () => {
        if (!model)
          throw new Error(
            "Select an explicit model; the pinned API cannot reset a session model",
          );
        if (state.execution !== "idle" || mutation || state.sending)
          throw new Error("Wait for the current operation");
        path();
        const g = generation,
          s = selection,
          token = (mutation = Symbol());
        try {
          await api.model(state.sessionID!, model, signal());
          if (valid(g, s))
            publish({
              model,
              sessions: state.sessions.map((session) =>
                session.id === state.sessionID
                  ? { ...session, model }
                  : session,
              ),
            });
        } finally {
          if (mutation === token) mutation = undefined;
        }
      });
    },
    async interrupt() {
      await action(async () => {
        const base = path(),
          g = generation,
          s = selection;
        publish({ interruptRequested: true });
        await api.response(`${base}/interrupt`, {
          method: "POST",
          signal: signal(),
        });
        if (valid(g, s)) await hydrate();
      });
    },
    replyPermission: (id, decision) =>
      reply("permission", id, "reply", { reply: decision }),
    replyQuestion(id, answers) {
      return action(async () => {
        validateAnswers(
          state.questions.find((q) => q.request.id === id)?.request,
          answers,
        );
        await reply("question", id, "reply", { answers });
      });
    },
    rejectQuestion: (id) => reply("question", id, "reject", {}),
    clearError: () => publish({ error: undefined }),
    dispose() {
      if (disposed) return;
      disposed = true;
      generation++;
      connection.abort();
      scope.abort();
      if (recovery) clearTimeout(recovery);
      if (state.sessionID) reducer.clear(state.sessionID);
      listeners.clear();
    },
  };
  Object.defineProperty(controller, "ready", {
    value: reconnect(),
    enumerable: true,
  });
  void controller.ready.catch(() => {});
  return controller;
}

function validateAnswers(
  request: QuestionRequest | undefined,
  answers: QuestionAnswers,
) {
  if (!request) throw new Error("Question is no longer pending");
  if (answers.length !== request.questions.length)
    throw new Error("Answer every question");
  request.questions.forEach((question, i) => {
    const answer = answers[i]!;
    if (
      !answer.length ||
      answer.some((a) => !a.trim()) ||
      (!question.multiple && answer.length !== 1)
    )
      throw new Error("Choose an answer for each question");
    if (
      question.custom === false &&
      answer.some((a) => !question.options.some((o) => o.label === a))
    )
      throw new Error("Choose one of the offered answers");
  });
}
