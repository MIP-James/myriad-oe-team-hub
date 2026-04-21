# 03. Google OAuth 설정

목표: **`@myriadip.com` 계정만** 이 사이트에 로그인할 수 있게 설정.

> ⚠️ 이 작업은 Google Workspace **관리자 계정**이거나, 본인이 소유한 Google 계정으로 하는 것이 좋습니다.
> 개인용으로 아무 Gmail 계정으로도 진행 가능하지만, 앱 소유자가 됩니다.

## 1. Google Cloud Console 접속

1. https://console.cloud.google.com 접속
2. 회사 Gmail (`@myriadip.com`) 또는 본인 계정으로 로그인
3. 처음이면 약관 동의 → 국가 선택 (대한민국)

## 2. 프로젝트 생성

1. 화면 상단 **프로젝트 선택** 드롭다운 클릭
2. 우측 상단 **새 프로젝트** 클릭
3. 프로젝트 이름: `myriad-team-hub` (아무거나)
4. **만들기**
5. 생성 완료되면 다시 프로젝트 드롭다운에서 새 프로젝트 선택

## 3. OAuth 동의 화면 설정

좌측 사이드바 (☰ 햄버거) → **API 및 서비스** → **OAuth 동의 화면**

### User Type 선택

- **Internal** (Google Workspace 조직 내부만) — `@myriadip.com` 소속이고 Workspace 관리자 권한 있으면 이걸 선택하세요. 가장 간단.
- **External** (외부) — Workspace 관리자가 아니면 이걸 선택. 대신 테스트 사용자를 수동으로 추가해야 합니다.

> 💡 **Internal 가능하면 Internal 강추** — 자동으로 도메인이 제한되고, 심사도 필요 없습니다.

### 앱 정보 입력

1. 앱 이름: `MYRIAD Team Hub`
2. 사용자 지원 이메일: 본인 이메일
3. 앱 로고: 선택 (건너뛰기 가능)
4. 앱 도메인: 일단 비워두기
5. 개발자 연락처 정보: 본인 이메일
6. **저장 후 계속**

### 범위 (Scopes)

- **범위 추가 또는 삭제** 클릭
- 다음 3개 체크 (기본 프로필 정보):
  - `.../auth/userinfo.email`
  - `.../auth/userinfo.profile`
  - `openid`
- **업데이트** → **저장 후 계속**

### 테스트 사용자 (External 선택 시에만)

- External로 했다면 팀원 6명의 `@myriadip.com` 이메일 추가
- **저장 후 계속**

## 4. OAuth 클라이언트 ID 만들기

좌측 사이드바 → **API 및 서비스** → **사용자 인증 정보**

1. 상단 **+ 사용자 인증 정보 만들기** → **OAuth 클라이언트 ID**
2. 애플리케이션 유형: **웹 애플리케이션**
3. 이름: `MYRIAD Team Hub Web`
4. **승인된 JavaScript 원본** (+ URI 추가 버튼으로 여러 개):
   - `http://localhost:5173` (로컬 개발용)
   - `https://myriad-team-hub.pages.dev` (Cloudflare 배포용 — 실제 주소는 나중에 확정되면 수정)
5. **승인된 리디렉션 URI**:
   - Supabase 대시보드에서 복사해둔 **Callback URL** 붙여넣기
   - 예: `https://abcdefgh.supabase.co/auth/v1/callback`
6. **만들기**
7. 팝업에 **클라이언트 ID**와 **클라이언트 보안 비밀번호(Client Secret)** 가 나옵니다.
   - **둘 다 복사해서 메모장에 저장** (이 창 닫으면 Secret은 다시 볼 때 약간 번거로움)

## 5. Supabase에 키 입력

1. Supabase 대시보드 → **Authentication** → **Providers** → **Google**
2. 방금 받은 값 붙여넣기:
   - **Client ID (for OAuth)**: Google에서 받은 클라이언트 ID
   - **Client Secret (for OAuth)**: Google에서 받은 보안 비밀번호
3. (선택) **Skip nonce check**: OFF 그대로 두세요
4. **Save**

## 6. 로그인 테스트

1. 프로젝트 폴더에서 `npm run dev`
2. 브라우저 http://localhost:5173 → **Google 계정으로 로그인** 클릭
3. `@myriadip.com` 계정으로 로그인 시 → 대시보드로 이동 ✅
4. 다른 도메인(예: `@gmail.com`) 으로 로그인 시도 → 에러 메시지 + 자동 로그아웃 ❌

## 자주 묻는 문제

**"Access blocked: This app's request is invalid"**
→ 리디렉션 URI가 Supabase Callback URL과 정확히 같은지 다시 확인. 끝에 `/` 붙이거나 빼거나 오타 주의.

**"이 앱이 확인되지 않았습니다" 경고**
→ External + 개인 계정일 때 정상. 테스트 사용자로 등록된 계정은 "고급" → "안전하지 않은 페이지로 이동"으로 진행 가능. Workspace Internal이면 이 경고 안 뜸.

**Cloudflare에 배포한 뒤 로그인이 안 돼요**
→ Google Cloud Console의 **승인된 JavaScript 원본**에 배포된 URL (예: `https://myriad-team-hub.pages.dev`) 추가하고 다시 저장.
