/* ==================================================================
 * 小说写作软件 · Web 版前端逻辑
 * ================================================================== */

/* ---------- 类型元信息 ---------- */
const TYPE_META = {
  novel:     { label: "小说",   color: "#4472C4" },
  volume:    { label: "卷",     color: "#5B9BD5" },
  chapter:   { label: "章",     color: "#9BC2E6" },
  outline:   { label: "大纲",   color: "#70AD47" },
  character: { label: "人设",   color: "#ED7D31" },
  relation:  { label: "人物关系", color: "#FFB900" },
  inspire:   { label: "灵感",   color: "#FFC000" },
  storyline: { label: "故事线", color: "#C5E0B4" },
};
const CHILDREN_ALLOWED = {
  novel: ["volume", "outline"],
  outline: ["character", "relation", "inspire", "storyline"],
  volume: ["chapter"],
  chapter: ["chapter"],
  character: ["character"],
  relation: ["relation"],
  inspire: ["inspire"],
  storyline: ["storyline"],
};
const FONT_SIZES = [12, 14, 16, 18, 24, 32, 48];
const FONT_COLORS = {
  "黑色": "#000000", "深灰": "#444444", "红色": "#E53935",
  "橙色": "#F57C00", "绿色": "#2E7D32", "蓝色": "#1E88E5",
  "紫色": "#8E24AA", "棕色": "#6D4C41", "白色": "#FFFFFF",
};

/* ---------- 状态 ---------- */
let data = null;             // 整棵树 { children:[...] }
let settings = null;
let selectedIds = new Set();
let nodeSeq = 0;
let tabs = [];               // 打开的编辑 tab {key,node,head,pane,body}
let activeKey = null;
let dirty = false;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getNodeId(node) {
  if (!node._id) node._id = "n" + (++nodeSeq);
  return node._id;
}
function isExpanded(node) { return node._expanded !== false; }
function setExpanded(node, v) { node._expanded = !!v; }

/* ==================================================================
 * 初始化
 * ================================================================== */
async function init() {
  const [d, s] = await Promise.all([
    fetch("/api/data").then(r => r.json()),
    fetch("/api/settings").then(r => r.json()),
  ]);
  data = d;
  settings = Object.assign({ theme: "day", font_size: 14, font_color: "#222222", background_image: "" }, s || {});
  applyTheme(settings.theme);
  applyBg();
  syncSettingsUI();
  renderTree();
  bindGlobal();
  setStatus("就绪");
}

/* ==================================================================
 * 树渲染
 * ================================================================== */
function renderTree() {
  const root = $("#tree");
  root.innerHTML = "";
  const ul = document.createElement("ul");
  ul.className = "root";
  (data.children || []).forEach(n => ul.appendChild(renderNode(n)));
  root.appendChild(ul);
}

