"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CUSTOMS_CONTINENT_OPTIONS,
  type CustomsContinentCode,
} from "@/constants/customsContinentCodes";
import {
  CUSTOMS_COUNTRY_OPTIONS,
  type CustomsCountryId,
} from "@/constants/customsCountryCodes";
import { HS_CODE_MAP } from "@/constants/hsCodes";
import { COUNTRY_FILTER_ALL } from "@/constants/mappings";
import { TradeChart } from "@/components/TradeChart";
import type { TradeApiResponse, TradeRow } from "@/types/trade";

const HS_PRODUCT_KEYS = Object.keys(HS_CODE_MAP);
const KOREAN_MONTH_LABELS = [
  "1월",
  "2월",
  "3월",
  "4월",
  "5월",
  "6월",
  "7월",
  "8월",
  "9월",
  "10월",
  "11월",
  "12월",
] as const;
const MIN_PICKER_YEAR = 2010;
const MAX_PICKER_YEAR = new Date().getFullYear();

export type TradeDirection = "import" | "export";

export type RegionScopeTab = "country" | "continent";
type PeriodGranularity = "monthly" | "yearly";

/** 국가별: 단일 cntyCd 또는 전체 합계(ALL) */
export type CountryChoiceId = CustomsCountryId | typeof COUNTRY_FILTER_ALL;

type EnrichedRow = TradeRow & {
  /** 수입·수출 단가 = 금액×1000/중량(천톤) — 금액 백만 USD, 예: 33.27·42.29 → ≈787 */
  unitPrice: number;
  /** 연단위 동기간 비교(YTD) 여부 */
  isYtdComparison: boolean;
  /** 중량 전년 동월比(YoY) */
  yoyDisplay: string;
  yoyValue: number | null;
  /** 금액 전년 동월比(YoY) */
  yoyAmountDisplay: string;
  yoyAmountValue: number | null;
  /** 단가(위 지표) 전년 동월比(YoY) */
  unitPriceYoyDisplay: string;
  unitPriceYoyValue: number | null;
};

type FilterSnapshot = {
  regionTab: RegionScopeTab;
  periodMode: PeriodGranularity;
  startMonth: string;
  endMonth: string;
  startYear: number;
  endYear: number;
  productKey: string;
  countryId: CountryChoiceId;
  continentCode: CustomsContinentCode;
};

type AppliedQuery = FilterSnapshot;

const DEFAULT_CONTINENT: CustomsContinentCode = 10;

function getDefaultRecentYearRange(): { startMonth: string; endMonth: string } {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), 1);
  const start = new Date(end.getFullYear(), end.getMonth() - 11, 1);
  const toYm = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  return { startMonth: toYm(start), endMonth: toYm(end) };
}

function getDefaultYearRange(endMonth: string): { startYear: number; endYear: number } {
  const endYear = monthValueToParts(endMonth).year;
  return { startYear: Math.max(MIN_PICKER_YEAR, endYear - 4), endYear };
}

/** `YYYY-MM` 기준으로 `delta`개월 이동 */
function addCalendarMonthsYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** 국가별 API: 금액(백만 USD)×1000 ÷ 중량(천톤) = USD/톤 */
function unitPriceFromCountryRow(row: TradeRow): number {
  const { amount, weight } = row;
  if (weight === 0 || !Number.isFinite(weight)) return 0;
  if (!Number.isFinite(amount)) return 0;
  return (amount * 1000) / weight;
}

/** 대륙별도 API 레이어에서 중량을 천톤으로 정규화하므로 국가별과 동일 공식 사용 */
function unitPriceFromContinentRow(row: TradeRow): number {
  return unitPriceFromCountryRow(row);
}

function roundToTwo(v: number): number {
  return Math.round(v * 100) / 100;
}

