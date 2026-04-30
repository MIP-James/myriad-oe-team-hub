/**
 * Cloudflare Pages Function — PWA push subscription 회수.
 *
 *   POST /api/push-unsubscribe
 *   Authorization: Bearer <web session JWT>
 *   Body: { endpoint }
 *
 * 본인 소유의 endpoint 만 회수 가능. revoked_at 마킹 (즉시 삭제 X — 7일 후 cron 으로 cleanup).
 */
import { createClient } from '@supabase/supabase-js'

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
      return json({ error: 'JSON body 파싱 실패' }, 400)
    }
    const endpoint = (body?.endpoint || '').toString()
    if (!endpoint) return json({ error: 'endpoint 필수' }, 400)

    // 본인 RLS 통한 update — 다른 사용자 endpoint 는 row 0 으로 패스
    const { data, error } = await sb
      .from('push_subscriptions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('endpoint', endpoint)
      .eq('user_id', user.id)
      .select('id')

    if (error) return json({ error: 'UPDATE 실패: ' + error.message }, 500)
    return json({ ok: true, count: (data || []).length })
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
