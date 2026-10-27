-- ============================================================
-- 041 자동 수집 결과 — '상세 확인 필요' 상태 추가 (mig 040 후속)
-- ============================================================
-- 기존 '제외' 하나로는 "썸네일은 같지만 상세 페이지가 달라 쓸 수도 있는" 상품까지 영구히 사라짐 → 2단계로 분리.
--   status 'excluded' = 제외   : 같은 사진은 다음 자동 수집부터 자동으로 빠짐 (기존 동작 그대로)
--   status 'review'   = 상세 확인 필요 : 지금 목록에서는 빠지지만, 같은 사진이 다음에 다시 수집되면
--                                        빼지 않고 빨간 테두리(review_match)로 표시해 상세 페이지를 다시 보게 함
-- review_match 는 실행기(utilities/patrol-runner)가 판정해 업로드 → 팀원은 바꿀 수 없음 (트리거 보호 컬럼).
-- ============================================================

alter table public.patrol_items drop constraint if exists patrol_items_status_check;
alter table public.patrol_items
  add constraint patrol_items_status_check check (status in ('new', 'review', 'excluded'));

alter table public.patrol_items
  add column if not exists review_match boolean not null default false;

-- 팀원은 상태(status / excluded_*)만 바꿀 수 있게 — review_match 도 보호 컬럼에 추가
create or replace function public.tg_patrol_items_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if (new.platform, new.product_id, new.url, new.title, new.price, new.seller, new.image, new.img_hash,
        new.keyword, new.model_type, new.product_type, new.tier, new.score, new.reasons, new.img_dist,
        new.first_seen, new.last_run_id, new.bpm_registered, new.bpm_checked_at, new.review_match)
       is distinct from
       (old.platform, old.product_id, old.url, old.title, old.price, old.seller, old.image, old.img_hash,
        old.keyword, old.model_type, old.product_type, old.tier, old.score, old.reasons, old.img_dist,
        old.first_seen, old.last_run_id, old.bpm_registered, old.bpm_checked_at, old.review_match) then
      raise exception 'patrol_items: 팀원은 제외/상세 확인 상태만 변경할 수 있습니다';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop index if exists public.idx_patrol_items_status;
create index if not exists idx_patrol_items_status on public.patrol_items(status) where status <> 'new';
