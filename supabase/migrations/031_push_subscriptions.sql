-- =====================================================================
-- Phase 17 — PWA Web Push 알림 (Service Worker + Web Push API)
--
-- 사용자가 팀 허브에서 PC 알림 켜면 브라우저가 푸시 서비스 (FCM/Mozilla 등)
-- 에 endpoint 발급받음. 그 endpoint + 암호화 키 (p256dh, auth) 를 여기 저장.
-- 서버는 notifications INSERT 트리거에서 사용자의 모든 활성 구독에 push 발송.
--
-- 브라우저 닫혀있어도 윈도우 토스트 도착 (Chrome 백그라운드 살아있는 한).
--
-- ⚠️ 사전 작업:
--   1. VAPID 키 발급: `npx web-push generate-vapid-keys` (로컬 1회)
--   2. Cloudflare 환경변수 등록:
--      - VAPID_PUBLIC_KEY  (base64url, 공개)
--      - VAPID_PRIVATE_KEY (base64url, 비밀)
--      - VAPID_SUBJECT     ('mailto:james@myriadip.com' 같은 형식)
--      - PUSH_SEND_SECRET  (랜덤 문자열, 트리거↔endpoint 인증용)
--   3. 빌드 타임 환경변수: VITE_VAPID_PUBLIC_KEY = VAPID_PUBLIC_KEY 와 동일값
--   4. 아래 SQL 실행 전, 마지막의 PUSH_SEND_SECRET 자리 본인 값으로 교체
-- =====================================================================

-- 1) push_subscriptions 테이블
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 푸시 서비스 endpoint (브라우저별 고유). 같은 사용자가 회사 PC + 노트북
  -- 두 디바이스에서 켜면 row 2개가 됨. unique 보장으로 중복 등록 차단.
  endpoint text not null unique,
  -- subscription.keys.p256dh (recipient public key, base64url)
  p256dh text not null,
  -- subscription.keys.auth (auth secret, base64url)
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  -- 410 Gone / 404 등으로 endpoint 가 만료/삭제됐을 때 기록
  last_error text,
  failure_count int not null default 0,
  -- 사용자가 명시적으로 끄거나, 5회 연속 실패 시 자동 마킹
  revoked_at timestamptz
);

create index if not exists idx_push_subs_user_active
  on public.push_subscriptions(user_id) where revoked_at is null;

create index if not exists idx_push_subs_endpoint
  on public.push_subscriptions(endpoint);

alter table public.push_subscriptions enable row level security;

-- 사용자는 본인 구독 조회/회수 가능. INSERT 는 service_role 통해서만
-- (api/push-subscribe 가 user JWT 검증 후 service role 로 INSERT).
drop policy if exists push_subs_select_own on public.push_subscriptions;
create policy push_subs_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_subs_update_own on public.push_subscriptions;
create policy push_subs_update_own on public.push_subscriptions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists push_subs_delete_own on public.push_subscriptions;
create policy push_subs_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- 2) notifications INSERT 시 push fanout 트리거
-- pg_net 으로 /api/push-send 를 비동기 호출. 실패해도 INSERT 자체엔 영향 없음.
-- daily reminder 같이 알림 테이블 안 거치는 것은 별도 처리 (프론트가 SW 직접 호출).
--
-- ⚠️ 아래 PUSH_SEND_SECRET_VALUE 를 본인 값으로 교체:
create or replace function public.send_push_for_notification()
returns trigger language plpgsql security definer as $$
begin
  perform net.http_post(
    url := 'https://myriad-oe-team-hub.pages.dev/api/push-send',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer PUSH_SEND_SECRET_VALUE'
    ),
    body := jsonb_build_object(
      'notification_id', new.id,
      'recipient_id', new.recipient_id,
      'type', new.type,
      'title', new.title,
      'body', new.body,
      'link', new.link,
      'payload', new.payload
    ),
    timeout_milliseconds := 8000
  );
  return new;
exception when others then
  -- pg_net 실패해도 notifications INSERT 는 통과 (push 는 best-effort)
  raise warning 'push fanout failed: %', sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_push_fanout on public.notifications;
create trigger trg_push_fanout
  after insert on public.notifications
  for each row execute function public.send_push_for_notification();

-- 3) 회수된 구독 자동 정리 함수 (옵션 — 7일 지난 revoked_at 행 삭제)
-- 같은 endpoint 가 다시 구독될 때 unique 충돌 방지하려면 즉시 삭제하는 게 나음.
-- 단순화 위해 push-subscribe 가 ON CONFLICT 로 덮어쓰는 방식이라 cleanup 필수는 아님.
create or replace function public.cleanup_revoked_push_subs()
returns int language plpgsql security definer as $$
declare cnt int;
begin
  delete from public.push_subscriptions
   where revoked_at is not null
     and revoked_at < now() - interval '7 days';
  get diagnostics cnt = row_count;
  return cnt;
end $$;

-- 매일 1회 cleanup
do $$
declare jid int;
begin
  select jobid into jid from cron.job where jobname = 'cleanup-revoked-push-subs';
  if jid is not null then
    perform cron.unschedule(jid);
  end if;
end $$;

select cron.schedule(
  'cleanup-revoked-push-subs',
  '0 4 * * *',                                -- 매일 새벽 4시
  'select public.cleanup_revoked_push_subs();'
);
