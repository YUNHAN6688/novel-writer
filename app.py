# -*- coding: utf-8 -*-
"""小说写作软件 · Web 版后端。

本地 HTTP 服务 + JSON API + 静态资源托管 + 背景图上传。
启动：  python app.py        # 自动打开浏览器 http://127.0.0.1:8000

API:
  GET  /api/data            读取整棵小说树（novel_data.json）
  POST /api/data            保存整棵小说树（JSON body）
  GET  /api/settings        读取界面设置（settings.json）
  POST /api/settings        保存界面设置（JSON body）
  POST /api/upload          上传背景图（multipart），返回可访问 URL
"""
import json
import os
import threading
import uuid
import webbrowser
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

def _resource_dir():
    """静态资源来源：打包后用 PyInstaller 解压目录，否则为脚本目录"""
    return getattr(sys, "_MEIPASS", None) or os.path.dirname(os.path.abspath(__file__))

def _writable_dir():
    """可读写数据位置：打包后用 exe 所在目录，否则为脚本目录"""
    if getattr(sys, "frozen", False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.abspath(__file__))

BASE_DIR = _resource_dir()
WRITABLE_DIR = _writable_dir()
DATA_FILE = os.path.join(WRITABLE_DIR, "novel_data.json")
SETTINGS_FILE = os.path.join(WRITABLE_DIR, "settings.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(WRITABLE_DIR, "static", "uploads")

DEFAULT_SETTINGS = {
    "theme": "day",
    "font_size": 14,
    "font_color": "#222222",
    "background_image": "",
}

DEFAULT_DATA = {"children": []}


def load_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            pass
    return default


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def load_data():
    d = load_json(DATA_FILE, DEFAULT_DATA)
    if not isinstance(d, dict) or "children" not in d:
        return DEFAULT_DATA
    return d


def load_settings():
    s = dict(DEFAULT_SETTINGS)
    s.update(load_json(SETTINGS_FILE, {}))
    return s


MIME = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
    ".json": "application/json; charset=utf-8",
}


class Handler(BaseHTTPRequestHandler):
    # ---- 基础工具 ----
    def _send(self, code, body=b"", ctype="text/plain; charset=utf-8"):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if body:
            self.wfile.write(body)

    def _json(self, obj, code=200):
        self._send(code, json.dumps(obj, ensure_ascii=False).encode("utf-8"),
                   "application/json; charset=utf-8")

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0) or 0)
        return self.rfile.read(length) if length else b""

    # ---- GET ----
    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/" or path == "":
            path = "/index.html"
        if path == "/api/data":
            self._json(load_data())
            return
        if path == "/api/settings":
            self._json(load_settings())
            return
        if path.startswith("/api/"):
            self._send(404, b"Not Found")
            return
        # 静态文件（/static/ 前缀映射到 STATIC_DIR）
        if path.startswith("/static/"):
            rel = path[len("/static/"):]
        else:
            rel = path.lstrip("/")
        full = os.path.normpath(os.path.join(STATIC_DIR, rel))
        if not full.startswith(os.path.normpath(STATIC_DIR)):
            self._send(403, b"Forbidden")
            return
        if os.path.isdir(full):
            full = os.path.join(full, "index.html")
        if not os.path.exists(full):
            # 打包环境：上传的动态图片保存在 exe 旁的可写目录
            alt = os.path.normpath(os.path.join(WRITABLE_DIR, "static", rel))
            alt_root = os.path.normpath(os.path.join(WRITABLE_DIR, "static"))
            if alt.startswith(alt_root) and os.path.exists(alt):
                full = alt
            else:
                self._send(404, b"Not Found")
                return
        ext = os.path.splitext(full)[1].lower()
        ctype = MIME.get(ext, "application/octet-stream")
        try:
            with open(full, "rb") as f:
                self._send(200, f.read(), ctype)
        except OSError:
            self._send(500, b"Server Error")

    # ---- POST ----
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/data":
            try:
                data = json.loads(self._read_body().decode("utf-8"))
                save_json(DATA_FILE, data)
                self._json({"ok": True})
            except Exception as e:
                self._json({"ok": False, "error": str(e)}, 500)
        elif path == "/api/settings":
            try:
                data = json.loads(self._read_body().decode("utf-8"))
                s = dict(DEFAULT_SETTINGS)
                s.update(data if isinstance(data, dict) else {})
                save_json(SETTINGS_FILE, s)
                self._json({"ok": True})
            except Exception as e:
                self._json({"ok": False, "error": str(e)}, 500)
        elif path == "/api/upload":
            self._handle_upload()
        else:
            self._send(404, b"Not Found")

    def _handle_upload(self):
        ctype = self.headers.get("Content-Type", "")
        if "multipart/form-data" not in ctype:
            self._json({"ok": False, "error": "not multipart"}, 400)
            return
        boundary = None
        for part in ctype.split(";"):
            p = part.strip()
            if p.startswith("boundary="):
                boundary = p[len("boundary="):].strip('"')
        body = self._read_body()
        if not boundary:
            self._json({"ok": False, "error": "no boundary"}, 400)
            return
        sep = ("--" + boundary).encode()
        for part in body.split(sep):
            if b"filename=" not in part:
                continue
            head_end = part.find(b"\r\n\r\n")
            if head_end < 0:
                continue
            head = part[:head_end].decode("utf-8", "ignore")
            content = part[head_end + 4:]
            if content.endswith(b"\r\n"):
                content = content[:-2]
            fn = ""
            for line in head.split("\r\n"):
                if "filename=" in line:
                    try:
                        fn = line.split('filename="')[1].split('"')[0]
                    except IndexError:
                        fn = ""
            if not fn:
                continue
            ext = os.path.splitext(fn)[1].lower() or ".png"
            os.makedirs(UPLOAD_DIR, exist_ok=True)
            name = uuid.uuid4().hex + ext
            with open(os.path.join(UPLOAD_DIR, name), "wb") as f:
                f.write(content)
            self._json({"ok": True, "url": "/static/uploads/" + name})
            return
        self._json({"ok": False, "error": "no file part"}, 400)

    def log_message(self, *args):
        pass


def main():
    os.makedirs(UPLOAD_DIR, exist_ok=True)
    port = 8000
    httpd = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    url = f"http://127.0.0.1:{port}"
    print(f"小说写作软件 Web 版已启动: {url}")
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
