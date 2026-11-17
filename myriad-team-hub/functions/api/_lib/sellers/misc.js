/**
 * Danawa 최저가 판매자 조회 — group 4 (기타몰 + 자사몰 + 차단몰)
 *
 * 모든 핸들러: (goUrl = 다나와 연결 페이지의 goLink 실제 상품 주소) → Promise<SellerInfo>
 *   SellerInfo = { sellerName, company, ceo, bizNo, address, storeUrl, overseas, productUrl, source, note }
 *   (모르는 값은 null, note 는 사람이 읽는 보조 설명 — 선택)
 * 의존성: 전역 fetch / TextDecoder 만 사용 (Cloudflare Worker 호환), 상품당 최대 3요청.
 *
 * 차단 몰 (TN118 SSG.COM / EE311 이마트몰 / ED901 신세계몰 / 네이버 스마트스토어 / 쿠팡)은
 * 서버 조회 경로를 찾지 못해 handlers 에 넣지 않음 → BLOCKED 에 사유 기록.
 */

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'

const BASE_HEADERS = {
  'User-Agent': UA,
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.8'
}

const TIMEOUT_MS = 15000

// ───────────────────────── 공통 유틸 ─────────────────────────

function blank(productUrl, source) {
  return {
    sellerName: null, company: null, ceo: null, bizNo: null, address: null,
    storeUrl: null, overseas: null, productUrl: productUrl || null, source, note: null
  }
}

