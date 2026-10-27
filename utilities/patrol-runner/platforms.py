"""플랫폼별 검색 주소 + 검색 결과 해석 + 봇 확인/차단 감지.

각 플랫폼은 신규순 정렬 검색 주소를 만들고, 열린 검색 결과 페이지에서
상품 카드 목록 [{id, url, title, price, seller}] 을 뽑는다.
검증 기록 (2026-10-26~27, 키워드 "맥세이프 투명 케이스"):
- 지마켓 s=3 신규순, 60건/페이지, 접속마다 Cloudflare 확인(403) — 평소처럼 실행한 크롬에 연결하면
  몇 초 뒤 저절로 통과, Playwright 가 띄운 크롬은 클릭해도 안 풀림 (2026-10-27)
- 옥션  s=3 신규순 (지마켓과 같은 정렬 코드), 봇 확인 없음
- 11번가 sortCd=N 최신순 (NP 는 무시됨), 상단 광고·추천 약 9개는 정렬 무관
- 스마트스토어(네이버 쇼핑): 로그인한 프로필 + 네이버 → 쇼핑 진입 + 네이버페이 탭(productSet=checkout).
  검색 첫 화면이 418 '접속 제한' 으로 와도 같은 주소를 다시 열면(주소창 엔터) 풀림. F5(reload)는 잘 안 풀림
"""
import random
import re
import time
from urllib.parse import quote_plus

# 카드 하나 = 같은 상품 ID 링크만 담은 가장 큰 조상 요소. 그 innerText 를 줄 단위로 돌려줌.
_CARD_JS = r"""
({sel, idRe, scope}) => {
  const re = new RegExp(idRe, 'i');
  const root = scope ? (document.querySelector(scope) || document) : document;
  const idOf = a => { const m = (a.getAttribute('href') || '').match(re); return m ? m[1] : null; };
  const seen = new Set(), out = [];
  for (const a of root.querySelectorAll(sel)) {
    const id = idOf(a);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    let el = a;
    while (el.parentElement && el.parentElement !== root) {
      const ids = new Set([...el.parentElement.querySelectorAll(sel)].map(idOf).filter(Boolean));
      if (ids.size > 1) break;
      el = el.parentElement;
    }
    out.push({id, href: a.href, text: el.innerText || '', top: el.getBoundingClientRect().top + window.scrollY});
  }
  return out;
}
"""

_WON = re.compile(r"([\d,]+)\s*원")


def _lines(text):
    return [s.strip() for s in text.split("\n") if s.strip()]


def _after(lines, label):
    """'상품명' 같은 라벨 줄 다음 줄 값."""
    for i, s in enumerate(lines[:-1]):
        if s == label:
            return lines[i + 1]
    return ""


def _price(lines):
    """배송비·적립 앞쪽 금액 중 마지막 값 = 실제 판매가(할인가 우선)."""
    amounts = []
    for s in lines:
        if s.startswith("배송비") or "적립" in s or s.startswith("최대"):
            break
        for m in _WON.finditer(s):
            v = int(m.group(1).replace(",", "") or 0)
            if v > 0:
                amounts.append(v)
    return amounts[-1] if amounts else None


class Platform:
    key = ""
    name = ""
    link_sel = ""
    id_re = ""
    scope = None
    referer = None

    def prepare(self, page):
        """순찰 전 준비. 건너뛸 이유가 있으면 문자열 반환."""
        return ""

    def ready(self, page):
        """검색 결과(상품)가 화면에 떴는지."""
        return page.locator(self.link_sel).count() > 0

    def search_url(self, keyword, page):
        raise NotImplementedError

    def item_url(self, item_id):
        raise NotImplementedError

    def parse_card(self, card):
        lines = _lines(card["text"])
        title = _after(lines, "상품명") or (lines[0] if lines else "")
        seller = _after(lines, "판매자") or _after(lines, "스토어명")
        if seller.startswith("판매자"):  # 판매자명 없이 '판매자평가정보' 라벨이 바로 오는 카드
            seller = ""
        return {
            "id": card["id"],
            "url": self.item_url(card["id"]),
            "title": title,
            "price": _price(lines),
            "seller": seller,
            "ad": any(s in ("광고", "AD") for s in lines[:4]),
        }

    def extract(self, page):
        cards = page.evaluate(_CARD_JS, {"sel": self.link_sel, "idRe": self.id_re, "scope": self.scope})
        return [self.parse_card(c) for c in cards]

    def state(self, page):
        """ok / bot_check / blocked / empty"""
        title = (page.title() or "").strip()
        try:
            body = page.inner_text("body", timeout=5000)[:3000]
        except Exception:
            body = ""
        if ("잠시만 기다리십시오" in title or "Just a moment" in title or "봇 확인 절차" in body
                or page.locator("iframe[src*='challenges.cloudflare.com']").count()):
            return "bot_check"
        if any(s in body for s in ("접근이 차단", "비정상적인 접근", "Access Denied", "일시적으로 제한")):
            return "blocked"
        if any(s in body for s in ("검색결과가 없습니다", "검색 결과가 없습니다", "찾으시는 상품이 없습니다")):
            return "empty"
        return "ok"


