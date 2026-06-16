import {
  CANDIDATE_BPH,
  DEFAULT_ANALYSIS_INTERVAL_MS,
  DEFAULT_BIN_COUNT,
  DEFAULT_FEATURE_RATE,
  DEFAULT_PERIOD_SECONDS,
  DEFAULT_TRACKING_FOLD_BIN_COUNT,
} from "./defaults";
import { clamp, normalizeRow } from "./data";
import { foldSignal } from "./util";
import { createBphTracker } from "./tracking-beat-fit";
import type {
  AnalysisWorkerToMainMessage,
  ConfigureAnalysisMessage,
  FeatureMessage,
  FoldRow,
  MainToAnalysisWorkerMessage,
  TickTockPeakSample,
  TrackingBandFold,
} from "./data";

type Frame = {
  featureFrame: number;
  seconds?: number;
  bands: Float32Array;
};

type WorkerScope = {
  postMessage(message: AnalysisWorkerToMainMessage, transfer: Transferable[]): void;
  onmessage: ((event: MessageEvent<MainToAnalysisWorkerMessage>) => void) | null;
};

const workerSelf = self as unknown as WorkerScope;

const state = {
  periodSeconds: DEFAULT_PERIOD_SECONDS,
  featureRate: DEFAULT_FEATURE_RATE,
  binCount: DEFAULT_BIN_COUNT,
  cycleBeats: 2,
  bands: [] as string[],
  frames: [] as Frame[],
  nextStartFrame: 0,
  lastPostTime: 0,
  tracker: createBphTracker(),
};

const configure = (message: ConfigureAnalysisMessage) => {
  state.periodSeconds = clamp(Number(message.periodSeconds) || DEFAULT_PERIOD_SECONDS, 2, 30);
  state.binCount = Number(message.binCount) || DEFAULT_BIN_COUNT;
  trimFrames();
};

const ensureBandBuffers = (features: FeatureMessage["features"]) => {
  const names = features.map((feature) => feature.name);
  const changed =
    names.length !== state.bands.length ||
    names.some((name, index) => name !== state.bands[index]);

  if (changed) {
    state.bands = names;
    state.frames = [];
    state.nextStartFrame = 0;
    state.tracker = createBphTracker();
  }
};

const trimFrames = () => {
  const framesToKeep = Math.ceil(state.periodSeconds * state.featureRate);
  if (state.frames.length > framesToKeep) {
    state.frames.splice(0, state.frames.length - framesToKeep);
  }
};

const receiveFeatures = (message: FeatureMessage) => {
  state.featureRate = Number(message.featureRate) || state.featureRate;
  ensureBandBuffers(message.features);

  const frameCount = message.features[0]?.data?.length || 0;
  const sampleRate = Number(message.sampleRate) || 0;
  for (let offset = 0; offset < frameCount; offset += 1) {
    const featureFrame = message.startFrame + offset;
    const bands = new Float32Array(state.bands.length);
    for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
      bands[bandIndex] = message.features[bandIndex].data[offset];
    }
    state.frames.push({
      featureFrame,
      seconds:
        sampleRate > 0
          ? Math.ceil(((featureFrame + 1) * sampleRate) / state.featureRate) / sampleRate
          : undefined,
      bands,
    });
  }

  trimFrames();
  maybePostAnalysis();
};

const foldStandardCandidate = (bph: number, bandIndex: number) => {
  return normalizeRow(
    foldSignal({
      frames: state.frames,
      featureRate: state.featureRate,
      bph,
      cycleBeats: state.cycleBeats,
      binCount: state.binCount,
      valueAt: (frame) => frame.bands[bandIndex],
    }),
  );
};

const buildStandardFoldRows = () => {
  const rows: FoldRow[] = [];

  for (let bphIndex = 0; bphIndex < CANDIDATE_BPH.length; bphIndex += 1) {
    const bph = CANDIDATE_BPH[bphIndex];
    for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
      const bins = foldStandardCandidate(bph, bandIndex);
      const row = {
        bph,
        band: state.bands[bandIndex],
        bins,
      };

      rows.push(row);
    }
  }

  return rows;
};

const buildTrackingFold = (bph: number | null, score?: number) => {
  if (!bph) return null;

  const binCount = DEFAULT_TRACKING_FOLD_BIN_COUNT;
  const bins = foldSignal({
    frames: state.frames,
    featureRate: state.featureRate,
    bph,
    cycleBeats: state.cycleBeats,
    binCount,
    averageByBin: true,
    valueAt: (frame) => {
      let total = 0;
      for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
        total += frame.bands[bandIndex];
      }
      return total;
    },
  });

  return {
    bph,
    binCount,
    cycleBeats: state.cycleBeats,
    bins,
    score,
  };
};

const buildTrackingBandFolds = (bph: number | null) => {
  if (!bph) return [];

  const binCount = DEFAULT_TRACKING_FOLD_BIN_COUNT;
  const rows: TrackingBandFold[] = [];

  for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
    const bins = foldSignal({
      frames: state.frames,
      featureRate: state.featureRate,
      bph,
      cycleBeats: state.cycleBeats,
      binCount,
      averageByBin: true,
      valueAt: (frame) => frame.bands[bandIndex],
    });

    rows.push({
      bph,
      binCount,
      cycleBeats: state.cycleBeats,
      band: state.bands[bandIndex],
      bins,
    });
  }

  return rows;
};

const buildTrackingCandidateFolds = (tracking: ReturnType<typeof state.tracker.trackStep>) => {
  return tracking.candidates
    .map((candidate) => buildTrackingFold(candidate.bph, candidate.score))
    .filter((fold) => fold !== null);
};

const frameSeconds = (frame: Frame) => frame.seconds ?? frame.featureFrame / state.featureRate;

