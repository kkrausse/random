import {
  CANDIDATE_BPH,
  DEFAULT_BIN_COUNT,
  DEFAULT_FEATURE_RATE,
  DEFAULT_PERIOD_SECONDS,
  clamp,
  normalizeRow,
} from "./data";
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
  const folded = new Float32Array(state.binCount);
  const intervalSeconds = (3600 / bph) * state.cycleBeats;

  for (let index = 0; index < state.frames.length; index += 1) {
    const frame = state.frames[index];
    const seconds = frame.featureFrame / state.featureRate;
    const phase = (seconds % intervalSeconds) / intervalSeconds;
    const bin = Math.min(state.binCount - 1, Math.floor(phase * state.binCount));
    folded[bin] += frame.bands[bandIndex];
  }

  return normalizeRow(folded);
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

const maybePostAnalysis = () => {
  const now = Date.now();
  if (now - state.lastPostTime < 100 || state.frames.length < state.featureRate * 0.25) {
    return;
  }

  state.lastPostTime = now;
  const rows = buildStandardFoldRows();
  const transfers = rows.map((row) => row.bins.buffer);

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
      tracking: null,
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
