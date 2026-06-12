const makeHeatmapData = (rows, binCount) => {
  const data = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const bins = rows[rowIndex].bins;
    for (let bin = 0; bin < binCount; bin += 1) {
      data.push([bin, rowIndex, Number(bins[bin].toFixed(3))]);
    }
  }
  return data;
};

const makeRowLabels = (rows) =>
  rows.map((row) => `${row.bph} / ${row.band} (${row.score.toFixed(1)})`);

export const createHeatmap = (element) => {
  if (!window.echarts) {
    element.textContent = "ECharts failed to load. Check the network and refresh.";
    return {
      update() {},
      resize() {},
    };
  }

  const chart = window.echarts.init(element, null, { renderer: "canvas" });

  const update = (folds) => {
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
        formatter(params) {
          const row = folds.rows[params.value[1]];
          return [
            `${row.bph} BPH / ${row.band}`,
            `Phase bin: ${params.value[0]}`,
            `Z score: ${params.value[2]}`,
            `Row score: ${row.score.toFixed(2)}`,
          ].join("<br>");
        },
      },
      xAxis: {
        type: "category",
        name: "phase",
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
