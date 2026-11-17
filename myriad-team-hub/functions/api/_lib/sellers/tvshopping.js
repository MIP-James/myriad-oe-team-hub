// Group 3 (TV home-shopping / T-commerce) seller extractors.
// Plain fetch only (Node 18+/Cloudflare Workers). <=3 requests per product.
// Each handler(goUrl) -> { sellerName, company, ceo, bizNo, address, storeUrl, overseas, productUrl, source, vendorCode, manufacturer }
// source: '<mall>_<section>' when a partner/consignment seller is shown, 'mall_self' when the mall itself is the seller.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const BASE_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };

// ---------- helpers ----------
function getSetCookies(res) {
  if (typeof res.headers.getSetCookie === 'function') return res.headers.getSetCookie();
  const v = res.headers.get('set-cookie');
  return v ? v.split(/,(?=\s*[A-Za-z0-9_\-]+=)/) : [];
}

class Jar {
  constructor() { this.m = new Map(); }
  add(res) { for (const c of getSetCookies(res)) { const kv = c.split(';')[0]; const i = kv.indexOf('='); if (i > 0) this.m.set(kv.slice(0, i).trim(), kv.slice(i + 1).trim()); } }
  get(name) { return this.m.get(name); }
  header() { return [...this.m].map(([k, v]) => `${k}=${v}`).join('; '); }
}

// polite per-host spacing (>=1s between requests to the same host within one isolate)
const lastHit = new Map();
async function throttle(url) {
  const host = new URL(url).host;
  const wait = (lastHit.get(host) || 0) + 1000 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(host, Date.now());
}

