# novel-writer

基于 **Python + Flask + pywebview** 开发的本地小说写作桌面工具。数据本地存储、无需联网，可打包为独立 EXE 运行，并以本地原生窗口打开（不依赖浏览器跳转）。

## 功能特性

- 目录树管理小说结构：卷、章、大纲、人设、人物关系、灵感、故事线
- 右键菜单：新建 / 重命名 / 删除节点
- Ctrl/Shift 多选，支持批量删除
- 双击节点编辑正文，右键设置字号、颜色、加粗
- 拖拽排序，节点可拖出分屏
- 上传图片自定义界面背景
- 导出文本
- 日间 / 夜间 / 护眼三种界面模式

## 环境要求

- Python 3.10+
- 依赖：`Flask`、`pywebview`
- Windows 需安装 WebView2 运行时（Win10/11 一般自带）

## 运行

```bash
pip install flask pywebview
python novel_app.py
```

或直接运行打包产物 `dist/NovelStudio/NovelStudio.exe`。

## 打包为 EXE

```bash
pyinstaller NovelStudio.spec
```

输出位于 `dist/NovelStudio/`（onedir 文件夹形态，稳定性更好）。

## 目录结构

```
novel_app.py        # 桌面窗口入口（pywebview 拉起本地窗口）
app.py              # Flask 后端
static/             # 前端界面（HTML/CSS/JS）
assets/             # 图标等资源
NovelStudio.spec    # PyInstaller 打包配置
```
