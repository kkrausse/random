import type { TerminalConnection } from "./connection";
import { audioFormat, DictationEvents, dictationLimits } from "./dictation-protocol";
import { TranscriptPipeline } from "./transcript";

export type DictationState = "idle" | "loading" | "recording" | "finishing" | "error" | "unavailable";
type View = {
  state(state: DictationState): void;
  preview(text: string): void;
  notice(text: string): void;
  clearControl(): void;
  paste(text: string): void;
};
type Recording = {
  id: string; attachmentId: string; phase: DictationState;
  context: AudioContext; stream?: MediaStream; node?: AudioWorkletNode; source?: MediaStreamAudioSourceNode;
  socket?: WebSocket; timer?: ReturnType<typeof setTimeout>; transcript: TranscriptPipeline;
  ready?: () => void; reject?: (error: Error) => void;
};

export class DictationController {
  private recording?: Recording;
  constructor(private connection: TerminalConnection, private view: View) {
    view.state("idle");
    connection.onAttachmentChange(() => {
      if (this.recording && !this.attached(this.recording)) this.cancel("Dictation stopped · terminal attachment lost");
    });
    document.addEventListener("visibilitychange", () => { if (document.hidden) this.cancel(); });
    window.addEventListener("pagehide", () => this.cancel());
    if (!isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) {
      view.state("unavailable");
    }
  }

  toggle() {
    const active = this.recording;
    if (active) {
      if (active.phase === "recording") this.stop(active);
      else if (active.phase === "loading") this.cancel();
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
      // Both resume and permission request originate in the tap, without textarea focus.
      const context = new AudioContext();
      const recording: Recording = { id: crypto.randomUUID(), attachmentId: attachment.attachmentId,
        phase: "loading", context, transcript: new TranscriptPipeline() };
      this.recording = recording;
      this.view.state("loading");
      this.deadline(recording, 120_000, "Microphone or model loading timed out");
      const resumed = context.resume();
      const permission = navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      void this.start(recording, attachment.sessionId, resumed, permission);
    } catch (error) { this.error(error); }
  }

  private async start(r: Recording, sessionId: string, resumed: Promise<void>, permission: Promise<MediaStream>) {
    try {
      // Install cleanup before awaiting: permission may resolve after cancel/navigation.
      const microphone = permission.then(stream => {
        if (this.recording !== r) { stream.getTracks().forEach(track => track.stop()); throw new Error("Recording canceled"); }
        r.stream = stream;
        stream.getTracks().forEach(track => track.addEventListener("ended", () => { if (this.recording === r) this.cancel("Microphone disconnected"); }));
      });
      const ready = new Promise<void>((resolve, reject) => { r.ready = resolve; r.reject = reject; });
      const socket = r.socket = new WebSocket(`${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/dictation/stream`);
      const events = new DictationEvents(r.id);
      socket.onopen = () => {
        if (this.recording === r) socket.send(JSON.stringify({ type: "start", version: 1, recordingId: r.id, sessionId, attachmentId: r.attachmentId, ...audioFormat }));
      };
      socket.onmessage = ({ data }) => {
        if (this.recording !== r) return;
        try {
          if (typeof data !== "string" || data.length > 128_000) throw new Error("Invalid dictation response");
          const event = JSON.parse(data);
          if (!events.accept(event)) throw new Error("Invalid dictation event order");
          if (event.type === "ready") r.ready?.();
          if (event.type === "partial" || event.type === "final") {
            const delta = r.transcript.accept(event.text!, event.type === "final");
            this.view.preview(r.transcript.diverged ? `Transcript revised · automatic insertion stopped. ${r.transcript.preview}` : r.transcript.preview);
            if (!this.attached(r)) throw new Error("Terminal attachment lost");
            if (delta) { this.view.clearControl(); this.view.paste(delta); }
          }
          if (event.type === "error") throw new Error(event.message);
          if (event.type === "done") this.cleanup(r, "idle");
        } catch (error) { this.error(error); }
      };
      socket.onerror = () => { if (this.recording === r) this.error(new Error("Dictation connection failed")); };
      socket.onclose = () => { if (this.recording === r) this.error(new Error("Dictation disconnected")); };
      await Promise.all([resumed, microphone, r.context.audioWorklet.addModule("/audio-worklet.js"), ready]);
      if (this.recording !== r) return;
      if (!this.attached(r)) throw new Error("Terminal attachment lost");
      const node = r.node = new AudioWorkletNode(r.context, "dictation", { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      node.onprocessorerror = () => { if (this.recording === r) this.error(new Error("Microphone processor failed")); };
      node.port.onmessage = ({ data }) => {
        if (this.recording !== r) return;
        try {
          if (data.type === "error") throw new Error(data.message);
          if (data.type === "audio") {
            if (!this.attached(r) || socket.readyState !== WebSocket.OPEN) throw new Error("Terminal or dictation disconnected");
            if (socket.bufferedAmount + data.bytes.byteLength > dictationLimits.queueBytes) throw new Error("Dictation audio queue overloaded");
            socket.send(data.bytes);
            node.port.postMessage("ack");
          }
          if (data.type === "drained" && r.phase === "finishing") {
            socket.send(JSON.stringify({ type: "stop", recordingId: r.id }));
            this.releaseAudio(r);
          }
        } catch (error) { this.error(error); }
      };
      r.source = r.context.createMediaStreamSource(r.stream!);
      r.source.connect(node);
      node.connect(r.context.destination);
      r.context.onstatechange = () => {
        if (this.recording === r && r.phase === "recording" && r.context.state !== "running") this.cancel("Dictation stopped · audio suspended");
      };
      r.phase = "recording";
      this.view.state("recording");
      this.deadline(r, 300_000, "Recording reached the five-minute limit");
    } catch (error) { if (this.recording === r) this.error(error); }
  }

  private attached(r: Recording) { return this.connection.attachment?.attachmentId === r.attachmentId; }
  private stop(r: Recording) {
    r.phase = "finishing";
    this.view.state("finishing");
    this.deadline(r, 30_000, "Final transcription timed out");
    // FIFO port messages drain FIR history and the final short packet before stop.
    r.node?.port.postMessage("stop");
  }
  private deadline(r: Recording, ms: number, message: string) {
    clearTimeout(r.timer);
    r.timer = setTimeout(() => { if (this.recording === r) this.error(new Error(message)); }, ms);
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
    r.reject?.(new Error("Recording ended"));
    r.socket?.close();
    this.releaseAudio(r);
    this.view.state(state);
  }
  private error(error: unknown) {
    const message = error instanceof Error ? error.message : "Dictation failed";
    if (this.recording) this.cleanup(this.recording, "error");
    else this.view.state("error");
    this.view.notice(message);
  }
  cancel(message?: string) {
    const r = this.recording;
    if (!r) return;
    if (r.socket?.readyState === WebSocket.OPEN) r.socket.send(JSON.stringify({ type: "cancel", recordingId: r.id }));
    this.cleanup(r, "idle");
    if (!r.transcript.diverged) this.view.preview("");
    if (message) this.view.notice(message);
  }
}
