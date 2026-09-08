import { afterEach, expect, test } from "bun:test";
import { createChatController } from "../src";
import type { ChatController } from "../src/types";
import { fixture, deferred, json, tick, user } from "./fixture";
const controllers: ChatController[] = [];
function start(f = fixture()) {
  const c = createChatController({
    endpoint: f.endpoint,
    directory: "/hidden",
    pageSize: 2,
  });
  controllers.push(c);
  return { f, c };
}
afterEach(() => {
  controllers.splice(0).forEach((c) => c.dispose());
});

test("headless bootstrap uses injected string fetch, marker, requests, immutable stable snapshots and no session mutation", async () => {
  const { f, c } = start();
  await c.ready;
  expect(c.getSnapshot().connection).toBe("connected");
  expect(c.getSnapshot().sessionID).toBe("s1");
  expect(c.getSnapshot()).toBe(c.getSnapshot());
  expect(Object.isFrozen(c.getSnapshot().sessions)).toBe(true);
  expect(f.calls.every((call) => call.url.host === "injected.invalid")).toBe(
    true,
  );
  expect(f.calls.filter((call) => call.init.method === "POST")).toHaveLength(0);
  expect(
    f.calls
      .find((call) => call.url.pathname.endsWith("/session"))!
      .url.searchParams.get("directory"),
  ).toBe("/hidden");
  const before = f.cancels;
  c.dispose();
  await tick();
  expect(f.cancels).toBe(before + 1);
  expect(
    f.calls.some(
      (call) =>
        call.url.pathname.includes("interrupt") ||
        call.url.pathname.includes("stop"),
    ),
  ).toBe(false);
});

test("selection races cannot overwrite newer history", async () => {
  const { f, c } = start();
  await c.ready;
  const pending = deferred<Response>();
  f.override = (url) =>
    url.pathname.endsWith("s1/message") ? pending.promise : undefined;
  const first = c.selectSession("s1");
  await tick();
  f.histories.s2 = [user("second")];
  await c.selectSession("s2");
  pending.resolve(json({ data: [user("stale")], cursor: {} }));
  await first;
  expect(c.getSnapshot().messages.map((m) => m.id)).toEqual(["second"]);
});

test("selection during bootstrap wins over automatic first selection", async () => {
  const f = fixture(),
    pending = deferred<Response>();
  f.override = (url) =>
    url.pathname.endsWith("/session") ? pending.promise : undefined;
  const { c } = start(f);
  await tick();
  await c.selectSession("s2");
  pending.resolve(json({ data: [{ id: "s1" }], cursor: {} }));
  await c.ready;
  expect(c.getSnapshot().sessionID).toBe("s2");
});

test("overlapping history never replays deltas already persisted", async () => {
  const { f, c } = start();
  await c.ready;
  const pending = deferred<Response>();
  f.override = (url) =>
    url.pathname.endsWith("/message") ? pending.promise : undefined;
  const selecting = c.selectSession("s1");
  await tick();
  f.emit("session.text.delta", {
    sessionID: "s1",
    assistantMessageID: "a",
    ordinal: 0,
    delta: "hello",
  });
  await tick();
  pending.resolve(
    json({
      data: [
        {
          id: "a",
          type: "assistant",
          content: [{ type: "text", text: "hello" }],
          time: { created: 1 },
          model: { id: "m", providerID: "p" },
          agent: "build",
        },
      ],
      cursor: {},
    }),
  );
  await selecting;
  expect(JSON.stringify(c.getSnapshot().messages)).not.toContain("hellohello");
  expect((c.getSnapshot().messages[0] as any).content[0].text).toBe("hello");
});

test("pending requests hydrate; failed response retains request and can retry pinned payload", async () => {
  const f = fixture();
  f.permissions.push({
    id: "r",
    sessionID: "s1",
    action: "edit",
    resources: ["file"],
  });
  const { c } = start(f);
  await c.ready;
  f.override = (url) =>
    url.pathname.endsWith("/reply") ? json({ error: "no" }, 500) : undefined;
  await expect(c.replyPermission("r", "once")).rejects.toThrow("500");
  expect(c.getSnapshot().permissions[0]!.error).toContain("500");
  expect(c.getSnapshot().permissions[0]!.submitting).toBe(false);
  f.override = undefined;
  await c.replyPermission("r", "always");
  expect(c.getSnapshot().permissions).toHaveLength(0);
  const call = f.calls.at(-1)!;
  expect(call.url.pathname).toBe("/proxy/api/session/s1/permission/r/reply");
  expect(JSON.parse(String(call.init.body))).toEqual({ reply: "always" });
});

test("question rules and removal answered elsewhere", async () => {
  const f = fixture();
  f.questions.push({
    id: "q",
    sessionID: "s1",
    questions: [
      {
        header: "Pick",
        question: "Which?",
        options: [
          { label: "A", description: "a" },
          { label: "B", description: "b" },
        ],
        custom: false,
        multiple: false,
      },
    ],
  });
  const { c } = start(f);
  await c.ready;
  await expect(c.replyQuestion("q", [["C"]])).rejects.toThrow("offered");
  await expect(c.replyQuestion("q", [["A", "B"]])).rejects.toThrow("Choose");
  f.emit("question.replied", {
    sessionID: "s1",
    requestID: "q",
    answers: [["A"]],
  });
  await tick();
  expect(c.getSnapshot().questions).toHaveLength(0);
  await expect(c.replyQuestion("q", [["A"]])).rejects.toThrow("no longer");
});

