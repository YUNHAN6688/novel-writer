/* ==================================================================
 * 小说转剧本
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
  let scriptTemplate = "center"; // center: 居中格式, left: 靠左格式
  let converting = false;
  let externalText = "";   // 外部导入的 TXT 文本
  let externalName = "";   // 外部文件名

  /* ---------- 小说 / 章节选择 ---------- */
  function getNovels() {
    return ((data && data.children) || []).filter(n => n.type === "novel");
  }

  function refreshNovelSelect() {
    const sel = $("#script-novel");
    if (!sel) return;
    const novels = getNovels();
    const prev = currentNovelId;
    sel.innerHTML = novels.map(n =>
      `<option value="${getNodeId(n)}">${esc(n.name)}</option>`).join("");
    if (prev && novels.some(n => getNodeId(n) === prev)) {
      sel.value = prev; currentNovelId = prev;
    } else if (novels.length) {
      currentNovelId = getNodeId(novels[0]); sel.value = currentNovelId;
    } else currentNovelId = null;
    refreshChapterSelect();
  }

  function refreshChapterSelect() {
    const sel = $("#script-chapter");
    if (!sel) return;
    const novel = findNode(currentNovelId);
    let html = `<option value="__all__">全书所有章节</option>`;
    if (novel) {
      (novel.children || []).forEach(v => {
        if (v.type === "volume") {
          (v.children || []).forEach(c => {
            if (c.type === "chapter") {
              html += `<option value="${getNodeId(c)}">${esc(v.name)} · ${esc(c.name)}</option>`;
            }
          });
        }
      });
    }
    sel.innerHTML = html;
  }

  function getSelectedChapters() {
    const novel = findNode(currentNovelId);
    if (!novel) return [];
    const chSel = $("#script-chapter").value;
    const chapters = [];
    (novel.children || []).forEach(v => {
      if (v.type === "volume") {
        (v.children || []).forEach(c => {
          if (c.type === "chapter" && (chSel === "__all__" || getNodeId(c) === chSel)) {
            chapters.push({ volume: v.name, node: c });
          }
        });
      }
    });
    return chapters;
  }

  /* ---------- 规则转换 ---------- */
  // 对话引导动词
  const SPEAK_VERBS = "(?:笑道|问道|答道|叫道|喊道|骂道|吼道|怒道|叹道|说道|答道|续道|低声道|高声道|冷冷道|淡淡道|缓缓道|轻声道|大声道|喃喃道|道|说|问|答|叫|喊|笑|骂|吼|叹|喃喃)";
  // 中文引号对
  const QUOTE_PAIRS = [
    { open: "\u201c", close: "\u201d" }, // ""
    { open: "\u300c", close: "\u300d" }, // 「」
    { open: "\u300e", close: "\u300f" }, // 『』
    { open: "\"", close: "\"" },
  ];

  function extractDialogues(text) {
    // 手动扫描引号对，提取对话和说话人（能跨过被跳过的拟声词看到前文）
    const results = [];
    for (const pair of QUOTE_PAIRS) {
      if (!text.includes(pair.open)) continue;
      const positions = [];
      let idx = 0;
      while (idx < text.length) {
        const openIdx = text.indexOf(pair.open, idx);
        if (openIdx < 0) break;
        const closeIdx = text.indexOf(pair.close, openIdx + 1);
        if (closeIdx < 0) break;
        positions.push({ open: openIdx, close: closeIdx });
        idx = closeIdx + 1;
      }
      if (!positions.length) continue;

      let prevEnd = 0;
      for (const pos of positions) {
        const dialogue = text.substring(pos.open + 1, pos.close);
        const before = text.substring(prevEnd, pos.open);
        const after = text.substring(pos.close + 1, pos.close + 16);
        const speaker = findSpeaker(before, after);
        // 无说话人且极短（≤2字）视为拟声/强调，跳过但保留在动作中
        if (!speaker && dialogue.length <= 2) {
          continue;
        }
        results.push({
          start: pos.open,
          end: pos.close + 1,
          speaker, dialogue,
        });
        prevEnd = pos.close + 1;
      }
      if (results.length) break;
    }
    return results;
  }

  // 常见副词，不当作人名
  const ADVERBS = new Set(["缓缓", "淡淡", "轻声", "高声", "低声", "大声", "冷冷", "微微",
    "默默", "暗暗", "徐徐", "匆匆", "连忙", "急忙", "沉声", "厉声", "随即", "继而",
    "哭着", "笑着", "叹了", "哼了", "点头", "点点", "摇头", "转身", "抬头",
    "低头", "睁眼", "闭眼", "心中", "心里", "眼中", "眼里", "脸上", "面色", "手中",
    "手里", "身上", "脚下", "不禁", "不由", "暗自", "赶紧", "连忙",
    "一声", "只听", "只见", "但见", "却说", "原来", "说着", "想着", "看着", "听着"]);

  function findSpeaker(before, after) {
    // 从 before 末尾找说话动词
    const verbList = ["笑道", "问道", "答道", "叫道", "喊道", "骂道", "吼道", "怒道", "叹道",
      "说道", "续道", "低声道", "高声道", "冷冷道", "淡淡道", "缓缓道", "轻声道", "大声道",
      "喃喃道", "沉声道", "厉声道", "笑着说", "哭着说", "道", "说", "问", "答",
      "叫", "喊", "笑", "骂", "吼", "叹", "喃喃"];

    let verb = "";
    let beforeVerb = before;
    for (const v of verbList) {
      const idx = before.length - v.length;
      if (idx >= 0 && before.substring(idx) === v) {
        verb = v;
        beforeVerb = before.substring(0, idx).replace(/[\s：:，,、]+$/, "");
        break;
      }
    }
    if (!verb) {
      const vm = before.match(new RegExp(`(${SPEAK_VERBS})\\s*[：:]\\s*$`));
      if (vm) {
        verb = vm[1];
        beforeVerb = before.substring(0, before.length - vm[0].length).replace(/[\s：:，,、]+$/, "");
      }
    }

    if (verb && beforeVerb) {
      // 从最后一个从句开始，向前找主语（2-3 汉字）
      const clauses = beforeVerb.split(/[，,。！？；;、]/).filter(s => s.trim());
      for (let i = clauses.length - 1; i >= 0; i--) {
        const name = extractName(clauses[i]);
        if (name) return name;
      }
    }

    // 无说话动词但以冒号结尾（如"阿飞抬起头，眼中闪过一丝惊喜："），取最后从句主语
    if (!verb && /[：:]\s*$/.test(before)) {
      const clauses = before.replace(/[：:]\s*$/, "").split(/[，,。！？；;、]/).filter(s => s.trim());
      for (let i = clauses.length - 1; i >= 0; i--) {
        const name = extractName(clauses[i]);
        if (name) return name;
      }
    }

    // 从引号后找：XXX道/说
    const afterMatch = after.match(new RegExp(`^\\s*[，,]?\\s*([\\u4e00-\\u9fa5A-Za-z·]{2,4})\\s*${SPEAK_VERBS}`));
    if (afterMatch) {
      const name = extractName(afterMatch[1]);
      if (name) return name;
    }

    return "";
  }

  // 从一段文本开头提取人名（2-3 汉字），跳过副词/动词开头
  const VERB_CHARS = new Set(["摸","看","听","说","道","笑","哭","打","走","跑","吃","喝",
    "想","做","来","去","起","坐","站","转","抬","低","睁","闭","点","摇","挥","迎","上",
    "下","出","入","进","退","拿","放","给","找","等","回","过","开","关","接","送","买",
    "卖","写","读","画","唱","跳","爬","飞","游","骑","推","拉","提","踩","踢","抓","握",
    "摸","拍","靠","叹","呼","吸","愣","惊","喜","怒","愁","怕","恨","爱","盼","望","瞪","闪"]);

  function extractName(text) {
    const m2 = text.match(/^[\s]*([\u4e00-\u9fa5A-Za-z·]{2})/);
    if (!m2) return "";
    const two = m2[1];
    if (ADVERBS.has(two)) return "";
    if (/^[了着过不没是非有无可很最都也就还又再把被]/.test(two)) return "";
    // 尝试取 3 字：第三字不是常见动词/助词时才用
    const m3 = text.match(/^[\s]*([\u4e00-\u9fa5A-Za-z·]{3})/);
    if (m3 && !ADVERBS.has(m3[1]) && !VERB_CHARS.has(m3[1][2]) && !/[了着过的是在有不没会能要想]/.test(m3[1][2])) {
      return m3[1];
    }
    return two;
  }

  function ruleConvert(chapters) {
    const elements = [];
    elements.push({ type: "title", text: chapters[0] ? findNode(currentNovelId).name : "剧本" });
    let sceneNum = 0;

    chapters.forEach(({ volume, node: ch }) => {
      sceneNum++;
      elements.push({ type: "scene", text: `第${toCNNum(sceneNum)}场　${ch.name}` });
      const content = (ch.content || "").trim();
      if (!content) {
        elements.push({ type: "action", text: "（本章无正文内容）" });
        return;
      }

      const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean);
      let lastSpeaker = "";
      paragraphs.forEach(para => {
        const dialogues = extractDialogues(para);
        if (!dialogues.length) {
          // 纯叙述/动作
          elements.push({ type: "action", text: para });
          return;
        }
        // 按对话切分段落
        let cursor = 0;
        dialogues.forEach(d => {
          // 对话前的叙述
          const beforeText = para.substring(cursor, d.start).trim();
          // 去掉末尾的说话人引导（说话人 + 副词 + 道/说：等）
          let actionBefore = beforeText;
          if (d.speaker) {
            actionBefore = beforeText
              .replace(new RegExp(`[，,]?\\s*(?:${d.speaker})?\\s*(?:缓缓|淡淡|轻声|高声|低声|大声|冷冷|微微|默默|喃喃|沉声|厉声|笑着|哭着|随即|连忙|急忙)?\\s*${SPEAK_VERBS}\\s*[：:]?\\s*$`), "")
              .replace(/[，,：:\s]+$/, "")
              .trim();
          }
          if (actionBefore) elements.push({ type: "action", text: actionBefore });
          // 对话：无明确说话人时沿用上一个
          const speaker = d.speaker || lastSpeaker;
          if (d.speaker) lastSpeaker = d.speaker;
          elements.push({ type: "character", text: speaker || "旁白" });
          elements.push({ type: "dialogue", text: d.dialogue });
          cursor = d.end;
        });
        // 对话后的叙述
        const afterText = para.substring(cursor).replace(/^[，,。！？\s]*/, "").trim();
        if (afterText) elements.push({ type: "action", text: afterText });
      });
    });

    return elements;
  }

  function toCNNum(n) {
    const digits = ["零", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
    if (n <= 10) return digits[n];
    if (n < 20) return "十" + digits[n - 10];
    if (n < 100) {
      const t = Math.floor(n / 10), o = n % 10;
      return digits[t] + "十" + (o ? digits[o] : "");
    }
    return String(n);
  }

  /* ---------- AI 转换 ---------- */
  async function aiConvert(chapters) {
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      const useRule = confirm("AI 未配置，是否使用「快速规则转换」？\n（点击确定用规则转换，点击取消去设置里配置 AI）");
      if (useRule) return ruleConvert(chapters);
      return null;
    }

    const novel = findNode(currentNovelId);
    // 拼接章节文本
    let fullText = "";
    chapters.forEach(({ volume, node: ch }) => {
      fullText += `\n\n===== ${ch.name} =====\n${ch.content || ""}`;
    });

    // 如果文本太长，截断
    const MAX_CHARS = 12000;
    let truncated = false;
    if (fullText.length > MAX_CHARS) {
      fullText = fullText.substring(0, MAX_CHARS);
      truncated = true;
    }

    const formatHint = scriptTemplate === "left"
      ? `输出格式要求（靠左格式/短剧拍摄剧本）：
- 场景标题：第X场 地点 时间（内景/外景）
- 动作/环境描写：左对齐，简洁
- 角色名靠左，后接冒号，如"李寻欢："
- 动作提示放在角色名后的括号中，如"李寻欢（冷笑）："
- 对话紧跟角色名，同一行或下一行
- 不要用引号包裹对话`
      : `输出格式要求（居中格式/传统剧本）：
- 场景标题：第X场 地点 时间
- 动作/环境描写：左对齐
- 角色名居中，单独一行
- 情绪/动作提示居中，跟在角色名后
- 对话内容缩进，不加引号`;

    const sys = `你是专业编剧。将小说正文改写为标准中文剧本格式。严格输出 JSON 数组，每个元素是一个对象，type 字段为以下之一：
- {"type":"title","text":"剧本标题"} — 全剧只出现一次
- {"type":"scene","text":"第X场 地点 时间"} — 每场戏开头，根据内容推断内外景/地点/时间，无法推断则用章节名
- {"type":"action","text":"动作/环境描写"} — 叙述性文字，第三人称
- {"type":"character","text":"角色名"} — 说话人，单独一行
- {"type":"paren","text":"情绪/语气提示"} — 可选，跟在角色名后，如"冷笑""低声"
- {"type":"dialogue","text":"对话内容"} — 角色说的话，不加引号
- {"type":"transition","text":"切至/淡出"} — 转场提示

${formatHint}

要求：
1. 保留原文关键情节和对话，不要遗漏
2. 对话要精炼，符合角色性格
3. 动作描写简洁，用现在时
4. 每场戏要有场景标题
5. 只输出 JSON 数组，不要任何解释文字`;

    const user = `小说《${novel.name}》\n请将以下内容改写为剧本：\n${fullText}${truncated ? "\n\n（注意：原文较长，以上为前半部分）" : ""}`;

    setStatus("AI 正在转换剧本…");
    const res = await fetch("/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.5, max_tokens: 8192,
      }),
    }).then(r => r.json());

    if (!res.ok) {
      alert("AI 转换失败：" + (res.error || "未知错误"));
      setStatus("AI 转换失败");
      return null;
    }

    // 解析 JSON
    let elements = null;
    try {
      // 尝试直接解析
      elements = JSON.parse(res.content);
    } catch (e) {
      // 尝试从文本中提取 JSON 数组
      const match = res.content.match(/\[[\s\S]*\]/);
      if (match) {
        try { elements = JSON.parse(match[0]); } catch (e2) {}
      }
    }

    if (!Array.isArray(elements)) {
      // JSON 解析失败，把原文当纯文本显示
      setStatus("AI 返回格式异常，已按纯文本显示");
      return [{ type: "action", text: res.content }];
    }

    // 校验并清理
    const validTypes = ["title", "scene", "action", "character", "paren", "dialogue", "transition"];
    return elements.filter(e => e && validTypes.includes(e.type) && e.text).map(e => ({
      type: e.type, text: String(e.text).trim(),
    }));
  }

  async function aiConvertText(text, title) {
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      const useRule = confirm("AI 未配置，是否使用「快速规则转换」？\n（点击确定用规则转换，点击取消去设置里配置 AI）");
      if (useRule) return ruleConvertText(text, title);
      return null;
    }

    const MAX_CHARS = 12000;
    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.substring(0, MAX_CHARS);
      truncated = true;
    }

    const formatHint2 = scriptTemplate === "left"
      ? `输出格式要求（靠左格式/短剧拍摄剧本）：
- 场景标题：第X场 地点 时间（内景/外景）
- 动作/环境描写：左对齐，简洁
- 角色名靠左，后接冒号，如"李寻欢："
- 动作提示放在角色名后的括号中，如"李寻欢（冷笑）："
- 对话紧跟角色名，同一行或下一行
- 不要用引号包裹对话`
      : `输出格式要求（居中格式/传统剧本）：
- 场景标题：第X场 地点 时间
- 动作/环境描写：左对齐
- 角色名居中，单独一行
- 情绪/动作提示居中，跟在角色名后
- 对话内容缩进，不加引号`;

    const sys = `你是专业编剧。将小说正文改写为标准中文剧本格式。严格输出 JSON 数组，每个元素是一个对象，type 字段为以下之一：
- {"type":"title","text":"剧本标题"} — 全剧只出现一次
- {"type":"scene","text":"第X场 地点 时间"} — 每场戏开头，根据内容推断内外景/地点/时间
- {"type":"action","text":"动作/环境描写"} — 叙述性文字，第三人称
- {"type":"character","text":"角色名"} — 说话人，单独一行
- {"type":"paren","text":"情绪/语气提示"} — 可选，跟在角色名后
- {"type":"dialogue","text":"对话内容"} — 角色说的话，不加引号
- {"type":"transition","text":"切至/淡出"} — 转场提示

${formatHint2}

要求：
1. 保留原文关键情节和对话，不要遗漏
2. 对话要精炼，符合角色性格
3. 动作描写简洁，用现在时
4. 每场戏要有场景标题，按章节或情节转折分场
5. 只输出 JSON 数组，不要任何解释文字`;

    const user = `小说《${title || "未命名"}》\n请将以下内容改写为剧本：\n${text}${truncated ? "\n\n（注意：原文较长，以上为前半部分）" : ""}`;

    setStatus("AI 正在转换剧本…");
    const res = await fetch("/api/ai/chat", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "system", content: sys },
          { role: "user", content: user },
        ],
        temperature: 0.5, max_tokens: 8192,
      }),
    }).then(r => r.json());

    if (!res.ok) {
      alert("AI 转换失败：" + (res.error || "未知错误"));
      setStatus("AI 转换失败");
      return null;
    }

    let elements = null;
    try { elements = JSON.parse(res.content); } catch (e) {
      const match = res.content.match(/\[[\s\S]*\]/);
      if (match) { try { elements = JSON.parse(match[0]); } catch (e2) {} }
    }
    if (!Array.isArray(elements)) {
      setStatus("AI 返回格式异常，已按纯文本显示");
      return [{ type: "action", text: res.content }];
    }
    const validTypes = ["title", "scene", "action", "character", "paren", "dialogue", "transition"];
    return elements.filter(e => e && validTypes.includes(e.type) && e.text).map(e => ({
      type: e.type, text: String(e.text).trim(),
    }));
  }

  /* ---------- 渲染 ---------- */
  function renderScript(elements) {
    const editor = $("#script-editor");
    // 应用模板样式类
    editor.classList.toggle("script-left", scriptTemplate === "left");
    const html = elements.map(e => {
      switch (e.type) {
        case "title": return `<div class="sc-title">${esc(e.text)}</div>`;
        case "scene": return `<div class="sc-scene">${esc(e.text)}</div>`;
        case "action": return `<div class="sc-action">${esc(e.text)}</div>`;
        case "character": return `<div class="sc-character">${esc(e.text)}</div>`;
        case "paren": return `<div class="sc-paren">${esc(e.text)}</div>`;
        case "dialogue": return `<div class="sc-dialogue">${esc(e.text)}</div>`;
        case "transition": return `<div class="sc-transition">${esc(e.text)}</div>`;
        default: return `<div>${esc(e.text)}</div>`;
      }
    }).join("");
    editor.innerHTML = html;
  }

  /* ---------- 外部 TXT 导入 ---------- */
  function decodeBuffer(buf) {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch (e) {
      try { return new TextDecoder("gbk").decode(buf); }
      catch (e2) { return new TextDecoder("utf-8").decode(buf); }
    }
  }

  function loadExternalFile(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type && !file.type.includes("text")) {
      alert("请选择 TXT 文本文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let text = decodeBuffer(reader.result);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      externalText = text;
      externalName = file.name.replace(/\.[^.]+$/, "");
      updateSourceTag();
      setStatus(`已导入外部文件：${file.name}（${text.length.toLocaleString()} 字），点击「开始转换」`);
    };
    reader.onerror = () => alert("文件读取失败");
    reader.readAsArrayBuffer(file);
  }

  function updateSourceTag() {
    const tag = $("#script-source-tag");
    if (externalText) {
      tag.classList.remove("hidden");
      tag.innerHTML = `📄 ${esc(externalName)} <span class="x" title="移除外部文件">✕</span>`;
      tag.querySelector(".x").addEventListener("click", clearExternal);
    } else {
      tag.classList.add("hidden");
      tag.innerHTML = "";
    }
  }

  function clearExternal() {
    externalText = "";
    externalName = "";
    updateSourceTag();
    $("#script-file").value = "";
    setStatus("已移除外部文件，使用内部章节");
  }

  // 将外部文本按章节标记拆分为场景
  function splitTextToScenes(text, title) {
    const CN_NUM = "一二三四五六七八九十百千零〇两";
    const chRe = new RegExp(
      `^[\\s　]*第[${CN_NUM}\\d]+[章回节][\\s\\u3000:：、．.．]*(.*)$`
    );
    const lines = text.split(/\r\n|\r|\n/);
    const scenes = [];
    let current = { name: "", content: [] };
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length <= 60 && chRe.test(trimmed)) {
        if (current.name || current.content.length) scenes.push(current);
        current = { name: trimmed, content: [] };
      } else {
        current.content.push(line);
      }
    }
    if (current.name || current.content.length) scenes.push(current);
    if (!scenes.length) scenes.push({ name: "正文", content: [text] });
    return { title, scenes };
  }

  function ruleConvertText(text, title) {
    const elements = [];
    elements.push({ type: "title", text: title || "剧本" });
    const { scenes } = splitTextToScenes(text, title);
    let sceneNum = 0;
    scenes.forEach(scene => {
      sceneNum++;
      elements.push({ type: "scene", text: `第${toCNNum(sceneNum)}场　${scene.name || "正文"}` });
      const content = scene.content.join("\n").trim();
      if (!content) return;
      const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean);
      let lastSpeaker = "";
      paragraphs.forEach(para => {
        const dialogues = extractDialogues(para);
        if (!dialogues.length) {
          elements.push({ type: "action", text: para });
          return;
        }
        let cursor = 0;
        dialogues.forEach(d => {
          const beforeText = para.substring(cursor, d.start).trim();
          let actionBefore = beforeText;
          if (d.speaker) {
            actionBefore = beforeText
              .replace(new RegExp(`[，,]?\\s*(?:${d.speaker})?\\s*(?:缓缓|淡淡|轻声|高声|低声|大声|冷冷|微微|默默|喃喃|沉声|厉声|笑着|哭着|随即|连忙|急忙)?\\s*${SPEAK_VERBS}\\s*[：:]?\\s*$`), "")
              .replace(/[，,：:\s]+$/, "").trim();
          }
          if (actionBefore) elements.push({ type: "action", text: actionBefore });
          const speaker = d.speaker || lastSpeaker;
          if (d.speaker) lastSpeaker = d.speaker;
          elements.push({ type: "character", text: speaker || "旁白" });
          elements.push({ type: "dialogue", text: d.dialogue });
          cursor = d.end;
        });
        const afterText = para.substring(cursor).replace(/^[，,。！？\s]*/, "").trim();
        if (afterText) elements.push({ type: "action", text: afterText });
      });
    });
    return elements;
  }

  /* ---------- 转换入口 ---------- */
  async function doConvert() {
    if (converting) return;

    // 外部文件优先
    if (externalText) {
      converting = true;
      const btn = $("#btn-script-convert");
      btn.disabled = true;
      btn.textContent = "⏳ 转换中…";
      try {
        let elements;
        if (convertMode === "ai") {
          elements = await aiConvertText(externalText, externalName);
        } else {
          elements = ruleConvertText(externalText, externalName);
        }
        if (elements) {
          renderScript(elements);
          setStatus(`剧本转换完成：${elements.length} 个剧本元素`);
        }
      } catch (e) {
        alert("转换出错：" + e.message);
        setStatus("转换失败");
      } finally {
        converting = false;
        btn.disabled = false;
        btn.textContent = "🎬 开始转换";
      }
      return;
    }

    // 内部章节
    const chapters = getSelectedChapters();
    if (!chapters.length) {
      alert("请先选择一本有章节的小说，或点击「导入TXT」导入外部文件");
      return;
    }
    const emptyChs = chapters.filter(c => !c.node.content || !c.node.content.trim());
    if (emptyChs.length === chapters.length) {
      alert("所选章节没有正文内容，无法转换");
      return;
    }

    converting = true;
    const btn = $("#btn-script-convert");
    btn.disabled = true;
    btn.textContent = "⏳ 转换中…";

    try {
      let elements;
      if (convertMode === "ai") {
        elements = await aiConvert(chapters);
      } else {
        elements = ruleConvert(chapters);
      }
      if (elements) {
        renderScript(elements);
        const chCount = chapters.length;
        setStatus(`剧本转换完成：${chCount} 章，${elements.length} 个剧本元素`);
      }
    } catch (e) {
      alert("转换出错：" + e.message);
      setStatus("转换失败");
    } finally {
      converting = false;
      btn.disabled = false;
      btn.textContent = "🎬 开始转换";
    }
  }

  /* ---------- 复制 / 导出 ---------- */
  function getPlainText() {
    const editor = $("#script-editor");
    const lines = [];
    const isLeft = scriptTemplate === "left";

    editor.querySelectorAll(".sc-title, .sc-scene, .sc-action, .sc-character, .sc-paren, .sc-dialogue, .sc-transition").forEach(el => {
      if (el.classList.contains("sc-title")) {
        if (isLeft) {
          lines.push("", el.textContent, "");
        } else {
          lines.push("", centerText(el.textContent, 40), "");
        }
      } else if (el.classList.contains("sc-scene")) {
        lines.push("", el.textContent, "");
      } else if (el.classList.contains("sc-action")) {
        lines.push(el.textContent);
      } else if (el.classList.contains("sc-character")) {
        if (isLeft) {
          // 靠左格式：角色名后接冒号，对话跟在后面（由下一个 dialogue 元素处理）
          lines.push("");
          lines.push(el.textContent + "：");
        } else {
          lines.push("", centerText(el.textContent, 30));
        }
      } else if (el.classList.contains("sc-paren")) {
        if (isLeft) {
          // 靠左格式：括号提示跟在角色名后
          const lastLine = lines[lines.length - 1] || "";
          if (lastLine.includes("：")) {
            lines[lines.length - 1] = lastLine.replace("：", "（" + el.textContent + "）：");
          } else {
            lines.push("（" + el.textContent + "）");
          }
        } else {
          lines.push(centerText("（" + el.textContent + "）", 30));
        }
      } else if (el.classList.contains("sc-dialogue")) {
        if (isLeft) {
          // 靠左格式：对话跟在角色名行后
          const lastLine = lines[lines.length - 1] || "";
          if (lastLine.includes("：")) {
            lines[lines.length - 1] = lastLine + el.textContent;
          } else {
            lines.push("    " + el.textContent);
          }
        } else {
          lines.push("    " + el.textContent);
        }
      } else if (el.classList.contains("sc-transition")) {
        if (isLeft) {
          lines.push("", el.textContent, "");
        } else {
          lines.push("", "          " + el.textContent, "");
        }
      }
    });
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function centerText(text, width) {
    const pad = Math.max(0, Math.floor((width - text.length) / 2));
    return " ".repeat(pad) + text;
  }

  function copyScript() {
    const text = getPlainText();
    if (!text.trim()) { alert("没有可复制的内容"); return; }
    navigator.clipboard?.writeText(text).then(() => {
      setStatus("剧本已复制到剪贴板");
    }).catch(() => {
      // fallback
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
      setStatus("剧本已复制到剪贴板");
    });
  }

  function exportScript() {
    const text = getPlainText();
    if (!text.trim()) { alert("没有可导出的内容"); return; }
    const novel = findNode(currentNovelId);
    const name = (novel ? novel.name : "剧本") + "_剧本.txt";
    const blob = new Blob(["\ufeff" + text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("剧本已导出：" + name);
  }

  /* ---------- 刷新 ---------- */
  function refresh() {
    if (!document.getElementById("view-script").classList.contains("active")) return;
    refreshNovelSelect();
  }

  /* ---------- 事件 ---------- */
  function init() {
    $("#script-novel").addEventListener("change", e => {
      currentNovelId = e.target.value;
      refreshChapterSelect();
    });
    $$("#script-mode-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#script-mode-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      convertMode = b.dataset.mode;
    }));
    $$("#script-template-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#script-template-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      scriptTemplate = b.dataset.template;
      const editor = $("#script-editor");
      editor.classList.toggle("script-left", scriptTemplate === "left");
      setStatus(`剧本模板：${scriptTemplate === "left" ? "靠左格式（短剧/拍摄剧本）" : "居中格式（传统剧本）"}`);
    }));
    $("#btn-script-convert").addEventListener("click", doConvert);
    $("#btn-script-copy").addEventListener("click", copyScript);
    $("#btn-script-export").addEventListener("click", exportScript);

    // 外部 TXT 导入：按钮选择
    $("#btn-script-import").addEventListener("click", () => $("#script-file").click());
    $("#script-file").addEventListener("change", (e) => {
      if (e.target.files[0]) loadExternalFile(e.target.files[0]);
    });

    // 拖拽导入
    const wrap = $("#script-wrap");
    const dropZone = $("#script-drop-zone");
    let dragCounter = 0;
    wrap.addEventListener("dragenter", (e) => {
      e.preventDefault();
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) {
        dragCounter++;
        dropZone.classList.add("active");
      }
    });
    wrap.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    wrap.addEventListener("dragleave", (e) => {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; dropZone.classList.remove("active"); }
    });
    wrap.addEventListener("drop", (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropZone.classList.remove("active");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadExternalFile(file);
    });

    document.addEventListener("novel:data-changed", refresh);
    document.addEventListener("novel:view-changed", (e) => {
      if (e.detail.view === "script") refresh();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
