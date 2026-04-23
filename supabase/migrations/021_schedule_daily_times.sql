-- =====================================================================
-- MYRIAD Team Hub - Phase 10c
-- 다일(多日) 일정: 각 날짜별 시작/종료 시간 저장
-- =====================================================================

alter table public.schedules
  add column if not exists daily_times jsonb;

comment on column public.schedules.daily_times is
  '다일 일정의 날짜별 시간. null 이면 starts_at~ends_at 단일 범위로 취급. '
  '형식: [{date:"YYYY-MM-DD", starts_at:"HH:MM", ends_at:"HH:MM"}, ...] (날짜 오름차순)';
