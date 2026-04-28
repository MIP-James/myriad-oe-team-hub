-- =====================================================================
-- MYRIAD Team Hub - Phase 14b 마이그레이션 (2026-04-28)
-- 노션 OAuth 연동 — 사용자별 노션 access_token 보관
--
-- 배경:
--   기존 Internal Integration 1개로 모든 보고서를 API 생성하면 Created By
--   가 봇 이름(`Myriad Team Hub`)으로 찍힘. 이를 해결하려면 사용자가 본인
--   노션 계정으로 OAuth 동의하고, 본인 토큰으로 API 호출해야 Created By
--   = 실제 본인이 됨.
--
-- 설계:
--   - 1 user : 1 row (PK = user_id) — 한 사용자가 여러 워크스페이스 연결
--     하는 케이스는 1차 범위 외
--   - access_token 은 **노션 OAuth 토큰** (만료 없음). 평문 저장하되 RLS
--     로 본인만 read/write. 추후 강화 옵션: pgcrypto 로 암호화.
--   - 토큰을 본인이 직접 노션에서 무효화하면 우리는 알 길 없음. 보고서
--     생성 시 401 응답 받으면 row 삭제 + 재연결 안내.
-- =====================================================================

create table if not exists public.notion_connections (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  access_token   text not null,
  workspace_id   text,
  workspace_name text,
  workspace_icon text,
  bot_id         text,
  owner          jsonb,        -- 노션 응답의 owner 객체 그대로 (사용자 정보 포함)
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_notion_connections_updated on public.notion_connections;
create trigger trg_notion_connections_updated before update on public.notion_connections
  for each row execute function public.tg_set_updated_at();


-- ---- RLS — 본인만 ----
alter table public.notion_connections enable row level security;

drop policy if exists notion_connections_self on public.notion_connections;
create policy notion_connections_self on public.notion_connections
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- 메모: service role 키로 호출 시 RLS 우회됨 (Pages Function 의 callback
-- 처리 시 토큰 저장은 service role 키로 진행).
