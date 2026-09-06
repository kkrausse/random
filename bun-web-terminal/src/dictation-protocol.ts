export const audioFormat = { sampleRate: 16000, channels: 1, format: "f32le" } as const;
export const dictationLimits = { frameBytes: 6400, queueBytes: 128_000, seconds: 300 } as const;
export type DictationStart = typeof audioFormat & { type: "start"; version: 1; recordingId: string };
export type DictationEvent = {
  type: "loading" | "ready" | "partial" | "final" | "done" | "error";
  recordingId: string; sequence: number; text?: string; code?: string; message?: string;
};

export function validStart(value: any): value is DictationStart {
  return value?.type === "start" && value.version === 1 && typeof value.recordingId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value.recordingId)
    && value.sampleRate === 16000 && value.channels === 1 && value.format === "f32le";
}

export function validAudio(bytes: Uint8Array) {
  if (!bytes.byteLength || bytes.byteLength > dictationLimits.frameBytes || bytes.byteLength % 4) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let offset = 0; offset < bytes.byteLength; offset += 4) if (!Number.isFinite(view.getFloat32(offset, true))) return false;
  return true;
}

// Validate order at both boundaries, including no partials after a final.
export class DictationEvents {
  private sequence = -1;
  private phase: "loading" | "ready" | "final" | "done" = "loading";
  constructor(private id: string) {}
  accept(value: any): value is DictationEvent {
    if (value?.recordingId !== this.id || !Number.isSafeInteger(value.sequence) || value.sequence <= this.sequence || this.phase === "done") return false;
    switch (value.type) {
      case "loading": if (this.phase !== "loading") return false; break;
      case "ready": if (this.phase !== "loading") return false; this.phase = "ready"; break;
      case "partial": if (this.phase !== "ready" || typeof value.text !== "string") return false; break;
      case "final": if (this.phase !== "ready" || typeof value.text !== "string") return false; this.phase = "final"; break;
      case "done": if (this.phase !== "final") return false; this.phase = "done"; break;
      case "error": if (typeof value.code !== "string" || typeof value.message !== "string") return false; this.phase = "done"; break;
      default: return false;
    }
    this.sequence = value.sequence;
    return true;
  }
}
