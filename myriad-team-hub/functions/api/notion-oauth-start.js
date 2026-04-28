/**
 * Cloudflare Pages Function — 노션 OAuth 동의 페이지로 redirect.
 *
 * 흐름:
 *   1) 프론트가 Authorization 헤더로 호출 → JWT 검증 → user.id 확보
 *   2) HMAC 서명된 state 생성 (CSRF 방지)
 *   3) 노션 OAuth authorize URL 만들어서 응답 ({ url } JSON)
 *   4) 프론트가 받은 url 로 window.location.href 이동
 *
 * 환경변수:
 *   - SUPABASE_URL / SUPABASE_ANON_KEY  (JWT 검증)
 *   - NOTION_CLIENT_ID                  (OAuth client id)
 *   - NOTION_OAUTH_STATE_SECRET         (state HMAC 키 — 임의 랜덤 문자열)
 */
import { createClient } from '@supabase/supabase-js'

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    // JWT 검증
    const authHeader = request.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401)

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: '인증 실패' }, 401)

    if (!env.NOTION_CLIENT_ID || !env.NOTION_OAUTH_STATE_SECRET) {
      return json({ error: 'OAuth 환경변수가 설정되지 않았습니다.' }, 500)
    }

    // state 생성 — HMAC 서명 (user.id . timestamp . nonce . sig)
    const ts = Date.now().toString()
    const nonce = crypto.randomUUID()
    const payload = `${user.id}.${ts}.${nonce}`
    const sig = await hmacSha256(env.NOTION_OAUTH_STATE_SECRET, payload)
    const state = b64urlEncode(`${payload}.${sig}`)

    // redirect URI — 요청 origin 사용 (Cloudflare 다중 도메인 호환)
    const url = new URL(request.url)
    const redirectUri = `${url.origin}/api/notion-oauth-callback`

    const authUrl = 'https://api.notion.com/v1/oauth/authorize?' + new URLSearchParams({
      client_id: env.NOTION_CLIENT_ID,
      response_type: 'code',
      owner: 'user',
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
