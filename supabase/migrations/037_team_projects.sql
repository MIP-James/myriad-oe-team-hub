-- =====================================================================
-- Phase 23 — 팀 프로젝트 탭 (/projects)
--
-- 취지:
--   팀이 수행하는 외부 프로젝트(첫 타자 = KOIPA 2026 AI 모니터링 사업) 관련
--   정보·이슈·자료를 프로젝트 단위로 모아두는 공간.
--   상위 "팀 프로젝트" → 하위 프로젝트 → 하위 섹션(탭) 3단 구조.
--
-- 설계 원칙 (왜 이렇게 나눴나):
--   - 섹션(탭)은 DB 행(project_sections)으로 관리 → 다음 프로젝트는 SQL 시드만
--     추가하면 탭 구성이 달라도 코드 변경 없이 대응.
--   - 공지 / 월별 실적 / 기획 모니터링 / 비정기 / 저작권 / 이슈 트래커 6개 탭은
--     전부 "게시판 + 첨부" 라는 같은 뼈대 → project_posts 한 테이블로 통합.
--     탭별 차이는 section.kind 와 posts 의 선택 컬럼(period_month / campaign_id /
--     status / due_on)으로만 표현.
--   - 대시보드 숫자는 project_metrics_monthly(월×플랫폼 K/M 신고·차단) 한 테이블에서
--     자동 집계. 수기 입력으로 시작 (BPM API 자동화는 백로그).
--   - 참여 브랜드 서류 5종은 boolean 컬럼 → 서류 완비 여부 = 신고 주체(K/M) 판단 근거.
--
-- 테이블 9종:
--   projects                  — 프로젝트 마스터 (+ config jsonb: 목표/플랫폼 목록 등)
--   project_sections          — 프로젝트별 탭 정의 (kind 로 렌더링 분기)
--   project_posts             — 통합 게시판 (공지/월별/기획/비정기/저작권/이슈)
--   project_post_attachments  — 첨부파일 (Storage bucket: project-files)
--   project_post_comments     — 댓글 (이슈 트래커 스레드용)
--   project_metrics_monthly   — 월×플랫폼 실적 (K/M 신고·차단·수집)
--   project_campaigns         — 기획(차수) / 비정기 모니터링 라운드
--   project_brands            — 참여 브랜드사 + 서류 5종 현황
--   project_resources         — 자료실 링크/파일 + 연락처
--
-- mig 032+ 표준 GRANT 패턴 적용.
-- =====================================================================

-- ── (1) 프로젝트 마스터 ─────────────────────────────────────────────
create table if not exists public.projects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,            -- URL 키 (예: 'koipa-2026')
  name        text not null,                   -- 정식 명칭
  short_name  text,                             -- 탭/카드 표기용 짧은 이름
  client      text,                             -- 발주처 (예: 한국지식재산보호원)
  description text,
  starts_on   date,
  ends_on     date,
  -- 프로젝트별 설정. 코드가 읽는 키:
  --   goal_count            : 전체 차단 목표 건수 (KOIPA = 85000)
  --   copyright_goal        : 저작권 목표 (96)
  --   copyright_baseline    : 사업 전 완료 건수 (8, 상반기 인력 모니터링)
  --   platforms             : [{category, name}] 실적표 행 순서 (KOIPA 15개)
  --   report_cycle          : 월별 마감 체크리스트 [{key,label,day_hint}]
  config      jsonb not null default '{}'::jsonb,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id) on delete set null
);

comment on table public.projects is '팀 프로젝트 마스터. 하위 섹션/게시판/실적/브랜드/자료가 모두 project_id 로 매달림.';

