-- =====================================================================
-- MYRIAD Team Hub - Phase 7 마이그레이션
-- 위키 (지식 베이스)
-- =====================================================================

create table if not exists public.wiki_pages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',
  category text,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  icon text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 리스트 정렬용 (핀 + 최근 수정)
create index if not exists idx_wiki_pinned_updated
  on public.wiki_pages(pinned desc, updated_at desc);

-- 카테고리 필터
create index if not exists idx_wiki_category
  on public.wiki_pages(category)
  where category is not null;

-- 태그 검색 (GIN)
create index if not exists idx_wiki_tags
  on public.wiki_pages using gin(tags);

-- 전문 검색: 제목(A) + 본문(B). simple config — 한국어 형태소는 없지만
-- 팀 규모(6명/수십 페이지)에는 충분. ILIKE fallback 이 있으니 걱정 없음.
create index if not exists idx_wiki_search
  on public.wiki_pages
  using gin(
    (setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
     setweight(to_tsvector('simple', coalesce(body, '')), 'B'))
  );

-- updated_at 자동 갱신
drop trigger if exists trg_wiki_updated on public.wiki_pages;
create trigger trg_wiki_updated before update on public.wiki_pages
  for each row execute function public.tg_set_updated_at();

-- ---- RLS ----
alter table public.wiki_pages enable row level security;

-- 전원 읽기
drop policy if exists wiki_select on public.wiki_pages;
create policy wiki_select on public.wiki_pages
  for select using (auth.role() = 'authenticated');

-- 생성: 로그인한 모든 팀원 (created_by = 본인)
drop policy if exists wiki_insert on public.wiki_pages;
create policy wiki_insert on public.wiki_pages
  for insert with check (auth.uid() = created_by);

-- 수정: 로그인한 모든 팀원 (updated_by = 본인으로 기록)
drop policy if exists wiki_update on public.wiki_pages;
create policy wiki_update on public.wiki_pages
  for update using (auth.role() = 'authenticated')
  with check (auth.uid() = updated_by);

-- 삭제: 관리자만 (실수 방지)
drop policy if exists wiki_delete_admin on public.wiki_pages;
create policy wiki_delete_admin on public.wiki_pages
  for delete using (public.is_admin());

-- ---- Realtime ----
alter publication supabase_realtime add table public.wiki_pages;
