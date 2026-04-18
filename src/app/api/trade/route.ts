export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { TRADE_API_URLS } from "@/constants/apiEndpoints";
import { mergeRowsByMonth, parseTradeXmlToRows } from "@/lib/tradeXmlNormalize";
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
): Promise<{ rows: TradeRow[]; debug: TradeParseDebug }> {
  const { text, status } = await fetchUpstreamXml(url);
  return parseTradeXmlToRows(text, status);
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
const DEFAULT_NUM_OF_ROWS = "999";

/**
 * 클라이언트 `strtYymm`/`endYymm` 또는 `searchBgnDe`/`searchEndDe` → 공공 API에 넣을 6자리 YYYYMM 값.
 * (공공 API 쿼리 키 이름은 `strtYymm`/`endYymm` — `buildCustomsTradeUrl`에서 사용)
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
 * 기간은 기술문서대로 `strtYymm` / `endYymm` 쿼리 키로 전달.
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
    hsSgn?: string;
    cntyCd?: string;
    cntnEbkUnfcClsfCd?: string;
  },
): string {
  let requestUrl = `${baseUrl}?serviceKey=${serviceKey}&strtYymm=${parts.normalizedStart}&endYymm=${parts.normalizedEnd}&pageNo=${parts.pageNo}&numOfRows=${parts.numOfRows}`;
  requestUrl += parts.imexTpcd ? `&imexTpcd=${parts.imexTpcd}` : "";
  requestUrl += parts.hsSgn ? `&hsSgn=${parts.hsSgn}` : "";
  requestUrl += parts.cntyCd ? `&cntyCd=${parts.cntyCd}` : "";
  requestUrl += parts.cntnEbkUnfcClsfCd
    ? `&cntnEbkUnfcClsfCd=${parts.cntnEbkUnfcClsfCd}`
    : "";
  return requestUrl;
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

/** 품목별 — HS 코드별 병렬 호출 후 월 단위 합산 */
async function handleItem(
  sp: URLSearchParams,
  serviceKey: string,
): Promise<TradeApiResponse> {
  const common = buildCommonParams(sp);
  if (!common) {
    return {
      ok: false,
      rows: [],
      apiType: "item",
      error: "기간(strtYymm/endYymm 또는 searchBgnDe/searchEndDe) 필요",
    };
  }

  const rawList = sp.get("hsSgnList") ?? sp.get("hsSgn") ?? "";
  const hsList = rawList
    .split(/[,\s]+/)
    .map((s) => s.replace(/\D/g, ""))
    .filter((s) => s.length === 10);

  if (hsList.length === 0) {
    return {
      ok: true,
      rows: [],
      apiType: "item",
      notice: "hsSgnList(10자리 HS, 콤마 구분) 없음 — 기술문서 확정 후 필수 파라미터 연동",
    };
  }

  /** HS 코드당 1회 호출; 일부만 500/예외여도 나머지 합산 */
  const settled = await Promise.all(
    hsList.map(async (hsSgn) => {
      const url = buildCustomsTradeUrl(TRADE_API_URLS.item, serviceKey, {
        normalizedStart: common.normalizedStart,
        normalizedEnd: common.normalizedEnd,
        imexTpcd: common.imexTpcd,
        pageNo: common.pageNo,
        numOfRows: common.numOfRows,
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
              resultMsg: `${debug.resultMsg ?? ""} upstream HTTP ${status} (hsSgn=${hsSgn})`.trim(),
            },
          };
        }
        return parseTradeXmlToRows(text, status);
      } catch (e) {
        return {
          rows: [] as TradeRow[],
          debug: emptyFetchDebug(
            `품목별 예외 (hsSgn=${hsSgn}): ${
              e instanceof Error ? e.message : String(e)
            }`,
          ),
        };
      }
    }),
  );

  const merged = mergeRowsByMonth(settled.flatMap((s) => s.rows));
  const debugWhenEmpty =
    merged.length === 0
      ? (settled
          .map((s) => s.debug)
          .find((d) => d.extractedRawItems > 0) ?? settled[0]?.debug)
      : undefined;

  return {
    ok: true,
    rows: merged,
    apiType: "item",
    notice:
      settled.some((r) => r.rows.length > 0)
        ? undefined
        : "품목별 API 응답 파싱 결과 비어 있음 — 실제 필드명 확인 필요",
    ...(merged.length === 0 && debugWhenEmpty ? { debug: debugWhenEmpty } : {}),
  };
}

