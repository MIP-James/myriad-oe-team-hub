/**
 * Cloudflare Pages Function — 노션 주간 보고서 자동 생성 (OAuth 버전)
 *
 * 흐름:
 *   1) Authorization 헤더의 Supabase JWT 검증 → user 확인
 *   2) notion_connections 에서 본인 access_token 조회 (없으면 401 → 연동 안내)
 *   3) 요청 본문의 weekStartDate (월요일 YYYY-MM-DD) 기준 그 주 daily_records 조회
 *   4) 다음 주 weekly_plans 조회 (차주 우선 업무용)
 *   5) dryRun=true 면 미리보기 텍스트만 반환 (DB write X)
 *   6) dryRun=false 면 사용자 OAuth 토큰으로 Notion API 호출 → 페이지 생성 후 URL 반환
 *
 * 환경변수:
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY            (JWT 검증 + RLS 사용자 쿼리)
 *   - SUPABASE_SERVICE_ROLE_KEY    (notion_connections 읽기 — RLS 우회)
 *   - NOTION_DB_ID                 (주간 업무 Snapshot DB)
 *   - (선택) NOTION_TOKEN          (구버전 Internal 토큰 — fallback 으로 보유)
 */
import { createClient } from '@supabase/supabase-js'

const WEEKDAYS = ['월', '화', '수', '목', '금']

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    // ── 1) JWT 검증 ─────────────────────────────────────────
    const authHeader = request.headers.get('Authorization') || ''
    const jwt = authHeader.replace(/^Bearer\s+/i, '')
    if (!jwt) return json({ error: '인증 토큰이 없습니다.' }, 401)

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return json({ error: 'Supabase 환경변수가 설정되지 않았습니다.' }, 500)
    }

    const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false, autoRefreshToken: false }
    })

    const {
      data: { user },
      error: authErr
    } = await sb.auth.getUser()
    if (authErr || !user) {
      return json({ error: '인증 실패 — 다시 로그인해주세요.' }, 401)
    }

    // ── 2) 요청 본문 ────────────────────────────────────────
    const body = await request.json().catch(() => ({}))
    const { weekStartDate, dryRun } = body
    if (!weekStartDate || !/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) {
      return json({ error: 'weekStartDate (YYYY-MM-DD) 가 필요합니다.' }, 400)
    }

    // ── 3) 주 범위 계산 ─────────────────────────────────────
    const monday = new Date(weekStartDate + 'T00:00:00Z')
    const friday = addDays(monday, 4)
    const nextMonday = addDays(monday, 7)
    const nextWeek = isoWeekOf(nextMonday)

    // ── 4) daily_records (월~금) ────────────────────────────
    const { data: records, error: recErr } = await sb
      .from('daily_records')
      .select('log_date, items')
      .eq('user_id', user.id)
      .gte('log_date', fmtDate(monday))
      .lte('log_date', fmtDate(friday))
      .order('log_date', { ascending: true })
    if (recErr) return json({ error: 'daily_records 조회 실패: ' + recErr.message }, 500)

    // ── 5) weekly_plans (다음 주) ───────────────────────────
    const { data: nextPlan, error: planErr } = await sb
      .from('weekly_plans')
      .select('items')
      .eq('user_id', user.id)
      .eq('year', nextWeek.year)
      .eq('week_number', nextWeek.week)
      .maybeSingle()
    if (planErr) return json({ error: 'weekly_plans 조회 실패: ' + planErr.message }, 500)

    // ── 6) 텍스트 빌드 ──────────────────────────────────────
    const thisWeekText = formatThisWeekTasks(records ?? [], monday)
    const nextWeekText = formatNextWeekTasks(nextPlan?.items ?? [])

    const preview = {
      기준주차: fmtDate(monday),
      금주주요업무: thisWeekText,
      차주우선업무: nextWeekText,
      금주기록수: (records ?? []).length,
      차주계획수: (nextPlan?.items ?? []).filter((it) => it.text?.trim()).length
    }

    // dryRun = 미리보기만 (Notion 호출 X — 연동 안 돼 있어도 가능)
    if (dryRun) {
      return json({ preview })
    }

    // ── 7) 사용자 OAuth 토큰 조회 ───────────────────────────
    if (!env.NOTION_DB_ID) {
      return json({ error: 'NOTION_DB_ID 환경변수가 설정되지 않았습니다.' }, 500)
    }
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: 'SUPABASE_SERVICE_ROLE_KEY 가 설정되지 않았습니다.' }, 500)
    }
    const adminSb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
    const { data: conn, error: connErr } = await adminSb
      .from('notion_connections')
      .select('access_token, workspace_name, author_page_id, author_db_id, team_name, author_resolved_at')
      .eq('user_id', user.id)
      .maybeSingle()
    if (connErr) return json({ error: '연동 조회 실패: ' + connErr.message }, 500)
    if (!conn?.access_token) {
      return json(
        {
          error: '노션이 연동되지 않았습니다.',
          notConnected: true,
          preview
        },
        409
      )
    }

    // ── 8) 본인 이름 + 사원 페이지 + 팀 자동 감지 ─────────────
    const { data: profileRow } = await sb
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .maybeSingle()
    const userName = (profileRow?.full_name?.trim())
      || (user.user_metadata?.full_name)
      || (user.email?.split('@')[0])
      || '사용자'

    // 캐시된 author_page_id / team_name 없으면 노션 사원 DB 에서 자동 감지
    let authorPageId = conn.author_page_id
    let teamName = conn.team_name
    if (!authorPageId) {
      const resolved = await resolveNotionUser({
        token: conn.access_token,
        snapshotDbId: env.NOTION_DB_ID,
        cachedEmployeeDbId: conn.author_db_id,
        userEmail: user.email,
        userFullName: userName
      })
      if (resolved?.authorPageId) {
        authorPageId = resolved.authorPageId
        teamName = resolved.teamName ?? teamName
        // 캐시 — 다음 보고서부터는 사원 DB 재조회 안 함
        await adminSb
          .from('notion_connections')
          .update({
            author_page_id: resolved.authorPageId,
            author_db_id: resolved.employeeDbId ?? null,
            team_name: resolved.teamName ?? null,
            author_resolved_at: new Date().toISOString()
          })
          .eq('user_id', user.id)
      }
    }

    const dateKor = `${monday.getUTCFullYear()}년 ${monday.getUTCMonth() + 1}월 ${monday.getUTCDate()}일`
    const teamPart = teamName ? `-${teamName}` : ''
    const customTitle = `${dateKor}${teamPart}-@${userName}`

    // ── 9) Notion API 호출 (사용자 OAuth 토큰) ──────────────
    const properties = {
      '보고서 제목': {
        title: [{ text: { content: customTitle } }]
      },
      '기준 주차': { date: { start: fmtDate(monday) } },
      '보고 상태': { status: { name: '작성중' } },
      '금주 주요 업무': {
        rich_text: [{ text: { content: thisWeekText } }]
      },
      '차주 우선 업무': {
        rich_text: [{ text: { content: nextWeekText } }]
      }
    }
    // 작성자 (필수 지정) relation 자동 채움 → 노션 automation 발동 →
    // 부서/팀/부서장 lookup + 제목 봇이름 덮어쓰기 + 보고상태=제출완료
    // 다 일어남. 후처리 PATCH 로 제목/보고상태 복구.
    const willTriggerAutomation = !!authorPageId
    if (willTriggerAutomation) {
      properties['작성자 (필수 지정)'] = {
        relation: [{ id: authorPageId }]
      }
    }

    const NOTION_COVER_DEFAULT = 'https://www.notion.so/images/page-cover/met_william_morris_1875_acanthus.jpg'
    const pageBody = {
      parent: { database_id: env.NOTION_DB_ID },
      properties,
      icon: { type: 'emoji', emoji: '📝' },
      cover: {
        type: 'external',
        external: { url: env.NOTION_COVER_URL || NOTION_COVER_DEFAULT }
      }
    }

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${conn.access_token}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(pageBody)
    })

    // 401/403 — 토큰 무효화됨 → 연동 행 삭제 후 재연동 안내
    if (notionRes.status === 401 || notionRes.status === 403) {
      await adminSb.from('notion_connections').delete().eq('user_id', user.id)
      return json(
        {
          error: '노션 연동이 만료되었습니다. 다시 연동해주세요.',
          notConnected: true,
          preview
        },
        409
      )
    }

    if (!notionRes.ok) {
      const errText = await notionRes.text().catch(() => '')
      return json(
        {
          error: `Notion API 오류 (${notionRes.status}): ${errText.slice(0, 600)}`,
          preview
        },
        notionRes.status
      )
    }

    const page = await notionRes.json()

    // ── 10) automation 후처리 — 제목 / 보고 상태 복구 ────────
    // automation 이 작성자 변경에 반응해서 제목을 봇 이름으로 덮어쓰고
    // 보고 상태를 "제출완료" 로 바꿈. 자연스러운 흐름은 작성중으로 유지하고
    // 우리가 만든 제목을 살려두는 것이라 PATCH 로 복구.
    if (willTriggerAutomation) {
      // automation 이 완료되도록 잠시 대기
      await new Promise((r) => setTimeout(r, 2000))
      try {
        await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
          method: 'PATCH',
          headers: {
            Authorization: `Bearer ${conn.access_token}`,
            'Notion-Version': '2022-06-28',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            properties: {
              '보고서 제목': { title: [{ text: { content: customTitle } }] },
              '보고 상태': { status: { name: '작성중' } }
            }
          })
        })
      } catch {
        // PATCH 실패는 비치명적 — 페이지 자체는 이미 생성됨. 사용자가 직접 수정 가능.
      }
    }

    return json({
      ok: true,
      url: page.url,
      pageId: page.id,
      preview
    })
  } catch (e) {
    return json({ error: '서버 오류: ' + (e?.message || String(e)) }, 500)
  }
}

