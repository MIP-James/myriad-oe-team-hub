-- =====================================================================
-- MYRIAD Team Hub
-- 케이스 알림 트리거 문구 한글화 — "태스크" → "조치 항목"
-- (023 에서 만든 함수를 CREATE OR REPLACE 로 덮어씀 — 기존 트리거 재부착 불필요)
-- =====================================================================

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
    coalesce(actor_name, '팀원') || ' 님이 조치 항목을 배정했어요',
    case_title || ' — ' || substring(new.content for 80),
    '/community/cases/' || new.case_id,
    actor_id,
    jsonb_build_object('case_id', new.case_id, 'task_id', new.id)
  );
  return new;
end;
$$;
