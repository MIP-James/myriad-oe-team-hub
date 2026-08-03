-- =====================================================================
-- Phase 21b — 화이트리스트 가드 확장 토큰: 팀원 셀프 발급 + 관리자 전체 관리
--
-- 배경 (mig 035 설계 오류 정정):
--   토큰 발급 UI 를 /admin/whitelist 안에 둬서 관리자만 발급할 수 있었고,
--   결과적으로 "관리자가 팀원 수만큼 발급해서 문자열을 하나씩 전달" 하는 구조가 됐다.
--   문제 3가지:
--     (1) 토큰이 발급자(관리자) 계정에 묶여서 "누구 토큰인지" 를 알 수 없음
--         → 특정인만 폐기하는 게 불가능. 감사 추적이 무의미해짐.
--     (2) 비밀 문자열을 메신저/메일로 사람 손으로 전달 → 기록이 남음
--     (3) 애초에 막을 근거가 없음 — whitelist_sellers 는 이미
--         `for select to authenticated using (true)` 라서 로그인한 팀원 전원이
--         허브에서 목록을 볼 수 있다. 확장 토큰은 "이미 볼 수 있는 것을 확장에서도
--         보게" 하는 것뿐이라 관리자 전용일 이유가 없다.
--
--   → 발급은 팀원 셀프(각자 본인 계정에 묶임), 데이터 관리(엑셀 업로드/셀러 편집)는
--     관리자 전용 유지. 발급 API(/api/whitelist-issue-token)는 원래 관리자 검사가
--     없었으므로 서버 변경 불필요 — UI 위치만 이동.
--
-- 이 마이그레이션이 하는 일:
--   관리자가 팀원 전원의 토큰을 조회/폐기할 수 있는 RLS 정책 추가 (퇴사자 대비).
--   기존 "본인 것만" 정책은 그대로 두고 정책을 추가만 한다 —
--   RLS 정책은 OR 로 합쳐지므로 본인 것 + (관리자면) 전체 가 된다.
--
-- ⚠️ 신규 테이블이 없으므로 추가 GRANT 불필요 (mig 035 설정 상속).
-- =====================================================================

-- 관리자 — 전원 토큰 메타 조회.
-- token_hash 는 여전히 클라이언트에서 select 컬럼을 명시해 제외한다
-- (RLS 는 행 단위 통제이고 컬럼 단위가 아니므로, 조회 코드 쪽 규율로 지킴).
drop policy if exists whitelist_ext_tokens_select_admin on public.whitelist_ext_tokens;
create policy whitelist_ext_tokens_select_admin on public.whitelist_ext_tokens
  for select to authenticated using (public.is_admin());

-- 관리자 — 전원 토큰 폐기 (revoked_at 설정).
-- token_hash / user_id 위변조는 mig 035 의 trg_whitelist_ext_token_immutable
-- 트리거가 계속 막으므로, 관리자도 revoked_at / name 외에는 바꿀 수 없다.
drop policy if exists whitelist_ext_tokens_update_admin on public.whitelist_ext_tokens;
create policy whitelist_ext_tokens_update_admin on public.whitelist_ext_tokens
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

comment on table public.whitelist_ext_tokens is
  '크롬 확장(화이트리스트 가드) 인증 토큰. 팀원이 /whitelist-guard 에서 본인 것을 직접 발급하고, 관리자는 전원 토큰을 조회/폐기할 수 있다. plain 토큰은 저장하지 않고 sha256 해시만 보관.';
