// OpenCode 2.x: the background service (~/.local/state/opencode/service.json on each host) serves
// an HTTP API behind basic auth as user "opencode", reached through `forward`. Its `/api/event` SSE
// stream says when sessions, permissions or forms change; each relevant event re-reads the list.
// Pending permissions and forms mean the agent needs input.
import { Effect, Schema, Stream } from "effect";
import { decodeJson, decodeValue, fail, type SourceError } from "./errors.ts";
import { forward, sh, type Machine } from "./machines.ts";
import { sessionKey, type Session, type Status } from "./session.ts";

// Missing CLI, an old (1.x, different API) CLI, no service file, or a service file whose pid is
// gone (stale) are all quiet "not here" states.
const CHECK = `
command -v opencode >/dev/null 2>&1 || { echo "@@missing"; exit 0; }
echo "@@version $(opencode --version 2>/dev/null | head -n 1)"
f="$HOME/.local/state/opencode/service.json"
[ -f "$f" ] || { echo "@@noservice"; exit 0; }
pid=$(sed -n 's/.*"pid": *\\([0-9]*\\).*/\\1/p' "$f")
if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then echo "@@alive"; else echo "@@dead $pid"; fi
cat "$f"`;

const ServiceFile = Schema.Struct({ url: Schema.String, password: Schema.String, pid: Schema.optionalKey(Schema.Number), version: Schema.optionalKey(Schema.String) });

const service = (m: Machine) =>
  Effect.gen(function* () {
    const out = (yield* sh(m, CHECK)).stdout;
    if (out.startsWith("@@missing")) return yield* fail("missing", "not installed");
    const [version, state, ...rest] = out.split("\n");
    const v = version?.match(/(\d+)\.\d+\.\d+/);
    if (v && Number(v[1]) < 2) return yield* fail("unsupported", `unsupported (opencode ${v[0]})`);
    if (state === "@@noservice") return yield* fail("stopped", "service not running");
    if (state?.startsWith("@@dead")) return yield* fail("stopped", `service not running (stale service.json, pid ${state.slice(7) || "?"})`);
    const s = yield* decodeJson(ServiceFile, "service.json")(rest.join("\n"));
    const url = new URL(s.url);
    return { url, auth: `Basic ${btoa(`opencode:${s.password}`)}` };
  });

const Info = Schema.Struct({
  id: Schema.String,
  parentID: Schema.optionalKey(Schema.NullOr(Schema.String)),
  title: Schema.optionalKey(Schema.String),
  model: Schema.optionalKey(Schema.NullOr(Schema.Struct({ id: Schema.String }))),
  outcome: Schema.optionalKey(Schema.NullOr(Schema.String)),
  time: Schema.Struct({ created: Schema.Number, updated: Schema.Number, archived: Schema.optionalKey(Schema.NullOr(Schema.Number)) }),
  location: Schema.optionalKey(Schema.NullOr(Schema.Struct({ directory: Schema.optionalKey(Schema.String) }))),
});
const data = <S extends Schema.Top & { readonly DecodingServices: never }>(s: S) => Schema.Struct({ data: s });
const Sessions = decodeValue(data(Schema.Array(Info)), "opencode /api/session");
const Active = decodeValue(data(Schema.Record(Schema.String, Schema.Unknown)), "opencode /api/session/active");
const Perms = decodeValue(data(Schema.Array(Schema.Struct({ action: Schema.optionalKey(Schema.String) }))), "opencode permission");
const Forms = decodeValue(data(Schema.Array(Schema.Struct({ title: Schema.optionalKey(Schema.String) }))), "opencode form");

type Api = { base: string; auth: string };

const get = (api: Api, path: string) =>
  Effect.tryPromise({
    try: async (signal) => {
      const r = await fetch(api.base + path, { headers: { authorization: api.auth }, signal });
      if (!r.ok) throw new Error(`${r.status}`);
      return (await r.json()) as unknown;
    },
    catch: (e) => fail("failed", `opencode ${path.split("?")[0]}: ${e instanceof Error ? e.message : String(e)}`),
  });

