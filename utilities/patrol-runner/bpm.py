"""BPM 연동 — 순찰 전에 BPM 의 브랜드 데이터를 받아 로컬 캐시(bpm_cache.local.json)로 둔다.

1. 등록 중복: BPM 에 이미 있는 게시물(상태 무관) → URL·상품번호로 X
2. 공식 판매처: client/list 의 officialSellers → X
3. 위반 이력 판매자: 위반 확정(INF) 게시물의 판매자 → 가점, A 근거
4. 기준 이미지 자동 갱신: 새 위반 확정 건의 대표 이미지 → 이미지 기준 DB 에 추가

첫 실행은 전체(연도별로 나눠 받음), 이후엔 updatedSince 로 바뀐 것만 받는다.
  py -3.13 bpm.py            # 수동 동기화 (순찰도 실행 시 자동으로 부름)
"""
import json
import re
import sys
import time
import urllib.request
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / "bpm_cache.local.json"
FIRST_YEAR = 2025  # 기준이 해마다 바뀌어 최근 것만 (사용자 결정 2026-10-27)
REFRESH_HOURS = 12
REF_ADD_LIMIT = 600  # 한 번에 기준 DB 에 더할 최대 이미지 수 (나머지는 다음 순찰 때)
REF_THREADS = 12     # 기준 이미지 동시 받기 수 (6 → 12, 2026-10-27 백로그 단축)
REPEAT_MIN = 3       # BPM 위반 확정이 이 건수 이상인 판매자 = 재침해자 (A 근거). 그 미만은 가점만

# URL 도메인 → 순찰 플랫폼명 / 상품번호 (BPM 중복 규칙 2번과 같은 추출 기준)
_PLATFORM_ID = [
    ("gmarket.co.kr", "지마켓", re.compile(r"goodscode=(\w+)", re.I)),
    ("auction.co.kr", "옥션", re.compile(r"itemno=(\w+)", re.I)),
    ("smartstore.naver.com", "스마트스토어", re.compile(r"/products/(\d+)")),
    ("brand.naver.com", "스마트스토어", re.compile(r"/products/(\d+)")),
    ("11st.co.kr", "11번가", re.compile(r"/products/(\d+)")),
]
_BPM_PLATFORM = {"gmarket": "지마켓", "auction": "옥션", "smartstore": "스마트스토어", "naver": "스마트스토어",
                 "11st": "11번가", "11번가": "11번가"}


def platform_key(url):
    """URL → (플랫폼명, 상품번호). 모르는 도메인이면 (None, None)."""
    u = url or ""
    for dom, name, rx in _PLATFORM_ID:
        if dom in u:
            m = rx.search(u)
            return name, (m.group(1).upper() if m else None)
    return None, None


def listing_key(url):
    """같은 게시물 판단용 키: 아는 플랫폼은 (플랫폼, 상품번호), 그 외는 정리한 URL."""
    plat, pid = platform_key(url)
    return (plat, pid) if plat and pid else norm_url(url)


def norm_url(url):
    u = re.sub(r"^https?://(www\.)?", "", (url or "").strip().lower())
    return u.split("?")[0].split("#")[0].rstrip("/")


def norm_name(s):
    return re.sub(r"\s+", "", (s or "").lower())


def _bpm_platform(name):
    n = (name or "").lower().replace(" ", "")
    return next((v for k, v in _BPM_PLATFORM.items() if k in n), None)


