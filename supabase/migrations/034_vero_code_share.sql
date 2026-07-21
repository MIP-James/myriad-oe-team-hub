-- =====================================================================
-- Phase 20 — eBay VeRO 포털 인증코드 팀 공유
--
-- 배경:
--   VeRO 계정이 james@myriadip.com 로 되어 있어, 팀원이 VeRO 로그인 시도 시
--   인증코드(10분 만료)가 James 님 메일함으로만 옴. 팀원이 그 코드를 받아
--   입력해야 하는데 현재는 James 님에게 매번 물어봐야 함.
--
--   → 서버가 James 님 Gmail 을 대신 읽어(기존 Inbound reader 인프라 재사용)
--     최신 VeRO 코드를 팀허브 페이지에 노출. 온디맨드(버튼 클릭 시에만 조회)라
--     상시 폴링 없음 → Cloudflare 한도 무영향.
--
-- 이 마이그레이션이 하는 일:
--   (1) inbound_reader_tokens 에 purpose 컬럼 추가 ('case' | 'vero')
--       - 기존 Inbound 은 "단일 reader" 정책이라 새 reader 연동 시 기존(skylar)
--         reader 를 비활성화함. VeRO reader(James) 를 같은 테이블에 넣되 purpose 로
--         구분해 서로 간섭 없이 공존시킴.
--       - 케이스 폴러(inbound-poll.js)는 purpose='case' 만, VeRO 함수는 'vero' 만 읽음.
--   (2) vero_lock — "한 번에 한 명" 소프트 락 (동시 로그인 시 코드 혼선 방지).
--       단일 행(id=1) + 10분 자동 만료. claim/release 는 RPC 로 원자적 처리.
--
-- ⚠️ (1)은 기존 테이블 컬럼 추가 → GRANT/RLS 는 mig 029 설정 상속(추가 GRANT 불필요).
--    (2)는 신규 테이블 → mig 032+ 표준 GRANT 패턴 적용.
-- =====================================================================

-- ── (1) reader 용도 구분 ────────────────────────────────────────────
alter table public.inbound_reader_tokens
  add column if not exists purpose text not null default 'case';
-- 기존 skylar 행은 default 'case' 로 자동 세팅 → 케이스 폴링 그대로 유지.

comment on column public.inbound_reader_tokens.purpose is
  'case = 신고메일 자동 케이스화 reader(skylar) / vero = VeRO 인증코드 조회 reader(james). 폴러/조회 함수가 서로 안 건드리도록 분리.';

-- ── (2) VeRO 소프트 락 ──────────────────────────────────────────────
create table if not exists public.vero_lock (
  id          smallint primary key default 1,
  holder_id   uuid,
  holder_name text,
  holder_email text,
  started_at  timestamptz,
  expires_at  timestamptz,
  constraint vero_lock_singleton check (id = 1)
);
-- 단일 행 보장 — 없으면 삽입
insert into public.vero_lock (id) values (1) on conflict (id) do nothing;

alter table public.vero_lock enable row level security;

-- 팀원(로그인 인증됨) 누구나 현재 락 상태 조회 가능
drop policy if exists "vero_lock_select" on public.vero_lock;
create policy "vero_lock_select" on public.vero_lock
  for select to authenticated using (true);
-- 직접 UPDATE 는 막고, claim/release RPC(security definer)로만 변경 → 조건부 원자성 보장

grant select on public.vero_lock to anon;
grant select on public.vero_lock to authenticated;
grant select, insert, update, delete on public.vero_lock to service_role;

-- 락 점유 — 비어있거나(holder null) 만료됐거나(expires_at 지남) 강제(force)일 때만 성공.
-- 성공/실패 무관하게 현재 락 행을 반환 → 클라이언트가 holder_id 로 성공 여부 판단.
create or replace function public.claim_vero_lock(
  p_name text,
  p_email text,
  p_force boolean default false
)
returns public.vero_lock
language plpgsql
security definer
set search_path = public
as $$
declare
  r public.vero_lock;
begin
  update public.vero_lock
     set holder_id    = auth.uid(),
         holder_name  = p_name,
         holder_email = p_email,
         started_at   = now(),
         expires_at   = now() + interval '10 minutes'
   where id = 1
     and (p_force or holder_id is null or expires_at < now())
  returning * into r;

  if not found then
    select * into r from public.vero_lock where id = 1;
  end if;
  return r;
end;
$$;

-- 락 해제 — 현재 점유자 본인만 해제 가능
create or replace function public.release_vero_lock()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.vero_lock
     set holder_id = null, holder_name = null, holder_email = null,
         started_at = null, expires_at = null
   where id = 1 and holder_id = auth.uid();
end;
$$;

grant execute on function public.claim_vero_lock(text, text, boolean) to authenticated;
grant execute on function public.release_vero_lock() to authenticated;

-- 실시간 — 락 상태 변경을 열려있는 모든 페이지에 브로드캐스트("누가 사용 중" 라이브)
do $$
begin
  alter publication supabase_realtime add table public.vero_lock;
exception
  when duplicate_object then null;  -- 이미 추가돼 있으면 무시
end $$;
