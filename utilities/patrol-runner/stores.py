"""지마켓 '판매자 매장 순회' — BPM 위반 확정 판매자의 미니샵에서 그 판매자가 위반했던 유형만 매장 안 검색.

지마켓은 사람이 주 2회 최신순 검색으로 모니터링 → 자동 수집 최신순 검색은 새로 찾는 게 적음 (10-30).
신고로 글 일부가 내려가도 같은 매장에 비슷한 상품이 그대로 남아 있음:
재침해자 5곳 매장 안 Apple 상품 615건 중 607건이 BPM 미등록 (2026-10-30 실측).
- 대상 = BPM 위반 확정(INF)이 최근 recent_days 안에 있고 누적 min~max_violations 건인 판매자
  (max 초과 = 신세계몰·CJ온스타일 같은 대형몰 → 매장이 너무 크고 성격이 다름)
- 판매자마다 interval_days 주기, 최근 위반 많은 순으로 하루 per_day 곳
- 매장 안 검색 = minishop.gmarket.co.kr/{아이디}/List?keyword=..&page=N&pageSize=60 (인기순 고정, Cloudflare 확인 없음)
- 검색어 = 그 판매자의 위반 Model Type → TERMS (설정 "stores.terms" 로 덮어씀)
상태 = %LOCALAPPDATA%\\MyriadPatrol\\stores.json {판매자 아이디: 마지막으로 본 날}
"""
import json
import time
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote

import bpm

DEFAULTS = {
    "enabled": True,
    "recent_days": 90,
    "min_violations": 2,
    "max_violations": 300,
    "exclude": [],           # 판매자 아이디 — 순회에서 뺄 곳
    "max_types": 3,          # 판매자당 위반 많은 Model Type 몇 개까지
    "interval_days": 3,      # 주 2회
    "per_day": 30,
    "max_pages": 5,          # 검색어 하나당 (60건 × 5)
    "max_minutes": 40,
    "terms": {},             # {"Model Type": ["매장 검색어", ...]}
}

# 매장 안 검색은 긴 문구면 잘 안 잡혀서 짧게 ('맥세이프 케이스' 0건 / '맥세이프' 1건, 10-30 실측).
# 상품명에 없어도 상세·태그로 걸리는 잡음은 triage 관련도 점수가 거름. 없는 유형은 설정 키워드 그대로 씀
TERMS = {
    "MagSafe iPhone case": ["맥세이프"],
    "MagSafe Converter": ["맥세이프", "맥북 충전기"],
    "MagSafe iPhone charger": ["맥세이프"],
    "Apple Watch Band": ["애플워치", "애플 워치"],
    "Apple Watch Charging Cable": ["애플워치", "애플 워치"],
    "Apple Watch Unspecified": ["애플워치", "애플 워치"],
    "iPhone Case/Bumper": ["실리콘 케이스"],
    "Earpods": ["이어팟", "유선 이어폰"],
    "AirPods Pro": ["에어팟"],
    "AirPods (1st-4th Gen)": ["에어팟"],
    "AirPods Max": ["에어팟 맥스"],
    "Lightning Cable": ["8핀", "라이트닝"],
    "Lightning Adapter": ["8핀", "라이트닝"],
    "30-Pin": ["30핀"],
    "MacBook/Mac Unspecified": ["맥북", "아이맥"],
}

# 홈쇼핑·대형몰 채널 = 여러 공급사 상품이 한 매장에 모임 → 재침해자 매장이 아님 (설정 triage.channel_sellers 와 합침)
CHANNELS = ["홈앤쇼핑", "hnsmall", "hnsmec", "쇼핑엔티", "shpnt", "sk스토아", "skstoa", "nsmall", "ns홈쇼핑",
            "공영쇼핑", "gongyoung", "kshop", "gs_shop", "gsshop", "hmall", "ssgmall", "cjmall", "lotteon"]

LIST_URL = "https://minishop.gmarket.co.kr/{seller}/List?keyword={kw}&page={page}&pageSize=60"
PAGE_SIZE = 60

_CARDS_JS = r"""
() => [...document.querySelectorAll("a.link__item[href*='goodscode' i]")].map(a => {
  const m = (a.getAttribute('href') || '').match(/goodscode=(\w+)/i);
  const img = a.querySelector('img');
  const price = a.querySelector('.box__price .text__value');
  return {id: m ? m[1] : null,
          title: ((a.querySelector('.text__name') || {}).innerText || (img && img.alt) || '').trim(),
          price: price ? price.innerText : '',
          img: img ? (img.getAttribute('data-original') || img.getAttribute('src') || '') : ''};
}).filter(c => c.id)
"""


