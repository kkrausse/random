import {
  BASE_BANDS,
  DEFAULT_FEATURE_CAP,
  DEFAULT_FEATURE_LOG_GAIN,
  DEFAULT_FEATURE_POST_FRAME_COUNT,
  DEFAULT_FEATURE_RATE,
} from "./defaults";
import type { ConfigureWorkletMessage } from "./data";

declare const sampleRate: number;
declare function registerProcessor(
  name: string,
  processorCtor: { new (): AudioWorkletProcessor },
): void;

declare class AudioWorkletProcessor {
  readonly port: MessagePort;
}

type Band = (typeof BASE_BANDS)[number];

type BandpassFilter = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
  x1: number;
  x2: number;
  y1: number;
  y2: number;
};

const makeBandpass = (band: Band, rate: number): BandpassFilter => {
  const center = Math.sqrt(band.low * band.high);
  const q = center / (band.high - band.low);
  const omega = (2 * Math.PI * center) / rate;
  const alpha = Math.sin(omega) / (2 * q);
  const b0 = alpha;
  const b1 = 0;
  const b2 = -alpha;
  const a0 = 1 + alpha;
  const a1 = -2 * Math.cos(omega);
  const a2 = 1 - alpha;

  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
    x1: 0,
    x2: 0,
    y1: 0,
    y2: 0,
  };
};

const runFilter = (filter: BandpassFilter, sample: number) => {
  const output =
    filter.b0 * sample +
    filter.b1 * filter.x1 +
    filter.b2 * filter.x2 -
    filter.a1 * filter.y1 -
    filter.a2 * filter.y2;

  filter.x2 = filter.x1;
  filter.x1 = sample;
  filter.y2 = filter.y1;
  filter.y1 = output;

  return output;
};

class FeatureProcessor extends AudioWorkletProcessor {
  bands: Band[];
  filters: BandpassFilter[];
  fastAlpha: number;
  slowAlpha: number;
  fast: Float32Array;
  slow: Float32Array;
  current: Float32Array;
  batch: Float32Array[];
  featureRate: number;
  batchOffset = 0;
  rawFrame = 0;
  featureFrame = 0;
  featurePhase = 0;
  startFeatureFrame = 0;
  startRawFrame = 0;
  featureCap = DEFAULT_FEATURE_CAP;

  constructor() {
    super();
    const nyquist = sampleRate / 2;
    this.featureRate = Math.min(DEFAULT_FEATURE_RATE, sampleRate);
    this.bands = BASE_BANDS.filter((band) => band.high < nyquist * 0.92);
    this.filters = this.bands.map((band) => makeBandpass(band, sampleRate));
    this.fastAlpha = 1 - Math.exp(-1 / (sampleRate * 0.002));
    this.slowAlpha = 1 - Math.exp(-1 / (sampleRate * 0.08));
    this.fast = new Float32Array(this.bands.length);
    this.slow = new Float32Array(this.bands.length);
    this.current = new Float32Array(this.bands.length);
    this.batch = this.bands.map(() => new Float32Array(DEFAULT_FEATURE_POST_FRAME_COUNT));

    this.port.onmessage = (event: MessageEvent<ConfigureWorkletMessage>) => {
      const message = event.data;
      if (message.type !== "configure") return;

      const featureCap = Number(message.featureCap);
      if (Number.isFinite(featureCap) && featureCap > 0) {
        this.featureCap = featureCap;
      }
    };

    this.port.postMessage({
      type: "ready",
      sampleRate,
      featureRate: this.featureRate,
      bands: this.bands.map((band) => band.name),
    });
  }

  process(inputs: Float32Array[][]) {
    const input = inputs[0];
    if (!input || input.length === 0 || input[0].length === 0) {
      return true;
    }

    const channelCount = input.length;
    const frameCount = input[0].length;

    for (let frame = 0; frame < frameCount; frame += 1) {
      let mono = 0;
      for (let channel = 0; channel < channelCount; channel += 1) {
        mono += input[channel][frame] || 0;
      }
      mono /= channelCount;

      for (let bandIndex = 0; bandIndex < this.bands.length; bandIndex += 1) {
        const filtered = runFilter(this.filters[bandIndex], mono);
        const energy = Math.abs(filtered);
        this.fast[bandIndex] += this.fastAlpha * (energy - this.fast[bandIndex]);
        this.slow[bandIndex] += this.slowAlpha * (energy - this.slow[bandIndex]);
        const novelty = Math.max(0, this.fast[bandIndex] - this.slow[bandIndex]);
        this.current[bandIndex] = Math.max(this.current[bandIndex], novelty);
      }

      this.rawFrame += 1;
      this.featurePhase += this.featureRate / sampleRate;

      if (this.featurePhase >= 1) {
        this.featurePhase -= 1;
        this.writeFeatureFrame();
      }
    }

    return true;
  }

  writeFeatureFrame() {
    if (this.batchOffset === 0) {
      this.startFeatureFrame = this.featureFrame;
      this.startRawFrame = this.rawFrame;
    }

    for (let bandIndex = 0; bandIndex < this.bands.length; bandIndex += 1) {
      const compressed = Math.log1p(this.current[bandIndex] * DEFAULT_FEATURE_LOG_GAIN);
      this.batch[bandIndex][this.batchOffset] = Math.min(compressed, this.featureCap);
      this.current[bandIndex] = 0;
    }

    this.batchOffset += 1;
    this.featureFrame += 1;

    if (this.batchOffset >= DEFAULT_FEATURE_POST_FRAME_COUNT) {
      this.flush();
    }
  }

  flush() {
    const features = this.bands.map((band, index) => ({
      name: band.name,
      data: this.batch[index],
    }));

    this.port.postMessage(
      {
        type: "features",
        startFrame: this.startFeatureFrame,
        startRawFrame: this.startRawFrame,
        rawFrame: this.rawFrame,
        sampleRate,
        featureRate: this.featureRate,
        features,
      },
      features.map((feature) => feature.data.buffer),
    );

    this.batch = this.bands.map(() => new Float32Array(DEFAULT_FEATURE_POST_FRAME_COUNT));
    this.batchOffset = 0;
  }
}

registerProcessor("feature-processor", FeatureProcessor);
