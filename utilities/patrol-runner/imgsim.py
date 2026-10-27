"""썸네일 ↔ 위반 확정 이미지 DB(pHash) 비교.

가장 가까운 기준 이미지와의 해밍 거리(0 = 사실상 같은 사진, 64 = 정반대)와
그 기준 이미지의 Model Type 을 돌려준다. 기준 DB 는 build_ref.py 로 만든다.
"""
import io
import json
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36"
REFERER = {"gmarket": "https://www.gmarket.co.kr/", "auction": "https://www.auction.co.kr/",
           "pstatic": "https://search.shopping.naver.com/", "011st": "https://www.11st.co.kr/"}


# 키워드의 예상 Model Type → 비교할 위반 확정 이미지의 Model Type 묶음 (다른 묶음과의 우연한 닮음 배제)
FAMILIES = [
    {"MagSafe iPhone case", "iPhone Case/Bumper"},
    {"Apple Watch Band"},
    {"Earpods"},
    {"AirPods Pro", "AirPods (1st or 2nd Gen)", "AirPods 3rd Gen", "AirPods 4th Gen", "AirPods (1st-4th Gen)"},
    {"AirPods Max"},
    {"MagSafe Converter"},
    {"Lightning Cable", "Lightning Adapter", "Lightning Case/Dock"},
    {"Apple Watch Unspecified"},
    {"MagSafe iPhone charger", "MagSafe Battery Pack"},
    {"Apple Watch Charging Cable"},
    {"30-Pin"},
    {"MacBook Unspecified", "Mac Unspecified", "MacBook/Mac Unspecified", "iPad Unspecified", "iPhone Unspecified"},
]


def family(model_type):
    return next((f for f in FAMILIES if model_type in f), None)


class RefDB:
    def __init__(self, hashes, meta):
        self.h = hashes
        self.meta = meta
        self._masks = {}

    @classmethod
    def load(cls, folder=HERE):
        try:
            h = np.load(Path(folder) / "ref_hashes.local.npy")
            meta = json.loads((Path(folder) / "ref_meta.local.json").read_text(encoding="utf-8"))["items"]
        except FileNotFoundError:
            return None
        return cls(h, meta)

    def nearest(self, hv, model_types=None):
        """hv = (pHash, dHash). 거리 = 두 해시 거리 중 큰 값. model_types 를 주면 그 Model Type 기준 이미지만 비교."""
        d = np.maximum(np.bitwise_count(self.h[:, 0] ^ np.uint64(hv[0])),
                       np.bitwise_count(self.h[:, 1] ^ np.uint64(hv[1])))
        if model_types:
            d = np.where(self.mask(model_types), d, 99)
        i = int(d.argmin())
        return int(d[i]), self.meta[i]

    def save(self, folder=HERE):
        np.save(Path(folder) / "ref_hashes.local.npy", self.h)
        meta_path = Path(folder) / "ref_meta.local.json"
        old = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        meta_path.write_text(json.dumps({**old, "items": self.meta}, ensure_ascii=False), encoding="utf-8")

    def mask(self, model_types):
        key = tuple(sorted(model_types))
        if key not in self._masks:
            self._masks[key] = np.array([m["model_type"] in model_types for m in self.meta])
        return self._masks[key]


def fetch_bytes(url, timeout=10):
    if not url:
        return None
    ref = next((v for k, v in REFERER.items() if k in url), None)
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Referer": ref} if ref else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception:
        return None


def fetch_hash(url, timeout=10):
    if not url:
        return None
    ref = next((v for k, v in REFERER.items() if k in url), None)
    req = urllib.request.Request(url, headers={"User-Agent": UA, **({"Referer": ref} if ref else {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            img = Image.open(io.BytesIO(r.read())).convert("RGB")
            return int(str(imagehash.phash(img)), 16), int(str(imagehash.dhash(img)), 16)
    except Exception:
        return None


def annotate(rows, db, workers=8):
    """rows 에 img_dist / img_model 을 채운다 (이미지 못 받으면 None)."""
    with ThreadPoolExecutor(workers) as ex:
        hashes = list(ex.map(lambda r: fetch_hash(r.get("image")), rows))
    for r, hv in zip(rows, hashes):
        if hv is None:
            r["img_dist"], r["img_model"] = None, ""
        else:
            r["img_dist"], m = db.nearest(hv, family(r.get("model_type", "")))
            r["img_model"] = m["model_type"]
    return rows
