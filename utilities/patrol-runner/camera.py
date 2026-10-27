"""맥세이프 케이스 카메라 홀 모양 판정 — 정사각형 홀(대상) vs 그 외(16·17·Air 등, 대상 아님).

썸네일 → DINOv2(small, 448px, CPU) 특징(CLS+패치 평균) → 로지스틱 회귀 2단계:
  1단계 판단 가능?(아이폰 케이스 뒷면이 보이나) / 2단계 정사각 홀?
  3단계 수집 대상?(사용자 기준: 아무것도 안 묻은 깔끔한 투명 케이스 + 링 "O -" + 정사각 홀)
학습 = 수동 정답 400장(2026-10-27, S 199 / O 56 / X 145, 그중 수집 대상 21). 교차검증: 1단계 89%, 2단계 85%,
확신 70% 이상만 판정 시 45% 를 97.4%. 3단계는 순위용 — 대상 20/21 이 상위 15% 안, 점수 10% 미만 제외 시 25% 를 대상 손실 0 으로 거름.
워치 밴드(Model Type 'Apple Watch Band') = 수동 정답 240장(표준 타입 51 / 무관 189) 로지스틱. 교차검증 AUC 0.86,
  점수 0.38 미만 C → 무관 57% 제외·대상 5% 손실, 점수 상위 50% 안에 대상 94%.
결과 파일 camera_clf.local.npz.
판정 기준(사용자 확정 2026-10-27): 맥세이프 케이스만 정사각 홀이 대상. 실리콘 등 다른 케이스엔 적용 안 함.
"""
import io
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
CLF = HERE / "camera_clf.local.npz"
ONNX = HERE / "dinov2_s448.local.onnx"  # torch 대신 onnxruntime 으로 실행 (노트북 '애플리케이션 제어 정책'이 torch DLL 차단, 2026-10-27)
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


_SESSION = None


def _onnx():
    global _SESSION
    if _SESSION is None and ONNX.exists():
        import onnxruntime as ort
        _SESSION = ort.InferenceSession(str(ONNX), providers=["CPUExecutionProvider"])
    return _SESSION


def embed(images, batch=16):
    """PIL 이미지 목록 → (N, 768) 특징 = CLS + 패치 평균 (L2 정규화). ONNX 파일이 있으면 onnxruntime, 없으면 torch."""
    sess = _onnx()
    if sess is not None:
        out = [sess.run(None, {"x": np.stack([_prep(im) for im in images[i:i + batch]]).astype(np.float32)})[0]
               for i in range(0, len(images), batch)]
        f = np.concatenate(out) if out else np.zeros((0, 768), np.float32)
        return f / np.linalg.norm(f, axis=1, keepdims=True).clip(1e-6)
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
    def __init__(self, w1, b1, w2, b2, w3=None, b3=0.0, w4=None, b4=0.0):
        self.w1, self.b1, self.w2, self.b2, self.w3, self.b3 = w1, b1, w2, b2, w3, b3
        self.w4, self.b4 = w4, b4  # 워치 밴드 표준 타입

    @classmethod
    def load(cls, path=CLF):
        try:
            d = np.load(path)
            return cls(d["w1"], float(d["b1"]), d["w2"], float(d["b2"]),
                       d["w3"] if "w3" in d else None, float(d["b3"]) if "b3" in d else 0.0,
                       d["w4"] if "w4" in d else None, float(d["b4"]) if "b4" in d else 0.0)
        except FileNotFoundError:
            return None

    def predict(self, feats):
        """(판단 가능 확률, 정사각 확률, 수집 대상 확률=깔끔한 투명 케이스+링+정사각 홀)"""
        sig = lambda z: 1 / (1 + np.exp(-z))
        p3 = sig(feats @ self.w3 + self.b3) if self.w3 is not None else np.full(len(feats), np.nan)
        return sig(feats @ self.w1 + self.b1), sig(feats @ self.w2 + self.b2), p3

    def p_band(self, feats):
        """워치 밴드가 위반 확정 표준 타입(오션·스포츠 루프·스포츠 밴드·알파인/트레일·밀레니즈)일 확률."""
        if self.w4 is None:
            return np.full(len(feats), np.nan)
        return 1 / (1 + np.exp(-(feats @ self.w4 + self.b4)))


