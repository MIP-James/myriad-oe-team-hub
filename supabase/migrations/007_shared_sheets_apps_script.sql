-- =====================================================================
-- MYRIAD Team Hub - Phase 5a 추가 마이그레이션
-- shared_sheets 에 Apps Script 사용 여부 플래그 추가
-- (Apps Script 는 iframe 안에서 못 돌아서 새 탭 우선 UX 필요)
-- =====================================================================

alter table public.shared_sheets
  add column if not exists uses_apps_script boolean not null default false;

comment on column public.shared_sheets.uses_apps_script is
  'true 면 Apps Script 커스텀 메뉴/매크로 사용 → iframe 대신 새 탭 열기 우선 표시';
