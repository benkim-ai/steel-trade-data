export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { TRADE_API_URLS } from "@/constants/apiEndpoints";
import {
  mapContinentCodeToRegionName,
  mapUiProductToKosaItemName,
} from "@/constants/continentQueryMappings";
import { CUSTOMS_COUNTRY_OPTIONS } from "@/constants/customsCountryCodes";
import { HS_CODE_MAP } from "@/constants/hsCodes";
import { COUNTRY_FILTER_ALL } from "@/constants/mappings";
import { mergeRowsByMonth, parseTradeXmlToRows } from "@/lib/tradeXmlNormalize";
import type { TradeXmlDirection } from "@/lib/tradeXmlNormalize";
import { splitYymmRangeInclusive } from "@/lib/yymmChunk";
import type {
  TradeApiType,
  TradeApiResponse,
  TradeParseDebug,
  TradeRow,
} from "@/types/trade";

function getServiceKey(): string | null {
  const k = process.env.TRADE_API_KEY?.trim();
  return k || null;
}

function getSupabaseServerClient() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  if (!supabaseUrl || !serviceKey) return null;
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** YYYYMMDD 등에서 앞 6자리 YYYYMM 추출 */
function yymmFromDe(de: string | null): string | null {
  if (!de) return null;
  const d = de.replace(/\D/g, "");
  if (d.length >= 6) return d.slice(0, 6);
  return null;
}

/** 쿼리의 `strtYymm` / `endYymm` 값 정규화 (관세청 API는 보통 6자리 YYYYMM) */
function normalizeYymmParam(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 6) return null;
  const yymm = digits.slice(0, 6);
  const mm = Number(yymm.slice(4, 6));
  if (mm < 1 || mm > 12) return null;
  return yymm;
}

function yymmToMonthStartDate(yymm: string): string {
  return `${yymm.slice(0, 4)}-${yymm.slice(4, 6)}-01`;
}

function maskServiceKeyInUrl(url: string): string {
  return url.replace(/serviceKey=[^&]*/i, "serviceKey=***MASKED***");
}

async function fetchUpstreamXml(requestUrl: string): Promise<{ text: string; status: number }> {
  console.log("요청 URL:", maskServiceKeyInUrl(requestUrl));
  const res = await fetch(requestUrl, {
    cache: "no-store",
    headers: { Accept: "application/xml, text/xml, */*" },
  });
  const text = await res.text();
  console.log("응답 상태:", res.status);
  console.log("응답 데이터:", text.substring(0, 300));
  return { text, status: res.status };
}

async function fetchTradeRowsFromUrl(
  url: string,
  parseOpts?: { tradeDirection?: TradeXmlDirection },
): Promise<{ rows: TradeRow[]; debug: TradeParseDebug }> {
  const { text, status } = await fetchUpstreamXml(url);
  return parseTradeXmlToRows(text, status, parseOpts);
}

function emptyFetchDebug(msg: string): TradeParseDebug {
  return {
    rawXmlPreview: "",
    extractedRawItems: 0,
    normalizedRows: 0,
    resultMsg: msg,
  };
}

const DEFAULT_PAGE_NO = "1";
/** 월별 행 위주 응답에 맞춘 상한(한 창 기준) */
const DEFAULT_NUM_OF_ROWS = "999";
const STEEL_COUNTRY_TABLE =
  process.env.KOSA_STEEL_COUNTRY_TABLE?.trim() || "kosa_steel_country_data";
const STEEL_COUNTRY_SUPABASE_END_YYMM = "202512";

/** 관세청 GW가 한 번에 긴 기간을 잘라 주는 경우가 있어, 최대 이 개월 단위로 나눠 호출 후 합산 */
const API_YXMM_CHUNK_MONTHS = 12;

/**
 * 클라이언트 `strtYymm`/`endYymm` 또는 `searchBgnDe`/`searchEndDe` → 공공 API에 넣을 6자리 YYYYMM 값.
 */
