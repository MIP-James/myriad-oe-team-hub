/**
 * 다나와 최저가 모니터링 — 쇼핑몰별 판매자 조회 (G마켓·옥션·11번가는 danawa.js 에서 직접).
 * 각 handler(goUrl) = 다나와 연결 페이지에서 얻은 실제 상품 주소
 *   → { sellerName, company, ceo, bizNo, address, storeUrl, overseas, productUrl, source, note? }
 *
 * 몰별 조사·검증: 2026-11-17 (다나와 65개 상품에서 나온 34개 몰, 몰마다 실상품 2~4개로 확인)
 *   sellers/lotte.js       — 롯데ON·롯데백화점·롯데마트몰·롯데홈쇼핑
 *   sellers/marketplace.js — 하프클럽·보리보리·패션플러스·머스트잇·크로켓·오늘의집
 *   sellers/tvshopping.js  — SK스토아·쇼핑엔티·신세계라이브쇼핑·W쇼핑·홈앤쇼핑(차단)·GS SHOP·CJ온스타일·현대Hmall·NS몰
 *   sellers/misc.js        — YES24·하이마트·LG전자·더현대닷컴·LFmall·아트박스·몰테일 + 자사몰 범용 사업자정보 파서
 * 서버 차단(조회 불가): SSG.COM·이마트몰·신세계몰(Akamai 403), 네이버 스마트스토어(429/로그인), 쿠팡(403), 홈앤쇼핑(대기열+봇차단)
 */
import { handlers as lotte } from './sellers/lotte.js'
import { handlers as marketplace } from './sellers/marketplace.js'
import { handlers as tvshopping } from './sellers/tvshopping.js'
import { handlers as misc, genericMallSeller } from './sellers/misc.js'

export const SELLER_HANDLERS = { ...lotte, ...marketplace, ...tvshopping, ...misc }

// 서버 조회를 막는 쇼핑몰 (주소 패턴) — 판매자 상세는 상품 페이지에서 확인
const BLOCKED_HOSTS = [
  { re: /(^|\.)ssg\.com$/i, key: 'SSG' },
  { re: /(^|\.)coupang\.com$/i, key: 'COUPANG' },
  { re: /(^|\.)smartstore\.naver\.com$/i, key: 'NAVER' },
  { re: /(^|\.)brand\.naver\.com$/i, key: 'NAVER' },
  { re: /(^|\.)hnsmall\.com$/i, key: 'HNSMALL' }
]

// 큰 플랫폼인데 전용 조회가 없는 경우 범용 파서를 쓰면 '플랫폼 운영사'가 판매자로 잘못 찍힘 → 범용 파서 제외
const NO_GENERIC_HOSTS = /(^|\.)(naver\.com|kakao\.com|gmarket\.co\.kr|auction\.co\.kr|11st\.co\.kr|wemakeprice\.com|tmon\.co\.kr|interpark\.com|akmall\.com|galleria\.co\.kr|kurly\.com|musinsa\.com|oliveyoung\.co\.kr|29cm\.co\.kr|wconcept\.co\.kr|aliexpress\.com|temu\.com|amazon\.)/i

/** 조회 결과 → 상태 (ok / mall_self / undisclosed) */
export function sellerStatusOf(code, s) {
  const src = String(s?.source || '')
  if (/undisclosed/i.test(src)) return 'undisclosed'
  if (!s?.sellerName && /marketplace|공급업체/i.test(src)) return 'undisclosed'
  if (src === 'mall_self' || /static operator fallback|first-party mall|direct|직영|artbox:footer|malltail:footer/i.test(src)) return 'mall_self'
  return 'ok'
}

export function pickSellerHandler(row, goUrl) {
  let host = ''
  try { host = new URL(goUrl || row.bridgeUrl).hostname } catch {}
  const byCode = SELLER_HANDLERS[row.mallCode]
  if (byCode) return { kind: 'handler', key: row.mallCode, fn: byCode }
  const blocked = BLOCKED_HOSTS.find((b) => b.re.test(host))
  if (blocked) return { kind: 'blocked', key: blocked.key }
  // 처음 보는 몰 (대개 브랜드 자사몰) — 페이지 하단 사업자 정보로 운영사(=판매자) 확인
  if (goUrl && host && !NO_GENERIC_HOSTS.test(host) && !row.isMarketSeller) {
    return { kind: 'handler', key: 'GENERIC', fn: genericMallSeller }
  }
  return { kind: 'none', key: null }
}
