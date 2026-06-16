import {
  DEFAULT_BIN_COUNT,
  DEFAULT_PERIOD_SECONDS,
  MAX_PERIOD_SECONDS,
  MIN_PERIOD_SECONDS,
} from "./defaults";
import type {
  AnalysisWorkerToMainMessage,
  ConfigureAnalysisMessage,
  WorkletToMainMessage,
} from "./data";
import {
  createFeatureChart,
  createHeatmap,
  createTickTockPeakChart,
  createTrackingBandFoldChart,
} from "./graph";

type AppState = {
  audioContext: AudioContext | null;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  sink: GainNode | null;
  worker: Worker | null;
  tickTockPeakGraph: ReturnType<typeof createTickTockPeakChart>;
  trackingBandFoldGraph: ReturnType<typeof createTrackingBandFoldChart>;
  graph: ReturnType<typeof createHeatmap>;
  featureGraph: ReturnType<typeof createFeatureChart>;
  running: boolean;
  captureReady: CaptureReady | null;
  captureBatches: CaptureBatch[];
};

type CaptureReady = {
  sampleRate: number;
  featureRate: number;
  bands: string[];
};

type CaptureBatch = {
  startFrame: number;
  startRawFrame?: number;
  rawFrame: number;
  sampleRate?: number;
  featureRate: number;
  features: {
    name: string;
    data: number[];
  }[];
};

const CAPTURE_WINDOW_SECONDS = 20;

const query = <T extends HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing element: ${selector}`);
  }
  return element;
};

const elements = {
  toggle: query<HTMLButtonElement>("#toggle"),
  captureToggle: query<HTMLButtonElement>("#capture-toggle"),
  period: query<HTMLInputElement>("#period"),
  periodValue: query<HTMLOutputElement>("#period-value"),
  featureRate: query<HTMLElement>("#feature-rate"),
  sampleRate: query<HTMLElement>("#sample-rate"),
  bands: query<HTMLElement>("#bands"),
  standardBph: query<HTMLElement>("#standard-bph"),
  measuredBph: query<HTMLElement>("#measured-bph"),
  secondsPerDay: query<HTMLElement>("#seconds-per-day"),
  errorSecondsPerDay: query<HTMLElement>("#error-seconds-per-day"),
  analysisMs: query<HTMLElement>("#analysis-ms"),
  framesBuffered: query<HTMLElement>("#frames-buffered"),
  status: query<HTMLElement>("#status"),
  tickTockPeakChart: query<HTMLElement>("#tick-tock-peak-chart"),
  trackingBandFoldChart: query<HTMLElement>("#tracking-band-fold-chart"),
  foldChart: query<HTMLElement>("#fold-chart"),
  featureChart: query<HTMLElement>("#feature-chart"),
};

const setDefaultPeriod = () => {
  elements.period.min = String(MIN_PERIOD_SECONDS);
  elements.period.max = String(MAX_PERIOD_SECONDS);
  elements.period.value = String(DEFAULT_PERIOD_SECONDS);
  elements.periodValue.textContent = `${DEFAULT_PERIOD_SECONDS}s`;
};

setDefaultPeriod();

const app: AppState = {
  audioContext: null,
  stream: null,
  source: null,
  worklet: null,
  sink: null,
  worker: null,
  tickTockPeakGraph: createTickTockPeakChart(elements.tickTockPeakChart),
  trackingBandFoldGraph: createTrackingBandFoldChart(elements.trackingBandFoldChart),
  graph: createHeatmap(elements.foldChart),
  featureGraph: createFeatureChart(elements.featureChart),
  running: false,
  captureReady: null,
  captureBatches: [],
};

const setStatus = (text: string) => {
  elements.status.textContent = text;
};

const setRunning = (running: boolean) => {
  app.running = running;
  elements.toggle.dataset.running = String(running);
  elements.toggle.textContent = running ? "Stop microphone" : "Start microphone";
};

const captureFeatureMessage = (message: WorkletToMainMessage) => {
  if (message.type !== "features") return;

  app.captureBatches.push({
    startFrame: message.startFrame,
    startRawFrame: message.startRawFrame,
    rawFrame: message.rawFrame,
    sampleRate: message.sampleRate,
    featureRate: message.featureRate,
    features: message.features.map((feature) => ({
      name: feature.name,
      data: Array.from(feature.data),
    })),
  });
  trimCaptureBatches();
};

const captureBatchEndFrame = (batch: CaptureBatch) =>
  batch.startFrame + (batch.features[0]?.data.length || 0);

const trimCaptureBatches = () => {
  const lastBatch = app.captureBatches[app.captureBatches.length - 1];
  if (!lastBatch) return;

  const latestSeconds = captureBatchEndFrame(lastBatch) / lastBatch.featureRate;
  const cutoffSeconds = latestSeconds - CAPTURE_WINDOW_SECONDS;

  while (app.captureBatches.length > 1) {
    const firstBatch = app.captureBatches[0];
    const firstEndSeconds = captureBatchEndFrame(firstBatch) / firstBatch.featureRate;
    if (firstEndSeconds >= cutoffSeconds) break;
    app.captureBatches.shift();
  }
};

const getPeriodSeconds = () => Number(elements.period.value) || DEFAULT_PERIOD_SECONDS;

const updatePeriodDisplay = () => {
  elements.periodValue.textContent = `${getPeriodSeconds()}s`;
};

const makeCaptureJson = () => {
  return JSON.stringify(
    {
      version: 1,
      createdAt: new Date().toISOString(),
      windowSeconds: CAPTURE_WINDOW_SECONDS,
      periodSeconds: getPeriodSeconds(),
      ready: app.captureReady,
      batches: app.captureBatches,
    },
    null,
    2,
  );
};

const copyCapture = async () => {
  if (app.captureBatches.length === 0) {
    setStatus("No capture data yet.");
    return;
  }

  const json = makeCaptureJson();

  try {
    await navigator.clipboard.writeText(json);
    setStatus(`Copied last ${CAPTURE_WINDOW_SECONDS}s capture.`);
  } catch {
    setStatus("Could not copy capture.");
  }
};

const formatBph = (value: number | null) => {
  if (value === null) return "-";
  return value.toFixed(1);
};

const formatSigned = (value: number | null) => {
  if (value === null) return "-";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(1)}`;
};

