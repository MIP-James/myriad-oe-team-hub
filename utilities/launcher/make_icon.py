# -*- coding: utf-8 -*-
"""launcher.ico 를 생성 (build.bat 에서 호출)."""
import os
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    print("Pillow not installed; skip icon generation")
    raise SystemExit(0)

here = Path(__file__).resolve().parent
out = here / "launcher.ico"
if out.exists():
    print(f"icon already exists: {out}")
    raise SystemExit(0)

img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
d = ImageDraw.Draw(img)
d.ellipse([16, 16, 240, 240], fill=(255, 179, 0, 255))

font = None
for candidate in ("C:/Windows/Fonts/arialbd.ttf", "C:/Windows/Fonts/malgunbd.ttf"):
    if os.path.exists(candidate):
        try:
            font = ImageFont.truetype(candidate, 140)
            break
        except Exception:
            pass
if font is None:
    font = ImageFont.load_default()

bbox = d.textbbox((0, 0), "M", font=font)
w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
d.text(
    (128 - w // 2 - bbox[0], 128 - h // 2 - bbox[1] - 6),
    "M",
    fill=(17, 17, 17, 255),
    font=font,
)
img.save(out, sizes=[(16, 16), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"icon created: {out}")
