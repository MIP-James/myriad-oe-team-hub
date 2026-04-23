-- =====================================================================
-- MYRIAD Team Hub - 사용자 관리 기능 (Phase 9 마무리)
--
-- 관리자가 다른 팀원의 역할(member ↔ admin) 을 바꿀 수 있도록 RLS 추가.
-- 기존 profiles_update_self 는 그대로 유지 (본인이 자기 프로필 수정).
-- 신규 profiles_update_admin 은 admin 이 누구의 프로필이든 update 가능.
-- (Postgres RLS 는 OR 결합 — 둘 중 하나라도 만족하면 통과)
-- =====================================================================

drop policy if exists profiles_update_admin on public.profiles;
create policy profiles_update_admin on public.profiles
  for update using (public.is_admin())
  with check (public.is_admin());
