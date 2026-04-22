# admin-scripts — 관리자 전용 도구

## release.py — 유틸 릴리즈 자동화

유틸 폴더를 수정한 뒤 명령 하나로 **ZIP 압축 + GitHub Releases 업로드 + Supabase DB 갱신**까지 원샷 처리.

### 사전 준비 (최초 1회)

1. **GitHub CLI 설치 + 로그인**
   ```powershell
   winget install GitHub.cli
   gh auth login
   ```
2. **Python + supabase 패키지** (런처 빌드 환경이면 이미 설치됨)
3. **MyriadSetup.exe 로 런처 설정 완료** — 이 스크립트가 거기 있는 토큰을 재사용합니다
4. `release_config.json` 에서 각 유틸의 **source_folder** 경로 확인/수정

### 사용 예시

```powershell
cd "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"

REM 기본 - 오늘 날짜를 버전으로, 메모 "업데이트"
release.bat report-generator

REM 메모 추가
release.bat report-generator "CSV 파싱 버그 수정"

REM 특정 버전 지정
release.bat report-generator --version 1.1.0 --notes "신규 기능 X 추가"

REM 같은 태그 이미 있으면 덮어쓰기
release.bat report-generator --replace
```

### 등록된 slug

`release_config.json` 의 `utilities` 키 참고:
- `myriad-enforcement-tools`
- `market-image-matcher`
- `report-generator`
- `ip-report-editor`

새 유틸 추가는 `release_config.json` 에 항목 추가 + 웹 `/admin/utilities` 에도 초기 등록.

### 실행 흐름

```
release.bat report-generator "수정 노트"
  ↓
[1] source_folder 확인 (예: C:\...\Report_Generator)
[2] ZIP 생성 (임시 폴더)
[3] gh release create report-generator-v2026-04-22 ...
    (새 태그가 이미 있으면 --replace 없이는 중단)
[4] Supabase utilities 테이블 업데이트:
    - download_url = https://github.com/.../Report_Generator.zip
    - current_version = 2026-04-22
    - release_notes = "수정 노트"
  ↓
팀원 런처가 다음 실행 시 자동 재다운로드 (current_version 변경 감지)
```

### 주의

- **같은 날짜에 두 번 릴리즈** 하려면 `--replace` 또는 `--version 2026-04-22b` 같이 접미사 사용
- Supabase 에 해당 slug 의 행이 없으면 실패 — 웹 `/admin/utilities` 에서 먼저 생성하세요
- source_folder 는 `Report_Generator` 처럼 **폴더**를 가리킴. 단일 EXE 를 가리키면 그 파일 하나만 ZIP 됨
