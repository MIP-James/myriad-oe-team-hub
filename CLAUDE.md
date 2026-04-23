# Myriad Team Hub — Claude 기본 세팅

이 프로젝트에서 작업할 때는 아래 규칙을 **항상** 따릅니다. (사용자가 매번 요청하지 않아도 기본 적용)

## 현재 페이즈 (2026-04-23 기준)

**1차 개발 (Phase 1~9) 완료 → 운영 유지보수 페이즈.**
- 모든 기능 배포 + 팀 실사용 투입 상태
- 신규 작업은 3종으로 분류:
  1. 신규 유틸리티 개발 + 추가
  2. 기존 유틸리티 업데이트 (`release.bat <slug>` 한 줄)
  3. 웹 페이지 기능 추가 / 수정 / 픽스
- 자세한 운영 워크플로우는 메모리 `feedback_operations_phase.md` 참고

## 사용자 프로필
- 비개발자 — 구현은 Claude가 전담, 사용자는 테스트/피드백 담당
- 한국어 응답. 기술 용어는 필요할 때 짧은 한국어 설명 동반
- 선택지 나열보다 "이게 최선이고 이유는 X" 식 단정적 제안
- 복잡도 부담 표현 시 (예: "복잡해지네", "큰 허들이야") 즉시 백로그로 보내고 종료 — 푸시하지 않음

## 작업 위치 규칙 (중요)
- **기본 작업 위치는 메인 디렉토리 + main 브랜치**: `C:\Users\MIP James\Downloads\Claude Project`
- **worktree / feature branch 자발적으로 만들지 않음** — 사용자는 main 에 직접 커밋하는 걸 선호
- Agent 도구 호출할 때 `isolation: "worktree"` 파라미터 사용 금지
- 세션이 이미 worktree 에서 시작됐으면(시스템 프롬프트 확인) 그대로 진행하되 마지막에 main 병합 cmd 제공

## 작업 완료 시 기본 출력 (SQL/git 변경 없는 경우 해당 항목만 생략)

### 1. ⚠️ Supabase SQL 업로드 (DB 스키마 변경 시 — git push 보다 먼저!)
```
경로: C:\Users\MIP James\Downloads\Claude Project\supabase\migrations\NNN_xxx.sql
→ 파일 열어서 Supabase SQL Editor 에 붙여넣고 Run
```
**이 단계 빠뜨리면 페이지 진입 시 "Could not find the table" 또는 RLS 정책 위반 에러 발생.**
응답에서 cmd 블록보다 먼저 배치 + 명시적 경고 ("⚠️ SQL 먼저 실행 안 하면 페이지 깨집니다") 포함.

### 2. Cloudflare 자동 배포 트리거 (cmd 복붙 가능한 형태로)
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

**같은 날 두 번 배포:** `--replace` 또는 `--version 2026-04-23b`

**런처 자체 재배포:**
```cmd
cd /d "C:\Users\MIP James\Downloads\Claude Project\utilities\launcher"
build.bat

cd /d "C:\Users\MIP James\Downloads\Claude Project\admin-scripts"
release_launcher.bat
```

**신규 유틸 추가:** `feedback_operations_phase.md` 의 ① 절차 따름 (release_config.json 등록 + Supabase utilities 행 등록 + release.bat).

## 기술 스택 요약
- **Frontend**: React 19 + Vite + Tailwind + react-router-dom v7
- **에디터**: TipTap 3.x (StarterKit + Link + Underline + Placeholder + TextAlign)
- **Backend**: Supabase (DB/Auth/Storage/Realtime) — free tier
- **Hosting**: Cloudflare Pages (main 브랜치 push → 자동 배포)
- **Repo**: `MIP-James/myriad-oe-team-hub` (public)
- **Auth**: Google Workspace SSO, 도메인 `@myriadip.com` 제한
  - Scope: `drive` + `gmail.readonly` (둘 다 필수)
- **Drive**: 공유 드라이브 사용 시 `supportsAllDrives=true` 필수
- **Admin DB writes**: `admin-scripts/.env` 의 Service Role 키 사용 (사용자 세션과 토큰 충돌 방지)
- **Migrations**: 1~18 모두 실행 완료 (다음 신규 = 019 부터)

## 코드 구조 빠른 참조

