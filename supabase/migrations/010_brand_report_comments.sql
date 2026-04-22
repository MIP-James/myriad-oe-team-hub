-- =====================================================================
-- MYRIAD Team Hub - Phase 6b 마이그레이션
-- 브랜드 보고서 인라인 댓글 + 해결 상태 토글
-- =====================================================================

create table if not exists public.brand_report_comments (
  id uuid primary key default gen_random_uuid(),
  brand_report_id uuid not null references public.brand_reports(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  resolved boolean not null default false,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brc_report_created
  on public.brand_report_comments(brand_report_id, created_at);

create index if not exists idx_brc_open
  on public.brand_report_comments(brand_report_id)
  where resolved = false;

drop trigger if exists trg_brc_updated on public.brand_report_comments;
create trigger trg_brc_updated before update on public.brand_report_comments
  for each row execute function public.tg_set_updated_at();

-- RLS
alter table public.brand_report_comments enable row level security;

-- 전원 읽기
drop policy if exists brc_select on public.brand_report_comments;
create policy brc_select on public.brand_report_comments
  for select using (auth.role() = 'authenticated');

-- 댓글 작성: 로그인한 사람이 본인 author_id 로만
drop policy if exists brc_insert on public.brand_report_comments;
create policy brc_insert on public.brand_report_comments
  for insert with check (auth.uid() = author_id);

-- 수정: 작성자 본인 또는 관리자
drop policy if exists brc_update on public.brand_report_comments;
create policy brc_update on public.brand_report_comments
  for update using (auth.uid() = author_id or public.is_admin())
  with check (auth.uid() = author_id or public.is_admin());

-- 삭제: 작성자 본인 또는 관리자
drop policy if exists brc_delete on public.brand_report_comments;
create policy brc_delete on public.brand_report_comments
  for delete using (auth.uid() = author_id or public.is_admin());

-- Realtime
alter publication supabase_realtime add table public.brand_report_comments;
