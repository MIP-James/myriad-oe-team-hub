-- =====================================================================
-- MYRIAD Team Hub - Phase 4.3 마이그레이션
-- utilities 테이블에 entry_exe 컬럼 추가 (자동 다운로드/설치 지원)
-- Supabase SQL Editor에 붙여넣고 "Run"
-- =====================================================================

-- entry_exe: download_url 이 ZIP 일 때 압축 해제 후 실행할 상대 경로
-- 예: "MYRIAD_Enforcement_Tools/MYRIAD_Enforcement_Tools.exe"
-- 단일 EXE 다운로드면 NULL 로 두면 됨 (URL 자체가 실행파일)
alter table public.utilities
  add column if not exists entry_exe text;

-- 참고: download_url 이 .zip 으로 끝나거나 실제 ZIP 이면 압축 해제 후
-- target_dir/entry_exe 를 실행. .exe 로 끝나면 다운로드된 파일을 그대로 실행.
comment on column public.utilities.entry_exe is
  'ZIP 다운로드 시 압축 해제 후 실행할 상대 경로. 단일 EXE 면 NULL.';
