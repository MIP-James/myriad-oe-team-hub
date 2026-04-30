-- =====================================================================
-- Phase 16 — Launcher 인증 모델 교체 (Supabase session → device-bound API token)
--
-- 배경: launcher 가 Supabase 의 refresh_token rotation chain 위에서 동작했는데,
-- 데몬 환경 (sleep/wake/네트워크 블립/리부팅) 이 reuse detection 을 자주 트리거해서
-- 매일 토큰이 깨짐. gotcha #12-A~D 까지 4번의 race 픽스를 했지만 새 race 가
-- 끊임없이 나타나서 근본 해결 위해 인증 모델 자체 교체.
--
-- 새 모델:
--   1. 사용자가 웹 허브 /launcher 페이지에서 "토큰 발급" 클릭
--   2. Cloudflare Function 이 random opaque 토큰 생성 → sha256 해시만 DB 저장
--   3. plain 토큰 1회만 사용자에게 표시 → setup 마법사에 paste
--   4. launcher 는 모든 API 호출에 Authorization: Bearer <token> 헤더만 사용
--   5. refresh / rotation 자체가 없음 → race condition 자체가 발생 불가능
--
-- 사용 endpoints (functions/api/launcher-*.js):
--   - launcher-issue-token  — 웹 세션 인증으로 토큰 발급
--   - launcher-poll         — 폴링 (jobs fetch + 최초 pairing)
--   - launcher-heartbeat    — 30초 주기 ping
--   - launcher-job-update   — 작업 상태/출력 갱신
--   - launcher-utility-fetch — 유틸 메타 조회 (자동 설치용)
-- =====================================================================

create table if not exists public.launcher_device_tokens (
  id uuid primary key default gen_random_uuid(),
  -- sha256 hex of opaque token. plain 토큰은 절대 DB 에 저장 안 함.
  -- 발급 시 1회만 사용자에게 노출 후 분실 시 재발급 (revoke + 새로 발급).
  token_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 첫 poll/heartbeat 호출 시 자동 생성/링크. NULL 이면 아직 launcher 가
  -- 시작되지 않은 갓 발급된 토큰.
  device_id uuid references public.launcher_devices(id) on delete set null,
  -- 사용자 입력 친근한 이름 (예: "James 노트북"). device_id 가 NULL 인 시점에도
  -- 어떤 토큰인지 식별 가능하게 보존.
  name text not null default 'Unnamed',
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_launcher_tokens_user
  on public.launcher_device_tokens(user_id, revoked_at)
  where revoked_at is null;

create index if not exists idx_launcher_tokens_hash
  on public.launcher_device_tokens(token_hash)
  where revoked_at is null;

-- RLS — 사용자는 본인 토큰 메타만 조회/revoke 가능.
-- INSERT 는 service_role 만 (Cloudflare Function /api/launcher-issue-token).
-- token_hash 는 RLS 통과한 사용자도 절대 보면 안 되는 값이라 SELECT 시
-- 클라이언트에서 명시적으로 select 컬럼 지정 (token_hash 제외).
alter table public.launcher_device_tokens enable row level security;

drop policy if exists launcher_tokens_select_own on public.launcher_device_tokens;
create policy launcher_tokens_select_own on public.launcher_device_tokens
  for select using (auth.uid() = user_id);

-- 본인 토큰 revoke (UPDATE revoked_at) 만 허용.
-- token_hash 변경은 차단 (USING + WITH CHECK 둘 다 user_id 매칭만 보고
-- 컬럼 변경은 BEFORE UPDATE 트리거로 차단).
drop policy if exists launcher_tokens_revoke_own on public.launcher_device_tokens;
create policy launcher_tokens_revoke_own on public.launcher_device_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- token_hash 가 한번 발급되면 변경 불가 — 사용자가 RLS UPDATE 로 위변조하는
-- 것 차단. service_role 도 마찬가지 (어차피 변경할 일 없음).
create or replace function public.tg_launcher_token_immutable()
returns trigger language plpgsql as $$
begin
  if old.token_hash is distinct from new.token_hash then
    raise exception 'launcher_device_tokens.token_hash 는 immutable';
  end if;
  if old.user_id is distinct from new.user_id then
    raise exception 'launcher_device_tokens.user_id 는 immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_launcher_token_immutable on public.launcher_device_tokens;
create trigger trg_launcher_token_immutable
  before update on public.launcher_device_tokens
  for each row execute function public.tg_launcher_token_immutable();

-- updated_at trigger 는 없음 — 토큰 메타는 last_used_at / revoked_at 만 변경됨.

-- ⚠️ 마이그레이션 후 작업:
-- 1. Cloudflare Pages 환경변수 LAUNCHER_TOKEN_PREFIX = 'myrlnch_' 추가 (옵션, 코드에 하드코딩됨)
-- 2. 기존 사용자(3명) 는 웹 허브 /launcher 에서 새 토큰 발급 + setup 재실행 1회 필요.
--    기존 launcher_devices row 는 그대로 유지 (device_id 가 새 토큰에 link 됨).
-- 3. 기존 supabase 세션 기반 launcher 는 더 이상 작동 안 함 (의도된 break).
