-- =====================================================================
-- MYRIAD Team Hub - Phase 3 마이그레이션
-- utilities 테이블 + 관리자 역할 기반 RLS + 초기 시드 데이터
-- Supabase SQL Editor에 붙여넣고 "Run"
-- =====================================================================

-- 1) 관리자 판별 헬퍼 함수
-- RLS 정책 안에서 현재 로그인 사용자가 admin 인지 체크할 때 사용
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  )
$$;

-- 2) utilities: 팀이 사용하는 유틸리티 카탈로그
create table if not exists public.utilities (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  icon text,                          -- 이모지 또는 lucide 이름
  description text,                   -- 짧은 설명 (한 줄)
  install_guide text,                 -- 설치/사용 가이드 (줄바꿈 있는 긴 텍스트)
  category text,                      -- 분류: automation / image / report / editor 등
  download_url text,                  -- 다운로드 링크 (GitHub Releases, Drive 등)
  current_version text,               -- 예: '1.2.0'
  release_notes text,                 -- 이번 버전 변경사항
  is_active boolean not null default true,
  sort_order int not null default 0,  -- 카탈로그 정렬 순서
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_utilities_active_sort
  on public.utilities(is_active, sort_order);

drop trigger if exists trg_utilities_updated on public.utilities;
create trigger trg_utilities_updated before update on public.utilities
  for each row execute function public.tg_set_updated_at();

-- 3) RLS
alter table public.utilities enable row level security;

-- 읽기: 로그인한 팀원 전원 (is_active=true 조건)
drop policy if exists utilities_select on public.utilities;
create policy utilities_select on public.utilities
  for select using (
    auth.role() = 'authenticated' and (is_active or public.is_admin())
  );

-- 쓰기: admin 만
drop policy if exists utilities_insert_admin on public.utilities;
create policy utilities_insert_admin on public.utilities
  for insert with check (public.is_admin());

drop policy if exists utilities_update_admin on public.utilities;
create policy utilities_update_admin on public.utilities
  for update using (public.is_admin()) with check (public.is_admin());

drop policy if exists utilities_delete_admin on public.utilities;
create policy utilities_delete_admin on public.utilities
  for delete using (public.is_admin());

-- 4) 초기 시드 데이터
-- (관리자가 나중에 download_url/current_version/install_guide 채워 넣음)
insert into public.utilities (slug, name, icon, description, category, current_version, sort_order)
values
  ('myriad-enforcement-tools', 'MYRIAD Enforcement Tools', '🛡️',
   'Naver / VeRO / 이미지 크롤러 / 업로더 통합 런처', 'automation', null, 10),
  ('market-image-matcher', 'Market Image Matcher', '🖼️',
   '옥션/지마켓/쿠팡/11번가/스마트스토어 이미지 매칭', 'image', null, 20),
  ('report-generator', 'Report Generator', '📊',
   '월간 동향 보고서 자동 생성 (Excel)', 'report', null, 30),
  ('ip-report-editor', 'IP Report Editor', '📝',
   '침해 보고서 편집기', 'editor', null, 40)
on conflict (slug) do nothing;
