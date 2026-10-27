/**
 * 자동 수집 결과 (mig 040) — 노트북 자동 수집 실행기(utilities/patrol-runner)가 올린 신규 상품.
 *
 * 등급(tier): A = 대표 이미지 일치(위반 확정과 같은 사진) / B = 검토 / C = 참고 / X = 제외(화면 미노출).
 * 실무자는 썸네일·상품명·가격만 보고 골라 URL 을 복사 → BPM Collector 대량 캡처 / BPM 작업 추가(URL)로 재수집.
 * '제외' = status 'excluded' — 같은 사진은 다음 자동 수집부터 실행기가 자동으로 뺌.
 * '상세 확인 필요' = status 'review' (mig 041) — 지금 목록에선 빠지고, 같은 사진이 다시 수집되면
 *   빼지 않고 review_match(빨간 테두리)로 표시 → 상세 페이지가 달라 쓸 수 있는 건을 놓치지 않게.
 */
import { supabase } from './supabase'

export const TIERS = [
  { key: 'A', label: '대표 이미지 일치' },
  { key: 'B', label: '검토' },
  { key: 'C', label: '참고' }
]

export const PLATFORMS = ['지마켓', '옥션', '스마트스토어', '11번가']

const COLS = 'id, platform, product_id, url, title, price, image, model_type, product_type, tier, score, status, review_match, bpm_registered, first_seen'

function applyFilters(q, f) {
  q = q.eq('first_seen', f.date).eq('status', 'new')
  if (f.platform) q = q.eq('platform', f.platform)
  if (f.productType) q = q.eq('product_type', f.productType)
  if (f.modelType) q = q.eq('model_type', f.modelType)
  if (f.hideRegistered) q = q.eq('bpm_registered', false)
  return q
}

/** 자동 수집 결과가 있는 날짜 (최신순) */
export async function listDates(limit = 30) {
  const { data, error } = await supabase
    .from('patrol_runs')
    .select('created_at')
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw error
  const days = [...new Set((data ?? []).map((r) => toLocalDate(r.created_at)))]
  return days.slice(0, limit)
}

/** 선택한 날짜의 필터 선택지 (플랫폼·상품 유형·모델 유형) */
export async function listFacets(date) {
  const out = { platforms: new Set(), productTypes: new Set(), modelTypes: new Set() }
  const PAGE = 1000
  for (let from = 0; from < 50000; from += PAGE) {
    const { data, error } = await supabase
      .from('patrol_items')
      .select('platform, product_type, model_type')
      .eq('first_seen', date)
      .eq('status', 'new')
      .neq('tier', 'X')
      .range(from, from + PAGE - 1)
    if (error) throw error
    for (const r of data ?? []) {
      if (r.platform) out.platforms.add(r.platform)
      if (r.product_type) out.productTypes.add(r.product_type)
      if (r.model_type) out.modelTypes.add(r.model_type)
    }
    if (!data || data.length < PAGE) break
  }
  return {
    platforms: PLATFORMS.filter((p) => out.platforms.has(p)),
    productTypes: [...out.productTypes].sort(),
    modelTypes: [...out.modelTypes].sort()
  }
}

/** 등급별 건수 (현재 필터 기준) */
export async function countByTier(f) {
  const res = {}
  await Promise.all(TIERS.map(async ({ key }) => {
    const { count, error } = await applyFilters(
      supabase.from('patrol_items').select('id', { count: 'exact', head: true }), f
    ).eq('tier', key)
    if (error) throw error
    res[key] = count ?? 0
  }))
  return res
}

/** 상품 목록 (상세 확인 필요 사진 재등장 → 맨 앞, 그다음 점수 높은 순) */
export async function listItems(f, { offset = 0, limit = 120 } = {}) {
  const { data, error } = await applyFilters(
    supabase.from('patrol_items').select(COLS), f
  )
    .eq('tier', f.tier)
    .order('review_match', { ascending: false })
    .order('score', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .range(offset, offset + limit - 1)
  if (error) throw error
  return data ?? []
}

/**
 * 처리 — status 'excluded'(제외: 같은 사진은 다음부터 자동으로 빠짐)
 *        / 'review'(상세 확인 필요: 같은 사진은 다음에 빨간 테두리로 다시 나옴).
 * excluded_by / excluded_at 은 두 상태 공통 '처리한 사람·시각'.
 */
export async function markItem(id, status, userId) {
  const { error } = await supabase
    .from('patrol_items')
    .update({ status, excluded_by: userId, excluded_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** 처리 되돌리기 */
export async function restoreItem(id) {
  const { error } = await supabase
    .from('patrol_items')
    .update({ status: 'new', excluded_by: null, excluded_at: null })
    .eq('id', id)
  if (error) throw error
}

function toLocalDate(iso) {
  const d = new Date(iso)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
