// Codex: the shared app-server daemon owns every TUI's threads, so its thread/list status is live.
import { CodexRpc } from "./codex-rpc.ts";
import type { Session, Status } from "./session.ts";

type Thread = {
  id: string;
  parentThreadId: string | null;
  name: string | null;
  preview: string;
  model: string | null;
  cwd: string;
  updatedAt: number;
  status: { type: "notLoaded" | "idle" | "systemError" } | { type: "active"; activeFlags: ("waitingOnApproval" | "waitingOnUserInput")[] };
};

let rpc: CodexRpc | undefined;

export async function codexClient(): Promise<CodexRpc> {
  if (rpc) return rpc;
  const c = new CodexRpc();
  c.onClose = () => {
    if (rpc === c) rpc = undefined;
  };
  await c.connect();
  return (rpc = c);
}

export async function listCodex(): Promise<Session[]> {
  const c = await codexClient();
  const res = await c.request<{ data: Thread[] }>("thread/list", { limit: 100, sortKey: "updated_at", useStateDbOnly: true });
  return res.data
    .filter((t) => !t.parentThreadId)
    .map((t) => {
      const flags = t.status.type === "active" ? t.status.activeFlags : [];
      const status: Status =
        flags.length ? "needs" : t.status.type === "active" ? "working" : t.status.type === "systemError" ? "error" : "idle";
      return {
        provider: "codex",
        key: `codex:${t.id}`,
        id: t.id,
        title: t.name || t.preview.split("\n")[0] || t.id,
        cwd: t.cwd,
        status,
        detail: flags.includes("waitingOnApproval") ? "approval" : flags.includes("waitingOnUserInput") ? "input" : "",
        model: t.model ?? "",
        updatedAt: t.updatedAt * 1000,
        archived: false,
        open: { cmd: ["codex", "resume", t.id], cwd: t.cwd },
      };
    });
}

export const closeCodex = () => rpc?.close();
