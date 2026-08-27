# -*- coding: utf-8 -*-
"""小说写作软件 · 桌面版入口。

在本地启动 Web 服务，并用 pywebview 打开独立原生窗口（最接近桌面软件体验）。
若系统不支持 pywebview 窗口，会回退为在系统浏览器中打开。
"""
import os
import sys
import threading
from http.server import ThreadingHTTPServer

_LOGPATH = os.path.join(
    os.path.dirname(os.path.abspath(sys.executable)), "app_error.log"
) if getattr(sys, "frozen", False) else os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "app_error.log"
)


def _log(msg):
    try:
        with open(_LOGPATH, "a", encoding="utf-8") as f:
            f.write(msg + "\n")
    except Exception:
        pass


def _excepthook(t, v, tb):
    import traceback
    _log("UNCAUGHT:\n" + "".join(traceback.format_exception(t, v, tb)))


sys.excepthook = _excepthook

import app as backend





def _hide_console():
    """打包为 console 版时隐藏黑色控制台窗口。
    立即隐藏一次，并在启动早期多次延迟隐藏，覆盖控制台晚创建/被重新显示的情况。"""
    def _do_hide():
        try:
            import ctypes
            from ctypes import wintypes
            _user32 = ctypes.windll.user32
            _kernel32 = ctypes.windll.kernel32
            # 彻底分离控制台：直接销毁 console 窗口（连同任务栏按钮一并消失），
            # 比单纯隐藏彻底得多；stdout/stderr 已重定向到文件，分离后不影响运行。
            _kernel32.FreeConsole()
            # 关键：句柄是 64 位，必须声明 restype/argtypes，否则高 32 位被截断导致隐藏失效
            _kernel32.GetConsoleWindow.restype = wintypes.HWND
            _user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
            _hwnd = _kernel32.GetConsoleWindow()
            if _hwnd:
                # 关键：设为工具窗口样式，避免其占据任务栏按钮
                GWL_EXSTYLE = -20
                WS_EX_TOOLWINDOW = 0x00000080
                _user32.GetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int]
                _user32.GetWindowLongW.restype = ctypes.c_long
                _user32.SetWindowLongW.argtypes = [wintypes.HWND, ctypes.c_int, ctypes.c_long]
                _user32.SetWindowLongW.restype = ctypes.c_long
                _ex = _user32.GetWindowLongW(_hwnd, GWL_EXSTYLE)
                _user32.SetWindowLongW(_hwnd, GWL_EXSTYLE, _ex | WS_EX_TOOLWINDOW)
                _user32.ShowWindow(_hwnd, 0)  # SW_HIDE
        except Exception:
            pass

    _do_hide()
    try:
        import threading
        for _delay in (0.3, 0.8, 1.5, 3.0):
            threading.Timer(_delay, _do_hide).start()
    except Exception:
        pass




def _ensure_dotnet_root():
    """pywebview 通过 clr_loader 加载 .NET，需定位系统 .NET 运行时目录。"""
    try:
        for c in (r"C:\Program Files\dotnet", r"C:\Program Files (x86)\dotnet"):
            if os.path.isdir(c):
                os.environ.setdefault("DOTNET_ROOT", c)
                return c
    except Exception:
        pass
    return None
def main():
    _hide_console()
    _ensure_dotnet_root()
    backend.os.makedirs(backend.UPLOAD_DIR, exist_ok=True)
    port = 8000
    httpd = ThreadingHTTPServer(("127.0.0.1", port), backend.Handler)
    t = threading.Thread(target=httpd.serve_forever, daemon=True)
    t.start()
    url = f"http://127.0.0.1:{port}"
    print(f"小说写作软件已启动: {url}")

    try:
        import webview
        webview.create_window(
            "小说写作软件 · Novel Studio",
            url,
            width=1200,
            height=800,
            min_size=(960, 640),
        )
        webview.start()
    except Exception as e:
        import traceback as _tb
        _log("WebView 启动失败:\n" + "".join(_tb.format_exception(type(e), e)))
        _tb.print_exc()
        # 不跳浏览器，仅记录日志便于定位
    finally:
        httpd.shutdown()


if __name__ == "__main__":
    import sys
    import traceback as _tb

    # 将 stdout/stderr 重定向到日志，便于捕获打包运行时的真实报错
    _RUNLOG = os.path.join(
        os.path.dirname(os.path.abspath(sys.executable)), "app_run.log"
    )
    try:
        sys.stdout = open(_RUNLOG, "w", encoding="utf-8")
        sys.stderr = sys.stdout
    except Exception:
        pass

    def _run():
        try:
            main()
        except Exception:
            try:
                log = os.path.join(
                    os.path.dirname(os.path.abspath(sys.executable)),
                    "app_error.log",
                )
                with open(log, "w", encoding="utf-8") as f:
                    _tb.print_exc(file=f)
            except Exception:
                pass
            raise

    _run()