async function req(url, { jar, headers = {}, method = 'GET', body, accept = 'text/html,application/xhtml+xml,*/*;q=0.8', expect = 'text' } = {}) {
  await throttle(url);
  const h = { ...BASE_HEADERS, Accept: accept, ...headers };
  if (jar && jar.m.size) h.Cookie = jar.header();
  const res = await fetch(url, { method, headers: h, body, redirect: 'follow' });
  if (jar) jar.add(res);
  if (res.status === 403 || res.status === 429) throw new Error(`blocked: HTTP ${res.status} ${url}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  if (/\/(login|member\/login)/i.test(res.url) && !/\/(login|member\/login)/i.test(url)) throw new Error(`login redirect: ${res.url}`);
  const text = await res.text();
  if (expect === 'json') { try { return { json: JSON.parse(text), res }; } catch { throw new Error(`non-JSON response from ${url}: ${text.slice(0, 120)}`); } }
  return { text, res };
}

const decodeEntities = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');
const clean = (s) => (s == null ? null : (decodeEntities(String(s).replace(/<[^>]+>/g, ' ')).replace(/[\s　]+/g, ' ').trim() || null));
const toText = (html) => clean(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' '));
const fmtBizNo = (s) => { if (!s) return null; const d = String(s).replace(/\D/g, ''); if (/^0{5}/.test(d)) return null; /* SK스토아 internal placeholders like 0000000066 */ return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : clean(s); };
const pick = (re, s, g = 1) => { const m = s && s.match(re); return m ? clean(m[g]) : null; };

function result(o) {
  return {
    sellerName: o.sellerName ?? null, company: o.company ?? null, ceo: o.ceo ?? null,
    bizNo: o.bizNo ? fmtBizNo(o.bizNo) : null, address: o.address ?? null, storeUrl: o.storeUrl ?? null,
    overseas: o.overseas ?? null, productUrl: o.productUrl ?? null, source: o.source ?? null,
    vendorCode: o.vendorCode ?? null, manufacturer: o.manufacturer ?? null,
  };
}

function idFrom(url, res, label) {
  for (const re of res) { const m = url.match(re); if (m) return decodeURIComponent(m[1]); }
  // also look inside an encoded targetUrl / target param
  let dec = url; try { dec = decodeURIComponent(url); } catch { }
  if (dec !== url) for (const re of res) { const m = dec.match(re); if (m) return m[1]; }
  throw new Error(`${label}: cannot find product id in ${url}`);
}

// Mall self-info (used when the mall itself is the seller). Values parsed live from the page footer when
// possible; these constants are fallbacks taken from each site's own footer / JS bundle (2026-11).
const SELF = {
  TSB275: { sellerName: 'SK스토아', company: 'SK스토아 주식회사', ceo: null, bizNo: null, address: null },
  TTC2DF: { sellerName: '쇼핑엔티', company: '주식회사 티알엔', ceo: '한상욱', bizNo: '116-81-50973', address: '서울특별시 중구 동호로 310 별관 (장충동 2가, 태광산업)' },
  TRB03: { sellerName: '신세계라이브쇼핑', company: '주식회사 신세계라이브쇼핑', ceo: '문성욱', bizNo: '502-86-28395', address: '서울특별시 성동구 아차산로 17, 10층(성수동1가)' },
  TZ9CF: { sellerName: 'W쇼핑', company: '(주)더블유쇼핑', ceo: '방선홍', bizNo: '220-87-08311', address: '서울특별시 서초구 서초대로 301, 12층' },
  TLB17: { sellerName: '홈앤쇼핑', company: '(주)홈앤쇼핑', ceo: null, bizNo: null, address: null },
  ED908: { sellerName: 'GS SHOP', company: '(주)지에스리테일', ceo: '허서홍', bizNo: '116-81-18745', address: '서울특별시 강남구 논현로 508 (역삼동, GS타워)' },
  ED909: { sellerName: 'CJ온스타일', company: '(주)씨제이이엔엠', ceo: '윤상현', bizNo: '106-81-51510', address: '서울시 서초구 과천대로 870-13, 1층(방배동)' },
  ED907: { sellerName: '현대Hmall', company: '(주)현대홈쇼핑', ceo: '한광영', bizNo: '211-86-76540', address: '서울특별시 강동구 올림픽로70길 34' },
  ED904: { sellerName: 'NS홈쇼핑', company: '(주)엔에스쇼핑', ceo: '조항목', bizNo: '117-81-33642', address: '경기도 성남시 분당구 판교로 228번길 15 NS홈쇼핑' },
};

// Parse "<company> 대표이사 : X ... 사업자등록번호 : N ... 주소 : A" style footers from page text.
function footerFrom(text, code, { companyRe, addrRe } = {}) {
  const base = { ...SELF[code] };
  if (!text) return base;
  const company = companyRe ? pick(companyRe, text) : null;
  const ceo = pick(/대표(?:이사|자)\s*:?\s*([가-힣]{2,4})(?![가-힣])/, text);
  const biz = pick(/사업자\s*등록\s*번호\s*:?\s*(\d{3}-\d{2}-\d{5})/, text);
  const addr = addrRe ? pick(addrRe, text) : null;
  return { ...base, ...(company && { company }), ...(ceo && { ceo }), ...(biz && { bizNo: biz }), ...(addr && { address: addr }) };
}

// ---------- handlers ----------
export const handlers = {
  // SK스토아: server HTML "표시 및 광고 주체" table (사업자명 + tooltip 주소 + 사업자등록 번호).
  // Empty table => SK스토아 itself (TV/direct) => mall_self via /templateFooter.
  async TSB275(goUrl) {
    const id = idFrom(goUrl, [/\/display\/goods\/(\d+)/, /goods_?[cC]ode=(\d+)/], 'TSB275');
    const productUrl = `https://www.skstoa.com/display/goods/${id}`;
    const jar = new Jar();
    const { text: html } = await req(productUrl, { jar });
    const vendorCode = pick(/param\['entpCode'\]\s*=\s*'(\d+)'/, html);
    const i = html.indexOf('표시 및 광고 주체</h5>');
    const block = i >= 0 ? html.slice(i, html.indexOf('</table>', i) + 8) : '';
    const name = pick(/<th>\s*사업자명\s*<\/th>[\s\S]*?<p>([\s\S]*?)<\/p>/, block);
    if (name) {
      return result({
        sellerName: name, company: name,
        address: pick(/<div class="tit_area">\s*주소\s*<\/div>\s*<div class="cont_area">([\s\S]*?)<\/div>/, block),
        bizNo: pick(/사업자등록\s*번호\s*<\/th>\s*<td>([\s\S]*?)<\/td>/, block),
        productUrl, source: 'skstoa_ad_subject', vendorCode,
      });
    }
    let footerText = null;
    try { footerText = toText((await req('https://www.skstoa.com/templateFooter', { jar, headers: { Referer: productUrl, 'X-Requested-With': 'XMLHttpRequest' } })).text); } catch { }
    return result({ ...footerFrom(footerText, 'TSB275', { companyRe: /(SK\s?스토아\s?(?:주식회사|\(주\))|\(주\)\s?SK\s?스토아|에스케이스토아 ?주식회사)/, addrRe: /주소\s*:?\s*([^|]+?)(?=\s*(?:\||사업자|통신판매|대표|TEL|전화|고객|호스팅|개인정보))/ }), productUrl, source: 'mall_self', vendorCode });
  },

  // 쇼핑엔티: no partner-seller section exists (HTML, getGoodsNtc, goods-purinfo-list checked) -> mall_self.
  async TTC2DF(goUrl) {
    const id = idFrom(goUrl, [/\/display\/goods\/(\d+)/, /goodsCd=(\d+)/], 'TTC2DF');
    const productUrl = `https://www.shoppingntmall.com/display/goods/${id}`;
    const { text: html } = await req(productUrl);
    const vendorCode = pick(/entpCd\s*:\s*"(\d+)"/, html);
    const text = toText(html);
    const self = footerFrom(text, 'TTC2DF', { companyRe: /(주식회사\s?티알엔|\(주\)\s?티알엔)/, addrRe: /주소\s*:\s*(.+?)\s*통신판매업/ });
    return result({ ...self, productUrl, source: 'mall_self', vendorCode });
  },

  // 신세계라이브쇼핑: server HTML table "위탁 판매자 정보 및 표시 광고 주체" (업체명 / 소재지 (주소) / 사업자등록번호),
  // vendor code from GA 'main_vendor_code'. Missing table => mall_self (footer).
  async TRB03(goUrl) {
    const id = idFrom(goUrl, [/\/display\/detail\/(\d+)/, /goodsCode=(\d+)/], 'TRB03');
    const productUrl = `https://www.shinsegaetvshopping.com/display/detail/${id}`;
    // PC 페이지는 Cloudflare 서버에서 417 로 막힘 → 같은 표가 있는 모바일 페이지로 조회 (2026-11-17 서버 확인)
    const { text: html } = await req(`https://m.shinsegaetvshopping.com/display/detail/${id}`);
    const vendorCode = pick(/'main_vendor_code'\s*:\s*"(\d+)"/, html);
    const vendorName = pick(/'main_vendor_name'\s*:\s*"([^"]+)"/, html);
    const i = html.indexOf('위탁 판매자 정보');
    if (i >= 0) {
      // PC = <th>업체명</th><td><pre>…</pre></td>, 모바일 = <dt>업체명</dt><dd>…</dd>
      const block = html.slice(i, i + 4000);
      const cell = (label) => {
        const v = pick(new RegExp(`<(?:th|dt)[^>]*>\\s*${label}[^<]*<\\/(?:th|dt)>\\s*<(?:td|dd)[^>]*>([\\s\\S]*?)<\\/(?:td|dd)>`), block);
        return v ? clean(v.replace(/<[^>]+>/g, ' ')) : null;
      };
      const name = cell('업체명');
      if (name) {
        return result({
          sellerName: name, company: name, address: cell('소재지'), bizNo: cell('사업자등록번호'),
          storeUrl: vendorCode ? `https://www.shinsegaetvshopping.com/plan/entpGoodsList?entpCode=${vendorCode}&entpName=${encodeURIComponent(vendorName || name)}` : null,
          productUrl, source: 'ssglive_consignment_table', vendorCode,
        });
      }
    }
    // 위탁 판매자 표가 없으면 쇼핑몰 직접 판매 (모바일 하단은 구조가 달라 고정값 사용)
    return result({ ...SELF.TRB03, productUrl, source: 'mall_self', vendorCode });
  },

  // W쇼핑: no partner-seller section; vendor code in getOrderObject() -> mall_self (footer).
  async TZ9CF(goUrl) {
    const id = idFrom(goUrl, [/\/display\/goods\/(\d+)/, /goodsCode=(\d+)/], 'TZ9CF');
    const productUrl = `https://www.w-shopping.co.kr/display/goods/${id}`;
    const { text: html } = await req(productUrl);
    const vendorCode = pick(/orderObj\['entpCode'\]\s*=\s*"(\d+)"/, html);
    // defensive: if W쇼핑 ever adds a 위탁판매자 table, take it
    const i = html.search(/위탁\s?판매자|표시\s?광고\s?주체/);
    if (i >= 0) {
      const block = html.slice(i, html.indexOf('</table>', i) + 8);
      const name = pick(/(?:업체명|사업자명|상호)\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/, block);
      if (name) return result({ sellerName: name, company: name, bizNo: pick(/사업자\s*등록\s*번호\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/, block), address: pick(/(?:주소|소재지)[^<]*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/, block), productUrl, source: 'wshop_ad_subject', vendorCode });
    }
    const self = footerFrom(toText(html), 'TZ9CF', { companyRe: /(\(주\)\s?더블유쇼핑)/, addrRe: /주소\s*:\s*(.+?)\s*통신판매업/ });
    return result({ ...self, productUrl, source: 'mall_self', vendorCode });
  },

  // 홈&쇼핑: every product page (PC www + mobile m.) is served as a NetFunnel waiting-room stub + STCLab BotManager;
  // real content needs the NetFunnel JS handshake. Not bypassed -> throws.
  async TLB17(goUrl) {
    const id = idFrom(goUrl, [/goods_code=(\d+)/, /\/goods\/view\/(\d+)/], 'TLB17');
    const productUrl = `https://www.hnsmall.com/display/goods.do?goods_code=${id}`;
    const { text: html } = await req(productUrl);
    if (/NetFunnel_Action/.test(html) && !/사업자|판매자/.test(toText(html) || '')) {
      throw new Error('TLB17 blocked: hnsmall product pages are gated by NetFunnel waiting room + BotManager (JS-only); no seller data in server HTML');
    }
    throw new Error('TLB17: unexpected page shape (gate not present) - parser not implemented');
  },

  // GS SHOP: gate with.gsshop.com/alia/aliaGate.gs?prdseqnum=ID -> www.gsshop.com/prd/prd.gs?prdid=ID;
  // embedded `var renderJson = {...}` -> prd.genrlInfoArea.{supNm,supAddr,supBzRegNo} ("위탁판매자 정보"), prd.supCd.
  async ED908(goUrl) {
    const id = idFrom(goUrl, [/[?&]prdid=(\d+)/i, /[?&]prdseqnum=(\d+)/i, /[?&]ecpid=(\d+)/i, /\/prd\/(\d+)/], 'ED908');
    const productUrl = `https://www.gsshop.com/prd/prd.gs?prdid=${id}`;
    const { text: html } = await req(productUrl);
    const m = html.match(/var renderJson\s*=\s*(\{[\s\S]*?\});\s*\n/);
    let prd = null;
    if (m) { try { prd = JSON.parse(m[1]).prd; } catch { } }
    if (!prd) throw new Error('ED908: renderJson not found/parsable');
    const g = prd.genrlInfoArea || {};
    const vendorCode = prd.supCd != null ? String(prd.supCd) : null;
    if (g.supNm) {
      return result({ sellerName: clean(g.supNm), company: clean(g.supNm), address: clean(g.supAddr), bizNo: g.supBzRegNo, productUrl, source: 'gsshop_renderJson_supplier', vendorCode });
    }
    const text = toText(html);
    const self = footerFrom(text, 'ED908', { companyRe: /(\(주\)\s?지에스리테일)/, addrRe: /주소\s*:\s*(.+?)\s*사업자등록번호/ });
    // "위탁판매자 정보 GS SHOP 고객센터(...)로 문의 시 개별로 안내해 드리겠습니다" => a consignment seller exists but is not disclosed online
    const undisclosed = /위탁판매자 정보\s*GS SHOP 고객센터[^.]{0,40}개별로 안내/.test(text || '');
    return result({ ...self, productUrl, source: undisclosed ? 'gsshop_seller_undisclosed' : 'mall_self', vendorCode });
  },

  // CJ온스타일: JSON https://display.cjonstyle.com/c/rest/item/{id}/buyInfo.json?channelCode=30002002
  // result.itemSummaryInfo.vendorName (= "상품정보제공자", only filled for some categories e.g. food), mainVenCd,
  // overseasPurType, returnChangeInfo.mkrNm. No vendorName => mall_self (CJ ENM).
  async ED909(goUrl) {
    const id = idFrom(goUrl, [/\/p\/item\/(\d+)/, /\/m\/item\/(\d+)/, /[?&]item_?[cC]d=(\d+)/], 'ED909');
    const productUrl = `https://display.cjonstyle.com/p/item/${id}`;
    const { json } = await req(`https://display.cjonstyle.com/c/rest/item/${id}/buyInfo.json?channelCode=30002002&inflowGroupCode=`, {
      expect: 'json', accept: 'application/json, text/javascript, */*; q=0.01', headers: { 'X-Requested-With': 'XMLHttpRequest', Referer: productUrl },
    });
    const s = json?.result?.itemSummaryInfo;
    if (!s) throw new Error(`ED909: buyInfo.json without itemSummaryInfo (code=${json?.code})`);
    const vendorCode = s.mainVenCd != null ? String(s.mainVenCd) : null;
    const manufacturer = clean(s.returnChangeInfo?.mkrNm);
    const overseas = s.overseasPurType ? true : false;
    if (s.vendorName && clean(s.vendorName)) {
      return result({ sellerName: clean(s.vendorName), company: clean(s.vendorName), productUrl, overseas, source: 'cjonstyle_buyInfo_vendorName', vendorCode, manufacturer });
    }
    return result({ ...SELF.ED909, productUrl, overseas, source: 'mall_self', vendorCode, manufacturer });
  },

  // 현대Hmall: page (Next.js) sets cookie uh2oxid; then GET https://www.hmall.com/api/hf/dp/v1/item-ptc/item-ptc?slitmCd={id}
  // with header uh2oxid -> respData.data.itemPtc.{venCd,cmisVenYn,mkcoNm,frgnDrctBuyYn,frgnDrctDlvYn}.
  // No partner name/biz info exposed -> mall_self (현대홈쇼핑) + vendor code.
  async ED907(goUrl) {
    const id = idFrom(goUrl, [/slitmCd=(\d+)/i, /\/item\/(\d+)/], 'ED907');
    const productUrl = `https://www.hmall.com/md/pda/itemPtc?slitmCd=${id}`;
    const jar = new Jar();
    const { text: html } = await req(productUrl, { jar });
    let p = null;
    const nd = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (nd) { try { p = JSON.parse(nd[1]).props.pageProps.respData.itemPtc; } catch { } }
    const tok = jar.get('uh2oxid');
    if (tok) {
      try {
        const { json } = await req(`https://www.hmall.com/api/hf/dp/v1/item-ptc/item-ptc?slitmCd=${id}`, { jar, expect: 'json', accept: 'application/json, text/plain, */*', headers: { uh2oxid: tok, Referer: productUrl } });
        if (json?.respData?.data?.itemPtc) p = json.respData.data.itemPtc;
      } catch { /* keep SSR data */ }
    }
    if (!p) throw new Error('ED907: no itemPtc data (page/API shape changed)');
    const overseas = p.frgnDrctBuyYn != null || p.frgnDrctDlvYn != null ? (p.frgnDrctBuyYn === 'Y' || p.frgnDrctDlvYn === 'Y') : null;
    const venName = clean(p.venNm);
    if (venName && p.cmisVenYn === 'Y') {
      return result({ sellerName: venName, company: venName, productUrl, overseas, source: 'hmall_itemPtc_venNm', vendorCode: p.venCd, manufacturer: clean(p.mkcoNm) });
    }
    return result({ ...SELF.ED907, productUrl, overseas, source: 'mall_self', vendorCode: p.venCd || null, manufacturer: clean(p.mkcoNm) });
  },

  // nsmall: SPA; JSON https://mapi.nsmall.com/md/api/v1/product/info/{id}?deviceChnId=INT -> data.resultData.detailInfo.{vndrCd,mnfNm,busChnId}.
  // No partner-seller section in the app (info-table / description checked) -> mall_self (NS홈쇼핑).
  async ED904(goUrl) {
    const id = idFrom(goUrl, [/product_id=(\d+)/, /\/goods\/(\d+)/, /goods_?[cC]d=(\d+)/, /target=%2Fgoods%2F(\d+)/i], 'ED904');
    const productUrl = `https://m.nsmall.com/goods/${id}`;
    const { json } = await req(`https://mapi.nsmall.com/md/api/v1/product/info/${id}?deviceChnId=INT`, {
      expect: 'json', accept: 'application/json, text/plain, */*', headers: { Origin: 'https://m.nsmall.com', Referer: productUrl },
    });
    const d = json?.data?.resultData?.detailInfo;
    if (!d) throw new Error(`ED904: product/info without detailInfo (${json?.data?.resultCode} ${json?.data?.resultMessage})`);
    return result({ ...SELF.ED904, productUrl, source: 'mall_self', vendorCode: d.vndrCd != null ? String(d.vndrCd) : null, manufacturer: clean(d.mnfNm), overseas: null });
  },
};

export default handlers;
