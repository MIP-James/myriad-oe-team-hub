-- =====================================================================
-- MYRIAD Team Hub - Phase 8 마이그레이션
-- 케이스 관리 게시판 (팀 커뮤니티 내 탭)
--   - 실무자가 발견한 이슈/메일 등을 팀 전체와 공유
--   - 위키(Phase 7) 는 실사용 전이라 완전 폐기
-- =====================================================================

-- ---- 0) Phase 7 위키 제거 ----
-- 아직 실데이터 입력 없음 — 테이블/인덱스 완전 삭제.
-- Realtime publication 에서도 함께 빠짐.
drop table if exists public.wiki_pages cascade;


-- ---- 1) cases (케이스 본문) ----
create table if not exists public.cases (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brand text not null,                                 -- 자유 입력 + 기존 report_groups 브랜드 자동완성
  platform text not null,                              -- enum (하단 check)
  platform_other text,                                 -- platform = '기타' 일 때만 의미 있음
  post_url text,                                       -- 문제 게시물 URL (선택)
  infringement_type text not null,                     -- enum (하단 check)
  status text not null default 'share'
    check (status in ('share', 'action_needed', 'resolved')),
  body_html text not null default '',                  -- TipTap 이 생성한 HTML (sanitize 는 렌더 시)
  body_text text not null default '',                  -- 전문 검색용 평문 (검색 인덱스 타겟)
  gmail_message_id text,                               -- Gmail 에서 import 했을 때 원본 ID
  gmail_thread_url text,                               -- 사람이 바로 열 수 있는 Gmail URL
  resolved_at timestamptz,                             -- status = 'resolved' 로 바뀐 시각
  resolved_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- 플랫폼 enum (사용자 요청대로)
  constraint cases_platform_chk check (platform in (
    '11st','SmartStore','Gmarket','Auction','Coupang','NaverBand','KakaoStory','Instagram','독립몰','기타'
  )),
  -- 침해 유형 enum
  constraint cases_infringement_chk check (infringement_type in (
    '상표권 침해','위조품','저작권','디자인권','기타'
  ))
);

create index if not exists idx_cases_created on public.cases(created_at desc);
create index if not exists idx_cases_status on public.cases(status, created_at desc);
create index if not exists idx_cases_brand on public.cases(brand, created_at desc);
create index if not exists idx_cases_platform on public.cases(platform, created_at desc);
create index if not exists idx_cases_type on public.cases(infringement_type, created_at desc);
create index if not exists idx_cases_search on public.cases
  using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(body_text,'') || ' ' || coalesce(brand,'')));

drop trigger if exists trg_cases_updated on public.cases;
create trigger trg_cases_updated before update on public.cases
  for each row execute function public.tg_set_updated_at();


-- ---- 2) case_comments (케이스별 평면 댓글) ----
create table if not exists public.case_comments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_case_comments_case_created
  on public.case_comments(case_id, created_at);

drop trigger if exists trg_case_comments_updated on public.case_comments;
create trigger trg_case_comments_updated before update on public.case_comments
  for each row execute function public.tg_set_updated_at();


-- ---- 3) case_attachments (이미지 첨부 - 별도 갤러리) ----
create table if not exists public.case_attachments (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.cases(id) on delete cascade,
  storage_path text not null,                          -- case-attachments/<case_id>/<uuid>.<ext>
  file_name text,                                      -- 원본 파일명
  mime_type text,
  size_bytes int,
  width int,
  height int,
  sort_order int not null default 0,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_case_attachments_case
  on public.case_attachments(case_id, sort_order, created_at);


-- ---- RLS ----
alter table public.cases enable row level security;
alter table public.case_comments enable row level security;
alter table public.case_attachments enable row level security;

-- cases: 팀원 전체 읽기/생성, 수정은 작성자 또는 관리자, 삭제도 동일
drop policy if exists cases_select on public.cases;
create policy cases_select on public.cases
  for select using (auth.role() = 'authenticated');

drop policy if exists cases_insert on public.cases;
create policy cases_insert on public.cases
  for insert with check (auth.uid() = created_by);

drop policy if exists cases_update on public.cases;
create policy cases_update on public.cases
  for update using (auth.uid() = created_by or public.is_admin())
  with check (auth.uid() = updated_by or public.is_admin());

drop policy if exists cases_delete on public.cases;
create policy cases_delete on public.cases
  for delete using (auth.uid() = created_by or public.is_admin());

-- comments: 전원 읽기, 본인만 작성/수정/삭제 (관리자도 삭제 가능)
drop policy if exists case_comments_select on public.case_comments;
create policy case_comments_select on public.case_comments
  for select using (auth.role() = 'authenticated');

drop policy if exists case_comments_insert on public.case_comments;
create policy case_comments_insert on public.case_comments
  for insert with check (auth.uid() = author_id);

drop policy if exists case_comments_update on public.case_comments;
create policy case_comments_update on public.case_comments
  for update using (auth.uid() = author_id or public.is_admin())
  with check (auth.uid() = author_id or public.is_admin());

drop policy if exists case_comments_delete on public.case_comments;
create policy case_comments_delete on public.case_comments
  for delete using (auth.uid() = author_id or public.is_admin());

-- attachments: 전원 읽기. 업로더 또는 케이스 작성자가 추가/삭제 (관리자 전부 가능)
drop policy if exists case_attachments_select on public.case_attachments;
create policy case_attachments_select on public.case_attachments
  for select using (auth.role() = 'authenticated');

drop policy if exists case_attachments_insert on public.case_attachments;
create policy case_attachments_insert on public.case_attachments
  for insert with check (auth.uid() = uploaded_by);

drop policy if exists case_attachments_delete on public.case_attachments;
create policy case_attachments_delete on public.case_attachments
  for delete using (
    auth.uid() = uploaded_by
    or exists (
      select 1 from public.cases c
      where c.id = case_id and c.created_by = auth.uid()
    )
    or public.is_admin()
  );


-- ---- Realtime ----
alter publication supabase_realtime add table public.cases;
alter publication supabase_realtime add table public.case_comments;
alter publication supabase_realtime add table public.case_attachments;


-- ---- Storage bucket: case-attachments ----
-- 이미지 원본을 저장. private — RLS 로만 접근.
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'case-attachments') then
    insert into storage.buckets (id, name, public) values ('case-attachments', 'case-attachments', false);
  end if;
end $$;

drop policy if exists case_attachments_bucket_select on storage.objects;
create policy case_attachments_bucket_select on storage.objects
  for select using (
    bucket_id = 'case-attachments' and auth.role() = 'authenticated'
  );

drop policy if exists case_attachments_bucket_insert on storage.objects;
create policy case_attachments_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'case-attachments' and auth.role() = 'authenticated'
  );

drop policy if exists case_attachments_bucket_update on storage.objects;
create policy case_attachments_bucket_update on storage.objects
  for update using (
    bucket_id = 'case-attachments' and auth.role() = 'authenticated'
  );

drop policy if exists case_attachments_bucket_delete on storage.objects;
create policy case_attachments_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'case-attachments' and auth.role() = 'authenticated'
  );
