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
import { TradeChart } from "@/components/TradeChart";
import type { TradeApiResponse, TradeRow } from "@/types/trade";

const HS_PRODUCT_KEYS = Object.keys(HS_CODE_MAP);

export type TradeDirection = "import" | "export";

export type RegionScopeTab = "country" | "continent";

type EnrichedRow = TradeRow & {
  /** 백만 USD·kg 기준 단가 지표 (기존과 동일: (amount×1000)/weight, 톤당 백만 USD 스케일) */
  unitPrice: number;
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
  startMonth: string;
  endMonth: string;
  productKey: string;
  countryId: CustomsCountryId;
  continentCode: CustomsContinentCode;
};

type AppliedQuery = FilterSnapshot;

const DEFAULT_COUNTRY: CustomsCountryId = CUSTOMS_COUNTRY_OPTIONS.some(
  (o) => o.id === "US",
)
  ? "US"
  : CUSTOMS_COUNTRY_OPTIONS[0]!.id;

const DEFAULT_CONTINENT: CustomsContinentCode = 10;

/** `YYYY-MM` 기준으로 `delta`개월 이동 */
function addCalendarMonthsYm(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function unitPriceFromRow(row: TradeRow): number {
  if (row.weight === 0) return 0;
  return Math.round(((row.amount * 1000) / row.weight) * 10) / 10;
}

function pctDisplay(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`;
}

/**
 * 전년 동월(같은 달, 12개월 전) 대비 중량·금액·단가 증감률(YoY).
 * 조회 시작월보다 12개월 이전 구간을 API로 받아 두면 첫 행도 채워짐.
 */
function enrichTradeRows(rows: TradeRow[]): EnrichedRow[] {
  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const byMonth = new Map(sorted.map((r) => [r.month, r]));

  return sorted.map((row) => {
    const unitPrice = unitPriceFromRow(row);
    const prevYearMonth = addCalendarMonthsYm(row.month, -12);
    const prevYear = byMonth.get(prevYearMonth);

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
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${y}.${m}`;
}

function monthInputToYymm(ym: string): string {
  return ym.replace(/-/g, "").slice(0, 6);
}

function normalizeMonthRange(s: string, e: string): { start: string; end: string } {
  if (s <= e) return { start: s, end: e };
  return { start: e, end: s };
}

function regionLabelFromSnap(s: FilterSnapshot): string {
  if (s.regionTab === "continent") {
    const name =
      CUSTOMS_CONTINENT_OPTIONS.find((o) => o.code === s.continentCode)?.name ??
      String(s.continentCode);
    return `${name}(대륙) · ${s.productKey}`;
  }
  const cname =
    CUSTOMS_COUNTRY_OPTIONS.find((o) => o.id === s.countryId)?.name ?? s.countryId;
  return `${cname} · ${s.productKey}`;
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
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`px-4 py-2 text-sm -mb-px border-b-2 font-medium transition-colors ${
              active
                ? "border-brand-navy text-brand-navy"
                : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

type DashboardProps = {
  tradeDirection: TradeDirection;
};

export function Dashboard({ tradeDirection }: DashboardProps) {
  const defaultProduct = HS_PRODUCT_KEYS.includes("중후판")
    ? "중후판"
    : (HS_PRODUCT_KEYS[0] ?? "");

  const [regionTab, setRegionTab] = useState<RegionScopeTab>("country");
  const [countryId, setCountryId] = useState<CustomsCountryId>(DEFAULT_COUNTRY);
  const [continentCode, setContinentCode] =
    useState<CustomsContinentCode>(DEFAULT_CONTINENT);
  const [countryQuery, setCountryQuery] = useState("");
  const [startMonth, setStartMonth] = useState("2020-01");
  const [endMonth, setEndMonth] = useState("2023-05");
  const [productKey, setProductKey] = useState(defaultProduct);

  const [applied, setApplied] = useState<AppliedQuery>(() => ({
    regionTab: "country",
    countryId: DEFAULT_COUNTRY,
    continentCode: DEFAULT_CONTINENT,
    startMonth: "2020-01",
    endMonth: "2023-05",
    productKey: defaultProduct,
  }));

  const [rawRows, setRawRows] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);

  const snapRef = useRef<FilterSnapshot>({
    regionTab: "country",
    startMonth: "2020-01",
    endMonth: "2023-05",
    countryId: DEFAULT_COUNTRY,
    continentCode: DEFAULT_CONTINENT,
    productKey: defaultProduct,
  });

  useEffect(() => {
    snapRef.current = {
      regionTab,
      startMonth,
      endMonth,
      countryId,
      continentCode,
      productKey,
    };
  }, [startMonth, endMonth, countryId, continentCode, productKey, regionTab]);

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
      setFetchNotice(null);
      const { start, end } = normalizeMonthRange(snap.startMonth, snap.endMonth);
      /** 표·차트 첫 달 YoY용: 전년 동월이 되도록 조회 시작 12개월 앞부터 받음 */
      const apiStartYm = addCalendarMonthsYm(start, -12);

      const params = new URLSearchParams();
      params.set("tradeDirection", tradeDirection);
      params.set("productKey", snap.productKey);
      params.set("strtYymm", monthInputToYymm(apiStartYm));
      params.set("endYymm", monthInputToYymm(end));
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
        if (body.notice) setFetchNotice(body.notice);
      } catch (e) {
        setRawRows([]);
        setFetchError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [tradeDirection],
  );

  useEffect(() => {
    void loadTrade(snapRef.current);
  }, [tradeDirection, loadTrade, regionTab]);

  const handleSearch = useCallback(() => {
    const { start, end } = normalizeMonthRange(startMonth, endMonth);
    if (start !== startMonth || end !== endMonth) {
      setStartMonth(start);
      setEndMonth(end);
    }
    setApplied({
      regionTab,
      countryId,
      continentCode,
      startMonth: start,
      endMonth: end,
      productKey,
    });
    void loadTrade({
      regionTab,
      countryId,
      continentCode,
      startMonth: start,
      endMonth: end,
      productKey,
    });
  }, [
    continentCode,
    countryId,
    endMonth,
    loadTrade,
    productKey,
    regionTab,
    startMonth,
  ]);

  const enrichedRows = useMemo(() => enrichTradeRows(rawRows), [rawRows]);

  const filteredRows = useMemo(() => {
    return enrichedRows.filter(
      (r) => r.month >= applied.startMonth && r.month <= applied.endMonth,
    );
  }, [applied.endMonth, applied.startMonth, enrichedRows]);

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
  const pageTitle = `${imexLabel} 대시보드`;
  const unitPriceColumnLabel =
    tradeDirection === "import" ? "수입단가" : "수출단가";

  const regionLabel = useMemo(() => regionLabelFromSnap(applied), [applied]);

  const conditionSummary = useMemo(() => {
    return `조회 반영 조건: [${imexLabel}] / [${apiLabelForTab(applied.regionTab)}] / ${regionLabel} / ${formatMonthDot(applied.startMonth)}~${formatMonthDot(applied.endMonth)}`;
  }, [applied, imexLabel, regionLabel]);

  const draftHint = useMemo(() => {
    const r = regionLabelFromSnap({
      regionTab,
      countryId,
      continentCode,
      productKey,
      startMonth,
      endMonth,
    });
    return `편집 중: [${apiLabelForTab(regionTab)}] / ${r} · ${formatMonthDot(startMonth)}~${formatMonthDot(endMonth)} (조회하기로 조건 고정)`;
  }, [continentCode, countryId, endMonth, productKey, regionTab, startMonth]);

  const chartCategories = filteredRows.map((r) => formatMonthDot(r.month));
  const chartMonths = filteredRows.map((r) => r.month);
  const chartWeights = filteredRows.map((r) => r.weight);
  const chartAmounts = filteredRows.map((r) => r.amount);

  const chartKey = useMemo(
    () =>
      [
        applied.regionTab,
        applied.countryId,
        applied.continentCode,
        applied.startMonth,
        applied.endMonth,
        applied.productKey,
        tradeDirection,
        filteredRows.length,
      ].join("|"),
    [applied, filteredRows.length, tradeDirection],
  );

  const inputClass =
    "w-full rounded-xl border-0 bg-slate-100 px-3 py-2.5 text-sm text-slate-800 shadow-inner ring-1 ring-slate-200/80 transition placeholder:text-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-navy/25";

  const productGroupName = `hs-product-${tradeDirection}`;
  const countryGroupName = `country-${tradeDirection}`;
  const continentGroupName = `continent-${tradeDirection}`;

  const introApiLine =
    regionTab === "country"
      ? "관세청 품목·국가별 수출입실적(GW) — 국가코드는 「관세청조회코드」엑셀 국가코드 시트와 동일한 목록입니다."
      : "관세청 품목·대륙별 수출입실적(GW) — 대륙코드는 엑셀 「대륙코드」시트(10~99)와 동일합니다. HS별 병렬 호출 후 월별 합산합니다.";

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <header className="shrink-0 border-b border-slate-200/80 bg-slate-50 px-6 py-5 md:px-8">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 md:text-2xl">
            {pageTitle}
          </h1>
          <p
            className="mt-1 truncate text-sm font-medium text-slate-700"
            title={conditionSummary}
          >
            {conditionSummary}
          </p>
          <p className="mt-1 truncate text-xs text-slate-400" title={draftHint}>
            {draftHint}
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-auto p-6 lg:flex-row lg:gap-8 lg:p-8">
        <section className="flex w-full min-w-0 flex-col gap-6 lg:w-3/4">
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200/80">
            <p className="text-xs font-medium text-slate-500">{introApiLine}</p>
          </div>

          {fetchError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {fetchError}
            </div>
          ) : null}

          <article className="flex min-h-[400px] flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/80">
            <div className="mb-2 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">월별 추이</h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {regionLabel} · {apiLabelForTab(applied.regionTab)} · 좌측 막대(천톤 또는 금액),
                  우측 선(전년 동월 대비 %, 표와 동일) · 긴 기간은 하단 슬라이더로 이동 · 우상단 PNG 저장
                </p>
                {fetchNotice ? (
                  <p className="mt-1 text-xs text-amber-700">{fetchNotice}</p>
                ) : null}
              </div>
              {loading ? (
                <span className="text-xs font-medium text-slate-500">불러오는 중…</span>
              ) : null}
            </div>
            {!loading && filteredRows.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 py-24 text-center">
                <p className="text-base font-semibold text-slate-700">데이터 없음</p>
                <p className="max-w-md text-sm text-slate-500">
                  API 응답에 파싱된 행이 없습니다. 콘솔의{" "}
                  <code className="rounded bg-slate-200 px-1">[/api/trade] 전체 JSON</code>에
                  포함된 <code className="rounded bg-slate-200 px-1">debug</code>(원시 XML
                  앞부분·<code className="rounded bg-slate-200 px-1">firstItemKeys</code>·
                  오류 메시지)와 서버 터미널 로그를 확인하세요.
                </p>
              </div>
            ) : null}
            {loading ? (
              <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 py-24 text-sm text-slate-500">
                데이터를 불러오는 중입니다.
              </div>
            ) : null}
            {!loading && filteredRows.length > 0 ? (
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
                productLabel={applied.productKey}
                imexLabel={imexLabel}
              />
            ) : null}
          </article>

          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/80">
            <h2 className="mb-4 text-base font-semibold text-slate-900">데이터 표</h2>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
              <table className="w-full min-w-[880px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-600">
                    <th className="px-4 py-3 font-semibold">월</th>
                    <th className="px-4 py-3 font-semibold">중량(kg)</th>
                    <th className="px-4 py-3 font-semibold">중량 증감률(YoY)</th>
                    <th className="px-4 py-3 font-semibold">금액(백만 USD)</th>
                    <th className="px-4 py-3 font-semibold">금액 증감률(YoY)</th>
                    <th className="px-4 py-3 font-semibold">{unitPriceColumnLabel}</th>
                    <th className="px-4 py-3 font-semibold">단가 증감률(YoY)</th>
                  </tr>
                </thead>
                <tbody className="text-slate-800">
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
                        className="border-t border-slate-100 first:border-0"
                      >
                        <td className="px-4 py-3 tabular-nums">
                          {formatMonthDot(row.month)}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.weight.toLocaleString()}
                        </td>
                        <td className={`px-4 py-3 tabular-nums ${yoyClass(row.yoyValue)}`}>
                          {row.yoyDisplay}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {typeof row.amount === "number"
                            ? row.amount.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })
                            : row.amount}
                        </td>
                        <td
                          className={`px-4 py-3 tabular-nums ${yoyClass(row.yoyAmountValue)}`}
                        >
                          {row.yoyAmountDisplay}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.unitPrice.toFixed(1)}
                        </td>
                        <td
                          className={`px-4 py-3 tabular-nums ${yoyClass(row.unitPriceYoyValue)}`}
                        >
                          {row.unitPriceYoyDisplay}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filteredRows.length === 0 && !loading ? (
              <p className="mt-3 text-center text-sm text-slate-500">
                기간을 조정하거나 TRADE_API_KEY·API 파라미터를 확인해 주세요.
              </p>
            ) : null}
          </article>
        </section>

        <aside className="flex w-full shrink-0 flex-col gap-6 rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/80 lg:w-1/4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">조건 설정</h2>
            <p className="mt-1 text-sm text-slate-500">
              기간·필터를 맞춘 뒤{" "}
              <span className="font-medium text-slate-700">조회하기</span>로 상단 요약
              조건을 확정합니다. (외부 API는 서버{" "}
              <code className="text-xs">/api/trade</code>만 경유)
            </p>
          </div>

          <div className="rounded-2xl bg-slate-50/80 p-1 ring-1 ring-slate-100">
            <RegionScopeTabs value={regionTab} onChange={setRegionTab} />
          </div>

          {regionTab === "country" ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                국가 (cntyCd)
              </legend>
              <input
                type="search"
                value={countryQuery}
                onChange={(e) => setCountryQuery(e.target.value)}
                placeholder="국가명 또는 코드 검색"
                className={inputClass}
                aria-label="국가 검색"
              />
              <div className="max-h-[min(40vh,320px)] space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                {filteredCountryOptions.length === 0 ? (
                  <p className="px-2 py-3 text-center text-sm text-slate-500">
                    검색 결과 없음
                  </p>
                ) : (
                  filteredCountryOptions.map((opt) => (
                    <label
                      key={opt.id}
                      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${
                        countryId === opt.id
                          ? "bg-white font-medium text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                          : "text-slate-700 hover:bg-white/80"
                      }`}
                    >
                      <input
                        type="radio"
                        name={countryGroupName}
                        checked={countryId === opt.id}
                        onChange={() => setCountryId(opt.id)}
                        className="h-4 w-4 shrink-0 border-slate-300 text-brand-navy focus:ring-brand-navy"
                      />
                      <span className="tabular-nums text-slate-500">{opt.id}</span>
                      <span className="min-w-0 flex-1 truncate">{opt.name}</span>
                    </label>
                  ))
                )}
              </div>
            </fieldset>
          ) : (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                대륙 (cntnEbkUnfcClsfCd)
              </legend>
              <div className="space-y-1 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                {CUSTOMS_CONTINENT_OPTIONS.map((opt) => (
                  <label
                    key={opt.code}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                      continentCode === opt.code
                        ? "bg-white font-medium text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                        : "text-slate-700 hover:bg-white/80"
                    }`}
                  >
                    <input
                      type="radio"
                      name={continentGroupName}
                      checked={continentCode === opt.code}
                      onChange={() => setContinentCode(opt.code)}
                      className="h-4 w-4 border-slate-300 text-brand-navy focus:ring-brand-navy"
                    />
                    <span className="tabular-nums text-slate-500">{opt.code}</span>
                    <span className="min-w-0 flex-1">{opt.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <div className="space-y-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              기간
            </span>
            <div className="flex flex-col gap-3">
              <label className="block text-sm text-slate-600">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  시작 월
                </span>
                <input
                  type="month"
                  value={startMonth}
                  onChange={(e) => setStartMonth(e.target.value)}
                  className={inputClass}
                />
              </label>
              <label className="block text-sm text-slate-600">
                <span className="mb-1.5 block text-xs font-medium text-slate-500">
                  종료 월
                </span>
                <input
                  type="month"
                  value={endMonth}
                  onChange={(e) => setEndMonth(e.target.value)}
                  className={inputClass}
                />
              </label>
            </div>
          </div>

          <fieldset className="min-h-0 flex-1 space-y-3">
            <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
              품목 (HS 코드 그룹)
            </legend>
            <p className="text-xs text-slate-500">
              선택한 품목의 HS 코드 전체를 서버에서 병렬 조회·월별 합산합니다.
            </p>
            <div className="max-h-[min(36vh,280px)] space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
              {HS_PRODUCT_KEYS.map((key) => (
                <label
                  key={key}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                    productKey === key
                      ? "bg-white font-medium text-brand-navy shadow-sm ring-1 ring-slate-200/80"
                      : "text-slate-700 hover:bg-white/80"
                  }`}
                >
                  <input
                    type="radio"
                    name={productGroupName}
                    value={key}
                    checked={productKey === key}
                    onChange={() => setProductKey(key)}
                    className="h-4 w-4 border-slate-300 text-brand-navy focus:ring-brand-navy"
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
            className="mt-auto w-full rounded-xl bg-blue-600 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 enabled:active:scale-[0.99] disabled:opacity-60"
          >
            {loading ? "조회 중…" : "조회하기"}
          </button>
        </aside>
      </div>
    </div>
  );
}
