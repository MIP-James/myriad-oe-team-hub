-- =====================================================================
-- MYRIAD Team Hub - 대시보드 외부 바로가기 (Phase 9 마무리)
--
-- 관리자가 KIPRIS / 네이버 권리보호센터 같은 외부 사이트 바로가기를 자유롭게
-- 등록하면 모든 팀원이 대시보드 하단에 카드 형태로 노출되어 빠르게 접근.
--
-- shared_sheets 패턴과 유사 — 전원 read, admin 만 write.
-- =====================================================================

create table if not exists public.external_shortcuts (
  id uuid primary key default gen_random_uuid(),
  name text not null,                          -- "KIPRIS"
  url text not null,                           -- "https://www.kipris.or.kr/khome/main.do"
  description text,                            -- "특허·실용신안·디자인·상표 검색"
  icon text,                                   -- 이모지 또는 짧은 라벨 (선택)
  color text not null default 'sky',           -- 카드 색상 프리셋
  position int not null default 0,             -- 정렬 (오름차순)
  is_active boolean not null default true,     -- 비활성화 시 대시보드 숨김
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ext_shortcuts_order
  on public.external_shortcuts(is_active, position, created_at);

drop trigger if exists trg_ext_shortcuts_updated on public.external_shortcuts;
create trigger trg_ext_shortcuts_updated before update on public.external_shortcuts
  for each row execute function public.tg_set_updated_at();

-- ---- RLS ----
alter table public.external_shortcuts enable row level security;

drop policy if exists ext_shortcuts_select on public.external_shortcuts;
create policy ext_shortcuts_select on public.external_shortcuts
  for select using (
    auth.role() = 'authenticated'
    and (is_active or public.is_admin())
  );

drop policy if exists ext_shortcuts_insert_admin on public.external_shortcuts;
create policy ext_shortcuts_insert_admin on public.external_shortcuts
  for insert with check (public.is_admin());

drop policy if exists ext_shortcuts_update_admin on public.external_shortcuts;
create policy ext_shortcuts_update_admin on public.external_shortcuts
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists ext_shortcuts_delete_admin on public.external_shortcuts;
create policy ext_shortcuts_delete_admin on public.external_shortcuts
  for delete using (public.is_admin());

-- ---- Realtime ----
alter publication supabase_realtime add table public.external_shortcuts;
