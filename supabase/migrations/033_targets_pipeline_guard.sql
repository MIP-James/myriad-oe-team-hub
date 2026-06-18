-- =====================================================================
-- Phase 18c — 재침해자 스코어링: 신원 완화 + 모니터링 주력 공급원 가드
--
-- 배경:
--   (1) 신원(사업자/전화/대표자) 미상이면 축1을 0점으로 깔던 하드 게이트를 제거.
--       SNS(밴드/카스/인스타) 모니터링이 주력인 브랜드는 연락처 공란이 수집 과정상
--       정상 → '가치 0'이 아니라 '확인 선행' 플래그로만 표시(scoreEngine PARAMS).
--   (2) 한 운영자가 브랜드 수집(삭제건수)의 일정 비율(기본 40%) 이상을 차지하면
--       '모니터링 주력 공급원'으로 보고 A(즉시 제거 타겟) 진입을 차단(B/C만).
--       법적 제거 시 모니터링 물량이 붕괴해 업무에 차질 → 제거 대상에서 제외.
--       점유율은 "최근 N개월" 창 기준(전량 누적 X), 창 길이는 브랜드 보고 주기별.
--
-- 이 마이그레이션은 위 (2)를 영속화하기 위한 컬럼 2개 추가뿐. 점수/등급 로직은
-- functions/api/_lib/scoreEngine.js + src/lib/targets.js(applyScopeGrades) 가 담당.
--
-- ⚠️ 기존 테이블 컬럼 추가 → GRANT/RLS 는 032 의 테이블 단위 설정을 그대로 상속.
-- =====================================================================

alter table public.infringer_targets
  add column if not exists is_pipeline boolean not null default false,  -- 모니터링 주력 공급원 (A 제외 대상)
  add column if not exists brand_share int not null default 0,          -- 최근 창 기준 브랜드 수집 비율(%) — 최댓값
  add column if not exists pipeline_window int not null default 6;      -- 점유율 산정에 쓴 창 길이(개월) — 브랜드 보고주기별

-- 파이프라인만 빠르게 추리는 인덱스 (보드에서 별도 필터)
create index if not exists idx_targets_pipeline on public.infringer_targets(is_pipeline) where is_pipeline;
