import {
  CANDIDATE_BPH,
  DEFAULT_BIN_COUNT,
  DEFAULT_FEATURE_RATE,
  DEFAULT_PERIOD_SECONDS,
  DEFAULT_TRACKING_FOLD_BIN_COUNT,
} from "./defaults";
import { clamp, normalizeRow } from "./data";
import { foldSignal } from "./util";
import { createBphTracker } from "./tracking-fold-fit";
import type {
  AnalysisWorkerToMainMessage,
  ConfigureAnalysisMessage,
  FeatureMessage,
  FoldRow,
  MainToAnalysisWorkerMessage,
} from "./data";

type Frame = {
  featureFrame: number;
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
  for (let offset = 0; offset < frameCount; offset += 1) {
    const bands = new Float32Array(state.bands.length);
    for (let bandIndex = 0; bandIndex < state.bands.length; bandIndex += 1) {
      bands[bandIndex] = message.features[bandIndex].data[offset];
    }
    state.frames.push({
      featureFrame: message.startFrame + offset,
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

const buildTrackingFold = (bph: number | null) => {
  if (!bph) return null;

  const binCount = DEFAULT_TRACKING_FOLD_BIN_COUNT;
  const bins = normalizeRow(
    foldSignal({
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
    }),
  );

  return {
    bph,
    binCount,
    cycleBeats: state.cycleBeats,
    bins,
  };
};

const maybePostAnalysis = () => {
  const now = Date.now();
  if (now - state.lastPostTime < 100 || state.frames.length < state.featureRate * 0.25) {
    return;
  }

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
  const trackingFold = buildTrackingFold(tracking.measuredBph);
  const transfers = rows.map((row) => row.bins.buffer);
  if (trackingFold) {
    transfers.push(trackingFold.bins.buffer);
  }

  workerSelf.postMessage(
    {
      type: "analysis",
      periodSeconds: state.periodSeconds,
      featureRate: state.featureRate,
      standardFolds: {
        binCount: state.binCount,
        cycleBeats: state.cycleBeats,
        rows,
      },
      tracking: {
        standardBph: tracking.standardBph,
        measuredBph: tracking.measuredBph,
        confidenceBph: tracking.confidenceBph,
      },
      trackingFold,
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
