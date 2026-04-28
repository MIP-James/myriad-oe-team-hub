/**
 * Cloudflare Pages Function — 노션 주간 보고서 자동 생성
 *
 * 흐름:
 *   1) Authorization 헤더의 Supabase JWT 검증 → user 확인
 *   2) 요청 본문의 weekStartDate (월요일 YYYY-MM-DD) 기준 그 주 daily_records 조회
 *   3) 다음 주 weekly_plans 조회 (차주 우선 업무용)
 *   4) dryRun=true 면 미리보기 텍스트만 반환 (DB write X)
 *   5) dryRun=false 면 Notion API 로 페이지 생성 후 URL 반환
 *
 * 환경변수 (Cloudflare Pages 대시보드):
 *   - SUPABASE_URL
 *   - SUPABASE_ANON_KEY        (JWT 검증 + RLS 적용된 사용자 쿼리용)
 *   - NOTION_TOKEN             (Internal Integration Secret)
 *   - NOTION_DB_ID             (주간 업무 Snapshot DB)
 *   - NOTION_AUTHOR_PAGE_ID    (선택 — 사원 DB 의 본인 페이지 ID. 설정 시 작성자
 *                                relation 자동 채움. 미설정 시 빈 칸으로 두고
 *                                노션에서 사용자가 직접 선택. 후자가 노션 automation
 *                                발동에 더 안정적이라 기본 권장.)
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

    // dryRun = 미리보기만
    if (dryRun) {
      return json({ preview })
    }

    // ── 7) Notion API ───────────────────────────────────────
    if (!env.NOTION_TOKEN || !env.NOTION_DB_ID) {
      return json({ error: 'Notion 환경변수가 설정되지 않았습니다.' }, 500)
    }

    const properties = {
      // 보고서 제목 — 노션 자동화가 덮어쓰기를 기대. 일단 임시 제목
      '보고서 제목': {
        title: [{ text: { content: `_자동 생성 (${fmtDate(monday)} 기준)_` } }]
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
    // 작성자 (필수 지정) — relation 타입. 노션의 사원 DB 페이지 ID 가 필요.
    // 환경변수 NOTION_AUTHOR_PAGE_ID 설정 시 자동 채움. 미설정 시 빈 칸으로 두고
    // 노션에서 사용자가 본인을 선택하면 그때 부서/팀/부서장 자동화가 발동됨.
    if (env.NOTION_AUTHOR_PAGE_ID) {
      properties['작성자 (필수 지정)'] = {
        relation: [{ id: env.NOTION_AUTHOR_PAGE_ID }]
      }
    }

    const notionRes = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.NOTION_TOKEN}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        parent: { database_id: env.NOTION_DB_ID },
        properties
      })
    })

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