function renderNode(node) {
  const li = document.createElement("li");
  const id = getNodeId(node);
  const hasKids = node.children && node.children.length;
  const meta = TYPE_META[node.type] || { label: node.type, color: "#888" };

  const item = document.createElement("div");
  item.className = "tree-item";
  item.dataset.id = id;
  if (selectedIds.has(id)) item.classList.add("selected");
  if (selectedIds.size > 1) item.setAttribute("draggable", "false");
  else if (node.type !== "novel") item.setAttribute("draggable", "true");
  item.draggable = node.type !== "novel" && selectedIds.size <= 1;

  // 展开箭头
  const twist = document.createElement("span");
  twist.className = "twist" + (hasKids ? "" : " leaf");
  twist.textContent = hasKids ? (isExpanded(node) ? "▾" : "▸") : "";
  twist.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!hasKids) return;
    setExpanded(node, !isExpanded(node));
    const sub = li.querySelector(":scope > ul");
    if (sub) sub.style.display = isExpanded(node) ? "" : "none";
    twist.textContent = isExpanded(node) ? "▾" : "▸";
  });

  // 类型圆点 + 标签
  const dot = document.createElement("span");
  dot.className = "type-dot";
  dot.style.background = meta.color;
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = node.name || "";
  const metaTxt = document.createElement("span");
  metaTxt.className = "meta";
  metaTxt.textContent = meta.label;

  // 分屏按钮
  const splitBtn = document.createElement("button");
  splitBtn.className = "split-btn";
  splitBtn.textContent = "⧉";
  splitBtn.title = "分屏打开";
  splitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openSplit(node);
  });

  item.append(twist, dot, label, metaTxt, splitBtn);

  // 选择
  item.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    if (ctrl) {
      if (selectedIds.has(id)) { selectedIds.delete(id); }
      else { selectedIds.add(id); }
      e.preventDefault();
    } else if (shift && selectedIds.size) {
      selectedIds.add(id);
    } else {
      selectedIds.clear();
      selectedIds.add(id);
    }
    syncSelection();
  });

  // 双击打开编辑
  item.addEventListener("dblclick", () => openEditor(node));

  // 右键菜单
  item.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (!selectedIds.has(id)) { selectedIds.clear(); selectedIds.add(id); syncSelection(); }
    showContextMenu(e, node);
  });

  // 拖拽
  item.addEventListener("dragstart", (e) => {
    if (selectedIds.size > 1 || node.type === "novel") { e.preventDefault(); return; }
    e.dataTransfer.setData("text/plain", id);
    item.classList.add("dragging");
  });
  item.addEventListener("dragend", () => item.classList.remove("dragging"));
  item.addEventListener("dragover", (e) => { e.preventDefault(); item.classList.add("drag-over"); });
  item.addEventListener("dragleave", () => item.classList.remove("drag-over"));
  item.addEventListener("drop", (e) => {
    e.preventDefault();
    item.classList.remove("drag-over");
    const srcId = e.dataTransfer.getData("text/plain");
    const src = findNode(srcId);
    if (!src || src === node) return;
    const allowed = CHILDREN_ALLOWED[node.type] || [];
    if (allowed.includes(src.type)) {
      removeNode(data, src);
      (node.children = node.children || []).push(src);
    } else {
      removeNode(data, src);
      insertBefore(data, src, node);
    }
    markDirty();
    saveData();
    renderTree();
  });

  li.appendChild(item);

  if (hasKids) {
    const ul = document.createElement("ul");
    if (!isExpanded(node)) ul.style.display = "none";
    node.children.forEach(c => ul.appendChild(renderNode(c)));
    li.appendChild(ul);
  }
  return li;
}

function syncSelection() {
  $$(".tree-item").forEach(el => {
    el.classList.toggle("selected", selectedIds.has(el.dataset.id));
    // 更新可拖拽性
    el.draggable = el.dataset.id !== "" && selectedIds.size <= 1 &&
      (findNode(el.dataset.id) || {}).type !== "novel";
  });
}

function findNode(id) {
  let found = null;
  (function walk(list) {
    for (const n of list) {
      if (getNodeId(n) === id) { found = n; return; }
      walk(n.children || []);
    }
  })(data.children || []);
  return found;
}
function removeNode(root, node) {
  (function walk(list) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === node) { list.splice(i, 1); return; }
      walk(list[i].children || []);
    }
  })(root.children || []);
}
function insertBefore(root, node, beforeNode) {
  (function walk(list) {
    for (let i = 0; i < list.length; i++) {
      if (list[i] === beforeNode) { list.splice(i, 0, node); return; }
      walk(list[i].children || []);
    }
  })(root.children || []);
}

/* ==================================================================
 * 自动命名
 * ================================================================== */
function autoName(node, type) {
  const meta = TYPE_META[type];
  if (type === "novel") {
    const cnt = (data.children || []).filter(c => c.type === "novel").length;
    return `小说${cnt + 1}`;
  }
  const sibs = (node.children || []).filter(c => c.type === type);
  if (type === "chapter") return `第${sibs.length + 1}章`;
  if (type === "volume") return `第${sibs.length + 1}卷`;
  return `${meta.label}${sibs.length + 1}`;
}
function makeNode(type, name) {
  const base = { type, name };
  if (type === "storyline" || type === "relation") base.tree_data = [];
  else if (type === "character" || type === "inspire") base.note = "";
  else base.content = "";
  if (type === "volume" || type === "outline" || type === "novel") base.children = [];
  return base;
}

/* ==================================================================
 * 节点操作
 * ================================================================== */
