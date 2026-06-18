/**
 * BPM 테이블 모양의 가짜(샘플) 데이터 생성기.
 *
 * BPM DB 가 아직 안 들어왔으므로, MM_INFRINGER_BASIC + 일별 이력과 동일한
 * 컬럼 구조의 연습용 데이터를 만든다. 다음 주 실제 DB 가 오면 targets-sync.js
 * 에서 이 모듈을 BPM SQL 조회로 교체하면 끝 — 엔진/화면은 그대로.
 *
 * 의존성 0. 시드 기반 PRNG 라 재실행해도 거의 동일한 데이터 → 클러스터 키 안정.
 */

const BRANDS = ['APPLE', 'MONCLER', 'GOLDEN GOOSE', 'FILA', 'TORY BURCH']
const PLATFORMS = ['스마트스토어', '쿠팡', '11번가', 'G마켓', '옥션', '인스타그램']
const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임']
const GIVEN = ['민준', '서연', '도윤', '지우', '하준', '예준', '수아', '지호', '주원', '시우']
const WORDS = ['스타일', '럭셔리', '명품', '글로벌', '프리미엄', '트렌드', '디럭스', '셀렉트', '부티크', '갤러리']

// 시드 PRNG (mulberry32)
function rng(seed) {
  let a = seed >>> 0
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function ymd(date) { return date.toISOString().slice(0, 10) }

/**
 * @param {Object} opts  refDate(기준일), count(운영자 수)
 * @returns {{ rows: Array, dayHist: Object }}
 */
export function generateMockBpm(opts = {}) {
  const ref = opts.refDate ? new Date(opts.refDate) : new Date()
  const N = opts.count || 60
  const rand = rng(20260617)
  const pick = (arr) => arr[Math.floor(rand() * arr.length)]
  const ri = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))

  const rows = []
  const dayHist = {}
  let vseq = 100000

  const newVendor = () => 'V' + (++vseq)
  const bizNo = () => `${ri(100, 999)}${ri(10, 99)}${ri(10000, 99999)}`
  const phone = () => `010${ri(1000, 9999)}${ri(1000, 9999)}`
  const president = () => pick(SURNAMES) + pick(GIVEN)
  const storeName = () => pick(WORDS) + pick(['샵', '스토어', '몰', '하우스', '마켓', ''])
  const clientId = (brand) => 'C-' + brand.replace(/\s/g, '').slice(0, 6)

  // 일별 이력 생성 (추세 패턴: surge/steady/decline)
  function genDayHist(vendorId, pattern, lastDate) {
    const series = []
    for (let d = 90; d >= 0; d--) {
      const day = new Date(lastDate); day.setDate(day.getDate() - d)
      if (day > ref) continue
      let base
      if (pattern === 'surge') base = d < 30 ? ri(1, 6) : d < 60 ? ri(0, 2) : 0
      else if (pattern === 'decline') base = d < 30 ? ri(0, 1) : d < 60 ? ri(1, 4) : ri(2, 6)
      else base = ri(0, 3)
      if (base > 0) series.push({ basic_ymd: ymd(day), removal_count: base, monitor_count: base + ri(0, 2), report_count: base, case_count: rand() < 0.1 ? 1 : 0 })
    }
    dayHist[vendorId] = series
  }

  function makeRow(brand, identity, extra = {}) {
    const vendorId = newVendor()
    const platform = pick(PLATFORMS)
    const lastOffset = extra.lastOffset != null ? extra.lastOffset : ri(0, 200)
    const lastDate = new Date(ref); lastDate.setDate(lastDate.getDate() - lastOffset)
    const firstDate = new Date(lastDate); firstDate.setDate(firstDate.getDate() - ri(30, 800))
    const cum = extra.cumulative != null ? extra.cumulative : ri(1, 25)
    const pattern = extra.pattern || pick(['surge', 'steady', 'decline'])
    genDayHist(vendorId, pattern, lastDate)
    return {
      repr_client_id: clientId(brand), client_id: clientId(brand),
      platform_id: platform, vendor_id: vendorId,
      store_url: `https://example.com/${vendorId}`,
      store_name: extra.store || storeName(),
      biz_reg_no: identity.biz, company_name: extra.company || (identity.president ? identity.president + ' 무역' : ''),
      president_name: identity.president, seller_account: vendorId,
      seller_name: identity.president, seller_phone_no: identity.phone, seller_email: identity.email, seller_addr: '',
      trans_biz_reg_no: identity.biz, trans_seller_phone_no: identity.phone,
      trans_store_name: extra.store || '', trans_company_name: extra.company || '', trans_president_name: identity.president || '',
      repeat_infringe_yn: cum > 3 ? 'Y' : 'N', infringer_yn: 'Y', total_infringe_count: cum,
      deleted: cum * ri(3, 30),   // 삭제 게시물 수 (재적발 1회당 다수 게시물) — 규모 신호
      deleted_by_client: cum * ri(2, 12),
      online_associated_infringer_count: ri(0, 8), online_potential_infringer_count: ri(0, 20),
      customs_associated_infringer_count: extra.customs || 0, customs_potential_infringer_count: 0,
      enforce_associated_infringer_count: extra.raid || 0, enforce_potential_infringer_count: 0,
      legal_associated_infringer_count: extra.legal || 0, legal_potential_infringer_count: 0,
      customs_case_id: extra.customs ? 'CUS-' + ri(1000, 9999) : null, case_reg_ymd: extra.customs ? ymd(firstDate) : null,
      enforce_case_id: extra.raid ? 'ENF-' + ri(1000, 9999) : null, enforce_req_ymd: extra.raid ? ymd(firstDate) : null,
      target_case_id: extra.legal ? 'LEG-' + ri(1000, 9999) : null, target_reg_ymd: extra.legal ? ymd(firstDate) : null,
      target_approval_ymd: extra.legalApproved ? ymd(lastDate) : null,
      first_date: ymd(firstDate), last_date: ymd(lastDate),
      crt_dt: new Date().toISOString(), mod_dt: new Date().toISOString(),
    }
  }

  // 0) 즉시 법적 타겟 (신원 확실 + 오프라인 증거 + 최근 활동 잠잠) — A
  //    enf 高(누적·기간·증거) / yield 低(오래된 최종활동) → A 등급으로 떨어짐.
  for (let i = 0; i < 5; i++) {
    const id = { biz: bizNo(), phone: phone(), president: president(), email: `target${i}@corp.com` }
    const company = id.president + ' 상사'
    const accounts = ri(1, 2)
    for (let a = 0; a < accounts; a++) {
      makeAndPush(makeRow(pick(BRANDS), id, {
        company, cumulative: ri(12, 20), pattern: 'decline',
        customs: ri(1, 2), legal: i < 2 ? ri(1, 2) : 0, raid: i === 2 ? 1 : 0,
        legalApproved: i === 0,
        lastOffset: ri(210, 330),   // 최근 7~11개월 활동 없음 → 생산성 낮음
      }))
    }
  }

  // 1) 교차 브랜드 악질 (같은 신원이 여러 브랜드 침해) — A/B 후보
  for (let i = 0; i < 5; i++) {
    const id = { biz: bizNo(), phone: phone(), president: president(), email: `boss${i}@trade.com` }
    const nBrands = ri(2, 3)
    const company = id.president + ' 인터내셔널'
    for (let b = 0; b < nBrands; b++) {
      makeAndPush(makeRow(BRANDS[b], id, {
        company, cumulative: ri(8, 22), pattern: i < 3 ? 'surge' : 'decline',
        customs: i < 2 ? ri(1, 3) : 0, legal: i === 0 ? 2 : 0, legalApproved: i === 0,
        lastOffset: ri(0, 40),
      }))
    }
  }

  // 2) 단일 브랜드 다계정 악질 (한 운영자가 같은 브랜드 여러 계정) — A/B
  for (let i = 0; i < 8; i++) {
    const id = { biz: bizNo(), phone: phone(), president: president(), email: `seller${i}@mail.com` }
    const brand = pick(BRANDS); const company = storeName() + ' 코리아'
    const accounts = ri(2, 4)
    for (let a = 0; a < accounts; a++) {
      makeAndPush(makeRow(brand, id, {
        company, cumulative: ri(5, 18), pattern: pick(['surge', 'steady']),
        raid: a === 0 && i < 3 ? ri(1, 2) : 0, lastOffset: ri(0, 60),
      }))
    }
  }

  // 3) 신원 불명 다량 공급 (사업자/전화 없음, 삭제 건수 많음) — C
  for (let i = 0; i < 18; i++) {
    const id = { biz: null, phone: null, president: '', email: rand() < 0.3 ? `anon${i}@gmail.com` : null }
    makeAndPush(makeRow(pick(BRANDS), id, {
      cumulative: ri(3, 14), pattern: pick(['surge', 'steady', 'steady']), lastOffset: ri(0, 30),
    }))
  }

  // 4) 후순위 (약한 활동) — D
  for (let i = 0; i < 14; i++) {
    const hasId = rand() < 0.5
    const id = { biz: hasId ? bizNo() : null, phone: hasId ? phone() : null, president: hasId ? president() : '', email: null }
    makeAndPush(makeRow(pick(BRANDS), id, {
      cumulative: ri(1, 3), pattern: 'decline', lastOffset: ri(120, 300),
    }))
  }

  // 5) 대형유통/샵인샵 — X (점수 높아도 제외)
  const bigSellers = ['SSG.COM', '신세계몰', '커머스허브', '롯데ON', '하프클럽']
  for (const name of bigSellers) {
    const id = { biz: bizNo(), phone: phone(), president: president(), email: null }
    makeAndPush(makeRow(pick(BRANDS), id, {
      store: name, company: name, cumulative: ri(10, 30), pattern: 'steady', lastOffset: ri(0, 20),
    }))
  }

  function makeAndPush(row) { rows.push(row) }

  return { rows, dayHist }
}
