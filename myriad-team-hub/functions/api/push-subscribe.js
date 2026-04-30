/**
 * Cloudflare Pages Function — PWA push subscription 등록.
 *
 *   POST /api/push-subscribe
 *   Authorization: Bearer <web session JWT>
 *   Body: { endpoint, p256dh, auth, user_agent? }
 *
 * 같은 endpoint 가 이미 있으면 user 일치 검증 후 update (재구독 / 키 갱신).
 * 다른 user 의 endpoint 면 거부.
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
    const p256dh = (body?.p256dh || '').toString()
    const authKey = (body?.auth || '').toString()
    const userAgent = (body?.user_agent || '').toString().slice(0, 200) || null

    if (!endpoint || !p256dh || !authKey) {
      return json({ error: 'endpoint / p256dh / auth 모두 필수' }, 400)
    }
    if (!endpoint.startsWith('https://')) {
      return json({ error: 'endpoint 가 https URL 이 아닙니다.' }, 400)
    }

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 누락' }, 500)
    }
    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    // 같은 endpoint row 확인 — 재구독 시 update, 다른 user 의 endpoint 면 거부
    const { data: existing } = await adminSb
      .from('push_subscriptions')
      .select('id, user_id')
      .eq('endpoint', endpoint)
      .maybeSingle()

    if (existing && existing.user_id !== user.id) {
      return json({ error: '이 endpoint 는 다른 사용자에게 등록돼있습니다.' }, 409)
    }

    const row = {
      user_id: user.id,
      endpoint,
      p256dh,
      auth: authKey,
      user_agent: userAgent,
      last_used_at: new Date().toISOString(),
      last_error: null,
      failure_count: 0,
      revoked_at: null
    }

    if (existing) {
      const { error: upErr } = await adminSb
        .from('push_subscriptions')
        .update(row)
        .eq('id', existing.id)
      if (upErr) return json({ error: 'UPDATE 실패: ' + upErr.message }, 500)
      return json({ ok: true, id: existing.id, action: 'updated' })
    }

    const { data: inserted, error: insErr } = await adminSb
      .from('push_subscriptions')
      .insert(row)
      .select('id')
      .single()
    if (insErr) return json({ error: 'INSERT 실패: ' + insErr.message }, 500)
    return json({ ok: true, id: inserted.id, action: 'created' })
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