/** fetch + 문자셋 판별(헤더 우선, 없으면 meta) → { status, url, text } */
async function fetchText(url, { method = 'GET', headers = {}, body } = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...BASE_HEADERS, ...headers },
    body,
    redirect: 'follow',
    signal: AbortSignal.timeout(TIMEOUT_MS)
  })
  const buf = await res.arrayBuffer()
  const ct = res.headers.get('content-type') || ''
  let enc = (ct.match(/charset=([\w-]+)/i) || [])[1]
  let text
  if (!enc) {
    const head = new TextDecoder('utf-8').decode(buf.slice(0, 4096))
    enc = (head.match(/<meta[^>]+charset=["']?([\w-]+)/i) || [])[1] || 'utf-8'
  }
  enc = enc.toLowerCase()
  if (enc === 'ks_c_5601-1987' || enc === 'cp949' || enc === 'x-windows-949') enc = 'euc-kr'
  try { text = new TextDecoder(enc).decode(buf) } catch { text = new TextDecoder('utf-8').decode(buf) }
  return { status: res.status, url: res.url, text, contentType: ct }
}

async function fetchJson(url, headers = {}) {
  const r = await fetchText(url, { headers: { Accept: 'application/json, text/plain, */*', ...headers } })
  if (r.status !== 200) throw new Error(`HTTP ${r.status} ${url}`)
  try { return JSON.parse(r.text) } catch { throw new Error(`JSON 아님 (${url}): ${r.text.slice(0, 80)}`) }
}

function assertOk(r, label) {
  if (r.status === 403 || r.status === 429) throw new Error(`${label}: 차단됨 HTTP ${r.status}`)
  if (r.status >= 400) throw new Error(`${label}: HTTP ${r.status}`)
}

export function decodeEntities(s) {
  return String(s ?? '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
}

/** HTML → 줄 단위 텍스트 (블록 요소 = 줄바꿈) */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|dd|dt|tr|td|th|span|h\d|address|ul|dl|table|section|footer)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  )
    .replace(/[ \t\r\f\v ]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim()
}

const clean = (s) => {
  const v = decodeEntities(String(s ?? '')).replace(/\s+/g, ' ').trim()
  return v || null
}

export function formatBizNo(s) {
  const d = String(s ?? '').replace(/\D/g, '')
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : null
}

const KR_PROVINCE = /(서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충북|충남|충청|전북|전남|전라|경북|경남|경상|제주)/

function looksOverseasAddress(addr) {
  if (!addr) return null
  if (KR_PROVINCE.test(addr)) return false
  if (/[A-Za-z]{3,}/.test(addr) && /(USA|U\.S\.A|United States|China|中国|Hong ?Kong|Japan|日本|\b[A-Z]{2}\s*\d{5}\b|Province|City|Street|St\.|Ave|Road|Rd\.)/i.test(addr)) return true
  if (/[一-鿿぀-ヿ]/.test(addr)) return true
  return null
}

// ───────────────────── 범용 자사몰 푸터 파서 ─────────────────────

// 값 뒤에 붙어 오는 다음 라벨에서 자르기
const NEXT_LABEL = /\s*(?:\[|\(|)?\s*(?:대표\s*(?:이사|자)?(?:\s*\(?성명\)?)?\s*[:：]|주\s*소\s*[:：]|사업장\s*(?:소재지|주소)|소재지\s*[:：]|사업자|통신판매|전화|TEL\b|Tel\b|팩스|FAX|Fax|이메일|E-?mail|EMAIL|메일\s*[:：]|개인정보|호스팅|고객\s*센터|상호\s*(?:명)?\s*[:：]|법인명|Copyright|COPYRIGHT|ⓒ|©|문의\s*[:：]|계좌|입금|Business|CEO|Address)/
function cutAtLabel(v) {
  if (!v) return null
  const s = String(v).replace(/^[\s:：]+/, '')
  if (s.search(NEXT_LABEL) === 0) return null
  if (/^(대표(자|이사)?|주\s*소|사업장|소재지|사업자|전화|상호|고객\s*센터)(\s|$|[:：(])/.test(s)) return null
  const m = s.slice(1).search(NEXT_LABEL)
  const out = (m >= 0 ? s.slice(0, m + 1) : s).replace(/[\s|ㅣ/,·:：\-]+$/, '').trim()
  return out || null
}

const CORP_STOP = '(?!대표|주소|사업자|전화|통신|고객|Tel|TEL|대표이사)'
const CORP_RES = [
  // 접두형: 주식회사 OOO / ㈜OOO / (주) OOO
  new RegExp('((?:주식회사|유한회사|유한책임회사|합자회사|\\(주\\)|㈜|\\(유\\))[ ]*' + CORP_STOP + '[가-힣A-Za-z0-9&.\\-]+)', 'g'),
  // 접미형: OOO 주식회사 / OOO㈜ / OOO(주)
  /([가-힣A-Za-z0-9&.\-]+[ ]*(?:주식회사|유한회사|유한책임회사|\(주\)|㈜))/g,
  // 영문: Foo Bar Inc. / Co., Ltd.
  /([A-Z][A-Za-z0-9&.\-]*(?:[ ][A-Z][A-Za-z0-9&.\-]*){0,4},?[ ](?:Inc\.?|Co\.,?[ ]*Ltd\.?|Corp\.?|Corporation|LLC|Ltd\.?|Limited))/g
]

/**
 * 텍스트(또는 HTML)에서 사업자 표시 정보 추출.
 * @returns {{company, ceo, bizNo, address, overseas, foreignCeo}} 또는 null(사업자번호 못 찾음)
 */
export function parseBusinessFooter(htmlOrText, { isHtml = true } = {}) {
  const text = isHtml ? htmlToText(htmlOrText) : String(htmlOrText)

  // 1) 사업자등록번호 — 라벨 붙은 것 중 마지막(=푸터), 없으면 ###-##-##### 패턴 마지막
  const labeled = [...text.matchAll(/사업자\s*(?:등록)?\s*번호\s*[:：]?\s*\[?\s*(\d{3})\s*-?\s*(\d{2})\s*-?\s*(\d{5})/g)]
  let m = labeled[labeled.length - 1]
  if (!m) {
    const any = [...text.matchAll(/(?<!\d)(\d{3})-(\d{2})-(\d{5})(?!\d)/g)]
    m = any[any.length - 1]
  }
  if (!m) return null
  const bizNo = `${m[1]}-${m[2]}-${m[3]}`
  const at = m.index
  const winStart = Math.max(0, at - 900)
  const win = text.slice(winStart, at + 700)
  const rel = at - winStart

  // 가까운(사업자번호 기준) 매치 고르기
  const nearest = (re) => {
    let best = null
    for (const mm of win.matchAll(re)) {
      const d = Math.abs(mm.index - rel)
      if (!best || d < best.d) best = { d, m: mm }
    }
    return best ? best.m : null
  }

  // 2) 대표자
  let ceo = null
  const ceoM = nearest(/대표\s*(?:이사|자)?(?:\s*\(?\s*성명\s*\)?|\s*명)?(?!\s*(?:번호|전화|메일|이메일|팩스|상품|브랜드|문의|홈|사이트|이미지|컬러|색상))\s*[:：]?\s*([가-힣A-Za-z][^\n|ㅣ]{0,60})/g)
  if (ceoM) {
    ceo = cutAtLabel(ceoM[1])
    if (ceo && (/\d{2,}/.test(ceo) || ceo.length > 40)) ceo = null
  }

  // 3) 상호
  let company = null
  const coM = nearest(/(?:상\s*호\s*명?|법인\s*명\s*(?:\(\s*상호\s*\))?|회사\s*명|업체\s*명|사업자\s*명|판매자\s*상호)\s*[:：]?\s*([^\n|ㅣ]{2,60})/g)
  if (coM) company = cutAtLabel(coM[1])
  if (!company) {
    // 법인 형태 토큰(주식회사/㈜/유한회사/Inc.) — 사업자번호 앞쪽에서 가장 가까운 것
    let best = null
    for (const re of CORP_RES) {
      for (const mm of win.matchAll(re)) {
        if (/호스팅|제공|예금주|계좌/.test(win.slice(Math.max(0, mm.index - 14), mm.index))) continue
        const end = mm.index + mm[1].length
        const d = end <= rel ? rel - end : (mm.index - rel) + 300 // 앞쪽(가까운 것) 우선
        if (!best || d < best.d) best = { d, v: mm[1] }
      }
    }
    if (best) company = cutAtLabel(best.v)
  }
  if (!company) {
    const cr = text.match(/(?:Copyright|COPYRIGHT|ⓒ|©)\s*(?:\(c\)|ⓒ|©)?\s*(?:\d{4}\s*)?(?:by\s*)?([^\n.]{2,40}?)\s*(?:\.|All|ALL|all|$)/m)
    if (cr) company = cutAtLabel(cr[1])
  }

  // 4) 주소
  let address = null
  const adM = nearest(/(?:사업장\s*소재지|사업장\s*주소|본사\s*주소|영업\s*소재지|소재지|주\s*소|Address|ADDRESS)\s*[:：]?\s*([^\n|ㅣ]{6,160})/g)
  if (adM) address = cutAtLabel(adM[1])
  if (!address || address.length < 6) {
    const am = nearest(/((?:\(?\d{5}\)?\s*)?(?:서울|부산|대구|인천|광주|대전|울산|세종|경기|강원|충청|충북|충남|전라|전북|전남|경상|경북|경남|제주)[가-힣]*\s+[^\n|ㅣ]{4,100})/g)
    if (am) address = cutAtLabel(am[1])
  }
  if (address) address = address.replace(/\s*\[?\s*사업자.*$/, '').trim() || null

  const foreignCeo = !!ceo && /^[A-Z][A-Z .,\-]+$/i.test(ceo) && !/[가-힣]/.test(ceo)
  return {
    company: clean(company), ceo: clean(ceo), bizNo, address: clean(address),
    overseas: looksOverseasAddress(address), foreignCeo
  }
}

function siteName(html) {
  return clean(
    (html.match(/<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)/i) || [])[1] ||
    (html.match(/<title>([^<]{1,60})<\/title>/i) || [])[1]
  )
}

/**
 * 자사몰(독립몰) 범용: 상품 페이지 푸터 → 없으면 같은 도메인 메인('/') 푸터. 최대 2요청.
 */
export async function genericMallSeller(goUrl) {
  const out = blank(goUrl, 'generic:footer')
  const r = await fetchText(goUrl)
  assertOk(r, 'generic')
  out.productUrl = r.url
  let f = parseBusinessFooter(r.text)
  let html = r.text
  if (!f) {
    const home = new URL('/', r.url).href
    const h = await fetchText(home)
    assertOk(h, 'generic(home)')
    f = parseBusinessFooter(h.text)
    html = h.text
    out.source = 'generic:footer(home)'
  }
  if (!f) throw new Error('generic: 푸터에서 사업자등록번호를 찾지 못함')
  Object.assign(out, {
    company: f.company, ceo: f.ceo, bizNo: f.bizNo, address: f.address, overseas: f.overseas,
    sellerName: f.company || siteName(html), storeUrl: new URL('/', r.url).href
  })
  if (f.foreignCeo) out.note = '대표자 영문 표기(외국인 대표 추정)'
  return out
}

// ───────────────────────── 몰별 핸들러 ─────────────────────────

/** TFB03 YES24 — 파트너샵(입점 판매자)은 매장명+매장주소만 공개. 사업자 정보는 서버 HTML·모바일·파트너샵 어디에도 없음. 1요청 */
async function yes24(goUrl) {
  const r = await fetchText(goUrl)
  assertOk(r, 'YES24')
  const out = blank(r.url, 'yes24:product-html')
  const p = r.text.match(/href="\/Product\/PartnerShop\/(\d+)"[^>]*class="lnk_shop"[^>]*>\s*([^<]+?)\s*</) ||
            r.text.match(/href="\/Product\/PartnerShop\/(\d+)"[^>]*>\s*([^<]+?)\s*</)
  if (p) {
    out.sellerName = clean(p[2])
    out.storeUrl = `https://www.yes24.com/Product/PartnerShop/${p[1]}`
    out.source = 'yes24:partnerShop-link'
    out.note = 'YES24 파트너샵(입점 판매자) — 상호·대표자·사업자번호는 비공개'
  } else {
    const f = parseBusinessFooter(r.text)
    Object.assign(out, {
      sellerName: 'YES24', company: f?.company || '예스이십사(주)', ceo: f?.ceo, bizNo: f?.bizNo,
      address: f?.address, storeUrl: 'https://www.yes24.com/', source: 'yes24:direct(footer)'
    })
    out.note = 'YES24 직접 판매(파트너샵 링크 없음)'
  }
  out.overseas = false
  return out
}

/** TJ418 하이마트 — 업체배송(입점) 상품은 판매자명·사업자정보가 공개되지 않음(공급업체 코드만). 1요청 */
async function himart(goUrl) {
  const r = await fetchText(goUrl)
  assertOk(r, '하이마트')
  const out = blank(r.url, 'himart:product-html')
  const t = r.text
  const dlvTp = (t.match(/var goodsDlvTpCd\s*=\s*"(\d+)"/) || [])[1]
  const goodsNo = (t.match(/var goodsNo\s*=\s*"(\d+)"/) || [])[1]
  const brand = clean((t.match(/var brndNm\s*=\s*"([^"]*)"/) || [])[1] || (t.match(/brndnm="([^"]*)"/) || [])[1])
  const sup = (goodsNo && (t.match(new RegExp(`tdlvSupCorpNo_${goodsNo}"[^>]*value='(\\d+)'`)) || [])[1]) ||
              (t.match(/dlvSupCorpNo="(\d+)"/) || [])[1] || null
  const title = clean((t.match(/<title>([^<]*)<\/title>/) || [])[1])
  if (dlvTp === '02') {
    // 업체배송 = 입점 판매자 상품 (하이마트는 통신판매중개자)
    out.source = 'himart:marketplace(업체배송)'
    out.note = `업체배송(입점 판매자) 상품 — 판매자명/사업자정보 비공개. 공급업체코드=${sup || '?'}, 브랜드=${brand || '?'}`
    out.sellerName = null
  } else {
    const f = parseBusinessFooter(t)
    Object.assign(out, {
      sellerName: '롯데하이마트', company: f?.company || '롯데하이마트 주식회사', ceo: f?.ceo, bizNo: f?.bizNo,
      address: f?.address, storeUrl: 'https://www.e-himart.co.kr/', source: 'himart:direct(footer)'
    })
    out.note = `하이마트 직배송/택배(goodsDlvTpCd=${dlvTp || '?'}), 브랜드=${brand || '?'}`
  }
  out.overseas = false
  if (!dlvTp && !title) throw new Error('하이마트: 상품 페이지 구조 인식 실패')
  return out
}

/** TW326B LG전자(홈스타일) — RSC(flight) 데이터의 sellerInfo JSON. 1요청 (lgq.kr 단축주소 리다이렉트 포함) */
async function lgHomestyle(goUrl) {
  const r = await fetchText(goUrl)
  assertOk(r, 'LG전자')
  const out = blank(r.url, 'lge:homestyle-rsc.sellerInfo')
  const m = r.text.match(/sellerInfo\\?"\s*:\s*(\{[^{}]*\})/)
  if (m) {
    let raw = m[1]
    if (raw.includes('\\"')) raw = raw.replace(/\\\\/g, '\u0000').replace(/\\"/g, '"').replace(/\u0000/g, '\\')
    let si
    try { si = JSON.parse(raw) } catch { throw new Error('LG전자: sellerInfo JSON 파싱 실패') }
    Object.assign(out, {
      sellerName: clean(si.sellerName), company: clean(si.sellerName), ceo: clean(si.representative),
      bizNo: formatBizNo(si.businessRegistrationNumber), address: clean(si.address)
    })
    out.overseas = looksOverseasAddress(out.address) ?? false
    out.note = `LG 홈스타일 입점 판매자 sellerId=${si.sellerId || '?'}, 통신판매업=${si.onlineBusinessRegistrationNumber || '?'}`
    return out
  }
  const f = parseBusinessFooter(r.text)
  if (!f) throw new Error('LG전자: sellerInfo·푸터 모두 없음')
  Object.assign(out, {
    sellerName: 'LG전자', company: f.company || 'LG전자', ceo: f.ceo, bizNo: f.bizNo, address: f.address,
    overseas: false, source: 'lge:direct(footer)', note: 'sellerInfo 없음 → LG전자 직접 판매로 판단'
  })
  return out
}

/** TP90D 더현대닷컴(더현대Hi) — 공개 API /proxy/v1/pd/item/inf/itemCsfDscnInfo (slrInfo) + /proxy/v1/pd/item/detail. 최대 2요청 */
async function theHyundai(goUrl) {
  const id = (goUrl.match(/\/product\/([0-9A-Za-z]+)/) || [])[1]
  if (!id) throw new Error('더현대: 상품코드(slitmCd) 추출 실패')
  const productUrl = `https://hi.thehyundai.com/product/${id}`
  const hdr = { Referer: productUrl } // 페이지 JS 가 보내는 Referer 없이 호출하면 프록시가 500
  const out = blank(productUrl, 'thehyundai:api')
  const csf = await fetchJson(`https://hi.thehyundai.com/proxy/v1/pd/item/inf/itemCsfDscnInfo?slitmCd=${id}`, hdr)
  const s = csf?.data?.slrInfo
  if (s && (s.shnmNm || s.rgno)) {
    Object.assign(out, {
      sellerName: clean(s.rsptBrndNm) || clean(s.shnmNm), company: clean(s.shnmNm), ceo: clean(s.reppNm),
      bizNo: formatBizNo(s.rgno), address: clean(s.baseAdr), source: 'thehyundai:itemCsfDscnInfo.slrInfo'
    })
    out.overseas = looksOverseasAddress(out.address) ?? false
    out.note = '판매자(매장/브랜드) + 상호/대표자/사업자번호 = 상품페이지 "판매자 정보" 표와 동일 출처'
    return out
  }
  // slrInfo 없음 → 현대백화점 점포 직접 판매. 점포명/브랜드는 detail API
  const det = await fetchJson(`https://hi.thehyundai.com/proxy/v1/pd/item/detail?slitmCd=${id}`, hdr)
  const d = det?.data || {}
  const brand = d.brndInfo?.expsBrndNm || d.brndInfo?.operBrndNm || null
  Object.assign(out, {
    sellerName: `현대백화점${d.storeNm ? ' ' + d.storeNm : ''}${brand ? ' / ' + brand : ''}`,
    company: '(주)현대백화점', overseas: d.frgnDrctBuyYn === '1',
    source: 'thehyundai:item/detail(dept-store)'
  })
  out.note = `백화점 상품(openMktItemYn=${d.openMktItemYn ?? '?'}, 판매자정보 표 없음)`
  return out
}

/** TXB15E LFmall — nxapi 공개 API: /product/v1/basics (LF 직영 여부·공급업체코드) + /product/v1/notifications (판매자/해외 구매대행 정보). 2요청 */
async function lfmall(goUrl) {
  const code = (goUrl.match(/\/product\/([0-9A-Za-z]+)/) || [])[1]
  if (!code) throw new Error('LFmall: 상품코드 추출 실패')
  const productUrl = `https://www.lfmall.co.kr/app/product/${code}`
  const hdr = { Referer: 'https://www.lfmall.co.kr/' }
  const out = blank(productUrl, 'lfmall:nxapi')
  const basic = await fetchJson(`https://nxapi.lfmall.co.kr/product/v1/basics/${code}`, hdr)
  const bs = JSON.stringify(basic)
  const lfYn = (bs.match(/"productLfYn":"([YN])"/) || [])[1]
  const supply = (bs.match(/"supplyEntrCd":"([^"]+)"/) || [])[1] || null
  const brand = (bs.match(/"brandName":"([^"]+)"/) || [])[1] || null
  const noti = await fetchJson(`https://nxapi.lfmall.co.kr/product/v1/notifications/${code}`, hdr)
  const b = noti?.body || {}
  const sd = b.productInformationSellerDTO
  const desc = Object.fromEntries((b.productDescriptionCodeDTOList || []).map((x) => [x.codeName, x.description]))
  if (sd && (sd.supplyEntryName || sd.businessNumber)) {
    Object.assign(out, {
      sellerName: clean(sd.supplyEntryName), company: clean(sd.supplyEntryName), ceo: clean(sd.ownerName),
      bizNo: formatBizNo(sd.businessNumber) || clean(sd.businessNumber),
      address: clean(`${sd.businessFixAddress || ''} ${sd.businessDetailAddress || ''}`),
      storeUrl: sd.supplyEntryCode ? `https://www.lfmall.co.kr/app/exhibition/sellerShop/${sd.supplyEntryCode}` : null,
      source: 'lfmall:notifications.productInformationSellerDTO'
    })
  } else if (desc['해외판매자'] || desc['구매대행업자']) {
    Object.assign(out, {
      sellerName: clean(desc['구매대행업자'] || desc['해외판매자']), company: clean(desc['해외판매자'] || desc['구매대행업자']),
      address: clean(desc['영업소재지']), source: 'lfmall:notifications.productDescriptionCodeDTOList(해외구매대행)'
    })
    out.overseas = true
  } else if (lfYn === 'Y') {
    Object.assign(out, { sellerName: 'LF', company: '주식회사 LF', source: 'lfmall:basics(LF직영)' })
  } else {
    out.source = 'lfmall:basics(입점 공급업체)'
  }
  if (out.overseas == null) out.overseas = looksOverseasAddress(out.address) ?? false
  out.note = `productLfYn=${lfYn || '?'}, supplyEntrCd=${supply || '?'}, brand=${brand || '?'}` +
    (!sd && !desc['해외판매자'] && lfYn !== 'Y' ? ' — 판매자 상세 비공개(공급업체 코드만)' : '')
  return out
}

/** TMA01 아트박스(POOM) — 운영사 푸터 + 상품정보고시(제조자/수입자, POST /goods/searchGoodsClssInfo.action). 2요청 */
async function artbox(goUrl) {
  const r = await fetchText(goUrl)
  assertOk(r, '아트박스')
  const t = r.text
  const out = blank(r.url, 'artbox:footer+goodsClssInfo')
  const goodsNo = (t.match(/"goods_no":"([^"]+)"/) || [])[1] || (r.url.match(/goods_no=([^&]+)/) || [])[1]
  const vend = (t.match(/"vir_vend_no":"([^"]+)"/) || [])[1] || null
  const brand = clean((t.match(/item_brand\s*:\s*"([^"]*)"/) || [])[1])
  const f = parseBusinessFooter(t)
  Object.assign(out, {
    sellerName: '아트박스', company: f?.company || '㈜ 아트박스', ceo: f?.ceo, bizNo: f?.bizNo, address: f?.address,
    storeUrl: 'https://www.poom.co.kr/', overseas: false
  })
  let mfr = null
  if (goodsNo && vend) {
    try {
      const c = await fetchText('https://www.poom.co.kr/goods/searchGoodsClssInfo.action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'X-Requested-With': 'XMLHttpRequest',
          Referer: r.url
        },
        body: `goods_no=${encodeURIComponent(goodsNo)}&vir_vend_no=${encodeURIComponent(vend)}&purch_age_limit_cd=00`
      })
      const ct = htmlToText(c.text).replace(/\n/g, ' ')
      // "6. 제조자, 수입품의 경우 수입자를 함께 표기(...) <값> 7. ..." 형태
      mfr = (ct.match(/수입자를\s*함께\s*표기[^)]*\)\s*(.+?)(?=\s+\d{1,2}\.\s)/) || [])[1] ||
            (ct.match(/제조(?:자|사|원)\s*[:：]?\s*(.+?)(?=\s+\d{1,2}\.\s)/) || [])[1] || null
    } catch { /* 고시 정보는 보조 — 실패해도 진행 */ }
  }
  out.note = `아트박스 판매(협력업체코드 vir_vend_no=${vend || '?'}, 브랜드=${brand || '?'}) — 협력업체명/사업자 비공개` +
    (mfr ? ` | 고시: ${clean(mfr)}` : '')
  return out
}

/** TX1227 몰테일 — 해외 구매대행 자체 판매(Malltail Inc., 미국 법인). 페이지 푸터 주소. 1요청 */
async function malltail(goUrl) {
  const r = await fetchText(goUrl)
  assertOk(r, '몰테일')
  const out = blank(r.url, 'malltail:footer')
  const i = r.text.indexOf('fnb-info__address')
  const addr = i >= 0 ? clean(htmlToText(r.text.slice(i, i + 600)).split('\n').find((l) => /\d/.test(l) && l.length > 10)) : null
  const company = (r.text.match(/Copyright\s*@?\s*(Malltail[^.<]*?)\.?\s*All/i) || [])[1] || 'Malltail Inc.'
  const title = clean((r.text.match(/<meta property="og:title" content="([^"]+)"/) || [])[1])
  if (!title && !addr) throw new Error('몰테일: 페이지 구조 인식 실패')
  Object.assign(out, {
    sellerName: '몰테일(해외 구매대행)', company: clean(company),
    address: addr ? addr.replace(/\s*help@.*$/, '').trim() : null,
    storeUrl: 'https://post.malltail.com/', overseas: true
  })
  out.note = '몰테일 샵 상품 = 몰테일이 해외에서 구매·배송(국내 사업자번호 표기 없음)'
  return out
}

export const handlers = {
  TFB03: yes24,
  TJ418: himart,
  TW326B: lgHomestyle,
  TP90D: theHyundai,
  TXB15E: lfmall,
  TMA01: artbox,
  TX1227: malltail,
  TZ8F8: genericMallSeller // 유홍글로벌 유한회사(lumg.co.kr, MakeShop) — 자사몰
}

/** 서버 조회 경로를 찾지 못한 몰 (handlers 에 없음) */
export const BLOCKED = {
  TN118: 'SSG.COM — www/m.ssg.com itemView 403 (Akamai 봇 차단 페이지), robots.txt 일반 UA Disallow: /',
  EE311: '이마트몰 — emart.ssg.com / m-emart.ssg.com itemView 403 (Akamai)',
  ED901: '신세계몰 — shinsegaemall.ssg.com itemView 403 (Akamai)',
  NAVER: '스마트스토어 — inflow/ep/gw 429, main/products·m.smartstore·{store}/profile → nid 로그인 리다이렉트, search.shopping 418. 다나와 줄의 판매자명만 사용',
  COUPANG: '쿠팡 — www.coupang.com/vp/products·m.coupang.com/vm/products 403 Access Denied (Akamai)'
}
