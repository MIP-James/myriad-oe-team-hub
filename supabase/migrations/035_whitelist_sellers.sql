-- =====================================================================
-- Phase 21 — 화이트리스트 셀러 가드 (아마존 오신고 방지)
--
-- 배경:
--   아마존 Report Infringement 에서 고객사의 "공식 판매처(화이트리스트)" 셀러를
--   실수로 신고 → 고객사 클레임 발생. 신고 전에 해당 ASIN 의 Sold by 셀러가
--   화이트리스트에 있는지 자동 대조해서 경고해야 함.
--
-- 아키텍처 (왜 이렇게 나눴나):
--   - 데이터 관리(입력/수정)  = 팀 허브 (이 마이그레이션 + /admin/whitelist)
--   - 실시간 검사(DOM 읽기)   = 전용 크롬 확장
--   허브 웹페이지는 cross-origin 때문에 아마존 페이지의 Sold by 를 읽을 수 없음.
--   반대로 확장 안에 DB 를 넣으면 셀러 한 명 바뀔 때마다 재배포해야 함.
--   → 원천 데이터는 여기, 검사는 확장. 확장은 /api/whitelist-fetch 로 내려받아 캐시.
--
-- ⚠️ 핵심 설계 제약 — "이름 갭":
--   고객사가 주는 화이트리스트는 [가게 이름 + 홈페이지 URL] 형태인데,
--   아마존 Sold by 에 뜨는 건 [아마존 셀러 표시명] 임. 이 둘이 항상 같지 않음.
--   (예: 'ZONKEY INC' / zonkeytoys.com  →  아마존에서는 'Zonkey Toys' 로 표시)
--   그래서:
--     (1) store_name + aliases[] + urls[] 를 모두 매칭 후보로 씀 (느슨한 매칭)
--     (2) amazon_seller_name / amazon_seller_id 는 처음엔 비워두고,
--         실제 확인될 때마다 채워서 그 셀러는 이후 "정확 매칭" 으로 승격
--   → 정밀도보다 재현율 우선. 놓친 매칭 = 오신고(막으려던 사고), 과잉 경고 = 몇 초 확인.
--
-- 테이블 4종:
--   whitelist_clients        — 고객사(브랜드) 마스터
--   whitelist_sellers        — 화이트리스트 엔트리 (여러 별칭/URL 보유 가능)
--   whitelist_import_presets — 엑셀 컬럼 매핑 기억 (고객사마다 양식이 달라서 필수)
--   whitelist_ext_tokens     — 크롬 확장 인증 토큰 (launcher Phase 16 패턴 재사용)
--
-- mig 032+ 표준 GRANT 패턴 적용 (2026-10-30 Data API 정책 변경 대비).
-- =====================================================================

