# -*- coding: utf-8 -*-
"""Uctan uca dogrulama: proxy + akis + gorsel (vision) yolu."""
import base64
import json
import os
import time
import urllib.request

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = "http://127.0.0.1:8765"


def post(path, obj, timeout=600):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj).encode("utf-8"), method="POST")
    req.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(req, timeout=timeout)


def main():
    # 1) saglik
    with urllib.request.urlopen(BASE + "/health", timeout=10) as r:
        print("1) /health ->", r.status, r.read().decode())

    # 2) arayuz dosyasi
    with urllib.request.urlopen(BASE + "/", timeout=10) as r:
        html = r.read().decode("utf-8")
    print("2) / -> %d bayt, baslik var mi: %s" % (len(html), "<title>Qwen</title>" in html))

    # 3) gorsel uret
    img = Image.new("RGB", (420, 200), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([10, 10, 409, 189], outline="black", width=4)
    d.text((42, 60), "QWEN TEST 42", fill="black")
    d.text((42, 118), "KIRMIZI KARE", fill="red")
    p = os.path.join(HERE, "_test.png")
    img.save(p)
    b64 = base64.b64encode(open(p, "rb").read()).decode()
    print("3) test gorseli: %d bayt base64" % len(b64))

    # 4) akan sohbet + gorsel
    body = {
        "model": "qwen3.5:9b",
        "messages": [{"role": "user", "content": "Bu gorselde yazan metin nedir? Sadece metni yaz.", "images": [b64]}],
        "stream": True,
        "think": False,
        "keep_alive": -1,
        "options": {"num_ctx": 8192},
    }
    t0 = time.time()
    first = None
    text = ""
    last = {}
    with post("/api/chat", body) as r:
        print("4) /api/chat durum:", r.status, r.headers.get("Content-Type"))
        for raw in r:
            line = raw.decode("utf-8").strip()
            if not line:
                continue
            j = json.loads(line)
            if first is None:
                first = time.time() - t0
            if j.get("message", {}).get("content"):
                text += j["message"]["content"]
            if j.get("done"):
                last = j
    total = time.time() - t0
    tps = (last.get("eval_count", 0) / (last.get("eval_duration", 1) / 1e9)) if last else 0
    print("   ilk token: %.2fs | toplam: %.2fs | %.1f tok/s" % (first or -1, total, tps))
    print("   CEVAP:", text.strip()[:300])
    ok = "42" in text
    print("   GORSEL OKUNDU MU:", "EVET" if ok else "HAYIR (model metni okuyamadi)")
    try:
        os.remove(p)
    except OSError:
        pass
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
