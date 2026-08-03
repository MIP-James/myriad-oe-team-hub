/**
 * Cloudflare Pages Function — 크롬 확장용 API 토큰 발급.
 *
 *   POST /api/whitelist-issue-token
 *   Authorization: Bearer <web session JWT>
 *   Body: { name?: string }
 *
 * 응답: { id, token: "myrwl_<64hex>", name, created_at }
 *
 * launcher-issue-token.js 와 같은 모델 (mig 030 Phase 16):
 * plain 토큰은 응답에 1회만 노출하고 DB 에는 sha256 해시만 저장.
 * refresh/rotation 이 없으므로 세션 갱신 race(gotcha #12-A~D) 가 구조적으로 불가능.
 */
import { createClient } from '@supabase/supabase-js'

const TOKEN_PREFIX = 'myrwl_'
const TOKEN_RAND_BYTES = 32   // 64 hex chars

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    const jwt = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401)

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: '인증 실패' }, 401)

    let body
    try { body = await request.json() } catch { body = {} }
    const name = (body?.name || '').toString().trim().slice(0, 60) || 'Chrome 확장'

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }
    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const rand = new Uint8Array(TOKEN_RAND_BYTES)
    crypto.getRandomValues(rand)
    const secret = Array.from(rand).map((b) => b.toString(16).padStart(2, '0')).join('')
    const plainToken = TOKEN_PREFIX + secret
    const tokenHash = await sha256Hex(plainToken)

    const { data: row, error: insErr } = await adminSb
      .from('whitelist_ext_tokens')
      .insert({ token_hash: tokenHash, user_id: user.id, name })
      .select('id, name, created_at')
      .single()
    if (insErr) return json({ error: 'INSERT 실패: ' + insErr.message }, 500)

    return json({ id: row.id, token: plainToken, name: row.name, created_at: row.created_at })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

async function sha256Hex(str) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str))
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