-- ── (1) 고객사 마스터 ───────────────────────────────────────────────
create table if not exists public.whitelist_clients (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,          -- 예: 'Dreams (Sonny Angel)'
  note       text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on table public.whitelist_clients is
  '화이트리스트를 제공한 고객사(브랜드). 고객사별로 파일 양식이 달라서 엔트리를 이 단위로 묶음.';

-- ── (2) 화이트리스트 엔트리 ─────────────────────────────────────────
create table if not exists public.whitelist_sellers (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid not null references public.whitelist_clients(id) on delete cascade,

  -- 대표 이름. 고객사 파일의 'Customer' / 'Store name' 등이 여기로 들어옴.
  store_name text not null,

  -- 같은 가게의 다른 표기들. 파일의 'Other name for store' 같은 컬럼 + 운영 중 추가.
  -- 배열인 이유: 한 가게가 법인명/브랜드명/아마존표시명 3개를 갖는 게 흔함.
  aliases    text[] not null default '{}',

  -- 스토어 URL 들 (Store URL + Additional Whitelisted URLS 1,2...).
  -- 매칭 시 도메인 코어(zonkeytoys.com → zonkeytoys)를 이름 후보로 추출해서 씀.
  urls       text[] not null default '{}',

  -- ⚠️ 아래 2개가 "이름 갭" 해소 장치. 처음엔 NULL, 실제 확인 시 채움 → 정확 매칭 승격.
  amazon_seller_name text,   -- 아마존 Sold by 에 실제로 뜨는 표시명
  amazon_seller_id   text,   -- 아마존 셀러 ID (seller= 파라미터 값). 가장 확실한 키.

  region     text,           -- 'Korea' | 'North America' | ... (원본 파일 구분용)
  channel    text,           -- 원본 파일의 'Platform' 등 자유 텍스트 (예: 'Online')
  note       text,

  -- 업로드 추적 — 어느 파일에서 들어온 행인지. 재업로드/롤백 판단에 사용.
  source_file text,

  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

comment on column public.whitelist_sellers.amazon_seller_id is
  '아마존 셀러 ID. 채워지면 이름 변경/중복과 무관하게 100% 매칭됨 — 확인될 때마다 채우는 게 이 기능의 정확도를 올리는 핵심.';

-- 같은 고객사 안에서 같은 가게명 중복 등록 방지 (재업로드 시 upsert 키).
-- lower() 로 대소문자 무시 — 'ZONKEY INC' 와 'Zonkey Inc' 는 같은 행.
create unique index if not exists idx_whitelist_sellers_client_name
  on public.whitelist_sellers (client_id, lower(store_name));

create index if not exists idx_whitelist_sellers_active
  on public.whitelist_sellers (client_id) where is_active;

-- 셀러 ID 로 역조회 (확장에서 정확매칭 확인용 / 중복 등록 감지용)
create index if not exists idx_whitelist_sellers_amz_id
  on public.whitelist_sellers (amazon_seller_id) where amazon_seller_id is not null;

-- 배열 컬럼 검색용 GIN (함정 #21 — text[] 는 GIN 없으면 .contains() 가 full scan)
create index if not exists idx_whitelist_sellers_aliases
  on public.whitelist_sellers using gin (aliases);
create index if not exists idx_whitelist_sellers_urls
  on public.whitelist_sellers using gin (urls);

-- updated_at 자동 갱신
create or replace function public.tg_whitelist_sellers_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_whitelist_sellers_touch on public.whitelist_sellers;
create trigger trg_whitelist_sellers_touch
  before update on public.whitelist_sellers
  for each row execute function public.tg_whitelist_sellers_touch();

-- ── (3) 엑셀 업로드 컬럼 매핑 프리셋 ────────────────────────────────
-- 왜 필요한가: 고객사마다 파일 양식이 완전히 다름.
--   Korea 파일  : NO | Platform | Store name | URL
--   북미 파일   : Customer | Store URL | Other name for store | Additional URLS (1) (2)
-- 한 번 매핑해두면 다음에 같은 양식 파일을 던졌을 때 header_signature 로 자동 감지 →
-- 사용자는 확인만 누르면 됨. (mig 027 노션 자동감지 캐시와 같은 발상)
create table if not exists public.whitelist_import_presets (
  id         uuid primary key default gen_random_uuid(),
  client_id  uuid references public.whitelist_clients(id) on delete cascade,
  name       text not null,

  -- 헤더가 몇 번째 행인지 (Korea 파일은 제목/빈 행 때문에 3행이 헤더)
  header_row int not null default 1,

  -- 정규화된 헤더명들을 정렬해 join 한 지문. 같은 양식 재업로드 시 자동 매칭 키.
  header_signature text,

  -- { store_name: 'Customer', aliases: ['Other name for store'],
  --   urls: ['Store URL','Additional Whitelisted URLS (1)'], region: null, ... }
  mapping    jsonb not null,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_whitelist_presets_sig
  on public.whitelist_import_presets (header_signature);

-- ── (4) 크롬 확장 인증 토큰 ─────────────────────────────────────────
-- launcher Phase 16(mig 030) 과 동일한 모델: opaque 랜덤 토큰 발급 → sha256 만 저장.
-- refresh/rotation 없음 → 세션 갱신 race(gotcha #12-A~D) 원천 차단.
-- 별도 테이블인 이유: launcher_device_tokens 는 launcher_devices 에 묶인 device 전용.
create table if not exists public.whitelist_ext_tokens (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,        -- plain 토큰은 DB 에 절대 저장 안 함
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null default 'Chrome 확장',
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);

create index if not exists idx_whitelist_ext_tokens_hash
  on public.whitelist_ext_tokens (token_hash) where revoked_at is null;

create index if not exists idx_whitelist_ext_tokens_user
  on public.whitelist_ext_tokens (user_id) where revoked_at is null;

-- token_hash / user_id 위변조 차단 (mig 030 과 동일 방어)
create or replace function public.tg_whitelist_ext_token_immutable()
returns trigger language plpgsql as $$
begin
  if old.token_hash is distinct from new.token_hash then
    raise exception 'whitelist_ext_tokens.token_hash 는 immutable';
  end if;
  if old.user_id is distinct from new.user_id then
    raise exception 'whitelist_ext_tokens.user_id 는 immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_whitelist_ext_token_immutable on public.whitelist_ext_tokens;
create trigger trg_whitelist_ext_token_immutable
  before update on public.whitelist_ext_tokens
  for each row execute function public.tg_whitelist_ext_token_immutable();

-- =====================================================================
-- RLS — 읽기는 팀 전원(신고 담당자가 조회해야 함), 쓰기는 관리자만.
-- =====================================================================
alter table public.whitelist_clients        enable row level security;
alter table public.whitelist_sellers        enable row level security;
alter table public.whitelist_import_presets enable row level security;
alter table public.whitelist_ext_tokens     enable row level security;

-- (1) clients
drop policy if exists whitelist_clients_select on public.whitelist_clients;
create policy whitelist_clients_select on public.whitelist_clients
  for select to authenticated using (true);

drop policy if exists whitelist_clients_write on public.whitelist_clients;
create policy whitelist_clients_write on public.whitelist_clients
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- (2) sellers
drop policy if exists whitelist_sellers_select on public.whitelist_sellers;
create policy whitelist_sellers_select on public.whitelist_sellers
  for select to authenticated using (true);

drop policy if exists whitelist_sellers_write on public.whitelist_sellers;
create policy whitelist_sellers_write on public.whitelist_sellers
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- (3) presets — 관리자 전용 (업로드 도구 설정값)
drop policy if exists whitelist_presets_all on public.whitelist_import_presets;
create policy whitelist_presets_all on public.whitelist_import_presets
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- (4) ext tokens — 본인 토큰 메타만 조회/revoke. INSERT 는 service_role 만
--     (Cloudflare Function /api/whitelist-issue-token).
--     token_hash 는 RLS 통과 사용자도 보면 안 되는 값 → 클라이언트에서 select 컬럼 명시.
drop policy if exists whitelist_ext_tokens_select_own on public.whitelist_ext_tokens;
create policy whitelist_ext_tokens_select_own on public.whitelist_ext_tokens
  for select to authenticated using (auth.uid() = user_id);

drop policy if exists whitelist_ext_tokens_revoke_own on public.whitelist_ext_tokens;
create policy whitelist_ext_tokens_revoke_own on public.whitelist_ext_tokens
  for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- =====================================================================
-- GRANT — mig 032+ 표준 패턴 (2026-10-30 부터 신규 테이블 명시 GRANT 필수)
-- =====================================================================
grant select on public.whitelist_clients to anon;
grant select, insert, update, delete on public.whitelist_clients to authenticated;
grant select, insert, update, delete on public.whitelist_clients to service_role;

grant select on public.whitelist_sellers to anon;
grant select, insert, update, delete on public.whitelist_sellers to authenticated;
grant select, insert, update, delete on public.whitelist_sellers to service_role;

grant select on public.whitelist_import_presets to anon;
grant select, insert, update, delete on public.whitelist_import_presets to authenticated;
grant select, insert, update, delete on public.whitelist_import_presets to service_role;

grant select on public.whitelist_ext_tokens to anon;
grant select, update on public.whitelist_ext_tokens to authenticated;
grant select, insert, update, delete on public.whitelist_ext_tokens to service_role;

-- =====================================================================
-- 시드 — Dreams (Sonny Angel). 실제 셀러 데이터는 /admin/whitelist 에서 엑셀 업로드.
-- =====================================================================
insert into public.whitelist_clients (name, note)
values ('Dreams (Sonny Angel)', 'Korea 공식 채널 + North American Whitelist 제공 고객사')
on conflict (name) do nothing;
