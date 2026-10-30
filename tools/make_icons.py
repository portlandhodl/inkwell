"""Render the Inkwell ink-drop icon at the sizes Chrome wants."""
import math
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
S = 1024  # supersampled canvas

def lerp(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))

def drop_polygon(cx, cy, r):
    """Ink-drop outline: a circle with a pointed top."""
    pts = []
    for i in range(361):
        a = math.radians(i)
        # parametric teardrop: x = r sin(a) * sin(a/2)^m, y = -r cos(a)
        x = cx + r * math.sin(a) * (math.sin(a / 2) ** 1.25)
        y = cy - r * math.cos(a) * 1.18
        pts.append((x, y))
    return pts

img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
# rounded-square background with diagonal gradient
bg = Image.new('RGBA', (S, S))
c1, c2 = (109, 93, 252), (255, 107, 154)
px = bg.load()
for y in range(S):
    for x in range(S):
        t = (x + y) / (2 * S)
        px[x, y] = lerp(c1, c2, t) + (255,)
mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle((40, 40, S - 40, S - 40), radius=230, fill=255)
img.paste(bg, (0, 0), mask)

# soft highlight
glow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(glow).ellipse((-200, -300, 700, 500), fill=(255, 255, 255, 50))
glow = glow.filter(ImageFilter.GaussianBlur(80))
img = Image.alpha_composite(img, Image.composite(glow, Image.new('RGBA', (S, S)), mask))

# white ink drop with shadow
drop = drop_polygon(S / 2, S / 2 + 60, 300)
shadow = Image.new('RGBA', (S, S), (0, 0, 0, 0))
ImageDraw.Draw(shadow).polygon([(x, y + 24) for x, y in drop], fill=(40, 20, 90, 90))
img = Image.alpha_composite(img, shadow.filter(ImageFilter.GaussianBlur(26)))
d = ImageDraw.Draw(img)
d.polygon(drop, fill=(255, 255, 255, 255))
# shine inside the drop
d.arc((S / 2 - 170, S / 2 - 20, S / 2 + 130, S / 2 + 280), start=110, end=180, fill=(150, 120, 255, 255), width=46)

for size in (16, 32, 48, 128):
    img.resize((size, size), Image.LANCZOS).save(OUT / f'icon-{size}.png')
img.resize((512, 512), Image.LANCZOS).save(OUT / 'icon-512.png')
# iOS/iMessage touch icon: opaque, since iOS fills transparency with black
touch = Image.new('RGBA', (180, 180), (109, 93, 252, 255))
full = img.resize((180, 180), Image.LANCZOS)
touch.alpha_composite(full)
touch.convert('RGB').save(OUT / 'icon-180.png')
print('icons written to', OUT)
