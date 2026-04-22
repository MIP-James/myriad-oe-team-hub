-- =====================================================================
-- MYRIAD Team Hub - Phase 5a 마이그레이션
-- 팀 공용 Google Sheets 등록/조회 (iframe 임베드 방식)
-- =====================================================================

create table if not exists public.shared_sheets (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  icon text,
  google_url text not null,
  category text,
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_shared_sheets_active_sort
  on public.shared_sheets(is_active, sort_order);

drop trigger if exists trg_shared_sheets_updated on public.shared_sheets;
create trigger trg_shared_sheets_updated before update on public.shared_sheets
  for each row execute function public.tg_set_updated_at();

-- RLS
alter table public.shared_sheets enable row level security;

-- 읽기: 로그인한 팀원 전원 (비활성도 admin 은 보이게)
drop policy if exists shared_sheets_select on public.shared_sheets;
create policy shared_sheets_select on public.shared_sheets
  for select using (
    auth.role() = 'authenticated' and (is_active or public.is_admin())
  );

-- 쓰기: admin 만
drop policy if exists shared_sheets_insert_admin on public.shared_sheets;
create policy shared_sheets_insert_admin on public.shared_sheets
  for insert with check (public.is_admin());

drop policy if exists shared_sheets_update_admin on public.shared_sheets;
create policy shared_sheets_update_admin on public.shared_sheets
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists shared_sheets_delete_admin on public.shared_sheets;
create policy shared_sheets_delete_admin on public.shared_sheets
  for delete using (public.is_admin());
