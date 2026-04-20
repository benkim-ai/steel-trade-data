-- =============================================================================
-- sync_progress ↔ trade_data 동기화 (Supabase PostgreSQL)
-- =============================================================================
-- 목표 완료 월(이 값 이상이면 status = completed): 아래 CTE `params` 한 곳만 수정.
-- yymm 은 YYYYMM 6자리 문자열 비교(사전순 = 시간순).
--
-- 구성
--   1) 검증용 SELECT (실행 전 미리보기)
--   2) 동기화 본문 BEGIN … COMMIT (검증 만족 후 실행)
--   3) 동기화 후 확인 SELECT
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0) 파라미터 (여기만 수정)
-- -----------------------------------------------------------------------------
-- Supabase SQL Editor 는 \set 미지원 → 본 파일 안의 문자열 '202604' 를 원하는 목표 YYYYMM 으로
-- **일괄 치환** 하세요 (WITH params … 블록이 여러 개 있으므로 모두 같은 값이어야 합니다).


-- =============================================================================
-- 1) 검증용 SELECT (읽기 전용 — 먼저 실행해 결과 확인)
-- =============================================================================

-- 1-A) trade_data 에서 (hs_code, country_code) 별 MAX(yymm)
WITH params AS (
  SELECT '202604'::text AS target_yymm
),
agg AS (
  SELECT
    left(trim(both FROM td.hs_code::text), 10) AS hs_code,
    left(trim(both FROM td.country_code::text), 2) AS country_code,
    max(td.yymm::text) AS max_yymm
  FROM public.trade_data AS td
  GROUP BY 1, 2
)
SELECT
  a.hs_code,
  a.country_code,
  a.max_yymm,
  p.target_yymm,
  CASE
    WHEN a.max_yymm >= p.target_yymm THEN 'completed'
    ELSE 'pending'
  END AS would_status
FROM agg AS a
CROSS JOIN params AS p
ORDER BY a.hs_code, a.country_code;


-- 1-B) sync_progress 현재값 vs trade_data 기준 "될 값" 비교 (양쪽 모두 존재)
WITH params AS (
  SELECT '202604'::text AS target_yymm
),
agg AS (
  SELECT
    left(trim(both FROM td.hs_code::text), 10) AS hs_code,
    left(trim(both FROM td.country_code::text), 2) AS country_code,
    max(td.yymm::text) AS max_yymm
  FROM public.trade_data AS td
  GROUP BY 1, 2
)
SELECT
  left(trim(both FROM sp.hs_code::text), 10) AS hs_code,
  left(trim(both FROM sp.country_code::text), 2) AS country_code,
  sp.last_fetched_yymm::text AS current_last_fetched,
  sp.status AS current_status,
  a.max_yymm AS new_last_fetched_yymm,
  CASE
    WHEN a.max_yymm >= p.target_yymm THEN 'completed'
    ELSE 'pending'
  END AS new_status,
  (sp.last_fetched_yymm::text IS DISTINCT FROM a.max_yymm
    OR sp.status IS DISTINCT FROM CASE
      WHEN a.max_yymm >= p.target_yymm THEN 'completed'::varchar
      ELSE 'pending'::varchar
    END) AS would_change
FROM public.sync_progress AS sp
INNER JOIN agg AS a
  ON left(trim(both FROM sp.hs_code::text), 10) = a.hs_code
 AND left(trim(both FROM sp.country_code::text), 2) = a.country_code
CROSS JOIN params AS p
ORDER BY hs_code, country_code;


-- 1-C) trade_data 에만 있고 sync_progress 에 없는 조합 (INSERT 대상 건수)
WITH agg AS (
  SELECT
    left(trim(both FROM td.hs_code::text), 10) AS hs_code,
    left(trim(both FROM td.country_code::text), 2) AS country_code,
    max(td.yymm::text) AS max_yymm
  FROM public.trade_data AS td
  GROUP BY 1, 2
)
SELECT count(*) AS rows_to_insert
FROM agg AS a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.sync_progress AS sp
  WHERE left(trim(both FROM sp.hs_code::text), 10) = a.hs_code
    AND left(trim(both FROM sp.country_code::text), 2) = a.country_code
);


-- 1-D) sync_progress 에는 있으나 trade_data 에 행이 없는 조합 (이 스크립트는 변경 안 함 = 초기값 유지)
SELECT
  left(trim(both FROM sp.hs_code::text), 10) AS hs_code,
  left(trim(both FROM sp.country_code::text), 2) AS country_code,
  sp.last_fetched_yymm::text,
  sp.status
FROM public.sync_progress AS sp
WHERE NOT EXISTS (
  SELECT 1
  FROM public.trade_data AS td
  WHERE left(trim(both FROM td.hs_code::text), 10) = left(trim(both FROM sp.hs_code::text), 10)
    AND left(trim(both FROM td.country_code::text), 2) = left(trim(both FROM sp.country_code::text), 2)
)
ORDER BY hs_code, country_code;


