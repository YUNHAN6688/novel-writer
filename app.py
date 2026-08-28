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
import base64
import urllib.request
import urllib.error
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
COMIC_DRAMA_FILE = os.path.join(WRITABLE_DIR, "comic_drama.json")
COMIC_IMAGE_FILE = os.path.join(WRITABLE_DIR, "comic_image.json")
STATIC_DIR = os.path.join(BASE_DIR, "static")
UPLOAD_DIR = os.path.join(WRITABLE_DIR, "static", "uploads")

DEFAULT_SETTINGS = {
    "theme": "day",
    "font_size": 14,
    "font_color": "#222222",
    "background_image": "",
    "ai_base_url": "",
    "ai_api_key": "",
    "ai_model": "",
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


def load_comic(kind):
    """加载漫剧(drama)或漫画图片(image)的已保存提示词列表。"""
    path = COMIC_DRAMA_FILE if kind == "drama" else COMIC_IMAGE_FILE
    d = load_json(path, {"items": []})
    if not isinstance(d, dict) or "items" not in d:
        return {"items": []}
    return d


def save_comic(kind, data):
    path = COMIC_DRAMA_FILE if kind == "drama" else COMIC_IMAGE_FILE
    save_json(path, data)


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
        if path == "/api/comic/drama":
            self._json(load_comic("drama"))
            return
        if path == "/api/comic/image":
            self._json(load_comic("image"))
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
        elif path == "/api/ai/chat":
            self._handle_ai_chat()
        elif path == "/api/ocr":
            self._handle_ocr()
        elif path == "/api/comic/drama":
            self._handle_comic_save("drama")
        elif path == "/api/comic/image":
            self._handle_comic_save("image")
        elif path.startswith("/api/comic/drama/"):
            self._handle_comic_delete("drama", path)
        elif path.startswith("/api/comic/image/"):
            self._handle_comic_delete("image", path)
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

    def _handle_ai_chat(self):
        """OpenAI 兼容接口代理：本地保存 API Key，前端只传 messages。
        body: {"messages": [...], "temperature": 0.7, "max_tokens": 2048}
        """
        try:
            payload = json.loads(self._read_body().decode("utf-8"))
        except Exception:
            self._json({"ok": False, "error": "invalid json"}, 400)
            return

        s = load_settings()
        base_url = (s.get("ai_base_url") or "").strip().rstrip("/")
        api_key = (s.get("ai_api_key") or "").strip()
        model = (s.get("ai_model") or "").strip()
        if not base_url or not api_key or not model:
            self._json({"ok": False, "error": "AI 未配置：请在界面设置中填写 API 地址、Key 和模型"}, 400)
            return

        messages = payload.get("messages")
        if not isinstance(messages, list) or not messages:
            self._json({"ok": False, "error": "messages 必填"}, 400)
            return

        body = json.dumps({
            "model": model,
            "messages": messages,
            "temperature": float(payload.get("temperature", 0.7)),
            "max_tokens": int(payload.get("max_tokens", 4096)),
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")

        url = base_url + "/chat/completions"
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer " + api_key)
        try:
            with urllib.request.urlopen(req, timeout=180) as resp:
                raw = resp.read().decode("utf-8", "ignore")
            data = json.loads(raw)
            content = ""
            try:
                content = data["choices"][0]["message"]["content"]
            except Exception:
                content = raw
            self._json({"ok": True, "content": content, "raw": data})
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", "ignore")
            self._json({"ok": False, "error": f"上游返回 {e.code}: {err[:500]}"}, 502)
        except Exception as e:
            self._json({"ok": False, "error": "请求失败: " + str(e)}, 502)

    def _handle_ocr(self):
        try:
            self._handle_ocr_inner()
        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                self._json({"ok": False, "error": "OCR 处理异常: " + str(e)}, 500)
            except Exception:
                pass

    def _handle_ocr_inner(self):
        """图片理解（OCR + 画面描述）。
        识别类型 mode：
          text     — 仅文字识别
          describe — 仅画面描述（人物动作、神态、环境、氛围）
          both     — 文字 + 画面描述（默认）
        支持两种上传：
          1. multipart 上传图片文件（含 mode 字段）
          2. JSON body {"image": "base64...", "mime": "image/png", "mode": "both"}
        """
        ctype = self.headers.get("Content-Type", "")
        image_b64 = ""
        mime = "image/jpeg"
        ocr_mode = "both"

        if "multipart/form-data" in ctype:
            # 从 multipart 中提取图片和 mode
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
            found = False
            for part in body.split(sep):
                head_end = part.find(b"\r\n\r\n")
                if head_end < 0:
                    continue
                head = part[:head_end].decode("utf-8", "ignore")
                content = part[head_end + 4:]
                if content.endswith(b"\r\n"):
                    content = content[:-2]
                # 提取 mode 字段
                if 'name="mode"' in head and "filename=" not in head:
                    try:
                        val = content.decode("utf-8", "ignore").strip()
                        if val in ("text", "describe", "both"):
                            ocr_mode = val
                    except Exception:
                        pass
                    continue
                # 提取图片文件
                if b"filename=" in part or 'name="image"' in head or 'name="file"' in head:
                    for line in head.split("\r\n"):
                        if "Content-Type:" in line:
                            mime = line.split("Content-Type:")[1].strip().split(";")[0].strip()
                    if content:
                        image_b64 = base64.b64encode(content).decode("ascii")
                        found = True
            if not found:
                self._json({"ok": False, "error": "未找到图片文件"}, 400)
                return
        else:
            # JSON 模式
            try:
                payload = json.loads(self._read_body().decode("utf-8"))
                image_b64 = (payload.get("image") or "").strip()
                mime = payload.get("mime") or "image/jpeg"
                m = payload.get("mode") or "both"
                if m in ("text", "describe", "both"):
                    ocr_mode = m
                if image_b64.startswith("data:"):
                    header, _, b64 = image_b64.partition(",")
                    if ";" in header:
                        mime = header.split(";")[0].replace("data:", "")
                    image_b64 = b64
            except Exception:
                self._json({"ok": False, "error": "invalid json"}, 400)
                return

        if not image_b64:
            self._json({"ok": False, "error": "图片数据为空"}, 400)
            return

        # 检查 AI 配置
        s = load_settings()
        base_url = (s.get("ai_base_url") or "").strip().rstrip("/")
        api_key = (s.get("ai_api_key") or "").strip()
        model = (s.get("ai_model") or "").strip()
        if not base_url or not api_key or not model:
            self._json({"ok": False, "error": "AI 未配置：请在设置中填写 API 地址、Key 和模型（需支持视觉识别的模型）", "need_ai": True}, 400)
            return

        # 构建视觉识别请求（OpenAI 兼容格式）
        data_url = f"data:{mime};base64,{image_b64}"

        # 根据识别类型构建提示词
        if ocr_mode == "text":
            prompt_text = "请识别并提取这张图片中的所有文字内容，按原文排版输出。如果图片中有手写文字也尽量识别。只输出识别到的文字，不要添加解释。"
        elif ocr_mode == "describe":
            prompt_text = """请详细描述这张图片的画面内容，按以下结构输出：

【画面概述】
一句话概括图片的整体内容。

【人物分析】
- 出场人物：列出图片中出现的人物（如有）
- 外貌特征：发型、发色、瞳色、服装、配饰等
- 动作姿态：人物正在做什么动作（站立/行走/奔跑/坐下/打斗/拥抱等）
- 神态表情：人物的面部表情和情绪（微笑/愤怒/悲伤/惊讶/冷漠/沉思等）
- 人物关系：人物之间的互动关系（如有多人）

【环境场景】
- 地点：室内/室外，具体场景（街道/酒馆/森林/宫殿/战场等）
- 时间：白天/夜晚/清晨/黄昏
- 天气：晴朗/下雨/下雪/有雾等
- 背景元素：建筑、植物、道具、装饰物等细节

【光影氛围】
- 光线：光源方向、明暗对比、光影效果
- 色调：整体色彩倾向（暖色调/冷色调/高饱和/低饱和）
- 氛围：整体情绪氛围（紧张/温馨/神秘/悲壮/欢快等）

【构图镜头】
- 景别：特写/近景/中景/全景/远景
- 视角：平视/俯视/仰视/侧视
- 构图：主体位置、画面平衡、前后景关系

请基于图片实际内容描述，不要编造。如果图片中没有人物，人物分析部分写"无人物"。"""
        else:  # both
            prompt_text = """请对这张图片进行完整的图片理解，按以下结构输出：

【文字识别】
提取图片中所有可见的文字内容（包括招牌、字幕、书籍、信件等），按原文排版输出。如果没有文字，写"无可见文字"。

【画面概述】
一句话概括图片的整体内容。

【人物分析】
- 出场人物：列出图片中出现的人物（如有）
- 外貌特征：发型、发色、瞳色、服装、配饰等
- 动作姿态：人物正在做什么动作（站立/行走/奔跑/坐下/打斗/拥抱等）
- 神态表情：人物的面部表情和情绪（微笑/愤怒/悲伤/惊讶/冷漠/沉思等）
- 人物关系：人物之间的互动关系（如有多人）

【环境场景】
- 地点：室内/室外，具体场景（街道/酒馆/森林/宫殿/战场等）
- 时间：白天/夜晚/清晨/黄昏
- 天气：晴朗/下雨/下雪/有雾等
- 背景元素：建筑、植物、道具、装饰物等细节

【光影氛围】
- 光线：光源方向、明暗对比、光影效果
- 色调：整体色彩倾向（暖色调/冷色调/高饱和/低饱和）
- 氛围：整体情绪氛围（紧张/温馨/神秘/悲壮/欢快等）

【构图镜头】
- 景别：特写/近景/中景/全景/远景
- 视角：平视/俯视/仰视/侧视
- 构图：主体位置、画面平衡、前后景关系

请基于图片实际内容描述，不要编造。如果图片中没有人物，人物分析部分写"无人物"。"""

        body = json.dumps({
            "model": model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_text},
                        {"type": "image_url", "image_url": {"url": data_url}},
                    ],
                }
            ],
            "temperature": 0.3,
            "max_tokens": 8192,
            "stream": False,
        }, ensure_ascii=False).encode("utf-8")

        url = base_url + "/chat/completions"
        req = urllib.request.Request(url, data=body, method="POST")
        req.add_header("Content-Type", "application/json")
        req.add_header("Authorization", "Bearer " + api_key)
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                raw = resp.read().decode("utf-8", "ignore")
            data = json.loads(raw)
            content = ""
            try:
                content = data["choices"][0]["message"]["content"]
            except Exception:
                content = raw
            self._json({"ok": True, "text": content, "model": model, "mode": ocr_mode})
        except urllib.error.HTTPError as e:
            err = e.read().decode("utf-8", "ignore")
            self._json({"ok": False, "error": f"AI 接口返回 {e.code}: {err[:500]}"}, 502)
        except Exception as e:
            self._json({"ok": False, "error": "识别失败: " + str(e)}, 502)

    def _handle_comic_save(self, kind):
        """保存一组漫剧/漫画图片提示词。body: {"name": "...", "prompts": [...]}"""
        try:
            payload = json.loads(self._read_body().decode("utf-8"))
        except Exception:
            self._json({"ok": False, "error": "invalid json"}, 400)
            return
        name = (payload.get("name") or "未命名").strip()
        prompts = payload.get("prompts")
        if not isinstance(prompts, list) or not prompts:
            self._json({"ok": False, "error": "prompts 不能为空"}, 400)
            return
        d = load_comic(kind)
        item = {
            "id": uuid.uuid4().hex[:12],
            "name": name,
            "count": len(prompts),
            "prompts": prompts,
            "created": __import__("time").strftime("%Y-%m-%d %H:%M:%S"),
        }
        d["items"].insert(0, item)
        # 最多保留 50 条
        d["items"] = d["items"][:50]
        save_comic(kind, d)
        self._json({"ok": True, "id": item["id"], "name": item["name"]})

    def _handle_comic_delete(self, kind, path):
        """删除一条已保存的提示词。URL: /api/comic/{kind}/{id}"""
        try:
            item_id = path.rstrip("/").split("/")[-1]
            d = load_comic(kind)
            before = len(d["items"])
            d["items"] = [it for it in d["items"] if it.get("id") != item_id]
            if len(d["items"]) == before:
                self._json({"ok": False, "error": "未找到该记录"}, 404)
                return
            save_comic(kind, d)
            self._json({"ok": True})
        except Exception as e:
            self._json({"ok": False, "error": str(e)}, 500)

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
