/** `/api/trade` ↔ 프론트 공통 시계열 행 (금액: 백만 USD) */
export type TradeApiType = "overall" | "item" | "country" | "continent";

export type TradeRow = {
  month: string;
  weight: number;
  amount: number;
};

/** XML 파싱·매핑 진단용 (rows 비어 있을 때 원인 확인) */
export type TradeParseDebug = {
  rawXmlPreview: string;
  httpStatus?: number;
  /** response.header 등 */
  resultCode?: string;
  resultMsg?: string;
  /** OpenAPI_ServiceResponse / cmmMsgHeader */
  openApiReturnReason?: string;
  openApiReturnMsg?: string;
  /** 추출된 원시 item 개수 */
  extractedRawItems: number;
  normalizedRows: number;
  /** 실제로 매칭된 items 경로 */
  usedPath?: string;
  /** 첫 item의 키 목록(필드명 맞춤용) */
  firstItemKeys?: string[];
};

export type TradeApiResponse = {
  ok: boolean;
  rows: TradeRow[];
  apiType: TradeApiType;
  error?: string;
  notice?: string;
  /** rows가 비었을 때 브라우저에서 바로 원인 파악 */
  debug?: TradeParseDebug;
};
