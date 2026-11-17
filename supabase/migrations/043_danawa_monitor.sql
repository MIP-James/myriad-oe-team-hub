-- ============================================================
-- 043 다나와 최저가 모니터링 (Phase 25)
-- ============================================================
-- 허브 '다나와 모니터링' 탭 + 구글 챗 알림.
--   danawa_products  = 감시할 다나와 상품 (팀원이 탭에서 추가/일시중지/삭제)
--   danawa_snapshots = 확인할 때마다 남는 기록 (최저가 판매자 이력 — 내려간 판매글도 남음)
--   danawa_settings  = 확인 간격 / 구글 챗 웹훅 / 하루 요약 (관리자만 수정)
-- 예약 실행: pg_cron 이 매시 7분에 trigger_danawa_check() → 상품마다 /api/danawa-check 호출.
--   인증 비밀값은 이미 등록된 trigger_inbound_poll() (mig 029) 에서 꺼내 씀 → 레포에 비밀값 없음.
-- ⚠️ 웹훅 주소는 레포(public)에 넣지 않음 — 탭의 관리자 설정에서 붙여넣기.
-- ============================================================

-- ── 1) 감시 상품 ─────────────────────────────────────────────
create table if not exists public.danawa_products (
  id                bigserial primary key,
  pcode             text not null unique,
  brand             text,
  name              text,
  image_url         text,
  active            boolean not null default true,
  sort_order        int not null default 0,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  last_checked_at   timestamptz,
  last_lowest_price int,
  last_listings     jsonb not null default '[]'::jsonb,
  last_changed_at   timestamptz,
  last_error        text,
  last_error_at     timestamptz
);

alter table public.danawa_products enable row level security;

create policy danawa_products_select on public.danawa_products
  for select to authenticated using (true);
create policy danawa_products_insert on public.danawa_products
  for insert to authenticated with check (true);
create policy danawa_products_update on public.danawa_products
  for update to authenticated using (true) with check (true);
create policy danawa_products_delete on public.danawa_products
  for delete to authenticated using (true);

grant select on public.danawa_products to anon;
grant select, insert, update, delete on public.danawa_products to authenticated;
grant select, insert, update, delete on public.danawa_products to service_role;
grant usage, select on sequence public.danawa_products_id_seq to authenticated, service_role;

-- ── 2) 확인 기록 ─────────────────────────────────────────────
create table if not exists public.danawa_snapshots (
  id            bigserial primary key,
  product_id    bigint not null references public.danawa_products(id) on delete cascade,
  checked_at    timestamptz not null default now(),
  lowest_price  int,
  listings      jsonb not null default '[]'::jsonb,
  changed       boolean not null default false,
  notified      boolean not null default false,
  source        text not null default 'cron' check (source in ('cron', 'manual')),
  error         text
);

create index if not exists danawa_snapshots_product_time
  on public.danawa_snapshots (product_id, checked_at desc);

alter table public.danawa_snapshots enable row level security;

create policy danawa_snapshots_select on public.danawa_snapshots
  for select to authenticated using (true);

grant select on public.danawa_snapshots to anon;
grant select, insert, update, delete on public.danawa_snapshots to authenticated;
grant select, insert, update, delete on public.danawa_snapshots to service_role;
grant usage, select on sequence public.danawa_snapshots_id_seq to authenticated, service_role;

-- ── 3) 설정 (1행) ────────────────────────────────────────────
create table if not exists public.danawa_settings (
  id             int primary key default 1 check (id = 1),
  enabled        boolean not null default true,
  interval_hours int not null default 1 check (interval_hours in (1, 2, 3, 6)),
  daily_summary  boolean not null default true,
  webhook_url    text,
  has_webhook    boolean generated always as (webhook_url is not null and webhook_url <> '') stored,
  last_tick_at   timestamptz,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references auth.users(id) on delete set null
);

insert into public.danawa_settings (id) values (1) on conflict (id) do nothing;

alter table public.danawa_settings enable row level security;

create policy danawa_settings_select on public.danawa_settings
  for select to authenticated using (true);
