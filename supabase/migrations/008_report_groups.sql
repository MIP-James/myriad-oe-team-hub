-- =====================================================================
-- MYRIAD Team Hub - Phase 5c.1 마이그레이션
-- 월간 보고서 워크플로우: 그룹(월별) + 개별 브랜드 보고서 + 상태 추적
-- =====================================================================

create table if not exists public.report_groups (
  id uuid primary key default gen_random_uuid(),
  year_month text not null,                        -- "2026-04"
  title text not null,                             -- "2026-04 월간 동향 보고"
  status text not null default 'in_progress'
    check (status in ('in_progress', 'published', 'archived')),
  google_drive_folder_id text,                     -- 5c.3 에서 사용
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (year_month)
);

create index if not exists idx_report_groups_ym on public.report_groups(year_month desc);

drop trigger if exists trg_report_groups_updated on public.report_groups;
create trigger trg_report_groups_updated before update on public.report_groups
  for each row execute function public.tg_set_updated_at();


create table if not exists public.brand_reports (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.report_groups(id) on delete cascade,
  brand_name text not null,                        -- "Apple Inc."
  report_month text not null,                      -- "2026-04"
  top_n int not null default 3,
  excel_storage_path text,                         -- supabase storage 경로 (bucket: reports)
  excel_file_name text,                            -- 원본 파일명
  google_sheet_url text,                           -- 5c.2 에서 채움
  status text not null default 'editing'
    check (status in ('editing', 'done')),
  note text,                                       -- 작업자 메모
  generated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_brand_reports_group on public.brand_reports(group_id);
create index if not exists idx_brand_reports_brand on public.brand_reports(group_id, brand_name);

drop trigger if exists trg_brand_reports_updated on public.brand_reports;
create trigger trg_brand_reports_updated before update on public.brand_reports
  for each row execute function public.tg_set_updated_at();


-- ---- RLS ----
alter table public.report_groups enable row level security;
alter table public.brand_reports enable row level security;

-- 그룹: 로그인한 팀원 전체 읽기/생성/수정 (서로 협업)
drop policy if exists report_groups_all on public.report_groups;
create policy report_groups_all on public.report_groups
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');

-- 브랜드 보고서: 로그인한 팀원 전체 읽기/생성/수정
drop policy if exists brand_reports_all on public.brand_reports;
create policy brand_reports_all on public.brand_reports
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');


-- ---- Realtime 활성화 (상태 변경이 실시간으로 다른 탭에 반영되도록) ----
alter publication supabase_realtime add table public.report_groups;
alter publication supabase_realtime add table public.brand_reports;


-- ---- Storage bucket 생성 (이 부분은 SQL Editor 에선 실패할 수 있음) ----
-- Supabase Dashboard → Storage → Create Bucket 으로 수동 생성 권장:
--   Name: reports
--   Public: off (RLS 적용)
-- RLS 정책은 아래:

do $$
begin
  -- bucket 이 이미 있으면 스킵
  if not exists (select 1 from storage.buckets where id = 'reports') then
    insert into storage.buckets (id, name, public) values ('reports', 'reports', false);
  end if;
end $$;

-- bucket RLS: 로그인한 팀원은 reports/ 하위 파일 업로드/읽기/삭제 가능
drop policy if exists reports_bucket_select on storage.objects;
create policy reports_bucket_select on storage.objects
  for select using (
    bucket_id = 'reports' and auth.role() = 'authenticated'
  );

drop policy if exists reports_bucket_insert on storage.objects;
create policy reports_bucket_insert on storage.objects
  for insert with check (
    bucket_id = 'reports' and auth.role() = 'authenticated'
  );

drop policy if exists reports_bucket_update on storage.objects;
create policy reports_bucket_update on storage.objects
  for update using (
    bucket_id = 'reports' and auth.role() = 'authenticated'
  );

drop policy if exists reports_bucket_delete on storage.objects;
create policy reports_bucket_delete on storage.objects
  for delete using (
    bucket_id = 'reports' and auth.role() = 'authenticated'
  );
