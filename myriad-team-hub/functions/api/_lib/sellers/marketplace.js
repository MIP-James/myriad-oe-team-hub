// Seller lookup handlers — group 2 (marketplaces with third-party sellers).
// Plain fetch only (Node 24 / Cloudflare Worker compatible). 1-2 requests per product (+1 retry on network error, max 3).
// Each handler: async (goUrl) => { sellerName, company, ceo, bizNo, address, storeUrl, overseas, productUrl, source, extra }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const BASE_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };

// retry: one extra attempt on network-level failure only (not on HTTP errors). Keeps total <=3 requests/product.
async function get(url, opts = {}) {
  try { return await get1(url, opts); }
  catch (e) {
    if (opts.retry && /^fetch failed/.test(e.message)) { await new Promise((r) => setTimeout(r, 1000)); return get1(url, opts); }
    throw e;
  }
}
async function get1(url, { json = false, headers = {}, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  let r;
  try {
    r = await fetch(url, {
      headers: { ...BASE_HEADERS, Accept: json ? 'application/json' : 'text/html,*/*', ...headers },
      redirect: 'follow',
      signal: ctl.signal,
    });
  } catch (e) {
    throw new Error(`fetch failed ${url}: ${e.name === 'AbortError' ? 'timeout' : e.message}`);
  } finally {
    clearTimeout(t);
  }
  if (r.status === 403 || r.status === 429) throw new Error(`blocked HTTP ${r.status} ${url}`);
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
  const text = await r.text();
  if (!json) return { text, url: r.url };
  try { return { data: JSON.parse(text), url: r.url }; }
  catch { throw new Error(`non-JSON response from ${url}: ${text.slice(0, 120)}`); }
}

const clean = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s && s !== '--' ? s : null;
};
const fmtBizNo = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : clean(v);
};
const result = (o) => ({
  sellerName: null, company: null, ceo: null, bizNo: null, address: null,
  storeUrl: null, overseas: null, productUrl: null, source: null, extra: null, ...o,
});
const idFrom = (url, re, label) => {
  const m = String(url).match(re);
  if (!m) throw new Error(`${label}: cannot find product id in URL ${url}`);
  return m[1];
};

// ---------- 하프클럽 / 보리보리 (same platform, Tricycle) ----------
// API used by the site's own Nuxt app: GET {base}/product/products/withoutPrice/{prdNo}?countryCd=001&langCd=001&deviceCd=001&siteCd={1|2}
// data.company = { selAcntNo, selAcntNm (seller/partner company), selAcntCd, mainTelNo }
// No business registration info (대표자/사업자번호) is exposed anywhere on the product page.
async function tricycle(goUrl, { base, siteCd, web, label }) {
  const prdNo = idFrom(goUrl, /\/(?:product|deal|set)\/(\d+)/, label);
  const api = `${base}/product/products/withoutPrice/${prdNo}?countryCd=001&langCd=001&deviceCd=001&siteCd=${siteCd}`;
  const { data } = await get(api, { json: true, retry: true });
  const d = data && data.data;
  if (!d) throw new Error(`${label}: empty product data (${data && (data.code || data.message)})`);
  const c = d.company || {};
  const tmpl = d.dlvTmpltInfo || {};
  return result({
    sellerName: clean(c.selAcntNm),
    company: clean(c.selAcntNm),
    overseas: d.dlvTypCd ? d.dlvTypCd === '03' : null, // dlvTypCd "03" = 해외배송 label in site JS
    storeUrl: tmpl.dlvTmpltSeq ? `${web}/item/shop?dlvTmpltSeq=${tmpl.dlvTmpltSeq}` : null, // "같은 배송그룹(=같은 판매자) 상품" list
    productUrl: `${web}/product/${prdNo}`,
    source: api,
    extra: {
      sellerAccountNo: c.selAcntNo ?? null,
      sellerAccountCd: clean(c.selAcntCd),
      phone: clean(c.mainTelNo),
      brand: clean(d.brandMainNmKr),
      productName: clean(d.prdNm),
    },
  });
}

