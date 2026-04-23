-- =====================================================================
-- MYRIAD Team Hub - Phase 8 hotfix
-- 케이스 플랫폼을 자유 입력으로 (CHECK 제약 제거)
--
--   기존: cases.platform 이 enum 10종 + '기타' 일 때 platform_other 분리 입력
--   변경: 마스터 리스트(엑셀 기반) 자동완성 + 필드에 없는 값도 자유 입력 허용
--
-- platform_other 컬럼은 기존 데이터 보존 위해 그대로 두고, 신규 입력에서는 사용 안 함.
-- 마스터 리스트는 src/lib/platformBrandLists.js 에 정적 임베드.
-- =====================================================================

alter table public.cases
  drop constraint if exists cases_platform_chk;

-- (옵션) 기존 platform = '기타' + platform_other 채워진 행을 통합:
--   platform_other 값을 platform 으로 옮기고 platform_other 비움.
update public.cases
  set platform = platform_other,
      platform_other = null
  where platform = '기타'
    and platform_other is not null
    and length(trim(platform_other)) > 0;
