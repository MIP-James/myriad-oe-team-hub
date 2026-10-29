"""팀 허브 '자동 수집 결과' 업로드 (mig 040, /api/auto-collect-upload).

인증 = 이 PC 런처의 기기 토큰(myrlnch_…) 재사용 — 런처 config.json 에서 읽거나 설정의 "hub.token".
업로드 실패해도 엑셀 저장은 이미 끝난 뒤라 결과는 남는다.
응답의 excluded_hashes(실무자가 '제외'한 사진 지문)는 로컬에 저장 → 다음 자동 수집에서 같은 사진 자동 제외.
review_hashes('상세 확인 필요' 사진 지문, mig 041)도 저장 → 같은 사진은 빼지 않고 review_match 로 표시(허브 빨간 테두리).
handled(판정한 상품번호: 제외·상세 확인·BPM 전송 완료)는 누적 저장 → 판정 없이 KEEP_DAYS 가 지나 허브에서 지워진
상품만 다시 올림 (patrol.scan). 'BPM 전송 완료' 행은 허브에서 7일 뒤 지워지므로 노트북이 계속 기억해야 함.
sent_hashes('BPM 전송 완료' 사진 지문)는 누적 저장 → 이 사진과 같은 사진은 '제외' 사진과 겹쳐도 자동 제외 안 함
(허브의 전송 완료 행은 7일 뒤 지워지므로 노트북이 계속 기억, 2026-10-29).
목록은 수집 시작 전에 fetch_judged(GET)로 먼저 받음 → 어제 판정이 오늘 등급에 바로 반영 (업로드 응답만 쓰면 하루 늦음).
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXCLUDED = HERE / "excluded_hashes.local.json"
REVIEW = HERE / "review_hashes.local.json"
HANDLED = Path(os.environ.get("LOCALAPPDATA", HERE)) / "MyriadPatrol" / "handled.json"  # {플랫폼명: [상품번호]}
SENT = HANDLED.parent / "sent_hashes.json"  # BPM 전송 완료 사진 지문 (누적)
KEEP_DAYS = 7  # 허브 보관 기간 (functions/api/auto-collect-upload.js 의 KEEP_DAYS 와 같게)
DEFAULT_URL = "https://myriad-oe-team-hub.pages.dev"
_LAUNCHER_CONFIGS = [
    Path(os.environ.get("USERPROFILE", "")) / "Downloads" / "MyriadLauncher" / "config.json",
    Path(os.environ.get("LOCALAPPDATA", "")) / "MyriadLauncher" / "config.json",
    Path(os.environ.get("USERPROFILE", "")) / "Desktop" / "MyriadLauncher" / "config.json",
]


def _token(cfg):
    if cfg.get("token"):
        return cfg["token"], cfg.get("url") or DEFAULT_URL
    paths = [Path(cfg["launcher_config"])] if cfg.get("launcher_config") else []
    for p in paths + _LAUNCHER_CONFIGS:
        try:
            c = json.loads(p.read_text(encoding="utf-8"))
            if str(c.get("api_token", "")).startswith("myrlnch_"):
                return c["api_token"], cfg.get("url") or c.get("api_base_url") or DEFAULT_URL
        except (OSError, ValueError):
            continue
    return None, None


def _row(r, product_type_of):
    return {
        "platform": r.get("platform"), "product_id": r.get("id"), "url": r.get("url"),
        "title": r.get("title"), "price": r.get("price"), "seller": r.get("seller"),
        "image": r.get("image"), "img_hash": r.get("img_hash"), "keyword": r.get("keyword"),
        "model_type": r.get("model_type"), "product_type": product_type_of(r.get("model_type")),
        "tier": r.get("tier"), "score": r.get("score"), "reasons": r.get("reasons"),
        "img_dist": r.get("img_dist"), "review_match": bool(r.get("review_match")),
    }


def recently_registered(seen, platforms, bpm_index, days=30):
    """최근 days 일 안에 본 상품 중 지금 BPM 에 등록된 것 → [{platform, product_id}]."""
    if bpm_index is None:
        return []
    since = (datetime.now() - timedelta(days=days)).strftime("%Y-%m-%d")
    out = []
    for key, ids in seen.items():
        name = platforms[key].name if key in platforms else None
        if not name:
            continue
        for pid, day in ids.items():
            if day >= since and (name, str(pid).upper()) in bpm_index.ids:
                out.append({"platform": name, "product_id": pid})
    return out


def upload(cfg, rows, summary, started, finished, registered, product_type_of, log=print):
    token, url = _token(cfg or {})
    if not token:
        log("허브 업로드 건너뜀: 런처 토큰을 찾지 못함 (keywords.local.json 의 hub.token 또는 hub.launcher_config 지정)")
        return None
    counts = {}
    for r in rows:
        counts[r.get("tier")] = counts.get(r.get("tier"), 0) + 1
    body = {
        "run": {"started_at": started.astimezone().isoformat(), "finished_at": finished.astimezone().isoformat(),
                "counts": counts, "summary": summary},
        "items": [_row(r, product_type_of) for r in rows if r.get("tier")],
        "registered": registered,
    }
    res = _call(token, url, "업로드", log, body)
    if res is None:
        return None
    handled = _save_judged(res)
    log(f"허브 업로드: {res.get('upserted', 0)}건 (BPM 등록 표시 {res.get('registered', 0)}건, "
        f"제외 사진 {len(res.get('excluded_hashes') or [])}개 / 상세 확인 사진 {len(res.get('review_hashes') or [])}개 / "
        f"BPM 전송 사진 누적 {len(load_sent()):,}개 / 판정한 상품 누적 {handled:,}건)")
    return res


def fetch_judged(cfg, log=print):
    """수집 시작 전 최신 판정(제외·상세 확인 사진 지문, 판정한 상품번호)을 받아 로컬에 저장.
    실패하면 지난번 저장한 목록 그대로 씀 (수집은 계속)."""
    token, url = _token(cfg or {})
    if not token:
        return None
    res = _call(token, url, "판정 목록 받기", log)
    if res is None:
        log("  → 지난번 받은 판정 목록으로 진행")
        return None
    handled = _save_judged(res)
    log(f"허브 최신 판정 받음: 제외 사진 {len(res.get('excluded_hashes') or [])}개 / "
        f"상세 확인 사진 {len(res.get('review_hashes') or [])}개 / BPM 전송 사진 누적 {len(load_sent()):,}개 / "
        f"판정한 상품 누적 {handled:,}건")
    return res


def _call(token, url, what, log, body=None):
    """body 있으면 POST(업로드), 없으면 GET(판정 목록). 실패 시 None."""
    req = urllib.request.Request(url.rstrip("/") + "/api/auto-collect-upload",
                                 data=json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None,
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}",
                                          # Cloudflare 가 기본 Python-urllib 표시를 1010 으로 차단
                                          "User-Agent": "MyriadAutoCollect/1.0"},
                                 method="POST" if body is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        log(f"⚠ 허브 {what} 실패 ({e.code}): {e.read()[:300].decode('utf-8', 'replace')}")
    except Exception as e:
        log(f"⚠ 허브 {what} 실패: {e}")
    return None


def _save_judged(res):
    """응답의 제외·상세 확인 사진 지문은 덮어쓰고, BPM 전송 사진 지문·판정한 상품번호는 누적 → 판정 누적 건수"""
    EXCLUDED.write_text(json.dumps(res.get("excluded_hashes") or []), encoding="utf-8")
    REVIEW.write_text(json.dumps(res.get("review_hashes") or []), encoding="utf-8")
    HANDLED.parent.mkdir(parents=True, exist_ok=True)
    sent = set(_read_json(SENT, []))
    sent.update(h for h in res.get("sent_hashes") or [] if h)
    SENT.write_text(json.dumps(sorted(sent)), encoding="utf-8")
    handled = load_handled()
    for h in res.get("handled") or []:
        if h.get("platform") and h.get("product_id"):
            handled.setdefault(h["platform"], set()).add(str(h["product_id"]))
    HANDLED.write_text(json.dumps({k: sorted(v) for k, v in handled.items()}, ensure_ascii=False), encoding="utf-8")
    return sum(len(v) for v in handled.values())


def _read_json(path, default):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _load_hashes(path):
    try:
        return [(int(h[:16], 16), int(h[16:32], 16)) for h in json.loads(path.read_text(encoding="utf-8")) if len(h) >= 32]
    except (OSError, ValueError):
        return []


def load_handled():
    """판정한 상품번호 → {플랫폼명: {상품번호}}"""
    try:
        return {k: set(map(str, v)) for k, v in json.loads(HANDLED.read_text(encoding="utf-8")).items()}
    except (OSError, ValueError):
        return {}


def load_excluded():
    """실무자 '제외' 사진 지문 → [(pHash, dHash)]"""
    return _load_hashes(EXCLUDED)


def load_review():
    """실무자 '상세 확인 필요' 사진 지문 → [(pHash, dHash)]"""
    return _load_hashes(REVIEW)


def load_sent():
    """실무자 'BPM 전송 완료' 사진 지문(누적) → [(pHash, dHash)]"""
    return _load_hashes(SENT)