class Client:
    def __init__(self, cfg):
        self.host = cfg.get("host", "https://bpm-admin.myriadip.com").rstrip("/")
        self.secret = cfg["secret_key"]
        self.pub = cfg.get("public_api_key", "")
        self.client_id = cfg["client_id"]

    def post(self, path, body, pub=False, timeout=60):
        headers = {"Content-Type": "application/json"}
        if pub:
            headers["X-PUBLIC-API-KEY"] = self.pub
        req = urllib.request.Request(self.host + path, data=json.dumps({"secretKey": self.secret, **body}).encode(),
                                     headers=headers, method="POST")
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    data = json.loads(r.read())
                if data.get("code") == "E2050":  # 조회 시간 초과 → 호출부가 범위를 줄임
                    raise TimeoutError("E2050")
                return data
            except TimeoutError:
                raise
            except Exception:
                if attempt == 2:
                    raise
                time.sleep(3)

    def sell_info(self, from_date, to_date, updated_since=None):
        """sell-info/list 전체 페이지 (cursor). 시간 초과면 기간을 반으로 나눠 다시."""
        try:
            out, cur = [], None
            while True:
                body = {"clientId": self.client_id, "fromDate": from_date, "toDate": to_date,
                        "pageSize": 500, "includeTotal": False}
                if updated_since:
                    body["updatedSince"] = updated_since
                if cur:
                    body["cursor"] = cur
                d = self.post("/oms/ext/api/sell-info/list", body).get("data") or {}
                out += d.get("items") or []
                cur = d.get("nextCursor")
                if not cur:
                    return out
        except TimeoutError:
            a, b = datetime.fromisoformat(from_date), datetime.fromisoformat(to_date)
            if (b - a).days < 2:
                raise
            mid = a + (b - a) / 2
            return (self.sell_info(from_date, mid.strftime("%Y-%m-%d"), updated_since)
                    + self.sell_info((mid + timedelta(days=1)).strftime("%Y-%m-%d"), to_date, updated_since))

    def official_sellers(self):
        d = self.post("/oms/ext/api/client/list", {}, pub=True).get("data") or {}
        for c in d.get("items") or []:
            if c.get("id") == self.client_id:
                return c.get("officialSellers") or []
        return []

    def repr_thumbs(self, item_ids):
        """itemId → 대표 이미지(thumb) 서명 URL."""
        out = {}
        for i in range(0, len(item_ids), 100):
            d = self.post("/oms/ext/api/sell-info/media", {"itemIds": item_ids[i:i + 100], "kinds": ["repr"],
                                                            "variant": "thumb", "ttlMinutes": 60}, pub=True).get("data") or {}
            for it in d.get("items") or []:
                m = next((x for x in it.get("media") or [] if x.get("kind") == "repr"), None)
                if m:
                    out[it["itemId"]] = self.host + m["url"]
        return out


def _slim(it):
    return {k: it.get(k) for k in ("itemId", "confStatusCd", "productUrl", "platformName", "storeName",
                                   "sellerAccount", "storeUrl", "modelTypeName", "collectDt")}


