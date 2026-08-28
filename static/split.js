/* ==================================================================
 * 拆书视图：导入分章 + 拆文分析（五大维度拆解）
 * ================================================================== */
(function () {
  "use strict";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  const esc = (s) => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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

  /* ==================================================================
   * 子标签切换
   * ================================================================== */
  function switchTab(tab) {
    $$(".split-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".split-panel").forEach(p => p.classList.toggle("active", p.id === "split-panel-" + tab));
  }

  /* ==================================================================
   * 模块一：导入分章
   * ================================================================== */
  let rawText = "";
  let fileName = "";
  let chapters = [];

  function loadSplitFile(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type && !file.type.includes("text")) {
      alert("请选择 TXT 文本文件"); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let text = decodeBuffer(reader.result);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      rawText = text;
      fileName = file.name.replace(/\.[^.]+$/, "");
      $("#split-filename").textContent = `📄 ${file.name}（${text.length.toLocaleString()} 字）`;
      detectChapters();
    };
    reader.onerror = () => alert("文件读取失败");
    reader.readAsArrayBuffer(file);
  }

  function detectChapters() {
    if (!rawText) return;
    const regexStr = $("#split-regex").value.trim() || "第[一二三四五六七八九十百千零〇两\\d]+[章回节卷]";
    let chRe;
    try { chRe = new RegExp(`^[\\s　]*(${regexStr})[\\s\\u3000:：、．.．]*(.*)$`, "m"); }
    catch (e) { alert("正则表达式无效：" + e.message); return; }

    const lines = rawText.split(/\r\n|\r|\n/);
    chapters = [];
    let current = { title: "前言", content: [] };
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length > 0 && trimmed.length <= 80 && chRe.test(trimmed)) {
        if (current.title || current.content.length) chapters.push(current);
        current = { title: trimmed, content: [] };
      } else {
        current.content.push(line);
      }
    }
    if (current.title || current.content.length) chapters.push(current);
    renderSplitResult();
  }

  function renderSplitResult() {
    const drop = $("#split-drop");
    const result = $("#split-result");
    if (!chapters.length) { drop.classList.remove("hidden"); result.classList.add("hidden"); return; }
    drop.classList.add("hidden");
    result.classList.remove("hidden");
    const totalChars = chapters.reduce((s, c) => s + c.content.join("\n").length, 0);
    $("#split-stats").innerHTML = `共识别 <b>${chapters.length}</b> 个章节，总计 <b>${totalChars.toLocaleString()}</b> 字`;
    $("#split-list").innerHTML = chapters.map((c, i) => {
      const content = c.content.join("\n").trim();
      const preview = content.substring(0, 120).replace(/\s+/g, " ");
      return `<div class="split-chapter">
        <div class="split-ch-title">
          <span class="split-ch-num">${i + 1}</span>
          <span>${esc(c.title)}</span>
          <span class="split-ch-count">${content.length.toLocaleString()} 字</span>
        </div>
        <div class="split-ch-preview">${esc(preview) || "（空）"}</div>
      </div>`;
    }).join("");
  }

  function createNovelFromSplit() {
    if (!chapters.length) { alert("请先导入并拆分 TXT 文件"); return; }
    const novelName = prompt("请输入小说名称：", fileName || "新小说");
    if (!novelName) return;
    const novelId = "n_" + Date.now();
    const volId = "v_" + Date.now() + "_1";
    const novel = {
      id: novelId, name: novelName, type: "novel", expanded: true,
      children: [{
        id: volId, name: "第1卷", type: "volume", expanded: true,
        children: chapters.map((c, i) => ({
          id: "c_" + Date.now() + "_" + i, name: c.title, type: "chapter",
          content: c.content.join("\n").trim(),
        })),
      }],
    };
    if (!data.children) data.children = [];
    data.children.push(novel);
    markDirty(); saveData();
    document.dispatchEvent(new CustomEvent("novel:data-changed", { detail: {} }));
    alert(`已创建小说「${novelName}」，包含 ${chapters.length} 个章节。`);
    document.querySelector('.vbtn[data-view="write"]').click();
  }

  /* ==================================================================
   * 模块二：拆文分析
   * ================================================================== */
  let analyzeNovelId = null;
  let analyzeMode = "ai";
  let analyzing = false;
  let analyzeExternalText = "";
  let analyzeExternalName = "";
  let analyzeReport = "";

  function refreshAnalyzeNovels() {
    const sel = $("#analyze-novel");
    const novels = ((data && data.children) || []).filter(n => n.type === "novel");
    sel.innerHTML = novels.map(n => `<option value="${n.id}">${esc(n.name)}</option>`).join("");
    if (novels.length) {
      if (!analyzeNovelId || !novels.find(n => n.id === analyzeNovelId)) analyzeNovelId = novels[0].id;
      sel.value = analyzeNovelId;
      refreshAnalyzeChapters();
    }
  }
  function refreshAnalyzeChapters() {
    const sel = $("#analyze-chapter");
    const novel = findNode(analyzeNovelId);
    if (!novel) { sel.innerHTML = '<option value="__all__">全书所有章节</option>'; return; }
    const opts = ['<option value="__all__">全书所有章节</option>'];
    (novel.children || []).forEach(vol => {
      if (vol.type !== "volume") return;
      (vol.children || []).forEach(ch => {
        if (ch.type === "chapter") opts.push(`<option value="${ch.id}">${esc(vol.name)} · ${esc(ch.name)}</option>`);
      });
    });
    sel.innerHTML = opts.join("");
  }
  function getAnalyzeText() {
    if (analyzeExternalText) return { text: analyzeExternalText, title: analyzeExternalName };
    const novel = findNode(analyzeNovelId);
    if (!novel) return null;
    const chVal = $("#analyze-chapter").value;
    let text = "", title = novel.name;
    (novel.children || []).forEach(vol => {
      if (vol.type !== "volume") return;
      (vol.children || []).forEach(ch => {
        if (ch.type !== "chapter") return;
        if (chVal === "__all__" || ch.id === chVal) {
          text += `\n\n===== ${ch.name} =====\n${ch.content || ""}`;
        }
      });
    });
    return { text: text.trim(), title };
  }

  function loadAnalyzeFile(file) {
    if (!file) return;
    if (!/\.txt$/i.test(file.name) && file.type && !file.type.includes("text")) {
      alert("请选择 TXT 文本文件"); return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      let text = decodeBuffer(reader.result);
      if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
      analyzeExternalText = text;
      analyzeExternalName = file.name.replace(/\.[^.]+$/, "");
      updateAnalyzeSourceTag();
      setStatus(`已导入：${file.name}（${text.length.toLocaleString()} 字）`);
    };
    reader.onerror = () => alert("文件读取失败");
    reader.readAsArrayBuffer(file);
  }
  function updateAnalyzeSourceTag() {
    const tag = $("#analyze-source-tag");
    if (analyzeExternalText) {
      tag.classList.remove("hidden");
      tag.innerHTML = `📄 ${esc(analyzeExternalName)} <span class="x" title="移除">✕</span>`;
      tag.querySelector(".x").addEventListener("click", () => {
        analyzeExternalText = ""; analyzeExternalName = "";
        updateAnalyzeSourceTag(); $("#analyze-file").value = "";
        setStatus("已移除外部文件");
      });
    } else { tag.classList.add("hidden"); tag.innerHTML = ""; }
  }

  function getSelectedDims() {
    return Array.from($$("#analyze-dims input:checked")).map(i => i.value);
  }

  /* ---------- 规则模板拆解 ---------- */
  function ruleAnalyze(text, title, dims) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">📊 拆文总览</div>`;
    const totalChars = text.length;
    const paragraphs = text.split(/\n+/).filter(p => p.trim());
    const dialogues = (text.match(/["""][^"""]+["""]/g) || []);
    const sentences = text.split(/[。！？!?]/).filter(s => s.trim());
    const avgSentenceLen = sentences.length ? Math.round(totalChars / sentences.length) : 0;
    html += `<div class="analyze-stats-bar">
      <div class="analyze-stat-item"><span class="analyze-stat-num">${totalChars.toLocaleString()}</span><span class="analyze-stat-label">总字数</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${paragraphs.length}</span><span class="analyze-stat-label">段落数</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${dialogues.length}</span><span class="analyze-stat-label">对话数</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${avgSentenceLen}</span><span class="analyze-stat-label">平均句长</span></div>
    </div></div>`;

    // 维度一：结构骨架
    if (dims.includes("structure")) {
      html += analyzeStructure(text, title);
    }
    // 维度二：剧情概括
    if (dims.includes("plot")) {
      html += analyzePlot(text, title);
    }
    // 维度三：人物分析
    if (dims.includes("character")) {
      html += analyzeCharacter(text);
    }
    // 维度四：开篇钩子
    if (dims.includes("hook")) {
      html += analyzeHook(text);
    }
    // 维度五：叙事节奏
    if (dims.includes("rhythm")) {
      html += analyzeRhythm(text);
    }
    // 维度六：情绪人设
    if (dims.includes("emotion")) {
      html += analyzeEmotion(text);
    }
    // 维度七：行文文笔
    if (dims.includes("style")) {
      html += analyzeStyle(text);
    }
    // 维度八：写法借鉴
    if (dims.includes("technique")) {
      html += analyzeTechnique(text);
    }

    // 落地建议
    html += `<div class="analyze-section"><div class="analyze-section-title">🎯 落地用法建议</div>
      <div class="analyze-subtitle">三大可复用方向</div>
      <ul class="analyze-list">
        <li><b>套用故事框架</b>：将拆解出的结构骨架替换为自己的人物、背景、剧情，骨架照搬，内容原创</li>
        <li><b>针对性仿写练笔</b>：选1-2个经典段落，第一遍逐句仿写（换剧情不换逻辑），第二遍脱离原文用同风格自写</li>
        <li><b>分类积累素材</b>：将金句、钩子句式、情绪描写、反转套路分类存入素材库，写文卡文时直接取用</li>
      </ul>
      <div class="analyze-subtitle">新手避坑提醒</div>
      <ul class="analyze-list">
        <li>❌ 只抄剧情、抄人设 → 容易撞梗同质化，要抄的是结构和方法</li>
        <li>❌ 只看优美句子不看整体结构 → 写文还是散乱，要先拆骨架再抠细节</li>
        <li>❌ 拆完不仿写不套用 → 只收藏不练习完全无法内化，拆完必须动手练</li>
        <li>❌ 拆太多篇风格杂乱 → 新手先固定拆同赛道3-5篇，统一文风</li>
      </ul>
    </div>`;

    return html;
  }

  function analyzeStructure(text, title) {
    const CN = "一二三四五六七八九十百千零〇两";
    const chRe = new RegExp(`^[\\s　]*第[${CN}\\d]+[章回节][\\s\\u3000:：、．.．]*(.*)$`, "m");
    const lines = text.split(/\r\n|\r|\n/);
    const scenes = [];
    let current = { name: "开篇", content: [] };
    for (const line of lines) {
      const t = line.trim();
      if (t.length > 0 && t.length <= 60 && chRe.test(t)) {
        if (current.name || current.content.length) scenes.push(current);
        current = { name: t, content: [] };
      } else current.content.push(line);
    }
    if (current.name || current.content.length) scenes.push(current);

    let html = `<div class="analyze-section"><div class="analyze-section-title">🏗️ 维度一：结构骨架拆解</div>`;
    html += `<div class="analyze-subtitle">章节结构功能表（按结构功能分组）</div>`;
    html += `<table class="analyze-table"><tr><th>结构功能</th><th>章节范围</th><th>字数</th><th>占比</th><th>作用说明</th></tr>`;
    const total = scenes.reduce((s, c) => s + c.content.join("\n").length, 0) || 1;
    const funcs = [
      { name: "开篇引入", desc: "抛出钩子、建立人设、引入核心冲突，让读者快速入戏" },
      { name: "铺垫展开", desc: "世界观展开、矛盾建立、人物关系铺垫，为后续冲突蓄势" },
      { name: "发展推进", desc: "矛盾升级、障碍出现、主角成长，剧情持续向前推进" },
      { name: "小高潮", desc: "第一次爽点/小爆发，给读者即时满足，验证主角能力" },
      { name: "转折反转", desc: "意料之外的剧情转折，打破既定节奏，制造悬念和期待" },
      { name: "高潮爆发", desc: "核心对决/最终冲突，全剧情绪最高点，矛盾集中爆发" },
      { name: "收束留白", desc: "矛盾解决、情感落地、余韵回味，埋设新钩子引出后续" },
    ];
    // 按结构功能分组连续章节
    const groups = [];
    let currentGroup = null;
    scenes.forEach((s, i) => {
      const funcIdx = Math.min(Math.floor(i / Math.max(1, scenes.length / 7)), 6);
      if (!currentGroup || currentGroup.funcIdx !== funcIdx) {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = { funcIdx, startIdx: i, endIdx: i, chars: 0 };
      } else {
        currentGroup.endIdx = i;
      }
      currentGroup.chars += s.content.join("\n").length;
    });
    if (currentGroup) groups.push(currentGroup);

    groups.forEach(g => {
      const f = funcs[g.funcIdx];
      const rangeText = g.startIdx === g.endIdx
        ? scenes[g.startIdx].name
        : `${scenes[g.startIdx].name} ~ ${scenes[g.endIdx].name}`;
      const pct = (g.chars / total * 100).toFixed(1);
      html += `<tr><td><b>${f.name}</b></td><td>${esc(rangeText)}</td><td>${g.chars.toLocaleString()}</td><td>${pct}%</td><td>${f.desc}</td></tr>`;
    });
    html += `</table>`;

    // 起承转合分析（直接说章节范围和作用）
    html += `<div class="analyze-subtitle">起承转合结构分析</div>`;
    const quarter = Math.ceil(scenes.length / 4);
    const arcDefs = [
      { name: "起", range: scenes.slice(0, quarter), desc: "建立世界观、主角出场、抛出核心冲突，让读者知道故事讲什么" },
      { name: "承", range: scenes.slice(quarter, quarter * 2), desc: "矛盾展开、角色关系建立、障碍出现，剧情稳步发展蓄势" },
      { name: "转", range: scenes.slice(quarter * 2, quarter * 3), desc: "冲突升级、关键转折、高潮爆发，剧情急转直下推向顶点" },
      { name: "合", range: scenes.slice(quarter * 3), desc: "矛盾解决、情感落地、余韵回味，收束全文并埋设新钩子" },
    ];
    html += `<ul class="analyze-list">`;
    arcDefs.forEach(p => {
      if (!p.range.length) return;
      const rangeText = p.range.length === 1
        ? p.range[0].name
        : `${p.range[0].name} ~ ${p.range[p.range.length - 1].name}`;
      html += `<li><b>${p.name}（${esc(rangeText)}）</b>：${p.desc}</li>`;
    });
    html += `</ul></div>`;
    return html;
  }

  function analyzeHook(text) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">🪝 维度四：开篇钩子拆解</div>`;
    // 前300字
    const first300 = text.substring(0, 300).trim();
    html += `<div class="analyze-subtitle">开篇前300字分析</div>`;
    html += `<div class="analyze-quote">${esc(first300)}${text.length > 300 ? "……" : ""}</div>`;

    // 钩子类型判断
    const hookTypes = [];
    if (/[。！？]\s*$/.test(first300) || /突然|忽然|就在这时|然而|但是/.test(first300)) hookTypes.push("⚡ 冲突前置型（直接进入事件）");
    if (/他是|她是|我叫|名叫|身份|穿越|重生|系统/.test(first300)) hookTypes.push("🎭 人设反差型（身份/能力反差）");
    if (/为什么|怎么|难道|究竟|秘密|谜团|疑惑/.test(first300)) hookTypes.push("❓ 悬念疑问型（抛出未解之谜）");
    if (/委屈|愤怒|不甘|心痛|绝望|恐惧|冰冷/.test(first300)) hookTypes.push("💔 情绪戳中型（直接调动情绪）");
    if (/死亡|杀|血|尸体|刀|剑|战斗|危险|危机/.test(first300)) hookTypes.push("⚠️ 危机紧迫型（生命/生存威胁）");
    if (!hookTypes.length) hookTypes.push("📝 场景铺垫型（需注意：前300字未出现强钩子，建议优化）");

    html += `<div class="analyze-subtitle">钩子类型识别</div>`;
    html += `<div class="analyze-text">${hookTypes.map(t => `<span class="analyze-tag">${t}</span>`).join("")}</div>`;

    // 章末钩子统计
    const chapterEnds = [];
    const CN = "一二三四五六七八九十百千零〇两";
    const chRe = new RegExp(`=====\\s*第[${CN}\\d]+[章回节][^=]*=====`);
    const parts = text.split(/=====\s*[^=]+=====/);
    parts.forEach((p, i) => {
      if (i === 0 || !p.trim()) return;
      const lastPara = p.trim().split(/\n+/).pop() || "";
      const lastSentence = lastPara.split(/[。！？]/).filter(s => s.trim()).pop() || "";
      if (lastSentence) chapterEnds.push({ chapter: i, text: lastSentence.substring(0, 60) });
    });

    if (chapterEnds.length) {
      html += `<div class="analyze-subtitle">章末钩子摘录（${chapterEnds.length}处）</div>`;
      html += `<ul class="analyze-list">`;
      chapterEnds.forEach(c => {
        html += `<li>第${c.chapter}章末：<span class="analyze-quote" style="display:inline">${esc(c.text)}……</span></li>`;
      });
      html += `</ul>`;
    }
    html += `</div>`;
    return html;
  }

  function analyzeRhythm(text) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">⚡ 维度五：叙事节奏拆解</div>`;
    const sentences = text.split(/[。！？!?]/).filter(s => s.trim());
    const shortS = sentences.filter(s => s.length <= 15).length;
    const midS = sentences.filter(s => s.length > 15 && s.length <= 40).length;
    const longS = sentences.filter(s => s.length > 40).length;
    const total = sentences.length || 1;

    html += `<div class="analyze-subtitle">句式节奏分布</div>`;
    html += `<div class="analyze-stats-bar">
      <div class="analyze-stat-item"><span class="analyze-stat-num">${shortS}</span><span class="analyze-stat-label">短句（≤15字）${(shortS/total*100).toFixed(0)}%</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${midS}</span><span class="analyze-stat-label">中句（16-40字）${(midS/total*100).toFixed(0)}%</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${longS}</span><span class="analyze-stat-label">长句（>40字）${(longS/total*100).toFixed(0)}%</span></div>
    </div>`;

    // 快慢节奏判断
    const dialogueRatio = ((text.match(/["""][^"""]+["""]/g) || []).length / total * 100).toFixed(0);
    html += `<div class="analyze-subtitle">节奏特征分析</div>`;
    const features = [];
    if (shortS / total > 0.4) features.push("🔥 快节奏为主：短句占比高，适合冲突/打斗/紧张场景");
    if (longS / total > 0.3) features.push("🌊 慢节奏为主：长句占比高，适合心理/环境/情感铺垫");
    if (dialogueRatio > 30) features.push(`💬 对话密集：对话占比${dialogueRatio}%，推进剧情效率高`);
    if (/突然|忽然|就在|刹那|瞬间|猛地/.test(text)) features.push("⚡ 突发转折词使用：制造节奏突变点");
    if (!features.length) features.push("📊 节奏均衡：长短句搭配适中，叙事平稳");
    html += `<ul class="analyze-list">${features.map(f => `<li>${f}</li>`).join("")}</ul>`;

    // 节奏建议
    html += `<div class="analyze-subtitle">节奏优化建议</div>`;
    html += `<ul class="analyze-list">
      <li>冲突/打斗/高潮处：全用短句+对话，制造紧张感</li>
      <li>心理/回忆/情感处：加长句+细节描写，放慢节奏</li>
      <li>快慢穿插：紧一下松一下，避免全程紧绷或全程拖沓</li>
      <li>每3-5章一个小高潮，每10-15章一个中高潮，每30章一个大反转</li>
    </ul></div>`;
    return html;
  }

  function analyzeEmotion(text) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">💫 维度六：情绪人设拆解</div>`;

    // 情绪词统计
    const emotionWords = {
      "愤怒/暴怒": /愤怒|暴怒|大怒|怒吼|咬牙|握拳|铁青|气得|火大/,
      "悲伤/痛苦": /悲伤|悲痛|痛苦|心碎|落泪|哭泣|哽咽|绝望|凄凉|哀伤/,
      "喜悦/兴奋": /喜悦|兴奋|开心|大喜|狂喜|笑逐|开怀|欢欣|雀跃/,
      "紧张/恐惧": /紧张|恐惧|害怕|心惊|胆战|发颤|冷汗|屏息|惴惴/,
      "不甘/委屈": /不甘|委屈|憋屈|愤愤|不平|酸涩|眼红|隐忍/,
      "期待/希望": /期待|盼望|希望|曙光|转机|憧憬|跃跃/,
    };
    html += `<div class="analyze-subtitle">核心情绪分布</div>`;
    html += `<table class="analyze-table"><tr><th>情绪类型</th><th>出现次数</th><th>占比</th></tr>`;
    let totalEmotion = 0;
    const emoCounts = {};
    for (const [name, re] of Object.entries(emotionWords)) {
      const count = (text.match(re) || []).length;
      emoCounts[name] = count;
      totalEmotion += count;
    }
    for (const [name, count] of Object.entries(emoCounts)) {
      html += `<tr><td>${name}</td><td>${count}</td><td>${totalEmotion ? (count/totalEmotion*100).toFixed(0) : 0}%</td></tr>`;
    }
    html += `</table>`;

    // 人设塑造手法分析（带原文举例）
    html += `<div class="analyze-subtitle">人设塑造手法分析（附原文举例）</div>`;
    html += `<ul class="analyze-list">`;

    // 对话立人设
    if (/[，,]?\s*[\u4e00-\u9fa5]{2,3}\s*(?:道|说|问)\s*[：:]/.test(text)) {
      const dialogueExamples = [];
      const dRe = /([\u4e00-\u9fa5]{2,3})\s*(?:淡淡|冷冷|微微|缓缓|轻声|高声|低声|大声|沉声|厉声)?\s*(?:道|说|问|答|叫|喊)\s*[：:]\s*[""""]?([^""""\n]{1,40})/g;
      let dm;
      while ((dm = dRe.exec(text)) !== null && dialogueExamples.length < 2) {
        dialogueExamples.push(`${dm[1]}："${dm[2].trim()}"`);
      }
      html += `<li><b>💬 对话立人设</b>：通过角色语言风格体现性格，说话方式即人设<br>`;
      if (dialogueExamples.length) {
        html += `<span class="analyze-quote">举例：${dialogueExamples.map(e => esc(e)).join("；")}</span>`;
      } else {
        html += `<span class="analyze-quote">举例：角色A冷声道"不必多言"（高冷人设）；角色B笑道"这有何难"（自信人设）</span>`;
      }
      html += `</li>`;
    }

    // 微习惯立人设
    if (/微微|缓缓|淡淡|轻轻|默默|下意识|习惯性|总是|每次|不禁|不由/.test(text)) {
      const habitExamples = [];
      const hRe = /([\u4e00-\u9fa5]{0,6}(?:微微|缓缓|淡淡|轻轻|默默|下意识|习惯性|总是|每次|不禁|不由)[\u4e00-\u9fa5]{0,20})/g;
      let hm;
      while ((hm = hRe.exec(text)) !== null && habitExamples.length < 2) {
        const ex = hm[1].trim();
        if (ex.length >= 4 && ex.length <= 30) habitExamples.push(ex);
      }
      html += `<li><b>🤏 微习惯立人设</b>：通过重复小动作/口头禅塑造记忆点，细节见真章<br>`;
      if (habitExamples.length) {
        html += `<span class="analyze-quote">举例：${habitExamples.map(e => esc(e)).join("；")}</span>`;
      } else {
        html += `<span class="analyze-quote">举例："他习惯性地摩挲着酒杯边缘"（紧张/沉思人设）；"她总是先笑再说话"（温和人设）</span>`;
      }
      html += `</li>`;
    }

    // 神态描写立人设
    if (/眼神|目光|瞳孔|表情|脸色|嘴角|眉头|眼眶|眼帘|神色/.test(text)) {
      const exprExamples = [];
      const eRe = /([\u4e00-\u9fa5]{0,8}(?:眼神|目光|瞳孔|表情|脸色|嘴角|眉头|眼眶|神色)[\u4e00-\u9fa5]{0,20})/g;
      let em;
      while ((em = eRe.exec(text)) !== null && exprExamples.length < 2) {
        const ex = em[1].trim();
        if (ex.length >= 4 && ex.length <= 35) exprExamples.push(ex);
      }
      html += `<li><b>👁️ 神态描写立人设</b>：通过面部微表情传递内心，眼神即情绪<br>`;
      if (exprExamples.length) {
        html += `<span class="analyze-quote">举例：${exprExamples.map(e => esc(e)).join("；")}</span>`;
      } else {
        html += `<span class="analyze-quote">举例："他眉头微蹙，目光沉了下来"（隐忍/愤怒人设）；"她眼眶一红，却强撑着笑"（坚强/委屈人设）</span>`;
      }
      html += `</li>`;
    }

    // 动作外化情绪
    if (/抬手|转身|迈步|握拳|攥紧|退后|上前|后退|猛地|忽然站|拍桌|摔/.test(text)) {
      const actExamples = [];
      const aRe = /([\u4e00-\u9fa5]{0,6}(?:抬手|转身|迈步|握拳|攥紧|退后|上前|后退|猛地|拍桌|摔)[\u4e00-\u9fa5]{0,20})/g;
      let am;
      while ((am = aRe.exec(text)) !== null && actExamples.length < 2) {
        const ex = am[1].trim();
        if (ex.length >= 4 && ex.length <= 35) actExamples.push(ex);
      }
      html += `<li><b>🏃 动作外化情绪</b>：用动作代替直白心理描写，身体比语言诚实<br>`;
      if (actExamples.length) {
        html += `<span class="analyze-quote">举例：${actExamples.map(e => esc(e)).join("；")}</span>`;
      } else {
        html += `<span class="analyze-quote">举例："他猛地站起身，椅子被带倒在地"（愤怒爆发人设）；"她下意识退后一步，攥紧了衣角"（恐惧/防备人设）</span>`;
      }
      html += `</li>`;
    }

    // 如果没有检测到任何手法，给通用建议
    if (!/对话立人设|微习惯立人设|神态描写立人设|动作外化情绪/.test(html)) {
      html += `<li>📝 当前文本人设塑造手法较单一，建议综合运用以下手法：<br>
        <span class="analyze-quote">① 对话立人设：让角色说话方式符合性格（高冷人话少、话痨人话多）<br>
        ② 微习惯立人设：给角色一个标志性小动作（摸下巴、转戒指、推眼镜）<br>
        ③ 神态描写立人设：用眼神/嘴角/眉头变化代替"他很生气"<br>
        ④ 动作外化情绪：用身体动作传递情绪（愤怒时摔东西、紧张时搓手）</span></li>`;
    }
    html += `</ul>`;

    // 情绪曲线建议
    html += `<div class="analyze-subtitle">情绪曲线设计建议</div>`;
    html += `<div class="analyze-text">标准情绪曲线：平静铺垫 → 小冲突 → 愤怒/憋屈 → 极度压抑 → 反转爆发 → 爽感释放 → 温情治愈 → 新悬念。核心公式：<b>压抑值 × 伏笔密度 = 爆发强度</b>。</div>`;
    html += `</div>`;
    return html;
  }

  function analyzeStyle(text) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">✍️ 维度七：行文文笔拆解</div>`;

    // 对话占比
    const dialogues = text.match(/["""][^"""]+["""]/g) || [];
    const dialogueChars = dialogues.reduce((s, d) => s + d.length, 0);
    const dialogueRatio = (dialogueChars / (text.length || 1) * 100).toFixed(0);

    html += `<div class="analyze-subtitle">文笔基础数据</div>`;
    html += `<div class="analyze-stats-bar">
      <div class="analyze-stat-item"><span class="analyze-stat-num">${dialogueRatio}%</span><span class="analyze-stat-label">对话占比</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${dialogues.length}</span><span class="analyze-stat-label">对话句数</span></div>
      <div class="analyze-stat-item"><span class="analyze-stat-num">${(text.match(/[，,、；;]/g) || []).length}</span><span class="analyze-stat-label">标点总数</span></div>
    </div>`;

    // 金句提取（短句、有哲理/冲击力的句子）
    const sentences = text.split(/[。！？!?\n]/).map(s => s.trim()).filter(s => s.length >= 4 && s.length <= 40);
    const golden = sentences.filter(s =>
      /不是|而是|从来|永远|终究|原来|其实|所谓|也许|或许|如果|只要|除非|宁可|宁愿|哪怕|即使|纵然|唯有|只因|因为|所以/.test(s) &&
      !/["""]/.test(s)
    ).slice(0, 8);

    if (golden.length) {
      html += `<div class="analyze-subtitle">金句摘录（${golden.length}句）</div>`;
      golden.forEach(g => { html += `<div class="analyze-quote">${esc(g)}</div>`; });
    }

    // 文笔特征
    html += `<div class="analyze-subtitle">文笔特征识别</div>`;
    const styleFeatures = [];
    if (/忽然|突然|骤然|蓦然|倏地/.test(text)) styleFeatures.push("⚡ 善用突发副词制造节奏突变");
    if (/仿佛|宛如|犹如|好似|如同|像|似的/.test(text)) styleFeatures.push("🎨 善用比喻增强画面感");
    if (/听觉|嗅觉|味觉|触觉|视觉|耳边|鼻尖|指尖|眼中/.test(text)) styleFeatures.push("👃 五感描写丰富（多感官调动）");
    if (/侧写|侧面|众人|围观|旁人|所有人/.test(text)) styleFeatures.push("👥 善用侧面描写（通过他人反应衬托）");
    if (/留白|沉默|不语|没说话|一言不发|空气.*凝固/.test(text)) styleFeatures.push("🤫 善用留白（沉默/停顿传递情绪）");
    if (!styleFeatures.length) styleFeatures.push("📝 文笔平实：以叙述和对话为主，简洁直接");
    html += `<ul class="analyze-list">${styleFeatures.map(f => `<li>${f}</li>`).join("")}</ul>`;

    // 可借鉴写法
    html += `<div class="analyze-subtitle">可借鉴写法总结</div>`;
    html += `<ul class="analyze-list">
      <li>对话原则：每句不超过15字，必有交锋或信息增量，杜绝废话</li>
      <li>情绪外化：难过看温度、委屈看指尖、紧张看呼吸、忐忑看光影</li>
      <li>金句公式：对比反转式（我们以为A，其实B）/ 排比升华式 / 悖论制造式（越X越Y）</li>
      <li>金句位置：段落结尾强化记忆 / 情绪高潮后画龙点睛 / 全文结尾升华主题</li>
      <li>避免：直白写情绪（"我很难过"）、大段心理独白、连续超过200字景物描写</li>
    </ul></div>`;
    return html;
  }

  /* ---------- 维度六：剧情过程概括 ---------- */
  function analyzePlot(text, title) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">📖 维度二：剧情过程概括</div>`;

    // 按章节拆分
    const CN = "一二三四五六七八九十百千零〇两";
    const chRe = new RegExp(`^[\\s　]*第[${CN}\\d]+[章回节][\\s\\u3000:：、．.．]*(.*)$`, "m");
    const lines = text.split(/\r\n|\r|\n/);
    const scenes = [];
    let current = { name: "开篇", content: [] };
    for (const line of lines) {
      const t = line.trim();
      if (t.length > 0 && t.length <= 60 && chRe.test(t)) {
        if (current.name || current.content.length) scenes.push(current);
        current = { name: t, content: [] };
      } else current.content.push(line);
    }
    if (current.name || current.content.length) scenes.push(current);

    // 按大事件分组的剧情概括
    html += `<div class="analyze-subtitle">剧情大事件概括（按事件分章）</div>`;
    html += `<table class="analyze-table"><tr><th>大事件</th><th>章节范围</th><th>核心内容</th><th>事件类型</th></tr>`;

    // 检测每章的事件类型，连续同类型合并为大事件
    const eventTypes = [];
    scenes.forEach(s => {
      const content = s.content.join("\n");
      let type = "剧情推进";
      if (/相遇|重逢|遇见|发现|得知|秘密|真相/.test(content)) type = "关键发现";
      else if (/冲突|矛盾|争执|对峙|对抗|打架|打斗/.test(content)) type = "矛盾冲突";
      else if (/突然|忽然|然而|但是|可是|却|不料|没想到|反转|转折/.test(content)) type = "突发转折";
      else if (/决定|计划|准备|出发|踏上|启程/.test(content)) type = "行动决策";
      else if (/高潮|决战|对决|最终|生死|危机/.test(content)) type = "高潮爆发";
      else if (/结局|结束|圆满|和解|放下|新的开始/.test(content)) type = "结局收束";
      eventTypes.push(type);
    });

    // 合并连续同类型章节
    const eventGroups = [];
    let curEvent = null;
    scenes.forEach((s, i) => {
      if (!curEvent || curEvent.type !== eventTypes[i]) {
        if (curEvent) eventGroups.push(curEvent);
        curEvent = { type: eventTypes[i], startIdx: i, endIdx: i, content: "" };
      } else {
        curEvent.endIdx = i;
      }
      const content = s.content.join("\n").trim();
      if (content) curEvent.content += (curEvent.content ? " " : "") + content;
    });
    if (curEvent) eventGroups.push(curEvent);

    eventGroups.forEach((g, idx) => {
      const rangeText = g.startIdx === g.endIdx
        ? scenes[g.startIdx].name
        : `${scenes[g.startIdx].name} ~ ${scenes[g.endIdx].name}`;
      // 提取核心内容摘要
      const sentences = g.content.split(/[。！？!?\n]/).map(x => x.trim()).filter(x => x.length >= 5);
      const summary = sentences.find(x => x.length <= 50) || sentences[0] || g.content.substring(0, 50);
      html += `<tr><td><b>事件${idx + 1}</b></td><td>${esc(rangeText)}</td><td>${esc(summary.substring(0, 60))}${summary.length > 60 ? "…" : ""}</td><td>${g.type}</td></tr>`;
    });
    html += `</table>`;

    // 起承转合（直接说章节范围和作用）
    html += `<div class="analyze-subtitle">剧情起承转合分析</div>`;
    const quarter = Math.ceil(scenes.length / 4);
    const arcDefs = [
      { name: "起", range: scenes.slice(0, quarter), desc: "主角出场、世界观建立、核心冲突抛出，故事的起点和动因" },
      { name: "承", range: scenes.slice(quarter, quarter * 2), desc: "矛盾展开、关系建立、障碍出现，剧情稳步推进蓄势" },
      { name: "转", range: scenes.slice(quarter * 2, quarter * 3), desc: "冲突升级、关键转折、高潮爆发，剧情推向顶点" },
      { name: "合", range: scenes.slice(quarter * 3), desc: "矛盾解决、情感落地、余韵收束，结局和新悬念" },
    ];
    html += `<ul class="analyze-list">`;
    arcDefs.forEach(p => {
      if (!p.range.length) return;
      const rangeText = p.range.length === 1
        ? p.range[0].name
        : `${p.range[0].name} ~ ${p.range[p.range.length - 1].name}`;
      html += `<li><b>${p.name}（${esc(rangeText)}）</b>：${p.desc}</li>`;
    });
    html += `</ul>`;

    // 关键转折点
    html += `<div class="analyze-subtitle">关键转折点识别</div>`;
    const turningPoints = [];
    scenes.forEach((s, i) => {
      const content = s.content.join("\n");
      if (/突然|忽然|然而|但是|可是|却|不料|没想到|就在这时|就在此时/.test(content)) {
        const m = content.match(/[^。！？\n]*(?:突然|忽然|然而|但是|可是|却|不料|没想到|就在这时|就在此时)[^。！？\n]*[。！？]?/);
        turningPoints.push({ chapter: s.name, text: (m ? m[0] : content.substring(0, 50)).trim() });
      }
    });
    if (turningPoints.length) {
      html += `<ul class="analyze-list">`;
      turningPoints.slice(0, 6).forEach(tp => {
        html += `<li><b>${esc(tp.chapter)}</b>：<span class="analyze-quote" style="display:inline">${esc(tp.text.substring(0, 80))}</span></li>`;
      });
      html += `</ul>`;
    } else {
      html += `<div class="analyze-text">未检测到明显转折标记，建议人工梳理剧情转折点。</div>`;
    }
    html += `</div>`;
    return html;
  }

  /* ---------- 维度七：人物分析 ---------- */
  function analyzeCharacter(text) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">👤 维度三：人物分析</div>`;

    // 提取人物名：在说话动词前，允许中间有简短动作描述
    const nameCount = {};
    const nameRe = /(?:^|[，,。！？\n\s　])([\u4e00-\u9fa5]{2,3})[\u4e00-\u9fa5，,、：:\s]{0,10}?(?:道|说|问|答|叫|喊|笑|骂|吼|叹)/g;
    let m;
    const skipNames = new Set(["缓缓", "淡淡", "轻声", "高声", "低声", "大声", "冷冷", "微微", "默默", "喃喃", "沉声", "厉声", "随即", "心中", "心里", "眼中", "眼里", "脸上", "手中", "手里", "身上", "脚下", "点头", "点点", "摇头", "转身", "抬头", "低头", "睁眼", "闭眼", "一声", "只听", "只见", "但见", "却说", "原来", "说着", "想着", "看着", "听着", "不禁", "不由", "暗自", "赶紧", "连忙", "急忙", "忽然", "突然", "然而", "但是", "可是", "不料", "没想到", "就在", "此时", "这时", "众人", "大家", "人们", "旁人", "路人", "所有人", "他们", "她们", "我们", "你们", "自己", "一个", "这个", "那个", "什么", "怎么", "为什么", "不是", "就是", "只是", "还是", "也是", "都不", "都没", "没有", "不会", "不能", "不要", "不敢", "不可", "不必", "不如", "不禁", "不由", "暗自", "赶紧", "连忙", "急忙", "仿佛", "好像", "似乎", "犹如", "宛如", "好似", "如同", "仿佛", "原来", "其实", "然而", "但是", "可是", "不过", "虽然", "尽管", "即使", "哪怕", "除非", "只要", "只有", "无论", "不管", "因为", "所以", "因此", "于是", "然后", "接着", "随后", "最后", "终于", "忽然", "突然", "渐渐", "慢慢", "缓缓", "淡淡", "微微", "默默", "喃喃", "冷冷", "轻轻", "悄悄", "偷偷", "暗暗", "明明", "偏偏", "恰恰", "刚刚", "才刚", "已经", "曾经", "正在", "将要", "快要", "几乎", "简直", "实在", "确实", "的确", "当然", "自然", "显然", "明显", "必然", "一定", "肯定", "也许", "或许", "大概", "大约", "差不多", "几乎", "简直"]);
    while ((m = nameRe.exec(text)) !== null) {
      let n = m[1];
      // 三字名第三字是动词/助词时，只取前两字
      if (n.length === 3 && /[沉沉默思想看听说说道问答叫喊哭笑打骂走跑吃喝来去起坐站转抬低睁闭点摇挥迎上下出进退拿放给找等回过关开接送买卖读写画唱跳爬飞游骑推拉提踩踢抓握拍靠叹呼吸愣怒愁怕爱恨盼望瞪闪想思知道认识以为觉得]/.test(n[2])) {
        n = n.substring(0, 2);
      }
      if (!skipNames.has(n) && !/^[了着过不没是非有无可很最都也就还又再把被在从向对和跟与及或且而但如假若虽尽即哪那这你我他她它]/.test(n) && !/[了着过的地得是在有不没会能要想来看去说做打走跑吃吃喝喝哭哭笑笑笑骂打叫喊问道问答]/.test(n[1])) {
        nameCount[n] = (nameCount[n] || 0) + 1;
      }
    }
    // 按频次排序，保留所有有效人名
    const names = Object.entries(nameCount)
      .filter(([_, c]) => c >= 1)
      .sort((a, b) => b[1] - a[1])
      .map(([n]) => n)
      .slice(0, 8);

    if (!names.length) {
      html += `<div class="analyze-text">未检测到明确的人物名称。</div></div>`;
      return html;
    }

    // 逐个人物分析
    html += `<div class="analyze-subtitle">人物详细分析（${names.length}人）</div>`;
    names.forEach((name, idx) => {
      // 提取该人物相关的上下文
      const contextRe = new RegExp(`[^。！？\\n]*${name}[^。！？\\n]*[。！？]?`, "g");
      const contexts = [];
      let cm;
      while ((cm = contextRe.exec(text)) !== null) {
        const c = cm[0].trim();
        if (c.length >= 8 && c.length <= 100) contexts.push(c);
      }
      const sample = contexts.slice(0, 3);

      // 推断性格
      const traits = [];
      const allContext = contexts.join("");
      if (/淡淡|冷冷|微微|默默|不动声色|面无表情/.test(allContext)) traits.push("冷静沉稳");
      if (/怒|吼|骂|咬牙|握拳|铁青/.test(allContext)) traits.push("性情刚烈");
      if (/笑|哈哈|嘻嘻|开心|欢喜/.test(allContext)) traits.push("开朗乐观");
      if (/想|暗想|心|犹豫|纠结|迟疑/.test(allContext)) traits.push("心思细腻");
      if (/快步|上前|喊道|主动|立刻|马上/.test(allContext)) traits.push("行动果决");
      if (/缓缓|慢慢|轻轻|小心翼翼|谨慎/.test(allContext)) traits.push("谨慎细致");
      if (!traits.length) traits.push("待进一步分析");

      // 推断角色功能
      let role = "主要角色";
      if (idx === 0) role = "主角（视角人物）";
      else if (idx === 1) role = "重要配角/对手";
      else if (/敌|反|坏|恶|恨/.test(allContext)) role = "反派/对手";

      html += `<div style="margin-bottom:16px;padding:12px;background:var(--panel2);border-radius:10px;">
        <div style="font-weight:700;font-size:15px;color:var(--accent);margin-bottom:6px;">${idx + 1}. ${esc(name)} <span style="font-size:11px;font-weight:400;color:var(--text-sub);">（${role}）</span></div>
        <div style="font-size:13px;margin-bottom:6px;"><b>性格推断：</b>${traits.map(t => `<span class="analyze-tag">${t}</span>`).join("")}</div>
        <div style="font-size:13px;margin-bottom:6px;"><b>出场次数：</b>${contexts.length} 处</div>
        <div style="font-size:13px;"><b>原文举例：</b></div>`;
      sample.forEach(s => {
        html += `<div class="analyze-quote" style="margin:4px 0;">${esc(s)}</div>`;
      });
      if (!sample.length) html += `<div style="font-size:12px;color:var(--text-sub);">（无足够上下文）</div>`;
      html += `</div>`;
    });

    // 人物关系
    html += `<div class="analyze-subtitle">人物关系推断</div>`;
    if (names.length >= 2) {
      html += `<ul class="analyze-list">`;
      for (let i = 0; i < Math.min(names.length, 3); i++) {
        for (let j = i + 1; j < Math.min(names.length, 4); j++) {
          const pairRe = new RegExp(`[^。！？\\n]*${names[i]}[^。！？\\n]*${names[j]}[^。！？\\n]*[。！？]?`, "g");
          const pairRe2 = new RegExp(`[^。！？\\n]*${names[j]}[^。！？\\n]*${names[i]}[^。！？\\n]*[。！？]?`, "g");
          const pairContexts = [...text.matchAll(pairRe), ...text.matchAll(pairRe2)].map(x => x[0]).filter(c => c.length >= 10);
          let relation = "同场出现";
          if (pairContexts.some(c => /相遇|重逢|遇见|相认|相识/.test(c))) relation = "相识/重逢关系";
          else if (pairContexts.some(c => /敌|对|打|杀|恨|怒|冲突/.test(c))) relation = "对立/敌对关系";
          else if (pairContexts.some(c => /帮|助|救|护|陪|随|友/.test(c))) relation = "同伴/互助关系";
          else if (pairContexts.some(c => /师|徒|父|母|兄|弟|姐|妹|子|女/.test(c))) relation = "亲属/师徒关系";
          html += `<li><b>${esc(names[i])}</b> ↔ <b>${esc(names[j])}</b>：${relation}（同场${pairContexts.length}处）</li>`;
        }
      }
      html += `</ul>`;
    }
    html += `</div>`;
    return html;
  }

  /* ---------- 维度八：写法借鉴（带详细举例） ---------- */
  function analyzeTechnique(text) {
    let html = `<div class="analyze-section"><div class="analyze-section-title">✨ 维度八：写法借鉴（附原文举例）</div>`;

    // 1. 对话写法
    html += `<div class="analyze-subtitle">一、对话写法借鉴</div>`;
    const dialogues = text.match(/["""][^"""]+["""]/g) || [];
    const goodDialogues = dialogues.filter(d => d.length >= 4 && d.length <= 40).slice(0, 3);
    html += `<div class="analyze-text"><b>对话原则：</b>每句不超过15字，必有交锋或信息增量，杜绝废话。好的对话推动剧情或展示性格。</div>`;
    if (goodDialogues.length) {
      html += `<div style="font-size:13px;margin-bottom:4px;"><b>原文优秀对话举例：</b></div>`;
      goodDialogues.forEach(d => {
        html += `<div class="analyze-quote">${esc(d)}</div>`;
      });
      html += `<div style="font-size:12px;color:var(--text-sub);margin-top:4px;">💡 借鉴点：简洁有力，每句都在推进情节或展示人物性格，没有冗余寒暄。</div>`;
    }

    // 2. 描写写法
    html += `<div class="analyze-subtitle">二、描写写法借鉴</div>`;
    html += `<div class="analyze-text"><b>描写原则：</b>情绪外化落地——难过看温度、委屈看指尖、紧张看呼吸、忐忑看光影。用动作和环境代替直白心理描写。</div>`;
    const descExamples = [];
    const descRe = /[^。！？\n]*(?:指尖|掌心|手心|眉头|嘴角|眼神|目光|呼吸|心跳|喉结|脊背|背影|身影|月光|阳光|灯光|风雨|雪)[^。！？\n]*[。！？]?/g;
    let dm;
    while ((dm = descRe.exec(text)) !== null) {
      const c = dm[0].trim();
      if (c.length >= 10 && c.length <= 80) descExamples.push(c);
    }
    if (descExamples.length) {
      html += `<div style="font-size:13px;margin-bottom:4px;"><b>原文优秀描写举例：</b></div>`;
      descExamples.slice(0, 3).forEach(d => {
        html += `<div class="analyze-quote">${esc(d)}</div>`;
      });
      html += `<div style="font-size:12px;color:var(--text-sub);margin-top:4px;">💡 借鉴点：通过身体部位（指尖/眉头/眼神）和环境细节外化情绪，不直接写"他很难过"。</div>`;
    }

    // 3. 节奏写法
    html += `<div class="analyze-subtitle">三、节奏写法借鉴</div>`;
    html += `<div class="analyze-text"><b>节奏原则：</b>长短句穿插——长句铺叙场景，短句砸情绪、砸画面。冲突处全用短句+对话，回忆/情感处加长句+细节。</div>`;
    const shortSentences = text.split(/[。！？!?]/).map(s => s.trim()).filter(s => s.length >= 2 && s.length <= 10);
    if (shortSentences.length) {
      html += `<div style="font-size:13px;margin-bottom:4px;"><b>原文短句节奏举例：</b></div>`;
      shortSentences.slice(0, 4).forEach(s => {
        html += `<div class="analyze-quote">${esc(s)}。</div>`;
      });
      html += `<div style="font-size:12px;color:var(--text-sub);margin-top:4px;">💡 借鉴点：短句独立成段，制造停顿和冲击力，在关键情绪点使用效果最佳。</div>`;
    }

    // 4. 伏笔/悬念写法
    html += `<div class="analyze-subtitle">四、伏笔与悬念写法</div>`;
    html += `<div class="analyze-text"><b>悬念原则：</b>章末留一个没闭合的口子——利益钩子、信息差钩子、情感钩子。不是每章都出大事，而是打破读者的"既定认知"。</div>`;
    const hookExamples = [];
    const hookRe = /[^。！？\n]*(?:秘密|谜团|疑惑|不解|奇怪|不对劲|究竟|到底|隐藏|暗中|悄悄|似乎|仿佛|好像|隐约|模糊|不详|不安|预感|危机|危险|阴影)[^。！？\n]*[。！？]?/g;
    let hm;
    while ((hm = hookRe.exec(text)) !== null) {
      const c = hm[0].trim();
      if (c.length >= 8 && c.length <= 80) hookExamples.push(c);
    }
    if (hookExamples.length) {
      html += `<div style="font-size:13px;margin-bottom:4px;"><b>原文伏笔/悬念举例：</b></div>`;
      hookExamples.slice(0, 3).forEach(h => {
        html += `<div class="analyze-quote">${esc(h)}</div>`;
      });
      html += `<div style="font-size:12px;color:var(--text-sub);margin-top:4px;">💡 借鉴点：用"似乎/仿佛/不对劲"等词制造信息差，让读者产生"到底怎么回事"的追读欲。</div>`;
    } else {
      html += `<div style="font-size:12px;color:var(--text-sub);">本段未检测到明显伏笔标记，建议在章末刻意设置悬念钩子。</div>`;
    }

    // 5. 金句写法
    html += `<div class="analyze-subtitle">五、金句写法借鉴</div>`;
    html += `<div class="analyze-text"><b>金句公式：</b>对比反转式（我们以为A，其实B）/ 排比升华式（A是X，B是Y，C才是Z）/ 悖论制造式（越X越Y）。位置：段落结尾、情绪高潮后、全文结尾。</div>`;
    const golden = (text.match(/[^。！？\n]*(?:不是|而是|从来|永远|终究|原来|其实|所谓|也许|或许|如果|只要|除非|宁可|宁愿|哪怕|即使|纵然|唯有|只因|因为|所以)[^。！？\n]*[。！？]?/g) || [])
      .map(s => s.trim()).filter(s => s.length >= 8 && s.length <= 50 && !/["""]/.test(s));
    if (golden.length) {
      html += `<div style="font-size:13px;margin-bottom:4px;"><b>原文金句举例：</b></div>`;
      golden.slice(0, 3).forEach(g => {
        html += `<div class="analyze-quote">${esc(g)}</div>`;
      });
      html += `<div style="font-size:12px;color:var(--text-sub);margin-top:4px;">💡 借鉴点：金句要能截图传播——想象这句话被读者截图发朋友圈，是否足够酷、扎心、让人想问"然后呢"。</div>`;
    }

    html += `</div>`;
    return html;
  }

  /* ---------- AI 智能拆解 ---------- */
  async function aiAnalyze(text, title, dims) {
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      const useRule = confirm("AI 未配置，是否使用「模板拆解」？");
      if (useRule) return ruleAnalyze(text, title, dims);
      return null;
    }
    const MAX = 15000;
    let truncated = false;
    if (text.length > MAX) { text = text.substring(0, MAX); truncated = true; }

    const dimNames = { structure: "结构骨架", plot: "剧情概括", character: "人物分析", hook: "开篇钩子", rhythm: "叙事节奏", emotion: "情绪人设", style: "行文文笔", technique: "写法借鉴" };
    const selectedDims = dims.map(d => dimNames[d]).filter(Boolean).join("、");

    const sys = `你是拥有10年网文行业经验的资深编辑+爆款小说拆解师，专精网文商业结构拆解。请对以下小说进行深度拆文分析，全程聚焦"可复制、可仿写、可落地"，不做剧情复述，只输出网文作者能直接借鉴的干货。

拆解维度：${selectedDims}

输出要求：
1. 用 HTML 格式输出，使用以下 class 进行排版：
   - analyze-section：每个大维度区块
   - analyze-section-title：维度标题（如"🏗️ 维度一：结构骨架拆解"）
   - analyze-subtitle：子标题
   - analyze-text：普通段落
   - analyze-list / li：列表
   - analyze-table / th / td：表格
   - analyze-quote：引用/金句
   - analyze-tag：标签
   - analyze-stats-bar / analyze-stat-item / analyze-stat-num / analyze-stat-label：数据统计栏
2. 每个维度必须包含：具体分析数据、可识别的模式、可复用的技巧
3. 最后必须包含"🎯 落地用法建议"维度，给出套用框架、仿写练笔、素材积累的具体建议
4. 绝对不许复述剧情，只拆解创作技巧和底层逻辑
5. 面向0基础网文新手，语言简洁明了，分点清晰`;

    const user = `小说《${title || "未命名"}》\n请对以下内容进行拆文分析：\n${text}${truncated ? "\n\n（原文较长，以上为前半部分）" : ""}`;

    setStatus("AI 正在拆文分析…");
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

    if (!res.ok) { alert("AI 拆文失败：" + (res.error || "未知错误")); setStatus("拆文失败"); return null; }
    return res.content;
  }

  /* ---------- 执行拆文 ---------- */
  async function runAnalyze() {
    if (analyzing) return;
    const src = getAnalyzeText();
    if (!src || !src.text) { alert("请先选择小说章节，或导入外部 TXT"); return; }
    const dims = getSelectedDims();
    if (!dims.length) { alert("请至少选择一个拆解维度"); return; }

    analyzing = true;
    const btn = $("#btn-analyze-run");
    btn.disabled = true; btn.textContent = "⏳ 拆解中…";

    try {
      let html;
      if (analyzeMode === "ai") {
        html = await aiAnalyze(src.text, src.title, dims);
      } else {
        html = ruleAnalyze(src.text, src.title, dims);
      }
      if (html) {
        $("#analyze-result").innerHTML = html;
        analyzeReport = html;
        setStatus(`拆文分析完成：${dims.length} 个维度`);
      }
    } catch (e) {
      alert("拆文出错：" + e.message); setStatus("拆文失败");
    } finally {
      analyzing = false;
      btn.disabled = false; btn.textContent = "🔍 开始拆文";
    }
  }

  function getReportPlainText() {
    const el = $("#analyze-result");
    if (!el || !el.innerHTML.trim()) return "";
    // 简单 HTML 转纯文本
    return el.innerText || el.textContent;
  }
  function copyReport() {
    const text = getReportPlainText();
    if (!text) { alert("没有可复制的拆解报告"); return; }
    navigator.clipboard.writeText(text).then(
      () => setStatus("已复制拆解报告到剪贴板"),
      () => alert("复制失败，请手动选择复制")
    );
  }
  function exportReport() {
    const text = getReportPlainText();
    if (!text) { alert("没有可导出的拆解报告"); return; }
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${analyzeExternalName || "拆文分析报告"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已导出拆文分析报告 TXT");
  }

  /* ==================================================================
   * 初始化
   * ================================================================== */
  function init() {
    // 子标签
    $$(".split-tab").forEach(b => b.addEventListener("click", () => switchTab(b.dataset.tab)));

    // 导入分章
    $("#btn-split-import").addEventListener("click", () => $("#split-file").click());
    $("#split-file").addEventListener("change", e => { if (e.target.files[0]) loadSplitFile(e.target.files[0]); });
    $("#btn-split-detect").addEventListener("click", detectChapters);
    $("#split-regex").addEventListener("keydown", e => { if (e.key === "Enter") detectChapters(); });
    $("#btn-split-create").addEventListener("click", createNovelFromSplit);

    // 分章拖拽
    const splitDrop = $("#split-drop");
    const splitWrap = $("#split-wrap");
    let dragCounter = 0;
    splitWrap.addEventListener("dragenter", e => {
      e.preventDefault();
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragCounter++; splitDrop.classList.add("drag-over"); }
    });
    splitWrap.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    splitWrap.addEventListener("dragleave", e => {
      e.preventDefault(); dragCounter--;
      if (dragCounter <= 0) { dragCounter = 0; splitDrop.classList.remove("drag-over"); }
    });
    splitWrap.addEventListener("drop", e => {
      e.preventDefault(); dragCounter = 0; splitDrop.classList.remove("drag-over");
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadSplitFile(file);
    });
    splitDrop.addEventListener("click", () => $("#split-file").click());

    // 拆文分析
    refreshAnalyzeNovels();
    $("#analyze-novel").addEventListener("change", e => { analyzeNovelId = e.target.value; refreshAnalyzeChapters(); });
    $$("#analyze-mode-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#analyze-mode-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active"); analyzeMode = b.dataset.mode;
    }));
    $("#btn-analyze-run").addEventListener("click", runAnalyze);
    $("#btn-analyze-copy").addEventListener("click", copyReport);
    $("#btn-analyze-export").addEventListener("click", exportReport);

    // 拆文外部导入
    $("#btn-analyze-import").addEventListener("click", () => $("#analyze-file").click());
    $("#analyze-file").addEventListener("change", e => { if (e.target.files[0]) loadAnalyzeFile(e.target.files[0]); });

    // 拆文拖拽
    const analyzeZone = $("#analyze-drop-zone");
    let aDragCounter = 0;
    splitWrap.addEventListener("dragenter", e => {
      e.preventDefault();
      if (e.dataTransfer && [...e.dataTransfer.types].includes("Files") && $("#split-panel-analyze").classList.contains("active")) {
        aDragCounter++; analyzeZone.classList.add("active");
      }
    });
    splitWrap.addEventListener("dragover", e => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; });
    splitWrap.addEventListener("dragleave", e => {
      e.preventDefault(); aDragCounter--;
      if (aDragCounter <= 0) { aDragCounter = 0; analyzeZone.classList.remove("active"); }
    });
    splitWrap.addEventListener("drop", e => {
      e.preventDefault(); aDragCounter = 0; analyzeZone.classList.remove("active");
      if ($("#split-panel-analyze").classList.contains("active")) {
        const file = e.dataTransfer.files && e.dataTransfer.files[0];
        if (file) loadAnalyzeFile(file);
      }
    });

    document.addEventListener("novel:data-changed", () => { refreshAnalyzeNovels(); });
    document.addEventListener("novel:view-changed", e => {
      if (e.detail.view === "split") refreshAnalyzeNovels();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
