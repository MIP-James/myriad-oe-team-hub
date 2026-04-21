# 04. Cloudflare Pages 배포 — 처음부터 차근차근

Cloudflare Pages = **정적 웹사이트 무료 호스팅 서비스**.
GitHub 저장소와 연결해두면, 코드를 push할 때마다 자동으로 새 버전이 배포됩니다.

## 왜 Cloudflare Pages인가?

| 기능 | Cloudflare Pages |
|---|---|
| 비용 | 완전 무료 (트래픽/빌드 충분) |
| HTTPS | 자동 (별도 설정 無) |
| 기본 도메인 | `myriad-oe-team-hub.pages.dev` (원하면 커스텀 도메인 연결 가능) |
| 배포 | GitHub push 시 자동 |
| 속도 | 전 세계 300+개 서버로 배포 → 한국에서 매우 빠름 |

## 전체 흐름

```
코드 (로컬) ──git push──→ GitHub 저장소 ──자동──→ Cloudflare Pages ──→ 공개 URL
```

---

## Step 1. GitHub 준비

### 1-1. GitHub 계정 만들기 (이미 있으면 건너뛰기)

1. https://github.com → **Sign up**
2. 이메일 (회사 계정 권장) / 비밀번호 / username 입력
3. 이메일 인증 완료

### 1-2. 새 저장소 만들기

1. 로그인 후 우측 상단 **+** 아이콘 → **New repository**
2. 입력:
   - **Repository name**: `myriad-oe-team-hub`
   - **Description**: (비워도 됨)
   - **Private** 선택 ⚠️ (회사 프로젝트니까 반드시 Private!)
   - "Add a README file" **체크 안 함**
   - "Add .gitignore" **체크 안 함**
3. **Create repository** 클릭
4. 다음 화면의 **HTTPS URL** 복사해두기 (예: `https://github.com/MIP-James/myriad-oe-team-hub.git`)

### 1-3. Git 설치 (이미 있으면 건너뛰기)

PowerShell에서 `git --version` 입력해서 버전 번호가 나오면 이미 설치됨. 안 나오면:

1. https://git-scm.com/download/win → 다운로드 → 설치 (전부 Next)

### 1-4. 로컬 코드를 GitHub에 올리기

PowerShell에서 **한 줄씩** 실행하세요 (복붙 가능):

```powershell
cd "C:\Users\MIP James\Downloads\Claude Project"
```
```powershell
git config --global user.email "본인이메일@myriadip.com"
```
```powershell
git config --global user.name "본인이름"
```
```powershell
git init
```
```powershell
git add .
```
```powershell
git commit -m "초기 커밋: Phase 1 스캐폴딩"
```
```powershell
git branch -M main
```
```powershell
git remote add origin https://github.com/MIP-James/myriad-oe-team-hub.git
```
```powershell
git push -u origin main
```

- 처음 두 줄의 이메일/이름은 본인 것으로 바꿔주세요 (이미 설정되어 있으면 건너뛰기)
- push할 때 브라우저가 열리며 GitHub 로그인 요구 → 로그인/승인
- 성공하면 GitHub 저장소 새로고침 시 파일들이 보임

### 이미 꼬였을 때 복구

실수로 `git remote add origin` 을 잘못된 URL로 해버렸다면:
```powershell
git remote set-url origin https://github.com/MIP-James/myriad-oe-team-hub.git
```

커밋 없이 push 했다면 위 `git add .` + `git commit` 부터 다시 실행하면 됩니다.

> ⚠️ `.env.local` 파일은 `.gitignore` 덕분에 **자동으로 제외됨**. API 키는 GitHub에 안 올라갑니다. (올라가면 안 됨!)

---

## Step 2. Cloudflare 계정 만들기

1. https://dash.cloudflare.com/sign-up 접속
2. 이메일 + 비밀번호로 가입
3. 이메일 인증 링크 클릭
4. 로그인 완료 — 대시보드가 열립니다.

(카드 등록 필요 없음, 무료)

---

## Step 3. Pages 프로젝트 생성

### 3-1. Compute 메뉴로 이동 (구 "Workers & Pages")

> 🆕 Cloudflare UI 개편 후 "Workers & Pages" 는 **Compute** 메뉴로 통합됐습니다.

1. Cloudflare 대시보드 왼쪽 사이드바 **Build** 섹션 → **⚡ Compute** 클릭
2. 화면에 탭이 있으면 **Pages** 선택 (또는 "Import an existing Git repository" 버튼)
3. **Create** → **Pages** → **Connect to Git**

### 3-2. GitHub 연동

1. **Connect GitHub** 버튼 클릭
2. 새 창에서 GitHub 로그인 (아직 안 되어 있으면)
3. **Install & Authorize Cloudflare Pages**
4. 권한 범위 선택:
   - **Only select repositories** 선택 → `myriad-oe-team-hub` 저장소만 체크
   - (또는 **All repositories** 도 OK — 편의상)
5. **Install** 클릭
6. Cloudflare 창으로 돌아옴 → 저장소 목록에 `myriad-oe-team-hub` 나타남
7. 저장소 옆 **Begin setup** 클릭

### 3-3. 빌드 설정