-- ── (2) 섹션(탭) 정의 ───────────────────────────────────────────────
create table if not exists public.project_sections (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  key         text not null,                   -- URL ?tab= 값 (프로젝트 내 유일)
  label       text not null,
  icon        text,                             -- lucide 아이콘 이름 (프론트 매핑)
  -- 렌더링 종류:
  --   notice     공지 게시판 (핀 고정)
  --   dashboard  실적 대시보드
  --   monthly    월별 실적 게시판 (period_month 서브탭 + 마감 체크리스트 + 실적표 편집)
  --   campaign   기획 모니터링 (campaign kind='planned' 차수 서브탭)
  --   adhoc      비정기 모니터링 (campaign kind='adhoc')
  --   copyright  저작권 트랙 게시판 (period_month + 목표 게이지)
  --   brands     참여 브랜드 & 서류 매트릭스
  --   issues     이슈 트래커 (status/due_on)
  --   library    자료실 & 연락처
  --   board      범용 게시판 (기타)
  kind        text not null check (kind in (
                'notice','dashboard','monthly','campaign','adhoc',
                'copyright','brands','issues','library','board')),
  description text,                             -- 탭 상단 안내 문구
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
  body_text     text not null default '',       -- 검색용 플레인 텍스트

  -- 선택 컬럼 — 섹션 kind 에 따라 사용:
  period_month  date,                            -- monthly/copyright: 해당 월 1일
  campaign_id   uuid,                            -- FK 는 project_campaigns 생성 후 아래에서 추가
  category      text,                            -- 자유 분류 (예: '보완요청','제출물','회의록')
  status        text not null default 'none'
                  check (status in ('none','open','in_progress','done')),  -- issues 전용
  due_on        date,                            -- issues: 기한
  pinned        boolean not null default false,  -- notice: 상단 고정
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
create index if not exists idx_project_posts_status
  on public.project_posts (section_id, status) where status <> 'none';

drop trigger if exists trg_project_posts_updated on public.project_posts;
create trigger trg_project_posts_updated before update on public.project_posts
  for each row execute function public.tg_set_updated_at();

-- ── (4) 첨부파일 ────────────────────────────────────────────────────
create table if not exists public.project_post_attachments (
  id            uuid primary key default gen_random_uuid(),
  post_id       uuid not null references public.project_posts(id) on delete cascade,
  storage_path  text not null,                  -- bucket project-files 내 경로
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

-- ── (6) 월×플랫폼 실적 ─────────────────────────────────────────────
create table if not exists public.project_metrics_monthly (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  month         date not null,                  -- 해당 월 1일
  category      text not null,                  -- 오픈마켓 / SNS / 포털사이트 / 해외플랫폼 / 저작권
  platform      text not null,
  collected     int not null default 0,         -- 침해 게시물 수집
  reported_k    int not null default 0,         -- KOIPA 소관 신고
  reported_m    int not null default 0,         -- Myriad 소관 신고
  blocked_k     int not null default 0,         -- KOIPA 소관 차단 완료
  blocked_m     int not null default 0,         -- Myriad 소관 차단 완료
  note          text,
  updated_by    uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now(),
  unique (project_id, month, platform)
);
create index if not exists idx_project_metrics_month
  on public.project_metrics_monthly (project_id, month);

drop trigger if exists trg_project_metrics_updated on public.project_metrics_monthly;
create trigger trg_project_metrics_updated before update on public.project_metrics_monthly
  for each row execute function public.tg_set_updated_at();

-- ── (7) 기획 / 비정기 모니터링 라운드 ──────────────────────────────
create table if not exists public.project_campaigns (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  kind         text not null check (kind in ('planned','adhoc')),
  round_no     int,                              -- planned: 1,2,3
  title        text not null,
  theme        text,                             -- 주제 (신학기 완구·문구 등)
  brands       text[] not null default '{}',
  starts_on    date,
  ends_on      date,                             -- null = 마감일 미정
  status       text not null default 'planned'
                 check (status in ('planned','active','done')),
  -- 제출물/마일스톤: [{label, due_on, done}]
  deliverables jsonb not null default '[]'::jsonb,
  note         text,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null
);
create index if not exists idx_project_campaigns_project
  on public.project_campaigns (project_id, kind, sort_order);

-- posts.campaign_id FK (campaigns 가 posts 뒤에 만들어져서 여기서 추가)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'project_posts_campaign_id_fkey'
  ) then
    alter table public.project_posts
      add constraint project_posts_campaign_id_fkey
      foreign key (campaign_id) references public.project_campaigns(id) on delete set null;
  end if;
end $$;

-- ── (8) 참여 브랜드 & 서류 ─────────────────────────────────────────
create table if not exists public.project_brands (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  company       text not null,                  -- 브랜드사 (법인명)
  brand_names   text[] not null default '{}',   -- 보유 브랜드 (모르면 빈 배열)
  brand_count   int,                            -- 브랜드 수 (이름 미확정 시 수만)
  wave          int not null default 1,         -- 모집 차수 1/2
  category      text,                           -- 업종 (엔터/화장품/패션 등)
  -- 서류 5종 (KOIPA 요구). true = 확보
  doc_poa       boolean not null default false, -- 3자 권리위임장
  doc_kakao     boolean not null default false, -- 카카오스토리 신고용 위임장
  doc_seal      boolean not null default false, -- 법인인감증명서
  doc_identify  boolean not null default false, -- 위조상품 식별자료·공식업체 리스트
  doc_bizreg    boolean not null default false, -- 사업자등록증
  -- 신고 주체: 'K' KOIPA / 'M' Myriad. 서류 완비 시 M 전환이 원칙.
  report_owner  text not null default 'K' check (report_owner in ('K','M')),
  note          text,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, company)
);
drop trigger if exists trg_project_brands_updated on public.project_brands;
create trigger trg_project_brands_updated before update on public.project_brands
  for each row execute function public.tg_set_updated_at();

-- ── (9) 자료실 & 연락처 ────────────────────────────────────────────
create table if not exists public.project_resources (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.projects(id) on delete cascade,
  kind          text not null check (kind in ('link','file','contact')),
  label         text not null,
  -- link
  url           text,
  -- file (bucket project-files)
  storage_path  text,
  file_name     text,
  size_bytes    bigint,
  -- contact
  org           text,                            -- 소속 (KOIPA / Myriad)
  role          text,                            -- 직책
  email         text,
  phone         text,
  note          text,
  group_label   text,                            -- 묶음 표시 (양식 / 규정 / 외부 드라이브 등)
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  created_by    uuid references auth.users(id) on delete set null
);
create index if not exists idx_project_resources_project
  on public.project_resources (project_id, kind, sort_order);

