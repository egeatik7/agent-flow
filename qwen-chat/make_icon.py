# -*- coding: utf-8 -*-
"""QwenChat icin basit .ico uretir (Pillow)."""
import os
from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
S = 256


def bubble(d, box, fill):
    x0, y0, x1, y1 = box
    r = (y1 - y0) * 0.28
    d.rounded_rectangle(box, radius=r, fill=fill)
    # konusma kuyrugu
    ax = x0 + (x1 - x0) * 0.26
    ay = y1 - 4
    d.polygon([(ax, ay - 14), (ax + 34, ay - 8), (ax + 4, ay + 20)], fill=fill)


def main():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # arka plan: yuvarlak kare + dikey gradyan
    grad = Image.new("RGBA", (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        gd.line([(0, y), (S, y)], fill=(int(79 + 60 * t), int(140 - 40 * t), int(255 - 20 * t), 255))
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([3, 3, S - 4, S - 4], radius=56, fill=255)
    img.paste(grad, (0, 0), mask)

    # beyaz konusma balonu
    bubble(d, (46, 62, 210, 176), (255, 255, 255, 255))
    # balon icinde mavi "yazi" cizgileri
    for i, w in enumerate((96, 118, 70)):
        y = 96 + i * 24
        d.rounded_rectangle([70, y, 70 + w, y + 10], radius=5, fill=(79, 140, 255, 255))

    out = os.path.join(HERE, "icon.ico")
    img.save(out, sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    img.resize((256, 256)).save(os.path.join(HERE, "icon.png"))
    print("ok:", out)


if __name__ == "__main__":
    main()
