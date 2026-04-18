"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONTINENT_FILTER_ALL,
  CONTINENT_RADIO_OPTIONS,
  CONTINENT_SELECT_OPTIONS,
  COUNTRY_FILTER_ALL,
  COUNTRY_RADIO_OPTIONS,
  type ContinentFilterCode,
  type CountryFilterId,
} from "@/constants/mappings";
import { HS_CODE_MAP } from "@/constants/hsCodes";
import { TradeChart } from "@/components/TradeChart";
import type { TradeApiType, TradeApiResponse, TradeRow } from "@/types/trade";

const HS_PRODUCT_KEYS = Object.keys(HS_CODE_MAP);

export type TradeDirection = "import" | "export";

type EnrichedRow = TradeRow & {
  unitPrice: number;
  momDisplay: string;
  momValue: number | null;
};

type FilterSnapshot = {
  startMonth: string;
  endMonth: string;
  continentCode: ContinentFilterCode;
  countryId: CountryFilterId;
  productKey: string;
};

type AppliedQuery = FilterSnapshot & {
  apiTab: TradeApiType;
};

function enrichTradeRows(rows: TradeRow[]): EnrichedRow[] {
  return rows.map((row, i) => {
    const unitPrice =
      row.weight === 0
        ? 0
        : Math.round(((row.amount * 1000) / row.weight) * 10) / 10;

    if (i === 0) {
      return { ...row, unitPrice, momDisplay: "-", momValue: null };
    }

    const prev = rows[i - 1]!;
    if (prev.weight === 0) {
      return { ...row, unitPrice, momDisplay: "-", momValue: null };
    }

    const momPct = ((row.weight - prev.weight) / prev.weight) * 100;
    const rounded = Math.round(momPct * 10) / 10;
    return {
      ...row,
      unitPrice,
      momDisplay: `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)}%`,
      momValue: rounded,
    };
  });
}

function formatMonthDot(ym: string): string {
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return `${y}.${m}`;
}

/** `<input type="month" />` 값 `YYYY-MM` → 관세청 API용 `YYYYMM` (6자리) */
function monthInputToYymm(ym: string): string {
  return ym.replace(/-/g, "").slice(0, 6);
}

function normalizeMonthRange(s: string, e: string): { start: string; end: string } {
  if (s <= e) return { start: s, end: e };
  return { start: e, end: s };
}

function regionLabelFromApplied(q: AppliedQuery): string {
  switch (q.apiTab) {
    case "overall":
      return "수출입총괄";
    case "item":
      return q.productKey;
    case "continent":
      if (q.continentCode === CONTINENT_FILTER_ALL) return "전체 대륙";
      return (
        CONTINENT_SELECT_OPTIONS.find((c) => c.code === q.continentCode)?.name ??
        String(q.continentCode)
      );
    case "country":
      if (q.countryId === COUNTRY_FILTER_ALL) return "전체 국가";
      return COUNTRY_RADIO_OPTIONS.find((x) => x.id === q.countryId)?.name ?? q.countryId;
    default:
      return "";
  }
}

function apiTabLabel(tab: TradeApiType): string {
  const m: Record<TradeApiType, string> = {
    overall: "수출입총괄",
    item: "품목별",
    country: "국가별",
    continent: "대륙별",
  };
  return m[tab];
}