create policy danawa_settings_update on public.danawa_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- 웹훅 주소는 팀원 화면에 내려가지 않게 컬럼 단위로 권한 부여 (has_webhook 만 보임)
grant select (id, enabled, interval_hours, daily_summary, has_webhook, last_tick_at, updated_at)
  on public.danawa_settings to authenticated;
grant update (enabled, interval_hours, daily_summary, webhook_url, updated_at, updated_by)
  on public.danawa_settings to authenticated;
grant select, insert, update, delete on public.danawa_settings to service_role;

-- ── 4) 처음 감시할 4개 상품 ──────────────────────────────────
insert into public.danawa_products (pcode, brand, sort_order) values
  ('20016476', '당큐락',   1),
  ('3756067',  '엘레나',   2),
  ('1425221',  '더후',     3),
  ('20032874', '아이오페', 4)
on conflict (pcode) do nothing;

-- ── 5) 예약 실행 ─────────────────────────────────────────────
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- mig 029 의 trigger_inbound_poll() 안에 들어 있는 인증값을 그대로 재사용
create or replace function public.danawa_cron_secret()
returns text
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  v_src text;
begin
  select p.prosrc into v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'trigger_inbound_poll'
   limit 1;
  if v_src is null then
    return null;
  end if;
  return substring(v_src from $re$'Authorization',\s*'([^']+)'$re$);
end;
$$;

revoke all on function public.danawa_cron_secret() from public, anon, authenticated;

create or replace function public.trigger_danawa_check()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s        record;
  p        record;
  v_secret text;
begin
  select * into s from public.danawa_settings where id = 1;
  if s is null or not s.enabled then
    return;
  end if;
  -- 설정한 간격(시간)이 아직 안 지났으면 건너뜀 (매시 호출, 10분 여유)
  if s.last_tick_at is not null
     and s.last_tick_at > now() - make_interval(hours => s.interval_hours) + interval '10 minutes' then
    return;
  end if;

  v_secret := public.danawa_cron_secret();
  if v_secret is null then
    raise warning 'danawa: trigger_inbound_poll() 에서 인증값을 찾지 못했습니다 (mig 029 확인)';
    return;
  end if;

  update public.danawa_settings set last_tick_at = now() where id = 1;

  for p in select id from public.danawa_products where active order by sort_order, id loop
    perform net.http_post(
      url := 'https://myriad-oe-team-hub.pages.dev/api/danawa-check',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_secret),
      body := jsonb_build_object('productId', p.id, 'source', 'cron'),
      timeout_milliseconds := 60000
    );
  end loop;
end;
$$;

create or replace function public.trigger_danawa_summary()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s        record;
  v_secret text;
begin
  select * into s from public.danawa_settings where id = 1;
  if s is null or not s.enabled or not s.daily_summary then
    return;
  end if;
  v_secret := public.danawa_cron_secret();
  if v_secret is null then
    return;
  end if;
  perform net.http_post(
    url := 'https://myriad-oe-team-hub.pages.dev/api/danawa-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', v_secret),
    body := jsonb_build_object('mode', 'summary'),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function public.trigger_danawa_check() from public, anon, authenticated;
revoke all on function public.trigger_danawa_summary() from public, anon, authenticated;

do $$
declare
  j int;
begin
  for j in select jobid from cron.job where jobname in ('danawa-check-hourly', 'danawa-summary-daily') loop
    perform cron.unschedule(j);
  end loop;
end $$;

-- 매시 7분 (간격 설정은 함수 안에서 판단)
select cron.schedule('danawa-check-hourly', '7 * * * *', 'select public.trigger_danawa_check();');
-- 매일 09:00 KST (= 00:00 UTC) 현황 요약
select cron.schedule('danawa-summary-daily', '0 0 * * *', 'select public.trigger_danawa_summary();');

-- 확인용:
-- select public.danawa_cron_secret() is not null as secret_ok;
-- select * from cron.job where jobname like 'danawa%';
-- select * from net._http_response order by created desc limit 5;
