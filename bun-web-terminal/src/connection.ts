type Status = "connecting" | "connected" | "reconnecting" | "offline" | "detached" | "closed";
type TerminalView = {
  size(): { cols: number; rows: number };
  reset(): void;
  write(data: Uint8Array): void;
  status(status: Status): void;
  mouseMode(tracking: boolean): void;
};

// Binary messages are terminal bytes; text messages are protocol controls.
export class TerminalConnection {
  private socket?: WebSocket;
  private retry?: ReturnType<typeof setTimeout>;
  private heartbeat: ReturnType<typeof setInterval>;
  private pongTimeout?: ReturnType<typeof setTimeout>;
  private connectTimeout?: ReturnType<typeof setTimeout>;
  private frame?: number;
  private queue: Uint8Array[] = [];
  private attempt = 0;
  private stopped = false;
  private ready = false;
  private encoder = new TextEncoder();
  private attachmentId?: string;
  private attachmentListeners = new Set<() => void>();

  get attachment() {
    return this.ready && this.socket?.readyState === WebSocket.OPEN && this.attachmentId
      ? { sessionId: this.id, attachmentId: this.attachmentId } : undefined;
  }

  onAttachmentChange(listener: () => void) {
    this.attachmentListeners.add(listener);
    return () => { this.attachmentListeners.delete(listener); };
  }

  constructor(private id: string, private view: TerminalView) {
    this.heartbeat = setInterval(() => { if (!document.hidden) this.ping(); }, 20_000);
    this.connect();
  }

  input(data: string) {
    if (this.ready && this.socket?.readyState === WebSocket.OPEN) this.socket.send(this.encoder.encode(data));
  }

  resize() { if (this.ready) this.control({ type: "resize", ...this.view.size() }); }

  restore() {
    if (this.stopped) return;
    if (this.socket?.readyState === WebSocket.OPEN) this.ping();
    else this.connect();
  }

  refresh() {
    this.stopped = false;
    this.attempt = 0;
    this.disconnect();
    this.connect();
  }

  private control(message: object) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  private connect() {
    if (this.stopped || this.socket || document.hidden) return;
    clearTimeout(this.retry);
    if (!navigator.onLine) { this.view.status("offline"); return; }
    this.view.status(this.attempt ? "reconnecting" : "connecting");
    const { cols, rows } = this.view.size();
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${location.host}/ws/${this.id}?cols=${cols}&rows=${rows}`);
    this.socket = socket;
    this.connectTimeout = setTimeout(() => {
      if (this.socket === socket) this.reconnect();
    }, 8_000);
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      if (typeof event.data === "string") {
        const message = JSON.parse(event.data);
        if (message.type === "ready") {
          clearTimeout(this.connectTimeout);
          this.attempt = 0;
          // Keep the WASM instance: ghostty-web.reset() leaves some input/mouse
          // helpers pointing at the freed instance. RIS resets it in place.
          this.view.reset();
          this.ready = true;
          this.attachmentId = message.attachmentId;
          for (const listener of this.attachmentListeners) listener();
          this.view.status("connected");
          this.resize();
          this.ping();
        } else if (message.type === "mouse-mode" && typeof message.tracking === "boolean") {
          this.view.mouseMode(message.tracking);
        } else if (message.type === "pong") {
          clearTimeout(this.pongTimeout);
          this.pongTimeout = undefined;
        }
        return;
      }
      if (!this.ready) return;
      this.queue.push(new Uint8Array(event.data));
      this.scheduleWrite();
    };
    socket.onclose = (event) => {
      if (socket !== this.socket) return;
      if (event.code === 4002 || event.code === 4004 || event.code === 1000 || event.code === 1008) {
        this.disconnect();
        this.stopped = true;
        this.view.status(event.code === 4002 ? "detached" : "closed");
        return;
      }
      this.reconnect();
    };
    socket.onerror = () => { if (socket === this.socket) this.reconnect(); };
  }

  private reconnect() {
    this.disconnect();
    if (this.stopped) return;
    this.view.status(navigator.onLine ? "reconnecting" : "offline");
    this.retry = setTimeout(() => this.connect(), Math.min(5_000, 250 * 2 ** this.attempt++));
  }

  private scheduleWrite() {
    if (this.frame !== undefined) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      const started = performance.now();
      let bytes = 0;
      while (this.queue.length && performance.now() - started < 8) {
        const chunk = this.queue.shift()!;
        this.view.write(chunk);
        bytes += chunk.byteLength;
      }
      if (bytes) this.control({ type: "ack", bytes });
      if (this.queue.length) this.scheduleWrite();
    });
  }

  private ping() {
    if (this.pongTimeout || this.socket?.readyState !== WebSocket.OPEN) return;
    const socket = this.socket;
    this.control({ type: "ping" });
    // Don't wait for a close handshake on a connection we already know is dead.
    this.pongTimeout = setTimeout(() => { if (this.socket === socket) this.reconnect(); }, 3_000);
  }

  private disconnect() {
    const socket = this.socket;
    this.socket = undefined;
    this.ready = false;
    this.attachmentId = undefined;
    for (const listener of this.attachmentListeners) listener();
    socket?.close();
    clearTimeout(this.retry);
    clearTimeout(this.connectTimeout);
    clearTimeout(this.pongTimeout);
    this.pongTimeout = undefined;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.queue = [];
  }

  suspend() {
    this.stopped = true;
    this.disconnect();
  }

  dispose() {
    this.stopped = true;
    clearInterval(this.heartbeat);
    this.disconnect();
  }
}
