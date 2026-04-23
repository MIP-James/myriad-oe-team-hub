-- =====================================================================
-- MYRIAD Team Hub - Phase 10b
-- 인앱 알림 시스템 (팀 일정 등록 시 배너 알림)
-- =====================================================================

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references auth.users(id) on delete cascade,
  type text not null,                               -- 'team_schedule' 등 (확장용)
  title text not null,
  body text,
  link text,
  actor_id uuid references auth.users(id) on delete set null,
  payload jsonb default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_notifications_recipient_unread
  on public.notifications(recipient_id, read_at, created_at desc);

-- Realtime DELETE 이벤트에 필터(recipient_id=eq.X)가 작동하도록 FULL 필요
alter table public.notifications replica identity full;

-- Realtime publication 에 테이블 추가 (이미 있으면 에러 무시)
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.notifications';
  exception when duplicate_object then
    null;
  end;
end $$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select using (recipient_id = auth.uid());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- INSERT 는 trigger (SECURITY DEFINER) 로만 일어나므로 사용자 정책 불필요

-- =====================================================================
-- 팀 일정 알림 fanout 트리거
-- =====================================================================
create or replace function public.tg_fanout_team_schedule_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
  actor_name text;
begin
  if new.visibility <> 'team' then
    return new;
  end if;

  select p.email, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
    into actor_email, actor_name
  from public.profiles p where p.id = new.user_id;

  insert into public.notifications (recipient_id, type, title, body, link, actor_id, payload)
  select
    p.id,
    'team_schedule',
    coalesce(actor_name, actor_email, '팀원') || ' 님이 팀 일정을 등록했어요',
    coalesce(new.title, '(제목 없음)'),
    '/schedules',
    new.user_id,
    jsonb_build_object(
      'schedule_id', new.id,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at
    )
  from public.profiles p
  where p.id <> new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_schedule_fanout on public.schedules;
create trigger trg_schedule_fanout
  after insert on public.schedules
  for each row execute function public.tg_fanout_team_schedule_insert();

-- UPDATE: private → team 전환 시에도 알림
create or replace function public.tg_fanout_team_schedule_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_email text;
  actor_name text;
begin
  -- team 으로 "전환되는" 경우만
  if old.visibility = 'team' or new.visibility <> 'team' then
    return new;
  end if;

  select p.email, coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
    into actor_email, actor_name
  from public.profiles p where p.id = new.user_id;

  insert into public.notifications (recipient_id, type, title, body, link, actor_id, payload)
  select
    p.id,
    'team_schedule',
    coalesce(actor_name, actor_email, '팀원') || ' 님이 팀 일정으로 전환했어요',
    coalesce(new.title, '(제목 없음)'),
    '/schedules',
    new.user_id,
    jsonb_build_object(
      'schedule_id', new.id,
      'starts_at', new.starts_at,
      'ends_at', new.ends_at
    )
  from public.profiles p
  where p.id <> new.user_id;

  return new;
end;
$$;

drop trigger if exists trg_schedule_fanout_update on public.schedules;
create trigger trg_schedule_fanout_update
  after update on public.schedules
  for each row execute function public.tg_fanout_team_schedule_update();
