"use client";

import type { EChartsOption } from "echarts";
import ReactECharts from "echarts-for-react";

type TradeChartProps = {
  categories: string[];
  weights: number[];
};

export function TradeChart({ categories, weights }: TradeChartProps) {
  const hasData =
    categories.length > 0 &&
    weights.length > 0 &&
    categories.length === weights.length;

  if (!hasData) {
    return (
      <div
        className="flex h-[380px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600"
        role="status"
      >
        <p className="font-semibold text-slate-700">차트: 데이터 없음</p>
        <p className="mt-1 max-w-sm px-4 text-slate-500">
          중량 시계열이 비어 있어 ECharts를 렌더링하지 않습니다.
        </p>
      </div>
    );
  }

  const option: EChartsOption = {
    color: ["#0ea5e9", "#0f2744"],
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "cross" },
    },
    toolbox: {
      right: 12,
      top: 4,
      feature: {
        saveAsImage: {
          show: true,
          title: "PNG 저장",
          name: "trade-weight-chart",
          pixelRatio: 2,
        },
      },
    },
    grid: {
      left: "48",
      right: "24",
      top: "56",
      bottom: "56",
      containLabel: true,
    },
    legend: {
      data: ["중량(막대)", "중량(추세)"],
      bottom: 0,
    },
    xAxis: {
      type: "category",
      data: categories,
      name: "월",
      nameLocation: "middle",
      nameGap: 28,
      axisLabel: { rotate: 0 },
    },
    yAxis: {
      type: "value",
      name: "중량",
      splitLine: {
        lineStyle: { type: "dashed", color: "#e2e8f0" },
      },
    },
    series: [
      {
        name: "중량(막대)",
        type: "bar",
        data: weights,
        barMaxWidth: 36,
        itemStyle: {
          color: "#38bdf8",
          borderRadius: [4, 4, 0, 0],
        },
      },
      {
        name: "중량(추세)",
        type: "line",
        data: weights,
        smooth: true,
        symbol: "circle",
        symbolSize: 8,
        lineStyle: { width: 2.5, color: "#0f2744" },
        itemStyle: { color: "#0f2744", borderWidth: 2, borderColor: "#fff" },
      },
    ],
  };

  return (
    <ReactECharts
      option={option}
      style={{ height: 380, width: "100%" }}
      opts={{ renderer: "canvas" }}
      notMerge={true}
      lazyUpdate={false}
    />
  );
}
