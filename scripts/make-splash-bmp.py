#!/usr/bin/env python3
"""Bitmap shown by the portable exe while it unpacks, before Electron exists."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "resources" / "boot" / "splash.bmp"
ASSETS = ROOT / "src" / "assets"
pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
version = str(pkg.get("version") or "")

W, H = 1600, 900
BLUE = (58, 110, 165, 255)
FACE = (236, 233, 216, 255)
img = Image.new("RGBA", (W, H), BLUE)
card = Image.new("RGBA", (380, 430), FACE)
draw = ImageDraw.Draw(card)
draw.rectangle((0, 0, 379, 22), fill=(0, 80, 238, 255))

def font(size: int, bold: bool = False):
    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf" if bold else "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default()

title = font(12, True)
small = font(11)
cap = font(11, True)
draw.text((8, 4), "Nubbo Agent Studio", font=title, fill=(255, 255, 255, 255))

mascot = Image.open(ASSETS / "nubbo-still.png").convert("RGBA").resize((148, 148), Image.Resampling.NEAREST)
logo = Image.open(ASSETS / "nubbo-logo.png").convert("RGBA")
logo.thumbnail((210, 80), Image.Resampling.NEAREST)
card.paste(mascot, ((380 - mascot.width) // 2, 36), mascot)
card.paste(logo, ((380 - logo.width) // 2, 180), logo)
ver = f"version: {version}"
bbox = draw.textbbox((0, 0), ver, font=small)
draw.text(((380 - (bbox[2] - bbox[0])) // 2, 262), ver, font=small, fill=(85, 85, 85, 255))

track = (22, 292, 358, 318)
draw.rectangle(track, fill=(255, 255, 255, 255), outline=(128, 128, 128, 255))
draw.rectangle((23, 293, 23 + int(334 * 0.18), 317), fill=(22, 87, 217, 255))
line = "Dosyalar açılıyor…  18%"
lb = draw.textbbox((0, 0), line, font=cap)
draw.text(((380 - (lb[2] - lb[0])) // 2, 296), line, font=cap, fill=(0, 0, 0, 255))

# XP bevel
bevel = ImageDraw.Draw(card)
bevel.line((0, 0, 379, 0), fill=(255, 255, 255, 255))
bevel.line((0, 0, 0, 429), fill=(255, 255, 255, 255))
bevel.line((379, 1, 379, 429), fill=(64, 64, 64, 255))
bevel.line((1, 429, 379, 429), fill=(64, 64, 64, 255))

x = (W - card.width) // 2
y = (H - card.height) // 2
img.paste(card, (x + 4, y + 4), Image.new("RGBA", card.size, (0, 0, 0, 90)))
img.paste(card, (x, y), card)
OUT.parent.mkdir(parents=True, exist_ok=True)
img.convert("RGB").save(OUT, "BMP")
print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
