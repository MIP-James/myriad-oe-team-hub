-- ============================================================
-- 040 자동 수집 결과 (utilities/patrol-runner → 허브)
-- ============================================================
-- 노트북의 자동 수집 실행기가 검색 결과에서 찾은 신규 상품을 등급(대표 이미지 일치 / 검토 / 참고 / 제외)과
-- 함께 올리고, 실무자는 허브 '자동 수집 결과' 페이지에서 썸네일·상품명·가격만 보고 골라
-- URL 을 복사해 BPM Collector 대량 캡처 / BPM 작업 추가(URL)로 재수집한다.
-- (BPM 판매정보 등록은 재수집 쪽이 담당 — 자동 수집은 URL 추리기까지)
--
-- 쓰기: 업로드 = service role (Cloudflare Function /api/auto-collect-upload, 런처 기기 토큰 인증)
--       '제외' 처리 = 로그인 팀원 (status / excluded_* 만, 트리거로 그 외 컬럼 변경 차단)
-- 내부 이름은 patrol_* (코드 식별자), 화면 용어는 '자동 수집'.
-- mig 032+ 표준 GRANT 패턴.
-- ============================================================

create table if not exists public.patrol_runs (
  id           bigserial primary key,
  started_at   timestamptz,
  finished_at  timestamptz,
  uploaded_by  uuid references auth.users(id) on delete set null,
  device_id    uuid,
  counts       jsonb,   -- { A, B, C, X, excluded_by_filter }
  summary      jsonb,   -- [{ platform, keyword, found, new, note }]
  created_at   timestamptz not null default now()
);

create index if not exists idx_patrol_runs_created on public.patrol_runs(created_at desc);

create table if not exists public.patrol_items (
  id             bigserial primary key,
  platform       text not null,                 -- 지마켓 / 옥션 / 스마트스토어 / 11번가
  product_id     text not null,                 -- 플랫폼 상품번호
  url            text not null,
  title          text,
  price          integer,
  seller         text,
  image          text,                          -- 썸네일 URL
  img_hash       text,                          -- pHash+dHash (16진수) — '제외' 사진 재등장 자동 제외용
  keyword        text,
  model_type     text,                          -- BPM 모델 유형 (예: MagSafe iPhone case)
  product_type   text,                          -- BPM 상품 유형 (예: iPhone - Case)
  tier           text not null check (tier in ('A', 'B', 'C', 'X')),
  score          integer,
  reasons        text,                          -- 판단 근거 (관리자 조정용, 실무자 화면엔 안 보임)
  img_dist       integer,
  first_seen     date not null default ((now() at time zone 'Asia/Seoul')::date),  -- 한국 날짜 (current_date 는 UTC)
  last_run_id    bigint references public.patrol_runs(id) on delete set null,
  status         text not null default 'new' check (status in ('new', 'excluded')),
  excluded_by    uuid references auth.users(id) on delete set null,
  excluded_at    timestamptz,
  bpm_registered boolean not null default false,
  bpm_checked_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (platform, product_id)
);

create index if not exists idx_patrol_items_seen on public.patrol_items(first_seen desc, tier, score desc);
create index if not exists idx_patrol_items_status on public.patrol_items(status) where status = 'excluded';

-- 팀원은 '제외' 관련 컬럼만 바꿀 수 있게 (나머지는 업로드(service role)만)
create or replace function public.tg_patrol_items_guard()
returns trigger language plpgsql as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    if (new.platform, new.product_id, new.url, new.title, new.price, new.seller, new.image, new.img_hash,
        new.keyword, new.model_type, new.product_type, new.tier, new.score, new.reasons, new.img_dist,
        new.first_seen, new.last_run_id, new.bpm_registered, new.bpm_checked_at)
       is distinct from
       (old.platform, old.product_id, old.url, old.title, old.price, old.seller, old.image, old.img_hash,
        old.keyword, old.model_type, old.product_type, old.tier, old.score, old.reasons, old.img_dist,
        old.first_seen, old.last_run_id, old.bpm_registered, old.bpm_checked_at) then
      raise exception 'patrol_items: 팀원은 제외 상태만 변경할 수 있습니다';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_patrol_items_guard on public.patrol_items;
create trigger trg_patrol_items_guard
  before update on public.patrol_items
  for each row execute function public.tg_patrol_items_guard();

alter table public.patrol_runs enable row level security;
alter table public.patrol_items enable row level security;

create policy patrol_runs_select on public.patrol_runs
  for select to authenticated using (true);
create policy patrol_items_select on public.patrol_items
  for select to authenticated using (true);
create policy patrol_items_update on public.patrol_items
  for update to authenticated using (true) with check (true);

-- ── GRANT (2026-10-30 Data API 정책 대응 표준 패턴) ───────────────────
grant select on public.patrol_runs to anon;
grant select, insert, update, delete on public.patrol_runs to authenticated;
grant select, insert, update, delete on public.patrol_runs to service_role;
grant usage, select on sequence public.patrol_runs_id_seq to authenticated, service_role;

grant select on public.patrol_items to anon;
grant select, insert, update, delete on public.patrol_items to authenticated;
grant select, insert, update, delete on public.patrol_items to service_role;
grant usage, select on sequence public.patrol_items_id_seq to authenticated, service_role;