/** 국가별 — 단일 cntyCd (스텁: 동일 strtYymm 패턴으로 호출 시도) */
async function handleCountry(
  sp: URLSearchParams,
  serviceKey: string,
): Promise<TradeApiResponse> {
  const common = buildCommonParams(sp);
  if (!common) {
    return {
      ok: false,
      rows: [],
      apiType: "country",
      error: "기간(strtYymm/endYymm 또는 searchBgnDe/searchEndDe) 필요",
    };
  }

  const cnty = sp.get("cntyCd")?.trim();
  if (!cnty) {
    return {
      ok: true,
      rows: [],
      apiType: "country",
      notice: "cntyCd 없음 — 국가별 API 필수 파라미터 연동 예정",
    };
  }

  const url = buildCustomsTradeUrl(TRADE_API_URLS.country, serviceKey, {
    normalizedStart: common.normalizedStart,
    normalizedEnd: common.normalizedEnd,
    imexTpcd: common.imexTpcd,
    pageNo: common.pageNo,
    numOfRows: common.numOfRows,
    cntyCd: cnty,
  });
  try {
    const { rows, debug } = await fetchTradeRowsFromUrl(url);
    return {
      ok: true,
      rows,
      apiType: "country",
      notice:
        rows.length === 0
          ? "국가별 API 응답 없음 또는 필드 매핑 미스 — 문서 기준으로 점검"
          : undefined,
      ...(rows.length === 0 ? { debug } : {}),
    };
  } catch {
    return {
      ok: true,
      rows: [],
      apiType: "country",
      notice: "국가별 API 호출 실패(스텁)",
    };
  }
}

/** 대륙별 — cntnEbkUnfcClsfCd (스텁) */
async function handleContinent(
  sp: URLSearchParams,
  serviceKey: string,
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

  const cd = sp.get("cntnEbkUnfcClsfCd")?.trim();
  if (!cd || cd === "ALL") {
    return {
      ok: true,
      rows: [],
      apiType: "continent",
      notice: "대륙별 단일 코드 필요 — ALL은 API 미지원(추후 분할 호출 합산)",
    };
  }

  const url = buildCustomsTradeUrl(TRADE_API_URLS.continent, serviceKey, {
    normalizedStart: common.normalizedStart,
    normalizedEnd: common.normalizedEnd,
    imexTpcd: common.imexTpcd,
    pageNo: common.pageNo,
    numOfRows: common.numOfRows,
    cntnEbkUnfcClsfCd: cd,
  });
  try {
    const { rows, debug } = await fetchTradeRowsFromUrl(url);
    return {
      ok: true,
      rows,
      apiType: "continent",
      notice:
        rows.length === 0
          ? "대륙별 API 응답 없음 또는 필드 매핑 미스 — 문서 기준으로 점검"
          : undefined,
      ...(rows.length === 0 ? { debug } : {}),
    };
  } catch {
    return {
      ok: true,
      rows: [],
      apiType: "continent",
      notice: "대륙별 API 호출 실패(스텁)",
    };
  }
}

/**
 * GET /api/trade
 * 쿼리: apiType(overall|item|country|continent),
 * strtYymm, endYymm (YYYY-MM 또는 YYYYMM 6자리) 또는 searchBgnDe, searchEndDe,
 * imexTpcd, hsSgnList, cntyCd, cntnEbkUnfcClsfCd, pageNo(기본 1), numOfRows(기본 999)
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
  const apiType = (searchParams.get("apiType") || "overall") as TradeApiType;

  try {
    switch (apiType) {
      case "overall":
        return NextResponse.json(await handleOverall(searchParams, serviceKey));
      case "item":
        return NextResponse.json(await handleItem(searchParams, serviceKey));
      case "country":
        return NextResponse.json(await handleCountry(searchParams, serviceKey));
      case "continent":
        return NextResponse.json(await handleContinent(searchParams, serviceKey));
      default:
        return NextResponse.json({
          ok: false,
          rows: [],
          apiType: "overall",
          error: `지원하지 않는 apiType: ${apiType}`,
        });
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        rows: [],
        apiType,
        error: e instanceof Error ? e.message : String(e),
      },
      { status: 200 },
    );
  }
}
