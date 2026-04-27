-- =====================================================================
-- MYRIAD Team Hub - 2026-04-27
-- 케이스 메타필드 다중값 지원
--   - 브랜드(고객사) / 플랫폼 / 침해 유형 / 게시물 URL 을 하나만 입력하던 것 →
--     필요한 만큼 여러 개 등록 가능하도록 text[] 배열 컬럼으로 확장
--
-- 전략:
--   1) 새 배열 컬럼 4개 추가 (brands, platforms, infringement_types, post_urls)
--   2) 기존 단일값을 1원소 배열로 복사 (NULL/빈 문자열은 빈 배열)
--   3) 새 컬럼에 NOT NULL + default '{}' 부여
--   4) 기존 단일 컬럼의 NOT NULL 제약은 풀어서 신규 INSERT 시 옵셔널화
--      (deprecated 컬럼은 즉시 drop 하지 않고 한 사이클 유지 — 롤백 안전망)
--   5) GIN 인덱스 + 검색 인덱스에 brands 통합
-- =====================================================================

-- ---- 1) 새 배열 컬럼 ----
alter table public.cases
  add column if not exists brands              text[],
  add column if not exists platforms           text[],
  add column if not exists infringement_types  text[],
  add column if not exists post_urls           text[];


-- ---- 2) 기존 단일값을 배열로 복사 ----
update public.cases
   set brands = case
                  when brand is not null and length(trim(brand)) > 0
                  then array[brand]
                  else '{}'::text[]
                end
 where brands is null;

update public.cases
   set platforms = case
                     when platform is not null and length(trim(platform)) > 0
                     then array[platform]
                     when platform_other is not null and length(trim(platform_other)) > 0
                     then array[platform_other]
                     else '{}'::text[]
                   end
 where platforms is null;

update public.cases
   set infringement_types = case
                              when infringement_type is not null and length(trim(infringement_type)) > 0
                              then array[infringement_type]
                              else '{}'::text[]
                            end
 where infringement_types is null;

update public.cases
   set post_urls = case
                     when post_url is not null and length(trim(post_url)) > 0
                     then array[post_url]
                     else '{}'::text[]
                   end
 where post_urls is null;


-- ---- 3) 새 컬럼 NOT NULL + default ----
alter table public.cases
  alter column brands             set default '{}'::text[],
  alter column brands             set not null,
  alter column platforms          set default '{}'::text[],
  alter column platforms          set not null,
  alter column infringement_types set default '{}'::text[],
  alter column infringement_types set not null,
  alter column post_urls          set default '{}'::text[],
  alter column post_urls          set not null;


-- ---- 4) 기존 단일 컬럼은 옵셔널화 (deprecated, 다음 사이클에서 drop 예정) ----
alter table public.cases
  alter column brand             drop not null,
  alter column platform          drop not null,
  alter column infringement_type drop not null;


-- ---- 5) 인덱스 ----
-- 배열 contains/overlaps 쿼리용 GIN
create index if not exists idx_cases_brands_gin
  on public.cases using gin(brands);
create index if not exists idx_cases_platforms_gin
  on public.cases using gin(platforms);
create index if not exists idx_cases_inf_types_gin
  on public.cases using gin(infringement_types);

-- 통합 검색 인덱스 — title + body_text 만 인덱싱
-- (brands 는 array_to_string 이 STABLE 이라 인덱스 표현식에 못 들어감.
--  brand 매칭은 별도 idx_cases_brands_gin 으로 .contains() 필터에서 처리.)
drop index if exists idx_cases_search;
create index if not exists idx_cases_search on public.cases
  using gin (
    to_tsvector(
      'simple',
      coalesce(title,'') || ' ' || coalesce(body_text,'')
    )
  );