-- ── (10) 월별 마감 체크리스트 완료 상태 ────────────────────────────
-- 항목 정의는 projects.config.report_cycle (프로젝트 공통), 완료 여부만 월별로 저장.
create table if not exists public.project_month_checks (
  project_id  uuid not null references public.projects(id) on delete cascade,
  month       date not null,
  key         text not null,
  done        boolean not null default false,
  done_by     uuid references auth.users(id) on delete set null,
  done_at     timestamptz,
  primary key (project_id, month, key)
);
alter table public.project_month_checks enable row level security;
drop policy if exists project_month_checks_all on public.project_month_checks;
create policy project_month_checks_all on public.project_month_checks
  for all to authenticated using (true) with check (true);
grant select on public.project_month_checks to anon;
grant select, insert, update, delete on public.project_month_checks to authenticated;
grant select, insert, update, delete on public.project_month_checks to service_role;

-- ── RLS ─────────────────────────────────────────────────────────────
-- 정책: 로그인한 팀원은 전부 읽기/쓰기 가능 (팀 내부 공간).
--       프로젝트/섹션 자체의 생성·삭제만 admin.
alter table public.projects                 enable row level security;
alter table public.project_sections         enable row level security;
alter table public.project_posts            enable row level security;
alter table public.project_post_attachments enable row level security;
alter table public.project_post_comments    enable row level security;
alter table public.project_metrics_monthly  enable row level security;
alter table public.project_campaigns        enable row level security;
alter table public.project_brands           enable row level security;
alter table public.project_resources        enable row level security;

drop policy if exists projects_select on public.projects;
create policy projects_select on public.projects
  for select to authenticated using (true);
drop policy if exists projects_admin_write on public.projects;
create policy projects_admin_write on public.projects
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists project_sections_select on public.project_sections;
create policy project_sections_select on public.project_sections
  for select to authenticated using (true);
drop policy if exists project_sections_admin_write on public.project_sections;
create policy project_sections_admin_write on public.project_sections
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 나머지 7개 테이블: 팀원 전원 CRUD
drop policy if exists project_posts_all on public.project_posts;
create policy project_posts_all on public.project_posts
  for all to authenticated using (true) with check (true);

drop policy if exists project_post_attachments_all on public.project_post_attachments;
create policy project_post_attachments_all on public.project_post_attachments
  for all to authenticated using (true) with check (true);

drop policy if exists project_post_comments_all on public.project_post_comments;
create policy project_post_comments_all on public.project_post_comments
  for all to authenticated using (true) with check (true);

drop policy if exists project_metrics_all on public.project_metrics_monthly;
create policy project_metrics_all on public.project_metrics_monthly
  for all to authenticated using (true) with check (true);

drop policy if exists project_campaigns_all on public.project_campaigns;
create policy project_campaigns_all on public.project_campaigns
  for all to authenticated using (true) with check (true);

drop policy if exists project_brands_all on public.project_brands;
create policy project_brands_all on public.project_brands
  for all to authenticated using (true) with check (true);

drop policy if exists project_resources_all on public.project_resources;
create policy project_resources_all on public.project_resources
  for all to authenticated using (true) with check (true);

-- ── GRANT (mig 032+ 표준) ──────────────────────────────────────────
grant select on public.projects, public.project_sections, public.project_posts,
  public.project_post_attachments, public.project_post_comments,
  public.project_metrics_monthly, public.project_campaigns,
  public.project_brands, public.project_resources to anon;
grant select, insert, update, delete on public.projects, public.project_sections,
  public.project_posts, public.project_post_attachments, public.project_post_comments,
  public.project_metrics_monthly, public.project_campaigns,
  public.project_brands, public.project_resources to authenticated;
grant select, insert, update, delete on public.projects, public.project_sections,
  public.project_posts, public.project_post_attachments, public.project_post_comments,
  public.project_metrics_monthly, public.project_campaigns,
  public.project_brands, public.project_resources to service_role;

-- ── Realtime ────────────────────────────────────────────────────────
alter publication supabase_realtime add table public.project_posts;
alter publication supabase_realtime add table public.project_post_comments;
alter publication supabase_realtime add table public.project_metrics_monthly;

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
-- 출처: 이예진 전임(KOIPA) ↔ 손현정 그룹장 메일 스레드 (2026-07 ~ 2026-09-17)
-- =====================================================================
do $$
declare
  p_id uuid;
  s_notice uuid; s_dash uuid; s_monthly uuid; s_camp uuid; s_adhoc uuid;
  s_copy uuid; s_brands uuid; s_issues uuid; s_lib uuid;
  c1 uuid; c2 uuid; c3 uuid; c_adhoc uuid;
