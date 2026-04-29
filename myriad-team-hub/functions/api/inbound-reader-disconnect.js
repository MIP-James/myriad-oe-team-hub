/**
 * Cloudflare Pages Function — Inbound Reader 연동 해제.
 *
 *   DELETE /api/inbound-reader-disconnect  (Authorization: Bearer <jwt>)
 *
 * 본인 토큰만 삭제 (관리자는 service role 로 누구든 가능). 노션과 동일하게,
 * Google 측 권한은 사용자가 Google 계정 → 보안 → 연결된 앱에서 직접 회수.
 */
import { createClient } from '@supabase/supabase-js'

export async function onRequestDelete(context) {
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

    // 관리자 여부 — 관리자면 모든 reader 토큰 회수 가능
    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const isAdmin = profile?.role === 'admin'

    // body 에서 회수 대상 user_id (관리자만 의미 있음). 없으면 본인 토큰 회수.
    let targetUserId = user.id
    try {
      const body = await request.json().catch(() => ({}))
      if (body?.userId && isAdmin) {
        targetUserId = body.userId
      }
    } catch {}

    const client = isAdmin && env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : sb

    const { error } = await client
      .from('inbound_reader_tokens')
      .delete()
      .eq('user_id', targetUserId)
    if (error) return json({ error: error.message }, 500)

    return json({ ok: true })
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
