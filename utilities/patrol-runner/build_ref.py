r"""위반 확정 게시물 엑셀(BPM sell_info_list, 썸네일 삽입본) → 이미지 기준 DB.

  py -3.13 build_ref.py "…\sell_info_list_2026-10-27.xlsx"

엑셀 안 이미지(xl/media)와 행(drawing 앵커)을 이어 pHash·dHash 를 만들고,
행의 Product Url / Product Type / Model Type 을 함께 저장한다.
브랜드사 위반 자료라 결과 파일(ref_*.local.*)은 gitignore.
"""
import io
import json
import re
import sys
import time
import zipfile
from pathlib import Path

import imagehash
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT_HASH = HERE / "ref_hashes.local.npy"
OUT_META = HERE / "ref_meta.local.json"


def hash_pair(img):
    """pHash(주파수) + dHash(밝기 기울기) — 둘 다 가까워야 같은 사진으로 본다 (단순 흰 배경 사진 오탐 방지)."""
    img = img.convert("RGB")
    return int(str(imagehash.phash(img)), 16), int(str(imagehash.dhash(img)), 16)


def main():
    src = sys.argv[1]
    z = zipfile.ZipFile(src)
    rels = dict(re.findall(r'Id="(rId\d+)" Target="\.\./media/([^"]+)"',
                           z.read("xl/drawings/_rels/drawing1.xml.rels").decode()))
    drawing = z.read("xl/drawings/drawing1.xml").decode()
    # 앵커: <xdr:from>…<xdr:row>N</xdr:row>… <a:blip r:embed="rIdK"/>
    anchors = re.findall(r"<xdr:from>.*?<xdr:row>(\d+)</xdr:row>.*?r:embed=\"(rId\d+)\"", drawing, re.S)
    sheet = z.read("xl/worksheets/sheet1.xml").decode()
    rows = {}
    for r, body in re.findall(r'<row r="(\d+)"[^>]*>(.*?)</row>', sheet, re.S):
        cells = dict(re.findall(r'<c r="([A-Z]+)\d+"[^>]*>(?:<is><t>(.*?)</t></is>)?', body))
        rows[int(r)] = cells
    hashes, meta, t0 = [], [], time.time()
    for i, (row0, rid) in enumerate(anchors):
        row = rows.get(int(row0) + 1, {})  # 앵커 row 는 0부터
        url = (row.get("B") or "").replace("&amp;", "&")
        try:
            img = Image.open(io.BytesIO(z.read("xl/media/" + rels[rid])))
            hashes.append(hash_pair(img))
        except Exception:
            continue
        dom = re.sub(r"^https?://(www\.)?", "", url).split("/")[0]
        meta.append({"model_type": row.get("D") or "", "product_type": row.get("C") or "", "domain": dom, "url": url})
        if (i + 1) % 5000 == 0:
            print(f"  {i + 1}/{len(anchors)}  {time.time() - t0:.0f}s", flush=True)
    np.save(OUT_HASH, np.array(hashes, dtype=np.uint64))  # (N, 2) = pHash, dHash
    OUT_META.write_text(json.dumps({"source": Path(src).name, "items": meta}, ensure_ascii=False), encoding="utf-8")
    print(f"{len(hashes)} images → {OUT_HASH.name}, {OUT_META.name}  ({time.time() - t0:.0f}s)")


if __name__ == "__main__":
    main()
