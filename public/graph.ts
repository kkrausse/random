import * as echarts from "echarts";
import type { AnalysisMessage, FeatureMessage, FoldRow, TrackingFold } from "./data";

type ChartPoint = [number, number];
type HeatmapPoint = [number, number, number];

type TooltipParams = {
  value: [number, number, number];
};

const makeHeatmapData = (rows: FoldRow[], binCount: number) => {
  const data: HeatmapPoint[] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const bins = rows[rowIndex].bins;
    for (let bin = 0; bin < binCount; bin += 1) {
      data.push([bin, rowIndex, Number(bins[bin].toFixed(3))]);
    }
  }
  return data;
};

const makeRowLabels = (rows: FoldRow[]) => rows.map((row) => `${row.bph} / ${row.band}`);

const makeTrackingFoldSeries = (fold: TrackingFold) => {
  const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;

  return [
    {
      name: "summed amplitude",
      type: "line",
      data: Array.from(fold.bins, (value, bin) => [
        Number(((bin / fold.binCount) * cycleSeconds).toFixed(4)),
        Number(value.toFixed(4)),
      ]),
      showSymbol: false,
      lineStyle: { width: 1 },
    },
  ];
};

export const createTrackingFoldChart = (element: HTMLElement) => {
  element.textContent = "";
  const chart = echarts.init(element, null, { renderer: "canvas" });

  const update = (analysis: AnalysisMessage) => {
    const fold = analysis.trackingFold;

    if (!fold) {
      chart.setOption({
        animation: false,
        grid: {
          left: 48,
          right: 20,
          top: 32,
          bottom: 48,
        },
        xAxis: {
          type: "value",
          name: "tracked cycle seconds",
          min: 0,
        },
        yAxis: {
          type: "value",
          name: "amplitude",
          min: 0,
          scale: true,
        },
        series: [],
      });
      return;
    }

    const cycleSeconds = (3600 / fold.bph) * fold.cycleBeats;

    chart.setOption({
      animation: false,
      grid: {
        left: 48,
        right: 20,
        top: 32,
        bottom: 48,
      },
      legend: {
        type: "scroll",
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        valueFormatter(value: number) {
          return Number(value).toFixed(4);
        },
      },
      xAxis: {
        type: "value",
        name: `seconds (${fold.cycleBeats} beat cycle)`,
        min: 0,
        max: Number(cycleSeconds.toFixed(4)),
      },
      yAxis: {
        type: "value",
        name: "normalized amplitude",
        scale: true,
      },
      series: makeTrackingFoldSeries(fold),
    });
  };

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);

  return { update, resize };
};

export const createHeatmap = (element: HTMLElement) => {
  element.textContent = "";
  const chart = echarts.init(element, null, { renderer: "canvas" });

  const update = (analysis: AnalysisMessage) => {
    const folds = analysis.standardFolds;
    const labels = makeRowLabels(folds.rows);
    const data = makeHeatmapData(folds.rows, folds.binCount);

    chart.setOption({
      animation: false,
      grid: {
        left: 160,
        right: 24,
        top: 24,
        bottom: 36,
      },
      tooltip: {
        position: "top",
        formatter(params: TooltipParams) {
          const row = folds.rows[params.value[1]];
          const cycleBeats = folds.cycleBeats || 1;
          return [
            `${row.bph} BPH / ${row.band}`,
            `Phase bin: ${params.value[0]} / ${folds.binCount - 1}`,
            `Fold cycle: ${cycleBeats} beat${cycleBeats === 1 ? "" : "s"}`,
            `Z score: ${params.value[2]}`,
          ].join("<br>");
        },
      },
      xAxis: {
        type: "category",
        name: `phase (${folds.cycleBeats || 1} beat cycle)`,
        data: Array.from({ length: folds.binCount }, (_, index) => index),
        splitArea: { show: false },
        axisLabel: { interval: 15 },
      },
      yAxis: {
        type: "category",
        data: labels,
        inverse: true,
        axisLabel: { fontSize: 11 },
      },
      visualMap: {
        min: -2,
        max: 6,
        calculable: false,
        orient: "horizontal",
        left: "center",
        bottom: 0,
        inRange: {
          color: ["#1b365d", "#f4f7fb", "#f59f00", "#d9480f"],
        },
      },
      series: [
        {
          type: "heatmap",
          data,
          progressive: 0,
          emphasis: {
            itemStyle: {
              borderColor: "#111",
              borderWidth: 1,
            },
          },
        },
      ],
    });
  };

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);

  return { update, resize };
};

export const createFeatureChart = (element: HTMLElement) => {
  element.textContent = "";
  const chart = echarts.init(element, null, { renderer: "canvas" });
  const state = {
    bands: [] as string[],
    series: new Map<string, ChartPoint[]>(),
    lastDraw: 0,
  };

  const reset = () => {
    state.bands = [];
    state.series = new Map();
    chart.clear();
  };

  const ensureBands = (features: FeatureMessage["features"]) => {
    const bands = features.map((feature) => feature.name);
    const changed =
      bands.length !== state.bands.length ||
      bands.some((band, index) => band !== state.bands[index]);

    if (!changed) return;

    state.bands = bands;
    state.series = new Map(bands.map((band) => [band, []]));
  };

  const appendBatch = (message: FeatureMessage) => {
    const frameCount = message.features[0]?.data?.length || 0;
    const step = Math.max(1, Math.round(message.featureRate / 100));

    for (let offset = 0; offset < frameCount; offset += step) {
      const seconds = (message.startFrame + offset) / message.featureRate;
      const end = Math.min(frameCount, offset + step);

      for (let bandIndex = 0; bandIndex < message.features.length; bandIndex += 1) {
        const feature = message.features[bandIndex];
        let peak = 0;
        for (let index = offset; index < end; index += 1) {
          peak = Math.max(peak, feature.data[index]);
        }
        state.series.get(feature.name)?.push([seconds, Number(peak.toFixed(4))]);
      }
    }
  };

  const trim = (windowSeconds: number) => {
    let latest = 0;
    for (const values of state.series.values()) {
      if (values.length) {
        latest = Math.max(latest, values[values.length - 1][0]);
      }
    }

    const cutoff = latest - windowSeconds;
    for (const values of state.series.values()) {
      while (values.length && values[0][0] < cutoff) {
        values.shift();
      }
    }
  };

  const draw = (windowSeconds: number, featureCap: number) => {
    const series = state.bands.map((band) => ({
      name: band,
      type: "line",
      data: state.series.get(band),
      showSymbol: false,
      sampling: "max",
      lineStyle: { width: 1 },
    }));

    chart.setOption({
      animation: false,
      grid: {
        left: 48,
        right: 20,
        top: 32,
        bottom: 48,
      },
      legend: {
        type: "scroll",
        top: 0,
      },
      tooltip: {
        trigger: "axis",
        valueFormatter(value: number) {
          return Number(value).toFixed(4);
        },
      },
      xAxis: {
        type: "value",
        name: "seconds",
        min: (value: { max: number }) => Math.max(0, value.max - windowSeconds),
        max: "dataMax",
      },
      yAxis: {
        type: "value",
        name: "amplitude",
        min: 0,
        max: featureCap,
        scale: true,
      },
      series,
    });
  };

  const update = (message: FeatureMessage, windowSeconds: number, featureCap: number) => {
    ensureBands(message.features);
    appendBatch(message);
    trim(windowSeconds);

    const now = Date.now();
    if (now - state.lastDraw < 100) return;

    state.lastDraw = now;
    draw(windowSeconds, featureCap);
  };

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);

  return { reset, update, resize };
};
