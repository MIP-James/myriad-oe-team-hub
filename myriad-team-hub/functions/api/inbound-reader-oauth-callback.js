/**
 * Cloudflare Pages Function — Inbound Gmail Reader OAuth 콜백.
 *
 * Google 동의 화면에서 사용자가 승인하면 Google 이 이 endpoint 로 redirect:
 *   GET /api/inbound-reader-oauth-callback?code=...&state=...
 *
 * 흐름:
 *   1) state 검증 (HMAC + 5분 만료) → user_id 추출
 *   2) code → access_token + refresh_token 교환 (Google token endpoint)
 *   3) userinfo API 로 본인 이메일 확인 (skylar@myriadip.com 인지 등)
 *   4) Supabase inbound_reader_tokens 에 upsert (service role 키)
 *   5) /admin/inbound-status?inbound=connected 로 redirect
 *
 * 에러는 모두 /admin/inbound-status?inbound=error&detail=... 로 redirect.
 *
 * 환경변수:
 *   - GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET
 *   - INBOUND_OAUTH_STATE_SECRET
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 *   - VITE_ALLOWED_EMAIL_DOMAIN (도메인 검증 — 외부 메일 reader 등록 차단)
 */
import { createClient } from '@supabase/supabase-js'

const STATE_TTL_MS = 5 * 60 * 1000

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)

  const error = url.searchParams.get('error')
  if (error) {
    return redirectTo(`/admin/inbound-status?inbound=error&detail=${encodeURIComponent(error)}`)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return redirectTo(`/admin/inbound-status?inbound=error&detail=missing_params`)
  }

  // ── state 검증 ──────────────────────────────────────────
  let userId
  try {
    const decoded = b64urlDecode(state)
    const parts = decoded.split('.')
    if (parts.length !== 4) throw new Error('state malformed')
    const [uid, ts, nonce, sig] = parts
    const recomputed = await hmacSha256(env.INBOUND_OAUTH_STATE_SECRET, `${uid}.${ts}.${nonce}`)
    if (!timingSafeEqual(recomputed, sig)) throw new Error('state signature mismatch')
    if (Date.now() - Number(ts) > STATE_TTL_MS) throw new Error('state expired')
    userId = uid
  } catch (e) {
    return redirectTo(
      `/admin/inbound-status?inbound=error&detail=${encodeURIComponent('invalid_state:' + (e.message || ''))}`
    )
  }

  // ── code → access_token / refresh_token 교환 ────────────
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    return redirectTo(`/admin/inbound-status?inbound=error&detail=oauth_env_missing`)
  }
  const redirectUri = `${url.origin}/api/inbound-reader-oauth-callback`

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
      return redirectTo(
        `/admin/inbound-status?inbound=error&detail=${encodeURIComponent('token_exchange:' + tokenRes.status + ':' + errText.slice(0, 200))}`
      )
    }
    tokenData = await tokenRes.json()
  } catch (e) {
    return redirectTo(
      `/admin/inbound-status?inbound=error&detail=${encodeURIComponent('token_fetch:' + (e.message || ''))}`
    )
  }

  if (!tokenData.refresh_token) {
    // prompt=consent 로 refresh_token 강제 발급해야 하는데 누락됨 → 재시도 안내
    return redirectTo(
      `/admin/inbound-status?inbound=error&detail=${encodeURIComponent(
        'no_refresh_token: Google 동의 화면에서 access_type=offline 동의가 누락됐습니다. Google 계정 → 보안 → 연결된 앱에서 본 앱 권한 회수 후 다시 시도해주세요.'
      )}`
    )
  }

  // ── userinfo 로 본인 이메일 확인 + 도메인 검증 ─────────
  let userEmail = ''
  try {
    const uiRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    if (uiRes.ok) {
      const ui = await uiRes.json()
      userEmail = ui.email || ''
    }
  } catch {
    // userinfo 실패해도 토큰 자체는 유효 — 이메일 빈 값으로 저장 진행
  }

  // 도메인 검증 — 외부 메일 (gmail.com 개인 계정 등) reader 등록 차단
  if (env.VITE_ALLOWED_EMAIL_DOMAIN && userEmail) {
    const allowed = env.VITE_ALLOWED_EMAIL_DOMAIN.toLowerCase()
    if (!userEmail.toLowerCase().endsWith(`@${allowed}`)) {
      return redirectTo(
        `/admin/inbound-status?inbound=error&detail=${encodeURIComponent(
          `domain_blocked: ${userEmail} (허용 도메인: @${allowed})`
        )}`
      )
    }
  }

  // ── Supabase 저장 (service role 로 RLS 우회) ────────────
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return redirectTo(`/admin/inbound-status?inbound=error&detail=supabase_env_missing`)
  }
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  // 신규 reader 등록 시 기존 활성 reader 비활성화 (현재 단일 reader 정책)
  await sb
    .from('inbound_reader_tokens')
    .update({ is_active: false })
    .neq('user_id', userId)

  // expires_at 계산 (expires_in 초 단위)
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
    : null

  const { error: dbErr } = await sb.from('inbound_reader_tokens').upsert(
    {
      user_id: userId,
      email: userEmail || 'unknown',
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expires_at: expiresAt,
      scope: tokenData.scope || null,
      is_active: true,
      last_poll_status: 'just_registered',
      last_poll_error: null
    },
    { onConflict: 'user_id' }
  )
  if (dbErr) {
    return redirectTo(
      `/admin/inbound-status?inbound=error&detail=${encodeURIComponent('db_save:' + dbErr.message)}`
    )
  }

  return redirectTo(`/admin/inbound-status?inbound=connected`)
}

function redirectTo(path) {
  return new Response(null, {
    status: 302,
    headers: { Location: path }
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
