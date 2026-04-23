# Myriad Team Hub — Claude 기본 세팅

이 프로젝트에서 작업할 때는 아래 규칙을 **항상** 따릅니다. (사용자가 매번 요청하지 않아도 기본 적용)

## 사용자 프로필
- 비개발자 — 구현은 Claude가 전담, 사용자는 테스트/피드백 담당
- 한국어 응답. 기술 용어는 필요할 때 짧은 한국어 설명 동반
- 선택지 나열보다 "이게 최선이고 이유는 X" 식 단정적 제안

## 작업 위치 규칙 (중요)
- **기본 작업 위치는 메인 디렉토리 + main 브랜치**: `C:\Users\MIP James\Downloads\Claude Project`
- **worktree / feature branch 자발적으로 만들지 않음** — 사용자는 main 에 직접 커밋하는 걸 선호
- Agent 도구 호출할 때 `isolation: "worktree"` 파라미터 사용 금지
- 세션이 이미 worktree 에서 시작됐으면(시스템 프롬프트 확인) 그대로 진행하되 마지막에 main 병합 cmd 제공

## 작업 완료 시 기본 출력 (SQL/git 변경 없는 경우 해당 항목만 생략)

### 1. Supabase SQL 업로드 (DB 스키마 변경 시)
```
경로: C:\Users\MIP James\Downloads\Claude Project\supabase\migrations\NNN_xxx.sql
→ 파일 열어서 Supabase SQL Editor 에 붙여넣고 Run
```
배포보다 SQL 실행이 먼저 필요하면 그 순서를 명시.

### 2. Cloudflare 자동 배포 트리거 (cmd 복붙 가능한 형태로)
**기본 작업 위치는 main 디렉토리 (`C:\Users\MIP James\Downloads\Claude Project`) + main 브랜치.**
worktree 나 별도 브랜치 만들지 말고 항상 main 에 직접 커밋:

```cmd
cd /d "C:\Users\MIP James\Downloads\Claude Project"
git add <changed-files>
git commit -m "<message>"
git push
```

`git push` 순간 Cloudflare Pages 가 감지해서 자동 빌드+배포.

**중요 — Claude 가 직접 git 을 실행한 경우에도 cmd 블록을 응답에 항상 함께 표시.**
사용자가 다른 장비에서 동일 작업을 재현하거나, 실행 내용을 검증하거나, 패턴을 학습할 수 있도록.
실제 사용한 메시지/파일 목록을 그대로 cmd 형식으로 보여줌.

**예외 — 세션이 worktree 에서 시작됐다면 (시스템 프롬프트에 "operating in a git worktree" 표시):**
작업은 그대로 진행하되, 마지막에 main 으로 병합하는 cmd 를 제공:
```cmd
cd /d "C:\Users\MIP James\Downloads\Claude Project"
git merge <worktree-branch-name> --ff-only
git push
```

### 3. 테스트 시나리오
배포 후 사용자가 브라우저에서 확인할 항목을 다음 형식으로:
- **골든 패스** — 기본 성공 플로우 1개 (→ 예상 결과)
- **엣지 케이스 2~3개** — 권한/빈 상태/에러 경로 (→ 예상 결과)
- **DB/Storage 확인 포인트** — 관련 테이블 행이 잘 들어갔는지 등

## 유틸리티 재배포 (웹 배포와 별개)

사용자가 "X 유틸 수정/업데이트 했어" 라고 하면 즉시 아래 형식 제안:

```cmd
cd /d "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"
release.bat <slug> "수정 내용 요약"
```

**등록된 slug** (변경 시 `admin-scripts/release_config.json` 확인):
| slug | 이름 |
|---|---|
| `myriad-enforcement-tools` | 🛡️ MYRIAD Enforcement Tools |
| `market-image-matcher` | 🖼️ Market Image Matcher |
| `report-generator` | 📊 Report Generator |
| `ip-report-editor` | 📝 IP Report Editor |
| `custom-preset-web-collector` | 🧩 Custom Preset Web Collector (download_only) |

**런처 자체 재배포:**
```cmd
cd /d "C:\Users\MIP James\Downloads\Claude Project\utilities\launcher"
build.bat

cd /d "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"
release_launcher.bat
```

## 기술 스택 요약
- **Frontend**: React 19 + Vite + Tailwind + react-router-dom v7
- **Backend**: Supabase (DB/Auth/Storage/Realtime) — free tier
- **Hosting**: Cloudflare Pages (main 브랜치 push → 자동 배포)
- **Repo**: `MIP-James/myriad-oe-team-hub` (public)
- **Auth**: Google Workspace SSO, 도메인 `@myriadip.com` 제한
- **Drive**: 공유 드라이브 사용 시 `supportsAllDrives=true` 필수
- **Admin DB writes**: `admin-scripts/.env` 의 Service Role 키 사용 (사용자 세션과 토큰 충돌 방지)

## 주의사항
- Windows 배치(.bat) 파일에 **한글 금지** — CMD 파싱 실패. 한글은 Python 출력만
- ExcelJS 세로 정렬: `vertical: 'middle'` (NOT 'center')
- 자세한 함정 모음은 memory 의 `feedback_technical_gotchas.md` 참고