-- =============================================================================
-- 2) 동기화 실행 (BEGIN ~ COMMIT)
-- =============================================================================
-- 검증 SELECT 결과를 확인한 뒤, 아래 블록만 선택 실행하세요.
-- 문제 시 같은 세션에서 ROLLBACK; (아직 COMMIT 전일 때만 유효)

BEGIN;

WITH params AS (
  SELECT '202604'::text AS target_yymm
),
agg AS (
  SELECT
    left(trim(both FROM td.hs_code::text), 10) AS hs_code,
    left(trim(both FROM td.country_code::text), 2) AS country_code,
    max(td.yymm::text) AS max_yymm
  FROM public.trade_data AS td
  GROUP BY 1, 2
)
INSERT INTO public.sync_progress (
  hs_code,
  country_code,
  last_fetched_yymm,
  status,
  last_updated
)
SELECT
  a.hs_code::varchar(10),
  a.country_code::bpchar(2),
  a.max_yymm::bpchar(6),
  CASE
    WHEN a.max_yymm >= p.target_yymm THEN 'completed'
    ELSE 'pending'
  END,
  now()
FROM agg AS a
CROSS JOIN params AS p
ON CONFLICT (hs_code, country_code) DO UPDATE SET
  last_fetched_yymm = excluded.last_fetched_yymm,
  status = excluded.status,
  last_updated = excluded.last_updated;

COMMIT;
-- 동기화 취소가 필요하면 COMMIT 대신 ROLLBACK;


-- =============================================================================
-- 3) 동기화 후 확인
-- =============================================================================

WITH params AS (
  SELECT '202604'::text AS target_yymm
),
agg AS (
  SELECT
    left(trim(both FROM td.hs_code::text), 10) AS hs_code,
    left(trim(both FROM td.country_code::text), 2) AS country_code,
    max(td.yymm::text) AS max_yymm
  FROM public.trade_data AS td
  GROUP BY 1, 2
)
SELECT
  left(trim(both FROM sp.hs_code::text), 10) AS hs_code,
  left(trim(both FROM sp.country_code::text), 2) AS country_code,
  sp.last_fetched_yymm::text AS last_fetched_yymm,
  sp.status,
  a.max_yymm AS trade_data_max_yymm,
  (sp.last_fetched_yymm::text = a.max_yymm) AS last_matches_max,
  CASE
    WHEN a.max_yymm >= p.target_yymm THEN 'completed'
    ELSE 'pending'
  END AS expected_status,
  (sp.status = CASE
    WHEN a.max_yymm >= p.target_yymm THEN 'completed'::varchar
    ELSE 'pending'::varchar
  END) AS status_ok
FROM public.sync_progress AS sp
INNER JOIN agg AS a
  ON left(trim(both FROM sp.hs_code::text), 10) = a.hs_code
 AND left(trim(both FROM sp.country_code::text), 2) = a.country_code
CROSS JOIN params AS p
ORDER BY hs_code, country_code;


-- =============================================================================
-- 4) 실행 방법 · 주의사항 · 롤백 · 인덱스 (읽기용 주석)
-- =============================================================================
-- [실행 순서]
--   1) Supabase Dashboard → SQL Editor 에서 본 파일을 붙여 넣거나 업로드합니다.
--   2) 상단의 목표 월 '202604' 를 실제 기준 월(YYYYMM)로 **파일 전체 일괄 치환** 합니다.
--   3) 섹션 "1) 검증용 SELECT" 만 먼저 실행해 행 수·would_change·INSERT 대상 건수를 확인합니다.
--   4) 이상 없으면 섹션 "2) 동기화 실행" 의 BEGIN … COMMIT 블록만 선택 실행합니다.
--   5) 마지막으로 섹션 "3) 동기화 후 확인" 을 실행해 last_matches_max, status_ok 가 true 인지 봅니다.
--
-- [롤백]
--   COMMIT 전에만 유효합니다. BEGIN 직후 문제가 보이면 같은 SQL 세션에서 ROLLBACK; 실행.
--   이미 COMMIT 한 뒤에는 이 스크립트가 자동 백업을 만들지 않으므로, 중요 시점에는
--   Supabase 백업/브랜치 기능으로 DB 스냅샷을 권장합니다.
--
-- [실행 시간·부하]
--   trade_data 행 수에 비례합니다. 집계는 (hs_code, country_code) 그룹이므로
--   idx_trade_data_hs_yymm / idx_trade_data_country_yymm 이 있으면 도움이 될 수 있습니다.
--   조합 수가 많으면 수 초~수 분까지 걸릴 수 있습니다.
--
-- [수집 스크립트와의 관계]
--   last_fetched_yymm 은 trade_data 의 MAX(yymm) 과 맞춥니다. collect-trade.mjs 는
--   다음 구간을 last_fetched_yymm 의 다음 달부터 잡으므로 중복 호출이 줄어듭니다.
--
-- [주의]
--   동기화 시 기존 sync_progress 행도 trade_data 기준으로 pending/completed 로 덮어씁니다.
--   status 가 'running' 인 행도 포함됩니다. 수집 job 이 동시에 돌고 있다면 잠시 중지한 뒤 실행하세요.
