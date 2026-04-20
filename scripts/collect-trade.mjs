/**
 * 관세청 무역통계(품목·국가별 GW) 수집 후 Supabase `trade_data` / `sync_progress` 반영.
 *
 * 응답은 기본 XML이며, `returnType=json`이 동작하는 경우 JSON도 지원(본문 자동 감지).
 *
 * 실행 예 (저장소 루트, Node 20+):
 *   node --env-file=.env.local scripts/collect-trade.mjs
 *
 * 환경변수: SUPABASE_URL, SUPABASE_SERVICE_KEY, CUSTOMS_API_KEY
 * 선택: TRADE_MAX_YYMM (기본: 당월 YYYYMM), TRADE_MIN_YYMM (수집 시작 하한 YYYYMM),
 *       TRADE_TARGET_END_YYMM (기간 완료 판정: 청크 종료월 ≥ 이 값이면 completed, 기본 202604)
 *
 * 수집 대상 HS/국가: `scripts/collect-trade.config.mjs` 파일을 편집하세요.
 */

import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseStringPromise } from "xml2js";
import { parseTradeXmlToRows } from "./tradeXmlParse.mjs";
import {
  SEED_ALL_CUSTOMS_COUNTRIES_FROM_REPO,
  TARGET_COUNTRY_CODES,
  TARGET_HS_CODES,
} from "./collect-trade.config.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");

/** 관세청 GW 품목·국가별 */
const NITEMTRADE_URL =
  "https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList";

const DAILY_CALL_LIMIT = 95_000;
const SLEEP_MS = 120;
const CHUNK_MONTHS = 12;
const NUM_OF_ROWS = "999";
const PAGE_NO = "1";

