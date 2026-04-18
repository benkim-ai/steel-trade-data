/**
 * 관세청 수출입 오픈API (공공데이터포털) — 엔드포인트·데이터셋 ID 참고용
 * 실제 요청 파라미터명은 기술문서·응답 스키마에 맞춰 `/api/trade`에서 매핑합니다.
 */

export const TRADE_API_DATASET_IDS = {
  /** 수출입총괄 */
  admst: "15102108",
} as const;

/** GW(게이트웨이) 실제 호출 URL — 소문자 `itmtrade`/`cntrytrade` 등은 500·Unexpected errors 유발 */
export const TRADE_API_URLS = {
  /** 수출입총괄 (기존 admst — GW 전용 경로 확정 시 여기만 교체) */
  overall: "https://apis.data.go.kr/1220000/admst/getAdmstList",
  /** 관세청_품목별 국가별 수출입실적(GW) */
  nitemtrade: "https://apis.data.go.kr/1220000/nitemtrade/getNitemtradeList",
  /**
   * 관세청_대륙별 수출입실적(GW) — Base `/1220000/continenttradet` (끝 `t`)
   * 조회코드 엑셀: cntnEbkUnfcClsfCd = 대륙경제권통합분류코드
   */
  continent:
    "https://apis.data.go.kr/1220000/continenttradet/getContinenttradeList",
} as const;

export type TradeApiUrlKey = keyof typeof TRADE_API_URLS;
