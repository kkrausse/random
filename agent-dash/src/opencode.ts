// OpenCode: the background service (~/.local/state/opencode/service.json) serves an HTTP API
// behind basic auth as user "opencode". Pending permissions and forms mean the agent needs input.
import { homedir } from "node:os";
import { readFileSync } from "node:fs";
import type { Session, Status } from "./session.ts";

type Info = {
  id: string;
  parentID?: string;
  title: string;
  model?: { id: string };
  outcome?: "succeeded" | "failed" | "interrupted";
  time: { created: number; updated: number; archived?: number };
  location?: { directory?: string };
};

export function service(): { url: string; auth: string } {
  const s = JSON.parse(readFileSync(`${homedir()}/.local/state/opencode/service.json`, "utf8"));
  return { url: s.url, auth: `Basic ${btoa(`opencode:${s.password}`)}` };
}

export async function listOpencode(): Promise<Session[]> {
  const { url, auth } = service();
  const get = async (path: string) => {
    const r = await fetch(url + path, { headers: { authorization: auth } });
    if (!r.ok) throw new Error(`opencode ${path}: ${r.status}`);
    return (await r.json()).data;
  };
  const [sessions, active]: [Info[], Record<string, unknown>] = await Promise.all([get("/api/session?limit=100"), get("/api/session/active")]);
  // Only running sessions can be blocked on a permission or a form.
  const pending = new Map<string, string>();
  await Promise.all(
    Object.keys(active).map(async (id) => {
      const [perms, forms] = await Promise.all([get(`/api/session/${id}/permission`), get(`/api/session/${id}/form`)]);
      if (perms.length) pending.set(id, `permission: ${perms[0].action ?? "request"}`);
      else if (forms.length) pending.set(id, forms[0].title ?? "question");
    }),
  );
  return sessions
    .filter((s) => !s.parentID)
    .map((s) => {
      const status: Status =
        pending.has(s.id) ? "needs" : s.id in active ? "working" : s.outcome === "failed" ? "error" : "idle";
      const cwd = s.location?.directory ?? homedir();
      return {
        provider: "opencode",
        key: `opencode:${s.id}`,
        id: s.id,
        title: s.title || s.id,
        cwd,
        status,
        detail: pending.get(s.id) ?? (s.outcome === "interrupted" ? "interrupted" : s.outcome === "failed" ? "failed" : ""),
        model: s.model?.id ?? "",
        updatedAt: s.time.updated,
        archived: !!s.time.archived,
        open: { cmd: ["opencode", "-s", s.id], cwd },
      };
    });
}
