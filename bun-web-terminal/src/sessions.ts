import { OutputFlow } from "./output-flow";

const titleFormat = "#{?#{||:#{==:#{pane_title},#{host}},#{==:#{pane_title},#{host_short}}},#{pane_current_command},#{pane_title}}";

export type Session = {
  id: string;
  name: string;
  title: string;
  command: string;
  cwd: string;
  status: "running" | "exited";
  createdAt: Date;
  exitCode: number | null;
  attachment?: Attachment;
};

export type Peer = { send(data: string | Uint8Array): unknown; close(code: number, reason: string): void };
export type Attachment = {
  readonly id: string;
  onClose(listener: () => void): () => void;
  input(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  acknowledge(bytes: number): boolean;
  copySelection(): void;
  cancelSelection(): void;
  /** Scroll the pane by whole lines; positive is toward newer output. */
  scroll(lines: number): void;
  close(code?: number, reason?: string): void;
};

export function dimensions(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  return { cols: Math.max(2, Math.min(500, cols as number)), rows: Math.max(2, Math.min(300, rows as number)) };
}

// Production uses the standard tmux server; tests supply an isolated socket.
export class SessionManager {
  readonly sessions = new Map<string, Session>();
  private readonly env = { ...process.env, TMUX: undefined, TERM: "xterm-256color", COLORTERM: "truecolor" };
  private poll: ReturnType<typeof setInterval>;

  constructor(private cwd: string, private socket?: string) {
    const check = Bun.spawnSync(["tmux", "-V"], { stderr: "pipe" });
    if (check.exitCode !== 0) throw new Error("tmux is required (macOS: brew install tmux).");
    this.refresh();
    this.poll = setInterval(() => this.refresh(), 2000);
    this.poll.unref();
  }

  private command(args: string[]) {
    return Bun.spawnSync([...this.tmuxCommand(), ...args], { env: this.env, stdout: "pipe", stderr: "pipe" });
  }

  private tmuxCommand() {
    return ["tmux", ...(this.socket ? ["-L", this.socket, "-f", "/dev/null"] : [])];
  }

  create(label?: unknown) {
    const suffix = typeof label === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(label) ? `-${label}` : "";
    const shell = process.env.SHELL ?? "/bin/zsh";
    const result = this.command([
      "new-session", "-d", "-P", "-F", "#{session_id}", "-c", this.cwd, "-x", "100", "-y", "30", "--", shell, "-l",
    ]);
    if (result.exitCode !== 0) throw new Error(`Could not create terminal: ${result.stderr.toString().trim()}`);
    const id = result.stdout.toString().trim();
    const name = id;
    if (suffix) this.command(["rename-session", "-t", id, `${id.slice(1)}${suffix}`]);
    this.command([
      "set-option", "-t", name, "status", "off",
      ";", "set-option", "-t", name, "remain-on-exit", "on",
      ";", "set-option", "-t", name, "window-size", "latest",
      ";", "set-option", "-t", name, "mouse", "on",
      ";", "set-option", "-t", name, "set-titles", "on",
      ";", "set-option", "-t", name, "set-titles-string", titleFormat,
    ]);
    this.refresh();
    const session = this.sessions.get(id);
    if (!session) throw new Error("Could not discover newly created terminal.");
    return session;
  }

  attach(session: Session, peer: Peer, cols: number, rows: number): Attachment {
    session.attachment?.close(4002, "Session opened in another tab");
    let closed = false;
    let child: Bun.Subprocess | undefined;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let mouseTimer: ReturnType<typeof setTimeout> | undefined;
    let mouseTracking: boolean | undefined;
    let selectionTimer: ReturnType<typeof setTimeout> | undefined;
    let scrollLines = 0;
    let scrolling = false;
    const command = (args: string[]) => this.command(args);
    // Touch scrolling asks for exact line counts, which tmux's wheel bindings
    // (five lines a step) cannot express. Requests arriving while tmux is busy
    // merge into the next command.
    const flushScroll = async () => {
      if (scrolling) return;
      scrolling = true;
      try {
        while (!closed && scrollLines !== 0) {
          const count = Math.min(Math.abs(scrollLines), 1000);
          const up = scrollLines < 0;
          scrollLines = 0;
          // Pagers without mouse support get cursor keys, as with tmux's own wheel handling.
          await Bun.spawn([...this.tmuxCommand(), "if-shell", "-F", "-t", session.id,
            "#{&&:#{alternate_on},#{!:#{pane_in_mode}}}",
            `send-keys -N ${count} ${up ? "Up" : "Down"}`,
            up ? `copy-mode -e ; send-keys -X -N ${count} scroll-up` : `send-keys -X -N ${count} scroll-down`],
          { env: this.env, stdout: "ignore", stderr: "ignore" }).exited;
        }
      } catch {
        // tmux is temporarily unavailable; drop this scroll.
      } finally { scrolling = false; }
    };
    // tmux's outer mouse mode is always on for scrolling. Read the pane's
    // application modes separately; serialize queries so slow tmux cannot pile up.
    const reportMouseMode = async () => {
      try {
        const query = Bun.spawn([...this.tmuxCommand(), "display-message", "-p", "-t", session.id,
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
    const closeListeners = new Set<() => void>();
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      onClose(listener) { closeListeners.add(listener); return () => { closeListeners.delete(listener); }; },
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
      copySelection() {
        clearTimeout(selectionTimer);
        // Only an explicit copy command may save the selection to tmux's buffer
        // (and potentially forward it via OSC 52). Releasing the mouse only
        // leaves the tmux copy-mode highlight in place.
        selectionTimer = setTimeout(() => {
          selectionTimer = undefined;
          if (closed) return;
          const mode = command(["display-message", "-p", "-t", session.id, "#{pane_mode}|#{selection_present}"]);
          if (mode.exitCode !== 0 || mode.stdout.toString().trim() !== "copy-mode|1") return;
          const copied = command(["send-keys", "-t", session.id, "-X", "copy-selection-no-clear"]);
          if (copied.exitCode !== 0) return;
          const buffer = command(["show-buffer"]);
          if (buffer.exitCode === 0 && buffer.stdout.byteLength <= 2_000_000) {
            peer.send(JSON.stringify({ type: "selection", text: buffer.stdout.toString() }));
          }
        }, 30);
      },
      cancelSelection() {
        clearTimeout(selectionTimer);
        selectionTimer = undefined;
        if (!closed) command(["send-keys", "-t", session.id, "-X", "cancel"]);
      },
      scroll(lines) {
        if (closed) return;
        scrollLines += lines;
        void flushScroll();
      },
      close(code = 1000, reason = "Attachment closed") {
        if (closed) return;
        closed = true;
        for (const listener of closeListeners) listener();
        closeListeners.clear();
        clearTimeout(resizeTimer);
        flow.dispose();
        clearTimeout(mouseTimer);
        clearTimeout(selectionTimer);
        if (session.attachment === attachment) session.attachment = undefined;
        child?.kill();
        child?.terminal?.close();
        peer.close(code, reason);
      },
    };
    session.attachment = attachment;
    // This marks a fresh terminal, never a replay of historical terminal queries.
    peer.send(JSON.stringify({ type: "ready", cols, rows, attachmentId: attachment.id }));
    try {
      // Ghostty Web handles OSC 8 links, but tmux does not infer that from
      // xterm-256color. Advertise it on this client only, not the shared server.
      child = Bun.spawn([...this.tmuxCommand(), "-T", "hyperlinks", "attach-session", "-t", session.id], {
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
    const result = this.command(["list-sessions", "-F", `#{session_id}\t#{session_name}\t#{session_created}\t#{pane_dead}\t#{pane_dead_status}\t#{pane_current_command}\t#{pane_current_path}\t${titleFormat}`]);
    if (result.exitCode !== 0 && !/no server running|no sessions|error connecting to/.test(result.stderr.toString())) return;
    const seen = new Set<string>();
    for (const line of result.stdout.toString().trimEnd().split("\n")) {
      const [id, name, created, dead, code, command, cwd, ...title] = line.split("\t");
      if (!id || !name) continue;
      seen.add(id);
      let session = this.sessions.get(id);
      if (!session) {
        session = { id, name, title: "", command: "", cwd: "", status: "running", createdAt: new Date(Number(created) * 1000), exitCode: null };
        this.sessions.set(id, session);
      }
      session.name = name;
      session.command = command ?? "";
      session.cwd = cwd ?? "";
      session.title = title.join("\t").slice(0, 512);
      session.status = dead === "1" ? "exited" : "running";
      session.exitCode = dead === "1" ? Number(code) || 0 : null;
    }
    for (const [id, session] of this.sessions) {
      if (seen.has(id)) continue;
      session.attachment?.close(4004, "Session removed");
      this.sessions.delete(id);
    }
  }

  rename(session: Session, name: unknown) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 128 || /[.:\x00-\x1f\x7f]/.test(name)) {
      throw new Error("Use a name of 1–128 characters without dots, colons, or control characters.");
    }
    const result = this.command(["rename-session", "-t", session.id, "--", name.trim()]);
    if (result.exitCode !== 0) throw new Error(result.stderr.toString().trim());
    this.refresh();
    return session;
  }

  remove(session: Session) {
    session.attachment?.close(4004, "Session removed");
    this.command(["kill-session", "-t", session.id]);
    this.sessions.delete(session.id);
  }

  dispose() {
    clearInterval(this.poll);
    for (const session of this.sessions.values()) session.attachment?.close(1001, "Server stopping");
    this.sessions.clear();
  }
}
