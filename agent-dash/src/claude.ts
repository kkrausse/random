// Claude Code: `claude agents --json --all` lists interactive and background sessions. Background
// jobs also keep ~/.claude/jobs/<id>/state.json with the live detail line and the pending question.
import { homedir } from "node:os";
import { statSync, readFileSync } from "node:fs";
import type { Session, Status } from "./session.ts";

type Entry = {
  id?: string;
  sessionId: string;
  kind: "background" | "interactive";
  cwd: string;
  name?: string;
  startedAt?: number;
  status?: "busy" | "idle" | "waiting";
  waitingFor?: string;
  state?: string;
};

const JOBS = `${homedir()}/.claude/jobs`;

function jobState(id: string): { mtime: number; detail?: string; needs?: string } | undefined {
  try {
    const path = `${JOBS}/${id}/state.json`;
    const j = JSON.parse(readFileSync(path, "utf8"));
    return { mtime: statSync(path).mtimeMs, detail: j.detail, needs: j.needs };
  } catch {
    return undefined;
  }
}

export async function listClaude(): Promise<Session[]> {
  const p = Bun.spawn(["claude", "agents", "--json", "--all"], { stdout: "pipe", stderr: "pipe" });
  const out = await new Response(p.stdout).text();
  if ((await p.exited) !== 0) throw new Error(`claude agents: ${(await new Response(p.stderr).text()).trim()}`);
  const entries: Entry[] = JSON.parse(out);
  return entries.map((e) => {
    const job = e.id ? jobState(e.id) : undefined;
    const status: Status =
      e.status === "waiting" || e.state === "blocked" ? "needs"
      : e.status === "busy" || e.state === "working" ? "working"
      : e.state === "failed" ? "error"
      : "idle";
    const detail =
      status === "needs" ? (job?.needs ?? e.waitingFor ?? "waiting")
      : status === "working" ? (job?.detail ?? "")
      : e.state === "done" ? "done"
      : "";
    const bg = e.kind === "background" && e.id;
    return {
      provider: "claude",
      key: `claude:${e.sessionId}`,
      id: e.id ?? e.sessionId,
      title: e.name ?? e.sessionId.slice(0, 8),
      cwd: e.cwd,
      status,
      detail,
      model: "",
      updatedAt: job?.mtime ?? e.startedAt ?? 0,
      archived: false,
      // An interactive session is owned by the terminal it runs in; a second client would fork it.
      open: bg ? { cmd: ["claude", "attach", e.id!], cwd: e.cwd } : undefined,
      closedReason: bg ? undefined : "interactive session · open it in its own terminal",
    };
  });
}
