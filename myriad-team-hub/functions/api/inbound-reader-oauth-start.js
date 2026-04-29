/**
 * Cloudflare Pages Function — Inbound Gmail Reader OAuth 동의 페이지 redirect.
 *
 * 흐름:
 *   1) 프론트가 Authorization 헤더로 호출 → JWT 검증 → user.id 확보
 *   2) HMAC 서명된 state 생성 (CSRF 방지)
 *   3) Google OAuth authorize URL (Gmail readonly + offline access) 만들어서 응답
 *   4) 프론트가 받은 url 로 window.location.href 이동
 *
 * 환경변수:
 *   - SUPABASE_URL / SUPABASE_ANON_KEY  (JWT 검증)
 *   - GOOGLE_OAUTH_CLIENT_ID            (Google Cloud OAuth client)
 *   - INBOUND_OAUTH_STATE_SECRET        (state HMAC 키 — 임의 랜덤 문자열)
 *
 * Reader 단일성:
 *   현재 정책상 활성 reader 는 1명 (skylar). 다른 사람이 등록 시도하면 기존
 *   reader 는 자동 비활성화. 향후 다중 reader 필요 시 정책 변경.
 */
import { createClient } from '@supabase/supabase-js'

const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly'

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const authHeader = request.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401)

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: '인증 실패' }, 401)

    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.INBOUND_OAUTH_STATE_SECRET) {
      return json({
        error: 'OAuth 환경변수가 설정되지 않았습니다 (GOOGLE_OAUTH_CLIENT_ID / INBOUND_OAUTH_STATE_SECRET).'
      }, 500)
    }

    // state 생성 — HMAC 서명 (user.id . timestamp . nonce . sig)
    const ts = Date.now().toString()
    const nonce = crypto.randomUUID()
    const payload = `${user.id}.${ts}.${nonce}`
    const sig = await hmacSha256(env.INBOUND_OAUTH_STATE_SECRET, payload)
    const state = b64urlEncode(`${payload}.${sig}`)

    // redirect URI — 요청 origin 사용
    const url = new URL(request.url)
    const redirectUri = `${url.origin}/api/inbound-reader-oauth-callback`

    // Google OAuth — offline access (refresh_token 발급) + consent prompt 강제
    // (이미 로그인 세션 중이라도 새 동의 흐름 거치게 — 명확한 사용자 의도 확인)
    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',          // refresh_token 발급
      prompt: 'consent',               // 매번 동의 화면 (refresh_token 누락 방지)
      include_granted_scopes: 'true',
      login_hint: user.email || '',    // 본인 계정 자동 선택 힌트
      redirect_uri: redirectUri,
      state
    }).toString()

    return json({ url: authUrl })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

async function hmacSha256(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
