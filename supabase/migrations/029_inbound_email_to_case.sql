-- =====================================================================
-- MYRIAD Team Hub - Phase 15 마이그레이션 (2026-04-29)
-- Inbound Gmail → 케이스 자동 등록 (Cases Inbound 자동화)
--
-- 배경:
--   국내 고객사 신고 메일 (코오롱/삼성물산/TBH 등) 이 대부분 팀 리더 skylar
--   를 참조/수신인으로 cc → 그 inbox 1개를 시스템이 24/7 polling 해서
--   자동 케이스 생성. 매 inbound 케이스마다 수동 등록하던 마찰 제거.
--
-- 분류 시그널 (정확도 순):
--   1. 보낸이 이메일 정확 매칭 (sender_emails)
--   2. 보낸이 도메인 매칭 (sender_domains)
--   3. 그룹 메일 To/CC 매칭 (to_patterns) — 보조
--   4. Re:/Fwd: 회신 처리 — gmail thread_id 로 기존 케이스 매칭
--   5. 키워드 매칭 — 위 1~3 통과 + 키워드 매칭 둘 다 필수 (옵션 B)
--
-- 테이블:
--   - inbound_reader_tokens — skylar OAuth refresh_token 영구 저장
--   - inbound_mappings — 브랜드별 매칭 룰
--   - inbound_keywords — 전역 키워드
--   - inbound_processed_messages — Gmail message ID 중복 방지
--
-- cases.source 컬럼 추가 — 'manual' | 'inbound_email' | 'gmail_import'
-- =====================================================================

-- ── cases.source 컬럼 추가 ────────────────────────────────
alter table public.cases
  add column if not exists source text not null default 'manual';

create index if not exists idx_cases_source on public.cases(source);

-- 'inbound_email' 케이스만 빠르게 필터링 위한 복합 인덱스
create index if not exists idx_cases_source_created_at
  on public.cases(source, created_at desc) where source = 'inbound_email';

-- ── inbound_reader_tokens ────────────────────────────────
-- skylar (또는 추후 다른 reader) 의 Google OAuth refresh_token 영구 보관.
-- Cloudflare Cron Worker 가 이 토큰으로 access_token 갱신 + Gmail polling.
create table if not exists public.inbound_reader_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,                     -- 'skylar@myriadip.com' 등 reader 본인 메일 (확인용)
  access_token text,                       -- 1시간 유효, 만료 시 refresh
  refresh_token text not null,             -- 영구 (사실상)
  expires_at timestamptz,                  -- access_token 만료 시각
  scope text,                              -- 부여받은 scope (gmail.readonly)
  is_active boolean not null default true, -- 일시 정지 토글
  last_polled_at timestamptz,              -- 마지막 polling 시각
  last_poll_status text,                   -- 'ok' | 'token_expired' | 'api_error' | 'no_active_mappings'
  last_poll_error text,                    -- 실패 시 에러 메시지 (truncated)
  last_poll_count int not null default 0,  -- 마지막 polling 에서 처리한 메일 수
  total_processed_count int not null default 0,  -- 누적 처리 건수
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inbound_reader_tokens_active
  on public.inbound_reader_tokens(is_active, last_polled_at);

