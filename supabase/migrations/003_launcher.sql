-- =====================================================================
-- MYRIAD Team Hub - Phase 4 마이그레이션
-- 로컬 런처 연동을 위한 devices / jobs 테이블 + Realtime 활성화
-- Supabase SQL Editor에 붙여넣고 "Run"
-- =====================================================================

-- 1) launcher_devices: 각 팀원의 런처 등록 정보
create table if not exists public.launcher_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null default 'Unnamed Device',  -- 예: 'Work PC', 'Laptop'
  platform text,                                -- 'win32', 'darwin', 'linux'
  launcher_version text,                        -- 런처 자체 버전
  last_seen_at timestamptz,                     -- 런처가 마지막으로 ping 보낸 시각
  is_online boolean not null default false,     -- 런처가 실시간 연결 중인지
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_devices_user on public.launcher_devices(user_id);

drop trigger if exists trg_devices_updated on public.launcher_devices;
create trigger trg_devices_updated before update on public.launcher_devices
  for each row execute function public.tg_set_updated_at();

-- 2) launcher_jobs: 실행 요청 큐
-- status: pending → dispatched → running → done / error / cancelled
create table if not exists public.launcher_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id uuid references public.launcher_devices(id) on delete set null,
  utility_id uuid references public.utilities(id) on delete set null,
  utility_slug text not null,     -- 유틸이 삭제돼도 이력 보존용
  utility_name text,              -- 표시용 스냅샷
  status text not null default 'pending'
    check (status in ('pending', 'dispatched', 'running', 'done', 'error', 'cancelled')),
  params jsonb,                   -- 실행 시 전달할 파라미터 (향후 확장)
  output text,                    -- stdout/stderr 요약
  error_message text,
  exit_code int,
  requested_at timestamptz not null default now(),
  dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_jobs_user_status on public.launcher_jobs(user_id, status, requested_at desc);
create index if not exists idx_jobs_device_pending on public.launcher_jobs(device_id, status)
  where status in ('pending', 'dispatched', 'running');

drop trigger if exists trg_jobs_updated on public.launcher_jobs;
create trigger trg_jobs_updated before update on public.launcher_jobs
  for each row execute function public.tg_set_updated_at();

-- 3) RLS: 본인 것만 접근 (launcher도 본인 세션으로 접근하므로 동일)
alter table public.launcher_devices enable row level security;
alter table public.launcher_jobs enable row level security;

drop policy if exists devices_all_self on public.launcher_devices;
create policy devices_all_self on public.launcher_devices
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists jobs_all_self on public.launcher_jobs;
create policy jobs_all_self on public.launcher_jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 4) Realtime 활성화
-- Supabase는 publication에 테이블을 추가하면 Realtime 사용 가능
alter publication supabase_realtime add table public.launcher_jobs;
alter publication supabase_realtime add table public.launcher_devices;

-- 5) 오래된 pending job 자동 타임아웃 표시용 뷰 (추후 사용)
create or replace view public.launcher_job_summary as
select
  j.*,
  case
    when j.status = 'pending' and j.requested_at < now() - interval '30 seconds' then true
    else false
  end as is_stale,
  u.name as utility_display_name,
  u.icon as utility_icon,
  d.name as device_display_name,
  d.is_online as device_is_online
from public.launcher_jobs j
left join public.utilities u on u.id = j.utility_id
left join public.launcher_devices d on d.id = j.device_id;
