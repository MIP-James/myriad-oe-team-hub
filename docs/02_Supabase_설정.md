# 02. Supabase 설정

Supabase = 무료 백엔드. **DB + 로그인 + 파일 저장 + 실시간 통신**을 한 번에 제공합니다.

## 1. 계정 만들기

1. https://supabase.com 접속 → 우측 상단 **Start your project** (또는 Sign up) 클릭
2. **Continue with GitHub** 로 가입 (GitHub 계정 없으면 먼저 github.com 가입)
3. 무료 플랜이 기본입니다 — 카드 등록 안 해도 됩니다.

## 2. 새 프로젝트 생성

1. 대시보드에서 **New Project** 클릭
2. Organization 선택 (첫 가입이면 자동 생성됨)
3. 입력값:
   - **Name**: `myriad-team-hub` (아무 이름이나 OK)
   - **Database Password**: 랜덤 생성 버튼 클릭 → **반드시 안전한 곳에 저장** (비밀번호 관리 앱 추천)
   - **Region**: `Northeast Asia (Seoul)` 선택 (한국팀이니 서울)
   - Pricing Plan: `Free` 그대로
4. **Create new project** 클릭
5. ⏳ 1~2분 기다리면 프로젝트가 생성됩니다.

## 3. API 키 복사

프로젝트 생성 후:

1. 왼쪽 사이드바 **⚙️ Project Settings** → **API** 클릭
2. 복사할 두 값:
   - **Project URL** (예: `https://abcdefgh.supabase.co`)
   - **Project API keys** → `anon` `public` 키 (길이가 긴 문자열, `eyJ...` 로 시작)
3. 이 두 값을 `myriad-team-hub/.env.local` 에 붙여넣기:
   ```
   VITE_SUPABASE_URL=https://abcdefgh.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
   VITE_ALLOWED_EMAIL_DOMAIN=myriadip.com
   ```

> ⚠️ **`service_role` 키는 절대 복사하지 마세요.** 그건 서버 전용이고, 유출되면 DB 전체 권한이 털립니다.

## 4. DB 스키마 만들기

1. Supabase 대시보드 왼쪽 사이드바 **🗄️ SQL Editor** 클릭
2. **New query** 클릭
3. 프로젝트의 [supabase/migrations/001_initial_schema.sql](../supabase/migrations/001_initial_schema.sql) 파일 내용을 **전부 복사**
4. SQL Editor에 붙여넣기
5. 우측 하단 **Run** 클릭 (또는 Ctrl+Enter)
6. 하단에 "Success. No rows returned" 뜨면 완료 ✅

생성되는 것:
- `profiles` 테이블 (사용자 프로필)
- `schedules` 테이블 (일정)
- `memos` 테이블 (메모)
- RLS 정책 (본인 데이터만 접근 가능)
- 자동 프로필 생성 트리거

## 5. Google OAuth 활성화 준비

1. 사이드바 **🔐 Authentication** → **Providers** 클릭
2. **Google** 찾아서 클릭
3. **Enable Google provider** 토글 ON
4. 이 화면에 두 개 필드가 있습니다:
   - Client ID (for OAuth)
   - Client Secret (for OAuth)
5. 아직 비워두세요 — 값은 **03_Google_OAuth_설정** 가이드에서 받아 옵니다.
6. 화면 하단 **Callback URL (for OAuth)** 값을 **복사해서 임시로 메모장에 저장**
   - 예시: `https://abcdefgh.supabase.co/auth/v1/callback`
   - 이 값은 Google 설정에서 필요합니다.

이제 [03_Google_OAuth_설정.md](./03_Google_OAuth_설정.md) 로 넘어가세요.

---

## 부록: Supabase 일시정지 방지

Supabase 무료 플랜은 **7일 동안 DB 요청이 0건**이면 자동 일시정지됩니다.
팀이 매일 로그인/조회를 하면 문제없지만, 장기 휴가 등으로 비는 경우 대비:

**옵션 A — UptimeRobot (무료, 권장)**
1. https://uptimerobot.com 가입
2. Add New Monitor → HTTP(s)
3. URL: `https://abcdefgh.supabase.co/rest/v1/profiles?select=id&limit=1`
4. Headers:
   - `apikey`: `anon` 키
5. Interval: 5 minutes
6. 저장 — 이제 자동으로 ping됨

**옵션 B — 그냥 놔두기**
일시정지되어도 Supabase 대시보드에서 1클릭으로 재개 가능.