function createNovel() {
  const name = prompt("请输入小说名称（留空自动命名）", autoName(null, "novel"));
  if (name === null) return;
  const node = makeNode("novel", name || autoName(null, "novel"));
  (data.children = data.children || []).push(node);
  markDirty(); saveData(); renderTree();
  setStatus("已新建小说：" + node.name);
}
function createChild(node, type) {
  const name = prompt(`请输入${TYPE_META[type].label}名称（留空自动命名）`, autoName(node, type));
  if (name === null) return;
  const child = makeNode(type, name || autoName(node, type));
  (node.children = node.children || []).push(child);
  node._expanded = true;
  markDirty(); saveData(); renderTree();
}
function renameNode(node) {
  const name = prompt("重命名", node.name || "");
  if (name === null || !name.trim()) return;
  node.name = name.trim();
  markDirty(); saveData(); renderTree();
  refreshTabTitle(node);
}
function deleteNode(node) {
  const kids = (node.children || []).length;
  const msg = kids ? `确定删除【${node.name}】及其 ${kids} 个子节点？` : `确定删除【${node.name}】？`;
  if (!confirm(msg)) return;
  removeNode(data, node);
  closeTab(node);
  markDirty(); saveData(); renderTree();
}
function batchDelete() {
  const nodes = [...selectedIds].map(findNode).filter(Boolean);
  if (!nodes.length) { alert("请先在左侧选中要删除的节点（Ctrl/Shift 多选）"); return; }
  if (!confirm(`确定批量删除选中的 ${nodes.length} 个节点？`)) return;
  nodes.forEach(n => { removeNode(data, n); closeTab(n); });
  selectedIds.clear();
  markDirty(); saveData(); renderTree();
}

/* ==================================================================
 * 右键菜单
 * ================================================================== */
function showContextMenu(e, node) {
  const menu = $("#ctx-menu");
  menu.innerHTML = "";
  const meta = TYPE_META[node.type] || { label: node.type };

  const title = document.createElement("div");
  title.className = "ctx-title";
  title.textContent = `${meta.label} · ${node.name}`;
  menu.appendChild(title);

  const allowed = CHILDREN_ALLOWED[node.type] || [];
  allowed.forEach(t => {
    const it = document.createElement("div");
    it.className = "ctx-item";
    it.textContent = `新建${TYPE_META[t].label}`;
    it.addEventListener("click", () => createChild(node, t));
    menu.appendChild(it);
  });

  if (allowed.length) {
    menu.appendChild(sep());
  }
  addItem(menu, "分屏打开", () => openSplit(node));
  addItem(menu, "重命名", () => renameNode(node));
  addItem(menu, "导出本节点", () => exportNodes([node]));
  menu.appendChild(sep());
  if (selectedIds.size > 1) {
    addItem(menu, `批量删除选中（${selectedIds.size} 项）`, batchDelete, "danger");
  } else {
    addItem(menu, "删除", () => deleteNode(node), "danger");
  }

  // 定位
  menu.classList.remove("hidden");
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let x = e.clientX, y = e.clientY;
  if (x + mw > window.innerWidth) x = window.innerWidth - mw - 8;
  if (y + mh > window.innerHeight) y = window.innerHeight - mh - 8;
  menu.style.left = x + "px";
  menu.style.top = y + "px";
}
function sep() { const d = document.createElement("div"); d.className = "ctx-sep"; return d; }
function addItem(menu, text, fn, cls) {
  const it = document.createElement("div");
  it.className = "ctx-item" + (cls ? " " + cls : "");
  it.textContent = text;
  it.addEventListener("click", () => { hideContextMenu(); fn(); });
  menu.appendChild(it);
}
function hideContextMenu() { $("#ctx-menu").classList.add("hidden"); }

/* ==================================================================
 * 编辑器（tab）
 * ================================================================== */
