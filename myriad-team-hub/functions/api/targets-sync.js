/**
 * Cloudflare Pages Function — 재침해자 타겟 보드 동기화.
 *
 *   POST /api/targets-sync
 *
 * 흐름:
 *   1. 침해자 데이터 확보 (현재: mockBpm / 다음 주: BPM DB SQL 조회)
 *   2. scoreEngine 으로 2축 점수 + 등급 계산
 *   3. 직전 스냅샷과 비교해 prev_grade(승급/강등) 세팅
 *   4. infringer_targets upsert (상태/케이스 전환 등 워크플로우 컬럼은 보존)
 *   5. 오늘자 스냅샷 기록 (등급 변동 추적용)
 *
 * 호출 방식:
 *   - 외부 cron (pg_cron) 월간 호출 → Authorization: Bearer ${TARGETS_CRON_SECRET}
 *   - 페이지의 "지금 갱신" 버튼 (admin JWT)
 *
 * 환경변수:
 *   - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
 *   - TARGETS_CRON_SECRET (외부 cron 인증용)
 *   - TARGETS_SOURCE = 'mock'(기본) | 'bpm'  ← BPM DB 들어오면 'bpm' 으로 전환
 *   - (BPM 'bpm' 모드 전용) BPM_DB_URL 등 ← 아래 fetchFromBpm 참고
 */
import { createClient } from '@supabase/supabase-js'
import { scoreInfringers } from './_lib/scoreEngine.js'
import { generateMockBpm } from './_lib/mockBpm.js'

// 대표 고객사 ID → 브랜드 표시명. 실제 DB 연동 시 clients 테이블/매핑으로 교체.
const BRAND_LABEL = {
  'C-APPLE': 'APPLE', 'C-MONCLE': 'MONCLER', 'C-GOLDEN': 'GOLDEN GOOSE',
  'C-FILA': 'FILA', 'C-TORYB': 'TORY BURCH',
}

export async function onRequestPost(context) {
  const { request, env } = context
  try {
    // ── 인증: cron secret 또는 admin JWT ──
    const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) return json({ error: '인증 토큰 누락' }, 401)
    const isCron = env.TARGETS_CRON_SECRET && token === env.TARGETS_CRON_SECRET
    if (!isCron) {
      const sb = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })
      const { data: { user } } = await sb.auth.getUser()
      if (!user) return json({ error: '인증 실패' }, 401)
      const { data: profile } = await sb.from('profiles').select('role').eq('id', user.id).maybeSingle()
      if (profile?.role !== 'admin') return json({ error: '관리자 권한 필요' }, 403)
    }

    const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const today = new Date().toISOString().slice(0, 10)

    // ── 1) 데이터 확보 ──
    const source = env.TARGETS_SOURCE || 'mock'
    let rows, dayHist
    if (source === 'bpm') {
      ({ rows, dayHist } = await fetchFromBpm(env))
    } else {
      ({ rows, dayHist } = generateMockBpm({ refDate: today, count: 60 }))
    }

    // ── 2) 점수 계산 ──
    const { operators, stats, cuts } = scoreInfringers(rows, {
      refDate: today, dayHist, brandName: (id) => BRAND_LABEL[id] || id,
    })

    // ── 3) 직전 스냅샷 → prev_grade ──
    // 데모 편의: 스냅샷이 하나도 없으면(첫 mock 실행) "지난달" 스냅샷을 합성해
    //           일부 운영자가 승급/강등으로 보이게 한다. 실제 운영에선 자연히 쌓임.
    const { count: snapCount } = await admin
      .from('target_score_snapshots').select('*', { count: 'exact', head: true })
    if (source === 'mock' && !snapCount) {
      await seedPriorSnapshot(admin, operators, today)
    }

    const { data: prevSnaps } = await admin
      .from('target_score_snapshots')
      .select('cluster_key, grade, snapshot_ymd')
      .lt('snapshot_ymd', today)
      .order('snapshot_ymd', { ascending: false })
    const prevGrade = {}
    for (const s of prevSnaps || []) if (!(s.cluster_key in prevGrade)) prevGrade[s.cluster_key] = s.grade

    // ── 4) upsert (워크플로우 컬럼 status/converted_case_id/assigned_to 는 미포함 → 보존) ──
    const payload = operators.map((o) => ({
      cluster_key: o.cluster_key,
      rep_store: o.rep_store, rep_company: o.rep_company, rep_president: o.rep_president,
      platforms: o.platforms, brands: o.brands, brand_count: o.brand_count, cross_brand: o.cross_brand,
      account_count: o.account_count, deleted_sum: o.deleted_sum, cumulative_max: o.cumulative_max,
      first_date: o.first_date, last_date: o.last_date, recency_months: o.recency_months,
      identified: o.identified, link_online: o.link_online, customs: o.customs, raid: o.raid, legal: o.legal,
      has_legal_pipeline: o.has_legal_pipeline, is_big: o.is_big,
      is_pipeline: o.is_pipeline, brand_share: o.brand_share,
      enf_score: o.enf_score, yield_score: o.yield_score, grade: o.grade,
      prev_grade: prevGrade[o.cluster_key] || null,
      trend: o.trend, trend_pct: o.trend_pct, detail: o.detail,
      scored_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }))

    const { error: upErr } = await admin
      .from('infringer_targets')
      .upsert(payload, { onConflict: 'cluster_key' })
    if (upErr) return json({ error: 'upsert 실패: ' + upErr.message }, 500)

    // 이번 동기화에서 사라진(더 이상 안 잡힌) 운영자 정리 — 단, 케이스 전환된 건 보존
    const keys = operators.map((o) => o.cluster_key)
    await admin.from('infringer_targets')
      .delete().not('cluster_key', 'in', `(${keys.map((k) => `"${k}"`).join(',')})`)
      .is('converted_case_id', null)

    // ── 5) 오늘자 스냅샷 ──
    const snapRows = operators.map((o) => ({
      snapshot_ymd: today, cluster_key: o.cluster_key,
      grade: o.grade, enf_score: o.enf_score, yield_score: o.yield_score,
    }))
    await admin.from('target_score_snapshots').upsert(snapRows, { onConflict: 'snapshot_ymd,cluster_key' })

    return json({ ok: true, source, stats, cuts, synced_at: new Date().toISOString() })
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500)
  }
}

