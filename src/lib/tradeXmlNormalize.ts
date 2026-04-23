import { XMLParser } from "fast-xml-parser";
import type { TradeParseDebug, TradeRow } from "@/types/trade";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true,
});

function pickString(
  obj: Record<string, unknown>,
  keys: string[],
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && v !== null && "#text" in (v as object)) {
      const t = String((v as { "#text": unknown })["#text"]).trim();
      if (t) return t;
    }
    const s = String(v).trim();
    if (s && s !== "[object Object]") return s;
  }
  return undefined;
}

function pickNumber(obj: Record<string, unknown>, keys: string[]): number {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    let raw: unknown = v;
    if (typeof v === "object" && v !== null && "#text" in (v as object)) {
      raw = (v as { "#text": unknown })["#text"];
    }
    const n =
      typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function getChildLoose(
  obj: Record<string, unknown>,
  name: string,
): unknown {
  const target = name.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return obj[k];
  }
  return undefined;
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = getChildLoose(cur as Record<string, unknown>, p);
  }
  return cur;
}

function flattenItemValue(v: unknown): Record<string, unknown>[] {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v.filter(
      (x) => x && typeof x === "object" && !Array.isArray(x),
    ) as Record<string, unknown>[];
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    return [v as Record<string, unknown>];
  }
  return [];
}

const ITEM_PATHS: string[][] = [
  ["response", "body", "items", "item"],
  ["Response", "Body", "Items", "Item"],
  ["response", "body", "item"],
  ["body", "items", "item"],
  ["items", "item"],
  ["result", "items", "item"],
  ["getAdmstListResponse", "body", "items", "item"],
  ["getAdmstListResponse", "Body", "Items", "Item"],
  ["admstListResponse", "body", "items", "item"],
  ["admstListResponse", "Body", "Items", "Item"],
  ["getNitemtradeListResponse", "body", "items", "item"],
  ["getNitemtradeListResponse", "Body", "Items", "Item"],
  ["nitemtradeListResponse", "body", "items", "item"],
  ["nitemtradeListResponse", "Body", "Items", "Item"],
  ["getContinenttradeListResponse", "body", "items", "item"],
  ["getContinenttradeListResponse", "Body", "Items", "Item"],
  ["continenttradeListResponse", "body", "items", "item"],
  ["continenttradeListResponse", "Body", "Items", "Item"],
];

export function extractItemsFromParsed(
  parsed: unknown,
): { items: Record<string, unknown>[]; usedPath?: string } {
  if (!parsed || typeof parsed !== "object") {
    return { items: [] };
  }
  for (const path of ITEM_PATHS) {
    const v = getPath(parsed, path);
    const items = flattenItemValue(v);
    if (items.length > 0) return { items, usedPath: path.join(".") };
  }
  return { items: [] };
}

/** YYYYMM 또는 YYYY-MM 등 → `YYYY-MM` */
function normalizeMonthKey(raw: string): string | null {
  const separated = raw.match(/^(\d{4})([./-])(\d{1,2})/);
  if (separated) {
    const month =
      separated[2] === "." && separated[3].length === 1
        ? `${separated[3]}0`
        : separated[3].padStart(2, "0");
    const mi = Number(month);
    if (mi >= 1 && mi <= 12) return `${separated[1]}-${month}`;
  }

  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 6) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const mi = Number(m);
    if (mi >= 1 && mi <= 12) return `${y}-${m}`;
  }
  return null;
}

/** 품목·국가별 API `year` 필드: "2016.01" → "2016-01", "2025.1" → "2025-10" */
function monthFromYearDotField(item: Record<string, unknown>): string | null {
  const y = pickString(item, ["year", "Year"]);
  if (!y) return null;
  const m = y.match(/^(\d{4})\.(\d{1,2})/);
  if (!m) return null;
  const month = m[2].length === 1 ? `${m[2]}0` : m[2];
  const mi = Number(month);
  if (mi < 1 || mi > 12) return null;
  return `${m[1]}-${month}`;
}

function monthFromItem(item: Record<string, unknown>): string | null {
  const fromYearDot = monthFromYearDotField(item);
  if (fromYearDot) return fromYearDot;

  const combined = pickString(item, [
    "statsYyMm",
    "statsYymm",
    "yrMm",
    "prmm",
    "stacdYymm",
    "rlvtYm",
    "imexYymm",
    "ncnyymm",
    "chkYm",
    "baseYymm",
    "statsYm",
    "yrmm",
  ]);
  if (combined) {
    const m = normalizeMonthKey(combined);
    if (m) return m;
  }
  const yy = pickString(item, [
    "statsYy",
    "yr",
    "yy",
    "imyy",
    "baseYy",
    "chkYy",
  ]);
  const mm = pickString(item, ["statsMm", "mm", "month", "immm", "chkMm"]);
  if (yy && mm && /^\d{4}$/.test(yy)) {
    const m2 = mm.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
    const mi = Number(m2);
    if (mi >= 1 && mi <= 12) return `${yy}-${m2}`;
  }
  return null;
}

export type TradeXmlDirection = "import" | "export";

/** 1천톤 = 100만 kg — XML 필드는 kg, `TradeRow.weight`는 천톤으로 저장 */
export const KG_PER_KILOTON = 1_000_000;