// ── 유틸 ────────────────────────────────────────────────────

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  })
}

function addDays(d, n) {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + n)
  return out
}

function fmtDate(d) {
  const yyyy = d.getUTCFullYear()
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(d.getUTCDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function formatThisWeekTasks(records, monday) {
  const byDate = {}
  for (const r of records) byDate[r.log_date] = r.items || []

  const lines = []
  for (let i = 0; i < 5; i++) {
    const d = addDays(monday, i)
    const key = fmtDate(d)
    const items = byDate[key] || []
    const texts = items
      .map((it) => (it?.text || '').trim())
      .filter((t) => t.length > 0)
    if (texts.length === 0) continue
    lines.push(`[${WEEKDAYS[i]}] ${texts.join(', ')}`)
  }
  return lines.length > 0 ? lines.join('\n') : '(이번 주 일일 기록이 없습니다)'
}

function formatNextWeekTasks(items) {
  const filtered = (items || [])
    .map((it) => (it?.text || '').trim())
    .filter((t) => t.length > 0)
  if (filtered.length === 0) return '(다음 주 계획이 아직 작성되지 않았습니다)'
  return filtered.map((t) => `• ${t}`).join('\n')
}

/** ISO 주 정보 — { year, week } (Schedules 페이지 dateHelpers와 동일 로직) */
function isoWeekOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const year = d.getUTCFullYear()
  const yearStart = new Date(Date.UTC(year, 0, 1))
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7)
  return { year, week }
}

