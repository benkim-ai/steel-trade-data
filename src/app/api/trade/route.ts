export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { TRADE_API_URLS } from "@/constants/apiEndpoints";
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

/** 대륙별 + 품목(HS) — GW `imexTpcd`·`cntnEbkUnfcClsfCd`·`hsSgn` */
function buildContinentTradeUrl(
  serviceKey: string,
  parts: {
    normalizedStart: string;
    normalizedEnd: string;
    pageNo: string;
    numOfRows: string;
    imexTpcd: string;
    cntnEbkUnfcClsfCd: string;
    hsSgn: string;
  },
): string {
  const base = TRADE_API_URLS.continent;
  return `${base}?serviceKey=${serviceKey}&strtYymm=${parts.normalizedStart}&endYymm=${parts.normalizedEnd}&pageNo=${parts.pageNo}&numOfRows=${parts.numOfRows}&imexTpcd=${parts.imexTpcd}&cntnEbkUnfcClsfCd=${parts.cntnEbkUnfcClsfCd}&hsSgn=${parts.hsSgn}`;
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

/** 단일 cntyCd에 대해 기간·HS 구간별 GW 품목·국가별 호출 후 월별 합산된 행 */
async function runNitemtradeForCountry(
  cntyCd: string,
  serviceKey: string,
  tradeDirection: TradeXmlDirection,
  common: NonNullable<ReturnType<typeof buildCommonParams>>,
  hsList: string[],
  windows: { start: string; end: string }[],
): Promise<{ rows: TradeRow[]; settled: NitemtradeSettled[] }> {
  const parseOpts = { tradeDirection };
  const allSettled: NitemtradeSettled[] = [];

  for (const w of windows) {
    const settled = await Promise.all(
      hsList.map(async (hsSgn) => {
        const url = buildNitemtradeUrl(serviceKey, {
          normalizedStart: w.start,
          normalizedEnd: w.end,
          pageNo: common.pageNo,
          numOfRows: common.numOfRows,
          cntyCd,
          hsSgn,
        });
        try {
          const { text, status } = await fetchUpstreamXml(url);
          if (status >= 400) {
            const { debug } = parseTradeXmlToRows(text, status, parseOpts);
            return {
              rows: [] as TradeRow[],
              debug: {
                ...debug,
                resultMsg: `${debug.resultMsg ?? ""} upstream HTTP ${status} (cntyCd=${cntyCd}, hsSgn=${hsSgn}, ${w.start}~${w.end})`.trim(),
              },
            };
          }
          return parseTradeXmlToRows(text, status, parseOpts);
        } catch (e) {
          return {
            rows: [] as TradeRow[],
            debug: emptyFetchDebug(
              `품목·국가별 예외 (cntyCd=${cntyCd}, hsSgn=${hsSgn}, ${w.start}~${w.end}): ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
          };
        }
      }),
    );
    allSettled.push(...settled);
  }

  const merged = mergeRowsByMonth(allSettled.flatMap((s) => s.rows));
  return { rows: merged, settled: allSettled };
}

/** 전체 합계: 국가 단위로 소량 병렬 호출(과도한 동시 요청 방지) */
const NITEMTRADE_ALL_COUNTRIES_PARALLEL = 4;

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

  let merged: TradeRow[];
  let allSettled: NitemtradeSettled[];

  if (countryId === COUNTRY_FILTER_ALL) {
    const countryCodes = CUSTOMS_COUNTRY_OPTIONS.map((o) => o.id);
    const perCountryRows: TradeRow[] = [];
    allSettled = [];
    for (let i = 0; i < countryCodes.length; i += NITEMTRADE_ALL_COUNTRIES_PARALLEL) {
      const batch = countryCodes.slice(i, i + NITEMTRADE_ALL_COUNTRIES_PARALLEL);
      const results = await Promise.all(
        batch.map((cc) =>
          runNitemtradeForCountry(cc, serviceKey, tradeDirection, common, hsList, windows),
        ),
      );
      for (const r of results) {
        perCountryRows.push(...r.rows);
        allSettled.push(...r.settled);
      }
    }
    merged = mergeRowsByMonth(perCountryRows);
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

  const anySuccess = allSettled.some((r) => r.rows.length > 0);
  const someFailed = allSettled.some((r) => r.rows.length === 0);
  const chunked = windows.length > 1;
  const isAllCountries = countryId === COUNTRY_FILTER_ALL;

  return {
    ok: true,
    rows: merged,
    apiType: "nitemtrade",
    notice:
      merged.length === 0
        ? "품목·국가별 API 응답 파싱 결과 비어 있음 — 필드명·키·기간을 확인하세요."
        : [
            isAllCountries
              ? `전체 합계: 관세청 국가코드 ${CUSTOMS_COUNTRY_OPTIONS.length}개국 × HS 병렬 조회 후 월별 합산했습니다. 완료까지 시간이 걸릴 수 있습니다.`
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

const VALID_CONTINENT_CODES = new Set([
  "10", "20", "30", "40", "50", "60", "70", "80", "99",
]);

/**
 * 품목·대륙별(GW) — HS별 병렬 호출 후 월별 합산. `imexTpcd`는 수입/수출 탭에 맞춤.
 * 응답은 총괄형 필드(netWght 등)로 파싱(`tradeDirection` 미사용).
 */
async function handleContinentProduct(
  sp: URLSearchParams,
  serviceKey: string,
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

  if (!VALID_CONTINENT_CODES.has(continentCode)) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error: `유효하지 않은 continentCode: ${continentCode} (조회코드 엑셀 대륙코드 10~99)`,
    };
  }

  const productKey = sp.get("productKey")?.trim() ?? "";
  if (!productKey || !HS_CODE_MAP[productKey]?.length) {
    return {
      ok: false,
      rows: [],
      apiType: "continent",
      error: `유효한 productKey(HS_CODE_MAP 키)가 필요합니다. 받은 값: "${productKey}"`,
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
      apiType: "continent",
      error: "해당 품목에 유효한 10자리 HS 코드가 없습니다.",
    };
  }

  const imexTpcd = tradeDirection === "import" ? "2" : "1";

  const windows = splitYymmRangeInclusive(
    common.normalizedStart,
    common.normalizedEnd,
    API_YXMM_CHUNK_MONTHS,
  );

  const allSettled: { rows: TradeRow[]; debug: TradeParseDebug }[] = [];

  for (const w of windows) {
    const settled = await Promise.all(
      hsList.map(async (hsSgn) => {
        const url = buildContinentTradeUrl(serviceKey, {
          normalizedStart: w.start,
          normalizedEnd: w.end,
          pageNo: common.pageNo,
          numOfRows: common.numOfRows,
          imexTpcd,
          cntnEbkUnfcClsfCd: continentCode,
          hsSgn,
        });
        try {
          const { text, status } = await fetchUpstreamXml(url);
          if (status >= 400) {
            const { debug } = parseTradeXmlToRows(text, status);
            return {
              rows: [] as TradeRow[],
              debug: {
                ...debug,
                resultMsg: `${debug.resultMsg ?? ""} upstream HTTP ${status} (hsSgn=${hsSgn}, ${w.start}~${w.end})`.trim(),
              },
            };
          }
          return parseTradeXmlToRows(text, status);
        } catch (e) {
          return {
            rows: [] as TradeRow[],
            debug: emptyFetchDebug(
              `대륙별 예외 (hsSgn=${hsSgn}, ${w.start}~${w.end}): ${
                e instanceof Error ? e.message : String(e)
              }`,
            ),
          };
        }
      }),
    );
    allSettled.push(...settled);
  }

  const merged = mergeRowsByMonth(allSettled.flatMap((s) => s.rows));
  const debugWhenEmpty =
    merged.length === 0
      ? (allSettled
          .map((s) => s.debug)
          .find((d) => d.extractedRawItems > 0) ?? allSettled[0]?.debug)
      : undefined;

  const anySuccess = allSettled.some((r) => r.rows.length > 0);
  const someFailed = allSettled.some((r) => r.rows.length === 0);
  const chunked = windows.length > 1;

  return {
    ok: true,
    rows: merged,
    apiType: "continent",
    notice:
      merged.length === 0
        ? "대륙별 API 응답 파싱 결과 비어 있음 — hsSgn 지원 여부·필드명·기간을 확인하세요."
        : [
            someFailed && anySuccess
              ? "일부 HS·기간 구간 요청은 실패했으나, 성공한 구간만 합산했습니다."
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

/**
 * GET /api/trade
 * 품목·국가별: regionMode=country(기본), tradeDirection, productKey, countryId, strtYymm, endYymm
 * 품목·대륙별: regionMode=continent, tradeDirection, productKey, continentCode, strtYymm, endYymm
 * 수출입총괄: apiType=overall, strtYymm, endYymm, imexTpcd, pageNo(기본 1), numOfRows(기본 999)
 */
export async function GET(req: NextRequest): Promise<NextResponse<TradeApiResponse>> {
  const serviceKey = getServiceKey();
  if (!serviceKey) {
    return NextResponse.json(
      {
        ok: false,
        rows: [],
        apiType: "overall",
        error: "서버 환경변수 TRADE_API_KEY 가 설정되지 않았습니다.",
      },
      { status: 200 },
    );
  }

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
              serviceKey,
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
