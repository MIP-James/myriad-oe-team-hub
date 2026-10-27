"""맥세이프 케이스 카메라 홀 모양 판정 — 정사각형 홀(대상) vs 그 외(16·17·Air 등, 대상 아님).

썸네일 → DINOv2(small, 448px, CPU) 특징(CLS+패치 평균) → 로지스틱 회귀 2단계:
  1단계 판단 가능?(아이폰 케이스 뒷면이 보이나) / 2단계 정사각 홀?
학습 = 수동 정답 400장(2026-10-27, S 201 / O 56 / X 143). 교차검증: 1단계 85%, 2단계 84%,
확신 70% 이상만 자동 판정 시 44% 를 95.6% 정확도로 판정. 결과 파일 camera_clf.local.npz.
판정 기준(사용자 확정 2026-10-27): 맥세이프 케이스만 정사각 홀이 대상. 실리콘 등 다른 케이스엔 적용 안 함.
"""
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
CLF = HERE / "camera_clf.local.npz"
SIZE = 448  # 카메라 홀이 썸네일에서 작아 224 보다 448 이 2단계 +3%p
CONFIDENT = 0.7
_MODEL = None


def _model():
    global _MODEL
    if _MODEL is None:
        import timm
        import torch
        torch.set_num_threads(max(1, (torch.get_num_threads() or 2)))
        _MODEL = timm.create_model("vit_small_patch14_dinov2.lvd142m", pretrained=True, num_classes=0,
                                   img_size=SIZE).eval()
    return _MODEL


def _prep(img):
    """흰 배경 정사각 패딩 → 224 → 정규화."""
    img = img.convert("RGB")
    s = max(img.size)
    canvas = Image.new("RGB", (s, s), "white")
    canvas.paste(img, ((s - img.width) // 2, (s - img.height) // 2))
    a = np.asarray(canvas.resize((SIZE, SIZE), Image.BICUBIC), dtype=np.float32) / 255.0
    a = (a - (0.485, 0.456, 0.406)) / (0.229, 0.224, 0.225)
    return a.transpose(2, 0, 1)


def embed(images, batch=16):
    """PIL 이미지 목록 → (N, 768) 특징 = CLS + 패치 평균 (L2 정규화)."""
    import torch
    out = []
    m = _model()
    for i in range(0, len(images), batch):
        x = torch.from_numpy(np.stack([_prep(im) for im in images[i:i + batch]]).astype(np.float32))
        with torch.no_grad():
            t = m.forward_features(x)
        out.append(torch.cat([t[:, 0], t[:, m.num_prefix_tokens:].mean(1)], 1).numpy())
    f = np.concatenate(out) if out else np.zeros((0, 768), np.float32)
    return f / np.linalg.norm(f, axis=1, keepdims=True).clip(1e-6)


class Classifier:
    def __init__(self, w1, b1, w2, b2):
        self.w1, self.b1, self.w2, self.b2 = w1, b1, w2, b2

    @classmethod
    def load(cls, path=CLF):
        try:
            d = np.load(path)
            return cls(d["w1"], float(d["b1"]), d["w2"], float(d["b2"]))
        except FileNotFoundError:
            return None

    def predict(self, feats):
        """(판단 가능 확률, 정사각 확률)"""
        sig = lambda z: 1 / (1 + np.exp(-z))
        return sig(feats @ self.w1 + self.b1), sig(feats @ self.w2 + self.b2)


def annotate(rows, fetch_bytes, clf=None):
    """맥세이프 케이스 행에 cam_judge(판단 가능 확률)·cam_square(정사각 확률)를 채운다. 이미지 못 받으면 None."""
    clf = clf or Classifier.load()
    targets = [r for r in rows if r.get("model_type") == "MagSafe iPhone case" and r.get("image")]
    if not clf or not targets:
        return rows
    imgs, keep = [], []
    for r in targets:
        data = fetch_bytes(r["image"])
        if data:
            try:
                imgs.append(Image.open(io.BytesIO(data)))
                keep.append(r)
                continue
            except Exception:
                pass
        r["cam_judge"] = r["cam_square"] = None
    if imgs:
        pj, ps = clf.predict(embed(imgs))
        for r, a, b in zip(keep, pj, ps):
            r["cam_judge"], r["cam_square"] = float(a), float(b)
    return rows


def train_from_labels(items):
    """items = [{"file": 경로, "label": "S"|"O"|"X"}] → 2단계 분류기 저장."""
    from sklearn.linear_model import LogisticRegression
    feats = embed([Image.open(it["file"]).convert("RGB") for it in items])
    lab = np.array([it["label"] for it in items])
    j = lab != "X"
    m1 = LogisticRegression(max_iter=4000, class_weight="balanced").fit(feats, j)
    m2 = LogisticRegression(max_iter=4000, class_weight="balanced").fit(feats[j], lab[j] == "S")
    np.savez(CLF, w1=m1.coef_[0].astype(np.float32), b1=np.float32(m1.intercept_[0]),
             w2=m2.coef_[0].astype(np.float32), b2=np.float32(m2.intercept_[0]))
    return int(j.sum()), int((lab == "S").sum())


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "train":
    import json
    items = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    print("학습 완료 (판단 가능 %d / 정사각 %d)" % train_from_labels(items))
