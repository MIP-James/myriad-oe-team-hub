-- =====================================================================
-- Phase 24 — 공용 PC 원격 접속 (사용 현황 + .rdp 원클릭 접속)
--
-- 취지:
--   팀 공용 노트북(Win11 Pro) 에 실무자들이 원격 데스크톱(RDP)으로 접속해 업무.
--   Win11 Pro RDP 는 화면 1명만 가능(접속 시 기존 사람 화면이 끊김, 작업은 유지)
--   → "지금 누가 쓰는지" 를 허브에서 보여주고, 실수로 남의 화면을 뺏지 않게 함.
--
-- 흐름:
--   공용 PC 의 런처 에이전트(--shared-pc-agent, SYSTEM 예약 작업) 가 30초마다
--   WTS API 로 세션 확인 → 변경 시(+15분 keepalive) /api/shared-pc-report 로 보고
--   → shared_pcs.sessions 갱신 → 허브 대시보드 위젯 Realtime 반영.
--   [원격 접속] = 웹이 .rdp 파일 생성(최신 IP + 본인 윈도우 계정명).
--
-- 테이블 2종:
--   shared_pcs          — 공용 PC 마스터 + 최신 세션 스냅샷 (보고는 service role 만)
--   shared_pc_accounts  — 윈도우 계정명 ↔ 허브 사용자 매핑 (위젯 표시명 / .rdp 계정명)
--
-- mig 032+ 표준 GRANT 패턴 적용.
-- =====================================================================

create table if not exists public.shared_pcs (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- 표시명 (예: '공용 노트북')
  hostname     text not null unique,          -- 컴퓨터 이름, 대문자 저장 (예: 'LAPTOP-L8MT52HI')
  lan_ip       text,                          -- 에이전트가 보고한 사내 IP (DHCP 변동 대응)
  -- [{ win_user, state: 'active'|'disconnected', via: 'rdp'|'console',
  --    connected_at, disconnected_at, logon_at }]
  sessions     jsonb not null default '[]'::jsonb,
  reported_at  timestamptz,                   -- 마지막 보고 시각 (오래되면 '확인 불가')
  agent_version text,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);
comment on table public.shared_pcs is '공용 PC (원격 데스크톱 접속 대상) + 에이전트가 보고한 최신 세션 상태.';

create table if not exists public.shared_pc_accounts (
  id                uuid primary key default gen_random_uuid(),
  pc_id             uuid not null references public.shared_pcs(id) on delete cascade,
  windows_username  text not null,            -- 공용 PC 의 로컬 계정명 (예: 'kim')
  user_id           uuid not null references auth.users(id) on delete cascade,
  created_at        timestamptz not null default now(),
  unique (pc_id, user_id)
);
create unique index if not exists uq_shared_pc_accounts_winuser
  on public.shared_pc_accounts (pc_id, lower(windows_username));
comment on table public.shared_pc_accounts is '공용 PC 윈도우 계정 ↔ 허브 사용자 매핑.';

-- ── RLS ─────────────────────────────────────────────────────────────
alter table public.shared_pcs enable row level security;
alter table public.shared_pc_accounts enable row level security;

drop policy if exists shared_pcs_select on public.shared_pcs;
create policy shared_pcs_select on public.shared_pcs
  for select to authenticated using (true);
drop policy if exists shared_pcs_admin_write on public.shared_pcs;
create policy shared_pcs_admin_write on public.shared_pcs
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists shared_pc_accounts_select on public.shared_pc_accounts;
create policy shared_pc_accounts_select on public.shared_pc_accounts
  for select to authenticated using (true);
drop policy if exists shared_pc_accounts_admin_write on public.shared_pc_accounts;
create policy shared_pc_accounts_admin_write on public.shared_pc_accounts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── GRANT (2026-10-30 Data API 정책 대응 표준 패턴) ───────────────────
grant select on public.shared_pcs to anon;
grant select, insert, update, delete on public.shared_pcs to authenticated;
grant select, insert, update, delete on public.shared_pcs to service_role;

grant select on public.shared_pc_accounts to anon;
grant select, insert, update, delete on public.shared_pc_accounts to authenticated;
grant select, insert, update, delete on public.shared_pc_accounts to service_role;

-- ── Realtime (위젯 즉시 반영) ─────────────────────────────────────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shared_pcs'
  ) then
    alter publication supabase_realtime add table public.shared_pcs;
  end if;
end $$;

-- ── 시드: 팀 공용 노트북 ──────────────────────────────────────────────
insert into public.shared_pcs (name, hostname)
values ('공용 노트북', 'LAPTOP-L8MT52HI')
on conflict (hostname) do nothing;
