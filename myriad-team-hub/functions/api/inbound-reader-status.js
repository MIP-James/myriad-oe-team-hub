/**
 * Cloudflare Pages Function — Inbound Reader 상태 조회.
 *
 *   GET /api/inbound-reader-status  (Authorization: Bearer <jwt>)
 *
 * 응답 (관리자 전용):
 *   {
 *     active_reader: {
 *       user_id, email, is_active, last_polled_at, last_poll_status,
 *       last_poll_error, last_poll_count, total_processed_count,
 *       created_at, updated_at
 *     } | null,
 *     stats: {
 *       processed_24h: int,        -- 최근 24시간 처리 건수
 *       skipped_24h: int,          -- 최근 24시간 skip 건수
 *       last_processed_at: timestamptz | null
 *     }
 *   }
 *
 * 비관리자는 본인이 reader 인지만 확인 (is_my_reader: bool)
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

    // 본인이 reader 인지 (RLS 통해 본인 행만 조회 가능)
    const { data: myReader } = await sb
      .from('inbound_reader_tokens')
      .select('user_id, email, is_active, last_polled_at, last_poll_status, last_poll_error, last_poll_count, total_processed_count, created_at, updated_at')
      .eq('user_id', user.id)
      .maybeSingle()

    // 관리자 추가 정보 — 활성 reader 전체 + 최근 통계
    const adminSb = env.SUPABASE_SERVICE_ROLE_KEY
      ? createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false, autoRefreshToken: false }
        })
      : null

    const { data: profile } = await sb
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle()
    const isAdmin = profile?.role === 'admin'

    if (!isAdmin) {
      return json({
        is_my_reader: !!myReader,
        my_reader: myReader || null
      })
    }

    // 관리자 — 전체 reader + 통계
    let activeReader = null
    let stats = { processed_24h: 0, skipped_24h: 0, last_processed_at: null }

    if (adminSb) {
      const { data: readers } = await adminSb
        .from('inbound_reader_tokens')
        .select('user_id, email, is_active, last_polled_at, last_poll_status, last_poll_error, last_poll_count, total_processed_count, created_at, updated_at')
        .eq('is_active', true)
        .order('updated_at', { ascending: false })
        .limit(1)
      activeReader = readers?.[0] || null

      // 최근 24시간 통계
      const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { data: recentMessages } = await adminSb
        .from('inbound_processed_messages')
        .select('case_id, match_reason, processed_at')
        .gte('processed_at', since24h)
      const recent = recentMessages || []
      stats.processed_24h = recent.filter((r) => r.case_id !== null).length
      stats.skipped_24h = recent.filter((r) => r.case_id === null).length
      stats.last_processed_at = recent[0]?.processed_at || null
    }

    return json({
      is_my_reader: !!myReader,
      my_reader: myReader || null,
      active_reader: activeReader,
      stats
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