function openEditor(node) {
  const key = getNodeId(node);
  let tab = tabs.find(t => t.key === key);
  if (tab) { activateTab(key); return; }

  const meta = TYPE_META[node.type] || { label: node.type, color: "#888" };

  // tab 头
  const head = document.createElement("div");
  head.className = "tab" + (key === activeKey ? " active" : "");
  head.innerHTML = `<span class="tab-name"></span><span class="tab-close">✕</span>`;
  head.querySelector(".tab-name").textContent = node.name;
  head.querySelector(".tab-close").addEventListener("click", (e) => {
    e.stopPropagation(); closeTab(node);
  });
  head.addEventListener("click", () => activateTab(key));
  $("#tabs").appendChild(head);

  // 编辑面板
  const pane = document.createElement("div");
  pane.className = "editor-pane";
  pane.style.display = "none";
  pane.innerHTML = `
    <div class="editor-titlebar" style="background:${meta.color}">
      <span class="pane-title"></span>
    </div>
    <div class="editor-toolbar">
      <select class="tb-fontsize" title="字号">
        ${FONT_SIZES.map(s => `<option value="${s}">${s}px</option>`).join("")}
      </select>
      <div class="sep"></div>
      <input type="color" class="tb-color" title="文字颜色" value="#222222">
      <button class="tb-btn tb-bold" title="加粗"><b>B</b></button>
      <div class="sep"></div>
      <button class="tb-btn tb-save">💾 保存本节点</button>
      <button class="tb-btn tb-split">⧉ 分屏</button>
    </div>
    <div class="editor-content" contenteditable="true"></div>`;
  pane.querySelector(".pane-title").textContent = `${node.name} · ${meta.label}`;

  // 填入内容
  const body = pane.querySelector(".editor-content");
  let content = node.content;
  if (node.type === "character" || node.type === "inspire") content = node.note;
  else if (node.type === "storyline" || node.type === "relation") {
    content = (node.content || "") + (Array.isArray(node.tree_data) ? "\n" + node.tree_data.join("\n") : "");
  }
  body.textContent = content || "";
  body.style.fontSize = (settings.font_size || 14) + "px";
  body.style.color = settings.font_color || "#222222";

  // 工具栏事件
  const sizeSel = pane.querySelector(".tb-fontsize");
  sizeSel.value = settings.font_size || 14;
  sizeSel.addEventListener("change", () => {
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("fontSize", false, mapSize(sizeSel.value));
    // 让字号精确应用到选中
    body.focus();
  });
  pane.querySelector(".tb-color").addEventListener("change", (e) => {
    body.focus();
    document.execCommand("styleWithCSS", false, true);
    document.execCommand("foreColor", false, e.target.value);
  });
  pane.querySelector(".tb-bold").addEventListener("click", () => {
    body.focus(); document.execCommand("bold");
  });
  pane.querySelector(".tb-save").addEventListener("click", () => saveNodeField(node, body));
  pane.querySelector(".tb-split").addEventListener("click", () => openSplit(node));
  body.addEventListener("input", () => markDirty());

  $("#editor-container").appendChild(pane);

  tabs.push({ key, node, head, pane, body });
  // 清空空状态
  const es = $("#empty-state");
  if (es) es.style.display = "none";
  activateTab(key);
}

function mapSize(px) {
  // 浏览器 fontSize 命令 1-7，做粗略映射
  const map = { 12: 2, 14: 3, 16: 3, 18: 4, 24: 5, 32: 6, 48: 7 };
  return map[px] || 3;
}

function saveNodeField(node, body) {
  let text = (body.innerText || "").replace(/\n+$/, "").trim();
  if (node.type === "character" || node.type === "inspire") node.note = text;
  else if (node.type === "storyline" || node.type === "relation") node.tree_data = text.split("\n");
  else node.content = text;
  saveData();
  setStatus("已保存：" + node.name);
}

function activateTab(key) {
  activeKey = key;
  tabs.forEach(t => {
    const on = t.key === key;
    t.head.classList.toggle("active", on);
    t.pane.style.display = on ? "" : "none";
  });
}
function closeTab(node) {
  const key = getNodeId(node);
  const idx = tabs.findIndex(t => t.key === key);
  if (idx < 0) return;
  tabs[idx].head.remove();
  tabs[idx].pane.remove();
  tabs.splice(idx, 1);
  if (activeKey === key) {
    activeKey = tabs.length ? tabs[tabs.length - 1].key : null;
    if (activeKey) activateTab(activeKey);
    else showEmptyState();
  }
}
function refreshTabTitle(node) {
  tabs.filter(t => t.key === getNodeId(node)).forEach(t => {
    t.head.querySelector(".tab-name").textContent = node.name;
    t.pane.querySelector(".pane-title").textContent = `${node.name} · ${TYPE_META[node.type].label}`;
  });
}
function showEmptyState() {
  const es = $("#empty-state");
  if (es) es.style.display = "";
}

/* ==================================================================
 * 分屏面板
 * ================================================================== */
