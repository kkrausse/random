// Codex: the shared app-server daemon owns every TUI's threads, so its thread/list status is live.
// Its control socket is forwarded per host; thread notifications (status, start, archive, rename)
// trigger a re-list.
import { Cause, Effect, Queue, Schema, Stream } from "effect";
import { CodexRpc } from "./codex-rpc.ts";
import { decodeValue, fail, type SourceError } from "./errors.ts";
import { forward, sh, type Machine } from "./machines.ts";
import { sessionKey, type Session, type Status } from "./session.ts";

const CHECK = `
command -v codex >/dev/null 2>&1 || { echo "@@missing"; exit 0; }
s="$HOME/.codex/app-server-control/app-server-control.sock"
if [ -S "$s" ]; then echo "@@sock $s"; else echo "@@nosock"; fi`;

const Thread = Schema.Struct({
  id: Schema.String,
  parentThreadId: Schema.NullOr(Schema.String),
  name: Schema.NullOr(Schema.String),
  preview: Schema.String,
  model: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  updatedAt: Schema.Number,
  status: Schema.Struct({ type: Schema.String, activeFlags: Schema.optionalKey(Schema.Array(Schema.String)) }),
});
const decodeList = decodeValue(Schema.Struct({ data: Schema.Array(Thread) }), "codex thread/list");

const RELEVANT = new Set(["thread/started", "thread/status/changed", "thread/archived", "thread/unarchived", "thread/deleted", "thread/closed", "thread/name/updated"]);

const request = (c: CodexRpc, method: string, params: unknown) =>
  Effect.tryPromise({ try: () => c.request(method, params), catch: (e) => fail("failed", `codex ${method}: ${e instanceof Error ? e.message : String(e)}`) });

const list = (m: Machine, c: CodexRpc) =>
  Effect.gen(function* () {
    const page = (archived: boolean) =>
      request(c, "thread/list", { limit: archived ? 50 : 100, sortKey: "updated_at", useStateDbOnly: true, archived }).pipe(Effect.flatMap(decodeList));
    const [live, archived] = yield* Effect.all([page(false), page(true)], { concurrency: 2 });
    const done = new Set(live.data.map((t) => t.id));
    return [...live.data, ...archived.data.filter((t) => !done.has(t.id))]
      .filter((t) => !t.parentThreadId)
      .map((t): Session => {
        const flags = t.status.type === "active" ? (t.status.activeFlags ?? []) : [];
        const status: Status =
          flags.length ? "needs"
          : t.status.type === "active" ? "working"
          : t.status.type === "systemError" ? "failed"
          : t.preview ? "done"
          : "idle";
        return {
          machine: m.id,
          harness: "codex",
          key: sessionKey(m.id, "codex", t.id),
          id: t.id,
          title: t.name || t.preview.split("\n")[0] || t.id,
          cwd: t.cwd,
          status,
          detail: flags.includes("waitingOnApproval") ? "approval" : flags.includes("waitingOnUserInput") ? "input" : "",
          model: t.model ?? "",
          updatedAt: t.updatedAt * 1000,
          archived: !done.has(t.id),
          open: { cmd: ["codex", "resume", t.id], cwd: t.cwd },
        };
      });
  });

/** The machine's Codex threads: the full list on connect, on each thread notification, and every 60 s. */
export const codexSessions = (m: Machine): Stream.Stream<ReadonlyArray<Session>, SourceError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const out = (yield* sh(m, CHECK)).stdout.trim();
      if (out === "@@missing") return yield* fail("missing", "not installed");
      if (!out.startsWith("@@sock ")) return yield* fail("stopped", "app-server not running");
      const path = yield* forward(m, { unix: out.slice(7) });
      const rpc = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            const c = new CodexRpc();
            await c.connect(path);
            return c;
          },
          catch: (e) => fail("failed", `codex connect: ${e instanceof Error ? e.message : String(e)}`),
        }),
        (c) => Effect.sync(() => c.close()),
      );
      const notifications = Stream.callback<void, SourceError>((q) =>
        Effect.sync(() => {
          rpc.onNotification = (method) => void (RELEVANT.has(method) && Queue.offerUnsafe(q, undefined));
          rpc.onClose = () => void Queue.failCauseUnsafe(q, Cause.fail(fail("failed", "codex socket closed")));
        }),
      );
      return Stream.merge(Stream.tick("60 seconds"), notifications).pipe(
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.mapEffect(() => list(m, rpc)),
      );
    }),
  );

export const launchCodex = (dir: string) => Effect.succeed({ cmd: ["codex", "-C", dir], cwd: dir, claim: { firstNewIn: dir } });