def sync(cfg, log=print, force=False):
    """캐시를 최신으로 만들고 돌려준다. 실패하면 있던 캐시 그대로(순찰은 계속)."""
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {"items": {}, "last_sync": None}
    last = cache.get("last_sync")
    if last and not force and datetime.now() - datetime.fromisoformat(last) < timedelta(hours=REFRESH_HOURS):
        return cache
    try:
        cl = Client(cfg)
        started = datetime.now()
        today = started.strftime("%Y-%m-%d")
        if last:  # 바뀐 것만 (상태 변경 포함). 하루 겹치게 받아 경계 누락 방지
            since = (datetime.fromisoformat(last) - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S+09:00")
            rows = cl.sell_info(f"{FIRST_YEAR}-01-01", today, since)
        else:
            rows = []
            for y in range(FIRST_YEAR, started.year + 1):
                part = cl.sell_info(f"{y}-01-01", min(f"{y}-12-31", today))
                log(f"  BPM {y}년 {len(part):,}건")
                rows += part
        for it in rows:
            cache["items"][it["itemId"]] = _slim(it)
        cache["official"] = cl.official_sellers()
        cache["last_sync"] = started.isoformat(timespec="seconds")
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        log(f"BPM 동기화: {'변경' if last else '전체'} {len(rows):,}건 반영 (보관 {len(cache['items']):,}건, "
            f"공식 판매처 {len(cache['official'])}곳)")
    except Exception as e:
        log(f"⚠ BPM 동기화 실패 → 이전 캐시로 진행: {e}")
    return cache


class Index:
    """캐시 → 순찰 판정용 색인."""

    def __init__(self, cache):
        self.urls, self.ids = set(), set()
        self.violations = defaultdict(int)  # (플랫폼, 판매자명) → 위반 확정 건수
        for it in cache.get("items", {}).values():
            url = it.get("productUrl") or ""
            plat, pid = platform_key(url)
            if plat and pid:
                self.ids.add((plat, pid))
            else:  # 상품번호를 모르는 플랫폼만 URL 로 (지마켓·옥션은 상품번호가 ? 뒤에 있어 URL 비교 불가)
                self.urls.add(norm_url(url))
            if it.get("confStatusCd") == "INF":
                plat = plat or _bpm_platform(it.get("platformName"))
                for name in {norm_name(it.get("storeName")), norm_name(it.get("sellerAccount"))}:
                    if plat and len(name) >= 2:
                        self.violations[(plat, name)] += 1
        self.official_names, self.official_urls = set(), set()
        for s in cache.get("official") or []:
            if s.get("storeName"):
                self.official_names.add(norm_name(s["storeName"]))
            if s.get("url"):
                self.official_urls.add(norm_url(s["url"]))

    def registered(self, url):
        plat, pid = platform_key(url)
        if plat and pid:
            return (plat, pid) in self.ids
        return norm_url(url) in self.urls

    def official(self, seller, url):
        n = norm_name(seller)
        u = norm_url(url)
        return (len(n) >= 2 and n in self.official_names) or any(o and u.startswith(o) for o in self.official_urls)

    def violation_count(self, platform, seller):
        n = norm_name(seller)
        return self.violations.get((platform, n), 0) if len(n) >= 2 else 0


def update_ref_images(cfg, cache, log=print, limit=REF_ADD_LIMIT, skip=None):
    """기준 이미지 DB 에 없는 위반 확정 건의 대표 이미지를 받아 추가. 시도한 itemId 목록을 돌려준다."""
    import numpy as np
    import imgsim
    db = imgsim.RefDB.load()
    if db is None:
        return []
    skip = skip or set()
    have_ids = {m.get("item_id") for m in db.meta if m.get("item_id")}
    have_keys = {listing_key(m.get("url")) for m in db.meta if m.get("url")}
    todo = [it for it in cache.get("items", {}).values()
            if it.get("confStatusCd") == "INF" and it["itemId"] not in have_ids and it["itemId"] not in skip
            and listing_key(it.get("productUrl")) not in have_keys]
    todo.sort(key=lambda it: it.get("collectDt") or 0, reverse=True)
    todo = todo[:limit]
    if not todo:
        return []
    try:
        urls = Client(cfg).repr_thumbs([it["itemId"] for it in todo])
    except Exception as e:
        log(f"⚠ 기준 이미지 갱신 실패: {e}")
        return []
    rows = [{"image": urls.get(it["itemId"]), "_it": it} for it in todo if urls.get(it["itemId"])]
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(REF_THREADS) as ex:
        hashes = list(ex.map(lambda r: imgsim.fetch_hash(r["image"], timeout=30), rows))
    add_h, add_m = [], []
    for r, hv in zip(rows, hashes):
        if hv is None:
            continue
        it = r["_it"]
        add_h.append(hv)
        add_m.append({"model_type": it.get("modelTypeName") or "", "product_type": "", "item_id": it["itemId"],
                      "domain": re.sub(r"^https?://(www\.)?", "", it.get("productUrl") or "").split("/")[0],
                      "url": it.get("productUrl") or ""})
    if add_h:
        imgsim.RefDB(np.vstack([db.h, np.array(add_h, dtype=np.uint64)]), db.meta + add_m).save()
    log(f"기준 이미지 +{len(add_h)}건 (위반 확정 신규, 총 {len(db.meta) + len(add_m):,}건)")
    return [it["itemId"] for it in todo]


def main():
    cfg = json.loads((HERE / "keywords.local.json").read_text(encoding="utf-8"))["bpm"]
    cache = sync(cfg, force="--force" in sys.argv)
    if "--backfill" in sys.argv:  # 밀린 기준 이미지 전부 (1,000건씩 저장하며 반복, 중간에 끊겨도 이어서 가능)
        tried, t0 = set(), time.time()
        while True:
            got = update_ref_images(cfg, cache, limit=1000, skip=tried)
            if not got:
                break
            tried.update(got)
            print(f"  누적 시도 {len(tried):,}건, {(time.time() - t0) / 60:.0f}분", flush=True)
        print("백로그 완료", flush=True)
    else:
        update_ref_images(cfg, cache)


if __name__ == "__main__":
    main()
