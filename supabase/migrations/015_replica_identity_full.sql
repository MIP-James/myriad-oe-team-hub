-- =====================================================================
-- MYRIAD Team Hub - Realtime DELETE 누락 버그 수정
--
-- 증상: 댓글/첨부 삭제가 다른 탭(또는 본인 탭의 realtime 구독)에 즉시 반영 안 됨
-- 원인: Supabase Realtime 의 기본 publication 은 REPLICA IDENTITY DEFAULT 를 따름.
--   DEFAULT 는 DELETE 이벤트의 old_record 에 PK 만 포함시킴.
--   따라서 채널 필터 (예: filter: 'case_id=eq.<id>') 가 case_id 가 없는 payload 에서
--   매칭 실패 → 이벤트가 클라이언트에 도달하지 않음.
-- 해결: 영향 받는 테이블에 REPLICA IDENTITY FULL 적용.
--   DELETE 시 행 전체가 old_record 로 전송되어 필터가 정상 평가됨.
--   비용: 매 UPDATE/DELETE 시 WAL 사용량 약간 증가 (팀 규모에 무시 가능).
-- =====================================================================

alter table public.case_comments       replica identity full;
alter table public.case_attachments    replica identity full;
alter table public.cases               replica identity full;
alter table public.brand_report_comments replica identity full;
alter table public.announcements       replica identity full;
alter table public.announcement_reads  replica identity full;
