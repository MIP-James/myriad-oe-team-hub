-- =====================================================================
-- Phase 23 — 팀 프로젝트 탭 (/projects)
--
-- 취지:
--   팀이 수행하는 외부 프로젝트(첫 타자 = KOIPA 2026 AI 모니터링 사업) 관련
--   "팀 내부 실무" 정보를 프로젝트 단위로 모아두는 공간.
--   상위 "팀 프로젝트" → 하위 프로젝트 → 하위 섹션(탭) 3단 구조.
--
-- ⚠️ 역할 분담 (2026-09-18 확정) — M-Bridge(koipa.myriadip.work) 와 겹치지 않게:
--   M-Bridge = KOIPA 를 향한 대외 창구. 실적 수치 자동 집계 / 실적 제출·보완 이력 /
--              메일 기반 요청·협의 / 권리·서류 / 참조표(표준상표·품목·플랫폼) 의 정본.
--   허브     = 팀 내부 실무. 누가·무엇을·언제까지(할 일·담당) / 제출 전 내부 준비·검수 /
--              메일에 안 남는 유선·회의 협의 메모 / 플랫폼별 노하우 / 내부 규칙.
--   → 허브에는 플랫폼별 K/M 실적표·서류 체크를 두지 않는다 (M-Bridge 정본).
--     목표 대비 숫자는 "KOIPA 가 확정해준 월별 인정 건수" 1행만 기록.
--
-- 설계 원칙:
--   - 섹션(탭)은 DB 행(project_sections) → 다음 프로젝트는 시드/관리자 모달만으로 대응.
--   - 공지 / 월별 운영 / 기획 / 비정기 / 저작권 / 할 일 / 가이드 7개 탭은 전부
--     "게시판 + 첨부" 뼈대 → project_posts 한 테이블로 통합. 탭별 차이는 section.kind 와
--     posts 의 선택 컬럼(period_month / campaign_id / status+due_on+assignee / pinned)으로만 표현.
--
-- 테이블 9종:
--   projects                  — 프로젝트 마스터 (+ config jsonb)
--   project_sections          — 프로젝트별 탭 정의 (kind 로 렌더링 분기)
--   project_posts             — 통합 게시판
--   project_post_attachments  — 첨부파일 (Storage bucket: project-files)
--   project_post_comments     — 댓글
--   project_month_summary     — 월별 KOIPA 확정 인정 건수 (+ 저작권 송부·차단)
--   project_month_checks      — 월별 마감 체크리스트 완료 상태
--   project_campaigns         — 기획(차수) / 비정기 모니터링 라운드
--   project_brands            — 참여 브랜드사 + 담당자 배정 + 착수 상태
--   project_resources         — 링크(M-Bridge·두레이) + 연락처
--
-- mig 032+ 표준 GRANT 패턴 적용.
-- =====================================================================

-- ── (1) 프로젝트 마스터 ─────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,            -- URL 키 (예: 'koipa-2026')
  name        text not null,
  short_name  text,
  client      text,
  description text,
  starts_on   date,
  ends_on     date,
  -- 코드가 읽는 키:
  --   goal_count          : 전체 차단 목표 (KOIPA = 85000)
  --   copyright_goal      : 저작권 목표 (96)
  --   copyright_baseline  : 사업 전 완료 건수 (8)
  --   report_cycle        : 월별 마감 체크리스트 [{key,label,day_hint}]
  config      jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);
comment on table public.projects is '팀 프로젝트 마스터. 하위 섹션/게시판/브랜드/자료가 모두 project_id 로 매달림.';

-- ── (2) 섹션(탭) 정의 ───────────────────────────────────────────────
create table if not exists public.project_sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  key         text not null,                   -- URL ?tab= 값
  label       text not null,
  icon        text,                             -- lucide 아이콘 이름
  -- notice     공지·규칙 (핀 고정)
  -- dashboard  팀 현황 (마감·내 할 일·라운드·브랜드 담당·외부 링크)
  -- monthly    월별 운영 (마감 체크리스트 + KOIPA 확정 건수 + 게시판)
  -- campaign   기획 모니터링 (campaign kind='planned')
  -- adhoc      비정기 모니터링 (campaign kind='adhoc')
  -- copyright  저작권 트랙 (월별 송부·차단 + 게시판)
  -- brands     브랜드 & 담당
  -- issues     할 일 (status/due_on/assignee)
  -- library    가이드 게시판 + 링크 + 연락처
  -- board      범용 게시판
  kind        text not null check (kind in (
                'notice','dashboard','monthly','campaign','adhoc',
                'copyright','brands','issues','library','board')),
  description text,
  config      jsonb not null default '{}'::jsonb,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  unique (project_id, key)
);

-- ── (3) 통합 게시판 ─────────────────────────────────────────────────
create table if not exists public.project_posts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  section_id    uuid not null references public.project_sections(id) on delete cascade,
  title         text not null,
  body_html     text not null default '',
  body_text     text not null default '',
  -- 선택 컬럼 (섹션 kind 별):
  period_month  date,                            -- monthly/copyright: 해당 월 1일
  campaign_id   uuid,                            -- FK 는 campaigns 생성 후 추가
  category      text,                            -- 자유 분류 (유선 협의 / 내부 검수 / 회의록 ...)
  status        text not null default 'none'
                  check (status in ('none','open','in_progress','done')),  -- issues
  due_on        date,                            -- issues 기한
  assignee_id   uuid references auth.users(id) on delete set null,          -- issues 담당자
  pinned        boolean not null default false,  -- notice
  severity      text not null default 'info'
                  check (severity in ('info','important','urgent')),
  created_by    uuid references auth.users(id) on delete set null,
  updated_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_project_posts_section
  on public.project_posts (section_id, pinned desc, created_at desc);
