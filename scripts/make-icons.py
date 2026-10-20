"""Generates the toolbar icons in icons/. Run: python3 scripts/make-icons.py"""
from PIL import Image, ImageDraw

def icon(size):
    s = size * 4  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    grad = Image.new("RGBA", (s, s))
    gd = ImageDraw.Draw(grad)
    for y in range(s):
        t = y / s
        gd.line([(0, y), (s, y)], fill=(int(109 + (176 - 109) * t), int(93 + (108 - 93) * t), 252, 255))
    mask = Image.new("L", (s, s), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, s - 1, s - 1], radius=s * 0.24, fill=255)
    img.paste(grad, (0, 0), mask)
    # three "pinned cards" in a masonry layout
    w = (255, 255, 255, 240)
    p, g = s * 0.2, s * 0.06
    col = (s - 2 * p - g) / 2
    d.rounded_rectangle([p, p, p + col, s * 0.62], radius=s * 0.06, fill=w)
    d.rounded_rectangle([p, s * 0.62 + g, p + col, s - p], radius=s * 0.06, fill=w)
    d.rounded_rectangle([p + col + g, p, s - p, s - p], radius=s * 0.06, fill=(255, 255, 255, 170))
    return img.resize((size, size), Image.LANCZOS)

for size in (16, 32, 48, 128):
    icon(size).save(f"icons/icon-{size}.png")
