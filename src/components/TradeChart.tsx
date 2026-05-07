"use client";

import { init } from "echarts";
import type { EChartsOption } from "echarts";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactECharts from "echarts-for-react";

/** 우측 파란 선: 단가(표와 동일 지표) 또는 중량 전년동월 증감률 */
type RightLineMode = "unitPrice" | "yoy";
type ExportSizeMode = "compact" | "wide";

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
const CHART_FONT_FAMILY = '"NanumGothic", ui-sans-serif, system-ui, sans-serif';
const EXPORT_BAR_GRAY = "#bfbfbf";
const EXPORT_SIZE_PRESETS: Record<ExportSizeMode, { height: number; width: number }> = {
  compact: { height: 199, width: 281 },
  wide: { height: 233, width: 446 },
};
const PT_TO_PX = 96 / 72;
const EXPORT_FONT_SIZE = 8 * PT_TO_PX;
const EXPORT_LEGEND_FONT_SIZE = 9 * PT_TO_PX;
const EXPORT_UNIT_FONT_SIZE = 9 * PT_TO_PX;
const EXPORT_AXIS_WIDTH = 1;
const EXPORT_LINE_WIDTH = 1 * PT_TO_PX;

function finiteNumbers(values: (number | null | undefined)[]): number[] {
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
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

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function waitForChartFont(size: string): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;

  await Promise.allSettled([
    document.fonts.load(`400 ${size} "NanumGothic"`),
    document.fonts.load(`700 ${size} "NanumGothic"`),
    document.fonts.ready,
  ]);
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
  const [exportSize, setExportSize] = useState<ExportSizeMode>("compact");
  const [chartFontReady, setChartFontReady] = useState(false);
  const chartRef = useRef<ReactECharts>(null);

  useEffect(() => {
    let isMounted = true;

    if (typeof document === "undefined" || !document.fonts) {
      Promise.resolve().then(() => {
        if (isMounted) setChartFontReady(true);
      });
      return;
    }

    waitForChartFont("14px").then(() => {
      if (!isMounted) return;
      setChartFontReady(true);
      requestAnimationFrame(() => {
        chartRef.current?.getEchartsInstance().resize();
      });
    });

    return () => {
      isMounted = false;
    };
  }, []);

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
  const exportDimensions = EXPORT_SIZE_PRESETS[exportSize];

  const downloadChartImage = (url: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = `${saveImageFileName}.png`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
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

  const useYDataZoom = useMemo(() => {
    if (!hasData) return false;

    const finiteBars = finiteNumbers(barValues);
    const finiteLine =
      rightLine === "unitPrice" ? finiteNumbers(unitPrices) : finiteNumbers(yoyPctWeight);
    const barMedian = median(finiteBars);
    const lineMedian = median(finiteLine.map((value) => Math.abs(value)));
    const barHasSpike = barMedian > 0 && Math.max(...finiteBars, 0) >= barMedian * 2.4;
    const lineHasSpike =
      rightLine === "yoy"
        ? rightAxisRange.max - rightAxisRange.min >= 100
        : lineMedian > 0 && Math.max(...finiteLine, 0) >= lineMedian * 2.4;

    return barHasSpike || lineHasSpike;
  }, [barValues, hasData, rightAxisRange, rightLine, unitPrices, yoyPctWeight]);

  const option: EChartsOption = useMemo(() => {
    if (!hasData) return {};

    const leftAxis: EChartsOption["yAxis"] = {
      type: "value",
      name: "",
      nameLocation: "end",
      nameTextStyle: { align: "left", color: "#444", fontFamily: CHART_FONT_FAMILY, fontSize: 14 },
      position: "left",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontFamily: CHART_FONT_FAMILY, fontSize: 14 },
      min: 0,
      max: leftAxisMax,
    };

    const rightAxis: EChartsOption["yAxis"] = {
      type: "value",
      name: "",
      nameLocation: "end",
      nameTextStyle: { align: "right", color: "#444", fontFamily: CHART_FONT_FAMILY, fontSize: 14 },
      position: "right",
      axisLine: { show: true, lineStyle: { color: "#999" } },
      axisTick: { show: true },
      splitLine: { show: false },
      axisLabel: { color: "#555", fontFamily: CHART_FONT_FAMILY, fontSize: 14 },
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

    const dataZoom: Exclude<EChartsOption["dataZoom"], undefined> = [];

    if (useDataZoom) {
      dataZoom.push(
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
          textStyle: { fontFamily: CHART_FONT_FAMILY },
        },
      );
    }

    if (useYDataZoom) {
      dataZoom.push({
        type: "slider",
        yAxisIndex: [0, 1],
        filterMode: "none",
        width: 18,
        right: 8,
        top: 94,
        bottom: useDataZoom ? 56 : 44,
        handleStyle: { color: "#94a3b8" },
        dataBackground: {
          areaStyle: { color: "#e2e8f0" },
          lineStyle: { color: "#cbd5e1" },
        },
        textStyle: { fontFamily: CHART_FONT_FAMILY },
      });
    }

    return {
      color: [BAR_GRAY, LINE_BLUE],
      animation: n < 400,
      textStyle: {
        fontFamily: CHART_FONT_FAMILY,
      },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "cross" },
        textStyle: { fontFamily: CHART_FONT_FAMILY },
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
          return `<div style="font-family:${CHART_FONT_FAMILY};font-size:12px;line-height:1.55"><strong>${cat}</strong><br/>${barLegend}: ${b?.toLocaleString(undefined, { maximumFractionDigits: 2 })} 천톤<br/>${linePrimary}<br/>────────<br/>금액 YoY: ${fmtPct(yoyPctAmount[idx])}<br/>${imexLabel}단가: ${upStr}<br/>단가 YoY: ${fmtPct(yoyPctUnitPrice[idx])}</div>`;
        },
      },
      legend: {
        left: 8,
        top: 20,
        orient: "horizontal",
        itemGap: 20,
        textStyle: { fontFamily: CHART_FONT_FAMILY, fontSize: 14, color: "#333" },
        data: [barLegend, lineLegend],
      },
      graphic: [
        {
          type: "text",
          left: 24,
          top: 62,
          style: {
            text: leftUnit,
            fill: "#444",
            font: `14px ${CHART_FONT_FAMILY}`,
          },
        },
        {
          type: "text",
          right: useYDataZoom ? 60 : 30,
          top: 62,
          style: {
            text: rightAxisUnit,
            fill: "#444",
            font: `14px ${CHART_FONT_FAMILY}`,
          },
        },
      ],
      grid: {
        left: 56,
        right: useYDataZoom ? 82 : 56,
        top: 94,
        bottom: useDataZoom ? 56 : 44,
        containLabel: false,
      },
      dataZoom: dataZoom.length > 0 ? dataZoom : undefined,
      xAxis: {
        type: "category",
        data: categories,
        boundaryGap: true,
        axisLine: { show: true, lineStyle: { color: "#999" } },
        axisTick: { show: true, alignWithLabel: true },
        axisLabel: {
          color: "#555",
          fontFamily: CHART_FONT_FAMILY,
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
    useYDataZoom,
    lineData,
    yoyPctAmount,
    yoyPctUnitPrice,
    yoyPctWeight,
    unitPrices,
    imexLabel,
    yoyComparisonLabel,
  ]);

  const exportOption: EChartsOption = useMemo(() => {
    if (!hasData) return {};

    const exportAxisLine = {
      show: true,
      lineStyle: { color: "#000000", width: EXPORT_AXIS_WIDTH },
    };
    const exportAxisTick = {
      show: true,
      lineStyle: { color: "#000000", width: EXPORT_AXIS_WIDTH },
    };
    const exportTextStyle = {
      color: "#000000",
      fontFamily: CHART_FONT_FAMILY,
      fontSize: EXPORT_FONT_SIZE,
    };
    const graphicLegendTextStyle = {
      fill: "#000000",
      font: `${EXPORT_LEGEND_FONT_SIZE}px ${CHART_FONT_FAMILY}`,
    };
    const graphicUnitTextStyle = {
      fill: "#000000",
      font: `${EXPORT_UNIT_FONT_SIZE}px ${CHART_FONT_FAMILY}`,
    };

    const xAxisLabelFormatter = (value: string, index: number) => {
      const yearly = /^(\d{4})$/.exec(String(value));
      if (yearly) return `${yearly[1].slice(-2)}'`;

      const monthly = /^(\d{4})\.(\d{2})$/.exec(String(value));
      if (!monthly) return String(value);
      const yy = monthly[1].slice(-2);
      const mm = monthly[2];
      const mCompact = String(Number(mm));
      const monthNumber = Number(mm);
      if (index === 0) return n >= 60 ? `${yy}'` : `${yy}.${mCompact}`;
      if (n >= 60) return mm === "01" ? `${yy}'` : "";
      const interval = n > 24 ? 6 : 3;
      if ((monthNumber - 1) % interval === 0) return `${yy}.${mCompact}`;
      return "";
    };
    const visibleXAxisTickValues = categories.filter(
      (value, index) => xAxisLabelFormatter(value, index) !== "",
    );

    return {
      animation: false,
      backgroundColor: "#ffffff",
      color: [EXPORT_BAR_GRAY, LINE_BLUE],
      textStyle: {
        fontFamily: CHART_FONT_FAMILY,
        fontSize: EXPORT_FONT_SIZE,
      },
      legend: { show: false },
      graphic: [
        {
          type: "text",
          left: 10,
          top: 10,
          style: { ...graphicUnitTextStyle, text: leftUnit },
        },
        {
          type: "text",
          right: 4,
          top: 10,
          style: { ...graphicUnitTextStyle, text: rightAxisUnit },
        },
        {
          type: "rect",
          left: 58,
          top: 16,
          shape: { width: 30, height: 5.2 },
          style: { fill: EXPORT_BAR_GRAY },
        },
        {
          type: "text",
          left: 100,
          top: 12,
          style: { ...graphicLegendTextStyle, text: barLegend },
        },
        {
          type: "rect",
          left: 58,
          top: 31,
          shape: { width: 30, height: EXPORT_LINE_WIDTH },
          style: { fill: LINE_BLUE },
        },
        {
          type: "text",
          left: 100,
          top: 26,
          style: { ...graphicLegendTextStyle, text: lineLegend },
        },
      ],
      grid: {
        left: 44,
        right: 36,
        top: 37,
        bottom: 22,
        containLabel: false,
      },
      tooltip: { show: false },
      dataZoom: undefined,
      xAxis: {
        type: "category",
        data: categories,
        boundaryGap: true,
        axisLine: exportAxisLine,
        axisTick: {
          ...exportAxisTick,
          alignWithLabel: true,
          customValues: visibleXAxisTickValues,
        },
        splitLine: { show: false },
        axisLabel: {
          ...exportTextStyle,
          interval: 0,
          formatter: xAxisLabelFormatter,
        },
      },
      yAxis: [
        {
          type: "value",
          name: "",
          nameLocation: "end",
          nameGap: 7,
          nameTextStyle: { ...exportTextStyle, align: "left", verticalAlign: "bottom" },
          position: "left",
          axisLine: exportAxisLine,
          axisTick: exportAxisTick,
          splitLine: { show: false },
          axisLabel: exportTextStyle,
          min: 0,
          max: leftAxisMax,
        },
        {
          type: "value",
          name: "",
          nameLocation: "end",
          nameGap: 7,
          nameTextStyle: { ...exportTextStyle, align: "right", verticalAlign: "bottom" },
          position: "right",
          axisLine: exportAxisLine,
          axisTick: exportAxisTick,
          splitLine: { show: false },
          axisLabel: exportTextStyle,
          min: rightAxisRange.min,
          max: rightAxisRange.max,
          scale: true,
        },
      ],
      series: [
        {
          name: barLegend,
          type: "bar",
          yAxisIndex: 0,
          data: barValues,
          barMaxWidth: n > 80 ? 4 : 12,
          barCategoryGap: n > 80 ? "25%" : "48%",
          itemStyle: {
            color: EXPORT_BAR_GRAY,
            borderColor: EXPORT_BAR_GRAY,
            borderWidth: EXPORT_AXIS_WIDTH,
            borderRadius: 0,
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
          showSymbol: false,
          connectNulls: true,
          lineStyle: { width: EXPORT_LINE_WIDTH, color: LINE_BLUE },
          itemStyle: { color: LINE_BLUE },
        },
      ],
    };
  }, [
    barLegend,
    barValues,
    categories,
    hasData,
    leftUnit,
    leftAxisMax,
    lineLegend,
    rightAxisUnit,
    rightAxisRange,
    n,
    lineData,
  ]);

  const handleSaveImage = async () => {
    if (!hasData || typeof document === "undefined") return;

    try {
      await waitForChartFont("8pt");

      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.left = `-${exportDimensions.width * 2}px`;
      container.style.top = "0";
      container.style.width = `${exportDimensions.width}px`;
      container.style.height = `${exportDimensions.height}px`;
      container.style.pointerEvents = "none";
      document.body.appendChild(container);

      const exportChart = init(container, null, {
        renderer: "canvas",
        width: exportDimensions.width,
        height: exportDimensions.height,
        devicePixelRatio: 1,
      });

      try {
        exportChart.setOption(exportOption, true);
        await waitForNextFrame();
        await waitForNextFrame();
        downloadChartImage(
          exportChart.getDataURL({
            type: "png",
            pixelRatio: 1,
            backgroundColor: "#ffffff",
          }),
        );
      } finally {
        exportChart.dispose();
        container.remove();
      }
    } catch (error) {
      console.error("Failed to export chart image", error);
    }
  };

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

        <div className="flex items-center gap-2">
          <select
            value={exportSize}
            onChange={(event) => setExportSize(event.target.value as ExportSizeMode)}
            className="glass-field rounded-full px-2 py-1 !text-[12px] font-semibold text-[#303030] focus:outline-none focus:ring-2 focus:ring-yellow-300/70"
            aria-label="PNG 저장 크기"
          >
            <option value="compact">기본</option>
            <option value="wide">가로 확장</option>
          </select>
          <button
            type="button"
            onClick={() => {
              void handleSaveImage();
            }}
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
      </div>
      <div
        className="relative mx-auto w-full min-w-0 max-w-[880px] aspect-[4/3] min-h-[208px] overflow-hidden rounded-lg bg-white"
        style={{ fontFamily: CHART_FONT_FAMILY }}
      >
        <div className="absolute inset-0 min-h-[208px]">
          <ReactECharts
            key={chartFontReady ? "nanum-gothic-ready" : "nanum-gothic-loading"}
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
