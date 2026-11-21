import type { Harness, Session, Status } from "./types.ts";

export function age(ms: number, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

export function tokens(n: number) {
  if (n < 1000) return String(n);
  if (n < 100_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${Math.round(n / 1000)}k`;
}

export const HARNESS_LABEL: Record<Harness, string> = {
  claude: "Claude",
  opencode: "OpenCode",
  "opencode-mini": "OC Mini",
  codex: "Codex",
};

export const STATUS_LABEL: Record<Status, string> = {
  needs: "Needs input",
  working: "Working",
  done: "Done",
  failed: "Failed",
  interrupted: "Interrupted",
  idle: "Idle",
};

/** Tailwind text color per status. */
export const STATUS_COLOR: Record<Status, string> = {
  needs: "text-amber-400",
  working: "text-sky-400",
  done: "text-emerald-400",
  failed: "text-red-400",
  interrupted: "text-neutral-400",
  idle: "text-neutral-500",
};

export type Group = "needs" | "working" | "finished" | "archived";

export function groupOf(s: Session): Group {
  if (s.archived) return "archived";
  if (s.status === "needs") return "needs";
  if (s.status === "working") return "working";
  return "finished";
}

/** faplex send and tail work for these. */
export const canSend = (s: Session) => s.harness !== "codex";

/** "/home/me/devfs/repos/x" → "~/devfs/repos/x" style, shortened to the last two parts. */
export function shortDir(dir: string) {
  const parts = dir.replace(/^\/(home|Users)\/[^/]+/, "~").split("/").filter(Boolean);
  return parts.length <= 2 ? parts.join("/") || "/" : `…/${parts.slice(-2).join("/")}`;
}
