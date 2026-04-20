-- =============================================================================
-- 과거에 거래 0건 등으로 pending 에 남은 sync_progress 일괄 정리 (선택)
-- =============================================================================
-- 아래 last_fetched_yymm 기준은 환경에 맞게 수정한 뒤, 검증 SELECT → UPDATE 순으로 실행하세요.

-- 1) 영향 받을 행 미리 확인
SELECT hs_code, country_code, last_fetched_yymm, status
FROM public.sync_progress
WHERE status = 'pending'
  AND last_fetched_yymm::text >= '202501';

-- 2) 실제 상태 변경 (트랜잭션)
BEGIN;
UPDATE public.sync_progress
SET
  status = 'completed',
  last_updated = now()
WHERE status = 'pending'
  AND last_fetched_yymm::text >= '202501';
COMMIT;

-- 3) 결과 확인
SELECT status, count(*) AS cnt
FROM public.sync_progress
GROUP BY status
ORDER BY status;