def annotate(rows, fetch_bytes, clf=None):
    """맥세이프 케이스 행에 cam_judge(판단 가능 확률)·cam_square(정사각 확률)를 채운다. 이미지 못 받으면 None."""
    clf = clf or Classifier.load()
    targets = [r for r in rows if r.get("model_type") in ("MagSafe iPhone case", "Apple Watch Band") and r.get("image")]
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
        r["cam_judge"] = r["cam_square"] = r["cam_clear"] = r["band_std"] = None
    if imgs:
        feats = embed(imgs)
        pj, ps, pc = clf.predict(feats)
        pb = clf.p_band(feats)
        for r, a, b, c, d in zip(keep, pj, ps, pc, pb):
            if r.get("model_type") == "Apple Watch Band":
                r["band_std"] = None if np.isnan(d) else float(d)
                continue
            r["cam_judge"], r["cam_square"] = float(a), float(b)
            r["cam_clear"] = None if np.isnan(c) else float(c)
    return rows


def train_band(items):
    """items = [{"file", "label": "Y"|"N"}] (워치 밴드 표준 타입 수동 정답) → camera_clf.local.npz 에 w4/b4 추가."""
    from sklearn.linear_model import LogisticRegression
    feats = embed([Image.open(it["file"]).convert("RGB") for it in items])
    y = np.array([it["label"] == "Y" for it in items])
    m = LogisticRegression(max_iter=5000, class_weight="balanced").fit(feats, y)
    d = dict(np.load(CLF))
    d.update(w4=m.coef_[0].astype(np.float32), b4=np.float32(m.intercept_[0]))
    np.savez(CLF, **d)
    return int(y.sum()), len(y)


def train_from_labels(items, clear=None):
    """items = [{"file": 경로, "label": "S"|"O"|"X"}], clear = {"순번": "T"|"N"} (정사각 중 깔끔한 투명 케이스) → 분류기 저장."""
    from sklearn.linear_model import LogisticRegression
    feats = embed([Image.open(it["file"]).convert("RGB") for it in items])
    lab = np.array([it["label"] for it in items])
    j = lab != "X"
    m1 = LogisticRegression(max_iter=4000, class_weight="balanced").fit(feats, j)
    m2 = LogisticRegression(max_iter=4000, class_weight="balanced").fit(feats[j], lab[j] == "S")
    out = dict(w1=m1.coef_[0].astype(np.float32), b1=np.float32(m1.intercept_[0]),
               w2=m2.coef_[0].astype(np.float32), b2=np.float32(m2.intercept_[0]))
    if clear:
        t = np.array([clear.get(str(k)) == "T" for k in range(len(items))])
        m3 = LogisticRegression(max_iter=5000, class_weight="balanced").fit(feats, t)
        out.update(w3=m3.coef_[0].astype(np.float32), b3=np.float32(m3.intercept_[0]))
    if CLF.exists():  # 워치 밴드(w4/b4) 등 다른 판정은 보존
        old = dict(np.load(CLF))
        out.update({k: v for k, v in old.items() if k in ("w4", "b4")})
    np.savez(CLF, **out)
    return int(j.sum()), int((lab == "S").sum())


if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "train-band":
    import json
    print("워치 밴드 학습 완료 (표준 타입 %d / 전체 %d)" % train_band(json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))))

if __name__ == "__main__" and len(sys.argv) == 3 and sys.argv[1] == "train":
    import json
    items = json.loads(Path(sys.argv[2]).read_text(encoding="utf-8"))
    cp = Path(sys.argv[2]).with_name("clear_labels.json")
    clear = json.loads(cp.read_text(encoding="utf-8")) if cp.exists() else None
    print("학습 완료 (판단 가능 %d / 정사각 %d)" % train_from_labels(items, clear))