const frameEnergy = (frame: Frame) => {
  let total = 0;
  for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
    total += frame.bands[bandIndex];
  }
  return total;
};

const findPeakBin = (bins: Float32Array, start: number, count: number) => {
  let peakBin = start;
  let peakValue = bins[start] ?? 0;

  for (let offset = 1; offset < count; offset += 1) {
    const bin = start + offset;
    if (bins[bin] > peakValue) {
      peakBin = bin;
      peakValue = bins[bin];
    }
  }

  return peakBin;
};

const buildPeakSample = (
  name: string,
  peakTime: number,
  windowSeconds: number,
  sign: 1 | -1,
) => {
  const points: number[] = [];
  const frameStep = Math.max(1, Math.ceil(windowSeconds * 2 * state.featureRate / 160));

  for (let index = 0; index < state.frames.length; index += 1) {
    const frame = state.frames[index];
    const seconds = frameSeconds(frame);
    if (seconds < peakTime - windowSeconds) continue;
    if (seconds > peakTime + windowSeconds) break;
    if (points.length && index % frameStep !== 0) continue;

    points.push(
      Number((seconds - peakTime).toFixed(5)),
      Number((frameEnergy(frame) * sign).toFixed(4)),
    );
  }

  return points.length ? { name, points } : null;
};

const buildTickTockPeakSamples = (fold: NonNullable<ReturnType<typeof buildTrackingFold>>) => {
  if (fold.cycleBeats < 2 || state.frames.length === 0) return [];

  const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;
  const beatBinCount = Math.floor(fold.binCount / fold.cycleBeats);
  const binSeconds = cycleSeconds / fold.binCount;
  const windowSeconds = Math.max(0.002, beatBinCount * 0.12 * binSeconds);
  const tickPeakBin = findPeakBin(fold.bins, 0, beatBinCount);
  const tockPeakBin = findPeakBin(fold.bins, beatBinCount, beatBinCount);
  const firstSeconds = frameSeconds(state.frames[0]);
  const lastSeconds = frameSeconds(state.frames[state.frames.length - 1]);
  const firstCycle = Math.floor(firstSeconds / cycleSeconds) - 1;
  const lastCycle = Math.ceil(lastSeconds / cycleSeconds) + 1;
  const samples: TickTockPeakSample[] = [];
  const peakTimes: { name: string; time: number; sign: 1 | -1 }[] = [];

  for (let cycle = firstCycle; cycle <= lastCycle; cycle += 1) {
    peakTimes.push({
      name: "tick sample",
      time: cycle * cycleSeconds + (tickPeakBin / fold.binCount) * cycleSeconds,
      sign: 1,
    });
    peakTimes.push({
      name: "tock sample",
      time: cycle * cycleSeconds + (tockPeakBin / fold.binCount) * cycleSeconds,
      sign: -1,
    });
  }

  const visiblePeakTimes = peakTimes
    .filter(
      (peak) =>
        peak.time >= firstSeconds + windowSeconds &&
        peak.time <= lastSeconds - windowSeconds,
    )
    .slice(-16);

  for (let index = 0; index < visiblePeakTimes.length; index += 1) {
    const peak = visiblePeakTimes[index];
    const sample = buildPeakSample(
      `${peak.name} ${index + 1}`,
      peak.time,
      windowSeconds,
      peak.sign,
    );
    if (sample) samples.push(sample);
  }

  return samples;
};

const maybePostAnalysis = () => {
  const now = Date.now();
  if (
    now - state.lastPostTime < DEFAULT_ANALYSIS_INTERVAL_MS ||
    state.frames.length < state.featureRate * 0.25
  ) {
    return;
  }

  const startedAt = performance.now();
  state.lastPostTime = now;
  const rows = buildStandardFoldRows();
  const tracking = state.tracker.trackStep(
    {
      featureRate: state.featureRate,
      cycleBeats: state.cycleBeats,
      bands: state.bands,
      frames: state.frames,
    },
    rows,
  );
  const trackingFold = buildTrackingFold(tracking.standardBph);
  const trackingBandFolds = buildTrackingBandFolds(tracking.standardBph);
  const trackingCandidateFolds = buildTrackingCandidateFolds(tracking);
  const tickTockPeakSamples = trackingFold ? buildTickTockPeakSamples(trackingFold) : [];
  const transfers = rows.map((row) => row.bins.buffer);
  if (trackingFold) {
    transfers.push(trackingFold.bins.buffer);
  }
  for (let index = 0; index < trackingBandFolds.length; index += 1) {
    transfers.push(trackingBandFolds[index].bins.buffer);
  }
  for (let index = 0; index < trackingCandidateFolds.length; index += 1) {
    transfers.push(trackingCandidateFolds[index].bins.buffer);
  }
  const analysisMs = performance.now() - startedAt;

  workerSelf.postMessage(
    {
      type: "analysis",
      periodSeconds: state.periodSeconds,
      featureRate: state.featureRate,
      analysisMs: Number(analysisMs.toFixed(1)),
      framesBuffered: state.frames.length,
      standardFolds: {
        binCount: state.binCount,
        cycleBeats: state.cycleBeats,
        rows,
      },
      tracking: {
        standardBph: tracking.standardBph,
        measuredBph: tracking.measuredBph,
        confidenceBph: tracking.confidenceBph,
        candidates: tracking.candidates,
      },
      trackingFold,
      trackingBandFolds,
      trackingCandidateFolds,
      tickTockPeakSamples,
    },
    transfers,
  );
};

workerSelf.onmessage = (event) => {
  const message = event.data;
  if (message.type === "configure") {
    configure(message);
  }
  if (message.type === "features") {
    receiveFeatures(message);
  }
};
