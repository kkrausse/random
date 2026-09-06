import { AudioResampler } from "./audio-resampler";

declare const sampleRate: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class DictationProcessor extends AudioWorkletProcessor {
  private resampler = new AudioResampler(sampleRate);
  private pending: number[] = [];
  private outstanding = 0;
  private stopped = false;
  constructor() {
    super();
    this.port.onmessage = ({ data }) => {
      if (data === "ack") this.outstanding = Math.max(0, this.outstanding - 1);
      if (data === "stop" && !this.stopped) {
        this.emit(this.resampler.push(new Float32Array(), true), true);
        this.stopped = true;
        this.port.postMessage({ type: "drained" });
      }
    };
  }
  private emit(samples: Float32Array, final = false) {
    for (const sample of samples) this.pending.push(sample);
    while (this.pending.length >= 1280 || (final && this.pending.length)) {
      if (this.outstanding >= 25) {
        this.stopped = true;
        this.port.postMessage({ type: "error", message: "Microphone audio queue overloaded" });
        return;
      }
      const chunk = this.pending.splice(0, 1280);
      const bytes = new ArrayBuffer(chunk.length * 4);
      const view = new DataView(bytes);
      chunk.forEach((sample, index) => view.setFloat32(index * 4, sample, true));
      this.outstanding++;
      this.port.postMessage({ type: "audio", bytes }, [bytes]);
    }
  }
  process(inputs: Float32Array[][]) {
    if (this.stopped) return false;
    const channels = inputs[0];
    if (channels?.[0]) {
      const mono = new Float32Array(channels[0].length);
      for (const channel of channels) for (let i = 0; i < mono.length; i++) mono[i] = mono[i]! + channel[i]! / channels.length;
      this.emit(this.resampler.push(mono));
    }
    // Outputs stay zero: keep processing through destination without mic feedback.
    return !this.stopped;
  }
}
registerProcessor("dictation", DictationProcessor);