// ── 노션 사용자 자동 감지 ──────────────────────────────────────
//
// 첫 보고서 생성 시 1회 호출 — 사용자의 노션 토큰으로:
//   1) 주간보고 DB 스키마 → "작성자 (필수 지정)" relation 의 target = 사원 DB ID
//   2) 사원 DB 쿼리 → 사용자 email 과 일치하는 페이지 찾기
//   3) 그 페이지의 "팀" / "소속 팀" / "Team" 속성 값 추출
//
// 결과: { authorPageId, employeeDbId, teamName } | null
//
// email 매칭 실패 시 한국어 이름(title)도 fallback 으로 시도.
async function resolveNotionUser({ token, snapshotDbId, cachedEmployeeDbId, userEmail, userFullName }) {
  if (!token || !snapshotDbId) return null
  const headers = {
    Authorization: `Bearer ${token}`,
    'Notion-Version': '2022-06-28',
    'Content-Type': 'application/json'
  }

  // 1) 사원 DB ID 확보 (캐시 있으면 스키마 조회 스킵)
  let employeeDbId = cachedEmployeeDbId
  if (!employeeDbId) {
    try {
      const schemaRes = await fetch(`https://api.notion.com/v1/databases/${snapshotDbId}`, { headers })
      if (!schemaRes.ok) return null
      const schema = await schemaRes.json()
      for (const [propName, prop] of Object.entries(schema.properties || {})) {
        if (prop?.type === 'relation' && /작성자|author/i.test(propName)) {
          employeeDbId = prop.relation?.database_id
          break
        }
      }
      if (!employeeDbId) return null
    } catch {
      return null
    }
  }

  // 2) 사원 DB 쿼리 (페이지네이션 — 최대 3페이지 / 300명)
  const lowerEmail = (userEmail || '').toLowerCase().trim()
  const lowerName = (userFullName || '').toLowerCase().trim()
  let cursor = undefined
  let candidate = null  // 이름만 일치한 fallback (email 매칭 우선)

  for (let page = 0; page < 3; page++) {
    let queryRes
    try {
      queryRes = await fetch(`https://api.notion.com/v1/databases/${employeeDbId}/query`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) })
      })
    } catch {
      break
    }
    if (!queryRes.ok) break
    const data = await queryRes.json()

    for (const p of (data.results || [])) {
      const props = p.properties || {}
      let emailMatch = false
      let nameMatch = false
      let teamName = null

      for (const [propName, prop] of Object.entries(props)) {
        // 이메일 매칭
        if (lowerEmail && prop?.type === 'email' && prop.email && prop.email.toLowerCase() === lowerEmail) {
          emailMatch = true
        }
        // 이름 매칭 (Title 속성 — fallback)
        if (lowerName && prop?.type === 'title') {
          const t = (prop.title?.[0]?.plain_text || '').toLowerCase().trim()
          if (t && (t === lowerName || t.includes(lowerName) || lowerName.includes(t))) {
            nameMatch = true
          }
        }
        // 팀명 추출 — "팀", "파트", "team" 포함 + select/multi_select/rich_text 지원
        if (/팀|파트|team/i.test(propName) && !teamName) {
          if (prop?.type === 'select' && prop.select?.name) {
            teamName = prop.select.name
          } else if (prop?.type === 'multi_select' && prop.multi_select?.[0]?.name) {
            teamName = prop.multi_select[0].name
          } else if (prop?.type === 'rich_text' && prop.rich_text?.[0]?.plain_text) {
            teamName = prop.rich_text[0].plain_text
          }
        }
      }

      if (emailMatch) {
        return { authorPageId: p.id, employeeDbId, teamName }
      }
      if (nameMatch && !candidate) {
        candidate = { authorPageId: p.id, employeeDbId, teamName }
      }
    }

    if (!data.has_more) break
    cursor = data.next_cursor
  }

  // email 매칭 실패 — 이름 fallback 사용 (있으면)
  return candidate
}