-- ── inbound_mappings ────────────────────────────────────
-- 브랜드별 매칭 룰. 발신자 이메일 정확 매칭 + 도메인 매칭 + 그룹메일 매칭 다중 지원.
-- assignee 는 public.profiles 참조 (PostgREST 자동 join 가능 + profiles.id = auth.users.id 1:1)
create table if not exists public.inbound_mappings (
  id uuid primary key default gen_random_uuid(),
  brand text not null,                              -- '코오롱' / '삼성물산' / 'TBH'
  sender_emails text[] not null default '{}',       -- ['you7217@kolon.com'] 정확 매칭
  sender_domains text[] not null default '{}',      -- ['tbhglobal.co.kr'] 도메인 매칭
  to_patterns text[] not null default '{}',         -- ['kolon@myriadip.com'] To/CC 매칭 (보조)
  default_assignee_id uuid references public.profiles(id) on delete set null,    -- 실무 처리자
  secondary_assignee_id uuid references public.profiles(id) on delete set null,  -- 백업/리더
  require_keyword_match boolean not null default true,  -- 키워드 매칭 필수 (옵션 B)
  priority int not null default 100,                -- 다중 매칭 시 우선순위 (낮은 숫자 우선)
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_inbound_mappings_active
  on public.inbound_mappings(is_active, priority);

-- 발신자 이메일/도메인 GIN 인덱스 (text[] 검색 빠르게)
create index if not exists idx_inbound_mappings_sender_emails
  on public.inbound_mappings using gin(sender_emails);
create index if not exists idx_inbound_mappings_sender_domains
  on public.inbound_mappings using gin(sender_domains);

-- ── inbound_keywords ────────────────────────────────────
-- 시스템 전역 키워드. 운영하면서 추가/제거.
create table if not exists public.inbound_keywords (
  id uuid primary key default gen_random_uuid(),
  keyword text unique not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- 시드 — 2026-04-29 skylar 확정 11개
insert into public.inbound_keywords (keyword) values
  ('모니터링 요청'),
  ('검수 요청'),
  ('삭제 요청'),
  ('가격 검수'),
  ('도용 신고'),
  ('이미지 도용'),
  ('신고의 건'),
  ('제보의 건'),
  ('조치 요청'),
  ('단속 요청'),
  ('신고 접수')
on conflict (keyword) do nothing;

-- ── inbound_processed_messages ──────────────────────────
-- Gmail message ID 중복 방지 + 회신 thread 매칭용.
create table if not exists public.inbound_processed_messages (
  message_id text primary key,                -- Gmail message ID
  thread_id text,                             -- Gmail thread ID (회신 매칭용)
  case_id uuid references public.cases(id) on delete set null,
  brand text,                                 -- 매칭된 브랜드 (감사용)
  matched_mapping_id uuid references public.inbound_mappings(id) on delete set null,
  match_reason text,                          -- 'sender_email' | 'sender_domain' | 'to_pattern' | 'thread_match' | 'skipped'
  received_at timestamptz,                    -- Gmail 메일 수신 시각
  processed_at timestamptz not null default now()
);

create index if not exists idx_inbound_processed_thread
  on public.inbound_processed_messages(thread_id);
create index if not exists idx_inbound_processed_at
  on public.inbound_processed_messages(processed_at desc);

-- ── RLS ────────────────────────────────────────────────
-- 모두 관리자만 읽기/쓰기 (개인정보/토큰 보호).
alter table public.inbound_reader_tokens enable row level security;
alter table public.inbound_mappings enable row level security;
alter table public.inbound_keywords enable row level security;
alter table public.inbound_processed_messages enable row level security;

-- inbound_reader_tokens: 본인 행은 본인이 (등록/회수), 관리자는 전체
drop policy if exists inbound_reader_tokens_self_or_admin on public.inbound_reader_tokens;
create policy inbound_reader_tokens_self_or_admin on public.inbound_reader_tokens
  for all using (
    auth.uid() = user_id or public.is_admin()
  ) with check (
    auth.uid() = user_id or public.is_admin()
  );

-- inbound_mappings: 관리자만
drop policy if exists inbound_mappings_admin on public.inbound_mappings;
create policy inbound_mappings_admin on public.inbound_mappings
  for all using (public.is_admin()) with check (public.is_admin());

-- inbound_keywords: 관리자만
drop policy if exists inbound_keywords_admin on public.inbound_keywords;
create policy inbound_keywords_admin on public.inbound_keywords
  for all using (public.is_admin()) with check (public.is_admin());

-- inbound_processed_messages: 관리자만 (감사 로그)
drop policy if exists inbound_processed_messages_admin on public.inbound_processed_messages;
create policy inbound_processed_messages_admin on public.inbound_processed_messages
  for all using (public.is_admin()) with check (public.is_admin());

-- ── updated_at 자동 갱신 트리거 ────────────────────────
create or replace function public.tg_inbound_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_inbound_reader_tokens_updated on public.inbound_reader_tokens;
create trigger trg_inbound_reader_tokens_updated
  before update on public.inbound_reader_tokens
  for each row execute function public.tg_inbound_updated_at();

drop trigger if exists trg_inbound_mappings_updated on public.inbound_mappings;
create trigger trg_inbound_mappings_updated
  before update on public.inbound_mappings
  for each row execute function public.tg_inbound_updated_at();
