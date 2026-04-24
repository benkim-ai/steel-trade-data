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
  if (productKey === "방향성 전기강판") return "방향성전기강판";
  if (productKey === "무방향성 전기강판") return "무방향성전기강판";
  return productKey;
}

/** 국가별 적재 테이블 item_name */
export function mapUiProductToCountryTableItemName(productKey: string): string {
  const kosaItemName = mapUiProductToKosaItemName(productKey);
  if (kosaItemName === "철강재계") return "철강";
  if (kosaItemName === "강반제품") return "반제품";
  return kosaItemName;
}

const COUNTRY_NAME_ALIAS_PAIRS = [
  ["몽고", "몽골"],
  ["중국본토", "중국"],
  ["말레이지아", "말레이시아"],
  ["방글라데쉬", "방글라데시"],
  ["인디아", "인도"],
  ["아랍에미레이트", "아랍에미리트 연합"],
  ["예멘", "예맨"],
  ["그루지아", "조지아"],
  ["우즈베크", "우즈베키스탄"],
  ["카자흐", "카자흐스탄"],
  ["키르기스", "키르기스스탄"],
  ["스발비드군도", "스발비드 군도"],
  ["보스니아", "보스니아-헤르체고비나"],
  ["키프러스", "사이프러스"],
  ["룩셈부르크", "룩셈부르그"],
  ["체코", "체코공화국"],
  ["러시아", "러시아 연방"],
  ["베라루스", "벨라루스"],
  ["마이너아우틀링합중국군도", "마이너 아우틀링 합중국 군도"],
  ["버진군도(미)", "미령 버진군도"],
  ["버진군도(영)", "영령 버진군도"],
  ["캐이맨군도(영)", "영령 캐이맨 군도"],
  ["도미니카공화국", "도미니카 공화국"],
  ["세인트루시아", "세인트 루시아"],
  ["세인트빈센트그레나딘", "세인트 빈센트 그레나딘"],
  ["세인트키츠네비스", "세인트 키츠 네비스"],
  ["안티가바부다", "안티가 바부다"],
  ["네덜란드열도", "네덜란드 열도"],
  ["트리니다드토바고", "트리니다드 토바고"],
  ["포클랜드군도", "포클랜드 군도"],
  ["리유니온제도(불)", "불령 리유니온 코모도 제도"],
  ["폴리네시아(불)", "불령 폴리네시아"],
  ["불령 가이아나", "불령 가이아나"],
  ["마요트", "메요트"],
  ["세이셜", "세이쉘"],
  ["이디오피아", "에티오피아"],
  ["틴자니아", "탄자니아"],
  ["적도기니", "적도 기니"],
  ["카메른", "카메룬"],
  ["콩고공화국", "콩고"],
  ["루완다", "르완다"],
  ["마다가스카르", "마다카스카르"],
  ["상토메프린스페", "상토메 프린스페"],
  ["세인트헬레나(영국령)", "세인트 헬레나"],
  ["코트디부아르", "코트디봐르"],
  ["나우르", "나우루"],
  ["노폴크아일랜드", "노폴크 아일랜드"],
  ["뉴칼레도니아", "뉴 칼레도니아"],
  ["북마리아나군도", "북마리아나 군도"],
  ["솔로몬군도", "솔로몬 군도"],
  ["아메리카사모아", "아메리칸 사모아"],
  ["크리스마스아일랜드", "크리스마스 아일랜드"],
  ["파푸아뉴기니", "파푸아 뉴기니"],
  ["코코스", "코스 군도"],
  ["남아프리카", "남아프리카공화국"],
  ["유럽", "유럽연합"],
  ["중앙아프리카", "중앙아프리카공화국"],
] as const;

const COUNTRY_NAME_ALIASES = new Map<string, string[]>();
for (const [a, b] of COUNTRY_NAME_ALIAS_PAIRS) {
  COUNTRY_NAME_ALIASES.set(a, [...new Set([...(COUNTRY_NAME_ALIASES.get(a) ?? []), b])]);
  COUNTRY_NAME_ALIASES.set(b, [...new Set([...(COUNTRY_NAME_ALIASES.get(b) ?? []), a])]);
}

export function getCountryTableNameAliases(countryName: string): string[] {
  return [...new Set([countryName, ...(COUNTRY_NAME_ALIASES.get(countryName) ?? [])])];
}

export function mapUiCountryToCountryTableName(countryName: string): string {
  return getCountryTableNameAliases(countryName)[0] ?? countryName;
}

export function mapContinentCodeToRegionName(code: string): string | null {
  const n = Number(code) as CustomsContinentCode;
  return CONTINENT_CODE_TO_REGION_NAME[n] ?? null;
}
