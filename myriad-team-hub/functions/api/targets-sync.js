/**
 * Cloudflare Pages Function — 재침해자 타겟 보드 동기화 (샘플 데이터 전용).
 *
 *   POST /api/targets-sync
 *
 * BPM 실데이터는 이 함수가 아니라 PC 주 1회 스크립트(scripts/targets-bpm-sync.mjs)가 반영한다.
 *   - BPM 리스팅 API 는 브랜드별·500건 단위 호출이라 수백 번 호출 → Cloudflare 무료 플랜
 *     함수 1회 한도(외부 호출 50개 / CPU 10ms)로는 불가. API 키도 공개 레포·브라우저에 두지 않음.
 *   - 그래서 이 함수는 샘플(mock) 데이터 데모용으로만 남기고, BPM 실데이터가 한 번이라도
 *     반영됐으면(targets_sync_runs.source='bpm') 샘플로 덮어쓰지 않도록 거절한다.
 *
 * 점수 계산·반영 로직은 _lib/targetsSyncCore.js 를 PC 스크립트와 공유.
 *
 * 호출: 페이지의 "지금 갱신" 버튼 (admin JWT) / 외부 cron (Bearer ${TARGETS_CRON_SECRET})
 * 환경변수: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY / TARGETS_CRON_SECRET
 */
import { createClient } from '@supabase/supabase-js'
import { generateMockBpm } from './_lib/mockBpm.js'
import { syncTargets, recordRun, lastRun } from './_lib/targetsSyncCore.js'

// 샘플 데이터의 대표 고객사 ID → 브랜드 표시명.
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

    // BPM 실데이터가 들어온 뒤에는 샘플로 덮어쓰지 않는다
    const last = await lastRun(admin)
    if (last && last.source === 'bpm') {
      const when = new Date(last.ran_at).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })
      return json({
        error: `BPM 실데이터는 매주 PC 수집 스크립트로 자동 갱신됩니다 (마지막 갱신: ${when}). `
          + '바로 갱신하려면 관리자 PC 에서 admin-scripts/targets_sync.bat 를 실행하세요.',
      }, 409)
    }

    const today = new Date().toISOString().slice(0, 10)
    const { rows, dayHist } = generateMockBpm({ refDate: today, count: 60 })
    const result = await syncTargets(admin, {
      rows, dayHist, source: 'mock', today,
      brandName: (id) => BRAND_LABEL[id] || id,
      seedPrior: (operators, t) => seedPriorSnapshot(admin, operators, t),
    })
    await recordRun(admin, { source: 'mock', stats: result.stats })

    return json({ ok: true, ...result, synced_at: new Date().toISOString() })
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

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status, headers: { 'Content-Type': 'application/json' },
  })
}