const formatRange = (value: number | null) => {
  if (value === null) return "-";
  return `±${value.toFixed(1)}`;
};

const bphErrorToSecondsPerDay = (errorBph: number | null, standardBph: number | null) => {
  if (errorBph === null || standardBph === null) return null;
  return (errorBph / standardBph) * 86400;
};

const resetTrackingDisplay = () => {
  elements.standardBph.textContent = "-";
  elements.measuredBph.textContent = "-";
  elements.secondsPerDay.textContent = "-";
  elements.errorSecondsPerDay.textContent = "-";
  elements.sampleRate.textContent = "-";
  elements.analysisMs.textContent = "-";
  elements.framesBuffered.textContent = "-";
};

const updateTrackingDisplay = (message: AnalysisWorkerToMainMessage) => {
  const tracking = message.tracking;
  const secondsPerDay =
    tracking.standardBph && tracking.measuredBph
      ? (tracking.measuredBph / tracking.standardBph - 1) * 86400
      : null;
  const errorSecondsPerDay = bphErrorToSecondsPerDay(
    tracking.confidenceBph,
    tracking.standardBph,
  );

  elements.standardBph.textContent =
    tracking.standardBph === null ? "-" : String(Math.round(tracking.standardBph));
  elements.measuredBph.textContent = formatBph(tracking.measuredBph);
  elements.secondsPerDay.textContent = formatSigned(secondsPerDay);
  elements.errorSecondsPerDay.textContent = formatRange(errorSecondsPerDay);
  elements.analysisMs.textContent = `${message.analysisMs.toFixed(1)} ms`;
  elements.framesBuffered.textContent = `${(message.framesBuffered / message.featureRate).toFixed(1)}s`;
};

