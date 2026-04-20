"use client";

import type { EChartsOption } from "echarts";
import { useMemo, useState } from "react";
import ReactECharts from "echarts-for-react";

/** 우측 파란 선: 단가(표와 동일 지표) 또는 중량 전년동월 증감률 */
type RightLineMode = "unitPrice" | "yoy";

type TradeChartProps = {
  /** X축 라벨 (예: 2020.01) */
  categories: string[];
  /** YoY·정렬용 원본 월 `YYYY-MM` */
  months: string[];
  /** 중량(천톤) — 좌축 막대와 동일 단위 */
  weightsKg: number[];
  /** 백만 USD */
  amountsMillionUsd: number[];
  /** 표와 동일한 전년 동월 대비 중량 증감률(YoY, %) — `filteredRows` 순서와 동일 길이 */
  yoyPctWeight: (number | null)[];
  /** 전년 동월 대비 금액 증감률(%) — 동일 길이 */
  yoyPctAmount: (number | null)[];
  /** 표와 동일: 단가 = 금액×1000/중량(천톤) */
  unitPrices: number[];
  /** 단가 지표 전년 동월比(%) */
  yoyPctUnitPrice: (number | null)[];
  /** 회색 막대 범례 (예: 일본산 중후판) */
  barLegendText: string;
  /** 수입 | 수출 */
  imexLabel: string;
  /** PNG 저장 파일명 앞부분 (예: `미국 · 중후판 / 2020.01~2023.05`) */
  saveImageNameStem: string;
};

const BAR_GRAY = "#c0c0c0";
const LINE_BLUE = "#003399";

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
  saveImageNameStem,
}: TradeChartProps) {
  const [rightLine, setRightLine] = useState<RightLineMode>("yoy");

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
    return weightsKg.map((w) => Math.round(w * 1000) / 1000);
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
      name: rightAxisUnit,
      nameLocation: "end",
      nameTextStyle: { align: "right", color: "#444", fontSize: 11 },
      position: "right",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontSize: 11 },
      scale: true,
    };

    /** 매 월 칸은 두되 라벨은 연도 전환·1월·구간 첫 달에만 'YY (같은 해 반복 방지) */
    const xAxisLabelFormatter = (value: string, index: number) => {
      const m = /^(\d{4})\.(\d{2})$/.exec(String(value));
      if (!m) return String(value);
      const yy = `'${m[1].slice(-2)}`;
      if (index === 0) return yy;
      if (m[2] === "01") return yy;
      const prevVal = categories[index - 1];
      const pm =
        typeof prevVal === "string" ? /^(\d{4})\.(\d{2})$/.exec(prevVal) : null;
      if (pm && pm[1] !== m[1]) return yy;
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
              : `${lineLegend}: ${fmtPct(yoyPctWeight[idx])} (중량·전년 동월比)`;
          return `<div style="font-size:12px;line-height:1.55"><strong>${cat}</strong><br/>${barLegend}: ${b?.toLocaleString(undefined, { maximumFractionDigits: 2 })} 천톤<br/>${linePrimary}<br/>────────<br/>금액 YoY: ${fmtPct(yoyPctAmount[idx])}<br/>${imexLabel}단가: ${upStr}<br/>단가 YoY: ${fmtPct(yoyPctUnitPrice[idx])}</div>`;
        },
      },
      toolbox: {
        right: 12,
        top: 4,
        feature: {
          saveAsImage: {
            show: true,
            title: "PNG 저장",
            name: saveImageFileName,
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
          fontSize: 11,
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
    barLegendText,
    barMaxWidth,
    barValues,
    categories,
    hasData,
    leftUnit,
    lineLegend,
    rightAxisUnit,
    rightLine,
    n,
    saveImageFileName,
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
        className="flex h-[320px] w-full flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center text-sm text-slate-600"
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
          우측 선
        </span>
        <div className="inline-flex rounded-lg bg-slate-100 p-0.5 ring-1 ring-slate-200/80">
          <button
            type="button"
            onClick={() => setRightLine("unitPrice")}
            className={`rounded-md ${togglePad} font-medium transition-colors ${
              rightLine === "unitPrice"
                ? "bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            {imexLabel}단가
          </button>
          <button
            type="button"
            onClick={() => setRightLine("yoy")}
            className={`rounded-md ${togglePad} font-medium transition-colors ${
              rightLine === "yoy"
                ? "bg-white text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            증감률
          </button>
        </div>
        <span className="text-xs text-slate-500">막대: 중량(천톤) 고정</span>
        {useDataZoom ? (
          <span className="text-xs text-slate-500">
            긴 구간: 아래 슬라이더·트랙패드로 이동·확대할 수 있습니다.
          </span>
        ) : null}
      </div>
      <div className="relative mx-auto w-full min-w-0 max-w-[880px] aspect-[4/3] min-h-[208px] overflow-hidden rounded-lg bg-white">
        <div className="absolute inset-0 min-h-[208px]">
          <ReactECharts
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
