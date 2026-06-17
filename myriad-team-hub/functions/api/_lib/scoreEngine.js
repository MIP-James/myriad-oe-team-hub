/**
 * 재침해자 2축 스코어링 엔진 (BPM 데이터용 JS 이식판).
 *
 * 원본: repeat-infringer-scoring 스킬의 score2axis.py.
 *   축1 = 법적 타겟 점수(enf_score), 축2 = 모니터링 생산성(yield_score).
 *   두 축을 高/低로 잘라 A/B/C/D 등급, 대형유통/샵인샵은 X.
 *
 * 입력: BPM MM_INFRINGER_BASIC 형태의 row 배열 (+ 선택: vendor_id별 일별 이력).
 * 출력: 운영자(클러스터) 단위로 묶인 스코어 객체 배열.
 *
 * 이 파일은 의존성 0 (순수 함수) — Cloudflare Function 과 node 스크립트 양쪽에서 import.
 */

// ── 샵인샵/대형 유통 (양축 0점 + X등급) ─────────────────────
// 원본 score2axis.py BIG_PLATFORM_SELLERS 와 동일. 새 샵인샵 발견 시 추가.
const BIG_PLATFORM_SELLERS = [
  'ssg', 'emart', 'hyundai', 'lotte', 'gsshop', 'akmall',
  'artbox', 'shinsegae', '현대', '신세계', '롯데', '이마트', '아트박스',
  '커머스허브', 'comhub',
  '하프클럽', '트라이씨클', 'boribori', 'borikids', '보리보리',
  '패션플러스', 'fashionplus',
  '교보핫트랙스', '핫트랙스', 'hottracks',
  '스마일배송', 'smiledelivery',
  'sk스토아', 'sk스토어', 'skstoa', '에스케이스토아',
]

const log10 = (x) => Math.log(x) / Math.LN10
const clip = (x, lo, hi) => Math.max(lo, Math.min(hi, x))

function normBiz(b) {
  if (!b) return null
  const d = String(b).replace(/\D/g, '')
  return d.length === 10 ? d : null
}
function normPhone(p) {
  if (!p) return null
  let d = String(p).replace(/\D/g, '')
  if (d.length < 8) return null
  if (d.startsWith('82')) d = '0' + d.slice(2)
  return d
}
function normEmail(e) {
  if (!e) return null
  const s = String(e).trim().toLowerCase()
  return s.includes('@') ? s : null
}
// 깨진/더미 값 차단 (원본 is_junk 이식)
function isJunk(v) {
  if (!v) return true
  const d = String(v).replace(/\D/g, '')
  if (new Set(d).size <= 2) return true
  if (['123456789', '1234567890', '01012345678', '0101234567'].includes(d)) return true
  if (d.includes('1234567') || d.includes('987654')) return true
  return false
}

function isBig(row) {
  const blob = [row.vendor_id, row.store_name, row.company_name, row.seller_account]
    .map((x) => String(x || '')).join(' ').toLowerCase()
  return BIG_PLATFORM_SELLERS.some((b) => blob.includes(b.toLowerCase()))
}

// ── Union-Find: 정규화된 사업자/전화/이메일이 겹치면 동일 운영자 ─────
function buildClusters(rows) {
  const n = rows.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[rb] = ra }

  const keyOwner = new Map()
  const keyOf = (row) => {
    // BPM 정규화 필드(trans_*) 우선, 없으면 원본 fallback
    const biz = normBiz(row.trans_biz_reg_no || row.biz_reg_no)
    const phone = normPhone(row.trans_seller_phone_no || row.seller_phone_no)
    const email = normEmail(row.seller_email)
    return [
      biz && !isJunk(biz) ? 'b:' + biz : null,
      phone && !isJunk(phone) ? 'p:' + phone : null,
      email ? 'e:' + email : null,
    ].filter(Boolean)
  }
  rows.forEach((row, i) => {
    for (const k of keyOf(row)) {
      if (keyOwner.has(k)) union(keyOwner.get(k), i)
      else keyOwner.set(k, i)
    }
  })
  return rows.map((_, i) => find(i))
}

// 안정적 클러스터 키 (정렬 후 djb2 해시) — 재실행해도 같은 운영자는 같은 키
function clusterKey(rows) {
  const parts = []
  for (const r of rows) {
    const biz = normBiz(r.trans_biz_reg_no || r.biz_reg_no)
    const phone = normPhone(r.trans_seller_phone_no || r.seller_phone_no)
    if (biz) parts.push('b' + biz)
    if (phone) parts.push('p' + phone)
  }
  const basis = parts.length
    ? Array.from(new Set(parts)).sort().join('|')
    : 'v:' + rows.map((r) => `${r.platform_id}/${r.vendor_id}`).sort().join('|')
  let h = 5381
  for (let i = 0; i < basis.length; i++) h = ((h << 5) + h + basis.charCodeAt(i)) >>> 0
  return 'op_' + h.toString(36)
}