// ---------------------------------------------------------------------------
// .env 로드 (의존성 없이 루트 .env / .env.local 순으로 읽음)
// ---------------------------------------------------------------------------
function loadEnvFromFile(absPath) {
  if (!existsSync(absPath)) return;
  const text = readFileSync(absPath, "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadEnvFromFile(join(REPO_ROOT, ".env"));
loadEnvFromFile(join(REPO_ROOT, ".env.local"));

/**
 * 앱과 동일 출처: `src/constants/customsCountryCodes.ts` 에서 cntyCd 2자 추출.
 * `collect-trade.config.mjs` 의 SEED_ALL_CUSTOMS_COUNTRIES_FROM_REPO 가 true 일 때 시드에 사용.
 */
function loadAllCustomsCountryIdsFromRepo() {
  const p = join(REPO_ROOT, "src/constants/customsCountryCodes.ts");
  if (!existsSync(p)) {
    console.log("⚠️ 국가 코드 파일을 찾을 수 없습니다:", p);
    return [...TARGET_COUNTRY_CODES];
  }
  const text = readFileSync(p, "utf8");
  const set = new Set();
  const re = /\{\s*id:\s*'([A-Z0-9]{2})'/g;
  let m;
  while ((m = re.exec(text))) set.add(m[1]);
  const list = [...set].sort();
  if (list.length === 0) return [...TARGET_COUNTRY_CODES];
  return list;
}

/** sync_progress 시드용 국가 목록 */
function getCountriesForSeed() {
  if (SEED_ALL_CUSTOMS_COUNTRIES_FROM_REPO) {
    const all = loadAllCustomsCountryIdsFromRepo();
    console.log(
      `시드: 관세청 국가 코드 ${all.length}개 × HS ${TARGET_HS_CODES.length}개 조합을 sync_progress에 등록 시도합니다.`,
    );
    return all;
  }
  return [...TARGET_COUNTRY_CODES];
}

function minYymm(a, b) {
  return a <= b ? a : b;
}

/** YYYYMM + delta월 */
function yymmAddMonths(yymm, delta) {
  const y = Number(yymm.slice(0, 4));
  const m = Number(yymm.slice(4, 6));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yymm;
  const idx = y * 12 + (m - 1) + delta;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${String(yy).padStart(4, "0")}${String(mm).padStart(2, "0")}`;
}

/**
 * [startYymm, endYymm] 달력 구간을 최대 CHUNK_MONTHS개월(포함) 창으로 분할.
 */
function splitYymmRangeInclusive(startYymm, endYymm, maxSpanMonths) {
  if (startYymm > endYymm) return [];
  const out = [];
  let curStart = startYymm;
  while (curStart <= endYymm) {
    const curEnd = minYymm(endYymm, yymmAddMonths(curStart, maxSpanMonths - 1));
    out.push({ start: curStart, end: curEnd });
    const nextStart = yymmAddMonths(curEnd, 1);
    if (nextStart > endYymm) break;
    curStart = nextStart;
  }
  return out;
}

function defaultMaxYymm() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}${m}`;
}

/** YYYYMM 동일 자리수 문자열 숫자 비교 */
function yymmGte(a, b) {
  const na = parseInt(String(a).replace(/\D/g, "").slice(0, 6), 10);
  const nb = parseInt(String(b).replace(/\D/g, "").slice(0, 6), 10);
  if (!Number.isFinite(na) || !Number.isFinite(nb)) return String(a) >= String(b);
  return na >= nb;
}

/**
 * 공공데이터포털 인증키는 URL에 디코딩 값 그대로 두고 encodeURIComponent 하지 않음(앱과 동일).
 * returnType=json 은 선택 — 미포함 시 대부분 XML 반환.
 */
function buildNitemtradeUrl(serviceKey, { strtYymm, endYymm, cntyCd, hsSgn }) {
  const useJson = process.env.CUSTOMS_RETURN_JSON === "1";
  const jsonPart = useJson ? "&returnType=json" : "";
  return `${NITEMTRADE_URL}?serviceKey=${serviceKey}&strtYymm=${strtYymm}&endYymm=${endYymm}&pageNo=${PAGE_NO}&numOfRows=${NUM_OF_ROWS}&cntyCd=${cntyCd}&hsSgn=${hsSgn}${jsonPart}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 응답 헤더: JSON 객체 또는 xml2js 파싱 결과 모두 `response.header` 형태를 가정. */
function getApiHeader(obj) {
  const nested =
    obj.response?.header ??
    obj.Response?.Header ??
    obj.getNitemtradeListResponse?.header;
  if (nested && typeof nested === "object") {
    return {
      resultCode: nested.resultCode ?? nested.resultcode,
      resultMsg: nested.resultMsg ?? nested.resultmsg,
    };
  }
  return {
    resultCode: obj.resultCode,
    resultMsg: obj.resultMsg,
  };
}

function isHeaderSuccess(hdr) {
  const code = String(hdr?.resultCode ?? "");
  const msg = String(hdr?.resultMsg ?? "");
  return (
    code === "00" ||
    code === "0" ||
    hdr?.resultCode === 0 ||
    msg === "OK" ||
    msg.includes("정상")
  );
}

/** JSON 본문에서 item 배열 추출 */
function extractRecordsFromJson(json) {
  const raw =
    json.response?.body?.items?.item ??
    json.Response?.Body?.Items?.Item ??
    json.response?.body?.items ??
    json.data?.dataList ??
    json.data?.item ??
    json.data;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object") return [raw];
  return [];
}

/**
 * xml2js 결과에서 item 배열 추출 (관세청 XML: response.body.items.item).
 */
function extractDataFromXml(xmlObj) {
  const items =
    xmlObj?.response?.body?.items?.item ??
    xmlObj?.Response?.Body?.Items?.Item ??
    xmlObj?.response?.body?.items?.item;
  if (!items) {
    console.log("⚠️ XML에서 items.item을 찾을 수 없음");
    return [];
  }
  return Array.isArray(items) ? items : [items];
}

/** impDlr / expDlr 등 달러 정수 (콤마 제거). */
function parseUsdInt(v) {
  if (v === undefined || v === null) return 0;
  const n = parseInt(String(v).replace(/,/g, ""), 10);
  return Number.isNaN(n) ? 0 : n;
}

/** tradeXmlParse 금액(백만 USD) → USD 정수 */
function amountMillionToUsdInt(amountMillion) {
  return Math.round(Number(amountMillion) * 1_000_000);
}

function monthToYymm(monthYm) {
  const digits = String(monthYm ?? "").replace(/\D/g, "");
  if (digits.length >= 6) return digits.slice(0, 6);
  return null;
}

/**
 * XML/JSON item 한 건 → trade_data 행 (스키마 컬럼만; 중량 컬럼 없음).
 */
function nitemRecordToTradeRow(rec, fallbackHs, fallbackCnty) {
  if (!rec || typeof rec !== "object") return null;
  const yearRaw =
    rec.year ?? rec.Year ?? rec.YYYYMM ?? rec.yrMm ?? rec.statsYyMm ?? rec.statsYymm;
  if (yearRaw === undefined || yearRaw === null) return null;
  const yymm = String(yearRaw).replace(/\./g, "").replace(/-/g, "").replace(/\D/g, "").slice(0, 6);
  if (yymm.length !== 6) return null;

  const hsFromRec = String(rec.hsCd ?? rec.HS_CD ?? rec.hscd ?? "")
    .replace(/\D/g, "")
    .slice(0, 10);
  const hsFromReq = String(fallbackHs ?? "")
    .replace(/\D/g, "")
    .slice(0, 10);
  const hs_code = hsFromRec.length === 10 ? hsFromRec : hsFromReq;
  if (hs_code.length !== 10) return null;

  const statRaw = String(
    rec.statCd ?? rec.STAT_CD ?? rec.ctyCd ?? rec.CTY_CD ?? fallbackCnty ?? "",
  ).replace(/\s/g, "");
  const country_code =
    statRaw.slice(0, 2).toUpperCase() || String(fallbackCnty).slice(0, 2).toUpperCase();

  return {
    hs_code,
    country_code,
    yymm,
    import_val: parseUsdInt(rec.impDlr ?? rec.impdlr ?? rec.IMPT_VAL ?? rec.impAmt),
    export_val: parseUsdInt(rec.expDlr ?? rec.expdlr ?? rec.EXPT_VAL ?? rec.expAmt),
  };
}

/** 동일 (hs_code, country_code, yymm) 행이 여러 개면 금액 합산. */
function mergeTradeRowsByKey(rows) {
  const map = new Map();
  for (const r of rows) {
    if (!r) continue;
    const key = `${r.hs_code}|${r.country_code}|${r.yymm}`;
    const cur = map.get(key) ?? {
      hs_code: r.hs_code,
      country_code: r.country_code,
      yymm: r.yymm,
      import_val: 0,
      export_val: 0,
    };
    cur.import_val += r.import_val;
    cur.export_val += r.export_val;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) =>
    `${a.hs_code}${a.country_code}${a.yymm}`.localeCompare(`${b.hs_code}${b.country_code}${b.yymm}`),
  );
}

/**
 * xml2js로 items가 비었을 때 fast-xml-parser(`tradeXmlParse.mjs`) 폴백.
 */
function queryParamFromUrl(url, key) {
  const re = new RegExp(`[?&]${key}=([^&]*)`);
  const m = url.match(re);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1].replace(/\+/g, " "));
  } catch {
    return m[1];
  }
}

/** xml2js로 items가 비었을 때 fast-xml-parser(`tradeXmlParse.mjs`) 폴백. */
function rowsFromTradeXmlFastParser(rawText, httpStatus, fallbackHs, fallbackCnty) {
  const hs10 = String(fallbackHs ?? "")
    .replace(/\D/g, "")
    .slice(0, 10);
  const cc2 = String(fallbackCnty ?? "")
    .replace(/\s/g, "")
    .slice(0, 2)
    .toUpperCase();
  if (hs10.length !== 10 || cc2.length !== 2) return [];

  const imp = parseTradeXmlToRows(rawText, httpStatus, { tradeDirection: "import" });
  const exp = parseTradeXmlToRows(rawText, httpStatus, { tradeDirection: "export" });
  const byYymm = new Map();
  for (const r of imp.rows) {
    const yymm = monthToYymm(r.month);
    if (!yymm) continue;
    const cur = byYymm.get(yymm) ?? {
      hs_code: hs10,
      country_code: cc2,
      yymm,
      import_val: 0,
      export_val: 0,
    };
    cur.import_val = amountMillionToUsdInt(r.amount);
    byYymm.set(yymm, cur);
  }
  for (const r of exp.rows) {
    const yymm = monthToYymm(r.month);
    if (!yymm) continue;
    const cur = byYymm.get(yymm) ?? {
      hs_code: hs10,
      country_code: cc2,
      yymm,
      import_val: 0,
      export_val: 0,
    };
    cur.export_val = amountMillionToUsdInt(r.amount);
    byYymm.set(yymm, cur);
  }
  return [...byYymm.values()].filter((row) => row.hs_code.length === 10 && row.yymm.length === 6);
}

/**
 * 한 청크 URL 호출 → 레코드 배열 + 응답 형식.
 * XML/JSON 자동 감지, 파싱 실패 시 원문 일부 로그.
 */
async function fetchTradeChunk(url) {
  let res;
  try {
    res = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/json, application/xml, text/xml, */*" },
    });
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err);
    throw new Error(`네트워크 오류: ${m}`);
  }

  const rawText = await res.text();
  if (!rawText || rawText.trim().length === 0) {
    throw new Error("서버 응답 본문이 비어 있습니다.");
  }

  if (!res.ok) {
    console.error("❌ HTTP 오류 본문(앞 500자):", rawText.substring(0, 500));
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const trimmed = rawText.trim();
  const looksXml = trimmed.startsWith("<?xml") || trimmed.startsWith("<");

  if (looksXml) {
    console.log("📄 XML 응답 감지, 파싱 중...");
    let xmlObj;
    try {
      xmlObj = await parseStringPromise(rawText, {
        explicitArray: false,
        mergeAttrs: true,
      });
    } catch (parseError) {
      const m = parseError instanceof Error ? parseError.message : String(parseError);
      console.error("❌ XML(xml2js) 파싱 실패:", m);
      console.error("Raw response (first 500 chars):", rawText.substring(0, 500));
      throw new Error(`응답 파싱 실패(XML): ${m}`);
    }

    const hdr = getApiHeader(xmlObj);
    if (!isHeaderSuccess(hdr)) {
      throw new Error(`API 실패(XML): [${hdr.resultCode}] ${String(hdr.resultMsg ?? "")}`);
    }

    let records = extractDataFromXml(xmlObj);
    if (records.length === 0) {
      console.log("⚠️ xml2js로 items가 비어 tradeXmlParse.mjs 로 재시도합니다.");
      const hsSgn = queryParamFromUrl(url, "hsSgn");
      const cntyCd = queryParamFromUrl(url, "cntyCd");
      records = rowsFromTradeXmlFastParser(rawText, res.status, hsSgn, cntyCd);
    }

    return { records, format: "xml" };
  }

  console.log("📄 JSON 응답 감지, 파싱 중...");
  let json;
  try {
    json = JSON.parse(rawText);
  } catch (parseError) {
    const m = parseError instanceof Error ? parseError.message : String(parseError);
    console.error("❌ JSON 파싱 실패:", m);
    console.error("Raw response (first 500 chars):", rawText.substring(0, 500));
    throw new Error(`응답 파싱 실패(JSON): ${m}`);
  }

  const hdr = getApiHeader(json);
  if (!isHeaderSuccess(hdr)) {
    throw new Error(`API 실패(JSON): [${hdr.resultCode}] ${String(hdr.resultMsg ?? "")}`);
  }

  const records = extractRecordsFromJson(json);
  return { records, format: "json" };
}

const SEED_CHUNK_SIZE = 500;

/** 종료 시 요약: 조합 처리 결과 + trade_data·failed 건수 */
async function printRunSummary(supabase, stats) {
  const { count: tradeRows, error: e1 } = await supabase
    .from("trade_data")
    .select("*", { count: "exact", head: true });
  const { count: failedLeft, error: e2 } = await supabase
    .from("sync_progress")
    .select("*", { count: "exact", head: true })
    .eq("status", "failed");

  console.log("\n======== 무역 수집 실행 요약 ========");
  console.table({
    "큐에서 가져온 조합 수(이번 실행 시작 시)": stats.queuedAtStart,
    "이번 실행에서 처리한 조합 수": stats.combosProcessed,
    "완료(completed)로 끝난 조합 수": stats.completedCombos,
    "실패(failed)로 끝난 조합 수(재실행 시 자동 재시도)": stats.failedCombos,
    "일일 API 호출 수": stats.dailyCount,
    "trade_data 총 행 수(현재 DB)": e1 ? `조회 실패: ${e1.message}` : (tradeRows ?? 0),
    "sync_progress failed 남은 개수": e2 ? `조회 실패: ${e2.message}` : (failedLeft ?? 0),
  });
  console.log(
    "※ `completed` 가 아닌 조합(pending·failed·running→pending)은 다음 실행 시 다시 수집합니다.",
  );
  console.log(
    "※ HS·국가 목록 변경: scripts/collect-trade.config.mjs\n" +
      "※ DB만으로 조합 추가: Supabase sync_progress 에 INSERT (status=pending 권장)\n",
  );
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL?.trim();
  const supabaseKey = process.env.SUPABASE_SERVICE_KEY?.trim();
  const customsKey =
    process.env.CUSTOMS_API_KEY?.trim() || process.env.TRADE_API_KEY?.trim();
  const maxYymm = (process.env.TRADE_MAX_YYMM ?? defaultMaxYymm()).replace(/\D/g, "").slice(0, 6);
  const tradeMinYymm = (process.env.TRADE_MIN_YYMM ?? "200401").replace(/\D/g, "").slice(0, 6);
  /** 기간 기준 완료: API 청크 종료월(w.end)이 이 값 이상이면 sync_progress = completed (.env: TRADE_TARGET_END_YYMM) */
  const TARGET_END_YYMM = (process.env.TRADE_TARGET_END_YYMM ?? "202604")
    .replace(/\D/g, "")
    .slice(0, 6);

  if (!supabaseUrl || !supabaseKey || !customsKey) {
    console.log(
      "필수 환경변수 누락: SUPABASE_URL, SUPABASE_SERVICE_KEY, CUSTOMS_API_KEY(또는 TRADE_API_KEY) 를 설정하세요.",
    );
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stats = {
    queuedAtStart: 0,
    combosProcessed: 0,
    completedCombos: 0,
    failedCombos: 0,
    dailyCount: 0,
  };

  const { error: resetRunErr, data: resetRows } = await supabase
    .from("sync_progress")
    .update({ status: "pending", last_updated: new Date().toISOString() })
    .eq("status", "running")
    .select("hs_code");
  if (resetRunErr) {
    console.log("running→pending 초기화 실패(무시 가능):", resetRunErr.message);
  } else if (resetRows?.length) {
    console.log(`↻ 이전 실행 중 미완료(running) ${resetRows.length}건을 pending 으로 되돌렸습니다.`);
  }

  const countriesForSeed = getCountriesForSeed();
  const seedRows = [];
  for (const hs of TARGET_HS_CODES) {
    for (const country_code of countriesForSeed) {
      seedRows.push({ hs_code: hs, country_code, status: "pending" });
    }
  }
  for (let off = 0; off < seedRows.length; off += SEED_CHUNK_SIZE) {
    const chunk = seedRows.slice(off, off + SEED_CHUNK_SIZE);
    const { error: seedErr } = await supabase.from("sync_progress").upsert(chunk, {
      onConflict: "hs_code,country_code",
      ignoreDuplicates: true,
    });
    if (seedErr) {
      console.log("sync_progress 시드 upsert 실패:", seedErr.message);
      process.exit(1);
    }
  }
  if (seedRows.length > 0) {
    console.log(`시드 완료: 최대 ${seedRows.length}개 조합 upsert 시도(기존 행은 유지).`);
  }

  const { data: progressRows, error: selErr } = await supabase
    .from("sync_progress")
    .select("hs_code, country_code, last_fetched_yymm, status, last_updated")
    .neq("status", "completed")
    .order("last_updated", { ascending: true })
    .limit(100_000);

  if (selErr) {
    console.log("sync_progress 조회 실패:", selErr.message);
    process.exit(1);
  }

  const combos = (progressRows ?? []).map((r) => ({
    hs_code: String(r.hs_code).replace(/\s/g, ""),
    country_code: String(r.country_code).replace(/\s/g, ""),
    last_fetched_yymm: String(r.last_fetched_yymm ?? "200401").replace(/\D/g, "").slice(0, 6),
    status: r.status,
    last_updated: r.last_updated ?? "",
  }));

  stats.queuedAtStart = combos.length;
  const totalCombos = combos.length;
  if (totalCombos === 0) {
    console.log(
      "처리할 조합이 없습니다. sync_progress 에서 status 가 completed 가 아닌 행이 없습니다.",
    );
    await printRunSummary(supabase, stats);
    process.exit(0);
  }

  console.log(
    `시작: 미완료(≠completed) 조합 ${totalCombos}개, 일일 한도 ${DAILY_CALL_LIMIT}, API수집월 ${tradeMinYymm}~${maxYymm}, 기간완료기준월(TARGET)=${TARGET_END_YYMM}, 청크 ${CHUNK_MONTHS}개월/호출`,
  );

  for (let i = 0; i < combos.length; i++) {
    if (stats.dailyCount >= DAILY_CALL_LIMIT) {
      console.log(
        `일일 호출 한도 도달(dailyCount=${stats.dailyCount}). 정상 종료합니다. 완료 조합 수=${stats.completedCombos}`,
      );
      stats.combosProcessed = i;
      await printRunSummary(supabase, stats);
      process.exit(0);
    }

    stats.combosProcessed += 1;

    const combo = combos[i];
    const { hs_code, country_code } = combo;
    let lastYymm = combo.last_fetched_yymm;
    let nextStart = yymmAddMonths(lastYymm, 1);
    if (nextStart < tradeMinYymm) nextStart = tradeMinYymm;

    if (nextStart > maxYymm) {
      const skipStatus = yymmGte(lastYymm, TARGET_END_YYMM) ? "completed" : "pending";
      const { error: upDone } = await supabase
        .from("sync_progress")
        .update({
          status: skipStatus,
          last_updated: new Date().toISOString(),
        })
        .eq("hs_code", hs_code)
        .eq("country_code", country_code);
      if (upDone) console.log("sync_progress 갱신 실패:", upDone.message);
      else if (skipStatus === "completed") stats.completedCombos += 1;
      console.log(
        `[진행] ${i + 1}/${totalCombos} hs=${hs_code} cnty=${country_code} — API구간 소진(last=${lastYymm}, status=${skipStatus}). 일일호출=${stats.dailyCount} 완료조합=${stats.completedCombos}`,
      );
      continue;
    }

    const { error: runErr } = await supabase
      .from("sync_progress")
      .update({
        status: "running",
        last_updated: new Date().toISOString(),
      })
      .eq("hs_code", hs_code)
      .eq("country_code", country_code);

    if (runErr) {
      console.log(`running 표시 실패 (${hs_code}/${country_code}):`, runErr.message);
    }

    const windows = splitYymmRangeInclusive(nextStart, maxYymm, CHUNK_MONTHS);
    let chunkIndex = 0;

    try {
      for (const w of windows) {
        if (stats.dailyCount >= DAILY_CALL_LIMIT) {
          console.log(
            `일일 호출 한도 도달(dailyCount=${stats.dailyCount}). 정상 종료합니다. 완료 조합 수=${stats.completedCombos}`,
          );
          await printRunSummary(supabase, stats);
          process.exit(0);
        }

        chunkIndex += 1;
        const url = buildNitemtradeUrl(customsKey, {
          strtYymm: w.start,
          endYymm: w.end,
          cntyCd: country_code,
          hsSgn: hs_code,
        });

        await sleep(SLEEP_MS);
        const { records, format } = await fetchTradeChunk(url);
        stats.dailyCount += 1;

        if (!Array.isArray(records) || records.length === 0) {
          console.log(
            `⚪ ${hs_code}/${country_code} | ${w.start}~${w.end}: 거래 데이터 없음 (0건) → 기간 완료 처리 진행 (${format})`,
          );
        } else {
          const parsed = [];
          for (const rec of records) {
            if (
              rec &&
              typeof rec === "object" &&
              "yymm" in rec &&
              "import_val" in rec &&
              "export_val" in rec &&
              !("year" in rec) &&
              !("Year" in rec)
            ) {
              parsed.push({
                hs_code: String(rec.hs_code ?? hs_code).replace(/\D/g, "").slice(0, 10),
                country_code: String(rec.country_code ?? country_code)
                  .replace(/\s/g, "")
                  .slice(0, 2)
                  .toUpperCase(),
                yymm: String(rec.yymm).replace(/\D/g, "").slice(0, 6),
                import_val: Number(rec.import_val) || 0,
                export_val: Number(rec.export_val) || 0,
              });
              continue;
            }
            const row = nitemRecordToTradeRow(rec, hs_code, country_code);
            if (row) parsed.push(row);
          }
          const upsertPayload = mergeTradeRowsByKey(parsed);

          if (upsertPayload.length === 0) {
            console.log(
              `⚠️ ${hs_code}/${country_code}: 기간 ${w.start}~${w.end} 원본 ${records.length}건이나 파싱 실패로 저장 행 없음`,
            );
          } else {
            console.log("🔍 파싱된 데이터 샘플:", JSON.stringify(upsertPayload[0], null, 2));
            console.log(`✅ ${upsertPayload.length}개 레코드 추출됨 (${format})`);
            const { error: upTrade } = await supabase.from("trade_data").upsert(upsertPayload, {
              onConflict: "hs_code,country_code,yymm",
            });
            if (upTrade) throw new Error(`trade_data upsert: ${upTrade.message}`);
            console.log(`  → trade_data upsert ${upsertPayload.length}행`);
          }
        }

        lastYymm = w.end;
        const isTimeCompleted = yymmGte(w.end, TARGET_END_YYMM);
        const nextStatus = isTimeCompleted ? "completed" : "pending";
        const { error: progUp } = await supabase
          .from("sync_progress")
          .update({
            last_fetched_yymm: w.end,
            status: nextStatus,
            last_updated: new Date().toISOString(),
          })
          .eq("hs_code", hs_code)
          .eq("country_code", country_code);

        if (progUp) throw new Error(`sync_progress 업데이트: ${progUp.message}`);

        console.log(
          `[진행] 조합 ${i + 1}/${totalCombos} hs=${hs_code} cnty=${country_code} 청크 ${chunkIndex}/${windows.length} (${w.start}~${w.end}) status=${nextStatus} 일일호출=${stats.dailyCount} 완료조합=${stats.completedCombos}${isTimeCompleted ? " → 기간기준 완료" : ""}`,
        );

        if (w.end >= maxYymm) {
          break;
        }
      }
      if (yymmGte(lastYymm, TARGET_END_YYMM)) {
        stats.completedCombos += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log(`[오류] ${hs_code}/${country_code}: ${msg}`);
      stats.failedCombos += 1;

      await supabase
        .from("sync_progress")
        .update({
          status: "failed",
          last_updated: new Date().toISOString(),
        })
        .eq("hs_code", hs_code)
        .eq("country_code", country_code);

      continue;
    }
  }

  await printRunSummary(supabase, stats);
}

main().catch((e) => {
  console.log("치명 오류:", e instanceof Error ? e.message : e);
  process.exit(1);
});
