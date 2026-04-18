/** `YYYYMM` 6자리 문자열 비교·월 가산·기간 분할 (관세청 API 기간 제한 대응) */

export function minYymm(a: string, b: string): string {
  return a <= b ? a : b;
}

/** `delta`만큼 월 이동 (음수 허용) */
export function yymmAddMonths(yymm: string, delta: number): string {
  const y = Number(yymm.slice(0, 4));
  const m = Number(yymm.slice(4, 6));
  if (!Number.isFinite(y) || !Number.isFinite(m)) return yymm;
  const idx = y * 12 + (m - 1) + delta;
  const yy = Math.floor(idx / 12);
  const mm = (idx % 12) + 1;
  return `${String(yy).padStart(4, "0")}${String(mm).padStart(2, "0")}`;
}

/**
 * [startYymm, endYymm] 달력 구간을 최대 `maxSpanMonths`개월(포함) 단위 창으로 나눔.
 * 예: 202001~202505, max=12 → [202001~202012], [202101~202112], [202201~202505]
 */
export function splitYymmRangeInclusive(
  startYymm: string,
  endYymm: string,
  maxSpanMonths: number,
): { start: string; end: string }[] {
  if (startYymm > endYymm) return [];
  const out: { start: string; end: string }[] = [];
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
