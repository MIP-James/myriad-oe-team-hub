/**
 * Cloudflare Pages Function — 노션 DB 접근 권한 재확인.
 *
 *   POST /api/notion-recheck-access  (Authorization: Bearer <jwt>)
 *
 * 용도:
 *   관리자가 노션에서 "주간 업무 Snapshot" DB 의 워크스페이스 권한을
 *   "전체 허용" 으로 변경한 뒤, 사용자가 OAuth 재연결 없이 즉시
 *   접근 가능 여부를 다시 검증하고자 할 때 호출.
 *
 *   현재 access_token 으로 NOTION_DB_ID 를 GET → 결과를
 *   notion_connections.db_accessible / db_checked_at 에 캐시.
 *
 * 응답: { db_accessible: boolean }
 *
 * 환경변수:
 *   - SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
 *   - NOTION_DB_ID
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

    if (!env.NOTION_DB_ID) {
      return json({ error: 'NOTION_DB_ID 환경변수가 설정되지 않았습니다.' }, 500)
    }

    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const { data: conn, error: connErr } = await adminSb
      .from('notion_connections')
      .select('access_token')
      .eq('user_id', user.id)
      .maybeSingle()
    if (connErr) return json({ error: '연동 조회 실패: ' + connErr.message }, 500)
    if (!conn?.access_token) {
      return json({ error: '노션이 연동되지 않았습니다.', notConnected: true }, 409)
    }

    let dbAccessible = false
    try {
      const dbRes = await fetch(`https://api.notion.com/v1/databases/${env.NOTION_DB_ID}`, {
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          'Notion-Version': '2022-06-28'
        }
      })
      dbAccessible = dbRes.ok
      // 401/403 — 토큰 만료. 연동 행 삭제 → 프론트가 재연결 안내.
      if (dbRes.status === 401 || dbRes.status === 403) {
        await adminSb.from('notion_connections').delete().eq('user_id', user.id)
        return json({ error: '노션 연동이 만료되었습니다. 다시 연동해주세요.', notConnected: true }, 409)
      }
    } catch (e) {
      return json({ error: '검증 실패: ' + (e?.message || String(e)) }, 500)
    }

    await adminSb
      .from('notion_connections')
      .update({ db_accessible: dbAccessible, db_checked_at: new Date().toISOString() })
      .eq('user_id', user.id)

    return json({ db_accessible: dbAccessible })
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
