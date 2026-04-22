import { countries } from "countries-list";
import {
  CUSTOMS_COUNTRY_OPTIONS,
  type CustomsCountryId,
} from "@/constants/customsCountryCodes";

/**
 * 관세청 대륙코드(10~99) 기준 국가 목록.
 * - ISO 국가코드 기반 자동 분류 + 중동/중남미/대양주 보정 규칙 적용
 * - 관세청 코드 중 비국가/특수코드는 99(기타)로 분류
 */

const MIDDLE_EAST_ISO2 = new Set([
  "AE",
  "BH",
  "CY",
  "EG",
  "IL",
  "IQ",
  "IR",
  "JO",
  "KW",
  "LB",
  "OM",
  "PS",
  "QA",
  "SA",
  "SY",
  "TR",
  "YE",
]);

/**
 * 북미(40)에서 중남미(50)로 보정할 ISO 코드
 * (멕시코 + 중앙아메리카 + 카리브해)
 */
const LATAM_FROM_NA_ISO2 = new Set([
  "MX",
  "BZ",
  "CR",
  "SV",
  "GT",
  "HN",
  "NI",
  "PA",
  "AG",
  "AI",
  "AW",
  "BB",
  "BL",
  "BM",
  "BQ",
  "BS",
  "CU",
  "CW",
  "DM",
  "DO",
  "GD",
  "GP",
  "HT",
  "JM",
  "KN",
  "KY",
  "LC",
  "MF",
  "MQ",
  "MS",
  "PR",
  "SX",
  "TC",
  "TT",
  "VC",
  "VG",
  "VI",
]);

/**
 * 오세아니아(70)에서 대양주(80)로 보정할 태평양 도서국/도서지역.
 */
const PACIFIC_ISLANDS_ISO2 = new Set([
  "AS",
  "CK",
  "FJ",
  "FM",
  "GU",
  "KI",
  "MH",
  "MP",
  "NC",
  "NF",
  "NR",
  "NU",
  "PF",
  "PN",
  "PW",
  "SB",
  "TK",
  "TO",
  "TV",
  "VU",
  "WF",
  "WS",
]);

function mapCountryToContinentCode(id: string): number {
  const iso2 = id.toUpperCase();
  const info = countries[iso2 as keyof typeof countries];

  // 관세청 특수코드/레거시 코드
  if (!info) return 99;

  if (MIDDLE_EAST_ISO2.has(iso2)) return 20;

  switch (info.continent) {
    case "EU":
      return 30;
    case "AF":
      return 60;
    case "SA":
      return 50;
    case "NA":
      return LATAM_FROM_NA_ISO2.has(iso2) ? 50 : 40;
    case "OC":
      return PACIFIC_ISLANDS_ISO2.has(iso2) ? 80 : 70;
    case "AS":
      return 10;
    case "AN":
      return 99;
    default:
      return 99;
  }
}

type ContinentCode = 10 | 20 | 30 | 40 | 50 | 60 | 70 | 80 | 99;

function buildMap(): Record<ContinentCode, CustomsCountryId[]> {
  const bucket: Record<ContinentCode, CustomsCountryId[]> = {
    10: [],
    20: [],
    30: [],
    40: [],
    50: [],
    60: [],
    70: [],
    80: [],
    99: [],
  };

  for (const c of CUSTOMS_COUNTRY_OPTIONS) {
    bucket[mapCountryToContinentCode(c.id) as ContinentCode].push(c.id);
  }
  return bucket;
}

export const CONTINENT_COUNTRY_IDS = buildMap();

export function getCountryIdsByContinentCode(
  continentCode: string,
): CustomsCountryId[] {
  const n = Number(continentCode) as ContinentCode;
  const list = CONTINENT_COUNTRY_IDS[n];
  return list ? [...list] : [];
}
