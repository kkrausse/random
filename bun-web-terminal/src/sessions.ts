import { OutputFlow } from "./output-flow";
import { decodeLabel, encodeLabel, foreground, openZmx, type Zmx, type ZmxLink } from "./zmx";

export type Session = {
  /** The zmx session name: `zmx attach <id>` reaches the same terminal. */
  id: string;
  name: string;
  title: string;
  command: string;
  cwd: string;
  createdAt: Date;
  attachment?: Attachment;
};

export type Peer = { send(data: string | Uint8Array): unknown; close(code: number, reason: string): void };
export type Attachment = {
  readonly id: string;
  onClose(listener: () => void): () => void;
  input(data: Uint8Array): void;
  resize(cols: number, rows: number): void;
  acknowledge(bytes: number): boolean;
  /** Make a full-screen application repaint what a snapshot cannot carry. */
  redraw(): void;
  /** Restore the browser from the session again. */
  restore(): void;
  close(code?: number, reason?: string): void;
};

export function dimensions(cols: unknown, rows: unknown) {
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) return null;
  return { cols: Math.max(2, Math.min(500, cols as number)), rows: Math.max(2, Math.min(300, rows as number)) };
}

// Sessions carry their web name in this zmx label; ids never change.
const nameLabel = "label";
// Session names end up in URLs, shell-typed attachment paths and socket paths.
const safeId = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

// Production uses zmx's default socket directory; tests supply an isolated one.
export class SessionManager {
  readonly sessions = new Map<string, Session>();
  private poll: ReturnType<typeof setInterval>;
  private loading: Promise<void> = Promise.resolve();
  private loads = 0;
  private creating: Promise<unknown> = Promise.resolve();

  static async open(cwd: string, dir?: string) {
    const manager = new SessionManager(cwd, await openZmx(dir));
    await manager.refresh();
    return manager;
  }

  private constructor(private cwd: string, private zmx: Zmx) {
    this.poll = setInterval(() => { if (!this.loads) void this.refresh(); }, 2000);
    this.poll.unref();
  }

  // Ids are short numbers. One creation at a time, so two never pick the same.
  create(label?: unknown): Promise<Session> {
    const suffix = typeof label === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(label) ? `-${label}` : "";
    const created = this.creating.then(async () => {
      await this.refresh();
      const last = Math.max(0, ...[...this.sessions.keys()].map(id => Number.parseInt(id, 10) || 0));
      const id = `${last + 1}${suffix}`;
      await this.zmx.create(id, this.cwd);
      await this.refresh();
      const session = this.sessions.get(id);
      if (!session) throw new Error("Could not discover newly created terminal.");
      return session;
    });
    this.creating = created.catch(() => {});
    return created;
  }