// ---------- 패션플러스 ----------
// Server HTML has a "위탁판매정보" (판매자 정보) dropdown table: 업체명 / 연락처 / 택배사 / 반품지주소.
// No 대표자/사업자번호 for the consignment seller.
function tableRows(html) {
  const rows = {};
  const re = /<th[^>]*>\s*(?:<b>)?\s*([^<]+?)\s*(?:<\/b>)?\s*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(html))) {
    const k = m[1].trim();
    if (!(k in rows)) rows[k] = m[2].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return rows;
}
async function fashionplus(goUrl) {
  const id = idFrom(goUrl, /\/goods\/detail\/(\d+)/, 'TH002');
  const url = `https://www.fashionplus.co.kr/goods/detail/${id}`;
  const { text } = await get(url, { retry: true });
  const i = text.indexOf('위탁판매정보');
  if (i < 0) {
    if (/상품이 존재하지 않|판매 종료|판매종료/.test(text)) throw new Error('TH002: product not available');
    return result({ productUrl: url, source: url, extra: { note: 'no 위탁판매정보 section (likely platform-direct item)' } });
  }
  const seg = text.slice(i, i + 6000);
  const seller = tableRows(seg.slice(0, seg.indexOf('</table>') + 8));
  const general = tableRows(text.slice(text.indexOf('상품 일반정보'), text.indexOf('상품 일반정보') + 4000));
  const shipping = [...new Set([general['배송정보'], general['배송처']].filter(Boolean))].join(' ');
  return result({
    sellerName: clean(seller['업체명']),
    company: clean(seller['업체명']),
    overseas: shipping ? /해외/.test(shipping) : null,
    productUrl: url,
    source: url + ' (HTML 위탁판매정보)',
    extra: {
      phone: clean(seller['연락처']),
      returnAddress: clean(seller['반품지주소']), // 반품지 — not the registered business address
      courier: clean(seller['택배사']),
      shipping: clean(shipping),
    },
  });
}

// ---------- 머스트잇 ----------
// 1) GET https://m.web.mustit.co.kr/v2/api/legacy/itemInfo?itemNo={id}  -> sellerId, shippingType (DOMESTIC|OVERSEA)
// 2) GET https://m.web.mustit.co.kr/v2/api/member/sellerWholeInfo?sellerId={sellerId} -> seller{company,name,bizNo,addr,addrDetail,sellerType}
// Both are the site's own Next.js route handlers; they require header X-Route-Token: Next-Route-Token (constant the page sends).
const MUSTIT_H = { 'X-Route-Token': 'Next-Route-Token' };
async function mustit(goUrl) {
  let u = String(goUrl);
  try { const inner = new URL(u).searchParams.get('URL'); if (inner) u = inner; } catch {}
  const id = idFrom(decodeURIComponent(u), /product_detail\/(\d+)/, 'TS606');
  const productUrl = `https://m.web.mustit.co.kr/v2/m/product/product_detail/${id}`;
  const itemApi = `https://m.web.mustit.co.kr/v2/api/legacy/itemInfo?itemNo=${id}`;
  const { data: item } = await get(itemApi, { json: true, headers: { ...MUSTIT_H, Referer: productUrl } });
  const sellerId = item && item.sellerId;
  if (!sellerId) throw new Error(`TS606: no sellerId in itemInfo for ${id}`);
  const sApi = `https://m.web.mustit.co.kr/v2/api/member/sellerWholeInfo?sellerId=${encodeURIComponent(sellerId)}`;
  const { data } = await get(sApi, { json: true, retry: true, headers: { ...MUSTIT_H, Referer: productUrl } });
  const s = (data && data.seller) || {};
  const type = s.sellerType || null; // BIZ / GLOBAL / PRIVATE
  const addr = [clean(s.addr), clean(s.addrDetail)].filter(Boolean).join(' ') || null;
  return result({
    sellerName: clean(s.userId) || sellerId,
    company: clean(s.company),
    ceo: clean(s.name),
    bizNo: s.bizNo ? fmtBizNo(s.bizNo) : null,
    address: addr,
    overseas: type === 'GLOBAL' || item.shippingType === 'OVERSEA' || !!data.globalInfo,
    productUrl,
    source: `${itemApi} + ${sApi}`,
    extra: {
      sellerNo: s.sellerNo ?? null,
      sellerType: type,
      shippingType: item.shippingType || null,
      mailOrderNo: clean(s.onlineBizRegistrationNumber),
      csPhone: clean(s.companyCallNum) || clean(s.servCallNum),
      deliveryAddress: clean(s.delivAddr),
      globalInfo: data.globalInfo || null,
      productName: clean(item.itemName),
    },
  });
}

