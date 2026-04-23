-- =====================================================================
-- MYRIAD Team Hub - Phase 8 hotfix
-- 케이스에 Gmail 메타데이터/본문 분리 저장
--   기존: Gmail 본문이 cases.body_html 에 평문 섞여 들어감 → 접기 불가
--   변경: 별도 컬럼으로 분리 저장 → 뷰 모드에서 <details> 로 접어서 표시
-- =====================================================================

alter table public.cases
  add column if not exists gmail_subject  text,
  add column if not exists gmail_from     text,
  add column if not exists gmail_date     timestamptz,
  add column if not exists gmail_body_text text;

-- (인덱스 불필요 — 표시 전용)