function quantile(sorted, q) {
  if (!sorted.length) return 0
  const pos = (sorted.length - 1) * q
  const base = Math.floor(pos)
  const rest = pos - base
  return sorted[base + 1] !== undefined
    ? sorted[base] + rest * (sorted[base + 1] - sorted[base])
    : sorted[base]
}

/**
 * @param {Array} rows  MM_INFRINGER_BASIC row 배열
 * @param {Object} opts
 *   - refDate: 기준일 (Date) — 최근성 계산. 기본 오늘.
 *   - dayHist: { [vendor_id]: [{ basic_ymd, removal_count }] } — 추세 계산용 (선택)
 *   - brandName: (repr_client_id) => 표시용 브랜드명 (선택)
 * @returns {Array} 운영자 스코어 객체
 */
export function scoreInfringers(rows, opts = {}) {
  const ref = opts.refDate ? new Date(opts.refDate) : new Date()
  const dayHist = opts.dayHist || {}
  const brandName = opts.brandName || ((id) => id)

  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
  const parents = buildClusters(rows)
  const groups = new Map()
  rows.forEach((r, i) => {
    const c = parents[i]
    if (!groups.has(c)) groups.set(c, [])
    groups.get(c).push(r)
  })

  const ops = []
  for (const members of groups.values()) {
    const pick = (f) => { for (const m of members) { const v = m[f]; if (v != null && String(v).trim()) return v } return '' }
    const dates = members.map((m) => m.last_date).filter(Boolean).map((d) => new Date(d))
    const firsts = members.map((m) => m.first_date).filter(Boolean).map((d) => new Date(d))
    const last = dates.length ? new Date(Math.max(...dates)) : null
    const first = firsts.length ? new Date(Math.min(...firsts)) : null

    const deletedSum = members.reduce((s, m) => s + num(m.total_infringe_count || m.deleted), 0)
    const cumulativeMax = Math.max(0, ...members.map((m) => num(m.total_infringe_count)))
    const linkOnline = Math.max(0, ...members.map((m) => num(m.online_associated_infringer_count) + num(m.online_potential_infringer_count)))
    const customs = Math.max(0, ...members.map((m) => num(m.customs_associated_infringer_count) + num(m.customs_potential_infringer_count)))
    const raid = Math.max(0, ...members.map((m) => num(m.enforce_associated_infringer_count) + num(m.enforce_potential_infringer_count)))
    const legal = Math.max(0, ...members.map((m) => num(m.legal_associated_infringer_count) + num(m.legal_potential_infringer_count)))

    const hasBiz = members.some((m) => normBiz(m.trans_biz_reg_no || m.biz_reg_no))
    const hasPhone = members.some((m) => normPhone(m.trans_seller_phone_no || m.seller_phone_no))
    const hasPresident = members.some((m) => (m.president_name || '').trim())
    const identified = hasBiz || hasPhone || hasPresident
    const big = members.some(isBig)

    // 교차 브랜드: 한 운영자가 엮인 대표 고객사(브랜드) 수
    const brandIds = Array.from(new Set(members.map((m) => m.repr_client_id).filter(Boolean)))
    const brands = brandIds.map(brandName)
    const crossBrand = brandIds.length > 1

    // 법무 파이프라인 진행중 (legal target 승인일 존재)
    const hasLegalPipeline = members.some((m) => m.legal_target_approval_ymd || m.target_approval_ymd)

    const years = first && last ? clip((last - first) / (1000 * 86400 * 365.25), 0, 100) : 0
    const recencyM = last ? (ref - last) / (1000 * 86400 * 30.4) : null

    // ── 축1: 법적 타겟 점수 (신원 불명이면 0) ──
    const persistence = clip(log10(Math.max(cumulativeMax, 1)) / log10(15), 0, 1)
    const duration = clip(years / 3, 0, 1)
    const linkage = clip(linkOnline / 30, 0, 1)
    const offline = clip(customs + raid + legal, 0, 3) / 3
    let enf = persistence * 35 + duration * 20 + linkage * 20 + offline * 25
    enf = identified ? Math.round(enf * 10) / 10 : 0

    // ── 축2: 모니터링 생산성 점수 ──
    const volume = clip(log10(Math.max(deletedSum, 1)) / log10(1000), 0, 1)
    const recency = recencyM == null ? 0 : clip(1 - recencyM / 12, 0, 1)
    const freq = clip(log10(Math.max(cumulativeMax, 1)) / log10(15), 0, 1)
    let yld = Math.round((volume * 50 + recency * 35 + freq * 15) * 10) / 10

    if (big) { enf = 0; yld = 0 }

    // ── 추세 (일별 이력 있을 때만): 최근 30일 vs 직전 30일 삭제 건수 ──
    let trend = 'unknown', trendPct = null, series = []
    const vids = members.map((m) => m.vendor_id)
    const allDays = vids.flatMap((v) => dayHist[v] || [])
    if (allDays.length) {
      // 날짜별 합산
      const byDay = new Map()
      for (const d of allDays) byDay.set(d.basic_ymd, (byDay.get(d.basic_ymd) || 0) + num(d.removal_count))
      series = Array.from(byDay.entries()).sort((a, b) => a[0] < b[0] ? -1 : 1).map(([ymd, c]) => ({ ymd, count: c }))
      const cut = new Date(ref); cut.setDate(cut.getDate() - 30)
      const cut2 = new Date(ref); cut2.setDate(cut2.getDate() - 60)
      let recent = 0, prior = 0
      for (const [ymd, c] of byDay) {
        const dt = new Date(ymd)
        if (dt >= cut) recent += c
        else if (dt >= cut2) prior += c
      }
      if (prior === 0 && recent === 0) trend = 'decline'
      else if (prior === 0) { trend = 'surge'; trendPct = 100 }
      else {
        trendPct = Math.round(((recent - prior) / prior) * 100)
        trend = trendPct >= 25 ? 'surge' : trendPct <= -25 ? 'decline' : 'steady'
      }
    }

    ops.push({
      cluster_key: clusterKey(members),
      rep_store: pick('store_name'),
      rep_company: pick('company_name'),
      rep_president: pick('president_name'),
      platforms: Array.from(new Set(members.map((m) => m.platform_id).filter(Boolean))).join(', '),
      brands, brand_count: brandIds.length, cross_brand: crossBrand,
      account_count: new Set(members.map((m) => `${m.platform_id}/${m.vendor_id}`)).size,
      deleted_sum: Math.round(deletedSum),
      cumulative_max: cumulativeMax,
      first_date: first ? first.toISOString().slice(0, 10) : null,
      last_date: last ? last.toISOString().slice(0, 10) : null,
      recency_months: recencyM == null ? null : Math.round(recencyM),
      identified,
      link_online: linkOnline, customs, raid, legal,
      has_legal_pipeline: hasLegalPipeline,
      is_big: big,
      enf_score: enf, yield_score: yld,
      trend, trend_pct: trendPct,
      detail: {
        accounts: members.map((m) => ({
          platform: m.platform_id, vendor_id: m.vendor_id, store: m.store_name,
          biz: m.biz_reg_no, phone: m.seller_phone_no, email: m.seller_email,
        })),
        evidence: {
          customs: members.filter((m) => m.customs_case_id).map((m) => ({ id: m.customs_case_id, ymd: m.case_reg_ymd })),
          enforce: members.filter((m) => m.enforce_case_id).map((m) => ({ id: m.enforce_case_id, ymd: m.enforce_req_ymd })),
          legal: members.filter((m) => m.target_case_id || m.legal_target_case_id).map((m) => ({ id: m.target_case_id || m.legal_target_case_id, approval: m.target_approval_ymd || m.legal_target_approval_ymd })),
        },
        series,
      },
    })
  }

  // ── 高/低 컷: 유효 클러스터(대형 제외) 상위 30%, 최소 30점 바닥 ──
  const valid = ops.filter((o) => !o.is_big)
  const enfPos = valid.map((o) => o.enf_score).filter((s) => s > 0).sort((a, b) => a - b)
  const yldArr = valid.map((o) => o.yield_score).sort((a, b) => a - b)
  const enfHi = Math.max(enfPos.length ? quantile(enfPos, 0.70) : 0, 30)
  const yieldHi = Math.max(quantile(yldArr, 0.70), 30)

  for (const o of ops) {
    if (o.is_big) { o.grade = 'X'; continue }
    const eHi = o.enf_score >= enfHi && o.enf_score > 0
    const yHi = o.yield_score >= yieldHi
    o.grade = eHi && yHi ? 'B' : eHi && !yHi ? 'A' : !eHi && yHi ? 'C' : 'D'
  }

  return {
    operators: ops,
    cuts: { enf_hi: Math.round(enfHi * 10) / 10, yield_hi: Math.round(yieldHi * 10) / 10 },
    stats: {
      records: rows.length,
      clusters: ops.length,
      counts: ops.reduce((m, o) => { m[o.grade] = (m[o.grade] || 0) + 1; return m }, {}),
      cross_brand: ops.filter((o) => o.cross_brand && o.grade !== 'X').length,
    },
  }
}

export { BIG_PLATFORM_SELLERS }
