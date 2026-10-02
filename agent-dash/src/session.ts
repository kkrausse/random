export type Provider = "claude" | "opencode" | "codex";
export type Status = "needs" | "working" | "idle" | "error";

export type Session = {
  provider: Provider;
  key: string;
  id: string;
  title: string;
  cwd: string;
  status: Status;
  detail: string;
  model: string;
  updatedAt: number;
  archived: boolean;
  /** Native CLI command that takes over the terminal; absent when the session can't be opened here. */
  open?: { cmd: string[]; cwd: string };
  /** Why `open` is absent. */
  closedReason?: string;
};
