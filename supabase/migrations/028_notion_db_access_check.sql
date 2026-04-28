-- =====================================================================
-- MYRIAD Team Hub - Phase 14d 마이그레이션 (2026-04-29)
-- 노션 OAuth 연동 후 "주간 업무 Snapshot" DB 접근 가능 여부 추적
--
-- 배경:
--   노션 OAuth 페이지 선택 화면은 사용자가 "공유" 권한을 가진 페이지만 노출.
--   "주간 업무 Snapshot" DB 의 워크스페이스 권한이 "내용 편집 허용" 인 경우
--   해당 DB 가 페이지 선택 화면에 보이지 않아서 토큰은 받지만 DB 에는
--   접근하지 못 하는 상태가 발생 → 보고서 생성 시 404 object_not_found.
--
--   해결을 위해 OAuth 직후/주간보고 시도 시 NOTION_DB_ID 접근을 검증하고
--   상태를 캐시 → 모달에서 사전 안내 + "권한 재확인" 워크플로우 제공.
--
-- 컬럼:
--   db_accessible        — 마지막 검증 시 NOTION_DB_ID 접근 가능 여부
--                          NULL = 아직 검증 전 (구 행 호환), true = OK,
--                          false = 권한 부족 (관리자 조치 필요)
--   db_checked_at        — 마지막 검증 시각
-- =====================================================================

alter table public.notion_connections
  add column if not exists db_accessible boolean,
  add column if not exists db_checked_at timestamptz;

-- 기존 RLS 정책 그대로 적용 (본인 행 read).
