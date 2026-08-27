# 📝 novel-writer 小说写作软件

基于 **Python + Flask + pywebview** 开发的本地小说写作桌面工具。现代化 Web 界面，数据本地存储、无需联网，绿色免安装，以本地原生窗口打开（不跳转浏览器）。

<p align="center">
  <img src="https://raw.githubusercontent.com/YUNHAN6688/novel-writer/main/screenshot-dark.png" width="720" />
</p>

## ✨ 功能特性

- 📚 目录树管理小说结构：小说、卷、章、大纲、人设、人物关系、灵感、故事线
- ✍️ 文本编辑：右键设置字号、颜色、加粗
- 📤 导出文本
- 🗑️ Ctrl/Shift 多选，支持批量删除
- 🔀 拖拽排序，节点可拖出分屏
- 🖼️ 上传图片自定义界面背景
- 🌓 日光 / 夜晚 / 护眼三种界面模式
- 📦 打包为独立 EXE，绿色免安装

## 📥 快速开始（推荐）

无需安装 Python，直接下载安装包：

1. 下载安装包 👉 **[novel-writer-v2.0-windows.zip](https://github.com/YUNHAN6688/novel-writer/releases/download/v2.0/novel-writer-v2.0-windows.zip)**（15.1 MB）
2. 解压到本地文件夹（请勿直接在压缩包内运行）
3. 双击 `NovelStudio.exe` 即可运行

> 也可在 [Releases 页面](https://github.com/YUNHAN6688/novel-writer/releases) 查看所有版本。

## 📖 使用说明

### 界面介绍

![夜晚模式](https://raw.githubusercontent.com/YUNHAN6688/novel-writer/main/screenshot-dark.png)

- **顶部工具栏**：新建小说、导出文本、批量删除、界面模式、界面设置、保存
- **左侧目录树**：管理小说结构，不同节点类型用彩色圆点区分
- **右侧编辑区**：双击节点后打开编辑器
- **底部状态栏**：操作提示与状态

### 基本操作

| 操作 | 方法 |
| --- | --- |
| 新建小说 | 点击左上角「＋ 新建小说」 |
| 新建节点 | 在节点上**右键**，选择类型（卷 / 章 / 大纲 / 人设等） |
| 编辑内容 | **双击**节点，右侧编辑后点「💾 保存」 |
| 字号 / 颜色 / 加粗 | 编辑区内**右键** |
| 重命名 / 删除 | 右键节点 → 重命名 / 删除 |
| 批量删除 | 按住 `Ctrl` / `Shift` 多选 → 点「批量删除」 |
| 拖动排序 | 按住节点上下拖动 |
| 导出文本 | 点击「导出文本」 |

### 界面模式

点击「界面模式」可切换：☀️ 日光模式 / 🌙 夜晚模式 / 👁️ 护眼模式，还支持上传图片自定义背景。

![日光模式](https://raw.githubusercontent.com/YUNHAN6688/novel-writer/main/screenshot-light.png)

## 💻 从源码运行

环境要求：Python 3.10+，Windows 需安装 WebView2 运行时（Win10/11 一般自带）。

```bash
pip install flask pywebview
python novel_app.py
```

不想配置环境？直接 👉 **[下载安装包](#-快速开始推荐)** 解压运行即可。

## 📦 打包为 EXE

```bash
pyinstaller NovelStudio.spec
```

输出位于 `dist/NovelStudio/`（onedir 文件夹形态，稳定性更好），打包后可压缩为 zip 分发。

## 📂 项目结构

```
novel_app.py        # 桌面窗口入口（pywebview 拉起本地窗口）
app.py              # Flask 后端
static/             # 前端界面（HTML/CSS/JS）
assets/             # 图标等资源
NovelStudio.spec    # PyInstaller 打包配置
```

## ❓ 常见问题

**Q：运行 exe 会弹黑色控制台窗口吗？**
A：不会。v2.0 使用 pywebview 原生窗口，已去除黑色控制台。

**Q：双击 exe 没反应？**
A：请先完整解压 zip 再运行；确认 `NovelStudio.exe` 与 `_internal` 文件夹在同一目录；杀毒软件误报请添加信任。

**Q：需要联网吗？数据存在哪？**
A：不需要联网，程序完全本地运行，数据以 JSON 格式保存在程序目录下。

更多问题见 [Wiki - 常见问题](https://github.com/YUNHAN6688/novel-writer/wiki/常见问题)。

## 🕘 版本历史

| 版本 | 说明 |
| --- | --- |
| [v2.0](https://github.com/YUNHAN6688/novel-writer/releases/tag/v2.0) | Flask + pywebview 重构，现代化界面，新增导出 / 批量删除 / 主题切换 / 自定义背景 |
| [v1.0](https://github.com/YUNHAN6688/novel-writer/releases/tag/v1.0) | 基于 Tkinter 的初版 |

## 📚 完整文档

更多文档请查看 [Wiki](https://github.com/YUNHAN6688/novel-writer/wiki)：
- [使用说明](https://github.com/YUNHAN6688/novel-writer/wiki/使用说明)
- [程序截图](https://github.com/YUNHAN6688/novel-writer/wiki/程序截图)
- [项目结构](https://github.com/YUNHAN6688/novel-writer/wiki/项目结构)
- [常见问题](https://github.com/YUNHAN6688/novel-writer/wiki/常见问题)
- [版本历史](https://github.com/YUNHAN6688/novel-writer/wiki/版本历史)