function openSplit(node) {
  const panel = $("#split-panel");
  panel.classList.remove("hidden");
  $("#split-title").textContent = `${node.name} · 分屏`;
  const body = $("#split-body");
  body.innerHTML = "";
  const meta = TYPE_META[node.type] || { label: node.type, color: "#888" };
  body.innerHTML = `
    <div class="editor-titlebar" style="background:${meta.color};margin:10px"><span></span></div>
    <div class="editor-content" contenteditable="true" style="margin:0 14px 14px;flex:1"></div>`;
  body.querySelector(".editor-titlebar span").textContent = `${node.name} · ${meta.label}`;
  const ed = body.querySelector(".editor-content");
  let content = node.content;
  if (node.type === "character" || node.type === "inspire") content = node.note;
  else if (node.type === "storyline" || node.type === "relation") {
    content = (node.content || "") + (Array.isArray(node.tree_data) ? "\n" + node.tree_data.join("\n") : "");
  }
  ed.textContent = content || "";
  ed.addEventListener("input", () => markDirty());
  ed.addEventListener("blur", () => {
    let t = (ed.innerText || "").replace(/\n+$/, "").trim();
    if (node.type === "character" || node.type === "inspire") node.note = t;
    else if (node.type === "storyline" || node.type === "relation") node.tree_data = t.split("\n");
    else node.content = t;
  });
}
function closeSplit() { $("#split-panel").classList.add("hidden"); }

/* ==================================================================
 * 导出
 * ================================================================== */
function nodeToMd(node, level) {
  const lines = [`${"#".repeat(Math.min(level, 6))} ${node.name || ""}`];
  let body = node.content || node.note || "";
  if (Array.isArray(node.tree_data) && node.tree_data.length) {
    body = (body ? body + "\n" : "") + node.tree_data.join("\n");
  }
  if (body && String(body).trim()) lines.push("", String(body).trim());
  (node.children || []).forEach(c => lines.push(...nodeToMd(c, level + 1)));
  return lines;
}
function exportNodes(nodes) {
  if (!nodes.length) { alert("没有可导出的内容"); return; }
  const lines = [];
  nodes.forEach(n => lines.push(...nodeToMd(n, 1), ""));
  download(lines.join("\n"), (nodes[0].name || "导出") + ".md");
  setStatus("已导出 " + nodes.length + " 个节点");
}
function exportAll() {
  const nodes = data.children || [];
  if (!nodes.length) { alert("没有内容可导出"); return; }
  const lines = [];
  nodes.forEach(n => lines.push(...nodeToMd(n, 1), ""));
  download(lines.join("\n"), "全部小说.md");
  setStatus("已导出全部");
}
function download(text, filename) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* ==================================================================
 * 主题 / 背景
 * ================================================================== */
function applyTheme(name) {
  document.body.dataset.theme = name;
  settings.theme = name;
  $$("#seg-theme button").forEach(b => b.classList.toggle("active", b.dataset.theme === name));
}
function applyBg() {
  const url = settings.background_image;
  const layer = $("#bg-layer");
  if (url) {
    layer.style.backgroundImage = `url(${url})`;
    document.body.classList.add("has-bg");
  } else {
    layer.style.backgroundImage = "";
    document.body.classList.remove("has-bg");
  }
}
function syncSettingsUI() {
  $("#set-font-size").value = settings.font_size || 14;
  $("#set-font-size-val").textContent = settings.font_size || 14;
  $("#set-font-color").value = settings.font_color || "#222222";
  const prev = $("#bg-preview");
  if (settings.background_image) {
    prev.style.backgroundImage = `url(${settings.background_image})`;
    prev.textContent = "";
  } else {
    prev.style.backgroundImage = "";
    prev.textContent = "未设置背景";
    prev.style.display = "flex";
    prev.style.alignItems = "center";
    prev.style.justifyContent = "center";
  }
}

/* ==================================================================
 * 保存
 * ================================================================== */