test("interrupt failure retains requested and running, HTTP completion alone does not claim stopped", async () => {
  const { f, c } = start();
  await c.ready;
  f.active = { s1: { type: "running" } };
  f.emit("session.execution.started", { sessionID: "s1" });
  await tick();
  f.override = (url) =>
    url.pathname.endsWith("/interrupt") ? json({}, 503) : undefined;
  await expect(c.interrupt()).rejects.toThrow("503");
  expect(c.getSnapshot().interruptRequested).toBe(true);
  expect(c.getSnapshot().execution).toBe("running");
  f.override = undefined;
  await c.interrupt();
  expect(c.getSnapshot().execution).toBe("running");
  f.emit("session.execution.interrupted", { sessionID: "s1" });
  await tick();
  expect(c.getSnapshot().execution).toBe("idle");
  expect(c.getSnapshot().interruptRequested).toBe(false);
});

test("disconnect preserves unknown execution, reconnect hydrates and replaces state", async () => {
  const { f, c } = start();
  await c.ready;
  f.close();
  await tick();
  expect(c.getSnapshot().connection).toBe("disconnected");
  expect(c.getSnapshot().execution).toBe("unknown");
  f.histories.s1 = [user("after")];
  await c.reconnect();
  expect(c.getSnapshot().messages[0]!.id).toBe("after");
});

test("paged history includes assistant without parent and deduplicates boundaries", async () => {
  const f = fixture();
  f.override = (url) =>
    url.pathname.endsWith("/message")
      ? json(
          url.searchParams.has("cursor")
            ? {
                data: [user("new", undefined, 2), user("old", undefined, 1)],
                cursor: {},
              }
            : { data: [user("new", undefined, 2)], cursor: { next: "cursor" } },
        )
      : undefined;
  const { c } = start(f);
  await c.ready;
  expect(c.getSnapshot().hasOlder).toBe(true);
  await c.loadOlder();
  expect(c.getSnapshot().messages.map((m) => m.id)).toEqual(["old", "new"]);
});

test("disposal during prompt aborts local request, never endpoint or execution", async () => {
  const { f, c } = start();
  await c.ready;
  const wait = deferred<Response>();
  let signal: AbortSignal | undefined;
  f.override = (url, init) => {
    if (url.pathname.endsWith("/prompt")) {
      signal = init.signal!;
      return wait.promise;
    }
  };
  const send = c.send({ text: "hello" });
  await tick();
  c.dispose();
  expect(signal!.aborted).toBe(true);
  wait.resolve(new Response(null, { status: 204 }));
  await send;
  expect(f.calls.some((call) => call.url.pathname.endsWith("/interrupt"))).toBe(
    false,
  );
});

test("request answered during hydration cannot be resurrected by stale HTTP", async () => {
  const f = fixture();
  f.questions.push({ id: "q", sessionID: "s1", questions: [] });
  const { c } = start(f);
  await c.ready;
  const pending = deferred<Response>();
  f.override = (url) =>
    url.pathname.endsWith("/message") ? pending.promise : undefined;
  const loading = c.selectSession("s1");
  await tick();
  f.emit("question.replied", { sessionID: "s1", requestID: "q", answers: [] });
  await tick();
  pending.resolve(json({ data: [], cursor: {} }));
  await loading;
  expect(c.getSnapshot().questions).toHaveLength(0);
});

test("question multi/custom replies and reject use pinned native routes", async () => {
  const f = fixture();
  f.questions.push({
    id: "q",
    sessionID: "s1",
    questions: [
      {
        header: "Pick",
        question: "Which?",
        options: [{ label: "A", description: "a" }],
        multiple: true,
        custom: true,
      },
    ],
  });
  const { c } = start(f);
  await c.ready;
  await c.replyQuestion("q", [["A", "custom"]]);
  expect(f.calls.at(-1)!.url.pathname).toBe(
    "/proxy/api/session/s1/question/q/reply",
  );
  expect(JSON.parse(String(f.calls.at(-1)!.init.body))).toEqual({
    answers: [["A", "custom"]],
  });
  f.emit("question.asked", { id: "q2", sessionID: "s1", questions: [] });
  await tick();
  await c.rejectQuestion("q2");
  expect(f.calls.at(-1)!.url.pathname).toBe(
    "/proxy/api/session/s1/question/q2/reject",
  );
});

test("controllers remain isolated and disposing one leaves the other subscribed", async () => {
  const one = start(),
    two = start();
  await Promise.all([one.c.ready, two.c.ready]);
  one.c.dispose();
  two.f.emit("session.execution.started", { sessionID: "s1" });
  await tick();
  expect(two.c.getSnapshot().execution).toBe("running");
  expect(two.f.cancels).toBe(0);
});

test("missing assistant event triggers authoritative recovery", async () => {
  const { f, c } = start();
  await c.ready;
  f.histories.s1 = [
    {
      id: "missing",
      type: "assistant",
      agent: "build",
      model: { providerID: "p", id: "m" },
      content: [{ type: "text", text: "recovered" }],
      time: { created: 1 },
    },
  ];
  f.emit("session.text.delta", {
    sessionID: "s1",
    assistantMessageID: "missing",
    ordinal: 0,
    delta: "covered",
  });
  await new Promise((resolve) => setTimeout(resolve, 160));
  expect(c.getSnapshot().messages[0]!.id).toBe("missing");
  expect((c.getSnapshot().messages[0] as any).content[0].text).toBe(
    "recovered",
  );
});

test("accepted prompt followed by refresh failure is not reported as a failed send", async () => {
  const { f, c } = start();
  await c.ready;
  f.override = (url) =>
    url.pathname.endsWith("/message") ? json({}, 503) : undefined;
  await c.send({ text: "accepted" });
  expect(c.getSnapshot().error).toContain("Message accepted; refresh failed");
  expect(c.getSnapshot().execution).toBe("unknown");
  expect(
    f.calls.filter((call) => call.url.pathname.endsWith("/prompt")),
  ).toHaveLength(1);
});
