#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""Qwen Chat - yerel hizli sohbet arayuzu (Ollama icin ince proxy + statik UI).

Sadece Python standart kutuphanesi kullanilir. Tarayici ayni kaynaktan
(127.0.0.1:PORT) konusur, istekler Ollama'ya oldugu gibi aktarilir; boylece
CORS/Origin sorunlari hic olusmaz ve akis (stream) bozulmadan gecer.
"""
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
OLLAMA = (os.environ.get("QWEN_OLLAMA") or "http://127.0.0.1:11434").rstrip("/")
PORT = int(os.environ.get("QWEN_PORT") or "8765")
HOST = "127.0.0.1"
PRELOAD_MODEL = os.environ.get("QWEN_MODEL") or "qwen3.5:9b"
PRELOAD_CTX = int(os.environ.get("QWEN_CTX") or "8192")
PRELOAD_KEEP = os.environ.get("QWEN_KEEP_ALIVE") or "-1"

INDEX = os.path.join(HERE, "index.html")
ICON = os.path.join(HERE, "icon.ico")

MIME = {
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def log(*a):
    print("[qwen]", *a, flush=True)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "QwenChat"
    sys_version = ""

    # ---- sessiz calis (hiz icin log yok) ----
    def log_message(self, *a):
        pass

    # ---- yardimcilar ----
    def _file(self, path):
        if not os.path.isfile(path):
            self.send_error(404)
            return
        with open(path, "rb") as f:
            data = f.read()
        ext = os.path.splitext(path)[1].lower()
        self.send_response(200)
        self.send_header("Content-Type", MIME.get(ext, "application/octet-stream"))
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _json(self, code, obj):
        data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        try:
            self.wfile.write(data)
        except (BrokenPipeError, ConnectionResetError):
            pass

    # ---- GET ----
    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/", "/index.html"):
            self._file(INDEX)
        elif path == "/favicon.ico":
            self._file(ICON)
        elif path == "/health":
            self._json(200, {"ok": True, "model": PRELOAD_MODEL, "ollama": OLLAMA})
        elif path.startswith("/api/"):
            self._proxy("GET")
        else:
            self.send_error(404)

    # ---- POST ----
    def do_POST(self):
        if self.path.split("?", 1)[0].startswith("/api/"):
            self._proxy("POST")
        else:
            self.send_error(404)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Content-Length", "0")
        self.end_headers()

    # ---- Ollama'ya akan aktarim ----
    def _proxy(self, method):
        url = OLLAMA + self.path
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None

        req = urllib.request.Request(url, data=body, method=method)
        if body is not None:
            req.add_header("Content-Type", "application/json")
        try:
            resp = urllib.request.urlopen(req, timeout=1800)
        except urllib.error.HTTPError as e:
            try:
                payload = e.read()
            except Exception:
                payload = b""
            if not payload.strip():
                payload = json.dumps(
                    {"error": "Ollama istegi reddetti (HTTP %d %s)" % (e.code, e.reason)}
                ).encode("utf-8")
            self.send_response(e.code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            try:
                self.wfile.write(payload)
            except (BrokenPipeError, ConnectionResetError):
                pass
            return
        except Exception as e:
            self._json(502, {"error": "Ollama'ya ulasilamadi (%s). Ollama calisiyor mu?" % e})
            return

        self.send_response(200)
        self.send_header("Content-Type", resp.headers.get("Content-Type") or "application/x-ndjson")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.send_header("Connection", "close")
        self.end_headers()
        self.close_connection = True
        try:
            while True:
                chunk = resp.read(4096)
                if not chunk:
                    break
                self.wfile.write(chunk)
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            pass  # kullanici durdurdu
        except Exception:
            pass
        finally:
            try:
                resp.close()
            except Exception:
                pass


def port_busy(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.settimeout(0.4)
        return s.connect_ex((HOST, port)) == 0


def ollama_ready():
    try:
        with urllib.request.urlopen(OLLAMA + "/api/tags", timeout=5) as r:
            return r.status == 200
    except Exception:
        return False


def keep_alive_value(v=PRELOAD_KEEP):
    """'-1' metin olarak gonderilirse Ollama 400 verir; sayiya cevir."""
    v = str(v).strip()
    try:
        return int(v)
    except ValueError:
        return v


def preload(model=PRELOAD_MODEL, ctx=PRELOAD_CTX, keep=PRELOAD_KEEP):
    """Modeli VRAM'e onceden yukle: ilk mesaj da hizli olsun."""
    payload = json.dumps({
        "model": model,
        "prompt": "",
        "stream": False,
        "keep_alive": keep_alive_value(keep),
        "options": {"num_ctx": ctx},
    }).encode("utf-8")
    req = urllib.request.Request(OLLAMA + "/api/generate", data=payload, method="POST")
    req.add_header("Content-Type", "application/json")
    try:
        t0 = time.time()
        with urllib.request.urlopen(req, timeout=900) as r:
            r.read()
        log("model yuklendi: %s (%.1fs, ctx=%d, keep_alive=%s)" % (model, time.time() - t0, ctx, keep))
    except Exception as e:
        log("on yukleme atlandi:", e)


def main():
    if port_busy(PORT):
        # Zaten bizim sunucumuz kosuyor: yeni kopya acma, sadece pencereyi getir.
        webbrowser.open("http://%s:%d/" % (HOST, PORT))
        log("sunucu zaten calisiyor, tarayici acildi")
        return 0

    if not ollama_ready():
        log("UYARI: Ollama %s adresinde yanit vermiyor. Arayuz acilir ama mesajlar hata verir." % OLLAMA)
    else:
        threading.Thread(target=preload, daemon=True).start()

    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    httpd.daemon_threads = True
    url = "http://%s:%d/" % (HOST, PORT)
    log("hazir ->", url)
    if os.environ.get("QWEN_NO_BROWSER") != "1":
        threading.Thread(target=lambda: (time.sleep(0.35), webbrowser.open(url)), daemon=True).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
