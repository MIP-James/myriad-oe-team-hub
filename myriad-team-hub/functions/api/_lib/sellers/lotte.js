// Seller lookup handlers for danawa mall group 1 (Lotte family).
// Each handler takes the resolved real product URL (danawa bridge `go=` URL)
// and returns { sellerName, company, ceo, bizNo, address, storeUrl, overseas, productUrl, source }.
// Plain fetch only (Cloudflare Worker compatible). 1 request per product.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
const BASE_HEADERS = { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' };

async function get(url, accept, referer) {
  const headers = { ...BASE_HEADERS, Accept: accept || 'text/html,application/xhtml+xml,*/*;q=0.8' };
  if (referer) headers.Referer = referer;
  const res = await fetch(url, { headers, redirect: 'follow' });
  const waf = res.headers.get('x-amzn-waf-action');
  if (waf) {
    const e = new Error(`blocked: AWS WAF ${waf} (HTTP ${res.status}) ${url}`);
    e.blocked = true;
    throw e;
  }
  if (res.status === 403 || res.status === 429) {
    const e = new Error(`blocked: HTTP ${res.status} ${url}`);
    e.blocked = true;
    throw e;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
  return res;
}

const clean = (s) => {
  if (s == null) return null;
  const t = String(s).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  return t || null;
};
const joinAddr = (...parts) => clean(parts.filter(Boolean).join(' '));
const fmtBizNo = (s) => {
  const d = String(s || '').replace(/\D/g, '');
  return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (clean(s) || null);
};
const result = (o) => ({
  sellerName: null, company: null, ceo: null, bizNo: null, address: null,
  storeUrl: null, overseas: null, productUrl: null, source: null, ...o,
});
// HTML -> array of non-empty text lines (scripts/styles removed)
const htmlLines = (html) => html
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<[^>]+>/g, '\n')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .split('\n').map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
// value of the line right after an exact label line
const after = (lines, label) => {
  const i = lines.indexOf(label);
  return i >= 0 && i + 1 < lines.length ? lines[i + 1] : null;
};

// ---------------------------------------------------------------- LotteON (EE309 / TLC16)
// URL: https://www.lotteon.com/p/product/{pdNo}?sitmNo={sitmNo}...  (ellotte.lotteon.com same path)
// API: https://pbf.lotteon.com/product/v2/detail/search/base/sitm/{sitmNo}?sitmNo={sitmNo}&entryPoint=pcs
//      fallback (no sitmNo): .../search/base/pd/{pdNo}?pdNo={pdNo}&entryPoint=pcs
async function lotteon(goUrl) {
  const u = new URL(goUrl);
  const sitmNo = u.searchParams.get('sitmNo');
  const pdNo = (u.pathname.match(/\/p\/product\/([A-Z]{2}\d+)/) || [])[1];
  if (!sitmNo && !pdNo) throw new Error(`lotteon: cannot find sitmNo/pdNo in ${goUrl}`);
  const mallNo = u.searchParams.get('mall_no') || (u.hostname.startsWith('ellotte.') ? '2' : null);
  const api = sitmNo
    ? `https://pbf.lotteon.com/product/v2/detail/search/base/sitm/${encodeURIComponent(sitmNo)}?sitmNo=${encodeURIComponent(sitmNo)}&entryPoint=pcs${mallNo ? `&mall_no=${mallNo}` : ''}`
    : `https://pbf.lotteon.com/product/v2/detail/search/base/pd/${pdNo}?pdNo=${pdNo}&entryPoint=pcs${mallNo ? `&mall_no=${mallNo}` : ''}`;
  const res = await get(api, 'application/json, text/plain, */*', 'https://www.lotteon.com/');
  const j = await res.json();
  const d = j && j.data;
  if (!d || !d.slrInfo) throw new Error(`lotteon: no slrInfo (returnCode=${j && j.returnCode} ${j && j.message})`);
  const s = d.slrInfo;
  const tr = s.trBase || {};
  const address =
    joinAddr(tr.bzplcStnmZipAddr, tr.bzplcStnmDtlAddr) ||
    joinAddr(tr.stnmZipAddr, tr.stnmDtlAddr || tr.bzplcDtlAddr) ||
    joinAddr(tr.bzplcZipAddr, tr.bzplcDtlAddr);
  return result({
    sellerName: clean(s.sellerNm),
    company: clean(tr.trNm),
    ceo: clean(tr.rprrNm),
    bizNo: tr.bizpRegNo ? fmtBizNo(tr.bizpRegNo) : null,
    address,
    storeUrl: s.strLandingUrl ? new URL(s.strLandingUrl, 'https://www.lotteon.com').href : null,
    overseas: s.overseasSellerYn === 'Y' ? true : s.overseasSellerYn === 'N' ? false : null,
    productUrl: goUrl,
    source: `lotteon pbf api (${sitmNo ? 'sitm' : 'pd'}); sellerGroup=${clean(tr.trGrpNm || (d.basicInfo && d.basicInfo.trGrpNm))}; trNo=${tr.trNo || ''}; mosDeclNo=${tr.mosDeclNo || ''}`,
  });
}

// ---------------------------------------------------------------- 롯데마트몰 / Lotte Mart Zetta (TU14D)
// URL: https://lottemartzetta.com/products/{OS...}/details
// First-party grocery mall (Ocado platform): there is no marketplace seller field in the product data.
// Seller = the mall operator, parsed from the page footer. Manufacturer is read from the
// 상품 고시 정보 table in window.__QUERY_INITIAL_STATE__ (bopData.fields[title=furtherDescription]).
const LOTTEMART_OPERATOR = {
  sellerName: '롯데쇼핑(주)롯데마트사업본부',
  company: '롯데쇼핑(주)롯데마트사업본부',
  ceo: '정현석, 신동빈, 차우철, 임재철',
  bizNo: '215-85-13569',
  address: '서울특별시 송파구 올림픽로 269 (신천동, 롯데캐슬골드 6층)',
  storeUrl: null,
  overseas: false,
};
async function lottemart(goUrl) {
  const u = new URL(goUrl);
  const id = (u.pathname.match(/\/products\/([^/]+)/) || [])[1];
  if (!id) throw new Error(`lottemart: no product id in ${goUrl}`);
  const pageUrl = `https://lottemartzetta.com/products/${id}/details`;
  let html;
  try {
    html = await (await get(pageUrl)).text();
  } catch (e) {
    // lottemartzetta.com sits behind AWS WAF; after a few requests it answers 202 + x-amzn-waf-action: challenge
    // (JS challenge, empty body). We do not try to solve it. Because the mall is first-party, fall back to the
    // operator info (same values the page footer shows) and say so in `source`.
    if (e.blocked) return result({ ...LOTTEMART_OPERATOR, productUrl: pageUrl, source: `static operator fallback (page blocked: ${e.message.split(' http')[0]})` });
    throw e;
  }
  if (!html) throw new Error(`lottemart: empty page for ${id}`);

  let fields = [];
  const m = html.match(/window\.__QUERY_INITIAL_STATE__\s*=\s*(\{[\s\S]*?\})<\/script>/);
  if (m) {
    try {
      const q = JSON.parse(m[1]);
      const bop = (q.queries || []).find((x) => Array.isArray(x.queryKey) && x.queryKey[0] === 'bop');
      fields = (bop && bop.state && bop.state.data && bop.state.data.bopData && bop.state.data.bopData.fields) || [];
      if (!bop || !bop.state.data.product) throw new Error('no product');
    } catch (e) {
      throw new Error(`lottemart: product data not found for ${id} (${e.message})`);
    }
  } else {
    throw new Error(`lottemart: __QUERY_INITIAL_STATE__ missing for ${id}`);
  }
  // optional seller block (판매자정보) if the platform ever exposes it
  const producer = fields.find((f) => f.title === 'producer');
  const notice = fields.find((f) => f.title === 'furtherDescription');
  let manufacturer = null;
  if (notice) {
    const nl = htmlLines(notice.content || '');
    const k = nl.findIndex((s) => /제조자|제조원|수입자/.test(s));
    if (k >= 0) manufacturer = nl[k + 1] || null;
  }

  // footer: 롯데쇼핑(주)롯데마트사업본부 | 대표이사 : ... | 주소 : ... | 사업자등록번호 : ...
  const lines = htmlLines(html);
  const bi = lines.findIndex((s) => /^사업자등록번호\s*:/.test(s));
  let company = null, ceo = null, address = null, bizNo = null;
  if (bi >= 0) {
    bizNo = fmtBizNo(lines[bi].split(':')[1]);
    const win = lines.slice(Math.max(0, bi - 6), bi);
    const ci = win.findIndex((s) => /^대표/.test(s));
    if (ci > 0) company = win[ci - 1];
    if (ci >= 0) ceo = clean(win[ci].split(':').slice(1).join(':'));
    const ai = win.findIndex((s) => /^주소\s*:/.test(s));
    if (ai >= 0) address = clean([win[ai].split(':').slice(1).join(':'), ...win.slice(ai + 1)].join(' '));
  }
  return result({
    sellerName: producer ? clean(htmlLines(producer.content || '').join(' ')) : (company || '롯데마트'),
    company,
    ceo,
    bizNo,
    address,
    storeUrl: null,
    overseas: false,
    productUrl: pageUrl,
    source: `lottemartzetta SSR page; ${producer ? 'bopData producer field' : 'first-party mall (operator from footer)'}${manufacturer ? `; 제조자/수입자=${manufacturer}` : ''}`,
  });
}

// ---------------------------------------------------------------- 롯데홈쇼핑 (ED903)
// danawa link: https://www.lotteimall.com/coop/affilGate.lotte?...&returnUrl=/goods/viewGoodsDetail.lotte?goods_no=NNN
// We fetch https://www.lotteimall.com/goods/viewGoodsDetail.lotte?goods_no=NNN directly (server-rendered).
//   - "판매자" table (only on some 협력사 direct-ship items): sellerName
//   - 상품정보제공고시 "표시광고주체" + "소재지(주소)": advertiser entity (company) + its address
// No CEO / 사업자번호 / store page are exposed for vendors.
async function lotteimall(goUrl) {
  const goodsNo = (goUrl.match(/goods_no=(\d+)/) || [])[1];
  if (!goodsNo) throw new Error(`lotteimall: no goods_no in ${goUrl}`);
  const pageUrl = `https://www.lotteimall.com/goods/viewGoodsDetail.lotte?goods_no=${goodsNo}`;
  const html = await (await get(pageUrl)).text();
  if (!html.includes(goodsNo)) throw new Error(`lotteimall: product page did not render goods_no ${goodsNo}`);
  const lines = htmlLines(html);
  if (!lines.includes('상세정보')) throw new Error(`lotteimall: unexpected page (sold out / removed?) ${goodsNo}`);
  const seller = clean(after(lines, '판매자'));
  const advertiser = clean(after(lines, '표시광고주체'));
  const addr = clean(after(lines, '소재지(주소)'));
  let manufacturer = null;
  const mi = lines.findIndex((s) => /^제조자\s*\/\s*수입여부$|^제조자|^제조원|^생산자/.test(s));
  if (mi >= 0) manufacturer = clean(lines[mi + 1]);
  if (!seller && !advertiser) throw new Error(`lotteimall: no 판매자 / 표시광고주체 on page ${goodsNo}`);
  return result({
    sellerName: seller || advertiser,
    company: advertiser,
    ceo: null,
    bizNo: null,
    address: addr,
    storeUrl: null,
    overseas: null,
    productUrl: pageUrl,
    source: `lotteimall SSR page; 판매자=${seller ? 'table' : 'absent'}; 표시광고주체=${advertiser || 'absent'}${manufacturer ? `; 제조자=${manufacturer}` : ''}; mall operator=주식회사 우리홈쇼핑 117-81-33400`,
  });
}

export const handlers = {
  EE309: lotteon,
  TLC16: lotteon,
  TU14D: lottemart,
  ED903: lotteimall,
};