```
myriad-team-hub/src/
├── App.jsx              ← 라우팅
├── main.jsx
├── index.css            ← .case-prose / .tiptap-editor 마크다운 스타일
├── components/
│   ├── Layout.jsx       ← 사이드바 nav + useDailyReminder
│   ├── ProtectedRoute.jsx
│   ├── AdminGate.jsx
│   ├── Autocomplete.jsx ← 자유입력+자동완성 (재사용)
│   ├── CaseEditor.jsx   ← TipTap + 첨부 + Gmail import
│   ├── CasesTab.jsx     ← 커뮤니티 케이스 탭
│   ├── BrandReportComments.jsx
│   ├── WeeklyPlanModal.jsx
│   ├── DailyRecordModal.jsx
│   └── ReminderSettingsModal.jsx
├── contexts/
│   └── AuthContext.jsx  ← OAuth + Google access_token 보관
├── hooks/
│   └── useDailyReminder.js
├── lib/
│   ├── supabase.js
│   ├── community.js     ← 공지/활동 피드/프로필 헬퍼
│   ├── cases.js         ← 케이스 + 첨부 + 댓글
│   ├── weekly.js        ← 주간계획/일일기록/리마인더
│   ├── comments.js      ← 브랜드 보고서 댓글
│   ├── reportStore.js
│   ├── reportGenerator.js  ← Excel 생성
│   ├── googleDrive.js   ← Drive API + GoogleAuthRequiredError
│   ├── gmail.js         ← Gmail API + permmsgid 파싱
│   ├── users.js         ← 사용자 관리 (역할 변경)
│   ├── externalShortcuts.js
│   ├── platformBrandLists.js  ← 케이스 자동완성 마스터
│   └── dateHelpers.js   ← ISO 주 계산
└── pages/
    ├── Dashboard.jsx    ← 빠른가기 + 위젯 + 외부 바로가기
    ├── Login.jsx
    ├── Schedules.jsx    ← 캘린더 + 주간계획 + 일일기록
    ├── Memos.jsx
    ├── Utilities.jsx
    ├── Launcher.jsx
    ├── Jobs.jsx
    ├── SharedSheets.jsx
    ├── Reports.jsx
    ├── ReportGroups.jsx
    ├── ReportGroupDetail.jsx
    ├── Community.jsx
    ├── CaseDetail.jsx
    ├── Admin.jsx
    ├── AdminUtilities.jsx
    ├── AdminSharedSheets.jsx
    ├── AdminExternalShortcuts.jsx
    ├── AdminUsers.jsx
    └── NotFound.jsx
```

## 주의사항
- Windows 배치(.bat) 파일에 **한글 금지** — CMD 파싱 실패. 한글은 Python 출력만
- ExcelJS 세로 정렬: `vertical: 'middle'` (NOT 'center')
- Realtime 구독에 필터 + DELETE 처리 시 `replica identity full` 필수
- 한글 IME 안전한 Enter: `e.nativeEvent?.isComposing` 체크
- 신규 패키지 설치 후 Cloudflare `npm ci` 실패 시: `rm -rf node_modules package-lock.json && npm install`
- 자세한 12개 함정 모음: `feedback_technical_gotchas.md`

## 메모리 인덱스 (이 프로젝트 메모리 위치)

`C:\Users\MIP James\.claude\projects\C--Users-MIP-James-Downloads-Claude-Project\memory\`

핵심 메모리:
- `project_myriad_team_hub.md` — 프로젝트 전체 상태 + Phase 진행 + 마이그레이션 목록
- `feedback_operations_phase.md` — 운영 페이즈 작업 분류 + 표준 절차 (3종 + 픽스 + UI)
- `feedback_ui_patterns.md` — 재사용 가능한 컴포넌트/CSS/UX 패턴
- `feedback_technical_gotchas.md` — 12개 기술 함정 + 해결법
- `feedback_delivery_format.md` — 작업 결과 전달 형식
- `feedback_work_on_main.md` — main 브랜치 직접 작업 원칙
- `project_admin_scripts.md` — release.bat / slug 매핑
- `project_utilities_inventory.md` — 5종 EXE + 1종 확장 인벤토리
- `project_backlog.md` — 보류 기능 (PWA push, Notion 자동 보고 등)
- `project_stack_constraints.md` — free tier 제약 + 호스팅 결정
- `user_role.md` — 사용자 협업 스타일
