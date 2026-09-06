import { DictationEvents, dictationLimits, validAudio, validStart } from "./dictation-protocol";
import type { DictationService } from "./dictation-service";
import type { Session, Peer } from "./sessions";

export class DictationProxy {
  private upstream?: WebSocket;
  private phase = "new";
  private id = "";
  private total = 0;
  private sequence = -1;
  private unsubscribe?: () => void;
  private deadline = setTimeout(() => this.fail("timeout", "Dictation start timed out"), 15_000);
  constructor(private peer: Peer, private sessions: Map<string, Session>, private service: Pick<DictationService, "connect">) {}

  message(message: string | Uint8Array) {
    if (this.phase === "closed") return;
    try {
      if (typeof message !== "string") {
        if (this.phase !== "ready" || !validAudio(message)) throw new Error("Invalid or out-of-state audio");
        this.total += message.byteLength;
        if (this.total > dictationLimits.seconds * 64_000) throw new Error("Recording exceeds five minutes");
        this.send(message);
        return;
      }
      if (message.length > 4096) throw new Error("Control message too large");
      const value = JSON.parse(message);
      if (this.phase === "new") {
        if (!validStart(value)) throw new Error("Invalid dictation start");
        const { sessionId, attachmentId } = value as typeof value & { sessionId?: string; attachmentId?: string };
        const attachment = this.sessions.get(sessionId ?? "")?.attachment;
        if (!attachment || attachment.id !== attachmentId) throw new Error("Terminal attachment is no longer active");
        this.id = value.recordingId;
        this.phase = "loading";
        this.unsubscribe = attachment.onClose(() => this.fail("attachment_lost", "Terminal attachment lost"));
        clearTimeout(this.deadline);
        this.deadline = setTimeout(() => this.fail("timeout", "Model loading timed out"), 120_000);
        // Terminal identity stays at this boundary.
        const { type, version, recordingId, sampleRate, channels, format } = value;
        void this.start({ type, version, recordingId, sampleRate, channels, format });
      } else if (value.recordingId === this.id && value.type === "cancel") {
        this.close();
      } else if (value.recordingId === this.id && value.type === "stop" && this.phase === "ready") {
        this.phase = "finishing";
        clearTimeout(this.deadline);
        this.deadline = setTimeout(() => this.fail("timeout", "Final transcription timed out"), 30_000);
        this.send(JSON.stringify({ type: "stop", recordingId: this.id }));
      } else throw new Error("Invalid dictation control state");
    } catch (error) { this.fail("invalid_input", error instanceof Error ? error.message : "Invalid input"); }
  }

  private async start(start: object) {
    try {
      const upstream = await this.service.connect();
      if (this.phase === "closed") { upstream.close(); return; }
      this.upstream = upstream;
      const events = new DictationEvents(this.id);
      upstream.onopen = () => { if (this.phase !== "closed") upstream.send(JSON.stringify(start)); };
      upstream.onmessage = event => {
        if (this.phase === "closed") return;
        try {
          if (typeof event.data !== "string" || event.data.length > 128_000) throw new Error();
          const value = JSON.parse(event.data);
          if (!events.accept(value)) throw new Error();
          this.sequence = value.sequence;
          if (value.type === "ready") {
            this.phase = "ready";
            clearTimeout(this.deadline);
            this.deadline = setTimeout(() => this.fail("duration_limit", "Recording exceeds five minutes"), 300_000);
          }
          this.peer.send(event.data);
          if (value.type === "done" || value.type === "error") this.close();
        } catch { this.fail("protocol_error", "Invalid dictation service response"); }
      };
      upstream.onerror = () => this.fail("service_error", "Dictation service connection failed");
      upstream.onclose = () => { if (this.phase !== "closed") this.fail("service_closed", "Dictation service disconnected"); };
    } catch { this.fail("unavailable", "Dictation unavailable · build/configure the Swift service"); }
  }

  private send(data: string | Uint8Array) {
    if (this.upstream?.readyState !== WebSocket.OPEN) throw new Error("Dictation service is disconnected");
    if (this.upstream.bufferedAmount + (typeof data === "string" ? data.length : data.byteLength) > dictationLimits.queueBytes) throw new Error("Dictation audio queue overloaded");
    this.upstream.send(data);
  }

  private fail(code: string, message: string) {
    if (this.phase === "closed") return;
    this.peer.send(JSON.stringify({ type: "error", recordingId: this.id, sequence: ++this.sequence, code, message }));
    this.close();
  }

  close() {
    this.phase = "closed";
    clearTimeout(this.deadline);
    this.unsubscribe?.();
    this.upstream?.close();
    this.peer.close(1000, "Dictation ended");
  }
}
