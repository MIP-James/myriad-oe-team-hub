-- =====================================================================
-- Phase 18 — 재침해자 타겟 보드 (Repeat Infringer Target Board)
--
-- 어제 만든 repeat-infringer-scoring 스킬(2축 스코어링)을 Team Hub 내장
-- 페이지로 승격. BPM 데이터를 주기적으로 SQL 조회 → 점수 계산 → 아래 표에 적재.
-- /targets 페이지가 이 표를 읽어 2×2 매트릭스 + 등급 리스트로 표시.
--
-- 점수 계산은 functions/api/_lib/scoreEngine.js (score2axis.py 이식) 가 담당.
-- DB 연동 전까지는 functions/api/_lib/mockBpm.js 가 BPM 자리를 대신함.
--
-- ⚠️ 2026-10-30 Supabase Data API 정책 — 신규 테이블 명시 GRANT 필수 (gotcha #36).
--    단 이 데이터는 침해자 신상(PII) 포함 → anon select 는 의도적으로 제외.
-- =====================================================================

-- 1) infringer_targets — 운영자(클러스터) 단위 최신 스코어 (1 row = 1 운영자)
create table if not exists public.infringer_targets (
  cluster_key text primary key,                 -- 신원 기반 안정 해시 (재실행해도 동일 운영자=동일 키)
  rep_store text,
  rep_company text,
  rep_president text,
  platforms text,                               -- '스마트스토어, 쿠팡' 식 표시용
  brands text[] default '{}',                   -- 엮인 대표 고객사(브랜드) 목록
  brand_count int not null default 1,
  cross_brand boolean not null default false,   -- 교차 브랜드 연쇄 침해 (2개 이상 브랜드)
  account_count int not null default 1,
  deleted_sum int not null default 0,
  cumulative_max int not null default 0,
  first_date date,
  last_date date,
  recency_months int,
  identified boolean not null default false,     -- 사업자/대표자/전화 중 하나라도 있으면 true
  link_online int not null default 0,
  customs int not null default 0,
  raid int not null default 0,
  legal int not null default 0,
  has_legal_pipeline boolean not null default false,  -- 이미 법무 진행중 (target 승인일 존재)
  is_big boolean not null default false,         -- 대형유통/샵인샵 (X등급)
  enf_score numeric(5,1) not null default 0,     -- 축1: 법적 타겟 점수
  yield_score numeric(5,1) not null default 0,   -- 축2: 모니터링 생산성 점수
  grade text not null default 'D' check (grade in ('A','B','C','D','X')),
  prev_grade text check (prev_grade in ('A','B','C','D','X')),  -- 지난 스냅샷 등급 (승급/강등 표시)
  trend text not null default 'unknown' check (trend in ('surge','steady','decline','unknown')),
  trend_pct int,
  detail jsonb not null default '{}'::jsonb,      -- 계정 목록 / 증거 케이스 / 일별 시계열
  -- 액션 워크플로우 (원클릭 케이스 전환)
  status text not null default 'new' check (status in ('new','watching','in_review','cased','dismissed')),
  converted_case_id uuid,                         -- 케이스로 전환했을 때 cases.id
  assigned_to uuid references auth.users(id) on delete set null,
  scored_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_targets_grade on public.infringer_targets(grade);
create index if not exists idx_targets_enf on public.infringer_targets(enf_score desc);
create index if not exists idx_targets_yield on public.infringer_targets(yield_score desc);
create index if not exists idx_targets_cross on public.infringer_targets(cross_brand) where cross_brand;

-- 2) target_score_snapshots — 월간 스냅샷 (등급 변동 추적용)
create table if not exists public.target_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_ymd date not null,
  cluster_key text not null,
  grade text not null,
  enf_score numeric(5,1) not null default 0,
  yield_score numeric(5,1) not null default 0,
  created_at timestamptz not null default now(),
  unique (snapshot_ymd, cluster_key)
);

create index if not exists idx_snapshots_key on public.target_score_snapshots(cluster_key, snapshot_ymd desc);

-- ── RLS ────────────────────────────────────────────────────────────
alter table public.infringer_targets enable row level security;
alter table public.target_score_snapshots enable row level security;

-- 로그인 팀원은 전체 조회 가능. 상태 변경(케이스 전환/담당 배정)도 가능.
-- 적재(INSERT)/삭제는 service_role(동기화 함수)만.
drop policy if exists targets_select on public.infringer_targets;
create policy targets_select on public.infringer_targets
  for select to authenticated using (true);

drop policy if exists targets_update on public.infringer_targets;
create policy targets_update on public.infringer_targets
  for update to authenticated using (true) with check (true);

drop policy if exists snapshots_select on public.target_score_snapshots;
create policy snapshots_select on public.target_score_snapshots
  for select to authenticated using (true);

-- ── GRANT (anon 제외 — PII 보호) ────────────────────────────────────
grant select, update on public.infringer_targets to authenticated;
grant select, insert, update, delete on public.infringer_targets to service_role;

grant select on public.target_score_snapshots to authenticated;
grant select, insert, update, delete on public.target_score_snapshots to service_role;
