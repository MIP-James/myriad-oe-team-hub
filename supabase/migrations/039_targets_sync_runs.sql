-- ============================================================
-- 039 재침해자 타겟 보드 — 동기화 실행 기록 (BPM 실데이터 연동)
-- ============================================================
-- BPM 실데이터는 PC 주 1회 스크립트(scripts/targets-bpm-sync.mjs)가 반영하고,
-- 웹 "지금 갱신"(functions/api/targets-sync.js)은 샘플 데이터 전용이 됐다.
-- 이 표에 source='bpm' 기록이 있으면 웹 함수가 샘플로 덮어쓰지 않도록 거절한다.
-- 페이지는 마지막 실행(출처·시각·건수)을 읽어 상단에 표시.
--
-- 쓰기는 service role(PC 스크립트·함수)만. mig 032+ 표준 GRANT 패턴 적용.
-- ============================================================

create table if not exists public.targets_sync_runs (
  id      bigserial primary key,
  source  text not null check (source in ('mock', 'bpm')),
  ran_at  timestamptz not null default now(),
  brands  jsonb,          -- [{ clientId, name, listings }]  (bpm 전용)
  stats   jsonb           -- 엔진 stats + 변환 stats
);

create index if not exists idx_targets_sync_runs_ran_at on public.targets_sync_runs(ran_at desc);

alter table public.targets_sync_runs enable row level security;

create policy targets_sync_runs_select on public.targets_sync_runs
  for select to authenticated using (true);

-- ── GRANT (2026-10-30 Data API 정책 대응 표준 패턴) ───────────────────
grant select on public.targets_sync_runs to anon;
grant select, insert, update, delete on public.targets_sync_runs to authenticated;
grant select, insert, update, delete on public.targets_sync_runs to service_role;
grant usage, select on sequence public.targets_sync_runs_id_seq to authenticated, service_role;
