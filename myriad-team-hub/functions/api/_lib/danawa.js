/**
 * 다나와 최저가 모니터링 — 페이지 파서 + 판매자 조회 (순수 함수 + fetch).
 *
 * 흐름:
 *   1. 다나와 상품 페이지 (https://prod.danawa.com/info/?pcode=N) 를 받아 판매처 줄(MallItemRow) 파싱
 *   2. 최저가(상품가 기준, 배송비·카드할인 제외 = 다나와 화면 기준)와 같은 줄을 전부 고름
 *   3. 각 줄의 쇼핑몰 상품 페이지에서 판매자 정보(매장명·상호·대표자·사업장 소재지) 조회
 *      - G마켓 / 옥션 / 11번가 = 상품 페이지 직접 조회
 *      - 네이버 스마트스토어 = 다나와 줄에 판매자명이 이미 표시됨 (네이버는 서버 조회 차단)
 *      - 그 외 쇼핑몰 = 다나와 연결 페이지에서 실제 상품 주소만 확인, 판매자명은 쇼핑몰명
 *
 * 다나와는 2026 개편 후 서버 렌더링(Next.js) — 판매처 목록이 HTML 에 그대로 들어 있음 (브라우저 불필요).
 */

import { pickSellerHandler, sellerStatusOf } from './danawaSellers.js'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

const HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
}

// 다나와 쇼핑몰 코드(cmpnyc) → 판매자 조회 방식
const MALL_BY_CODE = {
  EE128: 'gmarket',
  EE715: 'auction',
  TH201: '11st'
}

export function danawaUrl(pcode) {
  return `https://prod.danawa.com/info/?pcode=${pcode}`
}

/** 다나와 주소(또는 숫자)에서 pcode 추출 */
export function extractPcode(input) {
  const s = String(input || '').trim()
  if (/^\d{4,12}$/.test(s)) return s
  const m = s.match(/[?&]pcode=(\d{4,12})/)
  return m ? m[1] : null
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
}

