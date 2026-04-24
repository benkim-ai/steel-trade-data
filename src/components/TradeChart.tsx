"use client";

import type { EChartsOption } from "echarts";
import { useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";

/** 우측 파란 선: 단가(표와 동일 지표) 또는 중량 전년동월 증감률 */
type RightLineMode = "unitPrice" | "yoy";

type TradeChartProps = {
  /** X축 라벨 (예: 2020.01 또는 2020) */
  categories: string[];
  /** YoY·정렬용 원본 기간 `YYYY-MM` 또는 `YYYY` */
  months: string[];
  /** 중량(천톤) — 좌축 막대와 동일 단위 */
  weightsKg: number[];
  /** 백만 USD */
  amountsMillionUsd: number[];
  /** 표와 동일한 전년 대비 중량 증감률(YoY, %) — `filteredRows` 순서와 동일 길이 */
  yoyPctWeight: (number | null)[];
  /** 전년 대비 금액 증감률(%) — 동일 길이 */
  yoyPctAmount: (number | null)[];
  /** 표와 동일: 단가 = 금액×1000/중량(천톤) */
  unitPrices: number[];
  /** 단가 지표 전년比(%) */
  yoyPctUnitPrice: (number | null)[];
  /** 회색 막대 범례 (예: 일본산 중후판) */
  barLegendText: string;
  /** 수입 | 수출 */
  imexLabel: string;
  /** YoY 기준 문구 */
  yoyComparisonLabel: string;
  /** 저장 파일명 앞부분 (예: `미국 · 중후판 / 2020.01~2023.05`) */
  saveImageNameStem: string;
};

const BAR_GRAY = "#c0c0c0";
const LINE_BLUE = "#003399";

function finiteNumbers(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function nextMagnitudeStep(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  return 10 ** Math.max(0, Math.floor(Math.log10(maxValue)));
}

function nextNiceUpper(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 1;
  const step = nextMagnitudeStep(maxValue);
  return (Math.floor(maxValue / step) + 1) * step;
}

function previousPercentLower(minValue: number): number {
  if (!Number.isFinite(minValue) || minValue >= 0) return 0;
  const lower = Math.floor(minValue / 10) * 10;
  return minValue % 10 === 0 ? lower - 10 : lower;
}

function nextPercentUpper(maxValue: number): number {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return 0;
  return (Math.floor(maxValue / 10) + 1) * 10;
}

/** Windows 등에서 금지된 문자만 처리. `/`는 전각 `／`로 바꿔 표시에 가깝게 유지 */
function buildChartExportFileName(stem: string, line: RightLineMode): string {
  const base = stem
    .replace(/[/\\]/g, "\uFF0F")
    .replace(/[:*?"<>|]/g, "-")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 120);
  const suffix = line === "unitPrice" ? "단가" : "증감률";
  const core = base.length > 0 ? base : "chart";
  return `${core}-${suffix}`;
}

export function TradeChartLoadingSkeleton() {
  const bars = [44, 68, 52, 74, 48, 62, 40, 70, 54, 64];

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="chart-skeleton-pulse h-7 w-44 rounded-full" />
          <div className="chart-skeleton-pulse h-7 w-36 rounded-full" />
          <div className="chart-skeleton-pulse h-7 w-28 rounded-full" />
        </div>
        <div className="chart-skeleton-pulse h-7 w-16 rounded-full" />
      </div>
      <div className="chart-skeleton-shell relative mx-auto flex w-full min-w-0 max-w-[880px] aspect-[4/3] min-h-[280px] overflow-hidden rounded-[22px] p-5">
        <div className="absolute inset-x-5 bottom-9 h-px bg-neutral-300" />
        <div className="absolute bottom-9 left-5 top-5 w-px bg-neutral-300" />
        <div className="absolute inset-0 overflow-hidden">
          <div className="chart-skeleton-shimmer absolute inset-y-0 -left-1/3 w-1/3" />
        </div>
        <div className="relative mt-auto flex h-full items-end gap-3">
          {bars.map((height, index) => (
            <div
              key={`skeleton-bar-${index}`}
              className="flex min-w-0 flex-1 items-end gap-2"
            >
              <div
                className="chart-skeleton-bar w-full rounded-t-sm"
                style={{ height: `${height}%`, animationDelay: `${index * 120}ms` }}
              />
              <div
                className="chart-skeleton-line w-1.5 rounded-full"
                style={{ height: `${Math.max(28, height - 8)}%`, animationDelay: `${index * 120 + 80}ms` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function TradeChart({
  categories,
  months,
  weightsKg,
  amountsMillionUsd,
  yoyPctWeight,
  yoyPctAmount,
  unitPrices,
  yoyPctUnitPrice,
  barLegendText,
  imexLabel,
  yoyComparisonLabel,
  saveImageNameStem,
}: TradeChartProps) {
  const [rightLine, setRightLine] = useState<RightLineMode>("yoy");
  const chartRef = useRef<ReactECharts>(null);

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
    return weightsKg.map((w) => Math.round(w * 100) / 100);
  }, [hasData, weightsKg]);

  const lineData = useMemo(() => {
    if (!hasData) return [];
    if (rightLine === "unitPrice") {
      return unitPrices.map((v) =>
        v === null || v === undefined || !Number.isFinite(v)
          ? ("-" as const)
          : Math.round(v),
      );
    }
    return yoyPctWeight.map((v) => (v === null || Number.isNaN(v) ? ("-" as const) : v));
  }, [hasData, rightLine, unitPrices, yoyPctWeight]);

  const barLegend = barLegendText;
  const lineLegend =
    rightLine === "unitPrice" ? `${imexLabel}단가(우)` : "증감률(우)";
  const leftUnit = "(천톤)";
  const rightAxisUnit = rightLine === "unitPrice" ? "(달러/톤)" : "(%)";

  const saveImageFileName = useMemo(
    () => buildChartExportFileName(saveImageNameStem, rightLine),
    [rightLine, saveImageNameStem],
  );

  const handleSaveImage = () => {
    const instance = chartRef.current?.getEchartsInstance();
    if (!instance) return;
    const url = instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#ffffff",
    });
    const link = document.createElement("a");
    link.href = url;
    link.download = `${saveImageFileName}.png`;
    link.click();
  };

  const n = categories.length;
  const useDataZoom = n > 24;
  const barMaxWidth = n > 120 ? 3 : n > 60 ? 5 : 10;
  const leftAxisMax = useMemo(() => {
    const finiteBars = finiteNumbers(barValues);
    return nextNiceUpper(Math.max(...finiteBars, 0));
  }, [barValues]);

  const rightAxisRange = useMemo(() => {
    if (rightLine === "unitPrice") {
      const finiteUnitPrices = finiteNumbers(unitPrices);
      return {
        min: 0,
        max: nextNiceUpper(Math.max(...finiteUnitPrices, 0)),
      };
    }

    const finiteYoy = finiteNumbers(yoyPctWeight);
    const minValue = Math.min(...finiteYoy, 0);
    const maxValue = Math.max(...finiteYoy, 0);
    return {
      min: previousPercentLower(minValue),
      max: nextPercentUpper(maxValue) || 10,
    };
  }, [rightLine, unitPrices, yoyPctWeight]);

  const option: EChartsOption = useMemo(() => {
    if (!hasData) return {};

    const leftAxis: EChartsOption["yAxis"] = {
      type: "value",
      name: leftUnit,
      nameLocation: "end",
      nameTextStyle: { align: "left", color: "#444", fontSize: 14 },
      position: "left",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontSize: 14 },
      min: 0,
      max: leftAxisMax,
    };

    const rightAxis: EChartsOption["yAxis"] = {
      type: "value",
      name: rightAxisUnit,
      nameLocation: "end",
      nameTextStyle: { align: "right", color: "#444", fontSize: 14 },
      position: "right",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontSize: 14 },
      min: rightAxisRange.min,
      max: rightAxisRange.max,
      scale: true,
    };

    /**
     * 매 월 칸은 유지하고 라벨만 기간 길이에 맞춰 줄인다.
     * 1년 내외: 3개월 단위 yy.mm, 3년 내외: 6개월 단위 yy.mm, 5년 이상: 연도만.
     */
    const xAxisLabelFormatter = (value: string, index: number) => {
      const m = /^(\d{4})\.(\d{2})$/.exec(String(value));
      if (!m) return String(value);
      const yy = m[1].slice(-2);
      const mm = m[2];
      const monthNumber = Number(mm);
      if (index === 0) return n >= 60 ? yy : `${yy}.${mm}`;
      if (n >= 60) return mm === "01" ? yy : "";
      const interval = n > 24 ? 6 : 3;
      if ((monthNumber - 1) % interval === 0) return `${yy}.${mm}`;
      return "";
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
          const fmtPct = (v: number | null | undefined) =>
            v === null || v === undefined || Number.isNaN(v)
              ? "-"
              : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
          const up = unitPrices[idx];
          const upStr =
            up !== undefined && Number.isFinite(up) ? String(Math.round(up)) : "-";
          const linePrimary =
            rightLine === "unitPrice"
              ? `${lineLegend}: ${upStr} (표와 동일)`
              : `${lineLegend}: ${fmtPct(yoyPctWeight[idx])} (중량·${yoyComparisonLabel})`;
          return `<div style="font-size:12px;line-height:1.55"><strong>${cat}</strong><br/>${barLegend}: ${b?.toLocaleString(undefined, { maximumFractionDigits: 2 })} 천톤<br/>${linePrimary}<br/>────────<br/>금액 YoY: ${fmtPct(yoyPctAmount[idx])}<br/>${imexLabel}단가: ${upStr}<br/>단가 YoY: ${fmtPct(yoyPctUnitPrice[idx])}</div>`;
        },
      },
      legend: {
        left: 8,
        top: 20,
        orient: "horizontal",
        itemGap: 20,
        textStyle: { fontSize: 14, color: "#333" },
        data: [barLegend, lineLegend],
      },
      grid: {
        left: 56,
        right: 56,
        top: 94,
        bottom: useDataZoom ? 56 : 44,
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
          fontSize: 14,
          interval: 0,
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
    leftAxisMax,
    lineLegend,
    rightAxisUnit,
    rightAxisRange,
    rightLine,
    n,
    useDataZoom,
    lineData,
    yoyPctAmount,
    yoyPctUnitPrice,
    yoyPctWeight,
    unitPrices,
    imexLabel,
    yoyComparisonLabel,
  ]);

  if (!hasData) {
    return (
      <div
        className="flex h-[320px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600"
        role="status"
      >
        <p className="font-semibold text-slate-700">차트: 데이터 없음</p>
        <p className="mt-1 max-w-sm px-4 text-slate-500">
          시계열이 비어 있어 ECharts를 렌더링하지 않습니다.
        </p>
      </div>
    );
  }

  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-bold uppercase tracking-[0.18em] text-neutral-500">
            우측 선
          </span>
          <div className="glass-field inline-flex rounded-full p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setRightLine("unitPrice")}
              className={`rounded-full px-3 py-1 !text-[12px] font-semibold transition-colors ${
                rightLine === "unitPrice"
                  ? "bg-[#303030] text-white shadow-sm"
                  : "text-neutral-600 hover:bg-white/48 hover:text-[#303030]"
              }`}
            >
              {imexLabel}단가
            </button>
            <button
              type="button"
              onClick={() => setRightLine("yoy")}
              className={`rounded-full px-3 py-1 !text-[12px] font-semibold transition-colors ${
                rightLine === "yoy"
                  ? "bg-[#303030] text-white shadow-sm"
                  : "text-neutral-600 hover:bg-white/48 hover:text-[#303030]"
              }`}
            >
              증감률
            </button>
          </div>
          <span className="rounded-full bg-white/34 px-4 py-2 text-sm font-medium text-neutral-600 ring-1 ring-white/60">
            막대: 중량(천톤) 고정
          </span>
          {useDataZoom ? (
            <span className="rounded-full bg-white/34 px-4 py-2 text-xs font-medium text-neutral-600 ring-1 ring-white/60">
              긴 구간: 아래 슬라이더·트랙패드로 이동·확대
            </span>
          ) : null}
        </div>

        <button
          type="button"
          onClick={handleSaveImage}
          className="glass-field inline-flex items-center gap-1 rounded-full px-2 py-1 !text-[12px] font-semibold text-[#303030] transition hover:bg-white/58 focus:outline-none focus:ring-2 focus:ring-yellow-300/70"
        >
          <span
            className="relative h-3.5 w-3.5"
            aria-hidden="true"
          >
            <span className="absolute bottom-0 left-0 h-px w-full bg-[#303030]" />
            <span className="absolute left-1/2 top-0 h-2.5 w-px -translate-x-1/2 bg-[#303030]" />
            <span className="absolute left-1/2 top-[5px] h-1.5 w-1.5 -translate-x-1/2 rotate-45 border-b border-r border-[#303030]" />
          </span>
          저장
        </button>
      </div>
      <div className="relative mx-auto w-full min-w-0 max-w-[880px] aspect-[4/3] min-h-[208px] overflow-hidden rounded-lg bg-white">
        <div className="absolute inset-0 min-h-[208px]">
          <ReactECharts
            ref={chartRef}
            option={option}
            style={{ height: "100%", width: "100%" }}
            opts={{
              renderer: "canvas",
              devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
            }}
            notMerge={false}
            lazyUpdate={false}
          />
        </div>
      </div>
    </div>
  );
}
