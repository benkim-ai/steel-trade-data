/**
 * 공공데이터 API 코드 매핑 (레거시·참고용).
 * 국가 cntyCd 전체 목록은 `customsCountryCodes.ts`(관세청조회코드 엑셀 국가코드 시트)를 사용하세요.
 */

/** 수출입구분코드 (imexTpcd) */
export const imexTpcd = {
  1: "수출",
  2: "수입",
} as const;

/** 대륙코드 (cntnEbkUnfcClsfCd) — 공공 매핑 표 기준 */
export const cntnEbkUnfcClsfCd = {
  10: "아시아",
  20: "중동",
  30: "유럽",
  40: "북미",
  50: "중남미",
  60: "아프리카",
  70: "오세아니아",
  80: "대양주",
  99: "기타",
} as const;

/** 대륙 필터 UI용 (코드 순) */
export const CONTINENT_SELECT_OPTIONS = [
  { code: 10, name: "아시아" },
  { code: 20, name: "중동" },
  { code: 30, name: "유럽" },
  { code: 40, name: "북미" },
  { code: 50, name: "중남미" },
  { code: 60, name: "아프리카" },
  { code: 70, name: "오세아니아" },
  { code: 80, name: "대양주" },
  { code: 99, name: "기타" },
] as const;

export type ContinentSelectCode = (typeof CONTINENT_SELECT_OPTIONS)[number]["code"];

/** 대륙 필터: 단일 대륙 + 전체(가중 평균 스케일) */
export const CONTINENT_FILTER_ALL = "ALL" as const;
export type ContinentFilterCode =
  | ContinentSelectCode
  | typeof CONTINENT_FILTER_ALL;

/** 국가 필터 UI용 (더미·3개국만) */
export const COUNTRY_SELECT_OPTIONS = [
  { id: "US", name: "미국" },
  { id: "JP", name: "일본" },
  { id: "CN", name: "중국" },
] as const;

export type CountrySelectId = (typeof COUNTRY_SELECT_OPTIONS)[number]["id"];

/** 국가 필터: 단일 국가 + 전체(미·일·중 + 기타권 합산 더미) */
export const COUNTRY_FILTER_ALL = "ALL" as const;
export type CountryFilterId = CountrySelectId | typeof COUNTRY_FILTER_ALL;

/** 라디오 UI (전체 옵션 포함) */
export const CONTINENT_RADIO_OPTIONS: { code: ContinentFilterCode; name: string }[] = [
  { code: CONTINENT_FILTER_ALL, name: "전체 대륙" },
  ...CONTINENT_SELECT_OPTIONS.map((o) => ({ code: o.code, name: o.name })),
];

export const COUNTRY_RADIO_OPTIONS: { id: CountryFilterId; name: string }[] = [
  { id: COUNTRY_FILTER_ALL, name: "전체 국가" },
  ...COUNTRY_SELECT_OPTIONS.map((o) => ({ id: o.id, name: o.name })),
];

export type ImexTpcdKey = keyof typeof imexTpcd;
export type ContinentCodeKey = keyof typeof cntnEbkUnfcClsfCd;
