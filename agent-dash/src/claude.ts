// Claude Code has no subscribe API, so each host runs ONE long-lived POSIX sh loop over the shared
// connection that prints a framed record every 2 s: the host's archive marks, `claude agents --json
// --all`, and the state.json of each listed background job (detail line, pending question). Job
// files are re-sent only when their mtime changes. The same loop runs locally, so local and remote
// are one code path. A host with no claude still runs the loop for its archive marks.
import { Effect, Schema, Stream } from "effect";
import { decodeJson, fail, firstLine, type SourceError } from "./errors.ts";
import { exec, lines, type Machine } from "./machines.ts";
import { ARCHIVE_FILE } from "./archive.ts";
import { sessionKey, type Session, type Status } from "./session.ts";

const TICK_S = 2;

const LOOP = `
J="$HOME/.claude/jobs"; seen=""
while :; do
  echo "@@archive"; cat "${ARCHIVE_FILE}" 2>/dev/null; echo
  if command -v claude >/dev/null 2>&1; then
    out=$(claude agents --json --all 2>&1); echo "@@claude $?"; printf '%s\\n' "$out"
    next=""
    for id in $(printf '%s\\n' "$out" | sed -n 's/^ *"id": *"\\([A-Za-z0-9_-]*\\)".*/\\1/p'); do
      f="$J/$id/state.json"; [ -f "$f" ] || continue
      t=$(stat -c %Y "$f" 2>/dev/null || stat -f %m "$f")
      next="$next $id:$t"
      case " $seen " in *" $id:$t "*) echo "@@job $id $t same" ;; *) echo "@@job $id $t"; cat "$f"; echo ;; esac
    done
    seen=$next
  else echo "@@claude missing"; fi
  echo "@@end"
  sleep ${TICK_S}
done`;

/** One tick of a host's loop. Job texts carry over from earlier records when unchanged. */
export type HostRecord = {
  archive: string;
  claude: { missing: true } | { missing: false; code: number; out: string; jobs: ReadonlyMap<string, { mtime: number; text: string }> };
};

type Job = { mtime: number; text: string };
type Draft = { archive: string[]; head?: string; out: string[]; jobs: Map<string, { mtime: number; text: string[] | string }> };
type Acc = { cur?: Draft; section?: "archive" | "claude" | { job: string }; prevJobs: Map<string, Job> };

function step(acc: Acc, line: string): readonly [Acc, HostRecord[]] {
  if (!line.startsWith("@@")) {
    const c = acc.cur, s = acc.section;
    if (!c || !s) return [acc, []];
    if (s === "archive") c.archive.push(line);
    else if (s === "claude") c.out.push(line);
    else (c.jobs.get(s.job)!.text as string[]).push(line);
    return [acc, []];
  }
  const [tag, a, b, same] = line.split(" ");
  const c: Draft = (acc.cur ??= { archive: [], out: [], jobs: new Map() });
  if (tag === "@@archive") acc.section = "archive";
  else if (tag === "@@claude") (c.head = a), (acc.section = "claude");
  else if (tag === "@@job" && a) {
    const prev = acc.prevJobs.get(a);
    c.jobs.set(a, { mtime: Number(b) * 1000, text: same && prev ? prev.text : [] });
    acc.section = same ? undefined : { job: a };
  } else if (tag === "@@end") {
    const jobs = new Map([...c.jobs].map(([id, j]) => [id, { mtime: j.mtime, text: typeof j.text === "string" ? j.text : j.text.join("\n") }]));
    const rec: HostRecord = {
      archive: c.archive.join("\n"),
      claude: c.head === "missing" || c.head === undefined ? { missing: true } : { missing: false, code: Number(c.head), out: c.out.join("\n"), jobs },
    };
    return [{ prevJobs: jobs }, [rec]];
  }
  return [acc, []];
}

/**
 * The host's records. Every tick emits, so silence means a stuck loop: after ~3 missed ticks the
 * stream fails and the caller's retry restarts the command.
 */
export const hostFeed = (m: Machine): Stream.Stream<HostRecord, SourceError> =>
  lines(m, ["sh", "-c", LOOP]).pipe(
    Stream.mapAccum(() => ({ prevJobs: new Map() }) as Acc, step),
    Stream.timeoutOrElse({ duration: `${TICK_S * 3 + 3} seconds`, orElse: () => Stream.fail(fail("failed", `${m.id}: claude loop stalled`)) }),
  );

const Entry = Schema.Struct({
  pid: Schema.optionalKey(Schema.Number),
  id: Schema.optionalKey(Schema.String),
  sessionId: Schema.String,
  kind: Schema.String,
  cwd: Schema.String,
  name: Schema.optionalKey(Schema.String),
  startedAt: Schema.optionalKey(Schema.Number),
  status: Schema.optionalKey(Schema.String),
  waitingFor: Schema.optionalKey(Schema.String),
  state: Schema.optionalKey(Schema.String),
});
const decodeEntries = decodeJson(Schema.Array(Entry), "claude agents --json");