function buildCommonParams(sp: URLSearchParams): {
  normalizedStart: string;
  normalizedEnd: string;
  imexTpcd: string | null;
  pageNo: string;
  numOfRows: string;
} | null {
  let normalizedStart = normalizeYymmParam(sp.get("strtYymm"));
  let normalizedEnd = normalizeYymmParam(sp.get("endYymm"));

  if (!normalizedStart || !normalizedEnd) {
    normalizedStart = yymmFromDe(sp.get("searchBgnDe"));
    normalizedEnd = yymmFromDe(sp.get("searchEndDe"));
  }

  if (!normalizedStart || !normalizedEnd) return null;

  return {
    normalizedStart,
    normalizedEnd,
    imexTpcd: sp.get("imexTpcd"),
    pageNo: sp.get("pageNo")?.trim() || DEFAULT_PAGE_NO,
    numOfRows: sp.get("numOfRows")?.trim() || DEFAULT_NUM_OF_ROWS,
  };
}

/**
 * 관세청 오픈API URL — `URLSearchParams.toString()` 사용 금지(인코딩 이슈·500 방지).
 * TRADE_API_KEY는 공공데이터포털에서 발급된 인코딩 키 그대로 두고 `encodeURIComponent` 하지 않음.
 */
function buildCustomsTradeUrl(
  baseUrl: string,
  serviceKey: string,
  parts: {
    normalizedStart: string;
    normalizedEnd: string;
    pageNo: string;
    numOfRows: string;
    imexTpcd?: string | null;
  },
): string {
  let requestUrl = `${baseUrl}?serviceKey=${serviceKey}&strtYymm=${parts.normalizedStart}&endYymm=${parts.normalizedEnd}&pageNo=${parts.pageNo}&numOfRows=${parts.numOfRows}`;
  requestUrl += parts.imexTpcd ? `&imexTpcd=${parts.imexTpcd}` : "";
  return requestUrl;
}

function buildNitemtradeUrl(
  serviceKey: string,
  parts: {
    normalizedStart: string;
    normalizedEnd: string;
    pageNo: string;
    numOfRows: string;
    cntyCd: string;
    hsSgn: string;
  },
): string {
  const base = TRADE_API_URLS.nitemtrade;
  return `${base}?serviceKey=${serviceKey}&strtYymm=${parts.normalizedStart}&endYymm=${parts.normalizedEnd}&pageNo=${parts.pageNo}&numOfRows=${parts.numOfRows}&cntyCd=${parts.cntyCd}&hsSgn=${parts.hsSgn}`;
}

function buildItemtradeUrl(
  serviceKey: string,
  parts: {
    normalizedStart: string;
    normalizedEnd: string;
    pageNo: string;
    numOfRows: string;
    imexTpcd: string;
    hsSgn: string;
  },
): string {
  const base = TRADE_API_URLS.itemtrade;
  return `${base}?serviceKey=${serviceKey}&strtYymm=${parts.normalizedStart}&endYymm=${parts.normalizedEnd}&pageNo=${parts.pageNo}&numOfRows=${parts.numOfRows}&imexTpcd=${parts.imexTpcd}&hsSgn=${parts.hsSgn}`;
}

/** 수출입총괄 — `strtYymm`/`endYymm`(6자리 YYYYMM)으로 상류 호출 */
async function handleOverall(
  sp: URLSearchParams,
  serviceKey: string,
): Promise<TradeApiResponse> {
  const common = buildCommonParams(sp);
  if (!common) {
    return {
      ok: false,
      rows: [],
      apiType: "overall",
      error:
        "strtYymm·endYymm(YYYYMM 6자리) 또는 searchBgnDe·searchEndDe(날짜에서 추출 가능한 6자리 이상) 필요",
    };
  }

  const url = buildCustomsTradeUrl(TRADE_API_URLS.overall, serviceKey, {
    normalizedStart: common.normalizedStart,
    normalizedEnd: common.normalizedEnd,
    imexTpcd: common.imexTpcd,
    pageNo: common.pageNo,
    numOfRows: common.numOfRows,
  });
  const { rows, debug } = await fetchTradeRowsFromUrl(url);
  return {
    ok: true,
    rows,
    apiType: "overall",
    ...(rows.length === 0 ? { debug } : {}),
  };
}

type NitemtradeSettled = { rows: TradeRow[]; debug: TradeParseDebug };
type NitemtradeAttempt = NitemtradeSettled & {
  ok: boolean;
  requestLabel: string;
};

