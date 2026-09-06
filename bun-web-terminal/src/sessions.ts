import { basename } from "node:path";
import { OutputFlow } from "./output-flow";

const titleFormat = "#{?#{||:#{==:#{pane_title},#{host}},#{==:#{pane_title},#{host_short}}},#{pane_current_command},#{pane_title}}";

export type Session = {
  id: string;
  name: string;
  title: string;
  status: "running" | "exited";
  createdAt: Date;
  exitCode: number | null;
  attachment?: Attachment;
};

export type Peer = { send(data: string | Uint8Array): unknown; close(code: number, reason: string): void };
export type Attachment = {
  input(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  acknowledge(bytes: number): boolean;
  close(code?: number, reason?: string): void;
};

export function dimensions(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  return { cols: Math.max(2, Math.min(500, cols as number)), rows: Math.max(2, Math.min(300, rows as number)) };
}

// An isolated tmux server avoids modifying the user's normal tmux configuration.
export class SessionManager {
  readonly sessions = new Map<string, Session>();
  private readonly socket = `bun-web-terminal-${process.pid}-${crypto.randomUUID()}`;
  private readonly env = { ...process.env, TMUX: undefined, TERM: "xterm-256color", COLORTERM: "truecolor" };
  private poll: ReturnType<typeof setInterval>;

  constructor(private cwd: string) {
    const check = Bun.spawnSync(["tmux", "-V"], { stderr: "pipe" });
    if (check.exitCode !== 0) throw new Error("tmux is required (macOS: brew install tmux).");
    this.poll = setInterval(() => this.refresh(), 2000);
    this.poll.unref();
  }

  private command(args: string[]) {
    return Bun.spawnSync(["tmux", "-L", this.socket, "-f", "/dev/null", ...args], { env: this.env, stdout: "pipe", stderr: "pipe" });
  }

  create() {
    const id = crypto.randomUUID();
    const shell = process.env.SHELL ?? "/bin/zsh";
    const result = this.command([
      "start-server",
      ";", "set-option", "-g", "default-terminal", "tmux-256color",
      ";", "set-option", "-g", "history-limit", "10000",
      ...(this.sessions.size === 0 ? [";", "set-option", "-as", "terminal-features", ",xterm-256color:RGB"] : []),
      ";",
      "new-session", "-d", "-s", id, "-c", this.cwd, "-x", "100", "-y", "30", "--", shell, "-l",
      ";", "set-option", "-t", id, "status", "off",
      ";", "set-option", "-t", id, "prefix", "None",
      ";", "set-option", "-t", id, "prefix2", "None",
      ";", "set-option", "-t", id, "remain-on-exit", "on",
      ";", "set-option", "-t", id, "window-size", "latest",
      ";", "set-option", "-t", id, "mouse", "on",
      ";", "set-option", "-t", id, "set-titles", "on",
      ";", "set-option", "-t", id, "set-titles-string", titleFormat,
      ";", "set-option", "-s", "escape-time", "0",
      ...["copy-mode", "copy-mode-vi"].flatMap(table => [
        ";", "bind-key", "-T", table, "WheelUpPane", "send-keys", "-X", "-N", "1", "scroll-up",
        ";", "bind-key", "-T", table, "WheelDownPane", "send-keys", "-X", "-N", "1", "scroll-down",
        ";", "bind-key", "-T", table, "Escape", "send-keys", "-X", "cancel",
      ]),
    ]);
    if (result.exitCode !== 0) throw new Error(`Could not create terminal: ${result.stderr.toString().trim()}`);
    const session: Session = { id, name: `${basename(shell)} ${this.sessions.size + 1}`, title: "", status: "running", createdAt: new Date(), exitCode: null };
    this.sessions.set(id, session);
    return session;
  }

  attach(session: Session, peer: Peer, cols: number, rows: number): Attachment {
    session.attachment?.close(4002, "Session opened in another tab");
    let closed = false;
    let child: Bun.Subprocess | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let mouseTimer: ReturnType<typeof setTimeout> | undefined;
    let mouseTracking: boolean | undefined;
    // tmux's outer mouse mode is always on for scrolling. Read the pane's
    // application modes separately; serialize queries so slow tmux cannot pile up.
    const reportMouseMode = async () => {
      try {
        const query = Bun.spawn(["tmux", "-L", this.socket, "display-message", "-p", "-t", session.id,
          "#{pane_in_mode}|#{mouse_any_flag}|#{mouse_all_flag}|#{mouse_button_flag}|#{mouse_standard_flag}"],
        { env: this.env, stdout: "pipe", stderr: "ignore" });
        const [output, code] = await Promise.all([new Response(query.stdout).text(), query.exited]);
        if (closed || code !== 0) return;
        const [inMode, ...flags] = output.trim().split("|");
        if (flags.length !== 4 || ![inMode, ...flags].every(flag => flag === "0" || flag === "1")) return;
        const tracking = inMode === "0" && flags.includes("1");
        if (tracking !== mouseTracking) {
          mouseTracking = tracking;
          peer.send(JSON.stringify({ type: "mouse-mode", tracking }));
        }
      } catch {
        // Keep the last known mode if tmux is temporarily unavailable.
      } finally {
        if (!closed) mouseTimer = setTimeout(() => { void reportMouseMode(); }, 150);
      }
    };
    let size = { cols, rows };
    let pendingSize = size;
    const flow = new OutputFlow((data) => peer.send(data), () => attachment.close(1013, "Terminal output stalled; reconnecting"));
    const attachment: Attachment = {
      input(data) { if (!closed) child?.terminal?.write(data); },
      resize(nextCols, nextRows) {
        pendingSize = { cols: nextCols, rows: nextRows };
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (closed || (size.cols === pendingSize.cols && size.rows === pendingSize.rows)) return;
          size = pendingSize;
          child?.terminal?.resize(size.cols, size.rows);
        }, 100);
      },
      acknowledge(bytes) { return flow.acknowledge(bytes); },
      close(code = 1000, reason = "Attachment closed") {
        if (closed) return;
        closed = true;
        clearTimeout(resizeTimer);
        flow.dispose();
        clearTimeout(mouseTimer);
        if (session.attachment === attachment) session.attachment = undefined;
        child?.kill();
        child?.terminal?.close();
        peer.close(code, reason);
      },
    };
    session.attachment = attachment;
    // This marks a fresh terminal, never a replay of historical terminal queries.
    peer.send(JSON.stringify({ type: "ready", cols, rows }));
    try {
      child = Bun.spawn(["tmux", "-L", this.socket, "-f", "/dev/null", "attach-session", "-t", session.id], {
        env: this.env,
        terminal: { cols, rows, name: "xterm-256color", data(_terminal, data) { flow.push(data); } },
      });
      void child.exited.then(() => attachment.close(1000, "Terminal attachment ended"));
      void reportMouseMode();
    } catch (error) {
      attachment.close(1011, "Could not attach terminal");
      throw error;
    }
    return attachment;
  }

  private refresh() {
    if (!this.sessions.size) return;
    const result = this.command(["list-panes", "-a", "-F", `#{session_name}\t#{pane_dead}\t#{pane_dead_status}\t${titleFormat}`]);
    if (result.exitCode !== 0) return;
    for (const line of result.stdout.toString().trimEnd().split("\n")) {
      const [id, dead, code, ...title] = line.split("\t");
      const session = this.sessions.get(id!);
      if (!session) continue;
      session.title = title.join("\t").slice(0, 512);
      if (dead === "1") { session.status = "exited"; session.exitCode = Number(code) || 0; }
    }
  }

  remove(session: Session) {
    session.attachment?.close(4004, "Session removed");
    this.command(["kill-session", "-t", session.id]);
    this.sessions.delete(session.id);
  }

  dispose() {
    clearInterval(this.poll);
    for (const session of this.sessions.values()) session.attachment?.close(1001, "Server stopping");
    if (this.sessions.size) this.command(["kill-server"]);
    this.sessions.clear();
  }
}
