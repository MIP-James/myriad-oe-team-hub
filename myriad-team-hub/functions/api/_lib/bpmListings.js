/**
 * BPM 침해 리스팅(enforcement/listings API) → scoreEngine 입력 변환.
 *
 * 원래 설계는 MM_INFRINGER_BASIC(침해자 마스터) + MM_DAY_INFRINGE_HIST(일별 삭제 이력)를
 * 통째로 받는 것이었으나, 개발팀 제공 API 에는 이 두 데이터셋이 없다. 대신 게시물 단위
 * 리스팅(판매자·사업자번호·연락처·위반확인일·신고일·삭제일)을 판매자 단위로 묶어 재구성한다.
 *
 *   - 행 단위 = (브랜드, 플랫폼, 판매자 계정). 같은 계정이 여러 브랜드에 걸치면 브랜드마다 1행
 *     (엔진의 브랜드별 파이프라인 점유율 계산이 repr_client_id 단위라서).
 *   - deleted       = 삭제 확인(removalDate 있음) 게시물 수
 *   - dayHist       = removalDate 별 삭제 건수 (MM_DAY_INFRINGE_HIST 대체 — 오히려 정확)
 *   - total_infringe_count = 위반이 확인된 "개월 수" (재적발 라운드 근사)
 *   - 오프라인 연계(세관/단속/법률) 건수 = 0 (리스팅 API 에 없음)
 *   - 공식 판매처(officialChannel=true) 게시물은 제외
 *
 * 의존성 0 (순수 함수) — node 수집 스크립트와 테스트에서 import.
 */

const day = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : null)

/**
 * @param {Array} listings enforcement/listings 응답 items 를 모은 배열
 * @returns {{ rows: Array, dayHist: Object, brandLabels: Object, stats: Object }}
 */
export function listingsToInfringers(listings) {
  const groups = new Map()
  const brandLabels = {}
  const stats = { listings: listings.length, official: 0, noSeller: 0, used: 0 }

  for (const l of listings) {
    if (l.officialChannel === true) { stats.official++; continue }
    const seller = String(l.sellerId || '').trim() || String(l.storeName || '').trim()
    if (!seller || !l.clientId) { stats.noSeller++; continue }
    stats.used++
    if (l.brand) brandLabels[l.clientId] = l.brand

    const platform = l.platformName || '-'
    const key = `${l.clientId}|${platform}|${seller}`
    let g = groups.get(key)
    if (!g) {
      g = { clientId: l.clientId, platform, seller, items: [] }
      groups.set(key, g)
    }
    g.items.push(l)
  }

  const rows = []
  const dayHist = {}
  for (const g of groups.values()) {
    // 행마다 고유 vendor_id — dayHist 가 vendor_id 키라 브랜드별 행이 이력을 공유하면 이중 집계됨.
    const vendorId = `${g.platform}:${g.seller}#${g.clientId}`
    const pick = (f) => {
      for (const it of g.items) { const v = it[f]; if (v != null && String(v).trim()) return String(v).trim() }
      return null
    }

    const removals = new Map()
    const months = new Set()
    let first = null, lastRemoval = null, lastAny = null
    for (const it of g.items) {
      const det = day(it.detectionDate), rep = day(it.reportDate), rem = day(it.removalDate)
      for (const d of [det, rep, rem]) {
        if (!d) continue
        if (!first || d < first) first = d
        if (!lastAny || d > lastAny) lastAny = d
      }
      if (rem) {
        removals.set(rem, (removals.get(rem) || 0) + 1)
        if (!lastRemoval || rem > lastRemoval) lastRemoval = rem
      }
      const m = (det || rep || rem || '').slice(0, 7)
      if (m) months.add(m)
    }

    const deleted = Array.from(removals.values()).reduce((s, c) => s + c, 0)
    rows.push({
      vendor_id: vendorId,
      platform_id: g.platform,
      repr_client_id: g.clientId,
      seller_account: g.seller,
      store_name: pick('storeName') || g.seller,
      company_name: null,
      president_name: null,
      seller_email: null,
      biz_reg_no: pick('bizRegNo'),
      seller_phone_no: pick('sellerContact'),
      deleted,
      total_infringe_count: months.size,
      first_date: first,
      last_date: lastRemoval || lastAny,
      online_associated_infringer_count: 0,
      customs_associated_infringer_count: 0,
      enforce_associated_infringer_count: 0,
      legal_associated_infringer_count: 0,
      listing_count: g.items.length,
    })
    if (removals.size) {
      dayHist[vendorId] = Array.from(removals.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([basic_ymd, removal_count]) => ({ basic_ymd, removal_count }))
    }
  }

  stats.rows = rows.length
  return { rows, dayHist, brandLabels, stats }
}
