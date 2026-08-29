/* ==================================================================
 * 故事流工作台：骨架 / 设定档案 / 拍 / 伏笔 / 时间线 / 连续性校验 / AI
 * ================================================================== */
(function () {
  "use strict";

  let currentNovelId = null;
  let selectedChapter = null; // chapter node
  let selectedBeatId = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 当前小说 ---------- */
  function getNovel() {
    return findNode(currentNovelId);
  }
  function refreshNovelSelect() {
    const sel = $("#wb-novel");
    const novels = ((data && data.children) || []).filter(n => n.type === "novel");
    const prev = currentNovelId;
    sel.innerHTML = novels.map(n =>
      `<option value="${getNodeId(n)}">${esc(n.name)}</option>`).join("");
    if (prev && novels.some(n => getNodeId(n) === prev)) {
      sel.value = prev; currentNovelId = prev;
    } else if (novels.length) {
      currentNovelId = getNodeId(novels[0]); sel.value = currentNovelId;
    } else currentNovelId = null;
  }

  /* ---------- 遍历辅助 ---------- */
  // 返回 {volumes:[{node, chapters:[{node, beats:[node]}]}], entities:{type:[nodes]}}
  function indexNovel(novel) {
    const result = { volumes: [], entities: {}, outline: null };
    if (!novel) return result;
    (novel.children || []).forEach(ch => {
      if (ch.type === "volume") {
        const vol = { node: ch, chapters: [] };
        (ch.children || []).forEach(c => {
          if (c.type === "chapter") {
            const beats = (c.children || []).filter(x => x.type === "beat");
            vol.chapters.push({ node: c, beats });
          }
        });
        result.volumes.push(vol);
      } else if (ch.type === "outline") {
        result.outline = ch;
        // 递归收集：大纲下可能有类型文件夹（group），需要进入文件夹收集实际文档
        (function collect(list) {
          (list || []).forEach(e => {
            if (e.type === "group") {
              collect(e.children);
            } else {
              (result.entities[e.type] = result.entities[e.type] || []).push(e);
            }
          });
        })(ch.children);
      }
    });
    return result;
  }

  function allEntities(idx) {
    const out = [];
    Object.values(idx.entities).forEach(arr => arr.forEach(n => out.push(n)));
    return out;
  }

  // 稳定拍 ID：v1c2b3
  function beatId(vi, ci, bi) { return `v${vi + 1}c${ci + 1}b${bi + 1}`; }
  function beatLabel(vi, ci, bi) { return `v${vi + 1}.c${ci + 1}.b${bi + 1}`; }

  // 收集所有拍及其位置
  function allBeats(idx) {
    const out = [];
    idx.volumes.forEach((v, vi) => v.chapters.forEach((c, ci) =>
      c.beats.forEach((b, bi) => out.push({ node: b, vi, ci, bi, id: beatId(vi, ci, bi) }))));
    return out;
  }

  function findBeatInfo(idx, node) {
    return allBeats(idx).find(x => x.node === node);
  }

  /* ---------- 左侧：骨架树 ---------- */
  function renderSkeleton() {
    const novel = getNovel();
    const box = $("#wb-skeleton");
    if (!novel) { box.innerHTML = `<div class="chk-empty">请先新建小说</div>`; return; }
    const idx = indexNovel(novel);
    let html = "";
    idx.volumes.forEach((v, vi) => {
      html += `<div class="wb-node" data-id="${getNodeId(v.node)}">
        <span class="tw">▾</span><span class="gd-dot" style="background:${TYPE_META.volume.color}"></span>
        <span class="nm">${esc(v.node.name)}</span><span class="ct">${v.chapters.length}章</span></div>`;
      html += `<div class="wb-kids">`;
      v.chapters.forEach((c, ci) => {
        const active = selectedChapter === c.node ? " active" : "";
        html += `<div class="wb-node${active}" data-id="${getNodeId(c.node)}" data-chapter="1">
          <span class="tw">·</span><span class="gd-dot" style="background:${TYPE_META.chapter.color}"></span>
          <span class="nm">${esc(c.node.name)}</span><span class="ct">${c.beats.length}拍</span></div>`;
      });
      html += `</div>`;
    });
    if (!idx.volumes.length) html = `<div class="chk-empty">暂无卷/章，请到「写作」视图新建</div>`;
    box.innerHTML = html;
    box.querySelectorAll(".wb-node[data-chapter]").forEach(el => {
      el.addEventListener("click", () => {
        selectedChapter = findNode(el.dataset.id);
        selectedBeatId = null;
        renderSkeleton();
        renderBeats();
      });
    });
  }

  /* ---------- 左侧：设定档案 ---------- */
  function renderArchive() {
    const novel = getNovel();
    const box = $("#wb-archive");
    if (!novel) { box.innerHTML = ""; return; }
    const idx = indexNovel(novel);
    let html = "";
    ARCHIVE_TYPES.forEach(t => {
      const arr = idx.entities[t] || [];
      if (!arr.length) return;
      const meta = TYPE_META[t];
      html += `<div class="wb-node" style="cursor:default">
        <span class="tw">·</span><span class="gd-dot" style="background:${meta.color}"></span>
        <span class="nm">${meta.label}</span><span class="ct">${arr.length}</span></div>`;
      html += `<div class="wb-kids">`;
      arr.forEach(n => {
        html += `<div class="wb-node" data-entity="${getNodeId(n)}">
          <span class="tw">·</span><span class="gd-dot" style="background:${meta.color}"></span>
          <span class="nm">${esc(n.name)}</span></div>`;
      });
      html += `</div>`;
    });
    if (!html) html = `<div class="chk-empty">暂无设定实体，可在「写作」视图的大纲下新建角色/地点/势力等</div>`;
    box.innerHTML = html;
    box.querySelectorAll(".wb-node[data-entity]").forEach(el => {
      el.addEventListener("click", () => {
        const node = findNode(el.dataset.entity);
        if (node) openEntityEditor(node);
      });
    });
  }

  function openEntityEditor(node) {
    const meta = TYPE_META[node.type] || { label: node.type };
    const isFs = node.type === "foreshadow";
    const body = `
      <label>名称</label>
      <input id="ent-name" type="text" value="${esc(node.name)}">
      <label>${isFs ? "备注" : "描述 / 设定"}</label>
      <textarea id="ent-content">${esc(node.content || node.note || "")}</textarea>
      ${isFs ? `<label>状态</label><select id="ent-status">
        <option value="open" ${node.status !== "resolved" ? "selected" : ""}>未回收</option>
        <option value="resolved" ${node.status === "resolved" ? "selected" : ""}>已回收</option></select>` : ""}
    `;
    popup({ title: `${meta.label} · ${node.name}`, bodyHTML: body, onOpen: (b) => {
      b.querySelector("#ent-name").focus();
    }}).then(ok => {
      if (!ok) return;
      node.name = $("#ent-name").value.trim() || node.name;
      const txt = $("#ent-content").value;
      if (node.type === "character" || node.type === "inspire") node.note = txt;
      else node.content = txt;
      if (isFs) node.status = $("#ent-status").value;
      markDirty(); saveData();
      renderArchive(); renderHealth(); runChecks();
    });
  }

  /* ---------- 中间：拍编辑 ---------- */
  function renderBeats() {
    const novel = getNovel();
    const head = $("#wb-chapter-title");
    const box = $("#wb-beats");
    if (!selectedChapter || !novel) {
      head.textContent = "选择左侧章节开始";
      box.innerHTML = `<div class="chk-empty" style="margin:auto">在左侧骨架中选择一个章节</div>`;
      return;
    }
    const idx = indexNovel(novel);
    const beats = (selectedChapter.children || []).filter(c => c.type === "beat");
    const chInfo = findChapterPos(idx, selectedChapter);
    head.textContent = `${chInfo ? "第" + (chInfo.ci + 1) + "章 · " : ""}${selectedChapter.name}`;

    if (!beats.length) {
      box.innerHTML = `<div class="chk-empty" style="margin:auto">本章还没有拍，点击右上角「添加拍」或「AI 生成拍」</div>`;
      return;
    }
    const entities = allEntities(idx);
    box.innerHTML = beats.map((b, bi) => {
      const isOpen = selectedBeatId === getNodeId(b);
      const id = chInfo ? beatId(chInfo.vi, chInfo.ci, bi) : `b${bi + 1}`;
      const linkTags = (Array.isArray(b.links) ? b.links : []).map((l, li) =>
        `<span class="beat-link-tag" style="background:${colorForEntity(l.target, entities)}">
          ${esc(l.target)}<span class="x" data-link="${li}">✕</span></span>`).join("");
      return `<div class="wb-beat${isOpen ? " open" : ""}" data-id="${getNodeId(b)}">
        <div class="wb-beat-head">
          <span class="bidx">${id}</span>
          <input class="btitle" value="${esc(b.name)}" placeholder="拍标题">
          <button class="bdel" title="删除拍">🗑</button>
        </div>
        <div class="wb-beat-body">
          <textarea placeholder="这一拍发生了什么？可用 [[实体名]] 关联设定">${esc(b.content || "")}</textarea>
          <div class="beat-links">
            ${linkTags}
            <button class="beat-add-link">＋ 关联实体</button>
          </div>
          <div class="beat-meta">
            <span>事实 ${Array.isArray(b.facts) ? b.facts.length : 0}</span>
            <button class="mini-btn beat-save" title="保存">💾</button>
          </div>
        </div>
      </div>`;
    }).join("");

    box.querySelectorAll(".wb-beat").forEach(el => {
      const b = findNode(el.dataset.id);
      const headEl = el.querySelector(".wb-beat-head");
      headEl.addEventListener("click", (e) => {
        if (e.target.classList.contains("bdel") || e.target.classList.contains("btitle")) return;
        selectedBeatId = getNodeId(b);
        renderBeats();
      });
      el.querySelector(".btitle").addEventListener("input", (e) => { b.name = e.target.value; markDirty(); });
      el.querySelector(".btitle").addEventListener("change", saveData);
      el.querySelector("textarea").addEventListener("input", (e) => { b.content = e.target.value; markDirty(); });
      el.querySelector("textarea").addEventListener("blur", () => { parseLinksFromContent(b); saveData(); renderBeats(); renderHealth(); });
      el.querySelector(".beat-save").addEventListener("click", () => {
        b.content = el.querySelector("textarea").value;
        parseLinksFromContent(b); saveData(); renderBeats(); renderHealth(); runChecks();
        setStatus("已保存拍：" + b.name);
      });
      el.querySelector(".bdel").addEventListener("click", () => {
        if (!confirm(`删除拍【${b.name}】？`)) return;
        const arr = selectedChapter.children;
        const i = arr.indexOf(b); if (i >= 0) arr.splice(i, 1);
        if (selectedBeatId === getNodeId(b)) selectedBeatId = null;
        markDirty(); saveData(); renderSkeleton(); renderBeats(); renderHealth(); runChecks();
      });
      el.querySelector(".beat-add-link").addEventListener("click", () => openLinkPicker(b, entities));
      el.querySelectorAll(".beat-link-tag .x").forEach(x => x.addEventListener("click", (e) => {
        e.stopPropagation();
        const li = +e.target.dataset.link;
        b.links.splice(li, 1); markDirty(); saveData(); renderBeats();
      }));
    });
  }

  function colorForEntity(name, entities) {
    const e = entities.find(x => x.name === name);
    return e ? (TYPE_META[e.type] || {}).color || "#888" : "#e91e63";
  }

  function findChapterPos(idx, chapter) {
    for (let vi = 0; vi < idx.volumes.length; vi++) {
      const ci = idx.volumes[vi].chapters.findIndex(c => c.node === chapter);
      if (ci >= 0) return { vi, ci };
    }
    return null;
  }

  // 从正文 [[xxx]] 提取关联
  function parseLinksFromContent(b) {
    if (!Array.isArray(b.links)) b.links = [];
    const re = /\[\[([^\[\]]+)\]\]/g;
    let m;
    while ((m = re.exec(b.content || "")) !== null) {
      const name = m[1].trim();
      if (name && !b.links.some(l => l.target === name)) b.links.push({ target: name, rel: "提及" });
    }
  }

  function openLinkPicker(b, entities) {
    if (!entities.length) { alert("设定档案里还没有实体，请先在大纲下新建角色/地点等"); return; }
    const selected = new Set((b.links || []).map(l => l.target));
    const body = `<div style="max-height:300px;overflow:auto;display:flex;flex-direction:column;gap:4px">` +
      entities.map(e => {
        const meta = TYPE_META[e.type] || { label: e.type };
        return `<label style="display:flex;gap:8px;align-items:center;font-size:13px;cursor:pointer;padding:4px 6px;border-radius:6px"
          onmouseover="this.style.background='var(--tree-hover)'" onmouseout="this.style.background=''">
          <input type="checkbox" value="${esc(e.name)}" ${selected.has(e.name) ? "checked" : ""}>
          <span class="gd-dot" style="background:${meta.color};width:9px;height:9px;border-radius:50%;display:inline-block"></span>
          <span>${esc(e.name)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:auto">${meta.label}</span></label>`;
      }).join("") + `</div>`;
    popup({ title: "关联实体到本拍", bodyHTML: body }).then(ok => {
      if (!ok) return;
      const picked = [...$$("#popup-body input:checked")].map(i => i.value);
      b.links = picked.map(name => ({ target: name, rel: "关联" }));
      markDirty(); saveData(); renderBeats();
    });
  }

  /* ---------- 右：体检 ---------- */
  function renderHealth() {
    const novel = getNovel();
    const box = $("#wb-health");
    if (!novel) { box.innerHTML = ""; return; }
    const idx = indexNovel(novel);
    const beats = allBeats(idx);
    const ents = allEntities(idx);
    const fs = idx.entities.foreshadow || [];
    const openFs = fs.filter(f => f.status !== "resolved").length;
    const facts = (idx.entities.fact || []).length;
    const rules = (idx.entities.rule || []).length;
    const items = [
      ["卷", idx.volumes.length, false],
      ["章", idx.volumes.reduce((s, v) => s + v.chapters.length, 0), false],
      ["拍", beats.length, false],
      ["实体", ents.length, false],
      ["事实", facts, false],
      ["规则", rules, false],
      ["伏笔未回收", openFs, openFs > 0],
    ];
    box.innerHTML = items.map(([k, v, warn]) =>
      `<div class="health-item ${warn ? "warn" : v ? "ok" : ""}"><span class="hv">${v}</span><span class="hk">${k}</span></div>`
    ).join("");
  }

  /* ---------- 右：伏笔 ---------- */
  function renderForeshadow() {
    const novel = getNovel();
    const box = $("#wb-foreshadow");
    if (!novel) { box.innerHTML = ""; return; }
    const idx = indexNovel(novel);
    const fs = idx.entities.foreshadow || [];
    const beats = allBeats(idx);
    if (!fs.length) { box.innerHTML = `<div class="chk-empty">暂无伏笔</div>`; return; }
    box.innerHTML = fs.map(f => {
      const plantedOpts = beats.map(b =>
        `<option value="${b.id}" ${f.planted === b.id ? "selected" : ""}>${b.id} ${esc(b.node.name)}</option>`).join("");
      const resolvedOpts = beats.map(b =>
        `<option value="${b.id}" ${f.resolved === b.id ? "selected" : ""}>${b.id} ${esc(b.node.name)}</option>`).join("");
      return `<div class="fs-item ${f.status === "resolved" ? "resolved" : ""}">
        <div class="fs-title">${esc(f.name)}
          <span class="fs-status">${f.status === "resolved" ? "已回收" : "未回收"}</span></div>
        <div class="fs-meta">埋设于</div>
        <select data-fs="${getNodeId(f)}" data-field="planted">
          <option value="">— 未设置 —</option>${plantedOpts}</select>
        <div class="fs-meta">回收于</div>
        <select data-fs="${getNodeId(f)}" data-field="resolved">
          <option value="">— 未设置 —</option>${resolvedOpts}</select>
      </div>`;
    }).join("");
    box.querySelectorAll("select").forEach(sel => {
      sel.addEventListener("change", () => {
        const node = findNode(sel.dataset.fs);
        if (!node) return;
        node[sel.dataset.field] = sel.value;
        if (sel.dataset.field === "resolved") node.status = sel.value ? "resolved" : "open";
        markDirty(); saveData(); renderForeshadow(); renderHealth(); runChecks();
      });
    });
  }

  function addForeshadow() {
    promptBox("新增伏笔", "新伏笔", "伏笔名称").then(name => {
      if (!name) return;
      const novel = getNovel(); if (!novel) return;
      let outline = (novel.children || []).find(c => c.type === "outline");
      if (!outline) { outline = makeNode("outline", "大纲"); novel.children.push(outline); }
      const node = makeNode("foreshadow", name.trim());
      // 自动归入对应类型文件夹
      const group = findOrCreateGroup(outline, "foreshadow");
      group.children.push(node);
      markDirty(); saveData(); renderArchive(); renderForeshadow(); renderHealth(); runChecks();
    });
  }

  /* ---------- 右：时间线 ---------- */
  function getTimeline(novel) {
    if (!Array.isArray(novel.timeline)) novel.timeline = [];
    return novel.timeline;
  }
  function renderTimeline() {
    const novel = getNovel();
    const box = $("#wb-timeline");
    if (!novel) { box.innerHTML = ""; return; }
    const tl = getTimeline(novel);
    if (!tl.length) { box.innerHTML = `<div class="chk-empty">暂无时序事件</div>`; return; }
    box.innerHTML = tl.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).map((ev, i) =>
      `<div class="tl-item">
        <span class="tl-order">#${ev.order ?? (i + 1)}</span>
        <span class="tl-text">${esc(ev.text || "")}${ev.beat ? ` <span style="color:var(--accent)">@${esc(ev.beat)}</span>` : ""}</span>
        <button class="tl-del" data-i="${i}" title="删除">✕</button>
      </div>`).join("");
    box.querySelectorAll(".tl-del").forEach(b => b.addEventListener("click", () => {
      const sorted = tl.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
      const ev = sorted[+b.dataset.i];
      const j = tl.indexOf(ev); if (j >= 0) tl.splice(j, 1);
      markDirty(); saveData(); renderTimeline(); runChecks();
    }));
  }
  function addTimelineEvent() {
    const novel = getNovel(); if (!novel) return;
    const idx = indexNovel(novel);
    const beats = allBeats(idx);
    const beatOpts = beats.map(b => `<option value="${b.id}">${b.id} ${esc(b.node.name)}</option>`).join("");
    const nextOrder = (getTimeline(novel).reduce((m, e) => Math.max(m, e.order || 0), 0)) + 1;
    popup({
      title: "新增时序事件",
      bodyHTML: `<label>顺序</label><input id="tl-order" type="number" value="${nextOrder}">
        <label>事件描述</label><input id="tl-text" type="text" placeholder="如：季疏星闯入乱葬岗">
        <label>关联拍（可选）</label><select id="tl-beat"><option value="">—</option>${beatOpts}</select>`,
    }).then(ok => {
      if (!ok) return;
      const text = $("#tl-text").value.trim();
      if (!text) return;
      getTimeline(novel).push({
        order: parseInt($("#tl-order").value, 10) || nextOrder,
        text, beat: $("#tl-beat").value || "",
      });
      markDirty(); saveData(); renderTimeline(); runChecks();
    });
  }

  /* ---------- 右：连续性校验 ---------- */
  function runChecks() {
    const novel = getNovel();
    const box = $("#wb-checks");
    if (!novel) { box.innerHTML = ""; return; }
    const idx = indexNovel(novel);
    const beats = allBeats(idx);
    const entities = allEntities(idx);
    const entByName = new Map(entities.map(e => [e.name, e]));
    const groups = { struct: [], cast: [], foreshadow: [], timeline: [] };

    // 1. 结构：空卷/空章/空拍
    idx.volumes.forEach((v, vi) => {
      if (!v.chapters.length) groups.struct.push({ lvl: "warn", msg: `第${vi + 1}卷《${v.node.name}》没有章节` });
      v.chapters.forEach((c, ci) => {
        if (!c.beats.length) groups.struct.push({ lvl: "warn", msg: `${v.node.name} / ${c.node.name} 没有拍` });
        c.beats.forEach((b, bi) => {
          if (!(b.content || "").trim()) groups.struct.push({ lvl: "warn", msg: `${beatId(vi, ci, bi)}《${b.name}》正文为空`, beat: b });
        });
      });
    });

    // 2. 实体登场：拍中引用/关联了档案里没有的实体
    const referenced = new Set();
    beats.forEach(b => {
      (b.node.links || []).forEach(l => referenced.add(l.target));
      const re = /\[\[([^\[\]]+)\]\]/g; let m;
      while ((m = re.exec(b.node.content || "")) !== null) referenced.add(m[1].trim());
    });
    referenced.forEach(name => {
      if (!entByName.has(name)) {
        groups.cast.push({ lvl: "warn", msg: `拍中引用了「${name}」，但设定档案里没有该实体` });
      }
    });
    // 档案实体从未在任何拍中出现
    entities.forEach(e => {
      if (e.type === "fact" || e.type === "rule" || e.type === "foreshadow") return;
      const used = beats.some(b => (b.node.links || []).some(l => l.target === e.name) ||
        (b.node.content || "").includes(`[[${e.name}]]`));
      if (!used) groups.cast.push({ lvl: "warn", msg: `${TYPE_META[e.type].label}「${e.name}」未在任何拍中登场` });
    });

    // 3. 伏笔
    (idx.entities.foreshadow || []).forEach(f => {
      if (f.status !== "resolved" && !f.resolved) {
        groups.foreshadow.push({ lvl: "warn", msg: `伏笔「${f.name}」未回收${f.planted ? "（埋设 " + f.planted + "）" : "（未设置埋设点）"}` });
      }
      if (f.resolved && !f.planted) {
        groups.foreshadow.push({ lvl: "error", msg: `伏笔「${f.name}」有回收点但无埋设点` });
      }
      if (f.resolved && f.planted && f.resolved <= f.planted) {
        groups.foreshadow.push({ lvl: "error", msg: `伏笔「${f.name}」回收点不晚于埋设点` });
      }
    });

    // 4. 时间线
    const tl = getTimeline(novel);
    const beatIds = new Set(beats.map(b => b.id));
    const orders = new Set();
    tl.forEach(ev => {
      if (ev.beat && !beatIds.has(ev.beat)) {
        groups.timeline.push({ lvl: "error", msg: `时序事件「${ev.text}」关联了不存在的拍 ${ev.beat}` });
      }
      if (orders.has(ev.order)) groups.timeline.push({ lvl: "warn", msg: `时序顺序 #${ev.order} 重复` });
      orders.add(ev.order);
    });

    const titles = { struct: "结构", cast: "实体登场", foreshadow: "伏笔", timeline: "时间线" };
    let html = "";
    let total = 0;
    Object.keys(titles).forEach(k => {
      const items = groups[k];
      total += items.length;
      html += `<div class="chk-group"><div class="chk-gtitle">${titles[k]} · ${items.length}</div>`;
      if (!items.length) html += `<div class="chk-item ok">✓ 无问题</div>`;
      items.forEach(it => {
        html += `<div class="chk-item ${it.lvl}">${it.msg}${it.beat ? `<span class="chk-jump">定位</span>` : ""}</div>`;
      });
      html += `</div>`;
    });
    box.innerHTML = html;
    box.querySelectorAll(".chk-jump").forEach((el, i) => {
      // 收集所有带 beat 的项并绑定
    });
    // 绑定定位：点击含 beat 的警告 → 选中对应章节并展开拍
    let idx2 = 0;
    box.querySelectorAll(".chk-item").forEach(el => {
      // 简单实现：点击任意警告项，若能匹配到拍名则跳转
      el.addEventListener("click", () => {
        const novel2 = getNovel(); if (!novel2) return;
        const idxN = indexNovel(novel2);
        const beatsN = allBeats(idxN);
        // 尝试从文本里提取拍 id
        const m = el.textContent.match(/v\d+c\d+b\d+/);
        if (m) {
          const info = beatsN.find(b => b.id === m[0]);
          if (info) { selectedChapter = info.node.parentChapter || findParentChapter(novel2, info.node); selectedBeatId = getNodeId(info.node); renderSkeleton(); renderBeats(); switchView("workbench"); }
        }
      });
    });
  }

  function findParentChapter(novel, beat) {
    let found = null;
    (function walk(list) {
      for (const n of list) {
        if (n.children && n.children.includes(beat) && n.type === "chapter") { found = n; return; }
        walk(n.children || []);
      }
    })(novel.children || []);
    return found;
  }

  /* ---------- 拍操作 ---------- */
  function addBeat() {
    if (!selectedChapter) { alert("请先在左侧选择一个章节"); return; }
    const bi = (selectedChapter.children || []).filter(c => c.type === "beat").length;
    promptBox("添加拍", `拍 ${bi + 1}`, "拍标题").then(name => {
      if (name === null) return;
      const b = makeNode("beat", name.trim() || `拍 ${bi + 1}`);
      (selectedChapter.children = selectedChapter.children || []).push(b);
      selectedBeatId = getNodeId(b);
      markDirty(); saveData(); renderSkeleton(); renderBeats(); renderHealth(); runChecks();
    });
  }

  /* ---------- AI ---------- */
  async function aiGenerateBeats() {
    if (!selectedChapter) { alert("请先选择章节"); return; }
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      alert("AI 未配置，请先在「设置」里填写 API 地址、Key 和模型");
      return;
    }
    const novel = getNovel();
    const idx = indexNovel(novel);
    const chPos = findChapterPos(idx, selectedChapter);
    const entities = allEntities(idx).map(e => `${TYPE_META[e.type].label}:${e.name}`).join("、") || "无";
    const prevBeats = (selectedChapter.children || []).filter(c => c.type === "beat")
      .map(b => b.name).join("、") || "无";
    const goal = await promptBox("AI 生成拍", selectedChapter.content || "", "本章目标 / 关键剧情（可留空）");
    if (goal === null) return;
    setStatus("AI 正在生成拍…");
    const sys = "你是小说结构编辑。根据章节目标，输出 3-6 个「拍」的 JSON 数组，每个元素 {\"name\":\"拍标题\",\"content\":\"这一拍具体发生什么，50-120字\"}。只输出 JSON，不要解释。";
    const user = `小说《${novel.name}》\n本章：${selectedChapter.name}\n已有拍：${prevBeats}\n设定实体：${entities}\n本章目标：${goal || "（未指定，请根据卷章名合理推进剧情）"}`;
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: sys }, { role: "user", content: user }], temperature: 0.8, max_tokens: 2048 }),
      }).then(r => r.json());
      if (!res.ok) { alert("AI 生成失败：" + res.error); setStatus("AI 生成失败"); return; }
      const json = extractJSON(res.content);
      if (!Array.isArray(json)) { alert("AI 返回格式异常，已复制原文到剪贴板"); navigator.clipboard?.writeText(res.content); return; }
      json.forEach(it => {
        if (!it || !it.name) return;
        const b = makeNode("beat", String(it.name).trim());
        b.content = String(it.content || "").trim();
        parseLinksFromContent(b);
        (selectedChapter.children = selectedChapter.children || []).push(b);
      });
      markDirty(); saveData(); renderSkeleton(); renderBeats(); renderHealth(); runChecks();
      setStatus(`AI 已生成 ${json.length} 个拍`);
    } catch (e) {
      alert("请求失败：" + e.message); setStatus("AI 请求失败");
    }
  }

  async function aiAudit() {
    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      alert("AI 未配置，请先在「设置」里填写 API 地址、Key 和模型");
      return;
    }
    const novel = getNovel(); if (!novel) return;
    setStatus("AI 正在做逻辑审计…");
    const idx = indexNovel(novel);
    const dump = buildNovelDump(idx);
    const sys = "你是小说逻辑审计编辑。基于下面的结构化小说骨架，找出世界观矛盾、角色动机断裂、时间线冲突、伏笔未回收、因果漏洞。用中文分条输出，每条标注【严重/警告/建议】和涉及的卷章拍。";
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "system", content: sys }, { role: "user", content: dump }], temperature: 0.3, max_tokens: 4096 }),
      }).then(r => r.json());
      if (!res.ok) { alert("AI 审计失败：" + res.error); setStatus("AI 审计失败"); return; }
      showAuditResult(res.content);
      setStatus("AI 审计完成");
    } catch (e) {
      alert("请求失败：" + e.message); setStatus("AI 请求失败");
    }
  }

  function buildNovelDump(idx) {
    const lines = [];
    idx.volumes.forEach((v, vi) => {
      lines.push(`\n## ${v.node.name}`);
      v.chapters.forEach((c, ci) => {
        lines.push(`\n### ${c.node.name}${c.node.content ? " — " + c.node.content : ""}`);
        c.beats.forEach((b, bi) => {
          lines.push(`- [${beatId(vi, ci, bi)}] ${b.name}：${b.content || ""}`);
          if (b.links && b.links.length) lines.push(`  关联：${b.links.map(l => l.target).join("、")}`);
        });
      });
    });
    const ents = allEntities(idx);
    if (ents.length) {
      lines.push("\n## 设定实体");
      ents.forEach(e => lines.push(`- [${TYPE_META[e.type].label}] ${e.name}：${e.content || e.note || ""}`));
    }
    const fs = idx.entities.foreshadow || [];
    if (fs.length) {
      lines.push("\n## 伏笔");
      fs.forEach(f => lines.push(`- ${f.name}：${f.status === "resolved" ? "已回收" : "未回收"}（埋设 ${f.planted || "无"} / 回收 ${f.resolved || "无"}）`));
    }
    const tl = getTimeline(getNovel());
    if (tl.length) {
      lines.push("\n## 时序纪年");
      tl.slice().sort((a, b) => (a.order || 0) - (b.order || 0)).forEach(e => lines.push(`- #${e.order} ${e.text}${e.beat ? " @" + e.beat : ""}`));
    }
    return lines.join("\n");
  }

  function showAuditResult(text) {
    popup({
      title: "✨ AI 逻辑审计结果",
      bodyHTML: `<div class="audit-box"></div>`,
      okText: "好的", cancelText: "关闭",
    }).then(() => {});
    $("#popup-body .audit-box").textContent = text;
  }

  function extractJSON(text) {
    if (!text) return null;
    // 去掉 ```json ``` 包裹
    let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try { return JSON.parse(t); } catch (e) {}
    const m = t.match(/\[[\s\S]*\]/);
    if (m) { try { return JSON.parse(m[0]); } catch (e) {} }
    return null;
  }

  /* ---------- 全量刷新 ---------- */
  function refresh() {
    if (!document.getElementById("view-workbench").classList.contains("active")) return;
    refreshNovelSelect();
    // 若当前选中的章节已不存在，清空
    if (selectedChapter && !findNode(getNodeId(selectedChapter))) selectedChapter = null;
    if (selectedBeatId && !findNode(selectedBeatId)) selectedBeatId = null;
    renderSkeleton();
    renderArchive();
    renderBeats();
    renderHealth();
    renderForeshadow();
    renderTimeline();
    runChecks();
  }

  /* ---------- 事件 ---------- */
  $("#wb-novel").addEventListener("change", e => {
    currentNovelId = e.target.value;
    selectedChapter = null; selectedBeatId = null;
    refresh();
  });
  $("#wb-add-beat").addEventListener("click", addBeat);
  $("#wb-ai-beats").addEventListener("click", aiGenerateBeats);
  $("#wb-add-foreshadow").addEventListener("click", addForeshadow);
  $("#wb-add-event").addEventListener("click", addTimelineEvent);
  $("#wb-run-check").addEventListener("click", runChecks);
  $("#wb-ai-audit").addEventListener("click", aiAudit);

  document.addEventListener("novel:data-changed", refresh);
  document.addEventListener("novel:view-changed", (e) => {
    if (e.detail.view === "workbench") refresh();
  });
})();
