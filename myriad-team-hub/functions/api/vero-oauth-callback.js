/**
 * Cloudflare Pages Function — VeRO reader(James 님 Gmail) OAuth 콜백.
 *
 *   GET /api/vero-oauth-callback?code=...&state=...
 *
 * 흐름:
 *   1) state 검증 (HMAC + 'vero' prefix + 5분 만료)
 *   2) code → access_token + refresh_token 교환
 *   3) userinfo 로 연결된 메일이 VERO_MAILBOX(기본 james@myriadip.com) 인지 검증
 *      → 다른 계정으로 잘못 연결되는 것 방지
 *   4) inbound_reader_tokens 에 purpose='vero' 로 upsert
 *      → 기존 'vero' reader 만 비활성화 (케이스 reader='case' 는 절대 안 건드림)
 *   5) /vero?connected=1 로 redirect
 *
 * 환경변수: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET /
 *          INBOUND_OAUTH_STATE_SECRET / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
 *          VERO_MAILBOX(옵션, 기본 james@myriadip.com)
 */
import { createClient } from '@supabase/supabase-js'

const STATE_TTL_MS = 5 * 60 * 1000

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)

  const oauthErr = url.searchParams.get('error')
  if (oauthErr) return redirectTo(`/vero?vero=error&detail=${encodeURIComponent(oauthErr)}`)

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return redirectTo(`/vero?vero=error&detail=missing_params`)

  // ── state 검증 ('vero' prefix) ──────────────────────────
  let userId
  try {
    const decoded = b64urlDecode(state)
    const parts = decoded.split('.')
    if (parts.length !== 5 || parts[0] !== 'vero') throw new Error('state malformed')
    const [, uid, ts, nonce, sig] = parts
    const recomputed = await hmacSha256(env.INBOUND_OAUTH_STATE_SECRET, `vero.${uid}.${ts}.${nonce}`)
    if (!timingSafeEqual(recomputed, sig)) throw new Error('state signature mismatch')
    if (Date.now() - Number(ts) > STATE_TTL_MS) throw new Error('state expired')
    userId = uid
  } catch (e) {
    return redirectTo(`/vero?vero=error&detail=${encodeURIComponent('invalid_state:' + (e.message || ''))}`)
  }

  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return redirectTo(`/vero?vero=error&detail=oauth_env_missing`)
  }
  const redirectUri = `${url.origin}/api/vero-oauth-callback`

  // ── code → 토큰 교환 ────────────────────────────────────
  let tokenData
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: env.GOOGLE_OAUTH_CLIENT_ID,
        client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    })
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '')
      return redirectTo(`/vero?vero=error&detail=${encodeURIComponent('token_exchange:' + tokenRes.status + ':' + errText.slice(0, 150))}`)
    }
    tokenData = await tokenRes.json()
  } catch (e) {
    return redirectTo(`/vero?vero=error&detail=${encodeURIComponent('token_fetch:' + (e.message || ''))}`)
  }

  if (!tokenData.refresh_token) {
    return redirectTo(`/vero?vero=error&detail=${encodeURIComponent(
      'no_refresh_token: Google 계정 → 보안 → 연결된 앱에서 본 앱 권한 회수 후 다시 시도해주세요.'
    )}`)
  }

  // ── 연결된 메일 확인 → VERO_MAILBOX 검증 ────────────────
  let userEmail = ''
  try {
    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    if (uiRes.ok) userEmail = (await uiRes.json()).email || ''
  } catch {}

  const veroMailbox = (env.VERO_MAILBOX || 'james@myriadip.com').toLowerCase()
  if (userEmail && userEmail.toLowerCase() !== veroMailbox) {
    return redirectTo(`/vero?vero=error&detail=${encodeURIComponent(
      `wrong_mailbox: VeRO 코드가 오는 계정(${veroMailbox})으로 연동해야 합니다. 연결된 계정: ${userEmail}`
    )}`)
  }

  // ── 저장 (service role) ─────────────────────────────────
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return redirectTo(`/vero?vero=error&detail=supabase_env_missing`)
  }
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // 기존 'vero' reader 만 비활성화 (case reader 는 절대 안 건드림)
  await sb
    .from('inbound_reader_tokens')
    .update({ is_active: false })
    .eq('purpose', 'vero')
    .neq('user_id', userId)

  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null

  const { error: dbErr } = await sb.from('inbound_reader_tokens').upsert(
    {
      user_id: userId,
      email: userEmail || veroMailbox,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      scope: tokenData.scope || null,
      is_active: true,
      purpose: 'vero',
      last_poll_status: 'vero_registered',
      last_poll_error: null
    },
    { onConflict: 'user_id' }
  )
  if (dbErr) {
    return redirectTo(`/vero?vero=error&detail=${encodeURIComponent('db_save:' + dbErr.message)}`)
  }

  return redirectTo(`/vero?vero=connected`)
}

function redirectTo(path) {
  return new Response(null, { status: 302, headers: { Location: path } })
}

async function hmacSha256(secret, message) {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message))
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function b64urlDecode(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4)
  return atob(padded)
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}