const JobState = Schema.Struct({ detail: Schema.optionalKey(Schema.NullOr(Schema.String)), needs: Schema.optionalKey(Schema.NullOr(Schema.String)) });
const decodeJob = decodeJson(JobState, "state.json");

// Paseo runs Claude headless (stream-json, no TTY); its sessions are only answerable from paseotui.
// Uses local ps, so it is only checked on the local machine.
function underPaseo(pid: number | undefined): boolean {
  if (!pid) return false;
  const ppid = Bun.spawnSync(["ps", "-o", "ppid=", "-p", String(pid)]).stdout.toString().trim();
  return !!ppid && Bun.spawnSync(["ps", "-o", "comm=", "-p", ppid]).stdout.toString().includes("Paseo");
}

/** Sessions from one record; `missing` when the host has no claude. */
export const claudeSessions = (m: Machine, rec: HostRecord): Effect.Effect<Session[], SourceError> =>
  Effect.gen(function* () {
    const c = rec.claude;
    if (c.missing) return yield* fail("missing", "not installed");
    // Older Claude Code (before background agents) has no `agents --json`.
    if (c.code !== 0 && /unknown option '--json'/.test(c.out)) return yield* fail("unsupported", "claude too old for agents --json");
    if (c.code !== 0) return yield* fail("failed", `claude agents: ${firstLine(c.out) || `exit ${c.code}`}`);
    const entries = yield* decodeEntries(c.out);
    return yield* Effect.forEach(entries, (e) =>
      Effect.gen(function* () {
        const raw = e.id ? c.jobs.get(e.id) : undefined;
        // A half-written state.json only costs this tick's detail line.
        const job = raw ? yield* decodeJob(raw.text).pipe(Effect.orElseSucceed(() => ({}) as typeof JobState.Type)) : undefined;
        // A fresh `claude --bg` session reports "blocked" until its first prompt.
        const unprompted = /send a prompt to start/.test(job?.needs ?? "");
        const status: Status =
          unprompted ? "idle"
          : e.status === "waiting" || e.state === "blocked" ? "needs"
          : e.status === "busy" || e.state === "working" ? "working"
          : e.state === "done" ? "done"
          : e.state === "failed" ? "failed"
          : e.state === "interrupted" || e.state === "stopped" || e.state === "killed" ? "interrupted"
          : "idle";
        const detail =
          status === "needs" ? (job?.needs ?? e.waitingFor ?? "waiting")
          : status === "working" || status === "failed" ? (job?.detail ?? "")
          : "";
        const bg = e.kind === "background" && e.id;
        const paseo = !bg && !m.ssh && underPaseo(e.pid);
        const id = e.id ?? e.sessionId;
        return {
          machine: m.id,
          harness: "claude",
          key: sessionKey(m.id, "claude", id),
          id,
          title: (e.name ?? e.sessionId.slice(0, 8)) + (paseo ? " (paseo)" : ""),
          cwd: e.cwd,
          status,
          detail,
          model: "",
          updatedAt: raw?.mtime ?? e.startedAt ?? 0,
          archived: false,
          // A finished background session keeps its process, and with it any /loop or wakeup that can
          // start it again. Interactive sessions belong to their terminal.
          stoppable: !!bg && e.state !== "stopped" && e.state !== "killed",
          // An interactive session is owned by the terminal it runs in; a second client would fork it.
          open: bg ? { cmd: ["claude", "attach", e.id!], cwd: e.cwd } : paseo ? { cmd: ["paseotui"], cwd: e.cwd } : undefined,
          closedReason: bg || paseo ? undefined : "interactive session · open it in its own terminal",
        } satisfies Session;
      }),
    );
  });

/** An idle background session ("send a prompt to start"), so it stays attachable. */
export const launchClaude = (m: Machine, dir: string) =>
  Effect.gen(function* () {
    const out = yield* exec(m, ["claude", "--bg"], { cwd: dir, timeout: 60_000 }).pipe(Effect.map((o) => o.stdout + o.stderr));
    const id = out.replace(/\x1b\[[0-9;]*m/g, "").match(/backgrounded · (\w+)/)?.[1];
    if (!id) return yield* fail("failed", firstLine(out) || "claude --bg printed no id");
    return { cmd: ["claude", "attach", id], cwd: dir, claim: { id } };
  });


/** Ends the background session's process (and its pending wakeups); `claude attach` resumes it. */
export const stopClaude = (m: Machine, id: string) =>
  Effect.gen(function* () {
    const out = yield* exec(m, ["claude", "stop", id]);
    // Already exited: nothing left to stop.
    if (out.code !== 0 && !/No job matching/.test(out.stdout + out.stderr)) return yield* fail("failed", `claude stop: ${firstLine(out.stderr || out.stdout) || `exit ${out.code}`}`);
  });