create index if not exists idx_project_posts_month
  on public.project_posts (section_id, period_month) where period_month is not null;
create index if not exists idx_project_posts_campaign
  on public.project_posts (campaign_id) where campaign_id is not null;
create index if not exists idx_project_posts_open
  on public.project_posts (project_id, status, due_on) where status in ('open','in_progress');
create index if not exists idx_project_posts_assignee
  on public.project_posts (assignee_id) where assignee_id is not null;

drop trigger if exists trg_project_posts_updated on public.project_posts;
create trigger trg_project_posts_updated before update on public.project_posts
  for each row execute function public.tg_set_updated_at();

-- ── (4) 첨부파일 ────────────────────────────────────────────────────
create table if not exists public.project_post_attachments (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.project_posts(id) on delete cascade,
  storage_path  text not null,
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  uploaded_by   uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists idx_project_post_attachments_post
  on public.project_post_attachments (post_id);

-- ── (5) 댓글 ────────────────────────────────────────────────────────
create table if not exists public.project_post_comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references public.project_posts(id) on delete cascade,
  body        text not null,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_project_post_comments_post
  on public.project_post_comments (post_id, created_at);

-- ── (6) 월별 KOIPA 확정 인정 건수 ─────────────────────────────────
-- 플랫폼별 세부 실적표는 M-Bridge 정본. 여기는 "KOIPA 가 메일로 확정해준 숫자" 1행/월.
create table if not exists public.project_month_summary (
  project_id          uuid not null references public.projects(id) on delete cascade,
  month               date not null,            -- 해당 월 1일
  confirmed_blocked   int not null default 0,   -- KOIPA 확정 차단(인정) 건수 → 목표 달성률 기준
  reported            int not null default 0,   -- 당사 보고 신고 건수 (참고)
  copyright_sent      int not null default 0,   -- 저작권 송부(권리자 확인 요청) 건수
  copyright_blocked   int not null default 0,   -- 저작권 차단 확정 건수
  note                text,
  updated_by          uuid references auth.users(id) on delete set null,
  updated_at          timestamptz not null default now(),
  primary key (project_id, month)
);
drop trigger if exists trg_project_month_summary_updated on public.project_month_summary;
create trigger trg_project_month_summary_updated before update on public.project_month_summary
  for each row execute function public.tg_set_updated_at();

-- ── (7) 월별 마감 체크리스트 완료 상태 ─────────────────────────────
create table if not exists public.project_month_checks (
  project_id  uuid not null references public.projects(id) on delete cascade,
  month       date not null,
  key         text not null,
  done        boolean not null default false,
  done_by     uuid references auth.users(id) on delete set null,
  done_at     timestamptz,
  primary key (project_id, month, key)
);

-- ── (8) 기획 / 비정기 모니터링 라운드 ──────────────────────────────
create table if not exists public.project_campaigns (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         text not null check (kind in ('planned','adhoc')),
  round_no     int,
  title        text not null,
  theme        text,
  brands       text[] not null default '{}',
  starts_on    date,
  ends_on      date,                             -- null = 마감일 미정
  status       text not null default 'planned'
                 check (status in ('planned','active','done')),
  deliverables jsonb not null default '[]'::jsonb,  -- [{label, due_on, done}]
  note         text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);
create index if not exists idx_project_campaigns_project
  on public.project_campaigns (project_id, kind, sort_order);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'project_posts_campaign_id_fkey') then
    alter table public.project_posts
      add constraint project_posts_campaign_id_fkey
      foreign key (campaign_id) references public.project_campaigns(id) on delete set null;
  end if;
end $$;

-- ── (9) 참여 브랜드사 & 담당 ────────────────────────────────────────
-- 서류(위임장 등) 현황은 M-Bridge 권리·서류가 정본 → 여기서는 관리하지 않음.
create table if not exists public.project_brands (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.projects(id) on delete cascade,
  company            text not null,             -- 브랜드사 (법인명)
  brand_names        text[] not null default '{}',
  brand_count        int,
  wave               int not null default 1,    -- 모집 차수
  category           text,                      -- 업종
  assignee_id        uuid references auth.users(id) on delete set null,  -- 담당 팀원
  monitoring_status  text not null default 'pending'
                       check (monitoring_status in ('pending','active','paused','done')),
  note               text,                      -- 브랜드별 특이사항·노하우
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (project_id, company)
);
drop trigger if exists trg_project_brands_updated on public.project_brands;
create trigger trg_project_brands_updated before update on public.project_brands
  for each row execute function public.tg_set_updated_at();