// ---------- 크로켓 (와이오엘오) ----------
// 1) GET https://web.croket.co.kr/api_base/store/get/itemInfo?storeItemId={id} -> storeId, storeTitle, nation, isAbroadShipping
// 2) GET https://web.croket.co.kr/api_msa/store/{storeId}/public-seller-info
//    -> { sellerType: domesticBusiness|foreignBusiness|privateSeller, displayName, representativeName, registrationNumber, businessAddress, mailOrderSellerRegistrationNumber }
async function croket(goUrl) {
  const id = idFrom(goUrl, /\/seller\/product\/([0-9a-f]{24})/i, 'TZ7F7');
  const itemApi = `https://web.croket.co.kr/api_base/store/get/itemInfo?storeItemId=${id}`;
  const H = { locale: 'ko-KR' };
  const { data: item } = await get(itemApi, { json: true, headers: H });
  if (!item || !item.storeId) throw new Error(`TZ7F7: no storeId in itemInfo (${JSON.stringify(item).slice(0, 120)})`);
  const sApi = `https://web.croket.co.kr/api_msa/store/${item.storeId}/public-seller-info`;
  const { data: s } = await get(sApi, { json: true, retry: true, headers: H });
  const foreign = s.sellerType === 'foreignBusiness';
  return result({
    sellerName: clean(item.storeTitle) || clean(s.displayName),
    company: clean(s.displayName),
    ceo: clean(s.representativeName),
    bizNo: s.registrationNumber ? fmtBizNo(s.registrationNumber) : null,
    address: clean(s.businessAddress),
    storeUrl: `https://www.croket.co.kr/seller/${item.storeId}`,
    overseas: foreign || item.isAbroadShipping === true || (item.nation && item.nation !== 'KR') || false,
    productUrl: `https://www.croket.co.kr/seller/product/${id}`,
    source: `${itemApi} + ${sApi}`,
    extra: {
      storeId: item.storeId,
      sellerType: s.sellerType || null,
      nation: item.nation || null,
      mailOrderNo: clean(s.mailOrderSellerRegistrationNumber),
      productName: clean(item.itemName),
    },
  });
}

// ---------- 오늘의집 ----------
// 1) GET https://store.ohou.se/api/goods/{id}/delivery -> sellerInfo{company,representative,address,csPhone,email,license,ecLicense}
// 2) GET https://store.ohou.se/api/goods/{id} -> production.isOverseasPurchase, brand{id,name}
async function ohou(goUrl) {
  const id = idFrom(goUrl, /(?:\/productions\/|\/goods\/)(\d+)/, 'TU710C');
  const H = { Referer: `https://store.ohou.se/goods/${id}` };
  const dApi = `https://store.ohou.se/api/goods/${id}/delivery`;
  const { data: d } = await get(dApi, { json: true, retry: true, headers: H });
  const s = (d && d.sellerInfo) || {};
  const gApi = `https://store.ohou.se/api/goods/${id}`;
  let g = null;
  try { g = (await get(gApi, { json: true, headers: H })).data; } catch { /* optional */ }
  const prod = (g && g.production) || {};
  const brand = (g && g.brand) || prod.brand || null;
  return result({
    sellerName: clean(s.company),
    company: clean(s.company),
    ceo: clean(s.representative),
    bizNo: clean(s.license),
    address: clean(s.address),
    storeUrl: brand && brand.id ? `https://store.ohou.se/brands/${brand.id}` : null, // brand page (ohou has no per-seller storefront)
    overseas: typeof prod.isOverseasPurchase === 'boolean' ? prod.isOverseasPurchase : null,
    productUrl: `https://store.ohou.se/goods/${id}`,
    source: `${dApi} + ${gApi}`,
    extra: {
      csPhone: clean(s.csPhone),
      email: clean(s.email),
      mailOrderNo: clean(s.ecLicense),
      brand: brand ? clean(brand.name) : null,
      returnAddress: clean(d && d.refundExchangeInfo && d.refundExchangeInfo.address),
      productName: clean(prod.name),
    },
  });
}

export const handlers = {
  TZ6171: (u) => tricycle(u, { base: 'https://hapix.halfclub.com', siteCd: 1, web: 'https://www.halfclub.com', label: 'TZ6171' }),
  TG021: (u) => tricycle(u, { base: 'https://apix.boribori.co.kr', siteCd: 2, web: 'https://m.boribori.co.kr', label: 'TG021' }),
  TH002: fashionplus,
  TS606: mustit,
  TZ7F7: croket,
  TU710C: ohou,
};