function cleanText(s) {
  return decodeEntities(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function toNumber(s) {
  const n = parseInt(String(s || '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) ? n : null
}

/**
 * 다나와 상품 페이지 HTML → { name, imageUrl, headerLowest, rows[] }
 * rows: { key, mallCode, mallName, isMarketSeller, danawaSeller, price, shipping, title, bridgeUrl, linkPcode }
 */
export function parseDanawaPage(html) {
  const name = cleanText((html.match(/<title>([^<]*)<\/title>/) || [])[1] || '')
    .replace(/\s*:\s*다나와 가격비교\s*$/, '')
  const imageUrl = decodeEntities(
    (html.match(/<meta property="og:image" content="([^"]+)"/) || [])[1] ||
    (html.match(/data-testid="ProductImageGallery-main"[\s\S]{0,1500}?src="([^"]+)"/) || [])[1] || ''
  ) || null

  const lowM = html.match(/data-testid="ProductPriceInfo-lowest-price"[^>]*>\s*<span[^>]*>([\d,]+)</)
  const headerLowest = lowM ? toNumber(lowM[1]) : null

  const seen = new Set()
  const rows = []
  const parts = html.split('data-testid="MallItemRow"')
  for (let i = 1; i < parts.length; i++) {
    const r = parts[i].slice(0, 9000)
    const bridgeUrl = decodeEntities(
      (r.match(/href="(https:\/\/prod\.danawa\.com\/bridge\/loadingBridge\.html[^"]*)"/) || [])[1] || ''
    )
    if (!bridgeUrl) continue
    const mallCode = (bridgeUrl.match(/[?&]cmpnyc=([^&]+)/) || [])[1] || ''
    const linkPcode = (bridgeUrl.match(/[?&]link_pcode=([^&]+)/) || [])[1] || ''
    const key = `${mallCode}:${linkPcode}`
    if (seen.has(key)) continue
    seen.add(key)

    // 왼쪽 쇼핑몰 칸 = 첫 번째 <a>…</a> (로고 img alt 또는 판매자명 span)
    const firstA = (r.match(/<a [^>]*loadingBridge[^>]*>([\s\S]*?)<\/a>/) || [])[1] || ''
    const logoAlt = (firstA.match(/<img[^>]*alt="([^"]+)"/) || [])[1]
    const sellerSpan = logoAlt ? null : cleanText(firstA)

    const price = toNumber((r.match(/<em[^>]*>([\d,]+)<\/em>/) || [])[1])
    const shipping = ((r.match(/\((무료배송|배송비[^)]*)\)/) || [])[1] || '').trim() || null
    const title = cleanText((r.match(/line-clamp-2[^>]*>([\s\S]*?)<\/a>/) || [])[1] || '')

    rows.push({
      key,
      mallCode,
      mallName: logoAlt ? decodeEntities(logoAlt) : '네이버 스마트스토어',
      isMarketSeller: !logoAlt,              // 로고 대신 판매자명이 나오는 줄 = 네이버 쇼핑 입점 판매자
      danawaSeller: sellerSpan || null,
      price,
      shipping,
      title,
      bridgeUrl: bridgeUrl.replace(/&r=\d+/, ''),
      linkPcode
    })
  }
  if (!rows.length) return parseLegacyPage(html, name)
  return { name, imageUrl, headerLowest, rows, layout: 'new' }
}

/**
 * 구버전(jQuery) 다나와 페이지 — 다나와가 신/구 디자인을 섞어서 내보냄.
 * 전체 목록은 별도 ajax 라 서버에서 못 받음 → 상단 '쇼핑몰별 최저가' 목록(최대 10곳)만 읽음.
 */
export function parseLegacyPage(html, name) {
  const imageUrl = decodeEntities((html.match(/id="baseImage"[^>]*src="([^"]+)"/) ||
    html.match(/<img src="([^"]+)"[^>]*id="baseImage"/) || [])[1] || '') || null
  const headerLowest = toNumber((html.match(/id="min_price_\d+" value="(\d+)"/) || [])[1])

  const rows = []
  const seen = new Set()
  const start = html.indexOf('class="list__mall-price"')
  if (start >= 0) {
    const block = html.slice(start, html.indexOf('</ul>', start))
    for (const li of block.split('<li class="list-item">').slice(1)) {
      const bridgeUrl = decodeEntities(
        (li.match(/href="(https:\/\/prod\.danawa\.com\/bridge\/loadingBridge\.html[^"]*)"/) || [])[1] || ''
      )
      if (!bridgeUrl) continue
      const mallCode = (bridgeUrl.match(/[?&]cmpnyc=([^&]+)/) || [])[1] || ''
      const linkPcode = (bridgeUrl.match(/[?&]link_pcode=([^&]+)/) || [])[1] || ''
      const key = `${mallCode}:${linkPcode}`
      if (seen.has(key)) continue
      seen.add(key)
      const logoAlt = (li.match(/box__logo[\s\S]*?<img[^>]*alt='([^']+)'/) || li.match(/box__logo[\s\S]*?<img[^>]*alt="([^"]+)"/) || [])[1]
      const logoText = logoAlt ? null : cleanText((li.match(/class="text__logo"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '')
      const price = toNumber((li.match(/data-base-price="(\d+)"/) || li.match(/class="text__num">([\d,]+)</) || [])[1])
      const shipRaw = cleanText((li.match(/class="box__delivery">([\s\S]*?)<\/div>\s*<div class="box__installment"/) || [])[1] || '')
      const shipNum = (shipRaw.match(/([\d,]+원|무료배송)\s*$/) || [])[1]
      rows.push({
        key,
        mallCode,
        mallName: logoAlt ? decodeEntities(logoAlt) : '네이버 스마트스토어',
        isMarketSeller: !logoAlt,
        danawaSeller: logoText || null,
        price,
        shipping: shipNum ? (shipNum === '무료배송' ? '무료배송' : `배송비 ${shipNum}`) : null,
        title: '',
        bridgeUrl: bridgeUrl.replace(/&r=\d+/, ''),
        linkPcode
      })
    }
  }
  return { name, imageUrl, headerLowest, rows, layout: 'legacy' }
}

/** 최저가와 같은 줄 전부 (동일 최저가 포함) */
export function pickLowest(rows) {
  const priced = rows.filter((r) => r.price && r.price > 0)
  if (!priced.length) return { lowestPrice: null, lowest: [] }
  const lowestPrice = Math.min(...priced.map((r) => r.price))
  return { lowestPrice, lowest: priced.filter((r) => r.price === lowestPrice) }
}

// ── 판매자 조회 ───────────────────────────────────────────────

function mallProductUrl(row) {
  const kind = MALL_BY_CODE[row.mallCode]
  if (kind === 'gmarket') return `https://item.gmarket.co.kr/Item?goodscode=${row.linkPcode}`
  if (kind === 'auction') return `https://itempage3.auction.co.kr/DetailView.aspx?itemno=${row.linkPcode}`
  if (kind === '11st') return `https://www.11st.co.kr/products/${row.linkPcode}`
  return null
}

/** "상호명 : |차니몰||" 형태 (G마켓·옥션 판매자 정보 영역) */
function pickLabeled(text, label) {
  const re = new RegExp(label + '\\s*[:：]?\\s*\\|*\\s*([^|]{1,80})')
  const m = text.match(re)
  return m ? m[1].trim() : null
}

export function parseGmarketAuctionSeller(html) {
  const sellerA = html.match(/class="text__seller"[\s\S]{0,200}?<a href="([^"]+)"[^>]*>([^<]+)<\/a>/)
  const storeUrl = sellerA ? decodeEntities(sellerA[1]).replace(/^http:/, 'https:') : null
  const sellerName = sellerA ? cleanText(sellerA[2]) : null
  // minishop.gmarket.co.kr/{id} · www.gmarket.co.kr/n/{id} · stores.auction.co.kr/{id} → 마지막 경로 조각
  const sellerId = storeUrl
    ? (storeUrl.replace(/[?#].*$/, '').replace(/\/+$/, '').match(/\/([^/]+)$/) || [])[1] || null
    : null

  // 판매자 정보 박스 (상호명 ~ 사업장소재지)
  const idx = html.indexOf('상호명')
  const box = idx >= 0
    ? decodeEntities(html.slice(idx, idx + 2500).replace(/<[^>]+>/g, '|')).replace(/[ \t\r\n]+/g, ' ')
    : ''
  return {
    sellerName,
    sellerId,
    storeUrl,
    company: box ? pickLabeled(box, '상호명') : null,
    ceo: box ? pickLabeled(box, '대표자') : null,
    bizNo: box ? pickLabeled(box, '사업자등록번호') : null,
    address: box ? pickLabeled(box, '사업장소재지') : null
  }
}

export function parse11stSeller(html) {
  const a = html.match(/class="c_product_store_title"[\s\S]{0,300}?<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
  const storeUrl = a ? decodeEntities(a[1]).replace(/\?.*$/, '') : null
  const sellerName = a ? cleanText(a[2]) : null
  const sellerId = storeUrl ? (storeUrl.match(/stores\/(\d+)/) || [])[1] || null : null

  // 판매자 정보 표: <th>상호명</th><td>(주)티알엔</td>
  const pick = (label) => {
    const m = html.match(new RegExp('>\\s*' + label + '\\s*</[^>]+>\\s*<[^>]+>\\s*([^<]{1,80})<'))
    return m ? cleanText(m[1]) : null
  }
  return {
    sellerName,
    sellerId,
    storeUrl,
    company: pick('상호명'),
    ceo: pick('대표자'),
    bizNo: pick('사업자번호') || pick('사업자등록번호'),
    address: pick('사업장소재지') || pick('사업장 소재지')
  }
}

const OVERSEAS_RE = /중국|china|홍콩|hong\s?kong|대만|taiwan|广东|廣東|深圳|上海|北京|浙江|福建|江苏|义乌|義烏|省|市\s*\S*区/i

export function isOverseas(address) {
  if (!address) return false
  return OVERSEAS_RE.test(address)
}

async function fetchText(url, extraHeaders = {}) {
  // 응답 없는 쇼핑몰(예: Cloudflare 서버에서의 11번가)에 오래 묶이지 않게 10초 제한
  const res = await fetch(url, { headers: { ...HEADERS, ...extraHeaders }, redirect: 'follow', signal: AbortSignal.timeout(10000) })
  const text = await res.text()
  return { status: res.status, url: res.url, text }
}

/** 다나와 연결(bridge) 페이지 → 실제 쇼핑몰 주소 */
export async function resolveBridge(bridgeUrl) {
  try {
    const { text } = await fetchText(bridgeUrl, { Referer: 'https://prod.danawa.com/' })
    return decodeEntities((text.match(/goLink\(["']([^"']+)["']\)/) || [])[1] || '') || null
  } catch {
    return null
  }
}

/** 쇼핑몰이 서버 조회를 막거나 응답하지 않은 경우 (구조 변경으로 인한 실패와 구분) */
function isBlockedError(e) {
  if (e?.blocked) return true
  const m = String(e?.message || e || '')
  return /blocked|차단|WAF|NetFunnel|firewall|did not render|abort|timeout|timed out|HTTP (4\d\d|5\d\d)|응답 (4\d\d|5\d\d)/i.test(m)
}

/** 줄 하나 조회에 최대 15초 */
function withTimeout(promise, ms, row) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve({
      ...row, productUrl: row.bridgeUrl, seller: { sellerName: row.danawaSeller || row.mallName },
      sellerStatus: 'blocked', sellerError: `판매자 조회 ${ms / 1000}초 초과`
    }), ms))
  ])
}

function cleanSeller(s) {
  const out = {}
  for (const k of ['sellerName', 'sellerId', 'company', 'ceo', 'bizNo', 'address', 'storeUrl', 'phone', 'sellerType', 'note']) {
    const v = s?.[k]
    if (v != null && String(v).trim() !== '') out[k] = String(v).trim().slice(0, 200)
  }
  out.overseas = s?.overseas === true || isOverseas(out.address)
  return out
}

/**
 * 최저가 줄 하나 → 판매자 정보가 붙은 결과
 * sellerStatus:
 *   ok        = 쇼핑몰에서 판매자 정보 확인
 *   mall_self = 쇼핑몰(홈쇼핑·브랜드몰·자사몰 등) 자체가 판매자
 *   danawa    = 다나와에 표시된 판매자명만 (네이버 스마트스토어 — 네이버가 서버 조회 차단)
 *   blocked   = 쇼핑몰이 서버 조회를 막음 → 판매자 상세는 상품 페이지에서 확인
 *   error     = 조회 시도했지만 실패 (구조 변경 가능)
 *   mall_only = 판매자 조회 방법 없음
 */
export async function enrichListing(row) {
  const base = { ...row, productUrl: null, seller: null, sellerStatus: 'mall_only' }

  const direct = mallProductUrl(row)
  if (!direct) {
    // G마켓·옥션·11번가 외 — 다나와 연결 페이지에서 실제 상품 주소를 먼저 확보
    const goUrl = await resolveBridge(row.bridgeUrl)
    const productUrl = goUrl || row.bridgeUrl
    const plan = pickSellerHandler(row, goUrl)

    if (plan.kind === 'handler' && goUrl) {
      try {
        const s = await plan.fn(goUrl)
        const seller = cleanSeller(s)
        if (!seller.sellerName) seller.sellerName = row.danawaSeller || row.mallName
        const status = sellerStatusOf(row.mallCode, s)
        return { ...base, productUrl: s?.productUrl || productUrl, seller, sellerStatus: status, sellerVia: plan.key }
      } catch (e) {
        // 네이버처럼 다나와 표시명이 있으면 그거라도 남김
        const blocked = isBlockedError(e)
        return {
          ...base,
          productUrl,
          seller: { sellerName: row.danawaSeller || (blocked ? row.mallName : null) },
          sellerStatus: row.danawaSeller ? 'danawa' : blocked ? 'blocked' : 'error',
          sellerError: String(e.message || e).slice(0, 200),
          sellerVia: plan.key
        }
      }
    }
    if (plan.kind === 'blocked' || row.isMarketSeller) {
      return {
        ...base,
        productUrl,
        seller: { sellerName: row.danawaSeller || row.mallName },
        sellerStatus: row.danawaSeller ? 'danawa' : 'blocked',
        sellerVia: plan.key || null
      }
    }
    return { ...base, productUrl, seller: { sellerName: row.mallName }, sellerStatus: 'mall_only' }
  }

  if (row.isMarketSeller) {
    return { ...base, productUrl: row.bridgeUrl, seller: { sellerName: row.danawaSeller }, sellerStatus: 'danawa' }
  }
  if (direct) {
    try {
      const { status, text } = await fetchText(direct)
      if (status >= 400) throw new Error(`쇼핑몰 응답 ${status}`)
      const kind = MALL_BY_CODE[row.mallCode]
      const seller = kind === '11st' ? parse11stSeller(text) : parseGmarketAuctionSeller(text)
      if (!seller.sellerName) throw new Error('판매자명을 찾지 못함 (페이지 구조 변경 가능)')
      seller.overseas = isOverseas(seller.address)
      return { ...base, productUrl: direct, seller, sellerStatus: 'ok' }
    } catch (e) {
      return { ...base, productUrl: direct, seller: { sellerName: isBlockedError(e) ? row.mallName : null }, sellerStatus: isBlockedError(e) ? 'blocked' : 'error', sellerError: String(e.message || e) }
    }
  }
  return base
}

/** 다나와 상품 1개 전체 확인 */
export async function checkDanawaProduct(pcode, { previousListings = [] } = {}) {
  // 신버전(전체 목록) 페이지를 우선 — 구버전이 오면 최대 2번 더 시도, 끝까지 구버전이면 구버전 목록 사용
  let page = null
  let lastStatus = 0
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 1200))
    const { status, text } = await fetchText(danawaUrl(pcode), { Referer: 'https://www.danawa.com/' })
    lastStatus = status
    if (status >= 400) continue
    const parsed = parseDanawaPage(text)
    if (parsed.rows.length && (!page || parsed.layout === 'new')) page = parsed
    if (page?.layout === 'new') break
  }
  if (!page) {
    throw new Error(lastStatus >= 400
      ? `다나와 응답 ${lastStatus}`
      : '다나와 판매처 목록을 찾지 못함 (차단 또는 페이지 구조 변경)')
  }
  const { lowestPrice, lowest } = pickLowest(page.rows)

  // 직전 확인에서 이미 판매자 정보를 받아 둔 줄은 재사용 (쇼핑몰 요청 절약)
  const prevByKey = new Map(previousListings.map((l) => [l.key, l]))
  const listings = []
  // 쇼핑몰 조회는 줄당 최대 4회 → 8줄까지 (Cloudflare 무료: 요청 1건당 외부 접속 50회 한도)
  // 상품 1개 확인은 40초 안에 끝냄 (예약 호출 대기 60초) — 남은 줄은 다음 확인 때 조회
  const started = Date.now()
  for (const row of lowest.slice(0, 8)) {
    const prev = prevByKey.get(row.key)
    if (Date.now() - started > 40000) {
      listings.push({ ...row, productUrl: row.bridgeUrl, seller: { sellerName: row.danawaSeller || row.mallName }, sellerStatus: 'mall_only', sellerError: '시간 부족 — 다음 확인 때 조회' })
      continue
    }
    if (prev && ['ok', 'mall_self', 'undisclosed'].includes(prev.sellerStatus) && prev.seller?.sellerName) {
      listings.push({ ...row, productUrl: prev.productUrl, seller: prev.seller, sellerStatus: prev.sellerStatus, sellerVia: prev.sellerVia })
    } else {
      listings.push(await withTimeout(enrichListing(row), 15000, row))
    }
  }
  return {
    name: page.name,
    imageUrl: page.imageUrl,
    headerLowest: page.headerLowest,
    rowCount: page.rows.length,
    layout: page.layout,
    lowestPrice,
    listings
  }
}
