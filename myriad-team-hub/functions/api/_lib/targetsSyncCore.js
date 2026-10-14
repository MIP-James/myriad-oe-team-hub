/**
 * 재침해자 타겟 보드 — 점수 계산 + Supabase 반영 공통 로직.
 *
 * 두 곳에서 같은 코드로 쓴다:
 *   - functions/api/targets-sync.js   (웹 "지금 갱신" — 샘플 데이터)
 *   - scripts/targets-bpm-sync.mjs    (PC 주 1회 — BPM 실데이터. Cloudflare 함수 한도 밖에서 실행)
 *
 * 수천 명 규모를 감안해 upsert/삭제/스냅샷 조회를 전부 청크·페이지 단위로 처리한다
 * (PostgREST 기본 1000행 상한, `not in (...)` URL 길이 한도 회피).
 */
import { scoreInfringers } from './scoreEngine.js'

const CHUNK = 500

async function selectAll(build) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build().range(from, from + 999)
    if (error) throw new Error(error.message)
    out.push(...(data || []))
    if (!data || data.length < 1000) return out
  }
}

/**
 * @param admin  service-role Supabase client
 * @param opts   { rows, dayHist, source, today, brandName, brandWindowMonths, seedPrior }
 *   seedPrior: (operators, today) => Promise — 스냅샷이 하나도 없을 때 데모용 직전 스냅샷 합성(샘플 전용)
 */
export async function syncTargets(admin, opts) {
  const { rows, dayHist, source, today, brandName, brandWindowMonths, seedPrior } = opts

  // ── 점수 계산 ──
  const { operators, stats, cuts } = scoreInfringers(rows, {
    refDate: today, dayHist, brandName, brandWindowMonths,
  })

  // ── 직전 스냅샷 → prev_grade (가장 최근 스냅샷 날짜 1개만 읽음) ──
  if (seedPrior) {
    const { count } = await admin.from('target_score_snapshots').select('*', { count: 'exact', head: true })
    if (!count) await seedPrior(operators, today)
  }
  const prevGrade = {}
  const { data: lastSnap } = await admin.from('target_score_snapshots')
    .select('snapshot_ymd').lt('snapshot_ymd', today)
    .order('snapshot_ymd', { ascending: false }).limit(1)
  if (lastSnap && lastSnap[0]) {
    const prev = await selectAll(() => admin.from('target_score_snapshots')
      .select('cluster_key, grade').eq('snapshot_ymd', lastSnap[0].snapshot_ymd).order('cluster_key'))
    for (const s of prev) prevGrade[s.cluster_key] = s.grade
  }

  // ── upsert (워크플로우 컬럼 status/converted_case_id/assigned_to 는 미포함 → 보존) ──
  const now = new Date().toISOString()
  const payload = operators.map((o) => ({
    cluster_key: o.cluster_key,
    rep_store: o.rep_store, rep_company: o.rep_company, rep_president: o.rep_president,
    platforms: o.platforms, brands: o.brands, brand_count: o.brand_count, cross_brand: o.cross_brand,
    account_count: o.account_count, deleted_sum: o.deleted_sum, cumulative_max: o.cumulative_max,
    first_date: o.first_date, last_date: o.last_date, recency_months: o.recency_months,
    identified: o.identified, link_online: o.link_online, customs: o.customs, raid: o.raid, legal: o.legal,
    has_legal_pipeline: o.has_legal_pipeline, is_big: o.is_big,
    is_pipeline: o.is_pipeline, brand_share: o.brand_share, pipeline_window: o.pipeline_window,
    enf_score: o.enf_score, yield_score: o.yield_score, grade: o.grade,
    prev_grade: prevGrade[o.cluster_key] || null,
    trend: o.trend, trend_pct: o.trend_pct, detail: o.detail,
    scored_at: now, updated_at: now,
  }))
  for (let i = 0; i < payload.length; i += CHUNK) {
    const { error } = await admin.from('infringer_targets')
      .upsert(payload.slice(i, i + CHUNK), { onConflict: 'cluster_key' })
    if (error) throw new Error('upsert 실패: ' + error.message)
  }

  // ── 이번 동기화에서 사라진 운영자 정리 — 케이스 전환된 건 보존 ──
  const keep = new Set(operators.map((o) => o.cluster_key))
  const existing = await selectAll(() => admin.from('infringer_targets')
    .select('cluster_key').is('converted_case_id', null).order('cluster_key'))
  const stale = existing.map((r) => r.cluster_key).filter((k) => !keep.has(k))
  for (let i = 0; i < stale.length; i += 200) {
    const { error } = await admin.from('infringer_targets').delete().in('cluster_key', stale.slice(i, i + 200))
    if (error) throw new Error('정리 실패: ' + error.message)
  }

  // ── 오늘자 스냅샷 ──
  const snapRows = operators.map((o) => ({
    snapshot_ymd: today, cluster_key: o.cluster_key,
    grade: o.grade, enf_score: o.enf_score, yield_score: o.yield_score,
  }))
  for (let i = 0; i < snapRows.length; i += CHUNK) {
    const { error } = await admin.from('target_score_snapshots')
      .upsert(snapRows.slice(i, i + CHUNK), { onConflict: 'snapshot_ymd,cluster_key' })
    if (error) throw new Error('스냅샷 실패: ' + error.message)
  }

  return { source, stats, cuts, removed: stale.length }
}

/** 동기화 실행 기록 (mig 039). 테이블이 아직 없으면 조용히 건너뜀. */
export async function recordRun(admin, run) {
  const { error } = await admin.from('targets_sync_runs').insert(run)
  return !error
}

/** 가장 최근 실행 기록. 테이블이 없거나 기록이 없으면 null. */
export async function lastRun(admin) {
  const { data, error } = await admin.from('targets_sync_runs')
    .select('source, ran_at, stats').order('ran_at', { ascending: false }).limit(1)
  if (error || !data) return null
  return data[0] || null
}
