import { describe, expect, test } from "bun:test";
import { AudioResampler } from "./audio-resampler";
import { DictationEvents, validAudio, validStart } from "./dictation-protocol";
import { TranscriptPipeline } from "./transcript";

describe("append-only terminal dictation", () => {
  test("whole words, Unicode spacing, final tail and duplicate final", () => {
    const pipeline = new TranscriptPipeline();
    expect(pipeline.accept("Hé")).toBe("");
    expect(pipeline.preview).toBe("Hé");
    expect(pipeline.accept("Héllo 世界  café")).toBe("Héllo 世界  ");
    expect(pipeline.accept("Héllo 世界  café!", true)).toBe("café!");
    expect(pipeline.accept("Héllo 世界  café!", true)).toBe("");
    expect(new TranscriptPipeline().accept("Hello", true)).toBe("Hello");
  });
  test("revision of even an unfinished prefix stops insertion and retains recovery text", () => {
    const pipeline = new TranscriptPipeline();
    expect(pipeline.accept("The cat")).toBe("The ");
    expect(pipeline.accept("The car moved ")).toBe("");
    expect(pipeline.accept("The car moved away.", true)).toBe("");
    expect(pipeline.diverged).toBe(true);
    expect(pipeline.preview).toBe("The car moved away.");
  });
  test("never inserts terminal controls or Enter", () => {
    const pipeline = new TranscriptPipeline();
    expect(pipeline.accept("one\n\ttwo\x1b\x00\u009b ")).toBe("one  two ");
    expect(pipeline.accept("one\n\ttwo\x1b\x00\u009b three\r\nfour", true)).toBe("three  four");
  });
});

describe("microphone resampling", () => {
  for (const rate of [16000, 44100, 48000]) test(`${rate} Hz block continuity and exact final drain`, () => {
    const samples = Float32Array.from({ length: rate }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / rate));
    const full = new AudioResampler(rate).push(samples, true);
    const streaming = new AudioResampler(rate);
    const chunks: number[] = [];
    for (let i = 0; i < samples.length; i += 128) chunks.push(...streaming.push(samples.slice(i, i + 128)));
    chunks.push(...streaming.push(new Float32Array(), true));
    expect(chunks.length).toBe(16000);
    expect(chunks).toEqual(Array.from(full));
    expect(streaming.push(samples, true).length).toBe(0);
  });
  test("anti-alias filter suppresses frequencies above 8 kHz", () => {
    const rms = (hz: number) => {
      const samples = Float32Array.from({ length: 48000 }, (_, i) => Math.sin(2 * Math.PI * hz * i / 48000));
      const output = new AudioResampler(48000).push(samples, true).slice(100, -100);
      return Math.sqrt(output.reduce((sum, sample) => sum + sample * sample, 0) / output.length);
    };
    expect(rms(1000)).toBeGreaterThan(0.65);
    expect(rms(12000)).toBeLessThan(0.01);
  });
});

describe("dictation protocol", () => {
  test("ordered cumulative events reject stale IDs, duplicates and post-final partials", () => {
    const events = new DictationEvents("recording");
    const event = (type: string, sequence: number, recordingId = "recording") => ({ type, sequence, recordingId, text: "hello" });
    expect(events.accept(event("partial", 0))).toBe(false);
    expect(events.accept(event("loading", 0))).toBe(true);
    expect(events.accept(event("ready", 1, "old"))).toBe(false);
    expect(events.accept(event("ready", 1))).toBe(true);
    expect(events.accept(event("partial", 2))).toBe(true);
    expect(events.accept(event("partial", 2))).toBe(false);
    expect(events.accept(event("final", 3))).toBe(true);
    expect(events.accept(event("partial", 4))).toBe(false);
    expect(events.accept(event("final", 4))).toBe(false);
    expect(events.accept(event("done", 4))).toBe(true);
  });
  test("validates audio bytes and declared format", () => {
    const start = { type: "start", version: 1, recordingId: crypto.randomUUID(), sampleRate: 16000, channels: 1, format: "f32le" };
    expect(validStart(start)).toBe(true);
    expect(validStart({ ...start, sampleRate: 48000 })).toBe(false);
    expect(validAudio(new Uint8Array(6400))).toBe(true);
    for (const data of [new Uint8Array(), new Uint8Array(3), new Uint8Array(6404), new Uint8Array([0, 0, 128, 127]), new Uint8Array([0, 0, 192, 127])]) expect(validAudio(data)).toBe(false);
  });
});
