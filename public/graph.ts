import * as echarts from "echarts";
import type {
  AnalysisMessage,
  FeatureMessage,
  FoldRow,
  TrackingBandFold,
  TrackingFold,
} from "./data";

type ChartPoint = [number, number];
type HeatmapPoint = [number, number, number];

type TickTockPeakData = {
  zoomSeconds: number;
  yMin: number;
  yMax: number;
  series: ({
    name: string;
    type: "line";
    data: ChartPoint[];
    showSymbol: false;
    lineStyle: {
      width: number;
      opacity?: number;
      color?: string;
      type?: "solid" | "dashed" | "dotted";
    };
    z?: number;
    silent?: boolean;
  } | {
    name: string;
    type: "scatter";
    data: ChartPoint[];
    symbolSize: number;
    itemStyle: { color: string; borderColor?: string; borderWidth?: number };
    label?: { show: boolean; formatter: string; position: string; fontSize: number };
    z?: number;
    silent?: boolean;
  })[];
};

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

const cycleSecondsFor = (bph: number, cycleBeats: number) => (3600 / bph) * cycleBeats;

const makeTrackingFoldSeries = (fold: TrackingFold, axisBph: number) => {
  const cycleSeconds = cycleSecondsFor(axisBph, fold.cycleBeats);

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

const yBoundsFor = (points: ChartPoint[]) => {
  let yMin = 0;
  let yMax = 0;

  for (let index = 0; index < points.length; index += 1) {
    yMin = Math.min(yMin, points[index][1]);
    yMax = Math.max(yMax, points[index][1]);
  }

  const padding = Math.max((yMax - yMin) * 0.08, 0.001);
  return {
    yMin: Number((yMin - padding).toFixed(4)),
    yMax: Number((yMax + padding).toFixed(4)),
  };
};

const makeTickTockPeakData = (
  analysis: AnalysisMessage,
): TickTockPeakData => {
  const sampleSeries = analysis.tickTockPeakSamples.map((sample) => {
    const points = Array.from({ length: Math.floor(sample.points.length / 2) }, (_, index) => [
      sample.points[index * 2],
      sample.points[index * 2 + 1],
    ] as ChartPoint);
    const isTock = sample.name.endsWith("tock");

    return {
      name: sample.name,
      type: "line" as const,
      data: points,
      showSymbol: false as const,
      lineStyle: {
        width: 1,
        opacity: 0.55,
        type: isTock ? "dashed" as const : "solid" as const,
      },
      silent: false,
    };
  });
  const allPoints = sampleSeries.flatMap((series) => series.data);
  const { yMin, yMax } = yBoundsFor(allPoints);
  let zoomSeconds = 0.002;
  for (let index = 0; index < allPoints.length; index += 1) {
    zoomSeconds = Math.max(zoomSeconds, Math.abs(allPoints[index][0]));
  }

  return {
    zoomSeconds: Number(zoomSeconds.toFixed(5)),
    yMin,
    yMax,
    series: sampleSeries,
  };
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
          bottom: 64,
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

    const axisBph = analysis.tracking.standardBph || fold.bph;
    const cycleSeconds = cycleSecondsFor(axisBph, fold.cycleBeats);

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
        name: `standard seconds (${axisBph} BPH, ${fold.cycleBeats} beat cycle)`,
        min: 0,
        max: Number(cycleSeconds.toFixed(4)),
      },
      yAxis: {
        type: "value",
        name: "amplitude",
        scale: true,
      },
      series: makeTrackingFoldSeries(fold, axisBph),
    });
  };

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);

  return { update, resize };
};

export const createTickTockPeakChart = (element: HTMLElement) => {
  element.textContent = "";
  const chart = echarts.init(element, null, { renderer: "canvas" });

  const update = (analysis: AnalysisMessage) => {
    if (analysis.tickTockPeakSamples.length === 0) {
      chart.setOption({
        animation: false,
        grid: {
          left: 34,
          right: 12,
          top: 32,
          bottom: 48,
        },
        xAxis: {
          type: "value",
          name: "seconds from drop",
        },
        yAxis: {
          type: "value",
          axisLabel: {
            margin: 4,
            formatter(value: number) {
              return value.toFixed(2);
            },
          },
        },
        series: [],
      });
      return;
    }

    const peakData = makeTickTockPeakData(analysis);

    chart.setOption({
      animation: false,
      grid: {
        left: 34,
        right: 12,
        top: 24,
        bottom: 72,
      },
      legend: {
        bottom: 8,
        left: "center",
        type: "scroll",
      },
      tooltip: {
        trigger: "axis",
        valueFormatter(value: number) {
          return Number(value).toFixed(4);
        },
      },
      xAxis: {
        type: "value",
        name: "seconds from drop",
        min: -peakData.zoomSeconds,
        max: peakData.zoomSeconds,
      },
      yAxis: {
        type: "value",
        min: peakData.yMin,
        max: peakData.yMax,
        axisLabel: {
          margin: 4,
          formatter(value: number) {
            return value.toFixed(2);
          },
        },
      },
      series: peakData.series,
    });
  };

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);

  return { update, resize };
};

const makeTrackingBandFoldSeries = (rows: TrackingBandFold[], axisBph: number) => {
  return rows.map((row) => {
    const cycleSeconds = cycleSecondsFor(axisBph, row.cycleBeats);
    return {
      name: row.band,
      type: "line",
      data: Array.from(row.bins, (value, bin) => [
        Number(((bin / row.binCount) * cycleSeconds).toFixed(4)),
        Number(value.toFixed(4)),
      ]),
      showSymbol: false,
      lineStyle: { width: 1 },
    };
  });
};

export const createTrackingBandFoldChart = (element: HTMLElement) => {
  element.textContent = "";
  const chart = echarts.init(element, null, { renderer: "canvas" });

  const update = (analysis: AnalysisMessage) => {
    const rows = analysis.trackingBandFolds;
    const firstRow = rows[0];

    if (!firstRow) {
      chart.clear();
      chart.setOption({
        animation: false,
        grid: {
          left: 48,
          right: 12,
          top: 16,
          bottom: 32,
        },
        xAxis: {
          type: "value",
          min: 0,
        },
        yAxis: {
          type: "value",
          scale: true,
        },
        series: [],
      });
      return;
    }

    const axisBph = analysis.tracking.standardBph || firstRow.bph;
    const cycleSeconds = cycleSecondsFor(axisBph, firstRow.cycleBeats);

    chart.setOption({
      animation: false,
      grid: {
        left: 48,
        right: 12,
        top: 16,
        bottom: 32,
      },
      tooltip: {
        trigger: "axis",
        valueFormatter(value: number) {
          return Number(value).toFixed(4);
        },
      },
      xAxis: {
        type: "value",
        min: 0,
        max: Number(cycleSeconds.toFixed(4)),
      },
      yAxis: {
        type: "value",
        scale: true,
      },
      series: makeTrackingBandFoldSeries(rows, axisBph),
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
        left: 96,
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
        axisLabel: {
          fontSize: 11,
          overflow: "truncate",
          width: 82,
        },
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

  const draw = (windowSeconds: number) => {
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
        scale: true,
      },
      series,
    });
  };

  const update = (message: FeatureMessage, windowSeconds: number) => {
    ensureBands(message.features);
    appendBatch(message);
    trim(windowSeconds);

    const now = Date.now();
    if (now - state.lastDraw < 100) return;

    state.lastDraw = now;
    draw(windowSeconds);
  };

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);

  return { reset, update, resize };
};
