/* ==================================================================
 * 图片识别 OCR：将图片中的文字提取出来
 * 支持两种模式：
 *   1. AI 视觉识别（调用已配置的大模型视觉接口）
 *   2. 本地 OCR（Tesseract.js，浏览器端运行，支持中英文）
 * ================================================================== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  let ocrMode = "ai";
  let ocrType = "both";
  let images = []; // {file, dataUrl, name}
  let recognizing = false;
  let tesseractLoaded = false;
  let tesseractWorker = null;

  /* ---------- 工具 ---------- */
  function setStatus(msg) {
    const el = document.getElementById("status-text");
    if (el) el.textContent = msg;
  }
  function findNode(id, list) {
    list = list || (data && data.children) || [];
    for (const n of list) {
      if (n.id === id) return n;
      if (n.children) { const f = findNode(id, n.children); if (f) return f; }
    }
    return null;
  }

  /* ---------- 图片加载与预览 ---------- */
  function handleFiles(fileList) {
    const files = Array.from(fileList || []).filter(f => f.type.startsWith("image/"));
    if (!files.length) { alert("请选择图片文件"); return; }

    let loaded = 0;
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = () => {
        images.push({ file, dataUrl: reader.result, name: file.name });
        loaded++;
        if (loaded === files.length) {
          renderPreview();
          updateRunButton();
          setStatus(`已添加 ${files.length} 张图片，共 ${images.length} 张待识别`);
        }
      };
      reader.onerror = () => { loaded++; if (loaded === files.length) renderPreview(); };
      reader.readAsDataURL(file);
    });
  }

  function renderPreview() {
    const preview = $("#ocr-preview");
    const list = $("#ocr-preview-list");
    if (!images.length) {
      preview.classList.add("hidden");
      list.innerHTML = "";
      return;
    }
    preview.classList.remove("hidden");
    $("#ocr-img-count").textContent = images.length;
    list.innerHTML = images.map((img, i) => `
      <div class="ocr-thumb" data-idx="${i}">
        <img src="${img.dataUrl}" alt="${esc(img.name)}">
        <div class="ocr-thumb-name" title="${esc(img.name)}">${esc(img.name)}</div>
        <button class="ocr-thumb-del" data-idx="${i}" title="移除">✕</button>
      </div>
    `).join("");

    // 绑定删除
    list.querySelectorAll(".ocr-thumb-del").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        images.splice(idx, 1);
        renderPreview();
        updateRunButton();
      });
    });
  }

  function updateRunButton() {
    const btn = $("#btn-ocr-run");
    btn.disabled = !images.length || recognizing;
  }

  function clearAll() {
    if (images.length || $("#ocr-result").textContent.trim()) {
      if (!confirm("确认清空所有图片和识别结果？")) return;
    }
    images = [];
    renderPreview();
    $("#ocr-result").innerHTML = "";
    $("#ocr-result-stats").textContent = "";
    $("#ocr-file").value = "";
    updateRunButton();
    setStatus("已清空");
  }

  /* ---------- AI 视觉理解 ---------- */
  async function recognizeAI() {
    const resultEl = $("#ocr-result");
    let allText = "";
    const typeName = { both: "全部（文字+画面）", text: "文字识别", describe: "画面描述" };

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      setStatus(`AI 识别中（${i + 1}/${images.length}）[${typeName[ocrType]}]：${img.name}`);

      try {
        const formData = new FormData();
        formData.append("image", img.file, img.name);
        formData.append("mode", ocrType);

        const res = await fetch("/api/ocr", {
          method: "POST",
          body: formData,
        }).then(r => r.json());

        if (!res.ok) {
          if (res.need_ai) {
            alert("AI 未配置，请在设置中填写 API 信息（需支持视觉识别的模型），或切换到「本地OCR」模式（仅文字识别）");
            return;
          }
          allText += `\n\n===== ${img.name}（识别失败）=====\n${res.error || "未知错误"}\n`;
          continue;
        }

        const text = (res.text || "").trim();
        allText += `\n\n===== ${img.name} =====\n${text}\n`;

      } catch (e) {
        allText += `\n\n===== ${img.name}（识别失败）=====\n${e.message}\n`;
      }

      // 实时更新结果
      resultEl.textContent = allText.trim();
      updateStats();
    }

    setStatus(`AI 识别完成：${images.length} 张图片（${typeName[ocrType]}）`);
  }

  /* ---------- 本地 Tesseract OCR ---------- */
  async function loadTesseract() {
    if (tesseractLoaded) return true;
    setStatus("正在加载本地 OCR 引擎（首次使用需下载语言包）…");

    try {
      // 动态加载 Tesseract.js
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
        script.onload = resolve;
        script.onerror = () => reject(new Error("Tesseract.js 加载失败，请检查网络"));
        document.head.appendChild(script);
      });

      if (!window.Tesseract) {
        throw new Error("Tesseract.js 未正确加载");
      }

      tesseractLoaded = true;
      setStatus("本地 OCR 引擎加载完成");
      return true;
    } catch (e) {
      alert("本地 OCR 加载失败：" + e.message + "\n请切换到「AI 视觉识别」模式，或检查网络连接");
      setStatus("本地 OCR 加载失败");
      return false;
    }
  }

  async function recognizeTesseract() {
    if (!await loadTesseract()) return;

    const resultEl = $("#ocr-result");
    let allText = "";

    // 创建 worker（支持中英文）
    setStatus("正在初始化 OCR 引擎…");
    try {
      tesseractWorker = await window.Tesseract.createWorker(["chi_sim", "eng"], 1, {
        logger: m => {
          if (m.status === "recognizing text") {
            setStatus(`OCR 识别中… ${Math.round(m.progress * 100)}%`);
          }
        },
      });
    } catch (e) {
      alert("OCR 引擎初始化失败：" + e.message);
      setStatus("OCR 初始化失败");
      return;
    }

    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      setStatus(`OCR 识别中（${i + 1}/${images.length}）：${img.name}`);

      try {
        const { data } = await tesseractWorker.recognize(img.dataUrl);
        const text = (data.text || "").trim();
        allText += `\n\n===== ${img.name} =====\n${text}\n`;
      } catch (e) {
        allText += `\n\n===== ${img.name}（识别失败）=====\n${e.message}\n`;
      }

      resultEl.textContent = allText.trim();
      updateStats();
    }

    // 清理 worker
    try { if (tesseractWorker) await tesseractWorker.terminate(); } catch (e) {}
    tesseractWorker = null;

    setStatus(`本地 OCR 识别完成：${images.length} 张图片`);
  }

  /* ---------- 识别入口 ---------- */
  async function doRecognize() {
    if (recognizing || !images.length) return;

    // 本地 OCR 仅支持文字识别
    if (ocrMode === "tesseract" && ocrType !== "text") {
      if (!confirm("本地 OCR 仅支持文字识别，不支持画面描述。\n是否切换为「仅文字」模式继续？")) return;
      // 自动切换类型为 text
      $$("#ocr-type-seg button").forEach(x => x.classList.remove("active"));
      document.querySelector('#ocr-type-seg button[data-type="text"]').classList.add("active");
      ocrType = "text";
    }

    recognizing = true;
    updateRunButton();
    $("#ocr-result").innerHTML = "";
    $("#ocr-result-stats").textContent = "";

    try {
      if (ocrMode === "ai") {
        await recognizeAI();
      } else {
        await recognizeTesseract();
      }
    } catch (e) {
      alert("识别出错：" + e.message);
      setStatus("识别失败");
    } finally {
      recognizing = false;
      updateRunButton();
    }
  }

  /* ---------- 结果操作 ---------- */
  function updateStats() {
    const text = $("#ocr-result").textContent || "";
    const chars = text.length;
    const lines = text.split(/\n/).filter(l => l.trim()).length;
    $("#ocr-result-stats").textContent = `${chars.toLocaleString()} 字 · ${lines} 行`;
  }

  function copyResult() {
    const text = $("#ocr-result").textContent;
    if (!text.trim()) { alert("没有可复制的内容"); return; }
    navigator.clipboard.writeText(text).then(
      () => setStatus("已复制识别结果到剪贴板"),
      () => alert("复制失败，请手动选择复制")
    );
  }

  function exportTxt() {
    const text = $("#ocr-result").textContent;
    if (!text.trim()) { alert("没有可导出的内容"); return; }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `OCR识别结果_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已导出识别结果 TXT");
  }

  function saveAsChapter() {
    const text = $("#ocr-result").textContent;
    if (!text.trim()) { alert("没有可保存的内容"); return; }

    const novels = ((data && data.children) || []).filter(n => n.type === "novel");
    if (!novels.length) { alert("请先在写作界面新建一本小说"); return; }

    // 选择小说
    const novelList = novels.map((n, i) => `${i + 1}. ${n.name}`).join("\n");
    const novelInput = prompt(`选择要保存到的小说（输入序号）：\n\n${novelList}`, "1");
    if (!novelInput) return;
    const novelIdx = parseInt(novelInput) - 1;
    if (isNaN(novelIdx) || novelIdx < 0 || novelIdx >= novels.length) {
      alert("序号无效"); return;
    }
    const novel = novels[novelIdx];

    // 输入章节名
    const chapterName = prompt("请输入章节名称：", "OCR识别章节 " + new Date().toLocaleString());
    if (!chapterName) return;

    // 找到或创建第一个卷
    let volume = (novel.children || []).find(c => c.type === "volume");
    if (!volume) {
      volume = { id: "vol_" + Date.now(), type: "volume", name: "第一卷", children: [] };
      novel.children = novel.children || [];
      novel.children.push(volume);
    }

    // 创建章节
    const chapter = {
      id: "ch_" + Date.now(),
      type: "chapter",
      name: chapterName,
      content: text,
    };
    volume.children = volume.children || [];
    volume.children.push(chapter);

    // 保存数据
    if (typeof saveData === "function") saveData();
    else if (typeof window.saveData === "function") window.saveData();

    // 触发数据变更事件
    document.dispatchEvent(new CustomEvent("novel:data-changed"));

    setStatus(`已保存为章节「${chapterName}」到小说「${novel.name}」`);
    alert(`保存成功！\n小说：${novel.name}\n章节：${chapterName}\n字数：${text.length.toLocaleString()}`);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // 识别类型切换
    $$("#ocr-type-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#ocr-type-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      ocrType = b.dataset.type;
      const names = { both: "全部（文字+画面描述）", text: "仅文字识别", describe: "仅画面描述" };
      setStatus(`识别类型：${names[ocrType]}`);
    }));

    // 引擎模式切换
    $$("#ocr-mode-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#ocr-mode-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      ocrMode = b.dataset.mode;
      setStatus(`已切换到${ocrMode === "ai" ? "AI 视觉理解" : "本地 OCR（仅文字）"}模式`);
    }));

    // 文件选择
    $("#btn-ocr-upload").addEventListener("click", () => $("#ocr-file").click());
    $("#ocr-file").addEventListener("change", e => {
      if (e.target.files.length) handleFiles(e.target.files);
    });

    // 识别
    $("#btn-ocr-run").addEventListener("click", doRecognize);

    // 结果操作
    $("#btn-ocr-copy").addEventListener("click", copyResult);
    $("#btn-ocr-save").addEventListener("click", saveAsChapter);
    $("#btn-ocr-export").addEventListener("click", exportTxt);
    $("#btn-ocr-clear").addEventListener("click", clearAll);

    // 结果编辑时更新统计
    $("#ocr-result").addEventListener("input", updateStats);

    // 拖拽上传
    const wrap = $("#ocr-wrap");
    const zone = $("#ocr-drop-zone");
    let dragCounter = 0;
    wrap.addEventListener("dragenter", e => {
      e.preventDefault();
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
        dragCounter++; zone.classList.add("active");
      }
    });
    wrap.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    wrap.addEventListener("dragleave", e => {
      e.preventDefault(); dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; zone.classList.remove("active"); }
    });
    wrap.addEventListener("drop", e => {
      e.preventDefault(); dragCounter = 0; zone.classList.remove("active");
      const files = e.dataTransfer.files;
      if (files && files.length) handleFiles(files);
    });

    // 点击拖拽区域也可选择文件
    zone.addEventListener("click", () => $("#ocr-file").click());

    document.addEventListener("novel:view-changed", e => {
      if (e.detail.view === "ocr") {
        // 进入视图时刷新状态
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
