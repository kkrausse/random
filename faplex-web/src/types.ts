// The shapes faplex watch --json reports (faplex src/session.ts, src/watch.ts), as sent to the browser.
export type Harness = "claude" | "opencode" | "opencode-mini" | "codex";
export type Status = "needs" | "working" | "done" | "failed" | "interrupted" | "idle";

export type Session = {
  machine: string;
  harness: Harness;
  key: string;
  id: string;
  title: string;
  cwd: string;
  closedReason?: string;
  status: Status;
  prompted?: boolean;
  subagents?: { total: number; active: number; complete: boolean };
  background?: { kind: "agent" | "shell"; count: number; label: string };
  context?: { usedTokens: number; limitTokens?: number; measuredAt: number };
  detail: string;
  updatedAt: number;
  model: string;
  archived: boolean;
  stoppable: boolean;
  tags: string[];
  /** faplex listed a command to open it. */
  openable: boolean;
};

export type Machine = { id: string; short: string; color: string; remote: boolean; dir: string };
export type Source = { machine: string; harness: Harness; loaded: boolean; problem: { kind: string; message: string } | null };

export type WatchState = {
  machines: Machine[];
  harnesses: Harness[];
  lastPick: { machine: string; harness: Harness } | null;
  sources: Source[];
  sessions: Session[];
  /** Archived sessions in all; only the most recent are in `sessions`. */
  archivedTotal: number;
};

export type TailMessage = { role: "user" | "agent"; at: string; text: string };