function pctDisplay(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

/**
 * 전년 동월(같은 달, 12개월 전) 대비 중량·금액·단가 증감률(YoY).
 * 조회 시작월보다 12개월 이전 구간을 API로 받아 두면 첫 행도 채워짐.
 */
function enrichTradeRows(
  rows: TradeRow[],
  regionTab: RegionScopeTab,
): EnrichedRow[] {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(sorted.map((r) => [r.month, r]));
  const unitPriceFromRow =
    regionTab === "continent" ? unitPriceFromContinentRow : unitPriceFromCountryRow;

  return sorted.map((row) => {
    const unitPrice = unitPriceFromRow(row);
    const prevPeriod = addCalendarMonthsYm(row.month, -12);
    const prevYear = byMonth.get(prevPeriod);

    let yoyDisplay = "-";
    let yoyValue: number | null = null;
    if (prevYear !== undefined && prevYear.weight > 0) {
      yoyValue = Math.round(((row.weight - prevYear.weight) / prevYear.weight) * 1000) / 10;
      yoyDisplay = pctDisplay(yoyValue);
    }

    let yoyAmountDisplay = "-";
    let yoyAmountValue: number | null = null;
    if (prevYear !== undefined && Math.abs(prevYear.amount) > 1e-12) {
      yoyAmountValue =
        Math.round(((row.amount - prevYear.amount) / prevYear.amount) * 1000) / 10;
      yoyAmountDisplay = pctDisplay(yoyAmountValue);
    }

    let unitPriceYoyDisplay = "-";
    let unitPriceYoyValue: number | null = null;
    if (prevYear !== undefined && prevYear.weight > 0) {
      const prevUp = unitPriceFromRow(prevYear);
      if (prevUp > 0 && unitPrice >= 0) {
        unitPriceYoyValue = Math.round(((unitPrice - prevUp) / prevUp) * 1000) / 10;
        unitPriceYoyDisplay = pctDisplay(unitPriceYoyValue);
      }
    }

    return {
      ...row,
      unitPrice,
      isYtdComparison: false,
      yoyDisplay,
      yoyValue,
      yoyAmountDisplay,
      yoyAmountValue,
      unitPriceYoyDisplay,
      unitPriceYoyValue,
    };
  });
}

function enrichYearlyTradeRows(
  monthlyRows: TradeRow[],
  regionTab: RegionScopeTab,
): EnrichedRow[] {
  const unitPriceFromRow =
    regionTab === "continent" ? unitPriceFromContinentRow : unitPriceFromCountryRow;
  const monthlyByKey = new Map(monthlyRows.map((row) => [row.month, row]));
  const yearly = new Map<
    string,
    { weight: number; amount: number; months: Set<number> }
  >();

  for (const row of monthlyRows) {
    const match = /^(\d{4})-(\d{2})$/.exec(row.month);
    if (!match) continue;
    const year = match[1];
    const monthNumber = Number(match[2]);
    const cur = yearly.get(year) ?? { weight: 0, amount: 0, months: new Set<number>() };
    cur.weight += row.weight;
    cur.amount += row.amount;
    cur.months.add(monthNumber);
    yearly.set(year, cur);
  }

  const yearlyRows: TradeRow[] = [...yearly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      weight: Math.round(v.weight * 1_000_000) / 1_000_000,
      amount: Math.round(v.amount * 1_000_000) / 1_000_000,
    }));

  return yearlyRows.map((row) => {
    const unitPrice = unitPriceFromRow(row);
    const prevYearKey = String(Number(row.month) - 1);
    const currentMonths = [...(yearly.get(row.month)?.months ?? new Set<number>())].sort(
      (a, b) => a - b,
    );
    const isYtdComparison = currentMonths.length > 0 && currentMonths.length < 12;

    let prevComparable: TradeRow | null = null;
    if (currentMonths.length > 0) {
      let weight = 0;
      let amount = 0;
      for (const monthNumber of currentMonths) {
        const monthKey = `${prevYearKey}-${String(monthNumber).padStart(2, "0")}`;
        const prevMonthRow = monthlyByKey.get(monthKey);
        if (!prevMonthRow) continue;
        weight += prevMonthRow.weight;
        amount += prevMonthRow.amount;
      }
      prevComparable = {
        month: prevYearKey,
        weight: Math.round(weight * 1_000_000) / 1_000_000,
        amount: Math.round(amount * 1_000_000) / 1_000_000,
      };
    }

    let yoyDisplay = "-";
    let yoyValue: number | null = null;
    if (prevComparable && prevComparable.weight > 0) {
      yoyValue = Math.round(((row.weight - prevComparable.weight) / prevComparable.weight) * 1000) / 10;
      yoyDisplay = `${pctDisplay(yoyValue)}${isYtdComparison ? " (YTD)" : ""}`;
    }

    let yoyAmountDisplay = "-";
    let yoyAmountValue: number | null = null;
    if (prevComparable && Math.abs(prevComparable.amount) > 1e-12) {
      yoyAmountValue =
        Math.round(((row.amount - prevComparable.amount) / prevComparable.amount) * 1000) / 10;
      yoyAmountDisplay = `${pctDisplay(yoyAmountValue)}${isYtdComparison ? " (YTD)" : ""}`;
    }

    let unitPriceYoyDisplay = "-";
    let unitPriceYoyValue: number | null = null;
    if (prevComparable && prevComparable.weight > 0) {
      const prevUnitPrice = unitPriceFromRow(prevComparable);
      if (prevUnitPrice > 0 && unitPrice >= 0) {
        unitPriceYoyValue =
          Math.round(((unitPrice - prevUnitPrice) / prevUnitPrice) * 1000) / 10;
        unitPriceYoyDisplay = `${pctDisplay(unitPriceYoyValue)}${isYtdComparison ? " (YTD)" : ""}`;
      }
    }

    return {
      ...row,
      unitPrice,
      isYtdComparison,
      yoyDisplay,
      yoyValue,
      yoyAmountDisplay,
      yoyAmountValue,
      unitPriceYoyDisplay,
      unitPriceYoyValue,
    };
  });
}

