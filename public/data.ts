import { BASE_BANDS } from "./defaults";

export {
  BASE_BANDS,
  CANDIDATE_BPH,
  DEFAULT_BIN_COUNT,
  DEFAULT_FEATURE_CAP,
  DEFAULT_FEATURE_LOG_GAIN,
  DEFAULT_FEATURE_POST_FRAME_COUNT,
  DEFAULT_FEATURE_RATE,
  DEFAULT_ANALYSIS_INTERVAL_MS,
  DEFAULT_PERIOD_SECONDS,
  DEFAULT_TRACKING_FOLD_BIN_COUNT,
  MAX_PERIOD_SECONDS,
  MIN_PERIOD_SECONDS,
} from "./defaults";

export type Band = {
  name: string;
  low: number;
  high: number;
};

export type Feature = {
  name: string;
  data: Float32Array;
};

export type FeatureMessage = {
  type: "features";
  startFrame: number;
  startRawFrame?: number;
  rawFrame: number;
  sampleRate?: number;
  featureRate: number;
  features: Feature[];
};

export type ReadyMessage = {
  type: "ready";
  sampleRate: number;
  featureRate: number;
  bands: string[];
};

export type ConfigureAnalysisMessage = {
  type: "configure";
  periodSeconds: number;
  binCount: number;
};

export type ConfigureWorkletMessage = {
  type: "configure";
  featureCap: number;
};

export type FoldRow = {
  bph: number;
  band: string;
  bins: Float32Array;
};

export type StandardFolds = {
  binCount: number;
  cycleBeats: number;
  rows: FoldRow[];
};

export type Tracking = {
  standardBph: number | null;
  measuredBph: number | null;
  confidenceBph: number | null;
  candidates: TrackingCandidate[];
};

export type TrackingCandidate = {
  bph: number;
  score: number;
};

export type TrackingFold = {
  bph: number;
  binCount: number;
  cycleBeats: number;
  bins: Float32Array;
  score?: number;
};

export type TrackingBandFold = TrackingFold & {
  band: string;
};

export type TickTockPeakSample = {
  name: string;
  estimateOffsetSeconds?: number;
  points: number[];
};

export type AnalysisMessage = {
  type: "analysis";
  periodSeconds: number;
  featureRate: number;
  analysisMs: number;
  framesBuffered: number;
  standardFolds: StandardFolds;
  tracking: Tracking;
  trackingFold: TrackingFold | null;
  trackingBandFolds: TrackingBandFold[];
  trackingCandidateFolds: TrackingFold[];
  tickTockPeakSamples: TickTockPeakSample[];
};

export type WorkletToMainMessage = ReadyMessage | FeatureMessage;
export type MainToWorkletMessage = ConfigureWorkletMessage;
export type MainToAnalysisWorkerMessage = ConfigureAnalysisMessage | FeatureMessage;
export type AnalysisWorkerToMainMessage = AnalysisMessage;

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const supportedBands = (sampleRate: number) => {
  const nyquist = sampleRate / 2;
  return BASE_BANDS.filter((band) => band.high < nyquist * 0.92);
};

export const mean = (values: ArrayLike<number>) => {
  if (!values.length) return 0;
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
};

export const normalizeRow = (row: Float32Array) => {
  const rowMean = mean(row);
  let variance = 0;

  for (let index = 0; index < row.length; index += 1) {
    const diff = row[index] - rowMean;
    variance += diff * diff;
  }

  const rowStd = Math.sqrt(variance / Math.max(1, row.length));
  const scale = Math.max(rowStd, 1e-6);
  const normalized = new Float32Array(row.length);

  for (let index = 0; index < row.length; index += 1) {
    normalized[index] = (row[index] - rowMean) / scale;
  }

  return normalized;
};