function DepthTabs<T extends string>({
  items,
  value,
  onChange,
  size = "md",
}: {
  items: readonly { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
  size?: "md" | "sm";
}) {
  const pad = size === "sm" ? "px-3 py-1.5 text-sm" : "px-4 py-2 text-sm";
  return (
    <div className="flex flex-wrap gap-1 border-b border-slate-200">
      {items.map((item) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.id)}
            className={`${pad} -mb-px border-b-2 font-medium transition-colors ${
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

const API_VIEW_TABS = [
  { id: "overall" as const, label: "수출입총괄" },
  { id: "item" as const, label: "품목별" },
  { id: "country" as const, label: "국가별" },
  { id: "continent" as const, label: "대륙별" },
];

type DashboardProps = {
  tradeDirection: TradeDirection;
};

export function Dashboard({ tradeDirection }: DashboardProps) {
  const defaultProduct = HS_PRODUCT_KEYS.includes("중후판")
    ? "중후판"
    : (HS_PRODUCT_KEYS[0] ?? "");

  const [apiTypeTab, setApiTypeTab] = useState<TradeApiType>("overall");
  const [continentCode, setContinentCode] = useState<ContinentFilterCode>(10);
  const [countryId, setCountryId] = useState<CountryFilterId>("US");
  const [startMonth, setStartMonth] = useState("2023-01");
  const [endMonth, setEndMonth] = useState("2023-05");
  const [productKey, setProductKey] = useState(defaultProduct);

  const [applied, setApplied] = useState<AppliedQuery>(() => ({
    apiTab: "overall",
    continentCode: 10,
    countryId: "US",
    startMonth: "2023-01",
    endMonth: "2023-05",
    productKey: defaultProduct,
  }));

  const [rawRows, setRawRows] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [fetchNotice, setFetchNotice] = useState<string | null>(null);

  const snapRef = useRef<FilterSnapshot>({
    startMonth: "2023-01",
    endMonth: "2023-05",
    continentCode: 10,
    countryId: "US",
    productKey: defaultProduct,
  });

  useEffect(() => {
    snapRef.current = {
      startMonth,
      endMonth,
      continentCode,
      countryId,
      productKey,
    };
  }, [startMonth, endMonth, continentCode, countryId, productKey]);

  const loadTrade = useCallback(
    async (tab: TradeApiType, snap: FilterSnapshot) => {
      setLoading(true);
      setRawRows([]);
      setFetchError(null);
      setFetchNotice(null);
      const { start, end } = normalizeMonthRange(snap.startMonth, snap.endMonth);
      const imexTpcd = tradeDirection === "import" ? "2" : "1";

      const params = new URLSearchParams();
      params.set("apiType", tab);
      params.set("strtYymm", monthInputToYymm(start));
      params.set("endYymm", monthInputToYymm(end));
      params.set("imexTpcd", imexTpcd);

      if (tab === "item") {
        const codes = HS_CODE_MAP[snap.productKey];
        if (codes?.length) params.set("hsSgnList", codes.join(","));
      } else if (tab === "country" && snap.countryId !== COUNTRY_FILTER_ALL) {
        params.set("cntyCd", snap.countryId);
      } else if (
        tab === "continent" &&
        snap.continentCode !== CONTINENT_FILTER_ALL
      ) {
        params.set("cntnEbkUnfcClsfCd", String(snap.continentCode));
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
        console.log(
          "[/api/trade] 전체 JSON",
          JSON.stringify(body, null, 2),
        );
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
    void loadTrade(apiTypeTab, snapRef.current);
  }, [apiTypeTab, tradeDirection, loadTrade]);

  const handleSearch = useCallback(() => {
    const { start, end } = normalizeMonthRange(startMonth, endMonth);
    if (start !== startMonth || end !== endMonth) {
      setStartMonth(start);
      setEndMonth(end);
    }
    setApplied({
      apiTab: apiTypeTab,
      continentCode,
      countryId,
      startMonth: start,
      endMonth: end,
      productKey,
    });
    void loadTrade(apiTypeTab, {
      startMonth: start,
      endMonth: end,
      continentCode,
      countryId,
      productKey,
    });
  }, [
    apiTypeTab,
    continentCode,
    countryId,
    endMonth,
    loadTrade,
    productKey,
    startMonth,
  ]);

  const sortedRows = useMemo(() => {
    return [...rawRows].sort((a, b) => a.month.localeCompare(b.month));
  }, [rawRows]);

  const enrichedRows = useMemo(
    () => enrichTradeRows(sortedRows),
    [sortedRows],
  );

  const filteredRows = useMemo(() => {
    return enrichedRows.filter(
      (r) => r.month >= applied.startMonth && r.month <= applied.endMonth,
    );
  }, [applied.endMonth, applied.startMonth, enrichedRows]);

  const imexLabel = tradeDirection === "import" ? "수입" : "수출";
  const pageTitle = `${imexLabel} 대시보드`;
  const unitPriceColumnLabel =
    tradeDirection === "import" ? "수입단가" : "수출단가";

  const regionLabel = useMemo(() => regionLabelFromApplied(applied), [applied]);

  const conditionSummary = useMemo(() => {
    return `조회 반영 조건: [${imexLabel}] / [${apiTabLabel(applied.apiTab)}] / ${regionLabel} / ${formatMonthDot(applied.startMonth)}~${formatMonthDot(applied.endMonth)}${applied.apiTab === "item" ? ` / ${applied.productKey}` : ""}`;
  }, [applied, imexLabel, regionLabel]);

  const draftHint = useMemo(() => {
    const r = regionLabelFromApplied({
      apiTab: apiTypeTab,
      continentCode,
      countryId,
      startMonth,
      endMonth,
      productKey,
    });
    return `편집 중: [${apiTabLabel(apiTypeTab)}] / ${r} · ${formatMonthDot(startMonth)}~${formatMonthDot(endMonth)}${apiTypeTab === "item" ? ` / ${productKey}` : ""} (조회하기로 조건 고정)`;
  }, [
    apiTypeTab,
    continentCode,
    countryId,
    endMonth,
    productKey,
    startMonth,
  ]);

  const chartCategories = filteredRows.map((r) => formatMonthDot(r.month));
  const chartWeights = filteredRows.map((r) => r.weight);

  const chartKey = useMemo(
    () =>
      [
        applied.apiTab,
        applied.continentCode,
        applied.countryId,
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
  const continentGroupName = `continent-${tradeDirection}`;
  const countryGroupName = `country-${tradeDirection}`;

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
            <p className="mb-2 text-xs font-medium text-slate-500">
              데이터 구분 · 탭을 바꾸면 <code className="text-xs">/api/trade</code>로
              해당 유형을 조회합니다. 조건을 바꾼 뒤에는{" "}
              <span className="text-brand-navy">조회하기</span>로 상단 요약을 맞출 수
              있습니다.
            </p>
            <DepthTabs
              items={API_VIEW_TABS}
              value={apiTypeTab}
              onChange={setApiTypeTab}
              size="md"
            />
          </div>

          {fetchError ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {fetchError}
            </div>
          ) : null}

          <article className="flex min-h-[400px] flex-col rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/80">
            <div className="mb-2 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-slate-900">
                  월별 중량 추이
                </h2>
                <p className="mt-0.5 text-xs text-slate-500">
                  {regionLabel} · 공공 API(
                  {apiTabLabel(applied.apiTab)}) · 우상단 PNG 저장
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
                weights={chartWeights}
              />
            ) : null}
          </article>

          <article className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200/80">
            <h2 className="mb-4 text-base font-semibold text-slate-900">데이터 표</h2>
            <div className="overflow-x-auto rounded-xl ring-1 ring-slate-100">
              <table className="w-full min-w-[520px] border-collapse text-left text-sm">
                <thead>
                  <tr className="bg-slate-100/80 text-slate-600">
                    <th className="px-4 py-3 font-semibold">월</th>
                    <th className="px-4 py-3 font-semibold">중량</th>
                    <th className="px-4 py-3 font-semibold">증감률(MoM)</th>
                    <th className="px-4 py-3 font-semibold">금액(백만 USD)</th>
                    <th className="px-4 py-3 font-semibold">{unitPriceColumnLabel}</th>
                  </tr>
                </thead>
                <tbody className="text-slate-800">
                  {filteredRows.map((row) => {
                    let momClass = "text-slate-600";
                    if (row.momValue === null) momClass = "text-slate-500";
                    else if (row.momValue > 0) momClass = "font-medium text-red-600";
                    else if (row.momValue < 0) momClass = "font-medium text-blue-600";

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
                        <td className={`px-4 py-3 tabular-nums ${momClass}`}>
                          {row.momDisplay}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {typeof row.amount === "number"
                            ? row.amount.toLocaleString(undefined, {
                                maximumFractionDigits: 2,
                              })
                            : row.amount}
                        </td>
                        <td className="px-4 py-3 tabular-nums">
                          {row.unitPrice.toFixed(1)}
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

          {apiTypeTab === "overall" ? (
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 ring-1 ring-slate-100">
              수출입총괄은 대륙·국가 코드 없이 기간·수입/수출만 전달합니다.
            </p>
          ) : null}

          {apiTypeTab === "continent" ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                대륙
              </legend>
              <div className="max-h-[240px] space-y-1 overflow-y-auto rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                {CONTINENT_RADIO_OPTIONS.map((opt) => (
                  <label
                    key={String(opt.code)}
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
                    {opt.code === CONTINENT_FILTER_ALL ? (
                      <span className="min-w-0 flex-1 font-medium text-slate-700">
                        {opt.name}
                      </span>
                    ) : (
                      <>
                        <span className="tabular-nums text-slate-500">
                          {opt.code}
                        </span>
                        <span className="min-w-0 flex-1">{opt.name}</span>
                      </>
                    )}
                  </label>
                ))}
              </div>
            </fieldset>
          ) : null}

          {apiTypeTab === "country" ? (
            <fieldset className="space-y-2">
              <legend className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                국가
              </legend>
              <div className="space-y-1 rounded-xl bg-slate-50 p-2 ring-1 ring-slate-100">
                {COUNTRY_RADIO_OPTIONS.map((opt) => (
                  <label
                    key={opt.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
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
                      className="h-4 w-4 border-slate-300 text-brand-navy focus:ring-brand-navy"
                    />
                    <span>{opt.name}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-slate-500">
                「전체 국가」는 API에 미전달됩니다(추후 분할 합산 연동).
              </p>
            </fieldset>
          ) : null}

          {apiTypeTab === "item" ? (
            <p className="text-xs text-slate-500">
              품목별은 선택한 품목의 HS 코드 전체를 서버에서 병렬 조회·월별 합산합니다.
            </p>
          ) : null}

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
              품목 (품목별 API 시 HS 목록)
            </legend>
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
