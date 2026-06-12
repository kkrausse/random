import {
  DEFAULT_BIN_COUNT,
  DEFAULT_FEATURE_CAP,
  DEFAULT_PERIOD_SECONDS,
} from "./data";
import type {
  AnalysisMessage,
  ConfigureAnalysisMessage,
  ConfigureWorkletMessage,
  FeatureMessage,
  ReadyMessage,
} from "./data";
import { createFeatureChart, createHeatmap } from "./graph";

type WorkletMessage = ReadyMessage | FeatureMessage;

type AppState = {
  audioContext: AudioContext | null;
  stream: MediaStream | null;
  source: MediaStreamAudioSourceNode | null;
  worklet: AudioWorkletNode | null;
  sink: GainNode | null;
  worker: Worker | null;
  graph: ReturnType<typeof createHeatmap>;
  featureGraph: ReturnType<typeof createFeatureChart>;
  running: boolean;
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
  period: query<HTMLSelectElement>("#period"),
  featureCap: query<HTMLSelectElement>("#feature-cap"),
  featureRate: query<HTMLElement>("#feature-rate"),
  bands: query<HTMLElement>("#bands"),
  status: query<HTMLElement>("#status"),
  foldChart: query<HTMLElement>("#fold-chart"),
  featureChart: query<HTMLElement>("#feature-chart"),
};

const app: AppState = {
  audioContext: null,
  stream: null,
  source: null,
  worklet: null,
  sink: null,
  worker: null,
  graph: createHeatmap(elements.foldChart),
  featureGraph: createFeatureChart(elements.featureChart),
  running: false,
};

const setStatus = (text: string) => {
  elements.status.textContent = text;
};

const setRunning = (running: boolean) => {
  app.running = running;
  elements.toggle.dataset.running = String(running);
  elements.toggle.textContent = running ? "Stop microphone" : "Start microphone";
};

const configureWorker = () => {
  if (!app.worker) return;

  const message: ConfigureAnalysisMessage = {
    type: "configure",
    periodSeconds: Number(elements.period.value) || DEFAULT_PERIOD_SECONDS,
    binCount: DEFAULT_BIN_COUNT,
  };

  app.worker.postMessage(message);
};

const getFeatureCap = () => Number(elements.featureCap.value) || DEFAULT_FEATURE_CAP;

const configureWorklet = () => {
  if (!app.worklet) return;

  const message: ConfigureWorkletMessage = {
    type: "configure",
    featureCap: getFeatureCap(),
  };

  app.worklet.port.postMessage(message);
};

const createWorker = () => {
  const worker = new Worker("/analysis-worker.js", {
    type: "module",
  });

  worker.onmessage = (event: MessageEvent<AnalysisMessage>) => {
    const message = event.data;
    if (message.type !== "analysis") return;

    app.graph.update(message);
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
  app.featureGraph.reset();
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
    await app.audioContext.audioWorklet.addModule("/feature-worklet.js");

    app.source = app.audioContext.createMediaStreamSource(app.stream);
    app.worklet = new AudioWorkletNode(app.audioContext, "feature-processor");
    app.sink = app.audioContext.createGain();
    app.sink.gain.value = 0;
    configureWorklet();

    app.worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
      const message = event.data;

      if (message.type === "ready") {
        elements.featureRate.textContent = `${message.featureRate} Hz`;
        elements.bands.textContent = String(message.bands.length);
        setStatus(`Recording at ${Math.round(message.sampleRate)} Hz`);
      }

      if (message.type === "features" && app.worker) {
        app.featureGraph.update(
          message,
          Number(elements.period.value) || DEFAULT_PERIOD_SECONDS,
          getFeatureCap(),
        );
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

elements.period.addEventListener("change", configureWorker);
elements.featureCap.addEventListener("change", configureWorklet);
