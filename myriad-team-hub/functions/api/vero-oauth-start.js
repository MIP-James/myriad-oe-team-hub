/**
 * Cloudflare Pages Function — VeRO reader(James 님 Gmail) OAuth 동의 시작.
 *
 *   POST /api/vero-oauth-start
 *
 * 기존 inbound-reader-oauth-start 와 거의 동일하나, VeRO 전용으로 분리:
 *   - 관리자만 시작 가능
 *   - state 에 'vero' 용도 표시 → 콜백이 purpose='vero' 로 저장
 *   - 콜백 redirect = /api/vero-oauth-callback (기존 케이스 reader 와 독립)
 *
 * ⚠️ 케이스 reader(skylar) 와 완전 분리 — 이 연동은 skylar 를 비활성화하지 않음.
 *
 * 환경변수: SUPABASE_URL / SUPABASE_ANON_KEY / GOOGLE_OAUTH_CLIENT_ID /
 *          INBOUND_OAUTH_STATE_SECRET (기존 것 재사용)
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

    // 관리자만 연동 시작
    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    if (profile?.role !== 'admin') return json({ error: '관리자 권한이 필요합니다.' }, 403)

    if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.INBOUND_OAUTH_STATE_SECRET) {
      return json({ error: 'OAuth 환경변수 누락 (GOOGLE_OAUTH_CLIENT_ID / INBOUND_OAUTH_STATE_SECRET).' }, 500)
    }

    const veroMailbox = env.VERO_MAILBOX || 'james@myriadip.com'

    // state — 'vero' 용도 표시 (콜백이 purpose 결정 + 메일함 검증)
    const ts = Date.now().toString()
    const nonce = crypto.randomUUID()
    const payload = `vero.${user.id}.${ts}.${nonce}`
    const sig = await hmacSha256(env.INBOUND_OAUTH_STATE_SECRET, payload)
    const state = b64urlEncode(`${payload}.${sig}`)

    const url = new URL(request.url)
    const redirectUri = `${url.origin}/api/vero-oauth-callback`

    const authUrl = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: env.GOOGLE_OAUTH_CLIENT_ID,
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
      include_granted_scopes: 'true',
      login_hint: veroMailbox,           // VeRO 계정(James) 자동 선택 힌트
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
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