다음 화면에서 **이 값들을 정확히 입력**하세요:

| 항목 | 값 |
|---|---|
| **Project name** | `myriad-oe-team-hub` (기본값 그대로 OK) |
| **Production branch** | `main` |
| **Framework preset** | `None` (없음) — Vite 프리셋이 없어진 경우 직접 입력 |
| **Build command** | `npm run build` |
| **Build output directory** | `dist` |
| **Root directory (advanced)** | `myriad-team-hub` ⚠️ 중요 (이건 **로컬 폴더 이름** 그대로) |

> 💡 예전에는 Vite 프리셋이 있었지만 최근 제거됐습니다 (Cloudflare가 자동 감지). 프리셋을 "None"으로 두고 Build command/output directory만 직접 입력하면 됩니다. "VitePress"는 다른 도구이니 선택하지 마세요.

> ⚠️ **Root directory가 제일 중요합니다.**
> 우리 프로젝트는 저장소(`myriad-oe-team-hub`) 안에 `myriad-team-hub/` 하위 폴더로 앱이 있기 때문입니다.
> "Root directory" 항목을 펼쳐서 (advanced) `myriad-team-hub` 를 입력해야 합니다. (저장소 이름이 아니라 **폴더 이름**!)

### 3-4. 환경 변수 설정

같은 화면 하단 **Environment variables (advanced)** 펼치기 → **Add variable**로 3개 추가:

| Variable name | Value |
|---|---|
| `VITE_SUPABASE_URL` | (Supabase에서 복사한 Project URL) |
| `VITE_SUPABASE_ANON_KEY` | (Supabase에서 복사한 anon public key) |
| `VITE_ALLOWED_EMAIL_DOMAIN` | `myriadip.com` |

### 3-5. 배포 시작

1. 화면 하단 **Save and Deploy** 클릭
2. ⏳ 2~4분 기다리기 (첫 빌드는 약간 오래)
3. "Success! Your project is live 🎉" 나오면 완료
4. 상단에 URL 표시됨: `https://myriad-oe-team-hub.pages.dev`

### 3-6. Google OAuth 리다이렉트 URI 업데이트

이제 실제 Cloudflare URL이 생겼으니, Google Cloud Console에 등록해줘야 합니다:

1. Google Cloud Console → **API 및 서비스** → **사용자 인증 정보**
2. 만들어둔 OAuth 클라이언트 ID 클릭
3. **승인된 JavaScript 원본**에 `https://myriad-oe-team-hub.pages.dev` 추가
4. **저장**

> 💡 Supabase의 **Authentication → URL Configuration** 에도 `Site URL`을 `https://myriad-oe-team-hub.pages.dev` 로 설정하는 걸 권장합니다.

---

## Step 4. 동작 확인

1. 브라우저에서 `https://myriad-oe-team-hub.pages.dev` 접속
2. 로그인 화면 확인 → **Google 계정으로 로그인**
3. `@myriadip.com` 계정으로 로그인 → 대시보드 진입 ✅

---

## 앞으로 업데이트하는 방법

코드 수정 후:

```powershell
cd "C:\Users\MIP James\Downloads\Claude Project"
git add .
git commit -m "무엇을 바꿨는지 메모"
git push
```

→ Cloudflare가 **자동 감지**해서 새 버전 빌드 & 배포 (보통 1~2분).

진행 상황은 Cloudflare 대시보드 → Workers & Pages → 프로젝트 클릭 → **Deployments** 탭에서 볼 수 있습니다.

---

## (선택) 커스텀 도메인 연결

`myriad-oe-team-hub.pages.dev` 대신 `hub.myriadip.com` 같은 주소를 쓰고 싶다면:

1. Cloudflare 대시보드 → 프로젝트 → **Custom domains** 탭
2. **Set up a custom domain** → 원하는 주소 입력
3. 도메인이 Cloudflare에서 관리 중이면 자동 처리
4. 외부 도메인이면 DNS 설정 안내에 따라 CNAME 추가

> ⚠️ 도메인 구매/관리 자체는 별도 비용 (연 1~2만 원). 무료 서브도메인으로도 충분합니다.

---

## 자주 묻는 문제

**빌드 실패 — "Build failed"**
- Cloudflare Deployments 탭 → 실패한 deploy 클릭 → 로그 확인
- 보통 원인:
  - Root directory가 `myriad-team-hub` 으로 설정 안 됨
  - 환경 변수 오타

**로그인해도 다시 로그인 화면으로 돌아가요 (무한 루프)**
- Supabase 대시보드 → Authentication → URL Configuration
- **Site URL**에 `https://myriad-oe-team-hub.pages.dev` 설정
- **Redirect URLs**에 `https://myriad-oe-team-hub.pages.dev/**` 추가

**라우트가 404로 떠요 (예: `/utilities` 새로고침 시)**
- `public/_redirects` 파일이 있는지 확인 (이미 포함되어 있어야 함)
- 내용: `/*  /index.html  200`
- 이게 SPA 라우팅 fallback을 Cloudflare에 알려줍니다.

**비공개 저장소인데 Cloudflare가 접근 못 해요**
- GitHub 설정 → Applications → Cloudflare Pages → 저장소 권한 확인
