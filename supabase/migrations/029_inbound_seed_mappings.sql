-- =====================================================================
-- Phase 15 — Inbound 자동 케이스화 1차 매핑 시드 데이터 (2026-04-29 확정)
--
-- ⚠️ 029 메인 마이그레이션 실행 후 별도로 실행.
-- profiles 테이블에 Skylar / Yuna / Jane 이 등록돼 있어야 함.
-- 이름은 profiles.full_name 으로 매칭. 정확히 안 맞으면 NULL 로 들어가니
-- 이후 관리자 페이지에서 수동 지정 가능.
-- =====================================================================

-- 코오롱 — sender_email 정확 매칭, 1순위 Yuna, 2순위 Skylar
insert into public.inbound_mappings (
  brand, sender_emails, sender_domains, to_patterns,
  default_assignee_id, secondary_assignee_id,
  require_keyword_match, priority, is_active
) values (
  '코오롱',
  array['you7217@kolon.com'],
  array[]::text[],
  array[]::text[],
  (select id from public.profiles where full_name ilike '%Yuna%Lee%' or full_name ilike '%이유나%' limit 1),
  (select id from public.profiles where full_name ilike '%Skylar%' or full_name ilike '%홍지영%' limit 1),
  true, 10, true
)
on conflict do nothing;

-- 삼성물산 — sender_email 정확 매칭 (samsung.com 광범위 도메인 대신), 1순위 Jane, 2순위 Skylar
insert into public.inbound_mappings (
  brand, sender_emails, sender_domains, to_patterns,
  default_assignee_id, secondary_assignee_id,
  require_keyword_match, priority, is_active
) values (
  '삼성물산',
  array['heeuni.chun@samsung.com'],
  array[]::text[],
  array[]::text[],
  (select id from public.profiles where full_name ilike '%Jane%' or full_name ilike '%김희정%' limit 1),
  (select id from public.profiles where full_name ilike '%Skylar%' or full_name ilike '%홍지영%' limit 1),
  true, 20, true
)
on conflict do nothing;

-- TBH — sender_domain 통째 매칭 (12명 + 신규 직원 자동 커버), 1순위 Jane, 2순위 Skylar
insert into public.inbound_mappings (
  brand, sender_emails, sender_domains, to_patterns,
  default_assignee_id, secondary_assignee_id,
  require_keyword_match, priority, is_active
) values (
  'TBH',
  array[]::text[],
  array['tbhglobal.co.kr'],
  array[]::text[],
  (select id from public.profiles where full_name ilike '%Jane%' or full_name ilike '%김희정%' limit 1),
  (select id from public.profiles where full_name ilike '%Skylar%' or full_name ilike '%홍지영%' limit 1),
  true, 30, true
)
on conflict do nothing;

-- 등록 결과 확인용 — 실행 후 Supabase SQL Editor 에서 한 번 봐주세요.
-- assignee_id 가 NULL 이면 이름 매칭 실패 → 관리자 페이지에서 수동 지정.
select brand, sender_emails, sender_domains,
       (select full_name from public.profiles where id = im.default_assignee_id) as default_assignee,
       (select full_name from public.profiles where id = im.secondary_assignee_id) as secondary_assignee,
       require_keyword_match, priority, is_active
from public.inbound_mappings im
order by priority;
