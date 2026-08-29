/* ==================================================================
 * 小说转剧本（逐章转换 · 靠左格式）
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

  // 章节列表：{id, name, content, status:'pending'|'converting'|'done'|'error', elements, error}
  let chapters = [];
  let currentChapterId = null;
  let chapterCounter = 0;

  function setStatus(msg) {
    const el = document.getElementById("status-text");
    if (el) el.textContent = msg;
  }

  /* ---------- 小说选择 ---------- */
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
    loadChaptersFromNovel();
  }

  /* ---------- 从小说数据加载章节 ---------- */
  function loadChaptersFromNovel() {
    externalText = "";
    externalName = "";
    updateSourceTag();
    const novel = findNode(currentNovelId);
    chapters = [];
    chapterCounter = 0;
    if (novel) {
      (novel.children || []).forEach(v => {
        if (v.type === "volume") {
          (v.children || []).forEach(c => {
            if (c.type === "chapter") {
              chapters.push(makeChapter(v.name + " · " + c.name, c.content || ""));
            }
          });
        }
      });
    }
    currentChapterId = chapters.length ? chapters[0].id : null;
    renderChapterList();
    renderCurrentScript();
    updateStats();
  }

  function makeChapter(name, content) {
    chapterCounter++;
    return {
      id: "ch_" + chapterCounter + "_" + Date.now() + "_" + Math.random().toString(36).slice(2, 6),
      name: name,
      content: content,
      status: "pending",
      elements: null,
      error: "",
    };
  }

  /* ---------- 规则转换核心（保留原有对话提取逻辑） ---------- */
  const SPEAK_VERBS = "(?:笑道|问道|答道|叫道|喊道|骂道|吼道|怒道|叹道|说道|答道|续道|低声道|高声道|冷冷道|淡淡道|缓缓道|轻声道|大声道|喃喃道|道|说|问|答|叫|喊|笑|骂|吼|叹|喃喃)";
  const QUOTE_PAIRS = [
    { open: "\u201c", close: "\u201d" },
    { open: "\u300c", close: "\u300d" },
    { open: "\u300e", close: "\u300f" },
    { open: "\"", close: "\"" },
  ];

  function extractDialogues(text) {
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
        if (!speaker && dialogue.length <= 2) continue;
        results.push({ start: pos.open, end: pos.close + 1, speaker, dialogue });
        prevEnd = pos.close + 1;
      }
      if (results.length) break;
    }
    return results;
  }

  const ADVERBS = new Set(["缓缓", "淡淡", "轻声", "高声", "低声", "大声", "冷冷", "微微",
    "默默", "暗暗", "徐徐", "匆匆", "连忙", "急忙", "沉声", "厉声", "随即", "继而",
    "哭着", "笑着", "叹了", "哼了", "点头", "点点", "摇头", "转身", "抬头",
    "低头", "睁眼", "闭眼", "心中", "心里", "眼中", "眼里", "脸上", "面色", "手中",
    "手里", "身上", "脚下", "不禁", "不由", "暗自", "赶紧", "连忙",
    "一声", "只听", "只见", "但见", "却说", "原来", "说着", "想着", "看着", "听着"]);

  function findSpeaker(before, after) {
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
      const clauses = beforeVerb.split(/[，,。！？；;、]/).filter(s => s.trim());
      for (let i = clauses.length - 1; i >= 0; i--) {
        const name = extractName(clauses[i]);
        if (name) return name;
      }
    }
    if (!verb && /[：:]\s*$/.test(before)) {
      const clauses = before.replace(/[：:]\s*$/, "").split(/[，,。！？；;、]/).filter(s => s.trim());
      for (let i = clauses.length - 1; i >= 0; i--) {
        const name = extractName(clauses[i]);
        if (name) return name;
      }
    }
    const afterMatch = after.match(new RegExp(`^\\s*[，,]?\\s*([\\u4e00-\\u9fa5A-Za-z·]{2,4})\\s*${SPEAK_VERBS}`));
    if (afterMatch) {
      const name = extractName(afterMatch[1]);
      if (name) return name;
    }
    return "";
  }

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
    const m3 = text.match(/^[\s]*([\u4e00-\u9fa5A-Za-z·]{3})/);
    if (m3 && !ADVERBS.has(m3[1]) && !VERB_CHARS.has(m3[1][2]) && !/[了着过的是在有不没会能要想]/.test(m3[1][2])) {
      return m3[1];
    }
    return two;
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

  /* ---------- 情绪提取（从说话引导中提取情绪/语气提示） ---------- */
  function extractEmotion(before) {
    // 副词+道/说 优先：冷冷道→冷冷，低声道→低声
    const advList = ["冷冷", "缓缓", "轻声", "高声", "低声", "大声", "淡淡", "微微", "默默", "喃喃", "沉声", "厉声", "笑着", "哭着", "急忙", "连忙"];
    for (const adv of advList) {
      if (new RegExp(adv + "\\s*(?:道|说|问|喊|叫|骂|怒|叹|笑)\\s*[：:]?\\s*$").test(before)) {
        return adv;
      }
    }
    // 动词+道 简化：问道→问，喊道→喊，怒道→怒
    const verbMap = [
      ["低声道", "低声"], ["高声道", "高声"], ["大声道", "大声"], ["轻声道", "轻声"],
      ["喃喃道", "喃喃"], ["沉声道", "沉声"], ["厉声道", "厉声"],
      ["问道", "问"], ["叫道", "叫"], ["喊道", "喊"], ["骂道", "骂"],
      ["怒道", "怒"], ["叹道", "叹"], ["笑道", "笑"], ["续道", "续"],
    ];
    for (const [verb, emo] of verbMap) {
      if (before.endsWith(verb) || before.endsWith(verb + "：") || before.endsWith(verb + ":")) return emo;
    }
    return "";
  }

  /* ---------- 简化动作描写：去掉末尾的说话动词和冗余标点 ---------- */
  function simplifyAction(text) {
    return text
      .replace(/[，,]?\s*(?:缓缓|淡淡|轻声|高声|低声|大声|冷冷|微微|默默|喃喃|沉声|厉声|笑着|哭着|随即|连忙|急忙)?\s*(?:道|说|问|答|叫|喊|笑|骂|吼|叹|喃喃)\s*[。！？；;：:\s]*$/, "")
      .replace(/[，,：:；;。！？\s]+$/, "")
      .trim();
  }

  /* ---------- 单章规则转换 ---------- */
  function ruleConvertChapter(chapter, sceneNum) {
    const elements = [];
    elements.push({ type: "scene", text: `第${toCNNum(sceneNum)}场　${chapter.name}` });
    const content = (chapter.content || "").trim();
    if (!content) {
      return elements;
    }
    const paragraphs = content.split(/\n+/).map(p => p.trim()).filter(Boolean);
    let lastSpeaker = "";
    paragraphs.forEach(para => {
      const dialogues = extractDialogues(para);
      if (!dialogues.length) {
        // 纯叙述段落 → 动作描写（△ 开头），简化末尾冗余
        elements.push({ type: "action", text: simplifyAction(para) });
        return;
      }
      let cursor = 0;
      dialogues.forEach(d => {
        // 对话前的叙述 → 动作描写
        const beforeText = para.substring(cursor, d.start).trim();
        let actionBefore = beforeText;
        let emotion = "";
        if (d.speaker) {
          emotion = extractEmotion(beforeText);
          actionBefore = beforeText
            .replace(new RegExp(`[，,]?\\s*(?:${d.speaker})?\\s*(?:缓缓|淡淡|轻声|高声|低声|大声|冷冷|微微|默默|喃喃|沉声|厉声|笑着|哭着|随即|连忙|急忙)?\\s*${SPEAK_VERBS}\\s*[：:]?\\s*$`), "")
            .replace(/[，,：:\s]+$/, "").trim();
        }
        if (actionBefore) elements.push({ type: "action", text: simplifyAction(actionBefore) });
        // 对话：角色名 + 情绪提示 + 对话
        const speaker = d.speaker || lastSpeaker;
        if (d.speaker) lastSpeaker = d.speaker;
        elements.push({ type: "character", text: speaker || "旁白" });
        if (emotion) elements.push({ type: "paren", text: emotion });
        elements.push({ type: "dialogue", text: d.dialogue });
        cursor = d.end;
      });
      // 对话后的叙述 → 动作描写
      const afterText = para.substring(cursor).replace(/^[，,。！？\s]*/, "").trim();
      if (afterText) elements.push({ type: "action", text: simplifyAction(afterText) });
    });
    return elements;
  }

  /* ---------- 单章 AI 转换 ---------- */
  async function aiConvertChapter(chapter, novelName, sceneNum) {
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      throw new Error("AI 未配置");
    }
    let text = chapter.content || "";
    const MAX_CHARS = 12000;
    let truncated = false;
    if (text.length > MAX_CHARS) {
      text = text.substring(0, MAX_CHARS);
      truncated = true;
    }

    const sys = `你是专业编剧。将小说正文改写为短剧剧本格式。严格输出 JSON 数组，每个元素是一个对象，type 字段为以下之一：
- {"type":"action","text":"动作/环境描写"} — 简洁的舞台提示，渲染时自动加 △ 前缀
- {"type":"character","text":"角色名"} — 说话人
- {"type":"paren","text":"情绪/语气提示"} — 跟在角色名后的括号中，如"平静""打断""抽噎""冷冷"
- {"type":"dialogue","text":"对话内容"} — 角色说的话，不加引号

输出格式要求（短剧剧本格式）：
- 动作/环境描写：△ 开头，必须简洁提炼，只保留核心动作和关键环境，不要大段照搬原文叙述
- 角色对话：角色名(情绪提示)：对话内容，同一行
- 情绪提示必须从原文语境中推断，如说话人的语气、神态、动作
- 不要用引号包裹对话
- 不要输出场景标题

要求：
1. 保留原文所有对话，不要遗漏
2. 对话要精炼，符合角色性格
3. 动作描写极度简洁，用现在时，只写关键动作
4. 每个角色对话都尽量带情绪提示
5. 只输出 JSON 数组，不要任何解释文字`;

    const user = `小说《${novelName || "未命名"}》第${toCNNum(sceneNum)}章：${chapter.name}\n请将以下内容改写为剧本：\n${text}${truncated ? "\n\n（注意：原文较长，以上为前半部分）" : ""}`;

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

    if (!res.ok) throw new Error(res.error || "AI 转换失败");

    let elements = null;
    try { elements = JSON.parse(res.content); } catch (e) {
      const match = res.content.match(/\[[\s\S]*\]/);
      if (match) { try { elements = JSON.parse(match[0]); } catch (e2) {} }
    }
    if (!Array.isArray(elements)) {
      return [];
    }
    const validTypes = ["scene", "action", "character", "paren", "dialogue", "transition"];
    return elements.filter(e => e && validTypes.includes(e.type) && e.text).map(e => ({
      type: e.type, text: String(e.text).trim(),
    }));
  }

  /* ---------- 转换单章 ---------- */
  async function convertChapter(idx) {
    if (converting) return;
    const ch = chapters[idx];
    if (!ch) return;
    if (ch.status === "converting") return;

    ch.status = "converting";
    ch.error = "";
    renderChapterList();

    const novel = findNode(currentNovelId);
    const novelName = novel ? novel.name : (externalName || "未命名");

    try {
      if (convertMode === "ai") {
        if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
          const useRule = confirm("AI 未配置，是否对本章使用「快速规则转换」？\n（点击确定用规则转换，点击取消去设置里配置 AI）");
          if (!useRule) { ch.status = "pending"; renderChapterList(); return; }
          ch.elements = ruleConvertChapter(ch, idx + 1);
        } else {
          setStatus(`AI 正在转换第 ${idx + 1}/${chapters.length} 章：${ch.name}`);
          ch.elements = await aiConvertChapter(ch, novelName, idx + 1);
        }
      } else {
        ch.elements = ruleConvertChapter(ch, idx + 1);
      }
      ch.status = "done";
      currentChapterId = ch.id;
      setStatus(`第 ${idx + 1} 章转换完成：${ch.name}`);
    } catch (e) {
      ch.status = "error";
      ch.error = e.message || "转换失败";
      setStatus(`第 ${idx + 1} 章转换失败：${ch.error}`);
    }
    renderChapterList();
    renderCurrentScript();
    updateStats();
  }

  /* ---------- 全部转换（逐章依次） ---------- */
  async function convertAll() {
    if (converting) return;
    if (!chapters.length) {
      alert("请先选择小说或导入 TXT 文件");
      return;
    }
    const pending = chapters.filter(c => c.status === "pending" || c.status === "error");
    if (!pending.length) {
      alert("所有章节均已转换完成");
      return;
    }
    // AI 模式且未配置时，一次性询问
    if (convertMode === "ai" && (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model)) {
      const useRule = confirm("AI 未配置，是否对所有未转换章节使用「快速规则转换」？\n（点击确定用规则转换，点击取消去设置里配置 AI）");
      if (!useRule) return;
    }

    converting = true;
    const btn = $("#btn-script-convert-all");
    btn.disabled = true;
    btn.textContent = "⏳ 转换中…";

    try {
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        if (ch.status === "done") continue;
        await convertChapter(i);
      }
      const doneCount = chapters.filter(c => c.status === "done").length;
      setStatus(`全部转换完成：${doneCount}/${chapters.length} 章成功`);
    } catch (e) {
      setStatus("转换中断：" + e.message);
    } finally {
      converting = false;
      btn.disabled = false;
      btn.textContent = "🎬 全部转换";
    }
  }

  /* ---------- 渲染章节列表 ---------- */
  function renderChapterList() {
    const list = $("#script-chapter-list");
    if (!list) return;
    if (!chapters.length) {
      list.innerHTML = `<div class="script-empty">选择小说或导入 TXT 后显示章节</div>`;
      return;
    }
    list.innerHTML = chapters.map((ch, i) => {
      const statusIcon = {
        pending: "⭕",
        converting: "⏳",
        done: "✅",
        error: "❌",
      }[ch.status] || "⭕";
      const statusText = {
        pending: "未转换",
        converting: "转换中…",
        done: "已完成",
        error: "失败",
      }[ch.status] || "";
      const active = ch.id === currentChapterId ? "active" : "";
      const wordCount = (ch.content || "").length;
      return `
        <div class="script-chapter-item ${active}" data-idx="${i}">
          <div class="script-chapter-info">
            <span class="script-chapter-num">${i + 1}.</span>
            <span class="script-chapter-name" title="${esc(ch.name)}">${esc(ch.name)}</span>
            <span class="script-chapter-words">${wordCount}字</span>
          </div>
          <div class="script-chapter-actions">
            <span class="script-chapter-status">${statusIcon} ${statusText}</span>
            <button class="mini-btn script-chapter-convert" data-idx="${i}" title="转换本章">
              ${ch.status === "done" ? "重转" : "转换"}
            </button>
          </div>
        </div>
      `;
    }).join("");

    // 绑定点击切换
    list.querySelectorAll(".script-chapter-item").forEach(item => {
      item.addEventListener("click", e => {
        if (e.target.classList.contains("script-chapter-convert")) return;
        const idx = parseInt(item.dataset.idx);
        currentChapterId = chapters[idx].id;
        renderChapterList();
        renderCurrentScript();
      });
    });
    list.querySelectorAll(".script-chapter-convert").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        const idx = parseInt(btn.dataset.idx);
        convertChapter(idx);
      });
    });
  }

  function updateStats() {
    const el = $("#script-chapter-stats");
    if (!el) return;
    if (!chapters.length) { el.textContent = ""; return; }
    const done = chapters.filter(c => c.status === "done").length;
    el.textContent = `${done}/${chapters.length}`;
  }

  /* ---------- 渲染当前章节剧本 ---------- */
  function renderCurrentScript() {
    const editor = $("#script-editor");
    if (!editor) return;
    const ch = chapters.find(c => c.id === currentChapterId);
    if (!ch) {
      editor.innerHTML = "";
      editor.setAttribute("data-empty", "1");
      return;
    }
    editor.removeAttribute("data-empty");

    if (ch.status === "pending") {
      editor.innerHTML = `<div class="script-placeholder">
        <div class="script-placeholder-title">${esc(ch.name)}</div>
        <div class="script-placeholder-text">本章尚未转换，点击左侧「转换」或上方「全部转换」</div>
        <div class="script-placeholder-preview">${esc((ch.content || "").substring(0, 200))}${(ch.content || "").length > 200 ? "…" : ""}</div>
      </div>`;
      return;
    }
    if (ch.status === "converting") {
      editor.innerHTML = `<div class="script-placeholder">
        <div class="script-placeholder-title">${esc(ch.name)}</div>
        <div class="script-placeholder-text">⏳ 正在转换中…</div>
      </div>`;
      return;
    }
    if (ch.status === "error") {
      editor.innerHTML = `<div class="script-placeholder">
        <div class="script-placeholder-title">${esc(ch.name)}</div>
        <div class="script-placeholder-error">❌ 转换失败：${esc(ch.error)}</div>
      </div>`;
      return;
    }
    // done —— 按短剧格式渲染：角色名(情绪)：对话 同行；动作描写 △ 开头；不显示场景标题
    const html = [];
    const elems = ch.elements || [];
    for (let i = 0; i < elems.length; i++) {
      const e = elems[i];
      if (e.type === "title" || e.type === "scene") {
        // 跳过标题和场景标题，直接显示内容
        continue;
      } else if (e.type === "action") {
        html.push(`<div class="sc-action">△ ${esc(e.text)}</div>`);
      } else if (e.type === "character") {
        // 合并 character + 可选 paren + dialogue 为一行
        let parenText = "";
        let dialogueText = "";
        if (i + 1 < elems.length && elems[i + 1].type === "paren") {
          parenText = elems[i + 1].text;
          i++;
        }
        if (i + 1 < elems.length && elems[i + 1].type === "dialogue") {
          dialogueText = elems[i + 1].text;
          i++;
        }
        const parenHtml = parenText ? `<span class="sc-paren">（${esc(parenText)}）</span>` : "";
        html.push(`<div class="sc-line"><span class="sc-character">${esc(e.text)}</span>${parenHtml}<span class="sc-colon">：</span><span class="sc-dialogue">${esc(dialogueText)}</span></div>`);
      } else if (e.type === "dialogue") {
        // 没有角色名的对话（承接上文）
        html.push(`<div class="sc-line"><span class="sc-dialogue">${esc(e.text)}</span></div>`);
      } else if (e.type === "paren") {
        html.push(`<div class="sc-paren">（${esc(e.text)}）</div>`);
      } else if (e.type === "transition") {
        html.push(`<div class="sc-transition">${esc(e.text)}</div>`);
      } else {
        html.push(`<div>${esc(e.text)}</div>`);
      }
    }
    editor.innerHTML = html.join("");
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
      loadChaptersFromText(text, externalName);
      setStatus(`已导入：${file.name}（${text.length.toLocaleString()} 字），共 ${chapters.length} 章`);
    };
    reader.onerror = () => alert("文件读取失败");
    reader.readAsArrayBuffer(file);
  }

  function updateSourceTag() {
    const tag = $("#script-source-tag");
    if (externalText) {
      tag.classList.remove("hidden");
      tag.innerHTML = `📄 ${esc(externalName)} <span class="x" title="移除外部文件，使用小说章节">✕</span>`;
      tag.querySelector(".x").addEventListener("click", () => {
        externalText = "";
        externalName = "";
        updateSourceTag();
        $("#script-file").value = "";
        loadChaptersFromNovel();
        setStatus("已移除外部文件，使用小说章节");
      });
    } else {
      tag.classList.add("hidden");
      tag.innerHTML = "";
    }
  }

  // 将外部文本按章节标记拆分
  function splitTextToScenes(text) {
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
    return scenes;
  }

  function loadChaptersFromText(text, title) {
    const scenes = splitTextToScenes(text);
    chapters = [];
    chapterCounter = 0;
    scenes.forEach(sc => {
      const name = sc.name || "正文";
      const content = sc.content.join("\n").trim();
      chapters.push(makeChapter(name, content));
    });
    currentChapterId = chapters.length ? chapters[0].id : null;
    renderChapterList();
    renderCurrentScript();
    updateStats();
  }

  /* ---------- 复制 / 导出（合并所有已转换章节） ---------- */
  function getChapterPlainText(ch) {
    if (!ch.elements) return "";
    const lines = [];
    const elems = ch.elements;
    for (let i = 0; i < elems.length; i++) {
      const e = elems[i];
      if (e.type === "scene" || e.type === "title") {
        continue;
      } else if (e.type === "action") {
        lines.push("△ " + e.text);
      } else if (e.type === "character") {
        // 合并 character + 可选 paren + dialogue
        let parenText = "";
        let dialogueText = "";
        if (i + 1 < elems.length && elems[i + 1].type === "paren") {
          parenText = elems[i + 1].text;
          i++;
        }
        if (i + 1 < elems.length && elems[i + 1].type === "dialogue") {
          dialogueText = elems[i + 1].text;
          i++;
        }
        const paren = parenText ? `(${parenText})` : "";
        lines.push(`${e.text}${paren}：${dialogueText}`);
      } else if (e.type === "dialogue") {
        lines.push(e.text);
      } else if (e.type === "paren") {
        lines.push(`（${e.text}）`);
      } else if (e.type === "transition") {
        lines.push("", e.text, "");
      }
    }
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function getAllPlainText() {
    const doneChapters = chapters.filter(c => c.status === "done");
    if (!doneChapters.length) return "";
    const novel = findNode(currentNovelId);
    const title = novel ? novel.name : (externalName || "剧本");
    let all = `《${title}》剧本\n\n`;
    doneChapters.forEach((ch, i) => {
      const text = getChapterPlainText(ch);
      if (text) {
        all += text + "\n\n";
        if (i < doneChapters.length - 1) all += "—".repeat(30) + "\n\n";
      }
    });
    return all.trim();
  }

  function copyScript() {
    const text = getAllPlainText();
    if (!text.trim()) { alert("没有可复制的内容（请先转换至少一章）"); return; }
    navigator.clipboard?.writeText(text).then(() => {
      setStatus("剧本已复制到剪贴板");
    }).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta);
      ta.select(); document.execCommand("copy"); ta.remove();
      setStatus("剧本已复制到剪贴板");
    });
  }

  function exportScript() {
    const text = getAllPlainText();
    if (!text.trim()) { alert("没有可导出的内容（请先转换至少一章）"); return; }
    const novel = findNode(currentNovelId);
    const name = (novel ? novel.name : (externalName || "剧本")) + "_剧本.txt";
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
      loadChaptersFromNovel();
    });

    $$("#script-mode-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#script-mode-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      convertMode = b.dataset.mode;
      setStatus(`转换模式：${convertMode === "ai" ? "AI 智能转换" : "快速规则转换"}`);
    }));

    $("#btn-script-convert-all").addEventListener("click", convertAll);
    $("#btn-script-copy").addEventListener("click", copyScript);
    $("#btn-script-export").addEventListener("click", exportScript);

    // 外部 TXT 导入
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