begin
  insert into public.projects (slug, name, short_name, client, description, starts_on, ends_on, config, sort_order)
  values (
    'koipa-2026',
    '2026년 AI 기반 국내 온라인 위조상품 모니터링 사업',
    'KOIPA AI 모니터링',
    '한국지식재산보호원 (KOIPA) 상표부정경쟁조사실',
    'KOIPA 주관 AI 기반 위조상품 모니터링·신고·차단 용역. 참여 브랜드사 27+5개사, 플랫폼 15종, 연간 차단 목표 85,000건. 매월 1차(10일경)/2차(25일경) 실적 보고, 기획 모니터링 3회, 비정기 모니터링, 저작권 트랙(96건) 병행.',
    '2026-08-01', '2026-12-31',
    jsonb_build_object(
      'goal_count', 85000,
      'copyright_goal', 96,
      'copyright_baseline', 8,
      'platforms', jsonb_build_array(
        jsonb_build_object('category','오픈마켓','name','11번가'),
        jsonb_build_object('category','오픈마켓','name','G마켓'),
        jsonb_build_object('category','오픈마켓','name','옥션'),
        jsonb_build_object('category','오픈마켓','name','스마트스토어'),
        jsonb_build_object('category','오픈마켓','name','번개장터'),
        jsonb_build_object('category','오픈마켓','name','쿠팡'),
        jsonb_build_object('category','오픈마켓','name','당근마켓'),
        jsonb_build_object('category','오픈마켓','name','중고나라'),
        jsonb_build_object('category','SNS','name','카카오스토리'),
        jsonb_build_object('category','SNS','name','네이버 밴드'),
        jsonb_build_object('category','SNS','name','인스타그램'),
        jsonb_build_object('category','포털사이트','name','네이버 블로그'),
        jsonb_build_object('category','포털사이트','name','네이버 카페'),
        jsonb_build_object('category','해외플랫폼','name','알리익스프레스'),
        jsonb_build_object('category','해외플랫폼','name','테무'),
        jsonb_build_object('category','저작권','name','저작권보호원')
      ),
      'report_cycle', jsonb_build_array(
        jsonb_build_object('key','r1','label','1차 실적 보고 (차단·신고) 메일 + 두레이 업로드','day_hint','~10일'),
        jsonb_build_object('key','r1_files','label','신고 요청 파일 두레이 업로드 (플랫폼별)','day_hint','~10일'),
        jsonb_build_object('key','copyright','label','저작권 모니터링 결과 송부 (당월 1~2주차)','day_hint','~14일'),
        jsonb_build_object('key','dup_dl','label','KOIPA 온라인팀 채증 파일 다운로드 → 중복 검사','day_hint','21~22일'),
        jsonb_build_object('key','r2','label','2차(최종) 실적 파일 제출 — 전체/플랫폼별/기획 폴더 구분','day_hint','23~25일'),
        jsonb_build_object('key','fix','label','KOIPA 보완 요청 회신 (화질·품목·키워드)','day_hint','수시')
      )
    ),
    0
  )
  returning id into p_id;

  -- 섹션 9개
  insert into public.project_sections (project_id, key, label, icon, kind, description, sort_order) values
    (p_id, 'notice',    '공지',          'Megaphone',     'notice',
     '바뀌지 않는 규칙은 상단 고정(핀). 해외 플랫폼 처리 원칙, 위조 판단 기준, 품목 분류 원칙 등.', 0),
    (p_id, 'dashboard', '대시보드',      'Gauge',         'dashboard',
     '차단 목표 85,000건 대비 진행 현황. 숫자는 월별 실적 탭에서 입력한 값이 자동 집계됩니다.', 1),
    (p_id, 'monthly',   '월별 실적',     'CalendarRange', 'monthly',
     '월 단위 마감 체크리스트 + 실적표(K/M) 입력 + 해당 월 정보 공유 게시판(첨부 가능).', 2),
    (p_id, 'campaign',  '기획 모니터링', 'Target',        'campaign',
     '차수별 기획 모니터링. 기간·대상·제출물을 헤더에 고정하고 아래에 진행 기록을 남깁니다.', 3),
    (p_id, 'adhoc',     '비정기 모니터링','Crosshair',    'adhoc',
     'KOIPA 요청 비정기 모니터링 (셀린느·디올·어뉴골프·아이앱스튜디오 등). 브랜드 추가 이력 포함.', 4),
    (p_id, 'copyright', '저작권 모니터링','Copyright',    'copyright',
     '저작권보호원 트랙. 목표 96건(상반기 8건 완료), 월 30~50건, 당월 1~2주차 송부. 관리번호는 KOIPA 부여. 알리·테무 제외.', 5),
    (p_id, 'brands',    '참여 브랜드 & 서류','Building2', 'brands',
     '브랜드사 × 서류 5종 현황. 서류가 완비되면 신고 주체를 K→M 으로 전환합니다.', 6),
    (p_id, 'issues',    '이슈 트래커',   'ListTodo',      'issues',
     'KOIPA 요청·보완사항을 상태와 기한으로 추적. 열린 건이 상단에 옵니다.', 7),
    (p_id, 'library',   '자료실 & 연락처','Library',      'library',
     '양식(hwp/docx/xlsx), 분류표, 두레이 드라이브 링크, 담당자 연락처.', 8);

  select id into s_notice  from public.project_sections where project_id = p_id and key = 'notice';
  select id into s_dash    from public.project_sections where project_id = p_id and key = 'dashboard';
  select id into s_monthly from public.project_sections where project_id = p_id and key = 'monthly';
  select id into s_camp    from public.project_sections where project_id = p_id and key = 'campaign';
  select id into s_adhoc   from public.project_sections where project_id = p_id and key = 'adhoc';
  select id into s_copy    from public.project_sections where project_id = p_id and key = 'copyright';
  select id into s_brands  from public.project_sections where project_id = p_id and key = 'brands';
  select id into s_issues  from public.project_sections where project_id = p_id and key = 'issues';
  select id into s_lib     from public.project_sections where project_id = p_id and key = 'library';

  -- 기획 모니터링 3차수 + 비정기 1건
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
  select id into c2 from public.project_campaigns where project_id = p_id and kind = 'planned' and round_no = 2;
  select id into c_adhoc from public.project_campaigns where project_id = p_id and kind = 'adhoc' limit 1;

  -- 참여 브랜드사 (1차 27 + 2차 5). 서류 현황 = 2026-09-11 기준 메일.
  -- doc_poa: 9/11 이예진 "권리위임장 서명 완료 기업" 목록 기준
  -- doc_bizreg: 9/4 김지희 "삼성물산 제외 26개사 중 21개사 보유" — 미제출 5개사 제외 true
  insert into public.project_brands (project_id, company, wave, doc_poa, doc_bizreg, note) values
    (p_id, 'STU Korea',                1, true,  true,  null),
    (p_id, '로저나인',                  1, true,  true,  null),
    (p_id, '제이숲',                    1, true,  false, '사업자등록증 미제출 (9/4)'),
    (p_id, '리인터내셔널 특허법률사무소', 1, true,  true,  '대리인'),
    (p_id, '크레이버코퍼레이션',         1, true,  true,  null),
    (p_id, '에스엠엔터테인먼트',         1, true,  true,  null),
    (p_id, '코스알엑스',                1, true,  true,  null),
    (p_id, '웨이크원',                  1, true,  true,  null),
    (p_id, 'CJ ENM',                   1, true,  true,  null),
    (p_id, '엘지생활건강',              1, true,  true,  null),
    (p_id, '시몬스',                    1, true,  true,  null),
    (p_id, '케어링코리아',              1, true,  true,  null),
    (p_id, '아머스포츠코리아',           1, true,  true,  null),
    (p_id, '제이와이피엔터테인먼트',     1, true,  true,  null),
    (p_id, '와이지엔터테인먼트',         1, true,  true,  null),
    (p_id, '한국프로축구연맹',           1, true,  true,  null),
    (p_id, '김앤장 법률사무소 (P&G)',    1, true,  false, '대리인. 사업자등록증 미제출 (9/4)'),
    (p_id, '유한양행',                  1, true,  true,  null),
    (p_id, '데이셀코스메틱',            1, true,  true,  null),
    (p_id, '삼성물산',                  1, true,  false, '사업자등록증 별도 취급 (KOIPA 안내)'),
    (p_id, '아디다스코리아',            1, false, false, '3자 위임장 미서명 · 사업자등록증 미제출. 밴드 신고는 보호원 처리로 전환 (9/11)'),
    (p_id, '에이치피오',                1, false, true,  '3자 위임장 미서명 (9/4)'),
    (p_id, '에프앤코',                  1, false, false, '3자 위임장 미서명 · 사업자등록증 미제출 (9/4)'),
    (p_id, '산리오코리아',              1, false, true,  '3자 위임장 미서명 (9/4)'),
    (p_id, '미스토코리아',              1, false, true,  '3자 위임장 미서명 (9/4)'),
    (p_id, '로즈로드',                  1, false, false, '3자 위임장 미서명 · 사업자등록증 미제출 (9/4)'),
    (p_id, '아모레퍼시픽',              1, false, true,  '3자 위임장 미서명 (9/4)');

  insert into public.project_brands (project_id, company, brand_count, wave, doc_poa, note) values
    (p_id, '애즈온',            2, 2, true,  '2차 선정 (9/3)'),
    (p_id, '주영엔에스',        1, 2, true,  '2차 선정. 모니터링 착수 = 2차 브랜드 세팅 완료 후 (9/11 회신)'),
    (p_id, '스타쉽엔터테인먼트', 1, 2, true,  '2차 선정 (9/3)'),
    (p_id, '애플',              7, 2, true,  '2차 선정. 애플-미리어드 위임장으로 신고 진행 (9/8)'),
    (p_id, '슈피겐코리아',      7, 2, false, '2차 선정 (9/3)');

  -- 위임장 완비 브랜드는 Myriad 소관 신고로 전환 (원칙 반영)
  update public.project_brands set report_owner = 'M' where project_id = p_id and doc_poa;

  -- 월별 실적 시드
  -- 8월: 2026-09-04 손현정 회신 표 (보호원/미리어드). 9/7 KOIPA 마감 확정, 누적 달성률 12.91% (=10,974/85,000)
  --      → 마감 확정분이므로 차단 = 신고 로 동일 시드. 사후 조정 가능.
  insert into public.project_metrics_monthly (project_id, month, category, platform, reported_k, reported_m, blocked_k, blocked_m, note) values
    (p_id, '2026-08-01', 'SNS',      '네이버 밴드',    9160, 0,  9160, 0,  '9/7 마감 확정'),
    (p_id, '2026-08-01', 'SNS',      '카카오스토리',   770,  37, 770,  37, '9/7 마감 확정'),
    (p_id, '2026-08-01', '오픈마켓', '중고나라',       12,   2,  12,   2,  null),
    (p_id, '2026-08-01', '오픈마켓', '쿠팡',           8,    0,  8,    0,  null),
    (p_id, '2026-08-01', '오픈마켓', 'G마켓',          1,    0,  1,    0,  null),
    (p_id, '2026-08-01', '오픈마켓', '스마트스토어',   3,    0,  3,    0,  null),
    (p_id, '2026-08-01', '오픈마켓', '번개장터',       637,  0,  637,  0,  null),
    (p_id, '2026-08-01', 'SNS',      '인스타그램',     289,  41, 289,  41, null),
    (p_id, '2026-08-01', '오픈마켓', '11번가',         1,    0,  1,    0,  null),
    (p_id, '2026-08-01', '오픈마켓', '당근마켓',       0,    1,  0,    1,  null),
    (p_id, '2026-08-01', '해외플랫폼','알리익스프레스', 11,   0,  11,   0,  '해외 플랫폼 = 관세청 조사 후 1개월 뒤 실적 반영'),
    (p_id, '2026-08-01', '해외플랫폼','테무',           1,    0,  1,    0,  null);

  -- 9월 1차 (2026-09-11 업데이트 표). 차단은 미입력(0) — 2차 마감 후 입력.
  insert into public.project_metrics_monthly (project_id, month, category, platform, reported_k, reported_m, note) values
    (p_id, '2026-09-01', '오픈마켓', '11번가',         0,    18,   '9/11 1차 업데이트'),
    (p_id, '2026-09-01', '오픈마켓', '스마트스토어',   2,    175,  null),
    (p_id, '2026-09-01', '오픈마켓', '번개장터',       0,    263,  '위임장 확보로 M 전환'),
    (p_id, '2026-09-01', '오픈마켓', '쿠팡',           0,    1008, null),
    (p_id, '2026-09-01', '오픈마켓', '중고나라',       0,    13,   null),
    (p_id, '2026-09-01', 'SNS',      '카카오스토리',   5341, 1,    '카카오 위임장 미보완 → K'),
    (p_id, '2026-09-01', 'SNS',      '네이버 밴드',    761,  5135, '아디다스 밴드 = 서류 미비로 K 처리'),
    (p_id, '2026-09-01', 'SNS',      '인스타그램',     0,    333,  null),
    (p_id, '2026-09-01', '해외플랫폼','알리익스프레스', 11,   0,    '전체 증거 확보 건만 (10건 감소)');

  -- 공지 (핀 고정 규칙 4건) — 출처: 9/11, 9/14 메일
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, pinned, severity) values
    (p_id, s_notice, '해외 플랫폼(알리·테무) 처리 원칙',
     '<ul><li>알리익스프레스·테무는 <strong>전량 보호원(KOIPA) 신고</strong>. 당사는 모니터링·증거 확보까지.</li><li>KOIPA 는 관세청 조사 후 차단 신고 → <strong>실적 반영은 모니터링 약 1개월 후</strong>.</li><li>위조 판단 근거: <strong>가격 10배 이상 차이(명품)</strong> 만 가격 기준 인정, 그 외는 <strong>가품 키워드 증거 필수</strong>. 키워드 미기재 건은 재집계 요청 옴 (9/11).</li><li>저작권 트랙은 알리·테무 모니터링 미실시 (저작권보호원 차단 불가).</li></ul>',
     '알리·테무 전량 보호원 신고. 관세청 조사 후 1개월 뒤 실적 반영. 가격 10배 차이(명품) 또는 가품 키워드 필수.', true, 'important'),
    (p_id, s_notice, '증거 채증 품질 기준 (KOIPA 반복 지적 사항)',
     '<ul><li>네이버 밴드 등 SNS 판매자 대화 이미지는 <strong>대화 내용이 판독 가능한 원본/고화질</strong>로. 화질 낮으면 재수집 요청 옴 (9/4, 9/11).</li><li>SNS 는 <strong>전체 증거(계정 단위) 채증이 원칙</strong>. 개별 게시물 갈음은 KOIPA 내부 논의 필요 사항 (9/4).</li><li>동일 <strong>OEM 공장 제품</strong>은 정·가품 판별이 어려워 판매자 소명 대비 근거자료를 충분히 확보 (9/14).</li><li>상품 이미지와 <strong>품목 분류</strong>가 불일치하면 관리번호·기존 품목·변경 품목 3열 간이 양식으로 회신 (9/15). 분류 기준 = 자료실의 "온라인 모니터링 품목 분류표".</li></ul>',
     '밴드 대화 이미지 고화질 원본. SNS 전체 증거 채증 원칙. OEM 근거자료. 품목 분류 불일치 시 3열 간이 양식 회신.', true, 'important'),
    (p_id, s_notice, '월별 실적 마감 사이클',
     '<ol><li><strong>1차 실적 보고</strong> (10일경): 차단·신고 실적표 메일 + 실적 파일·신고 요청 파일 두레이 업로드.</li><li><strong>KOIPA 온라인팀 채증 파일 업로드</strong> → 두레이 "중복 건수 검사" 폴더 (9월 ~9/21, 10월 ~10/21, 11월 ~11/20, 12월 ~12/8).</li><li><strong>당사 다운로드·중복 검사</strong> (다음 날).</li><li><strong>2차(최종) 실적 파일 제출</strong> (9월 9/23, 10월 10/23, 11월 11/25, 12월 12/10). 전체 실적 / 플랫폼별 신고 / (기획) 폴더 구분.</li></ol><p>지재처 보고 기준으로 마감. <strong>마감 시점 차단 미완료 건은 다음 달 실적으로 이관</strong>. 위임장 확보 브랜드는 당월 내 차단 완료 우선.</p><p>차단 요청 후 <strong>7일 초과</strong> 건은 KOIPA 가 플랫폼사 협조공문 발송 가능 → 이슈 트래커에 정리해 요청.</p>',
     '1차 보고 10일경, KOIPA 채증 업로드 21일, 중복검사 22일, 최종 제출 23~25일. 미완료 건 다음 달 이관. 7일 초과 건 협조공문 요청 가능.', true, 'info'),
    (p_id, s_notice, '신고 주체(K/M) 결정 원칙',
     '<p>브랜드사 서류 5종(3자 권리위임장 · 카카오스토리 위임장 · 법인인감증명서 · 식별자료 · 사업자등록증)이 <strong>구비되면 당사(M) 신고</strong>, 미비 시 <strong>보호원(K) 신고</strong>. 서류가 보완되면 해당 월 실적표에서 K→M 으로 재분류 (9/11 아디다스·번개장터 사례).</p><p>현황은 "참여 브랜드 & 서류" 탭에서 관리.</p>',
     '서류 5종 구비 = M 신고, 미비 = K 신고. 보완 시 재분류.', true, 'info');

  -- 이슈 트래커 초기 항목 (메일에서 열려 있는 건)
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, status, due_on, category) values
    (p_id, s_issues, '1차 기획 모니터링 결과 보고 (hwp 양식) 제출',
     '<p>KOIPA 양식 <em>[붙임] 2026년 제1차 AI 모니터링 사업 기획 모니터링 결과 보고_260915.hwp</em> 기준. 필수 항목 외 특이사항 포함.</p>', '결과 보고 hwp 양식 제출', 'open', '2026-09-23', '제출물'),
    (p_id, s_issues, '2차 기획 모니터링 계획안 송부 (실물구매·감정 포함)',
     '<p>건강·안전 품목(건강기능식품·화장품·유아동), 브랜드 20개 우선 선정. 선정 기준 / 모니터링·실물구매·감정 방법 / 세부 일정 포함. 기간 10.6~10.23.</p>', '2차 계획안 9/23', 'open', '2026-09-23', '제출물'),
    (p_id, s_issues, '9월 2차(최종) 실적 파일 제출 — 기획 실적 별도 폴더',
     '<p>중복 검사(9/22) 후 전체 실적 / 플랫폼별 신고 / (기획) 폴더로 구분해 두레이 업로드.</p>', '9월 최종 실적 제출', 'open', '2026-09-23', '실적'),
    (p_id, s_issues, '카카오스토리 위임장 양식 보완 요청 (KOIPA 측 미회신)',
     '<p>9/8 12:14 발송 양식대로 요청했으나 미보완 (9/11). 보완 전까지 카카오스토리 신고는 K 소관.</p>', '카카오 위임장 보완', 'open', null, '서류'),
    (p_id, s_issues, '비정기 모니터링 대상 브랜드 리스트 송부',
     '<p>밴드·SNS 모니터링 중 계정에서 참여 브랜드 외 상품이 확인되는 브랜드 리스트 작성 → KOIPA 송부. 시스템 등록에는 브랜드 확정 필요 (9/11 회신).</p>', '비정기 브랜드 리스트', 'open', null, '비정기'),
    (p_id, s_issues, 'OEM 공장 제품 게시물 추가 근거자료 확보',
     '<p>동일 OEM 공장 사용 제품은 판매자 소명 가능성 대비 근거자료 보강 (9/14 KOIPA 요청, 당사 확보 예정 회신).</p>', 'OEM 근거자료', 'in_progress', null, '증거'),
    (p_id, s_issues, '9월 1차 건 품목 분류 오기재 점검',
     '<p>8월 건은 9/17 매핑 반영본 송부 완료. 9월 1차 건도 동일 간이 양식(관리번호·기존 품목·변경 품목)으로 점검 후 오기재 있으면 회신.</p>', '9월 품목 점검', 'in_progress', null, '보완'),
    (p_id, s_issues, '8월 실적 품목 분류 수정본 송부',
     '<p>9/15 요청 → 9/15 1차 회신 → 9/17 KOIPA 매핑 반영본(8월_품목_변경내역_KOIPA매핑반영_260917.xlsx) 송부 완료.</p>', '8월 품목 수정 완료', 'done', '2026-09-15', '보완'),
    (p_id, s_issues, 'SHEIN(쉬인) 모니터링 가능 여부 회신',
     '<p>9/15 KOIPA 긴급 문의 → 현재 미모니터링, 필요 시 시스템 개발 필요로 회신 완료.</p>', '쉬인 회신 완료', 'done', '2026-09-15', '문의');

  -- 저작권 트랙 초기 기록
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, period_month, category) values
    (p_id, s_copy, '9월 저작권 모니터링 — 스키주 중심 30건 + 추가 50건 송부',
     '<p>9/10 두레이 "9월 1차"에 스키주 중심 리스트 업로드 → KOIPA 담당자 검토 "내용 이상 없음, 권리자 확인 진행". 관리번호는 공란(KOIPA 부여). 9/15 추가 50건 송부 완료.</p><p>이후 방향: 식별정보 확보 가능한 타 국내 브랜드 발굴해 대상 확대.</p>',
     '9월 스키주 30건 + 50건 송부. 관리번호 KOIPA 부여.', '2026-09-01', '송부');

  -- 월별 실적 게시판 초기 기록
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, period_month, category) values
    (p_id, s_monthly, '8월 실적 마감 경위 (9/4~9/7)',
     '<p>9/4 지재처 실적 발송 필요로 KOIPA 가 <strong>확정 플랫폼 4개만 8월 실적 인정</strong>, 나머지는 보완·검수 후 9월 편입 결정. 9/7 최종 마감 — 누적 달성률 <strong>12.91%</strong>. 차단 미완료 건은 9월 이관.</p><p>대용량 실적 파일은 플랫폼별(밴드는 계정별) 분할 업로드 협의.</p>',
     '8월 마감: 확정 4개 플랫폼만 인정, 나머지 9월 편입. 누적 12.91%.', '2026-08-01', '마감'),
    (p_id, s_monthly, '9월 1차 실적 보고 (9/10) → 위임장 반영 업데이트 (9/11)',
     '<p>9/10 1차 보고 합계 13,071 → 위임장 서명 완료 기업 반영해 <strong>13,061 (K 6,115 / M 6,946)</strong>. 아디다스 밴드 = 서류 미비로 K 처리, 알리·테무 = 전체 증거 확보 건만(10건 감소).</p><p>KOIPA 회신(9/14): 대부분 차단 실적 포함 가능. OEM 제품 근거 보강 요청.</p>',
     '9월 1차 13,061 (K 6,115 / M 6,946).', '2026-09-01', '보고');

  -- 기획 1차 기록
  insert into public.project_posts (project_id, section_id, title, body_html, body_text, campaign_id, category) values
    (p_id, s_camp, '1차 기획 모니터링 착수 (9/14)',
     '<p>기존 계획안대로 9/14(월)~9/21(월) 1주간 진행. 권리자 확인 필요 건은 KOIPA 가 별도 요청 예정, 보호원 직접 차단 필요 건은 9/23 까지 송부.</p>',
     '1차 기획 착수 9/14~9/21', c1, '진행');

  -- 자료실 & 연락처
  insert into public.project_resources (project_id, kind, label, url, org, role, email, phone, note, group_label, sort_order) values
    (p_id, 'link', '두레이 공유 드라이브 (KOIPA) — 실적 파일 / 브랜드사 제출자료 / 중복 건수 검사', 'https://koipa.gov-dooray.com', null, null, null, null, '월별 폴더(9월 1차 등) + 브랜드사 제출자료(권리위임장) + 중복 건수 검사 폴더', '외부 드라이브', 0),
    (p_id, 'link', '프로젝트 공용 메일함 koipa@myriadip.com', 'https://mail.google.com', null, null, null, null, 'KOIPA 발신 메일 전부 CC 됨', '외부 드라이브', 1),
    (p_id, 'contact', '박유탁', null, 'KOIPA 상표부정경쟁조사실', '팀장 (3급)', 'ytpark@koipa.re.kr', '02-2183-5822 / 010-4525-9239', '통계 관리·실적표 총괄', 'KOIPA', 10),
    (p_id, 'contact', '이예진', null, 'KOIPA 상표부정경쟁조사실', '전임', 'qwerwlsfl@koipa.re.kr', '02-2183-5832', '사업 실무 총괄 창구 — 실적·기획·저작권·보완 요청', 'KOIPA', 11),
    (p_id, 'contact', '김지희', null, 'KOIPA 상표부정경쟁조사실', '주임 (6급)', 'jihee@koipa.re.kr', '02-2183-5829', '브랜드사 서류(위임장·사업자등록증) 취합', 'KOIPA', 12),
    (p_id, 'contact', '상표부정경쟁조사실 공용', null, 'KOIPA', '공용 메일', 'aibrand@koipa.re.kr', null, 'KACC 안내·모집 공문 발신', 'KOIPA', 13),
    (p_id, 'contact', '손현정 (Niki)', null, 'Myriad IP 브랜드보호 그룹', '그룹장', 'niki@myriadip.com', '02-2138-8043', 'KOIPA 대응 총괄', 'Myriad', 20),
    (p_id, 'contact', '홍지영 (Skylar)', null, 'Myriad IP 디지털브랜드보호팀', '팀장', 'skylar@myriadip.com', '02-2138-8037', '신고 서류·모니터링 실무', 'Myriad', 21),
    (p_id, 'contact', '김민주 (Bella)', null, 'Myriad IP 경영지원팀', '파트장', 'bella@myriadip.com', null, '선금·보증보험·계약 행정', 'Myriad', 22);

  insert into public.project_resources (project_id, kind, label, note, group_label, sort_order) values
    (p_id, 'file', '(참고) 온라인 모니터링 품목 분류표_260528.hwp', 'KOIPA 품목 분류 기준표 — 9/15 재송부. 원본은 메일 첨부에서 업로드 필요.', '양식·기준', 30),
    (p_id, 'file', '[붙임] 제1차 기획 모니터링 결과 보고 양식_260915.hwp', '9/23 제출용. 원본은 메일 첨부에서 업로드 필요.', '양식·기준', 31),
    (p_id, 'file', '위임장 예시_권리자-참여기업.docx', '본사(상표권리자)→참여기업 위임 확인 서류 참고 양식 (9/8 송부본).', '양식·기준', 32),
    (p_id, 'file', '신고서류 요청.xlsx', '추가 신고에 필요한 서류 목록 (9/8 송부본).', '양식·기준', 33),
    (p_id, 'file', 'KOIPA_AI모니터링_실적표 양식.xlsx', '월별 1차/2차 보고용 실적표 (구분·플랫폼 15개·보호원/미리어드/소계).', '양식·기준', 34);
end $$;