function markDirty() {
  dirty = true;
  const el = $("#save-state");
  el.textContent = "● 未保存";
  el.className = "dirty";
}
function stripMeta(node) {
  delete node._id; delete node._expanded;
  (node.children || []).forEach(stripMeta);
}
async function saveData() {
  // 移除临时 meta 字段后保存
  const clone = JSON.parse(JSON.stringify(data));
  stripMeta(clone);
  try {
    await fetch("/api/data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(clone),
    });
    dirty = false;
    const el = $("#save-state");
    el.textContent = "✓ 已保存";
    el.className = "saved";
  } catch (e) {
    setStatus("保存失败：" + e.message);
  }
}
async function saveSettings() {
  await fetch("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}
function setStatus(msg) {
  $("#status-text").textContent = msg;
}

/* ==================================================================
 * 事件绑定
 * ================================================================== */
function bindGlobal() {
  // 保存
  $("#btn-save").addEventListener("click", () => saveData());
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      // 保存当前激活编辑器
      const t = tabs.find(x => x.key === activeKey);
      if (t) saveNodeField(t.node, t.body);
      saveData();
    }
  });

  // 新建小说
  $("#btn-new-novel").addEventListener("click", createNovel);
  $("#btn-add-root").addEventListener("click", createNovel);

  // 导出
  $("#btn-export").addEventListener("click", () => {
    if (selectedIds.size) {
      const nodes = [...selectedIds].map(findNode).filter(Boolean);
      exportNodes(nodes);
    } else exportAll();
  });

  // 批量删除
  $("#btn-batch-del").addEventListener("click", batchDelete);

  // 主题下拉
  $("#btn-theme").addEventListener("click", () => $("#theme-menu").closest(".dropdown").classList.toggle("open"));
  $$("#theme-menu a").forEach(a => a.addEventListener("click", () => {
    applyTheme(a.dataset.theme);
    settings.theme = a.dataset.theme;
    saveSettings();
    $("#theme-menu").closest(".dropdown").classList.remove("open");
    setStatus("已切换：" + a.textContent.trim());
  }));

  // 设置弹窗
  $("#btn-settings").addEventListener("click", openSettingsModal);
  $("#modal-close").addEventListener("click", closeSettingsModal);
  $("#btn-settings-cancel").addEventListener("click", closeSettingsModal);
  $("#btn-settings-ok").addEventListener("click", applySettings);
  $("#btn-reset").addEventListener("click", resetSettings);
  $("#set-font-size").addEventListener("input", () => {
    $("#set-font-size-val").textContent = $("#set-font-size").value;
  });
  $("#btn-upload-bg").addEventListener("click", () => $("#bg-file").click());
  $("#btn-clear-bg").addEventListener("click", () => {
    settings.background_image = "";
    applyBg(); syncSettingsUI(); saveSettings();
  });
  $("#bg-file").addEventListener("change", uploadBg);

  // 分段主题选择
  $$("#seg-theme button").forEach(b => b.addEventListener("click", () => {
    applyTheme(b.dataset.theme);
    settings.theme = b.dataset.theme;
  }));

  // 分屏关闭
  $("#split-close").addEventListener("click", closeSplit);

  // 关闭右键菜单 / 下拉
  document.addEventListener("click", (e) => {
    hideContextMenu();
    if (!e.target.closest(".dropdown")) {
      $("#theme-menu").closest(".dropdown").classList.remove("open");
    }
  });
}

// 启动欢迎页：页面资源加载完成后，短暂展示 logo 欢迎画面再淡出进入主界面
window.addEventListener("load", () => {
  setTimeout(() => {
    const w = document.getElementById("welcome");
    if (!w) return;
    w.classList.add("hide");
    setTimeout(() => { if (w.parentNode) w.parentNode.removeChild(w); }, 650);
  }, 950);
});

/* ==================================================================
 * 设置弹窗
 * ================================================================== */
function openSettingsModal() {
  syncSettingsUI();
  $("#modal-mask").classList.remove("hidden");
}
function closeSettingsModal() { $("#modal-mask").classList.add("hidden"); }
function applySettings() {
  settings.theme = settings.theme || "day";
  settings.font_size = parseInt($("#set-font-size").value, 10) || 14;
  settings.font_color = $("#set-font-color").value || "#222222";
  applyTheme(settings.theme);
  applyBg();
  saveSettings();
  // 刷新已打开编辑器的字号
  tabs.forEach(t => {
    t.body.style.fontSize = settings.font_size + "px";
    t.body.style.color = settings.font_color;
  });
  closeSettingsModal();
  setStatus("设置已应用");
}
function resetSettings() {
  settings = { theme: "day", font_size: 14, font_color: "#222222", background_image: "" };
  applyTheme("day"); applyBg(); syncSettingsUI();
}
async function uploadBg(e) {
  const file = e.target.files[0];
  if (!file) return;
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  const out = await res.json();
  if (out.ok) {
    settings.background_image = out.url;
    applyBg();
    syncSettingsUI();
    saveSettings();
    setStatus("背景图已上传");
  } else {
    alert("上传失败：" + (out.error || "未知错误"));
  }
  e.target.value = "";
}

init();
