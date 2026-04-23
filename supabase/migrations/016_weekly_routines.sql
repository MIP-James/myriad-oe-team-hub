-- =====================================================================
-- MYRIAD Team Hub - Phase 9 마이그레이션
-- 주간 계획 + 일일 기록 + 일일 리마인더 (개인 루틴 정립용)
--
-- 톤: '보고/달성률' X, '루틴 정립 + 회고' O
-- 모두 본인 전용 (RLS 로 본인만 read/write)
-- =====================================================================

-- ---- 1) weekly_plans: 한 주의 할 일 리스트 ----
create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  year int not null,                           -- ISO week year
  week_number int not null,                    -- ISO week 1~53
  week_start date not null,                    -- 월요일 날짜 (조회 효율 + 표시용)
  items jsonb not null default '[]'::jsonb,    -- [{ "text": "..." }, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, year, week_number)
);

create index if not exists idx_weekly_plans_user_week
  on public.weekly_plans(user_id, week_start desc);

drop trigger if exists trg_weekly_plans_updated on public.weekly_plans;
create trigger trg_weekly_plans_updated before update on public.weekly_plans
  for each row execute function public.tg_set_updated_at();


-- ---- 2) daily_records: 그날 한 일 ----
create table if not exists public.daily_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  log_date date not null,
  items jsonb not null default '[]'::jsonb,    -- [{ "text": "..." }, ...]
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, log_date)
);

create index if not exists idx_daily_records_user_date
  on public.daily_records(user_id, log_date desc);

drop trigger if exists trg_daily_records_updated on public.daily_records;
create trigger trg_daily_records_updated before update on public.daily_records
  for each row execute function public.tg_set_updated_at();


-- ---- 3) reminder_settings: 일일 리마인더 시간 ----
create table if not exists public.reminder_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  daily_time time,                             -- 예: '17:00'
  enabled boolean not null default true,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_reminder_settings_updated on public.reminder_settings;
create trigger trg_reminder_settings_updated before update on public.reminder_settings
  for each row execute function public.tg_set_updated_at();


-- ---- RLS — 모두 본인만 ----
alter table public.weekly_plans      enable row level security;
alter table public.daily_records     enable row level security;
alter table public.reminder_settings enable row level security;

drop policy if exists weekly_plans_self on public.weekly_plans;
create policy weekly_plans_self on public.weekly_plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists daily_records_self on public.daily_records;
create policy daily_records_self on public.daily_records
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists reminder_settings_self on public.reminder_settings;
create policy reminder_settings_self on public.reminder_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
