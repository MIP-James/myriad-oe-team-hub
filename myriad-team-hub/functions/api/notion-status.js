/**
 * Cloudflare Pages Function — 본인의 노션 연동 상태 조회.
 *
 *   GET /api/notion-status  (Authorization: Bearer <jwt>)
 *
 * 응답:
 *   { connected: false }
 *   { connected: true, workspace_name, workspace_icon, connected_at }
 */
import { createClient } from '@supabase/supabase-js'

export async function onRequestGet(context) {
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

    // RLS 적용된 사용자 클라이언트로 본인 행 조회
    const { data, error } = await sb
      .from('notion_connections')
      .select('workspace_name, workspace_icon, connected_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (error) return json({ error: error.message }, 500)

    if (!data) return json({ connected: false })
    return json({
      connected: true,
      workspace_name: data.workspace_name,
      workspace_icon: data.workspace_icon,
      connected_at: data.connected_at,
      updated_at: data.updated_at
    })
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
