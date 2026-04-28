/**
 * Cloudflare Pages Function — 노션 OAuth 콜백.
 *
 * 노션 동의 화면에서 사용자가 승인하면 노션이 이 endpoint 로 redirect:
 *   GET /api/notion-oauth-callback?code=...&state=...
 *
 * 흐름:
 *   1) state 검증 (HMAC 서명 확인 + 5분 만료 체크) → user_id 추출
 *   2) code → access_token 교환 (노션 token endpoint)
 *   3) Supabase notion_connections 에 upsert (service role 키)
 *   4) /schedules?notion=connected 로 redirect
 *
 * 에러는 모두 /schedules?notion=error&detail=... 로 redirect.
 *
 * 환경변수:
 *   - NOTION_CLIENT_ID / NOTION_CLIENT_SECRET
 *   - NOTION_OAUTH_STATE_SECRET
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 */
import { createClient } from '@supabase/supabase-js'

const STATE_TTL_MS = 5 * 60 * 1000

export async function onRequestGet(context) {
  const { request, env } = context
  const url = new URL(request.url)

  const error = url.searchParams.get('error')
  if (error) {
    return redirectTo(`/schedules?notion=error&detail=${encodeURIComponent(error)}`)
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) {
    return redirectTo(`/schedules?notion=error&detail=${encodeURIComponent('missing_params')}`)
  }

  // ── state 검증 ──────────────────────────────────────────
  let userId
  try {
    const decoded = b64urlDecode(state)
    const parts = decoded.split('.')
    if (parts.length !== 4) throw new Error('state malformed')
    const [uid, ts, nonce, sig] = parts
    const recomputed = await hmacSha256(env.NOTION_OAUTH_STATE_SECRET, `${uid}.${ts}.${nonce}`)
    if (!timingSafeEqual(recomputed, sig)) throw new Error('state signature mismatch')
    if (Date.now() - Number(ts) > STATE_TTL_MS) throw new Error('state expired')
    userId = uid
  } catch (e) {
    return redirectTo(
      `/schedules?notion=error&detail=${encodeURIComponent('invalid_state:' + (e.message || ''))}`
    )
  }

  // ── code → access_token 교환 ───────────────────────────
  if (!env.NOTION_CLIENT_ID || !env.NOTION_CLIENT_SECRET) {
    return redirectTo(`/schedules?notion=error&detail=oauth_env_missing`)
  }
  const redirectUri = `${url.origin}/api/notion-oauth-callback`
  const basic = btoa(`${env.NOTION_CLIENT_ID}:${env.NOTION_CLIENT_SECRET}`)

  let tokenData
  try {
    const tokenRes = await fetch('https://api.notion.com/v1/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28'
      },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri
      })
    })
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => '')
      return redirectTo(
        `/schedules?notion=error&detail=${encodeURIComponent('token_exchange:' + tokenRes.status + ':' + errText.slice(0, 200))}`
      )
    }
    tokenData = await tokenRes.json()
  } catch (e) {
    return redirectTo(
      `/schedules?notion=error&detail=${encodeURIComponent('token_fetch:' + (e.message || ''))}`
    )
  }

  // ── 사전 DB 접근 체크 ──────────────────────────────────
  // 노션 OAuth 페이지 선택 화면은 사용자가 "공유" 권한을 가진 페이지만 노출 →
  // "내용 편집 허용" 권한만 있으면 주간보고 DB 가 픽커에 안 보여서 토큰은 받지만
  // DB 접근은 안 됨. 여기서 미리 검증해서 모달이 명확한 안내를 띄우게 함.
  let dbAccessible = null
  if (env.NOTION_DB_ID) {
    try {
      const dbRes = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}`, {
        headers: {
          Authorization: `Bearer ${tokenData.access_token}`,
          'Notion-Version': '2022-06-28'
        }
      })
      dbAccessible = dbRes.ok
    } catch {
      dbAccessible = false
    }
  }

  // ── Supabase 저장 (service role 로 RLS 우회) ────────────
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return redirectTo(`/schedules?notion=error&detail=supabase_env_missing`)
  }
  const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { error: dbErr } = await sb.from('notion_connections').upsert(
    {
      user_id: userId,
      access_token: tokenData.access_token,
      workspace_id: tokenData.workspace_id ?? null,
      workspace_name: tokenData.workspace_name ?? null,
      workspace_icon: tokenData.workspace_icon ?? null,
      bot_id: tokenData.bot_id ?? null,
      owner: tokenData.owner ?? null,
      db_accessible: dbAccessible,
      db_checked_at: dbAccessible === null ? null : new Date().toISOString()
    },
    { onConflict: 'user_id' }
  )
  if (dbErr) {
    return redirectTo(
      `/schedules?notion=error&detail=${encodeURIComponent('db_save:' + dbErr.message)}`
    )
  }

  // 권한 부족 → 모달에서 안내 배너 띄우게 별도 쿼리로 알림
  if (dbAccessible === false) {
    return redirectTo(`/schedules?notion=needs_share`)
  }
  return redirectTo(`/schedules?notion=connected`)
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
