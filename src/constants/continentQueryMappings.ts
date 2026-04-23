import type { CustomsContinentCode } from "@/constants/customsContinentCodes";

export const CONTINENT_CODE_TO_REGION_NAME: Record<CustomsContinentCode, string> = {
  10: "아시아",
  15: "동남아시아",
  20: "중동",
  30: "유럽",
  40: "북미",
  50: "중남미",
  60: "아프리카",
  80: "대양주",
};

/** 화면 품목명 -> KOSA 적재 테이블 item_name */
export function mapUiProductToKosaItemName(productKey: string): string {
  if (productKey === "철강재") return "철강재계";
  if (productKey === "반제품") return "강반제품";
  return productKey;
}

export function mapContinentCodeToRegionName(code: string): string | null {
  const n = Number(code) as CustomsContinentCode;
  return CONTINENT_CODE_TO_REGION_NAME[n] ?? null;
}
