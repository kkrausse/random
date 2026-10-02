import { homedir } from "node:os";

export function relTime(ms: number, now = Date.now()): string {
  if (!ms) return "";
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 45) return "now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

const HOME = homedir();
export function shortPath(p: string | null | undefined, base?: string): string {
  if (!p) return "";
  if (base && p.startsWith(base + "/")) return p.slice(base.length + 1);
  const t = p.startsWith(HOME) ? `~${p.slice(HOME.length)}` : p;
  const parts = t.split("/");
  return parts.length > 4 ? `…/${parts.slice(-3).join("/")}` : t;
}