const configureWorker = () => {
  if (!app.worker) return;

  const message: ConfigureAnalysisMessage = {
    type: "configure",
    periodSeconds: getPeriodSeconds(),
    binCount: DEFAULT_BIN_COUNT,
  };

  app.worker.postMessage(message);
};

const createWorker = () => {
  const worker = new Worker("analysis-worker.js", {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent<AnalysisWorkerToMainMessage>) => {
    const message = event.data;
    if (message.type !== "analysis") return;

    app.graph.update(message);
    app.tickTockPeakGraph.update(message);
    app.trackingBandFoldGraph.update(message);
    updateTrackingDisplay(message);
    elements.featureRate.textContent = `${message.featureRate} Hz`;
  };

  worker.onerror = (event) => {
    setStatus(`Worker error: ${event.message}`);
    stop();
  };

  return worker;
};

const start = async () => {
  if (app.running) return;

  if (!window.isSecureContext) {
    setStatus("Microphone access requires localhost or HTTPS.");
    return;
  }

  setStatus("Requesting microphone...");
  app.worker = createWorker();
  app.captureReady = null;
  app.captureBatches = [];
  app.featureGraph.reset();
  resetTrackingDisplay();
  configureWorker();

  try {
    app.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });

    app.audioContext = new AudioContext();
    await app.audioContext.audioWorklet.addModule("feature-worklet.js");

    app.source = app.audioContext.createMediaStreamSource(app.stream);
    app.worklet = new AudioWorkletNode(app.audioContext, "feature-processor");
    app.sink = app.audioContext.createGain();
    app.sink.gain.value = 0;

    app.worklet.port.onmessage = (event: MessageEvent<WorkletToMainMessage>) => {
      const message = event.data;

      if (message.type === "ready") {
        app.captureReady = {
          sampleRate: message.sampleRate,
          featureRate: message.featureRate,
          bands: message.bands,
        };
        elements.featureRate.textContent = `${message.featureRate} Hz`;
        elements.sampleRate.textContent = `${Math.round(message.sampleRate)} Hz`;
        elements.bands.textContent = String(message.bands.length);
        setStatus("Recording");
      }

      if (message.type === "features" && app.worker) {
        captureFeatureMessage(message);
        app.featureGraph.update(message, getPeriodSeconds());
        const transfers = message.features.map((feature) => feature.data.buffer as ArrayBuffer);
        app.worker.postMessage(message, transfers);
      }
    };

    app.source.connect(app.worklet);
    app.worklet.connect(app.sink);
    app.sink.connect(app.audioContext.destination);
    setRunning(true);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Could not start microphone.");
    await stop();
  }
};

const stop = async () => {
  if (app.source) {
    app.source.disconnect();
    app.source = null;
  }
  if (app.worklet) {
    app.worklet.disconnect();
    app.worklet.port.onmessage = null;
    app.worklet = null;
  }
  if (app.sink) {
    app.sink.disconnect();
    app.sink = null;
  }
  if (app.audioContext) {
    await app.audioContext.close();
    app.audioContext = null;
  }
  if (app.stream) {
    app.stream.getTracks().forEach((track) => track.stop());
    app.stream = null;
  }
  if (app.worker) {
    app.worker.terminate();
    app.worker = null;
  }

  setRunning(false);
  elements.bands.textContent = "-";
  resetTrackingDisplay();
  if ((elements.status.textContent || "").startsWith("Recording")) {
    setStatus("Stopped");
  }
};

elements.toggle.addEventListener("click", () => {
  if (app.running) {
    stop();
  } else {
    start();
  }
});

elements.captureToggle.addEventListener("click", () => {
  copyCapture();
});

elements.period.addEventListener("input", () => {
  updatePeriodDisplay();
  configureWorker();
});
