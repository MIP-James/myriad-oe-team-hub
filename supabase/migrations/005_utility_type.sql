-- =====================================================================
-- MYRIAD Team Hub - Phase 4.3+ 마이그레이션 005
-- 유틸 종류 구분 (executable vs download_only)
-- download_only: Chrome 확장 등 실행 불가한 유틸 → Downloads 폴더에 ZIP 저장
-- Supabase SQL Editor에 붙여넣고 "Run"
-- =====================================================================

alter table public.utilities
  add column if not exists utility_type text not null default 'executable';

-- 기존 행 명시적으로 executable 로 세팅 (null 안전)
update public.utilities set utility_type = 'executable' where utility_type is null;

-- 값 제약 추가 (기존 제약 있으면 drop 먼저 시도)
do $$
begin
  begin
    alter table public.utilities drop constraint if exists utilities_utility_type_check;
  exception when others then null;
  end;
  alter table public.utilities
    add constraint utilities_utility_type_check
    check (utility_type in ('executable', 'download_only'));
end $$;

comment on column public.utilities.utility_type is
  'executable: 런처가 자동 설치 + EXE 실행 / download_only: 런처가 파일을 사용자 Downloads 폴더에 다운로드 (Chrome 확장 등)';
