-- =====================================================================
-- MYRIAD Team Hub - Phase 6a 마이그레이션
-- 공지사항 + 활동 피드
-- =====================================================================

-- ---- announcements ----
create table if not exists public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  severity text not null default 'info'
    check (severity in ('info', 'important', 'urgent')),
  pinned boolean not null default false,
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_announcements_pinned_created
  on public.announcements(pinned desc, created_at desc);

drop trigger if exists trg_announcements_updated on public.announcements;
create trigger trg_announcements_updated before update on public.announcements
  for each row execute function public.tg_set_updated_at();

-- ---- announcement_reads (읽음 체크) ----
create table if not exists public.announcement_reads (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (announcement_id, user_id)
);

-- ---- activity_events ----
create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  event_type text not null,
  target_type text,
  target_id text,
  payload jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_activity_events_created
  on public.activity_events(created_at desc);

create index if not exists idx_activity_events_actor
  on public.activity_events(actor_id, created_at desc);

-- ---- RLS ----

alter table public.announcements enable row level security;
alter table public.announcement_reads enable row level security;
alter table public.activity_events enable row level security;

-- announcements: 로그인 전원 읽기, admin 쓰기
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select using (auth.role() = 'authenticated');

drop policy if exists announcements_write_admin on public.announcements;
create policy announcements_write_admin on public.announcements
  for all using (public.is_admin()) with check (public.is_admin());

-- announcement_reads: 본인 것만
drop policy if exists announcement_reads_self on public.announcement_reads;
create policy announcement_reads_self on public.announcement_reads
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- activity_events: 전원 읽기, 본인 이벤트만 쓰기
drop policy if exists activity_events_select on public.activity_events;
create policy activity_events_select on public.activity_events
  for select using (auth.role() = 'authenticated');

drop policy if exists activity_events_insert_self on public.activity_events;
create policy activity_events_insert_self on public.activity_events
  for insert with check (auth.uid() = actor_id);

-- ---- Realtime ----
alter publication supabase_realtime add table public.announcements;
alter publication supabase_realtime add table public.announcement_reads;
alter publication supabase_realtime add table public.activity_events;
