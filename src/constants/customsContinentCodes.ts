/**
 * 대륙경제권통합분류코드(cntnEbkUnfcClsfCd) — `관세청조회코드_v1.2.xlsx` 시트「대륙코드」
 * (항목명 행 다음 표: 대륙별코드 10~99)
 */

export const CUSTOMS_CONTINENT_OPTIONS = [
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

export type CustomsContinentCode = (typeof CUSTOMS_CONTINENT_OPTIONS)[number]["code"];
