import {
  DEFAULT_BIN_COUNT,
  DEFAULT_LIFT_ANGLE_DEGREES,
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
  rawCaptureRecording: boolean;
  rawCaptureChunks: Float32Array[][];
  rawCaptureFrameCount: number;
  rawCaptureSampleRate: number;
  rawCaptureChannelCount: number;
  rawCaptureStopped: (() => void) | null;
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

type TimegraphAssets = {
  analysisWorker?: string;
  featureWorklet?: string;
  version?: string;
};

const CAPTURE_WINDOW_SECONDS = 20;
const assetConfig = (window as Window & { __TIMEGRAPH_ASSETS__?: TimegraphAssets })
  .__TIMEGRAPH_ASSETS__;
const sourceVersion = assetConfig?.version || String(Date.now());

const sourceUrl = (path: string, configuredPath?: string) => {
  const url = configuredPath || path;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${sourceVersion}`;
};

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
  rawCaptureToggle: query<HTMLButtonElement>("#raw-capture-toggle"),
  period: query<HTMLInputElement>("#period"),
  periodValue: query<HTMLOutputElement>("#period-value"),
  liftAngle: query<HTMLInputElement>("#lift-angle"),
  liftAngleValue: query<HTMLOutputElement>("#lift-angle-value"),
  featureRate: query<HTMLElement>("#feature-rate"),
  sampleRate: query<HTMLElement>("#sample-rate"),
  bands: query<HTMLElement>("#bands"),
  standardBph: query<HTMLElement>("#standard-bph"),
  measuredBph: query<HTMLElement>("#measured-bph"),
  secondsPerDay: query<HTMLElement>("#seconds-per-day"),
  amplitude: query<HTMLElement>("#amplitude"),
  unlockDrop: query<HTMLElement>("#unlock-drop"),
  errorSecondsPerDay: query<HTMLElement>("#error-seconds-per-day"),
  confidenceBph: query<HTMLElement>("#confidence-bph"),
  analysisMs: query<HTMLElement>("#analysis-ms"),
  framesBuffered: query<HTMLElement>("#frames-buffered"),
  candidateRows: query<HTMLTableSectionElement>("#candidate-rows"),
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
elements.liftAngle.value = String(DEFAULT_LIFT_ANGLE_DEGREES);
elements.liftAngleValue.textContent = `${DEFAULT_LIFT_ANGLE_DEGREES}°`;

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
  rawCaptureRecording: false,
  rawCaptureChunks: [],
  rawCaptureFrameCount: 0,
  rawCaptureSampleRate: 0,
  rawCaptureChannelCount: 0,
  rawCaptureStopped: null,
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

const getLiftAngleDegrees = () =>
  Number(elements.liftAngle.value) || DEFAULT_LIFT_ANGLE_DEGREES;

const updatePeriodDisplay = () => {
  elements.periodValue.textContent = `${getPeriodSeconds()}s`;
};

const updateLiftAngleDisplay = () => {
  elements.liftAngleValue.textContent = `${getLiftAngleDegrees()}°`;
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

const writeAscii = (view: DataView, offset: number, value: string) => {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index));
  }
};

const makeFloat32Wav = (
  chunks: Float32Array[][],
  frameCount: number,
  sampleRate: number,
  channelCount: number,
) => {
  const bytesPerSample = 4;
  const blockAlign = channelCount * bytesPerSample;
  const dataBytes = frameCount * blockAlign;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 3, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);

  const samples = new Float32Array(buffer, 44, frameCount * channelCount);
  let offset = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const channels = chunks[index];
    const chunkFrames = channels[0]?.length || 0;
    for (let frame = 0; frame < chunkFrames; frame += 1) {
      for (let channel = 0; channel < channelCount; channel += 1) {
        samples[offset] = channels[channel]?.[frame] || 0;
        offset += 1;
      }
    }
  }

  return buffer;
};

const downloadRawCapture = () => {
  if (!app.rawCaptureFrameCount || !app.rawCaptureSampleRate || !app.rawCaptureChannelCount) {
    return;
  }

  const wav = makeFloat32Wav(
    app.rawCaptureChunks,
    app.rawCaptureFrameCount,
    app.rawCaptureSampleRate,
    app.rawCaptureChannelCount,
  );
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  const link = document.createElement("a");
  const timestamp = new Date().toISOString().replaceAll(":", "-");
  link.href = url;
  link.download = `timegrapher-raw-${timestamp}.wav`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};

const resetRawCapture = () => {
  app.rawCaptureRecording = false;
  app.rawCaptureChunks = [];
  app.rawCaptureFrameCount = 0;
  app.rawCaptureSampleRate = 0;
  app.rawCaptureChannelCount = 0;
  elements.rawCaptureToggle.disabled = false;
  elements.rawCaptureToggle.dataset.running = "false";
  elements.rawCaptureToggle.textContent = "Record raw WAV";
};

const startRawCapture = () => {
  if (!app.running || !app.worklet) {
    setStatus("Start the microphone before recording raw audio.");
    return;
  }

  resetRawCapture();
  app.rawCaptureRecording = true;
  elements.rawCaptureToggle.dataset.running = "true";
  elements.rawCaptureToggle.textContent = "Stop and save raw WAV";
  app.worklet.port.postMessage({ type: "configure-raw-capture", enabled: true });
  setStatus("Recording raw audio.");
};

const stopRawCapture = () => {
  if (!app.rawCaptureRecording || !app.worklet) {
    downloadRawCapture();
    resetRawCapture();
    return Promise.resolve();
  }

  elements.rawCaptureToggle.disabled = true;
  elements.rawCaptureToggle.textContent = "Finishing raw WAV...";

  return new Promise<void>((resolve) => {
    app.rawCaptureStopped = resolve;
    app.worklet?.port.postMessage({ type: "configure-raw-capture", enabled: false });
  });
};

const finishRawCapture = () => {
  const seconds = app.rawCaptureSampleRate
    ? app.rawCaptureFrameCount / app.rawCaptureSampleRate
    : 0;
  downloadRawCapture();
  const resolve = app.rawCaptureStopped;
  resetRawCapture();
  app.rawCaptureStopped = null;
  setStatus(`Saved ${seconds.toFixed(1)}s raw WAV.`);
  resolve?.();
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

const formatScore = (value: number) => {
  if (value === 0) return "0";
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.001) return value.toExponential(2);
  return value.toPrecision(4);
};

const bphErrorToSecondsPerDay = (errorBph: number | null, standardBph: number | null) => {
  if (errorBph === null || standardBph === null) return null;
  return (errorBph / standardBph) * 86400;
};

const renderCandidateTable = (message: AnalysisWorkerToMainMessage) => {
  const { standardBph, candidates } = message.tracking;
  if (!standardBph || candidates.length === 0) {
    elements.candidateRows.innerHTML = `<tr><td colspan="6">-</td></tr>`;
    return;
  }

  elements.candidateRows.innerHTML = candidates.map((candidate) => {
    const deltaBph = candidate.bph - standardBph;
    const secondsPerDay = (candidate.bph / standardBph - 1) * 86400;
    const label = [
      candidate.selected ? "pick" : "",
      candidate.best ? "best" : "",
    ].filter(Boolean).join(" ");

    return `<tr>
      <td>${label || "-"}</td>
      <td>${candidate.offset === undefined ? "-" : candidate.offset.toFixed(1)}</td>
      <td>${candidate.bph.toFixed(2)}</td>
      <td>${formatScore(candidate.score)}</td>
      <td>${formatSigned(deltaBph)}</td>
      <td>${formatSigned(secondsPerDay)}</td>
    </tr>`;
  }).join("");
};

const resetTrackingDisplay = () => {
  elements.standardBph.textContent = "-";
  elements.measuredBph.textContent = "-";
  elements.secondsPerDay.textContent = "-";
  elements.amplitude.textContent = "-";
  elements.unlockDrop.textContent = "-";
  elements.errorSecondsPerDay.textContent = "-";
  elements.confidenceBph.textContent = "-";
  elements.sampleRate.textContent = "-";
  elements.analysisMs.textContent = "-";
  elements.framesBuffered.textContent = "-";
  elements.candidateRows.innerHTML = `<tr><td colspan="6">-</td></tr>`;
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
  elements.amplitude.textContent =
    message.balanceAmplitude?.averageDegrees === null ||
    message.balanceAmplitude?.averageDegrees === undefined
      ? "-"
      : `${message.balanceAmplitude.averageDegrees.toFixed(1)}°`;
  elements.unlockDrop.textContent =
    message.balanceAmplitude?.averageLiftSeconds === null ||
    message.balanceAmplitude?.averageLiftSeconds === undefined
      ? "-"
      : `${(message.balanceAmplitude.averageLiftSeconds * 1000).toFixed(2)} ms`;
  elements.errorSecondsPerDay.textContent = formatRange(errorSecondsPerDay);
  elements.confidenceBph.textContent = formatRange(tracking.confidenceBph);
  elements.analysisMs.textContent = `${message.analysisMs.toFixed(1)} ms`;
  elements.framesBuffered.textContent = `${(message.framesBuffered / message.featureRate).toFixed(1)}s`;
  renderCandidateTable(message);
};

const configureWorker = () => {
  if (!app.worker) return;

  const message: ConfigureAnalysisMessage = {
    type: "configure",
    periodSeconds: getPeriodSeconds(),
    binCount: DEFAULT_BIN_COUNT,
    liftAngleDegrees: getLiftAngleDegrees(),
  };

  app.worker.postMessage(message);
};

const createWorker = () => {
  const worker = new Worker(sourceUrl("analysis-worker.js", assetConfig?.analysisWorker), {
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
    await app.audioContext.audioWorklet.addModule(
      sourceUrl("feature-worklet.js", assetConfig?.featureWorklet),
    );

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

      if (message.type === "raw-audio" && app.rawCaptureRecording) {
        app.rawCaptureChunks.push(message.channels);
        app.rawCaptureFrameCount += message.channels[0]?.length || 0;
        app.rawCaptureSampleRate = message.sampleRate;
        app.rawCaptureChannelCount = message.channels.length;
      }

      if (message.type === "raw-capture-stopped") {
        finishRawCapture();
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
  if (app.rawCaptureRecording) {
    await stopRawCapture();
  }

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

elements.toggle.addEventListener("click", async () => {
  if (app.running) {
    await stop();
  } else {
    await start();
  }
});

elements.captureToggle.addEventListener("click", () => {
  copyCapture();
});

elements.rawCaptureToggle.addEventListener("click", async () => {
  if (app.rawCaptureRecording) {
    await stopRawCapture();
  } else {
    startRawCapture();
  }
});

elements.period.addEventListener("input", () => {
  updatePeriodDisplay();
  configureWorker();
});

elements.liftAngle.addEventListener("input", () => {
  updateLiftAngleDisplay();
  configureWorker();
});
