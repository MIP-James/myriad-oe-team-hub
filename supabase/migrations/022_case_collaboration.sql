-- =====================================================================
-- MYRIAD Team Hub - Phase 11a
-- 케이스 게시판 협업 강화:
--   1) action_needed 우선 정렬용 generated column + index
--   2) case_help_requests (도움 요청 대상자 관리)
--   3) case_status_log (상태 변경 히스토리 자동 기록)
--   4) 알림 팬아웃 트리거 (help_requested + resolved)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. action_needed 우선 정렬 — generated column + composite index
-- ---------------------------------------------------------------------
alter table public.cases
  add column if not exists sort_priority smallint
  generated always as (case when status = 'action_needed' then 0 else 1 end) stored;

create index if not exists idx_cases_sort
  on public.cases (sort_priority asc, created_at desc);

-- ---------------------------------------------------------------------
-- 2. case_help_requests
--    - recipient_id 지정 → 특정 팀원 한 명에게 요청
--    - is_team_all = true + recipient_id is null → 팀 전체
-- ---------------------------------------------------------------------
create table if not exists public.case_help_requests (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  is_team_all boolean not null default false,
  requested_by uuid not null references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),

  -- 둘 중 정확히 하나만 지정되어야 함
  constraint case_help_requests_target_check
    check ((recipient_id is not null and is_team_all = false)
        or (recipient_id is null and is_team_all = true))
);

-- 동일 case 에 같은 recipient 중복 방지
create unique index if not exists uq_help_req_recipient
  on public.case_help_requests (case_id, recipient_id)
  where recipient_id is not null;

-- 동일 case 에 team_all 중복 방지
create unique index if not exists uq_help_req_team_all
  on public.case_help_requests (case_id)
  where is_team_all;

create index if not exists idx_help_req_case on public.case_help_requests (case_id);
create index if not exists idx_help_req_recipient on public.case_help_requests (recipient_id);

-- Realtime (DELETE 필터 대응)
alter table public.case_help_requests replica identity full;
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.case_help_requests';
  exception when duplicate_object then null;
  end;
end $$;

-- RLS — 인증 사용자 전체 읽기, 로그인 사용자 누구나 추가 가능, 본인 요청 또는 admin 만 해제
alter table public.case_help_requests enable row level security;

drop policy if exists help_req_select on public.case_help_requests;
create policy help_req_select on public.case_help_requests
  for select using (auth.role() = 'authenticated');

drop policy if exists help_req_insert on public.case_help_requests;
create policy help_req_insert on public.case_help_requests
  for insert with check (auth.uid() = requested_by);

drop policy if exists help_req_delete on public.case_help_requests;
create policy help_req_delete on public.case_help_requests
  for delete using (
    auth.uid() = requested_by
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- ---------------------------------------------------------------------
-- 3. case_status_log — 상태 변경 자동 기록
-- ---------------------------------------------------------------------
create table if not exists public.case_status_log (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  from_status text,
  to_status text not null,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists idx_status_log_case on public.case_status_log (case_id, changed_at);

alter table public.case_status_log enable row level security;

drop policy if exists status_log_select on public.case_status_log;
create policy status_log_select on public.case_status_log
  for select using (auth.role() = 'authenticated');

-- INSERT 는 트리거 (SECURITY DEFINER) 전용 — 일반 정책 불필요

-- 상태 변경 감지 → 로그 자동 기록
create or replace function public.tg_log_case_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status then
    insert into public.case_status_log (case_id, from_status, to_status, changed_by)
    values (new.id, old.status, new.status, new.updated_by);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_case_status_log on public.cases;
create trigger trg_case_status_log
  after update on public.cases
  for each row execute function public.tg_log_case_status_change();

-- ---------------------------------------------------------------------
-- 4. 알림 팬아웃 — help_requested
-- ---------------------------------------------------------------------
create or replace function public.tg_fanout_case_help_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_name text;
  case_title text;
begin
  select c.title into case_title from public.cases c where c.id = new.case_id;
  if case_title is null then return new; end if;

  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
    into actor_name
  from public.profiles p where p.id = new.requested_by;

  if new.is_team_all then
    -- 요청자 제외 전체 팀
    insert into public.notifications (recipient_id, type, title, body, link, actor_id, payload)
    select
      p.id,
      'case_help_requested',
      coalesce(actor_name, '팀원') || ' 님이 도움을 요청했어요',
      case_title,
      '/community/cases/' || new.case_id,
      new.requested_by,
      jsonb_build_object('case_id', new.case_id, 'is_team_all', true)
    from public.profiles p
    where p.id <> new.requested_by;
  elsif new.recipient_id is not null and new.recipient_id <> new.requested_by then
    -- 본인 제외 개별 요청
    insert into public.notifications (recipient_id, type, title, body, link, actor_id, payload)
    values (
      new.recipient_id,
      'case_help_requested',
      coalesce(actor_name, '팀원') || ' 님이 도움을 요청했어요',
      case_title,
      '/community/cases/' || new.case_id,
      new.requested_by,
      jsonb_build_object('case_id', new.case_id)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_help_request_fanout on public.case_help_requests;
create trigger trg_help_request_fanout
  after insert on public.case_help_requests
  for each row execute function public.tg_fanout_case_help_request();

-- ---------------------------------------------------------------------
-- 5. 알림 팬아웃 — case resolved (요청 대상자들에게 클로징 알림)
-- ---------------------------------------------------------------------
create or replace function public.tg_fanout_case_resolved()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_name text;
begin
  -- resolved 로 전환되는 순간만 발동
  if old.status = 'resolved' or new.status <> 'resolved' then
    return new;
  end if;

  actor_id := coalesce(new.resolved_by, new.updated_by);

  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
    into actor_name
  from public.profiles p where p.id = actor_id;

  -- 타겟: (개별 recipient) UNION (team_all 있으면 전체 팀) — 액터 본인 제외
  insert into public.notifications (recipient_id, type, title, body, link, actor_id, payload)
  select distinct
    t.target_id,
    'case_resolved',
    coalesce(actor_name, '작성자') || ' 님이 요청을 마무리했어요',
    new.title,
    '/community/cases/' || new.id,
    actor_id,
    jsonb_build_object('case_id', new.id)
  from (
    select hr.recipient_id as target_id
    from public.case_help_requests hr
    where hr.case_id = new.id and hr.recipient_id is not null
    union
    select p.id as target_id
    from public.profiles p
    where exists (
      select 1 from public.case_help_requests hr2
      where hr2.case_id = new.id and hr2.is_team_all
    )
  ) t
  where t.target_id is not null and t.target_id <> actor_id;

  return new;
end;
$$;

drop trigger if exists trg_case_resolved_fanout on public.cases;
create trigger trg_case_resolved_fanout
  after update on public.cases
  for each row execute function public.tg_fanout_case_resolved();
