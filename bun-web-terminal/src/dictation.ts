import type { TerminalConnection } from "./connection";
import { audioFormat, DictationEvents, dictationLimits } from "./dictation-protocol";
import { TranscriptPipeline } from "./transcript";

export type DictationState = "idle" | "loading" | "recording" | "waiting" | "finishing" | "error" | "unavailable";
type View = {
  state(state: DictationState): void;
  startup(stage: string): void;
  warm(active: boolean): void;
  preview(text: string): void;
  notice(text: string): void;
  clearControl(): void;
  paste(text: string): void;
};
type Recording = {
  id: string; attachmentId: string; sessionId: string; phase: DictationState;
  context: AudioContext; stream?: MediaStream; node?: AudioWorkletNode; source?: MediaStreamAudioSourceNode;
  socket?: WebSocket; timer?: ReturnType<typeof setTimeout>; retry?: ReturnType<typeof setTimeout>;
  transcript: TranscriptPipeline; chunks: Uint8Array[]; bytes: number;
  submit?: () => void;
  sent: number; acknowledged: number; ready: boolean; capturing: boolean; drained: boolean; stopping: boolean; stopSent: boolean; attempts: number;
};

// Keep the entire recording until done: a disconnected decoder starts fresh and
// must receive the same audio from byte zero. 300 seconds of f32le mono is 19.2 MB.
const maximumBytes = dictationLimits.seconds * 64_000;
const inFlightBytes = 64_000; // below the two-second queues at both server boundaries
const warmMicMs = 30_000;

