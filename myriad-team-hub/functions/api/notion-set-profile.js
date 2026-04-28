/**
 * Cloudflare Pages Function — 노션 사원 페이지 / 팀명 등록·수정
 *
 *   POST /api/notion-set-profile
 *   Body: {
 *     authorPageUrl?: string,   // 사원 페이지 URL (둘 중 하나)
 *     authorPageId?:  string,   // 또는 ID 직접
 *     teamName?:      string    // 미입력 시 노션에서 자동 추출 시도
 *   }
 *
 * 흐름:
 *   1) JWT 검증 → user.id 확보
 *   2) URL → page ID 추출
 *   3) 사용자 OAuth 토큰으로 노션 페이지 fetch
 *      - 성공 시 페이지 제목 + 팀 속성 자동 추출
 *      - 실패 시 (권한 없거나 잘못된 ID) → teamName 수동 입력 요구
 *   4) notion_connections 에 저장 (RLS 우회 위해 service role 사용)
 */
import { createClient } from '@supabase/supabase-js'

const NOTION_VERSION = '2022-06-28'

// 사원 페이지에서 자동으로 팀명을 찾을 때 시도할 속성 이름들
const TEAM_PROPERTY_CANDIDATES = ['소속 팀/파트', '소속 팀', '팀/파트', '팀', '소속', 'Team']

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    // ── 1) JWT 검증 ─────────────────────────────────────────
    const authHeader = request.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: '로그인이 필요합니다.' }, 401)

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: { user }, error: authErr } = await sb.auth.getUser()
    if (authErr || !user) return json({ error: '인증 실패' }, 401)

    // ── 2) Body & URL → ID ──────────────────────────────────
    const body = await request.json().catch(() => ({}))
    let { authorPageUrl, authorPageId, teamName } = body
    teamName = (teamName || '').trim() || null

    if (!authorPageId && authorPageUrl) {
      authorPageId = extractPageIdFromUrl(authorPageUrl)
    }
    if (!authorPageId) {
      return json(
        { error: '사원 페이지 URL 또는 ID 가 필요합니다.' },
        400
      )
    }
    // ID 정규화 (대시 제거)
    authorPageId = authorPageId.replace(/-/g, '').toLowerCase()
    if (!/^[a-f0-9]{32}$/.test(authorPageId)) {
      return json(
        { error: '페이지 ID 형식이 올바르지 않습니다 (32자 hex 필요).' },
        400
      )
    }

    // ── 3) 사용자 OAuth 토큰 조회 ────────────────────────────
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' }, 500)
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
      return json({ error: '먼저 노션 연동을 완료해주세요.' }, 409)
    }

    // ── 4) 노션 페이지 fetch (검증 + 팀 자동 추출) ───────────
    let pageTitle = null
    let detectedTeam = null
    let authorDbId = null
    let pageAccessible = false
    let fetchError = null

    try {
      const pageRes = await fetch(`https://api.notion.com/v1/pages/${authorPageId}`, {
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          'Notion-Version': NOTION_VERSION
        }
      })
      if (pageRes.ok) {
        pageAccessible = true
        const pageData = await pageRes.json()

        // parent DB ID 캐시
        if (pageData.parent?.type === 'database_id') {
          authorDbId = pageData.parent.database_id
        }

        // title 추출
        for (const [, prop] of Object.entries(pageData.properties || {})) {
          if (prop?.type === 'title') {
            pageTitle = (prop.title || []).map((t) => t.plain_text).join('')
            break
          }
        }

        // team 자동 추출
        for (const candidate of TEAM_PROPERTY_CANDIDATES) {
          const prop = pageData.properties?.[candidate]
          if (!prop) continue
          const t = readTextValue(prop)
          if (t) {
            detectedTeam = t
            break
          }
        }
      } else {
        fetchError = `Notion ${pageRes.status}`
      }
    } catch (e) {
      fetchError = e?.message || 'fetch failed'
    }

    // ── 5) 최종 팀명 결정 ───────────────────────────────────
    const finalTeam = teamName || detectedTeam
    if (!finalTeam) {
      // 페이지 접근 실패 또는 팀 속성 없음 → 사용자에게 수동 입력 요구
      return json(
        {
          error: pageAccessible
            ? '페이지에서 팀명을 찾지 못했습니다. teamName 을 직접 입력해주세요.'
            : '사원 페이지에 접근할 수 없습니다. 페이지 ID 가 맞는지 / 노션 연동에 해당 페이지 권한이 포함됐는지 확인해주세요.',
          requiresTeamName: true,
          pageAccessible,
          pageTitle,
          authorPageId,
          authorDbId,
          fetchError
        },
        400
      )
    }

    // ── 6) 저장 ─────────────────────────────────────────────
    const { error: updateErr } = await adminSb
      .from('notion_connections')
      .update({
        author_page_id: authorPageId,
        author_db_id: authorDbId,
        team_name: finalTeam,
        updated_at: new Date().toISOString()
      })
      .eq('user_id', user.id)
    if (updateErr) return json({ error: '저장 실패: ' + updateErr.message }, 500)

    return json({
      ok: true,
      authorPageId,
      authorDbId,
      teamName: finalTeam,
      pageTitle,
      autoDetectedTeam: !!detectedTeam && !teamName,
      pageAccessible
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

// ── 유틸 ────────────────────────────────────────────────────

function extractPageIdFromUrl(url) {
  if (!url) return null
  // URL 안의 32자 hex (대시 포함/불포함) 매칭
  const m = String(url).match(
    /([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})/i
  )
  return m ? m[1] : null
}

function readTextValue(prop) {
  if (!prop) return null
  if (prop.type === 'select') return prop.select?.name || null
  if (prop.type === 'multi_select') return prop.multi_select?.[0]?.name || null
  if (prop.type === 'rich_text') return (prop.rich_text || []).map((t) => t.plain_text).join('') || null
  if (prop.type === 'title') return (prop.title || []).map((t) => t.plain_text).join('') || null
  if (prop.type === 'status') return prop.status?.name || null
  if (prop.type === 'formula') {
    const f = prop.formula
    if (f?.type === 'string') return f.string || null
  }
  return null
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}