  attach(session: Session, peer: Peer, cols: number, rows: number): Attachment {
    session.attachment?.close(4002, "Session opened in another tab");
    let closed = false;
    let link: ZmxLink | undefined;
    let size = { cols, rows };
    let pendingSize = size;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let redrawTimer: ReturnType<typeof setTimeout> | undefined;
    const title = titleScanner((value) => { session.title = value; });
    const connect = () => {
      const current: ZmxLink = this.zmx.attach(session.id, size, {
        restore(snapshot) {
          if (link !== current) return;
          // Tells the browser to start from a fresh terminal: what follows is
          // the session's state, never a replay of historical terminal queries.
          peer.send(JSON.stringify({ type: "ready", attachmentId: attachment.id, snapshot: snapshot.byteLength }));
          title(snapshot);
          flow.push(snapshot, true);
        },
        output(data) {
          if (link !== current) return;
          title(data);
          flow.push(data);
        },
        close: () => {
          if (link !== current) return;
          attachment.close(1000, "Terminal session ended");
          void this.refresh();
        },
      });
      link = current;
    };
    const restore = () => {
      if (closed) return;
      link?.close();
      flow.clear();
      connect();
    };
    const flow = new OutputFlow((data) => peer.send(data), () => attachment.close(1013, "Terminal output stalled; reconnecting"), restore);
    const closeListeners = new Set<() => void>();
    const attachment: Attachment = {
      id: crypto.randomUUID(),
      onClose(listener) { closeListeners.add(listener); return () => { closeListeners.delete(listener); }; },
      input(data) { if (!closed) link?.input(data); },
      resize(nextCols, nextRows) {
        pendingSize = { cols: nextCols, rows: nextRows };
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => {
          if (closed || (size.cols === pendingSize.cols && size.rows === pendingSize.rows)) return;
          size = pendingSize;
          link?.resize(size.cols, size.rows);
        }, 100);
      },
      acknowledge(bytes) { return flow.acknowledge(bytes); },
      // Deliberately outside the resize debounce, which would merge the two
      // sizes into no change. Applications that ignore a same-size SIGWINCH
      // repaint only when they see a different size.
      redraw() {
        if (closed || redrawTimer) return;
        link?.resize(size.cols, size.rows > 2 ? size.rows - 1 : size.rows + 1);
        redrawTimer = setTimeout(() => {
          redrawTimer = undefined;
          if (!closed) link?.resize(size.cols, size.rows);
        }, 100);
      },
      restore,
      close(code = 1000, reason = "Attachment closed") {
        if (closed) return;
        closed = true;
        for (const listener of closeListeners) listener();
        closeListeners.clear();
        clearTimeout(resizeTimer);
        clearTimeout(redrawTimer);
        flow.dispose();
        if (session.attachment === attachment) session.attachment = undefined;
        link?.close();
        peer.close(code, reason);
      },
    };
    session.attachment = attachment;
    connect();
    return attachment;
  }

  // Each call reads the sessions again after it was made, never a list from before.
  refresh() {
    this.loads++;
    return this.loading = this.loading.then(() => this.load()).catch(() => {}).finally(() => { this.loads--; });
  }

  private async load() {
    const listed = await this.zmx.list();
    if (!listed) return;
    const processes = await foreground(listed.map(entry => entry.pid).filter(pid => pid > 0));
    const seen = new Set<string>();
    for (const entry of listed) {
      if (!safeId.test(entry.name)) continue;
      seen.add(entry.name);
      let session = this.sessions.get(entry.name);
      if (!session) {
        session = { id: entry.name, name: entry.name, title: "", command: "", cwd: "", createdAt: entry.createdAt };
        this.sessions.set(entry.name, session);
      }
      const label = entry.labels[nameLabel];
      session.name = label ? decodeLabel(label) : entry.name;
      const running = processes.get(entry.pid);
      session.command = running?.command ?? session.command;
      session.cwd = running?.cwd ?? (entry.cwd || session.cwd);
    }
    for (const [id, session] of this.sessions) {
      if (seen.has(id)) continue;
      session.attachment?.close(4004, "Session removed");
      this.sessions.delete(id);
    }
  }

  async rename(session: Session, name: unknown) {
    if (typeof name !== "string" || !name.trim() || name.trim().length > 128 || /[\x00-\x1f\x7f]/.test(name)) {
      throw new Error("Use a name of 1–128 characters without control characters.");
    }
    await this.zmx.setLabel(session.id, nameLabel, encodeLabel(name.trim()));
    session.name = name.trim();
    return session;
  }

  async remove(session: Session) {
    session.attachment?.close(4004, "Session removed");
    this.sessions.delete(session.id);
    await this.zmx.kill(session.id);
  }

  // Sessions belong to their zmx daemons and outlive this process.
  dispose() {
    clearInterval(this.poll);
    for (const session of this.sessions.values()) session.attachment?.close(1001, "Server stopping");
    this.sessions.clear();
  }
}

// The sessions page picks an icon from the title the application last set
// (OSC 0 or 2). zmx replays it in each snapshot, so one attachment is enough.
function titleScanner(found: (title: string) => void) {
  let pending = "";
  return (data: Uint8Array) => {
    if (!pending && data.indexOf(0x1b) === -1) return;
    pending += Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("latin1");
    while (true) {
      const start = pending.indexOf("\x1b]");
      if (start === -1) { pending = pending.endsWith("\x1b") ? "\x1b" : ""; return; }
      const end = pending.slice(start + 2).search(/\x07|\x1b\\/);
      if (end === -1) { pending = pending.length - start <= 4096 ? pending.slice(start) : ""; return; }
      const [command, ...text] = pending.slice(start + 2, start + 2 + end).split(";");
      if (command === "0" || command === "2") found(Buffer.from(text.join(";"), "latin1").toString("utf8").slice(0, 512));
      pending = pending.slice(start + 2 + end + 1);
    }
  };
}
