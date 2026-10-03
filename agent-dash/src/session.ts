export type Harness = "claude" | "opencode" | "codex";
export const HARNESSES: readonly Harness[] = ["claude", "opencode", "codex"];

/** done/failed/interrupted are finished runs; idle was never prompted (or has no outcome yet). */
export type Status = "needs" | "working" | "done" | "failed" | "interrupted" | "idle";

export type Session = {
  machine: string;
  harness: Harness;
  /** `machine/harness:id` */
  key: string;
  id: string;
  title: string;
  cwd: string;
  /** Native CLI command that takes over the terminal, machine-agnostic; absent when the session can't be opened here. */
  open?: { cmd: string[]; cwd: string };
  /** Why `open` is absent. */
  closedReason?: string;
  status: Status;
  detail: string;
  updatedAt: number;
  model: string;
  /** Archived in the harness itself. */
  archived: boolean;
  /** Something is still running that `stop` would end (a turn, or a Claude process that can wake itself). */
  stoppable: boolean;
};

export const sessionKey = (machine: string, harness: Harness, id: string) => `${machine}/${harness}:${id}`;

/** How to recognize a new session once its source reports it. */
export type Claim = { id: string } | { firstNewIn: string };
