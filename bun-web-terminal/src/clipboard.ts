// Observe OSC 52 without modifying the bytes delivered to the terminal emulator.
// tmux emits ordinary OSC sequences to its attached terminal (not DCS wrappers).
export class ClipboardRequests {
  private state: "text" | "escape" | "osc" | "end" = "text";
  private payload = "";
  private overflow = false;

  constructor(private receive: (text: string) => void) {}

  reset() { this.state = "text"; this.payload = ""; this.overflow = false; }

  write(data: Uint8Array) {
    for (const byte of data) {
      if (this.state === "text") {
        if (byte === 27) this.state = "escape";
      } else if (this.state === "escape") {
        if (byte === 93) { this.state = "osc"; this.payload = ""; this.overflow = false; }
        else if (byte !== 27) this.state = "text";
      } else if (byte === 7 || (this.state === "end" && byte === 92)) {
        this.finish();
        this.reset();
      } else if (byte === 27) {
        this.state = "end";
      } else if (this.state === "end" || byte === 24 || byte === 26) {
        this.reset();
      } else if (!this.overflow) {
        if (this.payload.length < 4 * 1024 * 1024) this.payload += String.fromCharCode(byte);
        else { this.payload = ""; this.overflow = true; }
      }
    }
  }

  private finish() {
    if (this.overflow) return;
    const match = /^52;[cps0-7]*;([A-Za-z0-9+/]*={0,2})$/.exec(this.payload);
    if (!match) return; // Includes clipboard queries: never read the user's clipboard.
    try {
      const bytes = Uint8Array.from(atob(match[1]!), char => char.charCodeAt(0));
      this.receive(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch { /* Ignore malformed base64 or UTF-8. */ }
  }
}

export class ApplicationClipboard {
  private version = 0;
  private pending: string | undefined;

  constructor(
    private write: (text: string) => Promise<void>,
    private showPending: (pending: boolean) => void,
    private notice: (message: string) => void,
  ) {}

  receive(text: string) {
    this.pending = text;
    this.version++;
    this.showPending(true);
    void this.copy();
  }

  // Called directly by the button's click handler to preserve iOS user activation.
  async copy() {
    if (this.pending === undefined) return;
    const version = this.version;
    try {
      await this.write(this.pending);
      if (version !== this.version) return;
      this.pending = undefined;
      this.showPending(false);
      this.notice("Copied");
    } catch {
      if (version === this.version) this.notice("Tap to copy · clipboard access needs HTTPS and browser permission");
    }
  }

  reset() { this.version++; this.pending = undefined; this.showPending(false); }
}
