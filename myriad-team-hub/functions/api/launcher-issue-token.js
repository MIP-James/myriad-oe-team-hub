/**
 * Cloudflare Pages Function — Launcher API 토큰 발급.
 *
 *   POST /api/launcher-issue-token
 *   Authorization: Bearer <web session JWT>
 *   Body: { name?: string }
 *
 * 응답:
 *   { id: uuid, token: "myrlnch_<64hex>", name, created_at }
 *
 * 토큰은 plain 형태로 응답 본문에 1회만 노출됨 (DB 에는 sha256 해시만 저장).
 * 사용자가 setup 마법사에 paste 후 분실하면 새로 발급해야 함.
 */
import { createClient } from '@supabase/supabase-js'

const TOKEN_PREFIX = 'myrlnch_'
const TOKEN_RAND_BYTES = 32   // 64 hex chars

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

    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const name = (body?.name || '').toString().trim().slice(0, 60) || 'Unnamed'

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }
    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // 32바이트 랜덤 → hex (64자) → prefix 붙임. plain 토큰은 응답에만 노출.
    const rand = new Uint8Array(TOKEN_RAND_BYTES)
    crypto.getRandomValues(rand)
    const tokenSecret = Array.from(rand).map(b => b.toString(16).padStart(2, '0')).join('')
    const plainToken = TOKEN_PREFIX + tokenSecret
    const tokenHash = await sha256Hex(plainToken)

    const { data: row, error: insErr } = await adminSb
      .from('launcher_device_tokens')
      .insert({
        token_hash: tokenHash,
        user_id: user.id,
        name
      })
      .select('id, name, created_at')
      .single()
    if (insErr) {
      return json({ error: 'INSERT 실패: ' + insErr.message }, 500)
    }

    return json({
      id: row.id,
      token: plainToken,
      name: row.name,
      created_at: row.created_at
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

async function sha256Hex(str) {
  const data = new TextEncoder().encode(str)
  const hash = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
