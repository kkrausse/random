// Bound both browser work in flight and output waiting on the server. A stalled
// attachment can be discarded: tmux, rather than this queue, owns session state.
export class OutputFlow {
  static readonly frameBytes = 32 * 1024;
  static readonly windowBytes = 128 * 1024;
  static readonly queueBytes = 512 * 1024;
  static readonly batchMs = 8;
  private chunks: Uint8Array[] = [];
  private queued = 0;
  private outstanding = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private deadline?: ReturnType<typeof setTimeout>;
  private disposed = false;
  private sentAt = -Infinity;

  constructor(private send: (data: Uint8Array) => void, private stalled: () => void) {}

  push(data: Uint8Array) {
    if (this.disposed) return;
    if (this.queued + data.byteLength > OutputFlow.queueBytes) {
      this.dispose();
      this.stalled();
      return;
    }
    for (let offset = 0; offset < data.byteLength; offset += OutputFlow.frameBytes) {
      this.chunks.push(data.slice(offset, offset + OutputFlow.frameBytes));
    }
    this.queued += data.byteLength;
    this.schedule();
  }

  acknowledge(bytes: number) {
    if (this.disposed || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > this.outstanding) return false;
    this.outstanding -= bytes;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    if (this.outstanding) this.watchProgress();
    this.schedule();
    return true;
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
