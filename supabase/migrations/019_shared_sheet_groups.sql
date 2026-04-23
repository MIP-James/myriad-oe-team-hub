-- =====================================================================
-- MYRIAD Team Hub - Phase 10a
-- 공용 시트 그룹 폴더 + RLS 완화 (일반 유저 CRUD 허용)
-- =====================================================================

-- 1) 그룹 폴더 테이블
create table if not exists public.shared_sheet_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon text default '📁',
  color text default '#f59e0b',
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_sheet_groups_sort
  on public.shared_sheet_groups(sort_order, name);

drop trigger if exists trg_shared_sheet_groups_updated on public.shared_sheet_groups;
create trigger trg_shared_sheet_groups_updated before update on public.shared_sheet_groups
  for each row execute function public.tg_set_updated_at();

-- 2) shared_sheets 에 group_id 추가 (nullable → 미분류 폴더로 취급)
alter table public.shared_sheets
  add column if not exists group_id uuid references public.shared_sheet_groups(id) on delete set null;

create index if not exists idx_shared_sheets_group
  on public.shared_sheets(group_id, sort_order);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.shared_sheet_groups enable row level security;

-- 그룹: 읽기/쓰기 모두 authenticated, 삭제만 작성자 또는 admin
drop policy if exists shared_sheet_groups_select on public.shared_sheet_groups;
create policy shared_sheet_groups_select on public.shared_sheet_groups
  for select using (auth.role() = 'authenticated');

drop policy if exists shared_sheet_groups_insert on public.shared_sheet_groups;
create policy shared_sheet_groups_insert on public.shared_sheet_groups
  for insert with check (auth.role() = 'authenticated');

drop policy if exists shared_sheet_groups_update on public.shared_sheet_groups;
create policy shared_sheet_groups_update on public.shared_sheet_groups
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists shared_sheet_groups_delete on public.shared_sheet_groups;
create policy shared_sheet_groups_delete on public.shared_sheet_groups
  for delete using (
    created_by = auth.uid() or public.is_admin()
  );

-- 시트: admin-only → authenticated 전체 (삭제만 작성자/admin)
drop policy if exists shared_sheets_insert_admin on public.shared_sheets;
drop policy if exists shared_sheets_insert on public.shared_sheets;
create policy shared_sheets_insert on public.shared_sheets
  for insert with check (auth.role() = 'authenticated');

drop policy if exists shared_sheets_update_admin on public.shared_sheets;
drop policy if exists shared_sheets_update on public.shared_sheets;
create policy shared_sheets_update on public.shared_sheets
  for update using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

drop policy if exists shared_sheets_delete_admin on public.shared_sheets;
drop policy if exists shared_sheets_delete on public.shared_sheets;
create policy shared_sheets_delete on public.shared_sheets
  for delete using (
    created_by = auth.uid() or public.is_admin()
  );
