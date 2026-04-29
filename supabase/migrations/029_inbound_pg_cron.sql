-- =====================================================================
-- Phase 15 — Inbound 자동 케이스화 cron 트리거 (선택 사항)
--
-- ⚠️ 029 메인 + 시드 실행 후 마지막에 실행.
-- Supabase pg_cron + pg_net extension 으로 5분마다 inbound-poll endpoint 호출.
--
-- 사전 조건:
--   1. Supabase Dashboard → Database → Extensions 에서 pg_cron + pg_net 활성화
--   2. Cloudflare Pages 환경변수에 INBOUND_CRON_SECRET 등록 (임의 랜덤 문자열)
--      예: openssl rand -hex 32
--   3. 아래 SECRET / SITE_URL 두 변수 본인 값으로 변경
-- =====================================================================

-- 1) pg_cron / pg_net extension 활성화 (Supabase Free tier 가능)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) inbound-poll 호출 함수
-- ⚠️ 아래 변수 두 개 본인 값으로 교체 후 실행:
--    YOUR_CRON_SECRET = Cloudflare 환경변수 INBOUND_CRON_SECRET 와 동일 값
--    YOUR_SITE_URL    = 'https://myriad-oe-team-hub.pages.dev' (또는 본인 도메인)

create or replace function public.trigger_inbound_poll()
returns void
language plpgsql
security definer
as $$
begin
  perform net.http_post(
    url := 'YOUR_SITE_URL/api/inbound-poll',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_CRON_SECRET'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
end;
$$;

-- 3) 5분마다 cron 등록
-- (기존 등록이 있으면 unschedule 후 재등록 — 안전)
do $$
declare
  job_id int;
begin
  select jobid into job_id from cron.job where jobname = 'inbound-poll-5min';
  if job_id is not null then
    perform cron.unschedule(job_id);
  end if;
end $$;

select cron.schedule(
  'inbound-poll-5min',
  '*/5 * * * *',                      -- 매 5분
  'select public.trigger_inbound_poll();'
);

-- 4) 동작 확인 — 5분 기다린 뒤 아래 쿼리 실행하면 net.http 응답 기록 보임
-- select * from net._http_response order by created desc limit 5;

-- 5) cron 일시 정지하려면:
-- select cron.unschedule(jobid) from cron.job where jobname = 'inbound-poll-5min';

-- 6) 다시 활성화하려면 위 cron.schedule 다시 실행.
