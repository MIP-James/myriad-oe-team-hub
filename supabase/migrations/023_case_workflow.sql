-- =====================================================================
-- MYRIAD Team Hub - Phase 11b
-- 케이스 워크플로우 공간:
--   1) case_tasks (체크리스트형 Action Items)
--   2) case_workflow_notes (자유 기록 공간, 케이스당 1 행)
--   3) 태스크 담당자 배정 알림 트리거
--   4) case_tasks Realtime publication
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. case_tasks
-- ---------------------------------------------------------------------
create table if not exists public.case_tasks (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  content text not null check (char_length(content) > 0),
  assignee_id uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'done')),
  sort_order int not null default 0,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_case_tasks_case on public.case_tasks (case_id, sort_order);
create index if not exists idx_case_tasks_assignee on public.case_tasks (assignee_id);

-- Realtime
alter table public.case_tasks replica identity full;
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.case_tasks';
  exception when duplicate_object then null;
  end;
end $$;

-- RLS — 팀 협업이므로 인증된 유저 전체 읽기/쓰기/삭제 허용
-- (케이스 삭제 권한은 cases 테이블 RLS 로 이미 통제됨)
alter table public.case_tasks enable row level security;

drop policy if exists case_tasks_select on public.case_tasks;
create policy case_tasks_select on public.case_tasks
  for select using (auth.role() = 'authenticated');

drop policy if exists case_tasks_insert on public.case_tasks;
create policy case_tasks_insert on public.case_tasks
  for insert with check (auth.uid() = created_by);

-- 체크박스 토글은 누구나, content/assignee 수정도 팀 협업이라 모두 허용
drop policy if exists case_tasks_update on public.case_tasks;
create policy case_tasks_update on public.case_tasks
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists case_tasks_delete on public.case_tasks;
create policy case_tasks_delete on public.case_tasks
  for delete using (
    auth.uid() = created_by
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin')
  );

-- updated_at 자동 갱신
create or replace function public.tg_case_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  -- 상태가 done 으로 전환되는 순간 완료 메타데이터 기록
  if (new.status = 'done' and old.status is distinct from 'done') then
    new.completed_at := now();
    new.completed_by := auth.uid();
  end if;
  -- 다시 pending 으로 돌아갈 때는 초기화
  if (new.status = 'pending' and old.status = 'done') then
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_case_tasks_touch on public.case_tasks;
create trigger trg_case_tasks_touch
  before update on public.case_tasks
  for each row execute function public.tg_case_tasks_updated_at();

-- ---------------------------------------------------------------------
-- 2. case_workflow_notes — 케이스당 단일 행 (PK = case_id)
-- ---------------------------------------------------------------------
create table if not exists public.case_workflow_notes (
  case_id uuid primary key references public.cases(id) on delete cascade,
  body_html text not null default '',
  body_text text not null default '',
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.case_workflow_notes replica identity full;
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.case_workflow_notes';
  exception when duplicate_object then null;
  end;
end $$;

alter table public.case_workflow_notes enable row level security;

drop policy if exists wf_notes_select on public.case_workflow_notes;
create policy wf_notes_select on public.case_workflow_notes
  for select using (auth.role() = 'authenticated');

drop policy if exists wf_notes_insert on public.case_workflow_notes;
create policy wf_notes_insert on public.case_workflow_notes
  for insert with check (auth.role() = 'authenticated');

drop policy if exists wf_notes_update on public.case_workflow_notes;
create policy wf_notes_update on public.case_workflow_notes
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------
-- 3. 태스크 담당자 배정 알림
--    - 신규 INSERT 시 assignee_id 가 있으면 알림
--    - UPDATE 시 담당자가 바뀌면 새 담당자에게 알림
--    - 본인이 자기 자신을 지정한 경우는 알림 생략
-- ---------------------------------------------------------------------
create or replace function public.tg_fanout_case_task_assigned()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_id uuid;
  actor_name text;
  case_title text;
begin
  -- 알림 발송 대상 결정
  if (tg_op = 'INSERT') then
    if new.assignee_id is null then return new; end if;
    actor_id := new.created_by;
  elsif (tg_op = 'UPDATE') then
    if new.assignee_id is null then return new; end if;
    if old.assignee_id is not distinct from new.assignee_id then return new; end if;
    actor_id := auth.uid();
  else
    return new;
  end if;

  -- 본인 셀프 지정은 알림 생략
  if actor_id = new.assignee_id then return new; end if;

  select c.title into case_title from public.cases c where c.id = new.case_id;
  if case_title is null then return new; end if;

  select coalesce(nullif(p.full_name, ''), split_part(p.email, '@', 1))
    into actor_name
  from public.profiles p where p.id = actor_id;

  insert into public.notifications (recipient_id, type, title, body, link, actor_id, payload)
  values (
    new.assignee_id,
    'case_task_assigned',
    coalesce(actor_name, '팀원') || ' 님이 태스크를 배정했어요',
    case_title || ' — ' || substring(new.content for 80),
    '/community/cases/' || new.case_id,
    actor_id,
    jsonb_build_object('case_id', new.case_id, 'task_id', new.id)
  );
  return new;
end;
$$;

drop trigger if exists trg_case_task_assigned_insert on public.case_tasks;
create trigger trg_case_task_assigned_insert
  after insert on public.case_tasks
  for each row execute function public.tg_fanout_case_task_assigned();

drop trigger if exists trg_case_task_assigned_update on public.case_tasks;
create trigger trg_case_task_assigned_update
  after update on public.case_tasks
  for each row execute function public.tg_fanout_case_task_assigned();
