/* ==================================================================
 * 漫剧提示词：将小说转换为 AI 漫剧/视频生成提示词
 * ================================================================== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

  let currentNovelId = null;
  let convertMode = "ai";
  let converting = false;
  let externalText = "";
  let externalName = "";
  let prompts = [];

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
  function decodeBuffer(buf) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); }
    catch (e) {
      try { return new TextDecoder("gbk").decode(buf); }
      catch (e2) { return new TextDecoder("utf-8").decode(buf); }
    }
  }

  /* ---------- 小说/章节选择 ---------- */
  function getNovels() {
    return ((data && data.children) || []).filter(n => n.type === "novel");
  }
  function refreshNovelSelect() {
    const sel = $("#comic-novel");
    const novels = getNovels();
    sel.innerHTML = novels.map(n =>
      `<option value="${n.id}">${esc(n.name)}</option>`
    ).join("");
    if (novels.length) {
      if (!currentNovelId || !novels.find(n => n.id === currentNovelId)) {
        currentNovelId = novels[0].id;
      }
      sel.value = currentNovelId;
      refreshChapterSelect();
    }
  }
  function refreshChapterSelect() {
    const sel = $("#comic-chapter");
    const novel = findNode(currentNovelId);
    if (!novel) { sel.innerHTML = '<option value="__all__">全书所有章节</option>'; return; }
    const opts = ['<option value="__all__">全书所有章节</option>'];
    (novel.children || []).forEach(vol => {
      if (vol.type !== "volume") return;
      (vol.children || []).forEach(ch => {
        if (ch.type === "chapter") {
          opts.push(`<option value="${ch.id}">${esc(vol.name)} · ${esc(ch.name)}</option>`);
        }
      });
    });
    sel.innerHTML = opts.join("");
  }
  function getSelectedChapters() {
    const novel = findNode(currentNovelId);
    if (!novel) return [];
    const chVal = $("#comic-chapter").value;
    const result = [];
    (novel.children || []).forEach(vol => {
      if (vol.type !== "volume") return;
      (vol.children || []).forEach(ch => {
        if (ch.type !== "chapter") return;
        if (chVal === "__all__" || ch.id === chVal) {
          result.push({ volume: vol.name, node: ch });
        }
      });
    });
    return result;
  }

  /* ---------- 外部 TXT 导入 ---------- */
  function loadExternalFile(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type && !file.type.includes("text")) {
      alert("请选择 TXT 文本文件"); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let text = decodeBuffer(reader.result);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      externalText = text;
      externalName = file.name.replace(/\.[^.]+$/, "");
      updateSourceTag();
      setStatus(`已导入：${file.name}（${text.length.toLocaleString()} 字）`);
    };
    reader.onerror = () => alert("文件读取失败");
    reader.readAsArrayBuffer(file);
  }
  function updateSourceTag() {
    const tag = $("#comic-source-tag");
    if (externalText) {
      tag.classList.remove("hidden");
      tag.innerHTML = `📄 ${esc(externalName)} <span class="x" title="移除">✕</span>`;
      tag.querySelector(".x").addEventListener("click", clearExternal);
    } else {
      tag.classList.add("hidden"); tag.innerHTML = "";
    }
  }
  function clearExternal() {
    externalText = ""; externalName = "";
    updateSourceTag(); $("#comic-file").value = "";
    setStatus("已移除外部文件");
  }

  /* ---------- 模板生成（规则模式） ---------- */
  function splitTextToScenes(text) {
    const CN = "一二三四五六七八九十百千零〇两";
    const chRe = new RegExp(`^[\\s　]*第[${CN}\\d]+[章回节][\\s\\u3000:：、．.．]*(.*)$`);
    const lines = text.split(/\r\n|\r|\n/);
    const scenes = [];
    let current = { name: "开场", content: [] };
    for (const line of lines) {
      const t = line.trim();
      if (t.length > 0 && t.length <= 60 && chRe.test(t)) {
        if (current.name || current.content.length) scenes.push(current);
        current = { name: t, content: [] };
      } else { current.content.push(line); }
    }
    if (current.name || current.content.length) scenes.push(current);
    if (!scenes.length) scenes.push({ name: "正文", content: [text] });
    return scenes;
  }

  const CAMERA_ANGLES = ["特写镜头", "中景镜头", "全景镜头", "俯拍镜头", "仰拍镜头", "过肩镜头", "推镜头", "拉镜头", "摇镜头", "跟拍镜头"];
  const MOODS = ["紧张", "舒缓", "悲伤", "喜悦", "神秘", "热血", "温馨", "悬疑", "震撼", "孤独"];

  function generateRulePrompt(scene, index, title) {
    const content = scene.content.join("\n").trim();
    if (!content) return null;

    // 提取对话
    const dialogues = [];
    const quoteRe = /["""]([^"""]{1,80})["""]/g;
    let m;
    while ((m = quoteRe.exec(content)) !== null) {
      dialogues.push(m[1]);
    }

    // 提取动作描述（去掉对话和说话引导语）
    const actionText = content
      .replace(/["""][^"""]+["""]/g, "")
      .replace(/[，,]?\s*(?:缓缓|淡淡|轻声|高声|低声|大声|冷冷|微微|默默|喃喃|沉声|厉声|随即|连忙|急忙)?\s*(?:笑道|问道|答道|叫道|喊道|骂道|吼道|怒道|叹道|说道|续道|道|说|问|答|叫|喊|笑|骂|吼|叹|喃喃)\s*[：:]?/g, "")
      .replace(/\s+/g, " ").trim().substring(0, 200);

    // 简单推断场景
    let location = "室内";
    if (/山|林|野|外|街|路|河|海|天|云|风|雨|雪|城|村|镇/.test(content)) location = "室外";
    let timeOfDay = "白天";
    if (/夜|晚|暮|昏|星|月|灯|暗/.test(content)) timeOfDay = "夜晚";
    if (/晨|早|曦|朝阳|日出/.test(content)) timeOfDay = "清晨";
    if (/黄昏|夕阳|落日|傍晚/.test(content)) timeOfDay = "黄昏";

    const camera = CAMERA_ANGLES[index % CAMERA_ANGLES.length];
    const mood = MOODS[index % MOODS.length];

    let prompt = `【镜头 ${index + 1}】${scene.name}\n\n`;
    prompt += `画面描述：${location}，${timeOfDay}。${actionText || "角色处于场景中，氛围凝重。"}\n\n`;
    prompt += `镜头语言：${camera}，画面节奏${mood === "紧张" || mood === "悬疑" ? "紧凑" : "舒缓"}，整体氛围${mood}。\n\n`;
    if (dialogues.length) {
      prompt += `台词：\n`;
      dialogues.slice(0, 3).forEach((d, i) => {
        prompt += `${i + 1}. "${d}"\n`;
      });
      prompt += `\n`;
    }
    prompt += `风格参考：国漫风格，电影级画质，细腻光影，氛围感强，角色表情生动，色彩饱和度适中。\n`;
    prompt += `负面提示：低质量，模糊，变形，多余手指，文字水印，丑陋面部。`;

    return {
      num: index + 1,
      title: scene.name,
      prompt: prompt,
      chars: content.length,
      dialogues: dialogues.length,
    };
  }

  function ruleConvert(text, title) {
    const scenes = splitTextToScenes(text);
    const results = [];
    let shotNum = 0;
    scenes.forEach((scene) => {
      const p = generateRulePrompt(scene, shotNum, title);
      if (p) { shotNum++; p.num = shotNum; results.push(p); }
    });
    return results;
  }

  /* ---------- AI 生成 ---------- */
  async function aiConvert(text, title) {
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      const useRule = confirm("AI 未配置，是否使用「模板生成」？");
      if (useRule) return ruleConvert(text, title);
      return null;
    }

    const MAX = 10000;
    let truncated = false;
    if (text.length > MAX) { text = text.substring(0, MAX); truncated = true; }

    const sys = `你是专业的 AI 漫剧提示词工程师。将小说片段转换为适合 AI 视频/漫画生成工具（如即梦、可灵、Runway）的分镜提示词。

严格输出 JSON 数组，每个元素代表一个镜头：
{
  "num": 镜头序号,
  "title": "场景/镜头标题",
  "prompt": "完整的生成提示词",
  "chars": 对应正文字数,
  "dialogues": 对话数量
}

prompt 字段必须包含以下结构（用中文）：
1. 画面描述：场景地点、时间、环境氛围、角色动作和表情
2. 镜头语言：景别（特写/中景/全景）、运镜方式、构图
3. 台词：角色对话（如有）
4. 风格参考：画风、画质、光影、色彩
5. 负面提示：需要避免的元素

要求：
- 按情节转折分镜，每个镜头 1-3 句话核心动作
- 画面描述要具体、可视化，避免抽象词汇
- 角色外貌和服装要保持一致性描述
- 只输出 JSON 数组，不要解释文字`;

    const user = `小说《${title || "未命名"}》\n请将以下内容转换为 AI 漫剧分镜提示词：\n${text}${truncated ? "\n\n（原文较长，以上为前半部分）" : ""}`;

    setStatus("AI 正在生成漫剧提示词…");
    const res = await fetch("/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.6, max_tokens: 8192,
      }),
    }).then(r => r.json());

    if (!res.ok) { alert("AI 生成失败：" + (res.error || "未知错误")); setStatus("生成失败"); return null; }

    let elements = null;
    try { elements = JSON.parse(res.content); } catch (e) {
      const match = res.content.match(/\[[\s\S]*\]/);
      if (match) { try { elements = JSON.parse(match[0]); } catch (e2) {} }
    }
    if (!Array.isArray(elements)) {
      setStatus("AI 返回格式异常，已按纯文本显示");
      return [{ num: 1, title: "全文", prompt: res.content, chars: text.length, dialogues: 0 }];
    }
    return elements.filter(e => e && e.prompt).map(e => ({
      num: e.num || 0,
      title: e.title || "镜头",
      prompt: String(e.prompt),
      chars: e.chars || 0,
      dialogues: e.dialogues || 0,
    }));
  }

  /* ---------- 渲染 ---------- */
  function renderPrompts(list) {
    prompts = list || [];
    const editor = $("#comic-editor");
    if (!prompts.length) { editor.innerHTML = ""; return; }
    editor.innerHTML = prompts.map(p => `
      <div class="comic-prompt">
        <div class="comic-prompt-header">
          <span class="comic-prompt-num">镜头 ${p.num}</span>
          <span class="comic-prompt-title">${esc(p.title)}</span>
        </div>
        <div class="comic-prompt-body">${esc(p.prompt)}</div>
        <div class="comic-prompt-meta">
          <span>📝 ${p.chars} 字</span>
          <span>💬 ${p.dialogues} 句对话</span>
        </div>
      </div>
    `).join("");
  }

  /* ---------- 一句话生成提示词 ---------- */
  async function quickGenerate() {
    if (converting) return;
    const input = $("#comic-quick-input");
    const sentence = input.value.trim();
    if (!sentence) { alert("请输入一句话描述"); input.focus(); return; }

    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      alert("AI 未配置，请先在设置中配置 AI 接口"); return;
    }

    converting = true;
    const btn = $("#btn-comic-quick");
    btn.disabled = true; btn.textContent = "⏳ 生成中…";

    const sys = `你是专业的 AI 漫剧提示词工程师。根据用户的一句话描述，扩展为适合 AI 视频/漫画生成工具（如即梦、可灵、Runway）的分镜提示词。

严格输出 JSON 数组，每个元素代表一个镜头：
{
  "num": 镜头序号,
  "title": "场景/镜头标题",
  "prompt": "完整的生成提示词",
  "chars": 对应正文字数,
  "dialogues": 对话数量
}

prompt 字段必须包含以下结构（用中文）：
1. 画面描述：场景地点、时间、环境氛围、角色动作和表情
2. 镜头语言：景别（特写/中景/全景）、运镜方式、构图
3. 台词：角色对话（如有）
4. 风格参考：画风、画质、光影、色彩
5. 负面提示：需要避免的元素

要求：
- 根据描述合理分镜，3-8 个镜头
- 画面描述要具体、可视化，避免抽象词汇
- 角色外貌和服装要保持一致性描述
- 只输出 JSON 数组，不要解释文字`;

    const user = `一句话描述：${sentence}\n\n请根据这句话扩展为完整的 AI 漫剧分镜提示词。`;

    try {
      setStatus("AI 正在根据一句话生成漫剧提示词…");
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "system", content: sys },
            { role: "user", content: user },
          ],
          temperature: 0.7, max_tokens: 8192,
        }),
      }).then(r => r.json());

      if (!res.ok) { alert("AI 生成失败：" + (res.error || "未知错误")); setStatus("生成失败"); return; }

      let elements = null;
      try { elements = JSON.parse(res.content); } catch (e) {
        const match = res.content.match(/\[[\s\S]*\]/);
        if (match) { try { elements = JSON.parse(match[0]); } catch (e2) {} }
      }
      if (!Array.isArray(elements)) {
        renderPrompts([{ num: 1, title: "生成结果", prompt: res.content, chars: sentence.length, dialogues: 0 }]);
        setStatus("AI 返回非 JSON，已按纯文本显示");
        return;
      }
      const results = elements.filter(e => e && e.prompt).map(e => ({
        num: e.num || 0, title: e.title || "镜头",
        prompt: String(e.prompt), chars: e.chars || 0, dialogues: e.dialogues || 0,
      }));
      renderPrompts(results);
      setStatus(`一句话生成完成：${results.length} 个镜头`);
    } catch (e) {
      alert("生成出错：" + e.message); setStatus("生成失败");
    } finally {
      converting = false;
      btn.disabled = false; btn.textContent = "✨ 生成";
    }
  }

  /* ---------- 转换入口 ---------- */
  async function doConvert() {
    if (converting) return;
    let text = "", title = "";

    if (externalText) {
      text = externalText; title = externalName;
    } else {
      const chapters = getSelectedChapters();
      if (!chapters.length) { alert("请先选择小说章节，或导入外部 TXT"); return; }
      const empty = chapters.filter(c => !c.node.content || !c.node.content.trim());
      if (empty.length === chapters.length) { alert("所选章节没有正文内容"); return; }
      const novel = findNode(currentNovelId);
      title = novel ? novel.name : "小说";
      chapters.forEach(({ volume, node: ch }) => {
        text += `\n\n===== ${ch.name} =====\n${ch.content || ""}`;
      });
    }

    converting = true;
    const btn = $("#btn-comic-convert");
    btn.disabled = true; btn.textContent = "⏳ 生成中…";

    try {
      let results;
      if (convertMode === "ai") {
        results = await aiConvert(text, title);
      } else {
        results = ruleConvert(text, title);
      }
      if (results) {
        renderPrompts(results);
        setStatus(`漫剧提示词生成完成：${results.length} 个镜头`);
      }
    } catch (e) {
      alert("生成出错：" + e.message); setStatus("生成失败");
    } finally {
      converting = false;
      btn.disabled = false; btn.textContent = "🎨 生成提示词";
    }
  }

  /* ---------- 保存/加载 ---------- */
  async function savePrompts() {
    if (!prompts.length) { alert("没有可保存的提示词"); return; }
    const name = prompt("请输入保存名称：", externalName || "漫剧提示词 " + new Date().toLocaleString());
    if (!name) return;
    try {
      const res = await fetch("/api/comic/drama", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompts }),
      }).then(r => r.json());
      if (res.ok) {
        setStatus(`已保存到漫剧库：${name}`);
      } else {
        alert("保存失败：" + (res.error || "未知错误"));
      }
    } catch (e) {
      alert("保存失败：" + e.message);
    }
  }

  async function loadPrompts() {
    try {
      const res = await fetch("/api/comic/drama").then(r => r.json());
      const items = (res && res.items) || [];
      if (!items.length) { alert("漫剧库为空"); return; }

      const list = items.map((it, i) => `${i + 1}. ${it.name}（${it.count}个镜头，${it.created}）`).join("\n");
      const input = prompt(`请输入要加载的序号：\n\n${list}\n\n输入序号加载，输入 "d序号" 删除（如 d1）：`, "1");
      if (!input) return;

      const delMatch = input.match(/^d\s*(\d+)$/i);
      if (delMatch) {
        const idx = parseInt(delMatch[1]) - 1;
        if (idx < 0 || idx >= items.length) { alert("序号无效"); return; }
        if (!confirm(`确认删除「${items[idx].name}」？`)) return;
        const delRes = await fetch(`/api/comic/drama/${items[idx].id}`, { method: "POST" }).then(r => r.json());
        if (delRes.ok) { setStatus("已删除"); } else { alert("删除失败"); }
        return;
      }

      const idx = parseInt(input) - 1;
      if (isNaN(idx) || idx < 0 || idx >= items.length) { alert("序号无效"); return; }
      renderPrompts(items[idx].prompts);
      externalName = items[idx].name;
      setStatus(`已加载：${items[idx].name}（${items[idx].count}个镜头）`);
    } catch (e) {
      alert("加载失败：" + e.message);
    }
  }

  /* ---------- 复制/导出 ---------- */
  function getAllText() {
    if (!prompts.length) return "";
    return prompts.map(p =>
      `===== 镜头 ${p.num}：${p.title} =====\n${p.prompt}\n`
    ).join("\n");
  }
  function copyAll() {
    const text = getAllText();
    if (!text) { alert("没有可复制的内容"); return; }
    navigator.clipboard.writeText(text).then(
      () => setStatus("已复制全部提示词到剪贴板"),
      () => alert("复制失败，请手动选择复制")
    );
  }
  function exportTxt() {
    const text = getAllText();
    if (!text) { alert("没有可导出的内容"); return; }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${externalName || "漫剧提示词"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已导出漫剧提示词 TXT");
  }

  /* ---------- 初始化 ---------- */
  function init() {
    refreshNovelSelect();

    $("#comic-novel").addEventListener("change", e => {
      currentNovelId = e.target.value; refreshChapterSelect();
    });
    $$("#comic-mode-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#comic-mode-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active"); convertMode = b.dataset.mode;
    }));
    $("#btn-comic-convert").addEventListener("click", doConvert);
    $("#btn-comic-quick").addEventListener("click", quickGenerate);
    $("#comic-quick-input").addEventListener("keydown", e => {
      if (e.key === "Enter") quickGenerate();
    });
    $("#btn-comic-save").addEventListener("click", savePrompts);
    $("#btn-comic-load").addEventListener("click", loadPrompts);
    $("#btn-comic-copy").addEventListener("click", copyAll);
    $("#btn-comic-export").addEventListener("click", exportTxt);

    // 外部导入
    $("#btn-comic-import").addEventListener("click", () => $("#comic-file").click());
    $("#comic-file").addEventListener("change", e => {
      if (e.target.files[0]) loadExternalFile(e.target.files[0]);
    });

    // 拖拽
    const wrap = $("#comic-wrap");
    const zone = $("#comic-drop-zone");
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
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadExternalFile(file);
    });

    document.addEventListener("novel:data-changed", refreshNovelSelect);
    document.addEventListener("novel:view-changed", e => {
      if (e.detail.view === "comic") refreshNovelSelect();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