function weightKgToKiloton(kg: number): number {
  if (!Number.isFinite(kg)) return 0;
  return Math.round((kg / KG_PER_KILOTON) * 1_000_000) / 1_000_000;
}

/** 공공포털 XML `item` → 월별 중량(천톤)·금액(USD 원 → 백만 USD) */
export function itemRecordToTradeRow(
  item: Record<string, unknown>,
  tradeDirection?: TradeXmlDirection,
): TradeRow | null {
  if (tradeDirection === "export" || tradeDirection === "import") {
    const month = monthFromYearDotField(item) ?? monthFromItem(item);
    if (!month) return null;

    const weightKg = pickNumber(
      item,
      tradeDirection === "export" ? ["expWgt", "expwgt"] : ["impWgt", "impwgt"],
    );
    const usdRaw = pickNumber(
      item,
      tradeDirection === "export" ? ["expDlr", "expdlr"] : ["impDlr", "impdlr"],
    );
    const amountMillionUsd = usdRaw / 1_000_000;

    return {
      month,
      weight: weightKgToKiloton(weightKg),
      amount: Math.round(amountMillionUsd * 1_000_000) / 1_000_000,
    };
  }

  const month = monthFromItem(item);
  if (!month) return null;

  const weightKg = pickNumber(item, [
    "netWght",
    "nwght",
    "wght",
    "totQty",
    "qty",
    "netQty",
    "totWght",
    "wghtQty",
    "msmtQty",
    "totMsmtQty",
  ]);

  const usdRaw = pickNumber(item, [
    "usdAmt",
    "usd",
    "totAmt",
    "dlrTamt",
    "usdTamt",
    "dlrAmt",
    "usdDlrAmt",
    "dlrUsdAmt",
    "amtUsd",
  ]);

  const amountMillionUsd = usdRaw / 1_000_000;

  return {
    month,
    weight: weightKgToKiloton(weightKg),
    amount: Math.round(amountMillionUsd * 1_000_000) / 1_000_000,
  };
}

export function normalizeItemsToRows(
  items: Record<string, unknown>[],
  tradeDirection?: TradeXmlDirection,
): TradeRow[] {
  const rows: TradeRow[] = [];
  for (const it of items) {
    const row = itemRecordToTradeRow(it, tradeDirection);
    if (row) rows.push(row);
  }
  return rows;
}

/** 동일 월 중복 시 중량(천톤)·금액 합산 후 월순 정렬 */
export function mergeRowsByMonth(rows: TradeRow[]): TradeRow[] {
  const map = new Map<string, { weight: number; amount: number }>();
  for (const r of rows) {
    const cur = map.get(r.month) ?? { weight: 0, amount: 0 };
    cur.weight += r.weight;
    cur.amount += r.amount;
    map.set(r.month, cur);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      month,
      weight: Math.round(v.weight * 1_000_000) / 1_000_000,
      amount: Math.round(v.amount * 1_000_000) / 1_000_000,
    }));
}

function extractStandardHeader(parsed: unknown): {
  code?: string;
  msg?: string;
} {
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  const response = (root.response as Record<string, unknown>) ?? root;
  const header = response.header as Record<string, unknown> | undefined;
  if (!header) return {};
  return {
    code: pickString(header, ["resultCode", "resultcode"]),
    msg: pickString(header, ["resultMsg", "resultmsg"]),
  };
}

function extractOpenApiError(parsed: unknown): {
  reason?: string;
  msg?: string;
} {
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  const wrap =
    (root.OpenAPI_ServiceResponse as Record<string, unknown>) ??
    (root.openapi_service_response as Record<string, unknown>);
  if (!wrap) return {};
  const h =
    (wrap.cmmMsgHeader as Record<string, unknown>) ??
    (wrap.CmmMsgHeader as Record<string, unknown>);
  if (!h) return {};
  return {
    reason: pickString(h, ["returnReasonCode", "ReturnReasonCode"]),
    msg: pickString(h, ["returnAuthMsg", "errMsg", "cmmMsg"]),
  };
}

export function parseTradeXmlToRows(
  text: string,
  httpStatus: number,
  options?: { tradeDirection?: TradeXmlDirection },
): { rows: TradeRow[]; debug: TradeParseDebug } {
  const rawXmlPreview = text.replace(/^\uFEFF/, "").substring(0, 500);

  let parsed: unknown;
  try {
    parsed = xmlParser.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return {
      rows: [],
      debug: {
        rawXmlPreview,
        httpStatus,
        extractedRawItems: 0,
        normalizedRows: 0,
        resultMsg: "XML parse failed",
      },
    };
  }

  const std = extractStandardHeader(parsed);
  const oa = extractOpenApiError(parsed);
  const { items, usedPath } = extractItemsFromParsed(parsed);
  const normalized = mergeRowsByMonth(
    normalizeItemsToRows(items, options?.tradeDirection),
  );

  const firstItemKeys =
    items[0] && typeof items[0] === "object"
      ? Object.keys(items[0] as object).slice(0, 40)
      : undefined;

  return {
    rows: normalized,
    debug: {
      rawXmlPreview,
      httpStatus,
      resultCode: std.code,
      resultMsg: std.msg,
      openApiReturnReason: oa.reason,
      openApiReturnMsg: oa.msg,
      extractedRawItems: items.length,
      normalizedRows: normalized.length,
      usedPath,
      firstItemKeys,
    },
  };
}