-- ── (10) 링크 & 연락처 ─────────────────────────────────────────────
create table if not exists public.project_resources (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  kind          text not null check (kind in ('link','file','contact')),
  label         text not null,
  url           text,
  storage_path  text,
  file_name     text,
  size_bytes    bigint,
  org           text,
  role          text,
  email         text,
  phone         text,
  note          text,
  group_label   text,                            -- 'M-Bridge' 그룹은 팀 현황에 바로가기 카드로 노출
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);
create index if not exists idx_project_resources_project
  on public.project_resources (project_id, kind, sort_order);

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.projects                 enable row level security;
alter table public.project_sections         enable row level security;
alter table public.project_posts            enable row level security;
alter table public.project_post_attachments enable row level security;
alter table public.project_post_comments    enable row level security;
alter table public.project_month_summary    enable row level security;
alter table public.project_month_checks     enable row level security;
alter table public.project_campaigns        enable row level security;
alter table public.project_brands           enable row level security;
alter table public.project_resources        enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects for select to authenticated using (true);
drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists project_sections_select on public.project_sections;
create policy project_sections_select on public.project_sections for select to authenticated using (true);
drop policy if exists project_sections_admin_write on public.project_sections;
create policy project_sections_admin_write on public.project_sections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists project_posts_all on public.project_posts;
create policy project_posts_all on public.project_posts for all to authenticated using (true) with check (true);
drop policy if exists project_post_attachments_all on public.project_post_attachments;
create policy project_post_attachments_all on public.project_post_attachments for all to authenticated using (true) with check (true);
drop policy if exists project_post_comments_all on public.project_post_comments;
create policy project_post_comments_all on public.project_post_comments for all to authenticated using (true) with check (true);
drop policy if exists project_month_summary_all on public.project_month_summary;
create policy project_month_summary_all on public.project_month_summary for all to authenticated using (true) with check (true);
drop policy if exists project_month_checks_all on public.project_month_checks;
create policy project_month_checks_all on public.project_month_checks for all to authenticated using (true) with check (true);
drop policy if exists project_campaigns_all on public.project_campaigns;
create policy project_campaigns_all on public.project_campaigns for all to authenticated using (true) with check (true);
drop policy if exists project_brands_all on public.project_brands;
create policy project_brands_all on public.project_brands for all to authenticated using (true) with check (true);
drop policy if exists project_resources_all on public.project_resources;
create policy project_resources_all on public.project_resources for all to authenticated using (true) with check (true);

-- ── GRANT (mig 032+ 표준) ──────────────────────────────────────────
grant select on public.projects, public.project_sections, public.project_posts,
  public.project_post_attachments, public.project_post_comments,
  public.project_month_summary, public.project_month_checks, public.project_campaigns,
  public.project_brands, public.project_resources to anon;
grant select, insert, update, delete on public.projects, public.project_sections,
  public.project_posts, public.project_post_attachments, public.project_post_comments,
  public.project_month_summary, public.project_month_checks, public.project_campaigns,
  public.project_brands, public.project_resources to authenticated;
grant select, insert, update, delete on public.projects, public.project_sections,
  public.project_posts, public.project_post_attachments, public.project_post_comments,
  public.project_month_summary, public.project_month_checks, public.project_campaigns,
  public.project_brands, public.project_resources to service_role;

-- ── Realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.project_posts;
alter publication supabase_realtime add table public.project_post_comments;

-- ── Storage bucket: project-files (private) ────────────────────────
do $$
begin
  if not exists (select 1 from storage.buckets where id = 'project-files') then
    insert into storage.buckets (id, name, public) values ('project-files', 'project-files', false);
  end if;
end $$;
drop policy if exists project_files_bucket_select on storage.objects;
create policy project_files_bucket_select on storage.objects
  for select using (bucket_id = 'project-files' and auth.role() = 'authenticated');
drop policy if exists project_files_bucket_insert on storage.objects;
create policy project_files_bucket_insert on storage.objects
  for insert with check (bucket_id = 'project-files' and auth.role() = 'authenticated');
drop policy if exists project_files_bucket_update on storage.objects;
create policy project_files_bucket_update on storage.objects
  for update using (bucket_id = 'project-files' and auth.role() = 'authenticated');
drop policy if exists project_files_bucket_delete on storage.objects;
create policy project_files_bucket_delete on storage.objects
  for delete using (bucket_id = 'project-files' and auth.role() = 'authenticated');


-- =====================================================================
-- 시드: KOIPA 2026년 AI 기반 국내 온라인 위조상품 모니터링 사업
-- 출처: 이예진 전임(KOIPA) ↔ 손현정 그룹장 메일 (2026-07 ~ 09-17) + M-Bridge 포털 구조
-- =====================================================================
do $$
declare
  p_id uuid;
  s_notice uuid; s_monthly uuid; s_camp uuid; s_copy uuid; s_issues uuid; s_lib uuid;
  c1 uuid;
