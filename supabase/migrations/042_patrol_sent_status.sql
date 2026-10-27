-- ============================================================
-- 042 자동 수집 결과 — 'BPM 전송 완료' 상태 추가 (mig 041 후속)
-- ============================================================
-- 실무자가 '선택 URL 복사' → BPM 으로 보낸 뒤 'BPM 전송 완료'를 누르면 status 'sent' → 허브 목록에서 즉시 사라짐.
-- 같은 상품은 노트북 실행기가 '이미 본 상품' 기록 + BPM 등록 목록으로 다시 올리지 않으므로 허브에서 빼도 안전.
-- 'sent' 행은 'new' 와 함께 7일 보관 후 업로드 함수가 삭제 ('제외'·'상세 확인'은 사진 지문 때문에 보존).
-- ============================================================

alter table public.patrol_items drop constraint if exists patrol_items_status_check;
alter table public.patrol_items
  add constraint patrol_items_status_check check (status in ('new', 'review', 'excluded', 'sent'));
