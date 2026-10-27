"""팀 허브 '자동 수집 결과' 업로드 (mig 040, /api/auto-collect-upload).

인증 = 이 PC 런처의 기기 토큰(myrlnch_…) 재사용 — 런처 config.json 에서 읽거나 설정의 "hub.token".
업로드 실패해도 엑셀 저장은 이미 끝난 뒤라 결과는 남는다.
응답의 excluded_hashes(실무자가 '제외'한 사진 지문)는 로컬에 저장 → 다음 자동 수집에서 같은 사진 자동 제외.
review_hashes('상세 확인 필요' 사진 지문, mig 041)도 저장 → 같은 사진은 빼지 않고 review_match 로 표시(허브 빨간 테두리).
"""
import json
import os
import urllib.request
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXCLUDED = HERE / "excluded_hashes.local.json"
REVIEW = HERE / "review_hashes.local.json"
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
    req = urllib.request.Request(url.rstrip("/") + "/api/auto-collect-upload",
                                 data=json.dumps(body, ensure_ascii=False).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}",
                                          # Cloudflare 가 기본 Python-urllib 표시를 1010 으로 차단
                                          "User-Agent": "MyriadAutoCollect/1.0"},
                                 method="POST")
    try:
        with urllib.request.urlopen(req, timeout=180) as resp:
            res = json.loads(resp.read())
    except urllib.error.HTTPError as e:
        log(f"⚠ 허브 업로드 실패 ({e.code}): {e.read()[:300].decode('utf-8', 'replace')}")
        return None
    except Exception as e:
        log(f"⚠ 허브 업로드 실패: {e}")
        return None
    EXCLUDED.write_text(json.dumps(res.get("excluded_hashes") or []), encoding="utf-8")
    REVIEW.write_text(json.dumps(res.get("review_hashes") or []), encoding="utf-8")
    log(f"허브 업로드: {res.get('upserted', 0)}건 (BPM 등록 표시 {res.get('registered', 0)}건, "
        f"제외 사진 {len(res.get('excluded_hashes') or [])}개 / 상세 확인 사진 {len(res.get('review_hashes') or [])}개 받음)")
    return res


def _load_hashes(path):
    try:
        return [(int(h[:16], 16), int(h[16:32], 16)) for h in json.loads(path.read_text(encoding="utf-8")) if len(h) >= 32]
    except (OSError, ValueError):
        return []


def load_excluded():
    """실무자 '제외' 사진 지문 → [(pHash, dHash)]"""
    return _load_hashes(EXCLUDED)


def load_review():
    """실무자 '상세 확인 필요' 사진 지문 → [(pHash, dHash)]"""
    return _load_hashes(REVIEW)