begin
  insert into public.projects (slug, name, short_name, client, description, starts_on, ends_on, config, sort_order)
  values (
    'koipa-2026',
    '2026년 AI 기반 국내 온라인 위조상품 모니터링 사업',
    'KOIPA AI 모니터링',
    '한국지식재산보호원 (KOIPA) 상표부정경쟁조사실',
    'KOIPA 주관 AI 기반 위조상품 모니터링·신고·차단 용역. 참여 브랜드사 27+5개사, 플랫폼 15종, 연간 차단 목표 85,000건. 대외 수치·제출 이력·요청 협의는 M-Bridge(koipa.myriadip.work)가 정본이고, 이 공간은 팀 내부 실무(할 일·담당·내부 검수·유선 협의·노하우) 전용.',
    '2026-08-01', '2026-12-31',
    jsonb_build_object(
      'goal_count', 85000,
      'copyright_goal', 96,
      'copyright_baseline', 8,
      'report_cycle', jsonb_build_array(
        jsonb_build_object('key','prep','label','실적 파일 내부 검수 (화질·품목 분류·가품 키워드·관리번호) — 제출 전','day_hint','~9일'),
        jsonb_build_object('key','r1','label','1차 실적 보고 메일 + 두레이 업로드 (플랫폼별 신고 요청 파일)','day_hint','~10일'),
        jsonb_build_object('key','copyright','label','저작권 모니터링 결과 송부 (당월 1~2주차, 30~50건)','day_hint','~14일'),
        jsonb_build_object('key','dup','label','KOIPA 온라인팀 채증 파일 다운로드 → M-Bridge 중복 관리로 대조','day_hint','21~22일'),
        jsonb_build_object('key','r2','label','2차(최종) 실적 파일 제출 — 전체 / 플랫폼별 / (기획) 폴더 구분','day_hint','23~25일'),
        jsonb_build_object('key','confirm','label','KOIPA 확정 인정 건수 회신 받아 월별 운영 탭에 기록','day_hint','마감 후')
      )
    ),
    0
  )
  returning id into p_id;

  -- 섹션 9개 (M-Bridge 와 역할 분담 반영)
  insert into public.project_sections (project_id, key, label, icon, kind, description, sort_order) values
    (p_id, 'notice',    '공지·규칙',      'Megaphone',     'notice',
     '팀 내부 규칙·필독. 바뀌지 않는 원칙은 상단 고정(핀). KOIPA 공식 요청 이력은 M-Bridge 요청·협의 참조.', 0),
    (p_id, 'dashboard', '팀 현황',        'Gauge',         'dashboard',
     '이번 주 마감 · 내 할 일 · 라운드 일정 · 브랜드 담당. 대외 수치는 M-Bridge 종합 현황 참조.', 1),
    (p_id, 'monthly',   '월별 운영',      'CalendarRange', 'monthly',
     '월 단위 마감 체크리스트 + KOIPA 확정 인정 건수 + 내부 준비·검수 기록·유선 협의 메모. 제출·보완 이력 자체는 M-Bridge 실적 제출이 정본.', 2),
    (p_id, 'campaign',  '기획 모니터링',  'Target',        'campaign',
     '차수별 기획 모니터링 실제 작업 공간. 기간·대상·제출물 체크 + 진행 기록. (M-Bridge 기획 모니터링은 KOIPA 열람용 읽기 전용)', 3),
    (p_id, 'adhoc',     '비정기 모니터링', 'Crosshair',    'adhoc',
     'KOIPA 요청 비정기 모니터링 (셀린느·디올·어뉴골프·아이앱스튜디오 등). 브랜드 추가 이력 포함.', 4),
    (p_id, 'copyright', '저작권 모니터링', 'Copyright',    'copyright',
     '저작권보호원 트랙. 목표 96건(상반기 8건 완료), 월 30~50건, 당월 1~2주차 송부. 관리번호는 KOIPA 부여. 알리·테무 제외.', 5),
    (p_id, 'brands',    '브랜드 & 담당',  'Building2',     'brands',
     '브랜드사별 담당 팀원·모니터링 착수 상태·특이사항. 위임장 등 서류 현황은 M-Bridge 권리·서류 참조.', 6),
    (p_id, 'issues',    '할 일',          'ListTodo',      'issues',
     '팀 내부 액션 전용 (담당자·기한). KOIPA 와 주고받는 메일 요청은 M-Bridge 요청·협의가 자동 추적.', 7),
    (p_id, 'library',   '가이드 & 연락처', 'Library',      'library',
     '플랫폼별 신고 절차·캡처 요령·자주 하는 실수 같은 실무 가이드 + 담당자 연락처 + M-Bridge·두레이 링크. 양식·매핑표 정본은 M-Bridge 참조자료.', 8);

  select id into s_notice  from public.project_sections where project_id = p_id and key = 'notice';
  select id into s_monthly from public.project_sections where project_id = p_id and key = 'monthly';
  select id into s_camp    from public.project_sections where project_id = p_id and key = 'campaign';
  select id into s_copy    from public.project_sections where project_id = p_id and key = 'copyright';
  select id into s_issues  from public.project_sections where project_id = p_id and key = 'issues';
  select id into s_lib     from public.project_sections where project_id = p_id and key = 'library';

  -- 기획 3차수 + 비정기 1건
  insert into public.project_campaigns (project_id, kind, round_no, title, theme, brands, starts_on, ends_on, status, deliverables, sort_order)
  values
    (p_id, 'planned', 1, '1차 기획 모니터링', '신학기 완구·문구 브랜드', '{}', '2026-09-14', '2026-09-21', 'active',
     '[{"label":"보호원 직접 차단 필요 건 송부","due_on":"2026-09-23","done":false},
       {"label":"1차 기획 모니터링 결과 보고 (hwp 양식)","due_on":"2026-09-23","done":false},
       {"label":"9월 2차 실적 제출 시 기획 실적 별도 폴더 업로드","due_on":"2026-09-25","done":false}]'::jsonb, 1),
    (p_id, 'planned', 2, '2차 기획 모니터링', '건강·안전 관련 품목 (건강기능식품·화장품·유아동 제품). 브랜드 20개 우선 선정. 실물구매 + 권리자 감정 절차 필수', '{}', '2026-10-06', '2026-10-23', 'planned',
     '[{"label":"2차 기획 계획안 송부 (선정기준·감정방법·세부일정·샘플구매 포함)","due_on":"2026-09-23","done":false}]'::jsonb, 2),
    (p_id, 'planned', 3, '3차 기획 모니터링', '블랙프라이데이 관련 (11월경, 세부 일정·대상 추후 협의)', '{}', '2026-11-01', null, 'planned',
     '[]'::jsonb, 3),
    (p_id, 'adhoc', null, '비정기 모니터링 (KOIPA 요청)', '위조상품 모니터링 — 참여 브랜드 외 KOIPA 요청 브랜드', '{셀린느,디올,어뉴골프,아이앱스튜디오}', '2026-10-06', null, 'planned',
     '[{"label":"비정기 대상 가능 브랜드 리스트 송부 (밴드·SNS 계정 기반)","due_on":null,"done":false}]'::jsonb, 1);

  select id into c1 from public.project_campaigns where project_id = p_id and kind = 'planned' and round_no = 1;

  -- 참여 브랜드사 (1차 27 + 2차 5). 담당자는 팀에서 배정. 착수 상태 = 9/11 기준.
  insert into public.project_brands (project_id, company, wave, monitoring_status, note) values
    (p_id, 'STU Korea',                1, 'active', null),
    (p_id, '로저나인',                  1, 'active', null),
    (p_id, '제이숲',                    1, 'active', null),
    (p_id, '리인터내셔널 특허법률사무소', 1, 'active', '대리인 (권리자 대신 서명·서류 제출)'),
    (p_id, '크레이버코퍼레이션',         1, 'active', null),
    (p_id, '에스엠엔터테인먼트',         1, 'active', null),
    (p_id, '코스알엑스',                1, 'active', null),
    (p_id, '웨이크원',                  1, 'active', null),
    (p_id, 'CJ ENM',                   1, 'active', null),
    (p_id, '엘지생활건강',              1, 'active', null),
    (p_id, '시몬스',                    1, 'active', null),
    (p_id, '케어링코리아',              1, 'active', null),
    (p_id, '아머스포츠코리아',           1, 'active', null),
    (p_id, '제이와이피엔터테인먼트',     1, 'active', null),
    (p_id, '와이지엔터테인먼트',         1, 'active', null),
    (p_id, '한국프로축구연맹',           1, 'active', null),
    (p_id, '김앤장 법률사무소 (P&G)',    1, 'active', '대리인 (P&G)'),
    (p_id, '유한양행',                  1, 'active', null),
    (p_id, '데이셀코스메틱',            1, 'active', null),
    (p_id, '삼성물산',                  1, 'active', null),
    (p_id, '아디다스코리아',            1, 'active', '밴드 신고 = 서류 미비로 보호원 처리 전환 (9/11). 서류 현황은 M-Bridge 권리·서류'),
    (p_id, '에이치피오',                1, 'active', null),
    (p_id, '에프앤코',                  1, 'active', null),
    (p_id, '산리오코리아',              1, 'active', null),
    (p_id, '미스토코리아',              1, 'active', null),
    (p_id, '로즈로드',                  1, 'active', null),
    (p_id, '아모레퍼시픽',              1, 'active', null);

  insert into public.project_brands (project_id, company, brand_count, wave, monitoring_status, note) values
    (p_id, '애즈온',            2, 2, 'pending', '2차 선정 (9/3). 시스템 브랜드 세팅 후 착수'),
    (p_id, '주영엔에스',        1, 2, 'pending', '2차 선정. 착수일 문의 있음 → 세팅 완료 후 착수로 회신 (9/11)'),
    (p_id, '스타쉽엔터테인먼트', 1, 2, 'pending', '2차 선정 (9/3)'),
    (p_id, '애플',              7, 2, 'pending', '2차 선정. 애플-미리어드 위임장으로 신고 진행 (9/8). 브랜드 7개'),
    (p_id, '슈피겐코리아',      7, 2, 'pending', '2차 선정 (9/3). 브랜드 7개');

  -- 월별 KOIPA 확정 인정 건수
  -- 8월: 9/7 KOIPA 최종 마감 — 누적 달성률 12.91% = 10,974 / 85,000 (9/4 손현정 표 합계와 일치)
  -- 9월: 1차 보고 13,061 (K 6,115 / M 6,946) — 확정 전. 저작권 9월 송부 30 + 50 = 80건.
  insert into public.project_month_summary (project_id, month, confirmed_blocked, reported, copyright_sent, copyright_blocked, note) values
    (p_id, '2026-08-01', 10974, 10974, 0, 0, '9/7 KOIPA 마감 확정 (누적 12.91%). 확정 4개 플랫폼 외 건은 9월 편입'),
    (p_id, '2026-09-01', 0, 13061, 80, 0, '9/11 1차 보고 13,061 (K 6,115 / M 6,946). 확정 건수는 9/23 최종 제출 후 회신 받아 입력');

  -- 공지·규칙 (핀 고정 4건)
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, pinned, severity) values
    (p_id, s_notice, '해외 플랫폼(알리·테무) 처리 원칙',
     '<ul><li>알리익스프레스·테무는 <strong>전량 보호원(KOIPA) 신고</strong>. 당사는 모니터링·증거 확보까지.</li><li>KOIPA 는 관세청 조사 후 차단 신고 → <strong>실적 반영은 모니터링 약 1개월 후</strong>.</li><li>위조 판단 근거: <strong>가격 10배 이상 차이(명품)</strong> 만 가격 기준 인정, 그 외는 <strong>가품 키워드 증거 필수</strong>. 키워드 미기재 건은 재집계 요청 옴 (9/11).</li><li>저작권 트랙은 알리·테무 모니터링 미실시 (저작권보호원 차단 불가).</li></ul>',
     '알리·테무 전량 보호원 신고. 관세청 조사 후 1개월 뒤 실적 반영. 가격 10배 차이(명품) 또는 가품 키워드 필수.', true, 'important'),
    (p_id, s_notice, '증거 채증 품질 기준 (KOIPA 반복 지적 사항)',
     '<ul><li>네이버 밴드 등 SNS 판매자 대화 이미지는 <strong>대화 내용이 판독 가능한 원본/고화질</strong>로. 화질 낮으면 재수집 요청 옴 (9/4, 9/11).</li><li>SNS 는 <strong>전체 증거(계정 단위) 채증이 원칙</strong>. 개별 게시물 갈음은 KOIPA 내부 논의 필요 사항 (9/4).</li><li>동일 <strong>OEM 공장 제품</strong>은 정·가품 판별이 어려워 판매자 소명 대비 근거자료를 충분히 확보 (9/14).</li><li>상품 이미지와 <strong>품목 분류</strong>가 불일치하면 관리번호·기존 품목·변경 품목 3열 간이 양식으로 회신 (9/15). 분류 기준 = M-Bridge 참조자료 "KOIPA 품목관리".</li></ul>',
     '밴드 대화 이미지 고화질 원본. SNS 전체 증거 채증 원칙. OEM 근거자료. 품목 분류 불일치 시 3열 간이 양식 회신.', true, 'important'),
    (p_id, s_notice, '월별 마감 사이클',
     '<ol><li><strong>제출 전 내부 검수</strong> (화질·품목·키워드·관리번호) → 보완 요청을 미리 줄이는 단계.</li><li><strong>1차 실적 보고</strong> (10일경): 실적표 메일 + 실적 파일·신고 요청 파일 두레이 업로드.</li><li><strong>KOIPA 온라인팀 채증 파일 업로드</strong> → 두레이 "중복 건수 검사" 폴더 (9월 ~9/21, 10월 ~10/21, 11월 ~11/20, 12월 ~12/8). 당사는 다음 날 M-Bridge 중복 관리로 대조.</li><li><strong>2차(최종) 실적 파일 제출</strong> (9월 9/23, 10월 10/23, 11월 11/25, 12월 12/10). 전체 실적 / 플랫폼별 신고 / (기획) 폴더 구분.</li></ol><p>지재처 보고 기준으로 마감. <strong>마감 시점 차단 미완료 건은 다음 달 실적으로 이관</strong>. 위임장 확보 브랜드는 당월 내 차단 완료 우선.</p><p>차단 요청 후 <strong>7일 초과</strong> 건은 KOIPA 가 플랫폼사 협조공문 발송 가능 → 할 일에 정리해 요청.</p>',
     '내부 검수 → 1차 보고 10일경 → KOIPA 채증 업로드 21일 → 중복검사 22일 → 최종 제출 23~25일. 미완료 건 다음 달 이관.', true, 'info'),
    (p_id, s_notice, '신고 주체(K/M) 결정 원칙',
     '<p>브랜드사 서류 5종(3자 권리위임장 · 카카오스토리 위임장 · 법인인감증명서 · 식별자료 · 사업자등록증)이 <strong>구비되면 당사(M) 신고</strong>, 미비 시 <strong>보호원(K) 신고</strong>. 서류가 보완되면 해당 월 실적표에서 K→M 으로 재분류 (9/11 아디다스·번개장터 사례).</p><p>브랜드별 서류 현황은 <strong>M-Bridge 권리·서류</strong>에서 확인.</p>',
     '서류 5종 구비 = M 신고, 미비 = K 신고. 보완 시 재분류. 현황은 M-Bridge 권리·서류.', true, 'info');

  -- 할 일 (팀 내부 액션)
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, status, due_on, category) values
    (p_id, s_issues, '1차 기획 모니터링 결과 보고 (hwp 양식) 작성·제출',
     '<p>KOIPA 양식 <em>[붙임] 2026년 제1차 AI 모니터링 사업 기획 모니터링 결과 보고_260915.hwp</em> 기준. 필수 항목 외 특이사항 포함.</p>', '결과 보고 hwp 양식 제출', 'open', '2026-09-23', '제출물'),
    (p_id, s_issues, '2차 기획 모니터링 계획안 작성 (실물구매·감정 포함)',
     '<p>건강·안전 품목(건강기능식품·화장품·유아동), 브랜드 20개 우선 선정. 선정 기준 / 모니터링·실물구매·감정 방법 / 세부 일정 포함. 기간 10.6~10.23.</p>', '2차 계획안 9/23', 'open', '2026-09-23', '제출물'),
    (p_id, s_issues, '9월 2차(최종) 실적 파일 제출 준비 — 기획 실적 별도 폴더',
     '<p>중복 검사(9/22) 후 전체 실적 / 플랫폼별 신고 / (기획) 폴더로 구분해 두레이 업로드. 제출 전 내부 검수 체크리스트 완료.</p>', '9월 최종 실적 제출', 'open', '2026-09-23', '실적'),
    (p_id, s_issues, '카카오스토리 위임장 양식 보완 재요청 (KOIPA 미회신)',
     '<p>9/8 12:14 발송 양식대로 요청했으나 미보완 (9/11). 보완 전까지 카카오스토리 신고는 K 소관.</p>', '카카오 위임장 보완', 'open', null, '서류'),
    (p_id, s_issues, '비정기 모니터링 대상 브랜드 리스트 작성·송부',
     '<p>밴드·SNS 모니터링 중 계정에서 참여 브랜드 외 상품이 확인되는 브랜드 리스트 작성 → KOIPA 송부. 시스템 등록에는 브랜드 확정 필요 (9/11 회신).</p>', '비정기 브랜드 리스트', 'open', null, '비정기'),
    (p_id, s_issues, 'OEM 공장 제품 게시물 추가 근거자료 확보',
     '<p>동일 OEM 공장 사용 제품은 판매자 소명 가능성 대비 근거자료 보강 (9/14 KOIPA 요청, 당사 확보 예정 회신).</p>', 'OEM 근거자료', 'in_progress', null, '증거'),
    (p_id, s_issues, '9월 1차 건 품목 분류 오기재 점검',
     '<p>8월 건은 9/17 매핑 반영본 송부 완료. 9월 1차 건도 동일 간이 양식(관리번호·기존 품목·변경 품목)으로 점검 후 오기재 있으면 회신.</p>', '9월 품목 점검', 'in_progress', null, '검수'),
    (p_id, s_issues, '8월 실적 품목 분류 수정본 송부',
     '<p>9/15 요청 → 9/15 1차 회신 → 9/17 KOIPA 매핑 반영본(8월_품목_변경내역_KOIPA매핑반영_260917.xlsx) 송부 완료.</p>', '8월 품목 수정 완료', 'done', '2026-09-15', '검수'),
    (p_id, s_issues, 'SHEIN(쉬인) 모니터링 가능 여부 회신',
     '<p>9/15 KOIPA 긴급 문의 → 현재 미모니터링, 필요 시 시스템 개발 필요로 회신 완료.</p>', '쉬인 회신 완료', 'done', '2026-09-15', '문의');

  -- 저작권 기록
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, period_month, category) values
    (p_id, s_copy, '9월 저작권 모니터링 — 스키주 중심 30건 + 추가 50건 송부',
     '<p>9/10 두레이 "9월 1차"에 스키주 중심 리스트 업로드 → KOIPA 담당자 검토 "내용 이상 없음, 권리자 확인 진행". 관리번호는 공란(KOIPA 부여). 9/15 추가 50건 송부 완료.</p><p>이후 방향: 식별정보 확보 가능한 타 국내 브랜드 발굴해 대상 확대.</p>',
     '9월 스키주 30건 + 50건 송부. 관리번호 KOIPA 부여.', '2026-09-01', '송부');

  -- 월별 운영 기록 (내부 경위·유선 협의)
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, period_month, category) values
    (p_id, s_monthly, '8월 실적 마감 경위 (9/4~9/7)',
     '<p>9/4 지재처 실적 발송 필요로 KOIPA 가 <strong>확정 플랫폼 4개만 8월 실적 인정</strong>, 나머지는 보완·검수 후 9월 편입 결정. 9/7 최종 마감 — 누적 달성률 <strong>12.91%</strong>. 차단 미완료 건은 9월 이관.</p><p>대용량 실적 파일은 플랫폼별(밴드는 계정별) 분할 업로드 협의.</p>',
     '8월 마감: 확정 4개 플랫폼만 인정, 나머지 9월 편입. 누적 12.91%.', '2026-08-01', '마감 경위'),
    (p_id, s_monthly, '9/11 이예진 전임 유선 협의 메모 — 비정기·해외 플랫폼',
     '<p><strong>비정기 모니터링</strong>: 밴드 계정 통째 크롤링분에서 참여 브랜드 제외한 미참여 브랜드 데이터 활용 가능 여부 → KOIPA 업무팀 확인 후 회신 예정.</p><p><strong>해외 플랫폼</strong>: 모니터링 후 KOIPA 가 관세청 조사 진행 → 전량 보호원 삭제 신고. 실적 반영은 약 1개월 후. 위조 근거는 가격 10배 이상(명품)만 가격 기준, 그 외 가품 키워드 필요.</p><p>(손현정 그룹장 → 디보팀 전달 메일 9/11 15:03 기준)</p>',
     '유선: 비정기 미참여 브랜드 데이터 활용 여부 KOIPA 확인 중. 해외 플랫폼 전량 보호원 신고·1개월 후 반영·가격 10배 기준.', '2026-09-01', '유선 협의'),
    (p_id, s_monthly, '9월 1차 실적 보고 → 위임장 반영 업데이트 (9/10~9/11)',
     '<p>9/10 1차 보고 합계 13,071 → 위임장 서명 완료 기업 반영해 <strong>13,061 (K 6,115 / M 6,946)</strong>. 아디다스 밴드 = 서류 미비로 K 처리, 알리·테무 = 전체 증거 확보 건만(10건 감소).</p><p>KOIPA 회신(9/14): 대부분 차단 실적 포함 가능. OEM 제품 근거 보강 요청. 상세 표는 M-Bridge 실적 제출 → 9월 2회차 데이터.</p>',
     '9월 1차 13,061 (K 6,115 / M 6,946). KOIPA: 대부분 인정 가능.', '2026-09-01', '보고');

  -- 기획 1차 기록
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, campaign_id, category) values
    (p_id, s_camp, '1차 기획 모니터링 착수 (9/14)',
     '<p>기존 계획안대로 9/14(월)~9/21(월) 1주간 진행. 권리자 확인 필요 건은 KOIPA 가 별도 요청 예정, 보호원 직접 차단 필요 건은 9/23 까지 송부.</p>',
     '1차 기획 착수 9/14~9/21', c1, '진행');

  -- 가이드 (실무 노하우) — 메일에서 확인된 반복 지적을 절차로 정리
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, category, pinned) values
    (p_id, s_lib, '실적 파일 제출 전 내부 검수 체크리스트',
     '<ol><li><strong>이미지 화질</strong>: 밴드·카카오·인스타 판매자 대화 캡처는 글자가 읽히는 원본 해상도인지 (KOIPA 9/4·9/11 재수집 요청 사례).</li><li><strong>품목 분류</strong>: 상품 이미지(실제 판매 물품)와 품목 코드 일치 여부. 기준 = M-Bridge 참조자료 "KOIPA 품목관리" 11종 (가방·신발·지갑·시계·기타(일반)·의류·소품·액세서리·화장품·유아동·기타(건강안전)).</li><li><strong>가품 키워드</strong>: 알리·테무 건은 어떤 가품 키워드로 판단했는지 기입 (가격 10배 기준은 명품만).</li><li><strong>관리번호</strong>: 건별 부여 여부. 저작권 건은 공란(KOIPA 부여).</li><li><strong>신고 주체</strong>: 서류 구비 브랜드는 M, 미비는 K. 아디다스처럼 월중 변동 시 재분류.</li><li><strong>파일 구성</strong>: 전체 실적 1개 + 플랫폼별 신고 양식 ZIP 1개 + (기획) 폴더. 대용량은 플랫폼별·밴드 계정별 분할.</li><li><strong>중복</strong>: KOIPA 채증 파일과 M-Bridge 중복 관리로 대조 후 제외.</li></ol>',
     '화질·품목·키워드·관리번호·K/M·파일 구성·중복 7항목 점검.', '검수', true),
    (p_id, s_lib, '품목 분류 오기재 회신 양식 (3열 간이 양식)',
     '<p>KOIPA 가 품목 불일치를 지적하면 전체 파일을 다시 보내지 않고 <strong>수정 필요 건만</strong> 아래 3열로 엑셀 회신 (9/15 요청, 9/17 반영본 송부 사례).</p><table><thead><tr><th>① 관리번호</th><th>② 기존 품목</th><th>③ 변경 품목</th></tr></thead><tbody><tr><td>예: 2026-08-K-00123</td><td>소품</td><td>액세서리</td></tr></tbody></table><p>오기재가 없으면 송부 불요.</p>',
     '관리번호·기존 품목·변경 품목 3열, 수정 건만 회신.', '양식', false);

  -- 링크 & 연락처
  insert into public.project_resources (project_id, kind, label, url, note, group_label, sort_order) values
    (p_id, 'link', '종합 현황',   'https://koipa.myriadip.work/dashboard',   '수집·위반확정·신고·차단 자동 집계, 85,000 로드맵', 'M-Bridge', 0),
    (p_id, 'link', '통계 분석',   'https://koipa.myriadip.work/stats',       '브랜드·채널·품목·침해유형별 교차표', 'M-Bridge', 1),
    (p_id, 'link', '실적 제출',   'https://koipa.myriadip.work/submissions', '회차별 제출·보완 요청 이력, 회차 데이터', 'M-Bridge', 2),
    (p_id, 'link', '요청·협의',   'https://koipa.myriadip.work/comms',       'KOIPA↔MIP 메일 자동 수집·AI 요약·상태', 'M-Bridge', 3),
    (p_id, 'link', '권리·서류',   'https://koipa.myriadip.work/rights',      '브랜드 권리 근거·신고 필수 서류 (정본)', 'M-Bridge', 4),
    (p_id, 'link', '기획 모니터링', 'https://koipa.myriadip.work/planned',   'KOIPA 열람용 (읽기 전용)', 'M-Bridge', 5),
    (p_id, 'link', '중복 관리',   'https://koipa.myriadip.work/dupcheck',    'KOIPA 채증 파일 업로드 → URL·상품번호 대조', 'M-Bridge', 6),
    (p_id, 'link', '참조자료',    'https://koipa.myriadip.work/refdata',     '표준상표 1,281 · 품목 매핑 881 · KOIPA 품목 11 · 플랫폼유형 15', 'M-Bridge', 7),
    (p_id, 'link', '두레이 공유 드라이브 (KOIPA)', 'https://koipa.gov-dooray.com', '월별 실적 폴더 · 브랜드사 제출자료 · 중복 건수 검사 폴더', '외부', 10),
    (p_id, 'link', '프로젝트 공용 메일함 koipa@myriadip.com', 'https://mail.google.com', 'KOIPA 발신 메일 전부 CC', '외부', 11);

  insert into public.project_resources (project_id, kind, label, org, role, email, phone, note, group_label, sort_order) values
    (p_id, 'contact', '박유탁', 'KOIPA 상표부정경쟁조사실', '팀장 (3급)', 'ytpark@koipa.re.kr', '02-2183-5822 / 010-4525-9239', '통계 관리·실적표 총괄', 'KOIPA', 20),
    (p_id, 'contact', '이예진', 'KOIPA 상표부정경쟁조사실', '전임', 'qwerwlsfl@koipa.re.kr', '02-2183-5832', '사업 실무 총괄 창구 — 실적·기획·저작권·보완 요청', 'KOIPA', 21),
    (p_id, 'contact', '김지희', 'KOIPA 상표부정경쟁조사실', '주임 (6급)', 'jihee@koipa.re.kr', '02-2183-5829', '브랜드사 서류(위임장·사업자등록증) 취합', 'KOIPA', 22),
    (p_id, 'contact', '상표부정경쟁조사실 공용', 'KOIPA', '공용 메일', 'aibrand@koipa.re.kr', null, 'KACC 안내·모집 공문 발신', 'KOIPA', 23),
    (p_id, 'contact', '손현정 (Niki)', 'Myriad IP 브랜드보호 그룹', '그룹장', 'niki@myriadip.com', '02-2138-8043', 'KOIPA 대응 총괄', 'Myriad', 30),
    (p_id, 'contact', '홍지영 (Skylar)', 'Myriad IP 디지털브랜드보호팀', '팀장', 'skylar@myriadip.com', '02-2138-8037', '신고 서류·모니터링 실무', 'Myriad', 31),
    (p_id, 'contact', '김민주 (Bella)', 'Myriad IP 경영지원팀', '파트장', 'bella@myriadip.com', null, '선금·보증보험·계약 행정', 'Myriad', 32);
end $$;