class Gmarket(Platform):
    key, name = "gmarket", "지마켓"
    link_sel = "a[href*='goodscode=' i]"
    id_re = r"goodscode=(\w+)"

    def search_url(self, keyword, page):
        return f"https://www.gmarket.co.kr/n/search?keyword={quote_plus(keyword)}&s=3&p={page}"

    def item_url(self, item_id):
        return f"https://item.gmarket.co.kr/Item?goodscode={item_id}"


class Auction(Platform):
    key, name = "auction", "옥션"
    link_sel = "a[href*='itemno=' i]"
    id_re = r"itemno=(\w+)"

    def search_url(self, keyword, page):
        return f"https://www.auction.co.kr/n/search?keyword={quote_plus(keyword)}&s=3&p={page}"

    def item_url(self, item_id):
        return f"https://itempage3.auction.co.kr/DetailView.aspx?itemno={item_id}"


class Elevenst(Platform):
    key, name = "11st", "11번가"
    link_sel = "a[href*='/products/']"
    id_re = r"/products/(\d+)"

    def search_url(self, keyword, page):
        return (f"https://search.11st.co.kr/pc/total-search?kwd={quote_plus(keyword)}"
                f"&tabId=TOTAL_SEARCH&sortCd=N&pageNo={page}")

    def item_url(self, item_id):
        return f"https://www.11st.co.kr/products/{item_id}"

    def extract(self, page):
        # 상단 광고·추천 블록은 정렬과 무관 → 카드 텍스트에 '상품명' 라벨이 있는 본 목록만
        items = super().extract(page)
        return [it for it in items if it["title"] and it["price"]]


def naver_logged_in(ctx):
    return any(c["name"] == "NID_AUT" for c in ctx.cookies("https://www.naver.com"))


class Smartstore(Platform):
    """네이버 쇼핑 검색 (최신순). 스마트스토어 상품만 남김.
    로그인 없이 검색 주소로 바로 들어가면 418 → 로그인한 프로필로 네이버 → 쇼핑 → 검색 순서로 진입."""
    key, name = "smartstore", "스마트스토어"
    link_sel = "a[href*='smartstore.naver.com'], a[href*='brand.naver.com'], a[href*='/catalog/']"
    id_re = r"/products/(\d+)"
    referer = "https://shopping.naver.com/"

    def prepare(self, page):
        if not naver_logged_in(page.context):
            return "네이버 로그인 필요 (run_patrol.bat --login)"
        for url in ("https://www.naver.com/", "https://shopping.naver.com/"):
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
            time.sleep(random.uniform(3, 6))
            if self.state(page) == "blocked":
                return "네이버 쇼핑 접속 제한 화면"
        return ""

    def search_url(self, keyword, page):
        # productSet=checkout = '네이버페이' 탭 (스마트스토어 상품만)
        return (f"https://search.shopping.naver.com/search/all?query={quote_plus(keyword)}"
                f"&sort=date&pagingIndex={page}&pagingSize=40&productSet=checkout")

    def item_url(self, item_id):
        return ""

    def _list(self, page):
        return page.evaluate("""() => {
          try { return JSON.parse(document.querySelector('#__NEXT_DATA__').textContent)
                  .props.pageProps.compositeList.list.map(x => x.item || {}); } catch (e) { return []; } }""")

    def ready(self, page):
        return bool(self._list(page))

    def extract(self, page):
        # 카드 링크는 cr.shopping 중계 주소라, 페이지에 실린 상품 데이터(__NEXT_DATA__)에서 읽음
        raw = self._list(page)
        if not raw:  # 첫 페이지가 빈 목록으로 오는 경우가 있음 → 같은 주소로 다시 방문 (F5 말고)
            time.sleep(random.uniform(3, 5))
            page.goto(page.url, wait_until="domcontentloaded")
            time.sleep(4)
            raw = self._list(page)
        items = []
        for it in raw:
            url, store = it.get("mallProductUrl") or "", it.get("mallPcUrl") or ""
            if not any(s in url for s in ("smartstore.naver.com", "brand.naver.com")):
                continue
            pid = it.get("mallProductId") or ""
            if pid and re.match(r"https://(smartstore|brand)\.naver\.com/[^/]+$", store) and not store.endswith("/main"):
                url = f"{store}/products/{pid}"
            try:
                price = int(str(it.get("price") or it.get("lowPrice") or "").replace(",", "")) or None
            except ValueError:
                price = None
            items.append({"id": pid or it.get("id"), "url": url, "title": it.get("productTitle", ""),
                          "price": price, "seller": it.get("mallName", ""), "ad": bool(it.get("adId"))})
        return items


PLATFORMS = {p.key: p for p in (Gmarket(), Auction(), Smartstore(), Elevenst())}
ORDER = ["gmarket", "auction", "smartstore", "11st"]