export class DictationController {
  private recording?: Recording;
  private prepared?: { context: AudioContext; module: Promise<void> };
  private warm?: { stream: MediaStream; sessionId: string; timer: ReturnType<typeof setTimeout> };
  constructor(private connection: TerminalConnection, private view: View) {
    view.state("idle");
    view.warm(false);
    connection.onAttachmentChange(() => {
      if (!connection.attachment) this.discardWarm();
      const r = this.recording;
      if (!r) return;
      if (connection.terminalStopped) { this.cancel("Dictation stopped · terminal detached"); return; }
      const attachment = connection.attachment;
      if (attachment && attachment.sessionId !== r.sessionId) { this.cancel("Dictation stopped · terminal changed"); return; }
      if (!attachment) { r.socket?.close(); this.wait(r); }
      else if (!r.socket || r.socket.readyState === WebSocket.CLOSED) this.connect(r);
    });
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { this.cancel(); this.discardWarm(); }
    });
    window.addEventListener("pagehide", () => {
      this.cancel();
      this.discardWarm();
      if (this.prepared) void this.prepared.context.close().catch(() => {});
      this.prepared = undefined;
    });
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) view.state("unavailable");
    else this.prepare();
  }

  private prepare() {
    if (this.prepared || document.hidden) return;
    try {
      // This loads the recorder before the tap, but never requests mic access.
      // A page-created context remains suspended until resume() in the gesture.
      const context = new AudioContext();
      const module = context.audioWorklet.addModule("/audio-worklet.js");
      this.prepared = { context, module };
      void module.catch(() => {
        if (this.prepared?.context !== context) return;
        this.prepared = undefined;
        void context.close().catch(() => {});
      });
    } catch { /* Retry setup on the next tap if prewarming is not supported. */ }
  }

  private takeWarm(sessionId: string) {
    const warm = this.warm;
    if (!warm) return;
    if (warm.sessionId !== sessionId || !warm.stream.getAudioTracks().some(track => track.readyState === "live")) {
      this.discardWarm();
      return;
    }
    clearTimeout(warm.timer);
    this.warm = undefined;
    warm.stream.getAudioTracks().forEach(track => { track.enabled = true; });
    this.view.warm(false);
    return warm.stream;
  }

  private keepWarm(r: Recording) {
    const stream = r.stream;
    if (!stream || document.hidden || !this.connection.attachment
      || !stream.getAudioTracks().some(track => track.readyState === "live")) return;
    this.discardWarm();
    r.stream = undefined;
    stream.getAudioTracks().forEach(track => {
      track.enabled = false;
      track.addEventListener("ended", () => { if (this.warm?.stream === stream) this.discardWarm(); }, { once: true });
    });
    const timer = setTimeout(() => this.discardWarm(), warmMicMs);
    this.warm = { stream, sessionId: r.sessionId, timer };
    this.view.warm(true);
  }

  private discardWarm() {
    const warm = this.warm;
    if (!warm) return;
    this.warm = undefined;
    clearTimeout(warm.timer);
    warm.stream.getTracks().forEach(track => track.stop());
    this.view.warm(false);
  }

  toggle() {
    const active = this.recording;
    if (active) {
      if (!active.stopping) this.stop(active);
      return;
    }
    const attachment = this.connection.attachment;
    if (!attachment) { this.view.notice("Connect the terminal before dictating"); return; }
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
      this.view.state("unavailable");
      this.view.notice("Microphone unavailable · open this terminal over HTTPS in a supported browser");
      return;
    }
    this.view.clearControl();
    this.view.preview("");
    try {
      const prepared = this.prepared;
      this.prepared = undefined;
      const context = prepared?.context ?? new AudioContext();
      const module = prepared?.module ?? context.audioWorklet.addModule("/audio-worklet.js");
      const r: Recording = { id: "", attachmentId: attachment.attachmentId, sessionId: attachment.sessionId,
        phase: "loading", context, transcript: new TranscriptPipeline(), chunks: [], bytes: 0,
        sent: 0, acknowledged: 0, ready: false, capturing: false, drained: false, stopping: false, stopSent: false, attempts: 0 };
      this.recording = r;
      this.view.state("loading");
      this.view.startup("Mic access…");
      this.deadline(r, 120_000, "Microphone permission timed out");
      const resumed = context.resume();
      const reused = this.takeWarm(attachment.sessionId);
      const permission = reused ? Promise.resolve(reused)
        : navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      void this.startAudio(r, resumed, permission, module);
      this.connect(r);
    } catch (error) { this.error(error); }
  }

  submitAfterStop(submit: () => void) {
    const r = this.recording;
    if (!r) return false;
    // Repeated Enter presses while flushing must never submit more than once.
    r.submit ??= submit;
    if (!r.stopping) this.stop(r);
    return true;
  }

  private async startAudio(r: Recording, resumed: Promise<void>, permission: Promise<MediaStream>, module: Promise<void>) {
    try {
      void resumed.catch(error => { if (this.recording === r) this.error(error); });
      const microphone = permission.then(stream => {
        if (this.recording !== r) { stream.getTracks().forEach(track => track.stop()); throw new Error("Recording canceled"); }
        r.stream = stream;
        this.view.startup("Audio processor…");
        stream.getTracks().forEach(track => track.addEventListener("ended", () => { if (this.recording === r && !r.stopping) this.cancel("Microphone disconnected"); }));
      });
      await Promise.all([microphone, module]);
      if (this.recording !== r) return;
      this.view.startup("Audio startup…");
      const node = r.node = new AudioWorkletNode(r.context, "dictation", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.onprocessorerror = () => { if (this.recording === r) this.error(new Error("Microphone processor failed")); };
      node.port.onmessage = ({ data }) => {
        if (this.recording !== r) return;
        try {
          if (data.type === "error") throw new Error(data.message);
          if (data.type === "audio") {
            if (!r.capturing) {
              r.capturing = true;
              r.phase = r.ready ? "recording" : "waiting";
              this.view.state(r.phase);
              this.deadline(r, 300_000, "Recording reached the five-minute limit");
            }
            const bytes = new Uint8Array(data.bytes);
            const kept = bytes.subarray(0, Math.max(0, maximumBytes - r.bytes));
            if (kept.byteLength) { r.chunks.push(kept); r.bytes += kept.byteLength; }
            node.port.postMessage("ack");
            this.pump(r);
            if (kept.byteLength < bytes.byteLength && !r.stopping) this.stop(r);
          }
          if (data.type === "drained") {
            r.drained = true;
            if (r.stopping) this.keepWarm(r);
            this.releaseAudio(r);
            this.pump(r);
          }
        } catch (error) { this.error(error); }
      };
      r.source = r.context.createMediaStreamSource(r.stream!);
      r.source.connect(node);
      node.connect(r.context.destination);
      r.context.onstatechange = () => {
        if (this.recording === r && r.capturing && !r.stopping && r.context.state !== "running") this.cancel("Dictation stopped · audio suspended");
      };
      if (r.stopping) node.port.postMessage("stop");
    } catch (error) { if (this.recording === r) this.error(error); }
  }

  private connect(r: Recording) {
    if (this.recording !== r || r.socket || this.connection.terminalStopped) return;
    const attachment = this.connection.attachment;
    if (!attachment || attachment.sessionId !== r.sessionId) { this.wait(r); return; }
    clearTimeout(r.retry);
    r.attachmentId = attachment.attachmentId;
    r.sent = 0;
    r.acknowledged = 0;
    r.ready = false;
    const id = r.id = crypto.randomUUID();
    r.stopSent = false;
    const events = new DictationEvents(id);
    const socket = r.socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/dictation/stream`);
    let timeout: ReturnType<typeof setTimeout>;
    const watchdog = () => { clearTimeout(timeout); timeout = setTimeout(() => socket.close(), 30_000); };
    watchdog();
    socket.onopen = () => { if (this.recording === r && r.socket === socket) socket.send(JSON.stringify({ type: "start", version: 1, recordingId: id,
      sessionId: r.sessionId, attachmentId: r.attachmentId, ...audioFormat }));
    };
    socket.onmessage = ({ data }) => {
      if (this.recording !== r || r.socket !== socket) return;
      try {
        if (typeof data !== "string" || data.length > 128_000) throw new Error("Invalid dictation response");
        const event = JSON.parse(data);
        if (!events.accept(event)) throw new Error("Invalid dictation event order");
        watchdog();
        if (event.type === "ready") {
          r.ready = true;
          r.attempts = 0;
          if (!r.stopping && r.capturing) { r.phase = "recording"; this.view.state("recording"); }
          this.pump(r);
        }
        if (event.type === "ack") {
          if (typeof event.bytes !== "number" || event.bytes <= r.acknowledged || event.bytes > r.sent) throw new Error("Invalid audio acknowledgment");
          r.acknowledged = event.bytes;
          this.pump(r);
        }
        if (event.type === "partial" || event.type === "final") {
          if (!this.connection.attachment) { socket.close(); return; }
          const delta = r.transcript.accept(event.text!, event.type === "final");
          this.view.preview(r.transcript.diverged ? `Transcript revised · automatic insertion stopped. ${r.transcript.preview}` : r.transcript.preview);
          if (delta) { this.view.clearControl(); this.view.paste(delta); }
        }
        if (event.type === "error") {
          if (["invalid_input", "attachment_lost", "protocol_error", "invalid_start", "invalid_audio", "invalid_state", "duration_limit"].includes(event.code ?? "")) throw new Error(event.message);
          socket.close();
        }
        if (event.type === "done") {
          if (this.connection.attachment) {
            const submit = r.transcript.diverged ? undefined : r.submit;
            this.cleanup(r, "idle");
            if (r.submit && !submit) this.view.notice("Transcript revised · review it before sending");
            submit?.();
          }
          else socket.close();
        }
      } catch (error) { this.error(error); }
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      clearTimeout(timeout);
      if (this.recording !== r || r.socket !== socket) return;
      r.socket = undefined;
      r.ready = false;
      r.transcript.replay();
      this.wait(r);
    };
  }

  private pump(r: Recording) {
    const socket = r.socket;
    if (!r.ready || !socket || socket.readyState !== WebSocket.OPEN) return;
    // Frames are retained even after ack: a fresh service decoder needs the whole
    // recording after a broken connection. Acks are after inference, not WS send.
    let offset = 0;
    for (const chunk of r.chunks) {
      if (offset === r.sent && r.sent - r.acknowledged + chunk.byteLength <= inFlightBytes
        && socket.bufferedAmount + chunk.byteLength <= dictationLimits.queueBytes) {
        socket.send(chunk);
        r.sent += chunk.byteLength;
      }
      offset += chunk.byteLength;
      if (offset > r.sent) break;
    }
    if (r.drained && !r.stopSent && r.sent === r.bytes && r.acknowledged === r.bytes) {
      r.stopSent = true;
      socket.send(JSON.stringify({ type: "stop", recordingId: r.id }));
    }
  }

  private wait(r: Recording) {
    if (this.recording !== r) return;
    r.phase = r.stopping ? "finishing" : r.capturing ? "waiting" : "loading";
    this.view.state(r.phase);
    clearTimeout(r.retry);
    r.retry = setTimeout(() => {
      if (this.connection.terminalStopped) { this.cancel("Dictation stopped · terminal detached"); return; }
      this.connect(r);
      if (!r.socket) this.wait(r);
    }, Math.min(5_000, 250 * 2 ** Math.min(r.attempts++, 5)));
  }

  private stop(r: Recording) {
    if (!r.node) { this.cancel(); return; }
    r.stopping = true;
    r.phase = "finishing";
    this.view.state("finishing");
    this.deadline(r, 300_000, "Final transcription timed out");
    r.node?.port.postMessage("stop");
  }
  private deadline(r: Recording, ms: number, message: string) {
    clearTimeout(r.timer);
    r.timer = setTimeout(() => {
      if (this.recording !== r) return;
      if (!r.stopping && r.node) { this.view.notice(message); this.stop(r); }
      else this.error(new Error(message));
    }, ms);
  }
  private releaseAudio(r: Recording) {
    r.stream?.getTracks().forEach(track => track.stop());
    r.source?.disconnect();
    r.node?.disconnect();
    r.node?.port.close();
    r.context.onstatechange = null;
    void r.context.close().catch(() => {});
  }
  private cleanup(r: Recording, state: DictationState) {
    this.recording = undefined;
    clearTimeout(r.timer);
    clearTimeout(r.retry);
    r.socket?.close();
    this.releaseAudio(r);
    if (state === "error") this.discardWarm();
    this.view.state(state);
    if (state !== "unavailable") this.prepare();
  }
  private error(error: unknown) {
    const message = error instanceof Error ? error.message : "Dictation failed";
    if (this.recording) this.cleanup(this.recording, "error");
    else this.view.state("error");
    this.view.notice(message);
  }
  cancel(message?: string) {
    const r = this.recording;
    if (!r) { this.discardWarm(); return; }
    this.cleanup(r, "idle");
    this.discardWarm();
    if (!r.transcript.diverged) this.view.preview("");
    if (message) this.view.notice(message);
  }
}
