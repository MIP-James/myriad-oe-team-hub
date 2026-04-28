-- =====================================================================
-- MYRIAD Team Hub - Phase 14c 마이그레이션 (2026-04-28)
-- 노션 사용자 프로필 캐시 — author_page_id / team_name 자동 감지 결과
--
-- 배경:
--   주간보고 자동 생성 시 제목 ("{date}-{팀}-@{이름}") 과 작성자 relation
--   채우기에 필요한 사용자별 정보 — 본인 사원 페이지 ID + 본인 팀명.
--
--   1차 설계는 환경변수 (NOTION_AUTHOR_PAGE_ID / NOTION_USER_TEAM) 였으나,
--   팀 전체 확장 시 사용자별/팀별 분기 환경변수 폭증.
--   → 사용자가 첫 보고서 생성 시 노션 API 로 본인 사원 페이지를 자동
--     감지(이메일 매칭) 해서 캐시하고, 그 다음부터는 캐시 사용.
--
-- 컬럼:
--   author_page_id      — 사원 DB 의 사용자 페이지 ID (32자 hex)
--   author_db_id        — 사원 DB 자체 ID (스키마 재조회 회피용 캐시)
--   team_name           — "OE팀", "CM팀" 등 사원 페이지의 팀 select 값
--   author_resolved_at  — 자동 감지 성공 시각 (실패 시 null → 다음 호출에 재시도)
-- =====================================================================

alter table public.notion_connections
  add column if not exists author_page_id     text,
  add column if not exists author_db_id       text,
  add column if not exists team_name          text,
  add column if not exists author_resolved_at timestamptz;

-- 기존 RLS 정책 그대로 적용 (본인 행 read/write).
-- PK = user_id 라 추가 인덱스 불필요.
