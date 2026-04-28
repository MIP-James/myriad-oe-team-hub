/**
 * Cloudflare Pages Function — 노션 연동 해제.
 *
 *   DELETE /api/notion-disconnect  (Authorization: Bearer <jwt>)
 *
 * 단순히 notion_connections 의 본인 행을 삭제. 노션 측 토큰 무효화는 사용자가
 * 직접 노션 → My connections 에서 해제해야 진짜 끊어짐. 우리 DB 의 토큰만
 * 지우면 우리 서비스에서 토큰 사용 안 함.
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

    // RLS 로 본인 행만 삭제됨
    const { error: dbErr } = await sb
      .from('notion_connections')
      .delete()
      .eq('user_id', user.id)
    if (dbErr) return json({ error: '삭제 실패: ' + dbErr.message }, 500)

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
