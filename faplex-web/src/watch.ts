// One long-running `faplex watch --json`. Its latest line, slimmed for the browser, goes out to
// every list screen; its socket is where sessions are opened. Restarted if it exits.
import type { Session, WatchState } from "./types.ts";

type Raw = Omit<WatchState, "sessions"> & { socket: string; sessions: (Session & { open?: unknown })[] };

/** Archived sessions sent to the browser: the most recent ones are enough to scroll back through. */
const ARCHIVED_SENT = 80;

export function createWatch(bin: string, cwd: string, publish: (line: string) => void) {
  let proc: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined;
  let raw: Raw | undefined;
  let last: string | undefined;
  let stopped = false;
  let restarts = 0;
  const sessions = new Map<string, Session>();

  const start = () => {
    const p = Bun.spawn([bin, "watch", "--json"], { cwd, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    proc = p;
    void (async () => {
      const decoder = new TextDecoder();
      let pending = "";
      for await (const chunk of p.stdout) {
        pending += decoder.decode(chunk, { stream: true });
        let nl: number;
        while ((nl = pending.indexOf("\n")) !== -1) {
          const line = pending.slice(0, nl);
          pending = pending.slice(nl + 1);
          try {
            receive(JSON.parse(line));
            restarts = 0;
          } catch (e) {
            console.error("faplex watch: unreadable line", e);
          }
        }
      }
    })();
    void (async () => {
      for await (const chunk of p.stderr) process.stderr.write(chunk);
    })();
    void p.exited.then((code) => {
      if (stopped) return;
      raw = undefined;
      const delay = Math.min(30_000, 1000 * 2 ** restarts++);
      console.error(`faplex watch exited ${code}; restarting in ${delay} ms`);
      emit(JSON.stringify({ error: `faplex watch exited ${code}; restarting` }));
      setTimeout(start, delay);
    });
  };

  function receive(next: Raw) {
    raw = next;
    sessions.clear();
    for (const s of next.sessions) sessions.set(s.key, s);
    const live = next.sessions.filter((s) => !s.archived);
    const archived = next.sessions.filter((s) => s.archived).sort((a, b) => b.updatedAt - a.updatedAt);
    const slim: WatchState = {
      machines: next.machines,
      harnesses: next.harnesses,
      lastPick: next.lastPick,
      sources: next.sources,
      sessions: [...live, ...archived.slice(0, ARCHIVED_SENT)].map(({ open, ...s }) => ({ ...s, openable: !!open })),
      archivedTotal: archived.length,
    };
    emit(JSON.stringify(slim));
  }

  function emit(line: string) {
    if (line === last) return;
    last = line;
    publish(line);
  }

  start();
  return {
    last: () => last,
    socket: () => raw?.socket,
    session: (key: string) => sessions.get(key),
    write(msg: unknown) {
      if (!proc) return;
      proc.stdin.write(JSON.stringify(msg) + "\n");
      proc.stdin.flush();
    },
    stop() {
      stopped = true;
      proc?.stdin.end();
      proc?.kill();
    },
  };
}
