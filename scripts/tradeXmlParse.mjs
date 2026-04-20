/**
 * 관세청 GW 품목·국가별(nitemtrade) XML → 월별 행 변환.
 * 앱의 `src/lib/tradeXmlNormalize.ts`와 동일 로직(타입만 제거).
 */

import { XMLParser } from "fast-xml-parser";

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  trimValues: true,
  parseTagValue: true,
});

function pickString(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    if (typeof v === "object" && v !== null && "#text" in v) {
      const t = String(v["#text"]).trim();
      if (t) return t;
    }
    const s = String(v).trim();
    if (s && s !== "[object Object]") return s;
  }
  return undefined;
}

function pickNumber(obj, keys) {
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null) continue;
    let raw = v;
    if (typeof v === "object" && v !== null && "#text" in v) {
      raw = v["#text"];
    }
    const n = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
    if (!Number.isNaN(n)) return n;
  }
  return 0;
}

function getChildLoose(obj, name) {
  const target = name.toLowerCase();
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === target) return obj[k];
  }
  return undefined;
}

function getPath(obj, path) {
  let cur = obj;
  for (const p of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = getChildLoose(cur, p);
  }
  return cur;
}

function flattenItemValue(v) {
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) {
    return v.filter((x) => x && typeof x === "object" && !Array.isArray(x));
  }
  if (typeof v === "object" && !Array.isArray(v)) {
    return [v];
  }
  return [];
}

const ITEM_PATHS = [
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

function extractItemsFromParsed(parsed) {
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

function normalizeMonthKey(raw) {
  const digits = raw.replace(/\D/g, "");
  if (digits.length >= 6) {
    const y = digits.slice(0, 4);
    const m = digits.slice(4, 6);
    const mi = Number(m);
    if (mi >= 1 && mi <= 12) return `${y}-${m}`;
  }
  return null;
}

function monthFromYearDotField(item) {
  const y = pickString(item, ["year", "Year"]);
  if (!y) return null;
  const m = y.match(/^(\d{4})\.(\d{2})/);
  if (!m) return null;
  const mi = Number(m[2]);
  if (mi < 1 || mi > 12) return null;
  return `${m[1]}-${m[2]}`;
}

function monthFromItem(item) {
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
  const yy = pickString(item, ["statsYy", "yr", "yy", "imyy", "baseYy", "chkYy"]);
  const mm = pickString(item, ["statsMm", "mm", "month", "immm", "chkMm"]);
  if (yy && mm && /^\d{4}$/.test(yy)) {
    const m2 = mm.replace(/\D/g, "").slice(0, 2).padStart(2, "0");
    const mi = Number(m2);
    if (mi >= 1 && mi <= 12) return `${yy}-${m2}`;
  }
  return null;
}

const KG_PER_KILOTON = 1_000_000;

function weightKgToKiloton(kg) {
  if (!Number.isFinite(kg)) return 0;
  return Math.round((kg / KG_PER_KILOTON) * 1_000_000) / 1_000_000;
}

export function itemRecordToTradeRow(item, tradeDirection) {
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

function normalizeItemsToRows(items, tradeDirection) {
  const rows = [];
  for (const it of items) {
    const row = itemRecordToTradeRow(it, tradeDirection);
    if (row) rows.push(row);
  }
  return rows;
}

export function mergeRowsByMonth(rows) {
  const map = new Map();
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

function extractStandardHeader(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed;
  const response = root.response ?? root;
  const header = response.header;
  if (!header) return {};
  return {
    code: pickString(header, ["resultCode", "resultcode"]),
    msg: pickString(header, ["resultMsg", "resultmsg"]),
  };
}

function extractOpenApiError(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const root = parsed;
  const wrap = root.OpenAPI_ServiceResponse ?? root.openapi_service_response;
  if (!wrap) return {};
  const h = wrap.cmmMsgHeader ?? wrap.CmmMsgHeader;
  if (!h) return {};
  return {
    reason: pickString(h, ["returnReasonCode", "ReturnReasonCode"]),
    msg: pickString(h, ["returnAuthMsg", "errMsg", "cmmMsg"]),
  };
}

export function parseTradeXmlToRows(text, httpStatus, options = {}) {
  const rawXmlPreview = text.replace(/^\uFEFF/, "").substring(0, 500);

  let parsed;
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
    normalizeItemsToRows(items, options.tradeDirection),
  );

  const firstItemKeys =
    items[0] && typeof items[0] === "object" ? Object.keys(items[0]).slice(0, 40) : undefined;

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