// 데모용 "지난달" 스냅샷 합성 — 교차브랜드/A/B 일부를 한 단계 낮춰 승급처럼 보이게.
async function seedPriorSnapshot(admin, operators, today) {
  const prior = new Date(today); prior.setDate(prior.getDate() - 30)
  const priorYmd = prior.toISOString().slice(0, 10)
  const down = { A: 'C', B: 'C', C: 'D', D: 'D', X: 'X' }
  const rows = operators.map((o, i) => ({
    snapshot_ymd: priorYmd, cluster_key: o.cluster_key,
    // 약 40% 만 강등시켜 둠 → 이번 달에 일부가 승급으로 표시
    grade: i % 5 < 2 ? (down[o.grade] || o.grade) : o.grade,
    enf_score: o.enf_score, yield_score: o.yield_score,
  }))
  await admin.from('target_score_snapshots').upsert(rows, { onConflict: 'snapshot_ymd,cluster_key' })
}

/**
 * ⚠️ 다음 주 BPM DB 들어오면 여기만 구현하면 됩니다.
 *
 * 반환 형식 (mockBpm 과 동일):
 *   { rows: [ MM_INFRINGER_BASIC row ... ], dayHist: { [vendor_id]: [{ basic_ymd, removal_count }] } }
 *
 * 구현 방법 (개발팀 답변 받은 뒤 택1):
 *   - Postgres 직접 연결: Cloudflare 의 `connect()` (TCP) + postgres 드라이버로
 *     `SELECT ... FROM MM_INFRINGER_BASIC` / `MM_DAY_INFRINGE_HIST` 조회.
 *   - 또는 사내망 전용이면: 사내에 배치 스크립트가 SELECT → Supabase 적재,
 *     이 함수는 생략하고 pg_cron 이 그 적재본을 스코어링하도록 변경.
 *
 * 컬럼 매핑은 BPM_재침해자스코어링_DB연동요청서.md 참고. scoreEngine 이 기대하는
 * 필드명(repr_client_id, vendor_id, trans_*, *_associated_infringer_count, total_infringe_count,
 * first_date, last_date, customs_case_id, target_approval_ymd 등)으로 맞춰주면 됨.
 */
async function fetchFromBpm(env) {
  throw new Error('BPM 연동 미구현 — DB 접속 정보 수신 후 fetchFromBpm() 구현 필요 (현재는 TARGETS_SOURCE=mock 사용)')
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
