"use client";

import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

type VolumeMetric = "weight" | "amount";

type TradeChartProps = {
  /** X축 라벨 (예: 2020.01) */
  categories: string[];
  /** YoY·정렬용 원본 월 `YYYY-MM` */
  months: string[];
  /** kg */
  weightsKg: number[];
  /** 백만 USD */
  amountsMillionUsd: number[];
  /** 표와 동일한 전년 동월 대비 중량 증감률(YoY, %) — `filteredRows` 순서와 동일 길이 */
  yoyPctWeight: (number | null)[];
  /** 전년 동월 대비 금액 증감률(%) — 동일 길이 */
  yoyPctAmount: (number | null)[];
  /** 표와 동일한 단가 지표 (amount×1000/weight) */
  unitPrices: number[];
  /** 단가 지표 전년 동월比(%) */
  yoyPctUnitPrice: (number | null)[];
  /** 범례용 (예: 철근) */
  productLabel: string;
  /** 수입 | 수출 */
  imexLabel: string;
};

const BAR_GRAY = "#c0c0c0";
const LINE_BLUE = "#003399";

export function TradeChart({
  categories,
  months,
  weightsKg,
  amountsMillionUsd,
  yoyPctWeight,
  yoyPctAmount,
  unitPrices,
  yoyPctUnitPrice,
  productLabel,
  imexLabel,
}: TradeChartProps) {
  const [metric, setMetric] = useState<VolumeMetric>("weight");

  const hasData =
    categories.length > 0 &&
    months.length === categories.length &&
    weightsKg.length === categories.length &&
    amountsMillionUsd.length === categories.length &&
    yoyPctWeight.length === categories.length &&
    yoyPctAmount.length === categories.length &&
    unitPrices.length === categories.length &&
    yoyPctUnitPrice.length === categories.length;

  const barValues = useMemo(() => {
    if (!hasData) return [];
    if (metric === "weight") {
      return weightsKg.map((w) => Math.round((w / 1000) * 1000) / 1000);
    }
    return amountsMillionUsd.map((a) => Math.round(a * 1000) / 1000);
  }, [amountsMillionUsd, hasData, metric, weightsKg]);

  const lineData = useMemo(() => {
    const src = metric === "weight" ? yoyPctWeight : yoyPctAmount;
    return src.map((v) => (v === null || Number.isNaN(v) ? ("-" as const) : v));
  }, [metric, yoyPctAmount, yoyPctWeight]);

  const barLegend =
    metric === "weight"
      ? `${productLabel} ${imexLabel}량(좌)`
      : `${productLabel} ${imexLabel}금액(좌)`;
  const lineLegend = "증감률(우)";
  const leftUnit = metric === "weight" ? "(천톤)" : "(백만 USD)";
  const pngName =
    metric === "weight" ? "trade-volume-yoy-chart" : "trade-amount-yoy-chart";

  const n = categories.length;
  const useDataZoom = n > 24;
  const barMaxWidth = n > 120 ? 3 : n > 60 ? 5 : 10;

  const option: EChartsOption = useMemo(() => {
    if (!hasData) return {};

    const leftAxis: EChartsOption["yAxis"] = {
      type: "value",
      name: leftUnit,
      nameLocation: "end",
      nameTextStyle: { align: "left", color: "#444", fontSize: 11 },
      position: "left",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontSize: 11 },
    };

    const rightAxis: EChartsOption["yAxis"] = {
      type: "value",
      name: "(%YoY)",
      nameLocation: "end",
      nameTextStyle: { align: "right", color: "#444", fontSize: 11 },
      position: "right",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontSize: 11 },
      scale: true,
    };

    const xAxisLabelFormatter = (value: string) => {
      const m = /^(\d{4})\.(\d{2})$/.exec(value);
      if (!m) return value;
      return `'${m[1].slice(-2)}`;
    };

    /** 1월(YYYY.01)에만 연도 축 라벨 — 긴 시계열에서 겹침 방지 */
    const xAxisLabelInterval = (index: number, value: string) => {
      void index;
      const m = /^(\d{4})\.(\d{2})$/.exec(String(value));
      if (!m) return true;
      return m[2] !== "01";
    };

    const dataZoom: EChartsOption["dataZoom"] = useDataZoom
      ? [
          {
            type: "inside",
            xAxisIndex: 0,
            filterMode: "none",
            zoomOnMouseWheel: true,
            moveOnMouseMove: true,
          },
          {
            type: "slider",
            xAxisIndex: 0,
            filterMode: "none",
            height: 22,
            bottom: 8,
            handleStyle: { color: "#94a3b8" },
            dataBackground: {
              areaStyle: { color: "#e2e8f0" },
              lineStyle: { color: "#cbd5e1" },
            },
          },
        ]
      : undefined;

    return {
      color: [BAR_GRAY, LINE_BLUE],
      animation: n < 400,
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        formatter: (params: unknown) => {
          if (!Array.isArray(params) || params.length === 0) return "";
          const axis = params[0] as { axisValue?: string; dataIndex?: number };
          const idx = axis.dataIndex ?? 0;
          const cat = axis.axisValue ?? "";
          const b = barValues[idx];
          const srcYoy = metric === "weight" ? yoyPctWeight : yoyPctAmount;
          const y = srcYoy[idx];
          const yStr =
            y === null || y === undefined || Number.isNaN(y)
              ? "-"
              : `${y > 0 ? "+" : ""}${y.toFixed(1)}%`;
          const volUnit = metric === "weight" ? "천톤" : "백만 USD";
          const fmtPct = (v: number | null | undefined) =>
            v === null || v === undefined || Number.isNaN(v)
              ? "-"
              : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
          const up = unitPrices[idx];
          const upStr = up !== undefined ? up.toFixed(1) : "-";
          return `<div style="font-size:12px;line-height:1.55"><strong>${cat}</strong><br/>${barLegend}: ${b?.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${volUnit}<br/>${lineLegend}: ${yStr} (표와 동일·전년 동월比)<br/>────────<br/>중량 YoY: ${fmtPct(yoyPctWeight[idx])}<br/>금액 YoY: ${fmtPct(yoyPctAmount[idx])}<br/>${imexLabel}단가: ${upStr}<br/>단가 YoY: ${fmtPct(yoyPctUnitPrice[idx])}</div>`;
        },
      },
      toolbox: {
        right: 12,
        top: 4,
        feature: {
          saveAsImage: {
            show: true,
            title: "PNG 저장",
            name: pngName,
            pixelRatio: 2,
          },
        },
      },
      legend: {
        left: 8,
        top: 4,
        orient: "horizontal",
        itemGap: 20,
        textStyle: { fontSize: 12, color: "#333" },
        data: [barLegend, lineLegend],
      },
      grid: {
        left: 56,
        right: 56,
        top: 52,
        bottom: useDataZoom ? 52 : 40,
        containLabel: false,
      },
      dataZoom,
      xAxis: {
        type: "category",
        data: categories,
        boundaryGap: true,
        axisLine: { show: true, lineStyle: { color: "#999" } },
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: {
          color: "#555",
          fontSize: 11,
          interval: xAxisLabelInterval,
          formatter: xAxisLabelFormatter,
        },
      },
      yAxis: [leftAxis, rightAxis],
      series: [
        {
          name: barLegend,
          type: "bar",
          yAxisIndex: 0,
          data: barValues,
          barMaxWidth,
          barCategoryGap: n > 80 ? "25%" : "40%",
          itemStyle: {
            color: BAR_GRAY,
            borderRadius: [1, 1, 0, 0],
          },
          large: n > 800,
          largeThreshold: 400,
        },
        {
          name: lineLegend,
          type: "line",
          yAxisIndex: 1,
          data: lineData,
          smooth: true,
          showSymbol: n < 48,
          symbol: "circle",
          symbolSize: 3,
          connectNulls: true,
          lineStyle: { width: 2, color: LINE_BLUE },
          itemStyle: { color: LINE_BLUE },
        },
      ],
    };
  }, [
    barLegend,
    barMaxWidth,
    barValues,
    categories,
    hasData,
    leftUnit,
    lineLegend,
    metric,
    n,
    pngName,
    useDataZoom,
    lineData,
    yoyPctAmount,
    yoyPctUnitPrice,
    yoyPctWeight,
    unitPrices,
    imexLabel,
  ]);

  const togglePad = "px-3 py-1.5 text-sm";

  if (!hasData) {
    return (
      <div
        className="flex h-[400px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600"
        role="status"
      >
        <p className="font-semibold text-slate-700">차트: 데이터 없음</p>
        <p className="mt-1 max-w-sm px-4 text-slate-500">
          월별 시계열이 비어 있어 ECharts를 렌더링하지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
          지표
        </span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200/80">
          <button
            type="button"
            onClick={() => setMetric("weight")}
            className={`rounded-md ${togglePad} font-medium transition-colors ${
              metric === "weight"
                ? "bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            천톤 · YoY
          </button>
          <button
            type="button"
            onClick={() => setMetric("amount")}
            className={`rounded-md ${togglePad} font-medium transition-colors ${
              metric === "amount"
                ? "bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            금액 · YoY
          </button>
        </div>
        {useDataZoom ? (
          <span className="text-xs text-slate-500">
            긴 구간: 아래 슬라이더·트랙패드로 이동·확대할 수 있습니다.
          </span>
        ) : null}
      </div>
      <div className="w-full min-h-[400px] min-w-0">
        <ReactECharts
          option={option}
          style={{ height: useDataZoom ? 440 : 400, width: "100%", minWidth: 0 }}
          opts={{ renderer: "canvas", devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1 }}
          notMerge={false}
          lazyUpdate={false}
        />
      </div>
    </div>
  );
}