const list = (m: Machine, home: string, api: Api) =>
  Effect.gen(function* () {
    const [sessions, active] = yield* Effect.all([get(api, "/api/session?limit=100").pipe(Effect.flatMap(Sessions)), get(api, "/api/session/active").pipe(Effect.flatMap(Active))], {
      concurrency: 2,
    });
    // Only running sessions can be blocked on a permission or a form.
    const pending = new Map<string, string>();
    yield* Effect.forEach(
      Object.keys(active.data),
      (id) =>
        Effect.gen(function* () {
          const [perms, forms] = yield* Effect.all(
            [get(api, `/api/session/${id}/permission`).pipe(Effect.flatMap(Perms)), get(api, `/api/session/${id}/form`).pipe(Effect.flatMap(Forms))],
            { concurrency: 2 },
          );
          if (perms.data.length) pending.set(id, `permission: ${perms.data[0]!.action ?? "request"}`);
          else if (forms.data.length) pending.set(id, forms.data[0]!.title ?? "question");
        }),
      { concurrency: 4, discard: true },
    );
    return sessions.data
      .filter((s) => !s.parentID)
      .map((s): Session => {
        const status: Status =
          pending.has(s.id) ? "needs"
          : s.id in active.data ? "working"
          : s.outcome === "succeeded" ? "done"
          : s.outcome === "failed" ? "failed"
          : s.outcome === "interrupted" ? "interrupted"
          : "idle";
        const cwd = s.location?.directory ?? home;
        return {
          machine: m.id,
          harness: "opencode",
          key: sessionKey(m.id, "opencode", s.id),
          id: s.id,
          title: s.title || s.id,
          cwd,
          status,
          detail: pending.get(s.id) ?? "",
          model: s.model?.id ?? "",
          updatedAt: s.time.updated,
          archived: !!s.time.archived,
          open: { cmd: ["opencode", "-s", s.id], cwd },
        };
      });
  });

// Events that can change a row; streaming deltas, usage and tool chatter are ignored.
const RELEVANT = /^(session\.(created|deleted|updated|renamed|moved|idle|active|status|error|execution\.)|permission\.(asked|replied)|form\.)/;
const EventType = decodeJson(Schema.Struct({ type: Schema.String }), "opencode event");

/** Relevant event types; fails if the stream ends or goes silent (the server heartbeats). */
const events = (api: Api): Stream.Stream<string, SourceError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const r = yield* Effect.tryPromise({
        try: (signal) => fetch(api.base + "/api/event", { headers: { authorization: api.auth, accept: "text/event-stream" }, signal }),
        catch: (e) => fail("failed", `opencode /api/event: ${e instanceof Error ? e.message : String(e)}`),
      });
      if (!r.ok || !r.body) return yield* fail("failed", `opencode /api/event: ${r.status}`);
      const body = r.body;
      return Stream.fromReadableStream({ evaluate: () => body, onError: (e) => fail("failed", `opencode events: ${String(e)}`) });
    }),
  ).pipe(
    Stream.decodeText(),
    Stream.splitLines,
    Stream.timeoutOrElse({ duration: "60 seconds", orElse: () => Stream.fail(fail("failed", "opencode events: no heartbeat")) }),
    Stream.concat(Stream.fail(fail("failed", "opencode events: stream ended"))),
    Stream.filter((l) => l.startsWith("data:")),
    Stream.mapEffect((l) => EventType(l.slice(5)).pipe(Effect.map((e) => e.type), Effect.orElseSucceed(() => ""))),
    Stream.filter((t) => RELEVANT.test(t)),
  );

/** The machine's OpenCode sessions: the full list on start, on each relevant event, and every 60 s. */
export const opencodeSessions = (m: Machine, home: string): Stream.Stream<ReadonlyArray<Session>, SourceError> =>
  Stream.unwrap(
    Effect.gen(function* () {
      const s = yield* service(m);
      const local = yield* forward(m, { tcp: { host: s.url.hostname, port: Number(s.url.port || 80) } });
      const api = { base: `${s.url.protocol}//${local}`, auth: s.auth };
      return Stream.merge(Stream.tick("60 seconds"), events(api)).pipe(
        // Events arriving while a list is in flight collapse into one more list.
        Stream.buffer({ capacity: 1, strategy: "sliding" }),
        Stream.mapEffect(() => list(m, home, api)),
      );
    }),
  );

export const launchOpencode = (dir: string) => Effect.succeed({ cmd: ["opencode", dir], cwd: dir, claim: { firstNewIn: dir } });