function formatMonthDot(ym: string): string {
  if (/^\d{4}$/.test(ym)) return ym;
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${y}.${m}`;
}

function monthInputToYymm(ym: string): string {
  return ym.replace(/-/g, "").slice(0, 6);
}

function monthValueToParts(ym: string): { year: number; monthIndex: number } {
  const [yearRaw, monthRaw] = ym.split("-").map(Number);
  const fallback = new Date();
  const year = Number.isFinite(yearRaw) ? yearRaw : fallback.getFullYear();
  const month = Number.isFinite(monthRaw) ? monthRaw : fallback.getMonth() + 1;
  return {
    year,
    monthIndex: Math.max(0, Math.min(11, month - 1)),
  };
}

function buildMonthValue(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
}

function normalizeMonthRange(s: string, e: string): { start: string; end: string } {
  if (s <= e) return { start: s, end: e };
  return { start: e, end: s };
}

function normalizeYearRange(s: number, e: number): { start: number; end: number } {
  return s <= e ? { start: s, end: e } : { start: e, end: s };
}

function clampPickerYear(year: number): number {
  if (!Number.isFinite(year)) return MAX_PICKER_YEAR;
  return Math.max(MIN_PICKER_YEAR, Math.min(MAX_PICKER_YEAR, Math.trunc(year)));
}

function periodRangeLabel(s: FilterSnapshot): string {
  if (s.periodMode === "yearly") {
    return s.startYear === s.endYear
      ? `${s.startYear}`
      : `${s.startYear}~${s.endYear}`;
  }
  return `${formatMonthDot(s.startMonth)}~${formatMonthDot(s.endMonth)}`;
}

function regionLabelFromSnap(s: FilterSnapshot): string {
  if (s.regionTab === "continent") {
    const name =
      CUSTOMS_CONTINENT_OPTIONS.find((o) => o.code === s.continentCode)?.name ??
      String(s.continentCode);
    return `${name}(대륙) · ${s.productKey}`;
  }
  if (s.countryId === COUNTRY_FILTER_ALL) {
    return `전체 합계(모든 국가) · ${s.productKey}`;
  }
  const cname =
    CUSTOMS_COUNTRY_OPTIONS.find((o) => o.id === s.countryId)?.name ?? s.countryId;
  return `${cname} · ${s.productKey}`;
}

/** 차트 회색 막대 범례: 수입은 「일본산」, 수출은 「일본향」 */
function tradeChartBarLegend(s: FilterSnapshot, direction: TradeDirection): string {
  const suffix = direction === "import" ? "산" : "향";
  if (s.regionTab === "continent") {
    const name =
      CUSTOMS_CONTINENT_OPTIONS.find((o) => o.code === s.continentCode)?.name ??
      String(s.continentCode);
    return `${name}${suffix} ${s.productKey}`;
  }
  if (s.countryId === COUNTRY_FILTER_ALL) {
    return `전체 ${s.productKey}`;
  }
  const cname =
    CUSTOMS_COUNTRY_OPTIONS.find((o) => o.id === s.countryId)?.name ?? s.countryId;
  return `${cname}${suffix} ${s.productKey}`;
}

function apiLabelForTab(tab: RegionScopeTab): string {
  return tab === "country" ? "품목·국가별(GW)" : "품목·대륙별(GW)";
}

function RegionScopeTabs({
  value,
  onChange,
}: {
  value: RegionScopeTab;
  onChange: (id: RegionScopeTab) => void;
}) {
  const items: { id: RegionScopeTab; label: string }[] = [
    { id: "country", label: "국가별" },
    { id: "continent", label: "대륙별" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-full bg-white/32 p-1 ring-1 ring-white/60">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              active
                ? "bg-[#303030] text-white shadow-sm"
                : "text-neutral-700 hover:bg-white/50 hover:text-[#303030]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function PeriodModeTabs({
  value,
  onChange,
}: {
  value: PeriodGranularity;
  onChange: (id: PeriodGranularity) => void;
}) {
  const items: { id: PeriodGranularity; label: string }[] = [
    { id: "monthly", label: "월단위" },
    { id: "yearly", label: "연단위" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-full bg-white/32 p-1 ring-1 ring-white/60">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`rounded-full px-4 py-2.5 text-sm font-semibold transition-colors ${
              active
                ? "bg-[#303030] text-white shadow-sm"
                : "text-neutral-700 hover:bg-white/50 hover:text-[#303030]"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function YearGridPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  const safeValue = clampPickerYear(value);
  const [displayYear, setDisplayYear] = useState(safeValue);
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const decadeStart = Math.floor(displayYear / 10) * 10;
  const years = Array.from({ length: 12 }, (_, i) => decadeStart - 1 + i).filter(
    (year) => year >= MIN_PICKER_YEAR && year <= MAX_PICKER_YEAR,
  );

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setDisplayYear(safeValue);
          setOpen((current) => !current);
        }}
        className="glass-field flex w-full items-center justify-between gap-3 rounded-full px-4 py-3 text-left text-sm transition hover:bg-white/48 focus:outline-none focus:ring-2 focus:ring-yellow-300/70"
        aria-expanded={open}
      >
        <span>
          <span className="block text-xs font-bold uppercase tracking-[0.16em] text-neutral-500">
            {label}
          </span>
          <span className="mt-0.5 block font-semibold tabular-nums text-[#303030]">
            {safeValue}년
          </span>
        </span>
        <span
          className="h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-neutral-500 transition-transform"
          style={{ transform: open ? "rotate(225deg)" : "rotate(45deg)" }}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <section className="absolute left-0 right-0 top-[calc(100%+10px)] z-40 rounded-[26px] bg-white p-4 shadow-[0_24px_64px_rgba(64,45,82,0.18)] ring-1 ring-neutral-200">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setDisplayYear((year) => {
                  const nextYear = Math.max(MIN_PICKER_YEAR, year - 10);
                  return nextYear;
                });
              }}
              disabled={decadeStart <= MIN_PICKER_YEAR}
              className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-lg font-semibold text-neutral-500 shadow-sm transition hover:bg-neutral-200 hover:text-[#303030] disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={`${label} 이전 10년`}
            >
              ‹
            </button>
            <p className="text-lg font-semibold tabular-nums text-[#303030]">
              {decadeStart}년대
            </p>
            <button
              type="button"
              onClick={() => {
                setDisplayYear((year) => {
                  const nextYear = Math.min(MAX_PICKER_YEAR, year + 10);
                  return nextYear;
                });
              }}
              disabled={decadeStart + 10 > MAX_PICKER_YEAR}
              className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-lg font-semibold text-neutral-500 shadow-sm transition hover:bg-neutral-200 hover:text-[#303030] disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={`${label} 다음 10년`}
            >
              ›
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {years.map((year) => {
              const active = safeValue === year;
              return (
                <button
                  key={year}
                  type="button"
                  onClick={() => {
                    onChange(year);
                    setOpen(false);
                  }}
                  className={`min-h-11 rounded-[14px] px-3 text-sm font-semibold transition ${
                    active
                      ? "bg-[#6f6f6f] text-white shadow-[0_12px_24px_rgba(48,48,48,0.18)]"
                      : "text-[#303030] hover:bg-neutral-100"
                  }`}
                >
                  {year}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function MonthGridPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const selected = monthValueToParts(value);
  const [displayYear, setDisplayYear] = useState(selected.year);
  const [yearText, setYearText] = useState(String(selected.year));
  const [open, setOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const yearInputId = `${label.replace(/\s/g, "-")}-year`;

  const handleYearInput = (rawValue: string) => {
    setYearText(rawValue);
    const nextYear = Number(rawValue);
    if (
      rawValue.length === 4 &&
      Number.isInteger(nextYear) &&
      nextYear >= MIN_PICKER_YEAR &&
      nextYear <= MAX_PICKER_YEAR
    ) {
      setDisplayYear(nextYear);
    }
  };

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div ref={pickerRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setDisplayYear(selected.year);
          setYearText(String(selected.year));
          setOpen((current) => !current);
        }}
        className="glass-field flex w-full items-center justify-between gap-3 rounded-full px-4 py-3 text-left text-sm transition hover:bg-white/48 focus:outline-none focus:ring-2 focus:ring-yellow-300/70"
        aria-expanded={open}
      >
        <span>
          <span className="block text-xs font-bold uppercase tracking-[0.16em] text-neutral-500">
            {label}
          </span>
          <span className="mt-0.5 block font-semibold tabular-nums text-[#303030]">
            {selected.year}년 {KOREAN_MONTH_LABELS[selected.monthIndex]}
          </span>
        </span>
        <span
          className="h-2.5 w-2.5 shrink-0 border-b-2 border-r-2 border-neutral-500 transition-transform"
          style={{ transform: open ? "rotate(225deg)" : "rotate(45deg)" }}
          aria-hidden="true"
        />
      </button>

      {open ? (
        <section className="absolute left-0 right-0 top-[calc(100%+10px)] z-40 rounded-[26px] bg-white p-4 shadow-[0_24px_64px_rgba(64,45,82,0.18)] ring-1 ring-neutral-200">
          <div className="mb-4 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => {
                setDisplayYear((year) => {
                  const nextYear = Math.max(MIN_PICKER_YEAR, year - 1);
                  setYearText(String(nextYear));
                  return nextYear;
                });
              }}
              disabled={displayYear <= MIN_PICKER_YEAR}
              className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-lg font-semibold text-neutral-500 shadow-sm transition hover:bg-neutral-200 hover:text-[#303030] disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={`${label} 이전 연도`}
            >
              ‹
            </button>
            <p className="text-lg font-semibold tabular-nums text-[#303030]">
              {displayYear}년
            </p>
            <button
              type="button"
              onClick={() => {
                setDisplayYear((year) => {
                  const nextYear = Math.min(MAX_PICKER_YEAR, year + 1);
                  setYearText(String(nextYear));
                  return nextYear;
                });
              }}
              disabled={displayYear >= MAX_PICKER_YEAR}
              className="grid h-9 w-9 place-items-center rounded-full bg-neutral-100 text-lg font-semibold text-neutral-500 shadow-sm transition hover:bg-neutral-200 hover:text-[#303030] disabled:cursor-not-allowed disabled:opacity-35"
              aria-label={`${label} 다음 연도`}
            >
              ›
            </button>
          </div>
          <label htmlFor={yearInputId} className="mb-3 block">
            <span className="sr-only">{label} 연도 검색</span>
            <input
              id={yearInputId}
              type="number"
              inputMode="numeric"
              min={MIN_PICKER_YEAR}
              max={MAX_PICKER_YEAR}
              value={yearText}
              onChange={(event) => handleYearInput(event.target.value)}
              className="w-full rounded-full border border-neutral-200 bg-white px-4 py-2.5 text-center text-sm font-semibold tabular-nums text-[#303030] shadow-sm focus:outline-none focus:ring-2 focus:ring-yellow-300/70"
              aria-label={`${label} 연도 검색`}
            />
          </label>

          <div className="grid grid-cols-3 gap-2">
            {KOREAN_MONTH_LABELS.map((monthLabel, monthIndex) => {
              const active =
                selected.year === displayYear && selected.monthIndex === monthIndex;
              return (
                <button
                  key={monthLabel}
                  type="button"
                  onClick={() => {
                    onChange(buildMonthValue(displayYear, monthIndex));
                    setOpen(false);
                  }}
                  className={`min-h-11 rounded-[14px] px-3 text-sm font-semibold transition ${
                    active
                      ? "bg-[#6f6f6f] text-white shadow-[0_12px_24px_rgba(48,48,48,0.18)]"
                      : "text-[#303030] hover:bg-neutral-100"
                  }`}
                >
                  {monthLabel}
                </button>
              );
            })}
          </div>
        </section>
      ) : null}
    </div>
  );
}

type DashboardProps = {
  tradeDirection: TradeDirection;
};

export function Dashboard({ tradeDirection }: DashboardProps) {
  const { startMonth: defaultStartMonth, endMonth: defaultEndMonth } =
    getDefaultRecentYearRange();
  const { startYear: defaultStartYear, endYear: defaultEndYear } =
    getDefaultYearRange(defaultEndMonth);
  const defaultProduct = HS_PRODUCT_KEYS.includes("철강재")
    ? "철강재"
    : (HS_PRODUCT_KEYS[0] ?? "");

  const [regionTab, setRegionTab] = useState<RegionScopeTab>("country");
  const [periodMode, setPeriodMode] = useState<PeriodGranularity>("monthly");
  const [countryId, setCountryId] = useState<CountryChoiceId>(COUNTRY_FILTER_ALL);
  const [continentCode, setContinentCode] =
    useState<CustomsContinentCode>(DEFAULT_CONTINENT);
  const [countryQuery, setCountryQuery] = useState("");
  const [startMonth, setStartMonth] = useState(defaultStartMonth);
  const [endMonth, setEndMonth] = useState(defaultEndMonth);
  const [startYear, setStartYear] = useState(defaultStartYear);
  const [endYear, setEndYear] = useState(defaultEndYear);
  const [productKey, setProductKey] = useState(defaultProduct);
  const [hasSearched, setHasSearched] = useState(false);

  const [applied, setApplied] = useState<AppliedQuery>(() => ({
    regionTab: "country",
    periodMode: "monthly",
    countryId: COUNTRY_FILTER_ALL,
    continentCode: DEFAULT_CONTINENT,
    startMonth: defaultStartMonth,
    endMonth: defaultEndMonth,
    startYear: defaultStartYear,
    endYear: defaultEndYear,
    productKey: defaultProduct,
  }));

  const [rawRows, setRawRows] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const snapRef = useRef<FilterSnapshot>({
    regionTab: "country",
    periodMode: "monthly",
    startMonth: defaultStartMonth,
    endMonth: defaultEndMonth,
    startYear: defaultStartYear,
    endYear: defaultEndYear,
    countryId: COUNTRY_FILTER_ALL,
    continentCode: DEFAULT_CONTINENT,
    productKey: defaultProduct,
  });

  useEffect(() => {
    snapRef.current = {
      regionTab,
      periodMode,
      startMonth,
      endMonth,
      startYear,
      endYear,
      countryId,
      continentCode,
      productKey,
    };
  }, [
    startMonth,
    endMonth,
    startYear,
    endYear,
    countryId,
    continentCode,
    productKey,
    regionTab,
    periodMode,
  ]);

  const filteredCountryOptions = useMemo(() => {
    const q = countryQuery.trim().toLowerCase();
    if (!q) return CUSTOMS_COUNTRY_OPTIONS;
    return CUSTOMS_COUNTRY_OPTIONS.filter(
      (o) =>
        o.id.toLowerCase().includes(q) ||
        o.name.toLowerCase().includes(q) ||
        o.name.replace(/\s/g, "").toLowerCase().includes(q.replace(/\s/g, "")),
    );
  }, [countryQuery]);

  const loadTrade = useCallback(
    async (snap: FilterSnapshot) => {
      setLoading(true);
      setRawRows([]);
      setFetchError(null);
      const monthlyRange = normalizeMonthRange(snap.startMonth, snap.endMonth);
      const yearlyRange = normalizeYearRange(snap.startYear, snap.endYear);
      const apiStartYm =
        snap.periodMode === "yearly"
          ? `${yearlyRange.start - 1}-01`
          : addCalendarMonthsYm(monthlyRange.start, -12);
      const apiEndYm =
        snap.periodMode === "yearly" ? `${yearlyRange.end}-12` : monthlyRange.end;

      const params = new URLSearchParams();
      params.set("tradeDirection", tradeDirection);
      params.set("productKey", snap.productKey);
      params.set("strtYymm", monthInputToYymm(apiStartYm));
      params.set("endYymm", monthInputToYymm(apiEndYm));
      params.set("regionMode", snap.regionTab === "continent" ? "continent" : "country");
      if (snap.regionTab === "continent") {
        params.set("continentCode", String(snap.continentCode));
      } else {
        params.set("countryId", snap.countryId);
      }

      try {
        const res = await fetch(`/api/trade?${params.toString()}`, {
          method: "GET",
          cache: "no-store",
        });
        const body = (await res.json()) as TradeApiResponse;
        const rowCount = Array.isArray(body.rows) ? body.rows.length : 0;
        console.log(
          "[/api/trade] HTTP",
          res.status,
          res.ok ? "OK" : "FAIL",
          res.statusText,
        );
        console.log(
          "[/api/trade] 요약",
          `ok=${body.ok} apiType=${body.apiType} rows=${rowCount}`,
          body.error ? `error=${body.error}` : "",
          body.notice ? `notice=${body.notice}` : "",
        );
        console.log("[/api/trade] 전체 JSON", JSON.stringify(body, null, 2));
        if (rowCount > 0 && body.rows) {
          console.table(
            body.rows.slice(0, 20).map((r) => ({
              month: r.month,
              weight: r.weight,
              amount: r.amount,
            })),
          );
        }
        setRawRows(Array.isArray(body.rows) ? body.rows : []);
        if (body.error) setFetchError(body.error);
      } catch (e) {
        setRawRows([]);
        setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [tradeDirection],
  );

  const handleSearch = useCallback(() => {
    const { start, end } = normalizeMonthRange(startMonth, endMonth);
    const yearRange = normalizeYearRange(startYear, endYear);
    if (start !== startMonth || end !== endMonth) {
      setStartMonth(start);
      setEndMonth(end);
    }
    if (yearRange.start !== startYear || yearRange.end !== endYear) {
      setStartYear(yearRange.start);
      setEndYear(yearRange.end);
    }
    setApplied({
      regionTab,
      periodMode,
      countryId,
      continentCode,
      startMonth: start,
      endMonth: end,
      startYear: yearRange.start,
      endYear: yearRange.end,
      productKey,
    });
    setHasSearched(true);
    void loadTrade({
      regionTab,
      periodMode,
      countryId,
      continentCode,
      startMonth: start,
      endMonth: end,
      startYear: yearRange.start,
      endYear: yearRange.end,
      productKey,
    });
  }, [
    continentCode,
    countryId,
    endMonth,
    endYear,
    loadTrade,
    periodMode,
    productKey,
    regionTab,
    startMonth,
    startYear,
  ]);

  const enrichedRows = useMemo(
    () =>
      applied.periodMode === "yearly"
        ? enrichYearlyTradeRows(rawRows, applied.regionTab)
        : enrichTradeRows(rawRows, applied.regionTab),
    [rawRows, applied.regionTab, applied.periodMode],
  );

  const filteredRows = useMemo(() => {
    if (applied.periodMode === "yearly") {
      return enrichedRows.filter((r) => {
        const year = Number(r.month);
        return year >= applied.startYear && year <= applied.endYear;
      });
    }
    return enrichedRows.filter(
      (r) => r.month >= applied.startMonth && r.month <= applied.endMonth,
    );
  }, [
    applied.endMonth,
    applied.endYear,
    applied.periodMode,
    applied.startMonth,
    applied.startYear,
    enrichedRows,
  ]);

  const yoyPctWeightLine = useMemo(
    () => filteredRows.map((r) => r.yoyValue),
    [filteredRows],
  );

  const yoyPctAmountLine = useMemo(
    () => filteredRows.map((r) => r.yoyAmountValue),
    [filteredRows],
  );

  const chartUnitPrices = useMemo(
    () => filteredRows.map((r) => r.unitPrice),
    [filteredRows],
  );

  const yoyPctUnitPriceLine = useMemo(
    () => filteredRows.map((r) => r.unitPriceYoyValue),
    [filteredRows],
  );

  const imexLabel = tradeDirection === "import" ? "수입" : "수출";
  const pageTitle = tradeDirection === "import" ? "Import" : "Export";
  const unitPriceColumnLabel = tradeDirection === "import" ? "수입단가(USD)" : "수출단가(USD)";

  const regionLabel = useMemo(() => regionLabelFromSnap(applied), [applied]);
  const summaryRegionLabel = useMemo(() => {
    if (applied.regionTab === "continent") {
      return (
        CUSTOMS_CONTINENT_OPTIONS.find((o) => o.code === applied.continentCode)?.name ??
        String(applied.continentCode)
      );
    }
    if (applied.countryId === COUNTRY_FILTER_ALL) {
      return "전체 국가";
    }
    return (
      CUSTOMS_COUNTRY_OPTIONS.find((o) => o.id === applied.countryId)?.name ??
      applied.countryId
    );
  }, [applied.continentCode, applied.countryId, applied.regionTab]);

  /** 차트 상단 전용(헤더와 동일 내용, 접두 없이 강조 표시) */
  const chartAppliedConditionsText = useMemo(() => {
    return `[${imexLabel}] / [${apiLabelForTab(applied.regionTab)}] / ${regionLabel} / ${periodRangeLabel(applied)}`;
  }, [applied, imexLabel, regionLabel]);

  /** PNG 저장 시 파일명 앞부분 (예: `미국 · 중후판 / 2020.01~2023.05`) */
  const chartSaveImageNameStem = useMemo(
    () =>
      `${regionLabelFromSnap(applied)} / ${periodRangeLabel(applied)}`,
    [applied],
  );

  const chartCategories = filteredRows.map((r) => formatMonthDot(r.month));
  const chartMonths = filteredRows.map((r) => r.month);
  const chartWeights = filteredRows.map((r) => roundToTwo(r.weight));
  const chartAmounts = filteredRows.map((r) => r.amount);
  const displayProductKeys = useMemo(() => {
    const keys = [...HS_PRODUCT_KEYS];
    const steelIdx = keys.indexOf("철강재");
    const plateIdx = keys.indexOf("중후판");
    if (steelIdx >= 0 && plateIdx >= 0) {
      [keys[steelIdx], keys[plateIdx]] = [keys[plateIdx], keys[steelIdx]];
    }
    return keys;
  }, []);

  const chartKey = useMemo(
    () =>
      [
        applied.regionTab,
        applied.periodMode,
        applied.countryId,
        applied.continentCode,
        applied.startMonth,
        applied.endMonth,
        applied.startYear,
        applied.endYear,
        applied.productKey,
        tradeDirection,
        filteredRows.length,
      ].join("|"),
    [applied, filteredRows.length, tradeDirection],
  );

  const inputClass =
    "glass-field w-full rounded-full px-4 py-3 text-sm text-[#303030] transition placeholder:text-neutral-400 focus:bg-white/72 focus:outline-none focus:ring-2 focus:ring-yellow-300/70";

  const productGroupName = `hs-product-${tradeDirection}`;
  const countryGroupName = `country-${tradeDirection}`;
  const continentGroupName = `continent-${tradeDirection}`;
  const periodGroupLabel = applied.periodMode === "yearly" ? "연도" : "월";
  const chartTitle = applied.periodMode === "yearly" ? "연도별 추이" : "월별 추이";
  const yoyComparisonLabel =
    applied.periodMode === "yearly" ? "전년比" : "전년 동월比";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col px-4 pb-6 pt-5 sm:px-6 lg:px-8">
      <header className="mx-auto w-full max-w-[1600px] shrink-0 px-1 py-5">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.22em] text-neutral-500">
              {imexLabel} dashboard
            </p>
            <h1 className="mt-3 text-4xl font-semibold tracking-normal text-black md:text-6xl">
              {pageTitle}
            </h1>
          </div>
          <div className="flex flex-wrap justify-start gap-2 text-right lg:justify-end">
            <div className="glass-surface w-fit max-w-[12rem] rounded-full px-5 py-1.5">
              <p className="truncate text-sm font-semibold text-[#303030]">
                {applied.productKey}
              </p>
              <p className="text-[10px] font-medium leading-tight text-neutral-600">품목</p>
            </div>
            <div className="glass-surface w-fit max-w-[12rem] rounded-full px-5 py-1.5">
              <p className="truncate text-sm font-semibold text-[#303030]">
                {summaryRegionLabel}
              </p>
              <p className="text-[10px] font-medium leading-tight text-neutral-600">
                {applied.regionTab === "continent" ? "대륙" : "국가"}
              </p>
            </div>
            <div className="glass-surface w-fit rounded-full px-5 py-1.5">
              <p className="text-sm font-semibold tabular-nums text-[#303030]">
                {periodRangeLabel(applied)}
              </p>
              <p className="text-[10px] font-medium leading-tight text-neutral-600">기간</p>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col gap-6 overflow-auto rounded-[36px] border border-white/50 bg-white/20 p-3 shadow-[0_30px_90px_rgba(30,30,30,0.12)] backdrop-blur-xl lg:flex-row lg:gap-6 lg:p-4">
        <section className="flex w-full min-w-0 flex-col gap-6 lg:w-[62%]">
          {fetchError ? (
            <div className="rounded-[22px] border border-yellow-400/40 bg-yellow-100/62 px-4 py-3 text-sm text-[#303030] shadow-sm backdrop-blur-xl">
              {fetchError}
            </div>
          ) : null}

          <article className="glass-card flex min-h-[320px] flex-col rounded-[30px] p-6">
            <div className="mb-2 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-[22px] font-semibold tracking-normal text-[#303030]">
                  {chartTitle}
                </h2>
              </div>
              {loading ? (
                <span className="rounded-full bg-[#303030] px-3 py-1 text-xs font-medium text-white">
                  불러오는 중...
                </span>
              ) : null}
            </div>

            <div
              className="glass-field mb-4 rounded-[22px] px-4 py-3.5"
              aria-label="차트에 적용된 조회 조건"
            >
              <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-neutral-500">
                차트 적용 조건
              </p>
              <p className="mt-2 break-words text-sm font-semibold leading-relaxed text-[#303030]">
                {chartAppliedConditionsText}
              </p>
            </div>

            {!hasSearched ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-neutral-300/70 bg-white/34 py-24 text-center backdrop-blur-xl">
                <p className="text-base font-semibold text-neutral-700">
                  데이터 조회 조건을 설정해주세요
                </p>
              </div>
            ) : null}
            {!loading && hasSearched && filteredRows.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-[24px] border border-dashed border-neutral-300/70 bg-white/34 py-24 text-center backdrop-blur-xl">
                <p className="text-base font-semibold text-neutral-700">데이터 없음</p>
                <p className="max-w-md text-sm text-neutral-500">
                  API 응답에 파싱된 행이 없습니다. 콘솔의{" "}
                  <code className="rounded bg-white/70 px-1">[/api/trade] 전체 JSON</code>에
                  포함된 <code className="rounded bg-white/70 px-1">debug</code>(원시 XML
                  앞부분·<code className="rounded bg-white/70 px-1">firstItemKeys</code>·
                  오류 메시지)와 서버 터미널 로그를 확인하세요.
                </p>
              </div>
            ) : null}
            {loading ? (
              <div className="flex flex-1 items-center justify-center rounded-[24px] border border-dashed border-neutral-300/60 bg-white/28 py-24 text-sm text-neutral-500">
                데이터를 불러오는 중입니다.
              </div>
            ) : null}
            {!loading && hasSearched && filteredRows.length > 0 ? (
              <TradeChart
                key={chartKey}
                categories={chartCategories}
                months={chartMonths}
                weightsKg={chartWeights}
                amountsMillionUsd={chartAmounts}
                yoyPctWeight={yoyPctWeightLine}
                yoyPctAmount={yoyPctAmountLine}
                unitPrices={chartUnitPrices}
                yoyPctUnitPrice={yoyPctUnitPriceLine}
                barLegendText={tradeChartBarLegend(applied, tradeDirection)}
                imexLabel={imexLabel}
                yoyComparisonLabel={yoyComparisonLabel}
                saveImageNameStem={chartSaveImageNameStem}
              />
            ) : null}
          </article>

          <article className="glass-card rounded-[30px] p-6">
            <h2 className="mb-4 text-[22px] font-semibold tracking-normal text-[#303030]">
              데이터 표
            </h2>
            <div className="soft-scrollbar overflow-x-auto rounded-[24px] bg-white/40 ring-1 ring-white/70">
              <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-[#303030] text-white">
                    <th className="px-4 py-4 font-semibold">{periodGroupLabel}</th>
                    <th className="px-4 py-4 font-semibold">중량(천톤)</th>
                    <th className="px-4 py-4 font-semibold">중량 증감률(YoY)</th>
                    <th className="px-4 py-4 font-semibold">금액(백만 USD)</th>
                    <th className="px-4 py-4 font-semibold">금액 증감률(YoY)</th>
                    <th className="px-4 py-4 font-semibold">{unitPriceColumnLabel}</th>
                    <th className="px-4 py-4 font-semibold">단가 증감률(YoY)</th>
                  </tr>
                </thead>
                <tbody className="text-neutral-800">
                  {filteredRows.map((row) => {
                    const yoyClass = (v: number | null) => {
                      if (v === null) return "text-slate-500";
                      if (v > 0) return "font-medium text-red-600";
                      if (v < 0) return "font-medium text-blue-600";
                      return "text-slate-600";
                    };

                    return (
                      <tr
                        key={row.month}
                        className="border-t border-white/70 first:border-0 hover:bg-white/38"
                      >
                        <td className="px-4 py-4 tabular-nums">
                          {formatMonthDot(row.month)}
                        </td>
                        <td className="px-4 py-4 tabular-nums">
                          {roundToTwo(row.weight).toLocaleString(undefined, {
                            maximumFractionDigits: 2,
                            minimumFractionDigits: 0,
                          })}
                        </td>
                        <td className={`px-4 py-4 tabular-nums ${yoyClass(row.yoyValue)}`}>
                          {row.yoyDisplay}
                        </td>
                        <td className="px-4 py-4 tabular-nums">
                          {typeof row.amount === "number"
                            ? row.amount.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })
                            : row.amount}
                        </td>
                        <td
                          className={`px-4 py-4 tabular-nums ${yoyClass(row.yoyAmountValue)}`}
                        >
                          {row.yoyAmountDisplay}
                        </td>
                        <td className="px-4 py-4 tabular-nums">
                          {Number.isFinite(row.unitPrice)
                            ? Math.round(row.unitPrice).toLocaleString()
                            : "-"}
                        </td>
                        <td
                          className={`px-4 py-4 tabular-nums ${yoyClass(row.unitPriceYoyValue)}`}
                        >
                          {row.unitPriceYoyDisplay}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {!hasSearched ? (
              <p className="mt-3 text-center text-sm text-neutral-500">
                데이터 조회 조건을 설정해주세요
              </p>
            ) : null}
            {hasSearched && filteredRows.length === 0 && !loading ? (
              <p className="mt-3 text-center text-sm text-neutral-500">
                기간을 조정하거나 TRADE_API_KEY·API 파라미터를 확인해 주세요.
              </p>
            ) : null}
          </article>
        </section>

        <aside className="glass-card flex w-full shrink-0 flex-col gap-6 rounded-[30px] p-6 lg:w-[38%]">
          <div>
            <h2 className="text-[22px] font-semibold tracking-normal text-[#303030]">
              조건 설정
            </h2>
          </div>

          <div>
            <RegionScopeTabs value={regionTab} onChange={setRegionTab} />
          </div>

          {regionTab === "country" ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold tracking-tight text-[#303030]">
                국가
              </legend>
              <label
                className={`flex cursor-pointer items-center gap-3 rounded-full border px-3 py-2.5 text-sm transition-colors ${
                  countryId === COUNTRY_FILTER_ALL
                    ? "border-[#303030] bg-[#303030] font-medium text-white shadow-sm"
                    : "border-white/60 bg-white/30 text-neutral-800 hover:bg-white/58"
                }`}
              >
                <input
                  type="radio"
                  name={countryGroupName}
                  checked={countryId === COUNTRY_FILTER_ALL}
                  onChange={() => setCountryId(COUNTRY_FILTER_ALL)}
                  className="h-4 w-4 shrink-0 border-neutral-300 text-[#303030] focus:ring-yellow-300"
                />
                <span className="tabular-nums opacity-70">ALL</span>
                <span className="min-w-0 flex-1 font-medium">전체 국가 합계</span>
              </label>
              <input
                type="search"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="국가명 또는 코드 검색"
                className={inputClass}
                aria-label="국가 검색"
              />
              <div className="soft-scrollbar max-h-[min(40vh,320px)] space-y-1 overflow-y-auto rounded-[24px] bg-white/28 p-2 ring-1 ring-white/60">
                {filteredCountryOptions.length === 0 ? (
                  <p className="px-2 py-3 text-center text-sm text-neutral-500">
                    검색 결과 없음
                  </p>
                ) : (
                  filteredCountryOptions.map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-full px-3 py-2 text-sm transition-colors ${
                        countryId === opt.id
                          ? "bg-[#303030] font-medium text-white shadow-sm"
                          : "text-neutral-700 hover:bg-white/56"
                      }`}
                    >
                      <input
                        type="radio"
                        name={countryGroupName}
                        checked={countryId === opt.id}
                        onChange={() => setCountryId(opt.id)}
                        className="h-4 w-4 shrink-0 border-neutral-300 text-[#303030] focus:ring-yellow-300"
                      />
                      <span className="tabular-nums opacity-65">{opt.id}</span>
                      <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-sm font-bold tracking-tight text-[#303030]">
                대륙
              </legend>
              <div className="space-y-1 rounded-[24px] bg-white/28 p-2 ring-1 ring-white/60">
                {CUSTOMS_CONTINENT_OPTIONS.map((opt) => (
                  <label
                    key={opt.code}
                    className={`flex cursor-pointer items-center gap-3 rounded-full px-3 py-2.5 text-sm transition-colors ${
                      continentCode === opt.code
                        ? "bg-[#303030] font-medium text-white shadow-sm"
                        : "text-neutral-700 hover:bg-white/56"
                    }`}
                  >
                    <input
                      type="radio"
                      name={continentGroupName}
                      checked={continentCode === opt.code}
                      onChange={() => setContinentCode(opt.code)}
                      className="h-4 w-4 border-neutral-300 text-[#303030] focus:ring-yellow-300"
                    />
                    <span className="tabular-nums opacity-65">{opt.code}</span>
                    <span className="min-w-0 flex-1">{opt.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-3">
            <span className="text-sm font-bold tracking-tight text-[#303030]">
              기간
            </span>
            <PeriodModeTabs value={periodMode} onChange={setPeriodMode} />
            <div className="flex flex-col gap-3">
              {periodMode === "monthly" ? (
                <>
                  <MonthGridPicker
                    key={`start-${startMonth}`}
                    label="시작 월"
                    value={startMonth}
                    onChange={setStartMonth}
                  />
                  <MonthGridPicker
                    key={`end-${endMonth}`}
                    label="종료 월"
                    value={endMonth}
                    onChange={setEndMonth}
                  />
                </>
              ) : (
                <>
                  <YearGridPicker
                    key={`start-year-${startYear}`}
                    label="시작 연도"
                    value={startYear}
                    onChange={setStartYear}
                  />
                  <YearGridPicker
                    key={`end-year-${endYear}`}
                    label="종료 연도"
                    value={endYear}
                    onChange={setEndYear}
                  />
                </>
              )}
            </div>
          </div>

          <fieldset className="shrink-0 space-y-3">
            <legend className="text-sm font-bold tracking-tight text-[#303030]">
              품목 (HS 코드 그룹)
            </legend>
            <p className="text-xs leading-relaxed text-neutral-600">
              선택한 품목의 HS 코드 전체를 서버에서 병렬 조회한 뒤 선택한 기간 단위로 합산합니다.
            </p>
            <div className="soft-scrollbar max-h-[min(36vh,280px)] space-y-1 overflow-y-auto rounded-[24px] bg-white/28 p-2 ring-1 ring-white/60">
              {displayProductKeys.map((key) => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-3 rounded-full px-3 py-2.5 text-sm transition-colors ${
                    productKey === key
                      ? "bg-[#303030] font-medium text-white shadow-sm"
                      : "text-neutral-700 hover:bg-white/56"
                  }`}
                >
                  <input
                    type="radio"
                    name={productGroupName}
                    value={key}
                    checked={productKey === key}
                    onChange={() => setProductKey(key)}
                    className="h-4 w-4 border-neutral-300 text-[#303030] focus:ring-yellow-300"
                  />
                  <span className="min-w-0 flex-1 truncate">{key}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <button
            type="button"
            onClick={handleSearch}
            disabled={loading}
            className="w-full shrink-0 rounded-full bg-[#8f82a8] py-3.5 text-sm font-extrabold text-white shadow-[0_14px_30px_rgba(79,63,104,0.24)] transition hover:bg-[#7f7398] enabled:active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? "조회 중…" : "조회하기"}
          </button>
        </aside>
      </div>
    </div>
  );
}