function parseTradeXmlWithFallback(
  text: string,
  status: number,
  tradeDirection: TradeXmlDirection,
): { rows: TradeRow[]; debug: TradeParseDebug } {
  const preferred = parseTradeXmlToRows(text, status, { tradeDirection });
  if (preferred.rows.length > 0) return preferred;
  const fallback = parseTradeXmlToRows(text, status);
  return fallback.rows.length > 0 ? fallback : preferred;
}

const HS_FETCH_CONCURRENCY = 8;
const HS_FETCH_MAX_ATTEMPTS = 4;
const HS_FETCH_RETRY_BASE_MS = 400;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryUpstreamStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

async function runWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(worker));
    out.push(...chunkResults);
  }
  return out;
}

async function fetchTradeAttemptWithRetry(
  requestLabel: string,
  tradeDirection: TradeXmlDirection,
  buildUrl: () => string,
): Promise<NitemtradeAttempt> {
  let lastFailure: NitemtradeAttempt | null = null;

  for (let attempt = 1; attempt <= HS_FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const { text, status } = await fetchUpstreamXml(buildUrl());
      if (status < 400) {
        const parsed = parseTradeXmlWithFallback(text, status, tradeDirection);
        return {
          ...parsed,
          ok: true,
          requestLabel,
        };
      }

      const parsed = parseTradeXmlWithFallback(text, status, tradeDirection);
      lastFailure = {
        rows: [],
        debug: {
          ...parsed.debug,
          resultMsg: `${parsed.debug.resultMsg ?? ""} upstream HTTP ${status} (${requestLabel}, attempt ${attempt}/${HS_FETCH_MAX_ATTEMPTS})`.trim(),
        },
        ok: false,
        requestLabel,
      };

      if (!shouldRetryUpstreamStatus(status) || attempt === HS_FETCH_MAX_ATTEMPTS) {
        return lastFailure;
      }
    } catch (e) {
      lastFailure = {
        rows: [],
        debug: emptyFetchDebug(
          `${requestLabel} 예외 (attempt ${attempt}/${HS_FETCH_MAX_ATTEMPTS}): ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
        ok: false,
        requestLabel,
      };
      if (attempt === HS_FETCH_MAX_ATTEMPTS) return lastFailure;
    }

    await sleep(HS_FETCH_RETRY_BASE_MS * 2 ** (attempt - 1));
  }

  return (
    lastFailure ?? {
      rows: [],
      debug: emptyFetchDebug(`${requestLabel} 알 수 없는 실패`),
      ok: false,
      requestLabel,
    }
  );
}

/** 단일 cntyCd에 대해 기간·HS 구간별 GW 품목·국가별 호출 후 월별 합산된 행 */
async function runNitemtradeForCountry(
  cntyCd: string,
  serviceKey: string,
  tradeDirection: TradeXmlDirection,
  common: NonNullable<ReturnType<typeof buildCommonParams>>,
  hsList: string[],
  windows: { start: string; end: string }[],
): Promise<{ rows: TradeRow[]; settled: NitemtradeAttempt[] }> {
  const allSettled: NitemtradeAttempt[] = [];

  for (const w of windows) {
    const settled = await runWithConcurrency(
      hsList,
      HS_FETCH_CONCURRENCY,
      async (hsSgn) =>
        fetchTradeAttemptWithRetry(
          `품목·국가별 cntyCd=${cntyCd}, hsSgn=${hsSgn}, ${w.start}~${w.end}`,
          tradeDirection,
          () =>
            buildNitemtradeUrl(serviceKey, {
              normalizedStart: w.start,
              normalizedEnd: w.end,
              pageNo: common.pageNo,
              numOfRows: common.numOfRows,
              cntyCd,
              hsSgn,
            }),
        ),
    );
    allSettled.push(...settled);
  }

  const merged = mergeRowsByMonth(allSettled.filter((s) => s.ok).flatMap((s) => s.rows));
  return { rows: merged, settled: allSettled };
}

async function runItemtradeForAllCountries(
  serviceKey: string,
  tradeDirection: TradeXmlDirection,
  common: NonNullable<ReturnType<typeof buildCommonParams>>,
  hsList: string[],
  windows: { start: string; end: string }[],
): Promise<{ rows: TradeRow[]; settled: NitemtradeAttempt[] }> {
  const imexTpcd = tradeDirection === "import" ? "2" : "1";
  const allSettled: NitemtradeAttempt[] = [];

  for (const w of windows) {
    const settled = await runWithConcurrency(
      hsList,
      HS_FETCH_CONCURRENCY,
      async (hsSgn) =>
        fetchTradeAttemptWithRetry(
          `품목별 합계 hsSgn=${hsSgn}, ${w.start}~${w.end}`,
          tradeDirection,
          () =>
            buildItemtradeUrl(serviceKey, {
              normalizedStart: w.start,
              normalizedEnd: w.end,
              pageNo: common.pageNo,
              numOfRows: common.numOfRows,
              imexTpcd,
              hsSgn,
            }),
        ),
    );
    allSettled.push(...settled);
  }

  const merged = mergeRowsByMonth(allSettled.filter((s) => s.ok).flatMap((s) => s.rows));
  return { rows: merged, settled: allSettled };
}

async function fetchSteelCountryRowsFromSupabase(
  tradeDirection: TradeXmlDirection,
  countryName: string,
  startYymm: string,
  endYymm: string,
): Promise<{ rows: TradeRow[]; notice?: string; error?: string }> {
  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      rows: [],
      error:
        "Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_KEY)가 설정되지 않았습니다.",
    };
  }

  const { data, error } = await supabase
    .from(STEEL_COUNTRY_TABLE)
    .select("year_month, qty, amount")
    .eq("flow_type", tradeDirection)
    .eq("item_name", "철강재계")
    .eq("country_name", countryName)
    .gte("year_month", yymmToMonthStartDate(startYymm))
    .lte("year_month", yymmToMonthStartDate(endYymm))
    .order("year_month", { ascending: true });

  if (error) {
    return {
      rows: [],
      error: `철강재 국가별 Supabase 조회 실패: ${error.message}`,
    };
  }

  const monthly = new Map<string, { qtyTons: number; amountUsd: number }>();
  for (const r of data ?? []) {
    const ym = String((r as { year_month: unknown }).year_month ?? "")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!/^\d{6}$/.test(ym)) continue;
    const month = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
    const qtyTons = Number((r as { qty: unknown }).qty ?? 0);
    const amountUsd = Number((r as { amount: unknown }).amount ?? 0);
    const cur = monthly.get(month) ?? { qtyTons: 0, amountUsd: 0 };
    cur.qtyTons += Number.isFinite(qtyTons) ? qtyTons : 0;
    cur.amountUsd += Number.isFinite(amountUsd) ? amountUsd : 0;
    monthly.set(month, cur);
  }

  const rows: TradeRow[] = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      weight: Math.round((v.qtyTons / 1000) * 1_000_000) / 1_000_000,
      amount: Math.round((v.amountUsd / 1_000_000) * 1_000_000) / 1_000_000,
    }));

  return {
    rows,
    notice:
      rows.length > 0
        ? `철강재 2025년까지는 Supabase(${STEEL_COUNTRY_TABLE})에서 조회했습니다. country_name="${countryName}"`
        : undefined,
  };
}

/**
 * 품목·국가별(GW) — HS_CODE_MAP[productKey] 전체를 병렬 호출 후 월별 합산.
 * `countryId=ALL`이면 관세청 국가코드 전체에 대해 조회한 뒤 월별로 다시 합산.
 */
async function handleNitemtrade(
  sp: URLSearchParams,
  serviceKey: string,
  tradeDirection: TradeXmlDirection,
): Promise<TradeApiResponse> {
  const common = buildCommonParams(sp);
  if (!common) {
    return {
      ok: false,
      rows: [],
      apiType: "nitemtrade",
      error: "기간(strtYymm/endYymm 또는 searchBgnDe/searchEndDe) 필요",
    };
  }

  const productKey = sp.get("productKey")?.trim() ?? "";
  const countryId = sp.get("countryId")?.trim() ?? "";

  if (!productKey || !HS_CODE_MAP[productKey]?.length) {
    return {
      ok: false,
      rows: [],
      apiType: "nitemtrade",
      error: `유효한 productKey(HS_CODE_MAP 키)가 필요합니다. 받은 값: "${productKey}"`,
    };
  }

  if (!countryId) {
    return {
      ok: false,
      rows: [],
      apiType: "nitemtrade",
      error: "국가별 조회에는 countryId(cntyCd 또는 ALL=전체 합계)가 필요합니다.",
    };
  }

  const hsList = [
    ...new Set(
      HS_CODE_MAP[productKey]!.map((c) => c.replace(/\D/g, "")).filter((c) => c.length === 10),
    ),
  ];

  if (hsList.length === 0) {
    return {
      ok: false,
      rows: [],
      apiType: "nitemtrade",
      error: "해당 품목에 유효한 10자리 HS 코드가 없습니다.",
    };
  }

  const windows = splitYymmRangeInclusive(
    common.normalizedStart,
    common.normalizedEnd,
    API_YXMM_CHUNK_MONTHS,
  );

  const isSteelCountryHybrid =
    productKey === "철강재" && countryId !== COUNTRY_FILTER_ALL;
  if (isSteelCountryHybrid) {
    const countryName =
      CUSTOMS_COUNTRY_OPTIONS.find((o) => o.id === countryId)?.name ?? countryId;

    const supabaseEnd =
      common.normalizedEnd < STEEL_COUNTRY_SUPABASE_END_YYMM
        ? common.normalizedEnd
        : STEEL_COUNTRY_SUPABASE_END_YYMM;
    const shouldUseSupabase = common.normalizedStart <= STEEL_COUNTRY_SUPABASE_END_YYMM;

    let supabaseRows: TradeRow[] = [];
    const notices: string[] = [];
    if (shouldUseSupabase) {
      const supabasePart = await fetchSteelCountryRowsFromSupabase(
        tradeDirection,
        countryName,
        common.normalizedStart,
        supabaseEnd,
      );
      if (supabasePart.error) {
        return {
          ok: false,
          rows: [],
          apiType: "nitemtrade",
          error: supabasePart.error,
        };
      }
      supabaseRows = supabasePart.rows;
      if (supabasePart.notice) notices.push(supabasePart.notice);
    }

    const apiStart =
      common.normalizedStart > STEEL_COUNTRY_SUPABASE_END_YYMM
        ? common.normalizedStart
        : "202601";

    let apiRows: TradeRow[] = [];
    if (common.normalizedEnd >= apiStart) {
      const apiWindows = splitYymmRangeInclusive(
        apiStart,
        common.normalizedEnd,
        API_YXMM_CHUNK_MONTHS,
      );
      const apiPart = await runNitemtradeForCountry(
        countryId,
        serviceKey,
        tradeDirection,
        common,
        hsList,
        apiWindows,
      );
      const failedAttempts = apiPart.settled.filter((r) => !r.ok);
      if (failedAttempts.length > 0) {
        const sampleFailures = failedAttempts
          .slice(0, 3)
          .map((r) => r.requestLabel)
          .join(" / ");
        return {
          ok: false,
          rows: [],
          apiType: "nitemtrade",
          error: `철강재 2026년 이후 API 요청 ${apiPart.settled.length}건 중 ${failedAttempts.length}건이 끝까지 실패했습니다. 잠시 후 다시 시도해 주세요.${sampleFailures ? ` 예시: ${sampleFailures}` : ""}`,
        };
      }
      apiRows = apiPart.rows;
      if (apiWindows.length > 0) {
        notices.push("철강재 2026년 이후는 관세청 API에서 조회했습니다.");
      }
    }

    return {
      ok: true,
      rows: mergeRowsByMonth([...supabaseRows, ...apiRows]),
      apiType: "nitemtrade",
      notice: notices.join(" "),
    };
  }

  let merged: TradeRow[];
  let allSettled: NitemtradeAttempt[];

  if (countryId === COUNTRY_FILTER_ALL) {
    const all = await runItemtradeForAllCountries(
      serviceKey,
      tradeDirection,
      common,
      hsList,
      windows,
    );
    merged = all.rows;
    allSettled = all.settled;
  } else {
    const one = await runNitemtradeForCountry(
      countryId,
      serviceKey,
      tradeDirection,
      common,
      hsList,
      windows,
    );
    merged = one.rows;
    allSettled = one.settled;
  }

  const debugWhenEmpty =
    merged.length === 0
      ? (allSettled
          .map((s) => s.debug)
          .find((d) => d.extractedRawItems > 0) ?? allSettled[0]?.debug)
      : undefined;

  const failedAttempts = allSettled.filter((r) => !r.ok);
  const anySuccess = allSettled.some((r) => r.ok && r.rows.length > 0);
  const someFailed = failedAttempts.length > 0;
  const chunked = windows.length > 1;
  const isAllCountries = countryId === COUNTRY_FILTER_ALL;

  if (someFailed) {
    const sampleFailures = failedAttempts
      .slice(0, 3)
      .map((r) => r.requestLabel)
      .join(" / ");
    return {
      ok: false,
      rows: [],
      apiType: "nitemtrade",
      error: `정확한 합계를 위해 필요한 HS 요청 ${allSettled.length}건 중 ${failedAttempts.length}건이 끝까지 실패했습니다. 잠시 후 다시 시도해 주세요.${sampleFailures ? ` 예시: ${sampleFailures}` : ""}`,
      notice: chunked
        ? `조회 기간을 ${API_YXMM_CHUNK_MONTHS}개월 단위로 나누어 호출했습니다.`
        : undefined,
      ...(debugWhenEmpty ? { debug: debugWhenEmpty } : {}),
    };
  }

  return {
    ok: true,
    rows: merged,
    apiType: "nitemtrade",
    notice:
      merged.length === 0
        ? "품목·국가별 API 응답 파싱 결과 비어 있음 — 필드명·키·기간을 확인하세요."
        : [
            isAllCountries
              ? "전체 합계: 품목별 수출입실적(GW, 15101609) API를 사용해 HS 기준 월별 합계를 조회했습니다."
              : null,
            someFailed && anySuccess
              ? "일부 HS·기간·국가 요청은 실패했으나, 성공한 구간만 합산했습니다."
              : null,
            chunked
              ? `조회 기간을 ${API_YXMM_CHUNK_MONTHS}개월 단위로 나누어 호출한 뒤 월별로 합쳤습니다.`
              : null,
          ]
            .filter(Boolean)
            .join(" ") || undefined,
    ...(merged.length === 0 && debugWhenEmpty ? { debug: debugWhenEmpty } : {}),
  };
}

const KOSA_CONTINENT_TABLE = process.env.KOSA_CONTINENT_TABLE?.trim() || "kosa_trade_data";

/**
 * 품목·대륙별(KOSA/Supabase)
 * - flow_type(import|export), item_name, region_name, year_month 범위로 조회
 * - qty(톤), amount(USD)을 월별 합산 후 qty는 천톤, amount는 백만USD로 변환
 */
async function handleContinentProduct(
  sp: URLSearchParams,
  tradeDirection: TradeXmlDirection,
  continentCode: string,
): Promise<TradeApiResponse> {
  const common = buildCommonParams(sp);
  if (!common) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error: "기간(strtYymm/endYymm 또는 searchBgnDe/searchEndDe) 필요",
    };
  }

  const regionName = mapContinentCodeToRegionName(continentCode);
  if (!regionName) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error: `유효하지 않은 continentCode: ${continentCode} (허용: 10,15,20,30,40,50,60,80)`,
    };
  }

  const productKey = sp.get("productKey")?.trim() ?? "";
  if (!productKey) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error: `유효한 productKey가 필요합니다. 받은 값: "${productKey}"`,
    };
  }

  const supabase = getSupabaseServerClient();
  if (!supabase) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error:
        "Supabase 환경변수(SUPABASE_URL, SUPABASE_SERVICE_KEY)가 설정되지 않았습니다.",
    };
  }

  const mappedItemName = mapUiProductToKosaItemName(productKey);
  const startDate = yymmToMonthStartDate(common.normalizedStart);
  const endDate = yymmToMonthStartDate(common.normalizedEnd);
  const { data, error } = await supabase
    .from(KOSA_CONTINENT_TABLE)
    .select("year_month, qty, amount")
    .eq("flow_type", tradeDirection)
    .eq("item_name", mappedItemName)
    .eq("region_name", regionName)
    .gte("year_month", startDate)
    .lte("year_month", endDate)
    .order("year_month", { ascending: true });

  if (error) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error: `대륙별 Supabase 조회 실패: ${error.message}`,
    };
  }

  const monthly = new Map<string, { qty: number; amountUsd: number }>();
  for (const r of data ?? []) {
    const ym = String((r as { year_month: unknown }).year_month ?? "").replace(/\D/g, "").slice(0, 6);
    if (!/^\d{6}$/.test(ym)) continue;
    const month = `${ym.slice(0, 4)}-${ym.slice(4, 6)}`;
    const qty = Number((r as { qty: unknown }).qty ?? 0);
    const amountUsd = Number((r as { amount: unknown }).amount ?? 0);
    const cur = monthly.get(month) ?? { qty: 0, amountUsd: 0 };
    cur.qty += Number.isFinite(qty) ? qty : 0;
    cur.amountUsd += Number.isFinite(amountUsd) ? amountUsd : 0;
    monthly.set(month, cur);
  }

  const rows: TradeRow[] = [...monthly.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      weight: Math.round((v.qty / 1000) * 1_000_000) / 1_000_000,
      amount: Math.round((v.amountUsd / 1_000_000) * 1_000_000) / 1_000_000,
    }));

  return {
    ok: true,
    rows,
    apiType: "continent",
    notice:
      rows.length === 0
        ? "대륙별 Supabase 조회 결과가 비어 있습니다. 조건(flow_type/item_name/region_name/year_month)을 확인하세요."
        : `대륙별은 Supabase(${KOSA_CONTINENT_TABLE})에서 조회했습니다. item_name="${mappedItemName}", region_name="${regionName}"`,
  };
}

/**
 * GET /api/trade
 * 품목·국가별: regionMode=country(기본), tradeDirection, productKey, countryId, strtYymm, endYymm
 * 품목·대륙별: regionMode=continent, tradeDirection, productKey, continentCode, strtYymm, endYymm
 * 수출입총괄: apiType=overall, strtYymm, endYymm, imexTpcd, pageNo(기본 1), numOfRows(기본 999)
 */
export async function GET(req: NextRequest): Promise<NextResponse<TradeApiResponse>> {
  const { searchParams } = new URL(req.url);
  const productKey = searchParams.get("productKey")?.trim();
  const countryId = searchParams.get("countryId")?.trim();
  const continentCode = searchParams.get("continentCode")?.trim();
  const regionMode = (searchParams.get("regionMode") || "country").toLowerCase();
  const tdRaw = searchParams.get("tradeDirection");
  const tradeDirection: TradeXmlDirection | null =
    tdRaw === "import" || tdRaw === "export" ? tdRaw : null;

  try {
    if (productKey && tradeDirection) {
      if (regionMode === "continent") {
        if (continentCode) {
          return NextResponse.json(
            await handleContinentProduct(
              searchParams,
              tradeDirection,
              continentCode,
            ),
          );
        }
        return NextResponse.json({
          ok: false,
          rows: [],
          apiType: "continent",
          error:
            "대륙별 조회에는 continentCode(조회코드 엑셀 대륙코드, 예: 10)가 필요합니다.",
        });
      }

      if (countryId) {
        const serviceKey = getServiceKey();
        if (!serviceKey) {
          return NextResponse.json({
            ok: false,
            rows: [],
            apiType: "nitemtrade",
            error: "서버 환경변수 TRADE_API_KEY 가 설정되지 않았습니다.",
          });
        }
        return NextResponse.json(
          await handleNitemtrade(searchParams, serviceKey, tradeDirection),
        );
      }

      return NextResponse.json({
        ok: false,
        rows: [],
        apiType: "nitemtrade",
        error:
          "국가별 조회에는 countryId(cntyCd 2자리)가 필요합니다. 대륙별은 regionMode=continent&continentCode=… 를 사용하세요.",
      });
    }

    const apiType = (searchParams.get("apiType") || "overall") as TradeApiType;
    if (apiType === "overall") {
      const serviceKey = getServiceKey();
      if (!serviceKey) {
        return NextResponse.json({
          ok: false,
          rows: [],
          apiType: "overall",
          error: "서버 환경변수 TRADE_API_KEY 가 설정되지 않았습니다.",
        });
      }
      return NextResponse.json(await handleOverall(searchParams, serviceKey));
    }

    return NextResponse.json({
      ok: false,
      rows: [],
      apiType: "nitemtrade",
      error:
        "품목 조회에는 tradeDirection(import|export)와 productKey가 필요합니다. 국가별은 countryId, 대륙별은 regionMode=continent와 continentCode를 넣으세요. 수출입총괄은 apiType=overall 입니다.",
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        rows: [],
        apiType: "overall",
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 200 },
    );
  }
}