def _load(path, default):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _day(ms):
    return datetime.fromtimestamp((ms or 0) / 1000).strftime("%Y-%m-%d")


class Stores:
    def __init__(self, cfg, keywords, state_path, today, channels=()):
        self.cfg = {**DEFAULTS, **(cfg or {})}
        self.channels = [c.lower() for c in [*CHANNELS, *channels] if c]
        self.path = Path(state_path)
        self.today = today
        self.last = _load(self.path, {})
        self.kw_of = {}  # Model Type → 판정·등급에 쓸 설정 키워드(제외어·가격 상한)
        for kw in keywords:
            self.kw_of.setdefault(kw.get("model_type"), kw)

    @property
    def enabled(self):
        return bool(self.cfg["enabled"])

    def terms(self, model_type):
        t = self.cfg["terms"].get(model_type) or TERMS.get(model_type)
        if t:
            return t
        kw = self.kw_of.get(model_type)
        return [kw["keyword"]] if kw else []

    def todays(self, cache):
        """오늘 볼 판매자 [{seller, name, model_types, recent}] — 최근 위반 많은 순."""
        since = (date.fromisoformat(self.today) - timedelta(days=self.cfg["recent_days"])).isoformat()
        by = defaultdict(list)
        for it in (cache or {}).get("items", {}).values():
            if it.get("confStatusCd") != "INF" or bpm.platform_key(it.get("productUrl"))[0] != "지마켓":
                continue
            acc = (it.get("sellerAccount") or "").strip()
            if acc and "minishop.gmarket.co.kr" in (it.get("storeUrl") or "minishop.gmarket.co.kr"):
                by[acc].append(it)
        out = []
        skip = {s.lower() for s in self.cfg["exclude"]}
        for acc, v in by.items():
            recent = sum(1 for it in v if _day(it.get("collectDt")) >= since)
            name = v[0].get("storeName") or acc
            if (not recent or acc.lower() in skip
                    or any(c in f"{acc} {name}".lower() for c in self.channels)
                    or not self.cfg["min_violations"] <= len(v) <= self.cfg["max_violations"]):
                continue
            last = self.last.get(acc)
            if last and (date.fromisoformat(self.today) - date.fromisoformat(last)).days < self.cfg["interval_days"]:
                continue
            types = [m for m, _ in Counter(it.get("modelTypeName") for it in v).most_common()
                     if m in self.kw_of][: self.cfg["max_types"]]
            if types:
                out.append({"seller": acc, "name": name, "model_types": types,
                            "recent": recent, "total": len(v)})
        out.sort(key=lambda s: (-s["recent"], -s["total"]))
        return out[: self.cfg["per_day"]]

    def mark(self, seller):
        self.last[seller] = self.today

    def save(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = Path(str(self.path) + ".tmp")
        tmp.write_text(json.dumps(self.last, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(self.path)


def search(page, seller, term, max_pages, log, pause):
    """매장 안 검색 → 카드 [{id, title, price, img}] (중복 제거). 결과 끝·같은 페이지 반복이면 멈춤."""
    seen, out = set(), []
    for n in range(1, max_pages + 1):
        url = LIST_URL.format(seller=seller, kw=quote(term), page=n)
        try:
            page.goto(url, wait_until="domcontentloaded", timeout=45000)
        except Exception as e:
            log(f"  ⚠ 매장 {seller} '{term}' {n}페이지 열기 실패: {e}")
            break
        time.sleep(1.5)
        cards = page.evaluate(_CARDS_JS)
        fresh = [c for c in cards if c["id"].upper() not in seen]
        for c in fresh:
            seen.add(c["id"].upper())
        out += fresh
        if len(cards) < PAGE_SIZE or not fresh:
            break
        pause()
    return out


def to_item(card, platform, seller_name):
    price = "".join(ch for ch in card.get("price") or "" if ch.isdigit())
    img = card.get("img") or ""
    return {
        "id": card["id"],
        "url": platform.item_url(card["id"]),
        "title": card.get("title") or "",
        "price": int(price) if price else None,
        "seller": seller_name,
        "image": ("https:" + img) if img.startswith("//") else img,
        "ad": False,
    }
