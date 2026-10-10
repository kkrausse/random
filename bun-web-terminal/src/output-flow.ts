// Bound both browser work in flight and output waiting on the server. zmx, not
// this queue, owns session state, so output the browser cannot keep up with is
// dropped and the terminal restored from the session instead.
export class OutputFlow {
  static readonly frameBytes = 32 * 1024;
  static readonly windowBytes = 128 * 1024;
  static readonly queueBytes = 2 * 1024 * 1024;
  static readonly batchMs = 8;
  private chunks: Uint8Array[] = [];
  private queued = 0;
  private restoring = 0; // Queued snapshot bytes, which do not count against the queue limit.
  private outstanding = 0;
  private dropping = false;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private sentAt = -Infinity;

  /**
   * `stalled`: the browser stopped acknowledging. `overflowed`: queued output
   * was dropped and the browser has since parsed all it was sent, so it is
   * ready for a fresh snapshot.
   */
  constructor(private send: (data: Uint8Array) => void, private stalled: () => void, private overflowed: () => void = stalled) {}

  /** A snapshot is bounded by the session's own scrollback and has to arrive whole. */
  push(data: Uint8Array, snapshot = false) {
    if (this.disposed || this.dropping) return;
    if (snapshot) this.restoring += data.byteLength;
    else if (this.queued - this.restoring + data.byteLength > OutputFlow.queueBytes) {
      this.clear();
      this.dropping = true;
      if (!this.outstanding) this.resume();
      return;
    }
    for (let offset = 0; offset < data.byteLength; offset += OutputFlow.frameBytes) {
      this.chunks.push(data.subarray(offset, offset + OutputFlow.frameBytes));
    }
    this.queued += data.byteLength;
    this.schedule();
  }

  /** Forget output that was not sent yet; a snapshot is about to replace it. */
  clear() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.chunks = [];
    this.queued = 0;
    this.restoring = 0;
  }

  acknowledge(bytes: number) {
    if (this.disposed || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.outstanding) return false;
    this.outstanding -= bytes;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    if (this.outstanding) this.watchProgress();
    else if (this.dropping) this.resume();
    this.schedule();
    return true;
  }

  private resume() {
    this.dropping = false;
    this.overflowed();
  }

  // An idle connection sends at once, so a keystroke's echo is never held
  // back. Only output following a send within the batch interval is coalesced.
  private schedule() {
    if (this.disposed || this.timer) return;
    const wait = OutputFlow.batchMs - (performance.now() - this.sentAt);
    if (wait <= 0) this.flush();
    else this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush() {
    this.timer = undefined;
    while (!this.disposed && this.chunks.length) {
      const available = Math.min(OutputFlow.frameBytes, OutputFlow.windowBytes - this.outstanding);
      if (this.chunks[0]!.byteLength > available) return;
      const batch: Uint8Array[] = [];
      let bytes = 0;
      while (this.chunks.length && bytes + this.chunks[0]!.byteLength <= available) {
        const chunk = this.chunks.shift()!;
        batch.push(chunk);
        bytes += chunk.byteLength;
      }
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of batch) { data.set(chunk, offset); offset += chunk.byteLength; }
      this.queued -= bytes;
      this.restoring = Math.max(0, this.restoring - bytes);
      this.outstanding += bytes;
      this.watchProgress();
      this.sentAt = performance.now();
      this.send(data);
    }
  }

  private watchProgress() {
    if (!this.deadline) this.deadline = setTimeout(() => {
      this.dispose();
      this.stalled();
    }, 10_000);
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.deadline);
    this.chunks = [];
    this.queued = 0;
    this.outstanding = 0;
  }
}
