"""Generates the toolbar icons in icons/ to match icons/logo.svg.
Run: python3 scripts/make-icons.py (needs Pillow)"""
import math
from PIL import Image, ImageDraw


def icon(size):
    s = size * 8  # draw large, then downsample for smooth edges
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    c, r = s / 2, s * 0.47
    hexagon = [(c + r * math.cos(math.radians(a)), c + r * math.sin(math.radians(a))) for a in range(-90, 270, 60)]
    d.polygon(hexagon, fill=(10, 10, 10, 255))
    d.line(hexagon + [hexagon[0]], fill=(10, 10, 10, 255), width=int(s * 0.06), joint="curve")
    # white bookmark, same proportions as logo.svg (viewBox 32)
    k = s / 32
    d.polygon([(11.6 * k, 9.4 * k), (20.4 * k, 9.4 * k), (20.4 * k, 22.6 * k), (16 * k, 19.4 * k), (11.6 * k, 22.6 * k)], fill=(255, 255, 255, 255))
    return img.resize((size, size), Image.LANCZOS)


for size in (16, 32, 48, 128):
    icon(size).save(f"icons/icon-{size}.png")
