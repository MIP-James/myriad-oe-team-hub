"""Generate installer.ico (gold rounded square, charcoal puzzle-piece glyph)."""
from PIL import Image, ImageDraw

GOLD, CHARCOAL = (242, 177, 0, 255), (58, 55, 55, 255)
frames = []
for size in (256, 128, 64, 48, 32, 16):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = size // 5
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=r, fill=GOLD)
    # puzzle piece: square body + knob on top + knob on right
    m = size * 0.28
    body = (m, m, size - m, size - m)
    d.rounded_rectangle(body, radius=max(1, size // 24), fill=CHARCOAL)
    k = size * 0.11
    cx = size / 2
    d.ellipse((cx - k, m - k * 1.3, cx + k, m + k * 0.7), fill=CHARCOAL)
    cy = size / 2
    d.ellipse((size - m - k * 0.7, cy - k, size - m + k * 1.3, cy + k), fill=CHARCOAL)
    frames.append(img)
frames[0].save("installer.ico", format="ICO", sizes=[(f.width, f.height) for f in frames], append_images=frames[1:])
print("installer.ico written")
