/* ==================================================================
 * 小说写作软件 · Web 版前端逻辑
 * ================================================================== */

/* ---------- 类型元信息 ---------- */
const TYPE_META = {
  novel:       { label: "小说",     color: "#4472C4" },
  volume:      { label: "卷",       color: "#5B9BD5" },
  chapter:     { label: "章",       color: "#9BC2E6" },
  beat:        { label: "拍",       color: "#9b59b6" },
  outline:     { label: "大纲",     color: "#70AD47" },
  character:   { label: "角色",     color: "#ED7D31" },
  location:    { label: "地点",     color: "#E53935" },
  faction:     { label: "势力",     color: "#C00000" },
  item:        { label: "道具",     color: "#BF8F00" },
  event:       { label: "事件",     color: "#FFC000" },
  resource:    { label: "资源",     color: "#00B0F0" },
  concept:     { label: "概念",     color: "#FF66CC" },
  foreshadow:  { label: "伏笔",     color: "#e91e63" },
  fact:        { label: "事实",     color: "#90a4ae" },
  rule:        { label: "规则",     color: "#607d8b" },
  relation:    { label: "人物关系", color: "#FFB900" },
  inspire:     { label: "灵感",     color: "#FFC000" },
  storyline:   { label: "故事线",   color: "#C5E0B4" },
  script:      { label: "剧本",     color: "#e91e63" },
  group:       { label: "文件夹",   color: "#888888" },
};
/* 大纲下需要被类型文件夹收录的文档类型 */
const GROUPABLE_TYPES = ["character", "location", "faction", "item", "event",
                         "resource", "concept", "foreshadow", "fact", "rule",
                         "relation", "inspire", "storyline"];
const CHILDREN_ALLOWED = {
  novel: ["volume", "outline"],
  outline: ["group"],
  group: GROUPABLE_TYPES,
  volume: ["chapter", "script"],
  chapter: ["beat", "script"],
  beat: [],
  character: ["character"],
  location: ["location"],
  faction: ["faction"],
  item: ["item"],
  event: ["event"],
  resource: ["resource"],
  concept: ["concept"],
  foreshadow: ["foreshadow"],
  fact: ["fact"],
  rule: ["rule"],
  relation: ["relation"],
  inspire: ["inspire"],
  storyline: ["storyline"],
};
/* 出现在「设定档案」里的实体类型 */
const ARCHIVE_TYPES = ["character", "location", "faction", "item", "event",
                       "resource", "concept", "foreshadow", "fact", "rule"];
/* 有正文内容的叶子类型 */
const CONTENT_TYPES = ["volume", "chapter", "beat", "character", "inspire",
                       "location", "faction", "item", "event", "resource",
                       "concept", "foreshadow", "fact", "rule", "relation", "storyline", "script"];
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
let autoSaveTimer = null;    // 防抖自动保存定时器
const AUTO_SAVE_DELAY = 2000; // 输入停止 2 秒后自动保存
const MAX_HISTORY = 20;       // 每个节点保留的历史版本数

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getNodeId(node) {
  if (!node._id) node._id = "n" + (++nodeSeq);
  return node._id;
}
function isExpanded(node) { return node._expanded !== false; }
function setExpanded(node, v) { node._expanded = !!v; }

/* ==================================================================
 * 数据迁移：大纲规范化
 * 确保：1) 大纲只在小说下面 2) 每本小说有且仅有一个大纲
 * ================================================================== */
function migrateOutlines() {
  if (!data || !data.children) return;
  let changed = false;
  const novels = data.children.filter(n => n.type === "novel");
  const rootOutlines = data.children.filter(n => n.type === "outline");

  // 1. 根层级的大纲：移到第一本小说下（没有小说则新建）
  rootOutlines.forEach(ol => {
    let targetNovel = novels[0];
    if (!targetNovel) {
      targetNovel = makeNode("novel", "未命名小说");
      targetNovel.children = [];
      data.children.push(targetNovel);
      novels.push(targetNovel);
      changed = true;
    }
    // 如果目标小说已有大纲，把这个根大纲的子节点合并过去，然后删除
    const existing = targetNovel.children.find(c => c.type === "outline");
    if (existing) {
      (ol.children || []).forEach(c => existing.children.push(c));
      data.children = data.children.filter(n => n !== ol);
    } else {
      data.children = data.children.filter(n => n !== ol);
      targetNovel.children.push(ol);
    }
    changed = true;
  });

  // 2. 非小说下的大纲：移到最近的小说下
  function walk(list, parentNovel) {
    for (let i = list.length - 1; i >= 0; i--) {
      const n = list[i];
      if (n.type === "novel") {
        // 确保每本小说有一个大纲
        if (!n.children || !n.children.some(c => c.type === "outline")) {
          n.children = n.children || [];
          n.children.unshift(makeNode("outline", "大纲"));
          changed = true;
        }
        walk(n.children || [], n);
      } else if (n.type === "outline" && parentNovel) {
        // 大纲在非直接小说子级（理论上不会发生，但保险处理）
        // 已经在小说下，跳过
      } else if (n.children && n.children.length) {
        walk(n.children, parentNovel);
      }
    }
  }
  walk(data.children, null);

  // 3. 每本小说只保留第一个大纲，多余的合并
  novels.forEach(novel => {
    const outlines = (novel.children || []).filter(c => c.type === "outline");
    if (outlines.length > 1) {
      const first = outlines[0];
      for (let i = 1; i < outlines.length; i++) {
        (outlines[i].children || []).forEach(c => first.children.push(c));
        novel.children = novel.children.filter(c => c !== outlines[i]);
      }
      changed = true;
    }
  });

  if (changed) {
    saveData();
    setStatus("已自动规范化大纲结构（每本小说一个大纲）");
  }
}

/* ==================================================================
 * 数据迁移：大纲下的文档自动归入类型文件夹
 * 确保：大纲下的角色、地点等文档都放在对应类型的文件夹里
 * ================================================================== */
function migrateGroups() {
  if (!data || !data.children) return;
  let changed = false;
  (function walk(list) {
    for (const n of list) {
      if (n.type === "outline" && n.children) {
        // 收集直接挂在大纲下的可分组类型节点
        const direct = n.children.filter(c => GROUPABLE_TYPES.includes(c.type));
        if (direct.length) {
          // 按类型分组，移到对应文件夹
          const byType = {};
          direct.forEach(c => {
            (byType[c.type] = byType[c.type] || []).push(c);
          });
          Object.keys(byType).forEach(type => {
            const group = findOrCreateGroup(n, type);
            byType[type].forEach(c => {
              // 从大纲直接子级中移除
              n.children = n.children.filter(x => x !== c);
              group.children.push(c);
            });
          });
          changed = true;
        }
      }
      if (n.children) walk(n.children);
    }
  })(data.children);

  // 清理空文件夹
  if (cleanupAllEmptyGroups()) changed = true;

  if (changed) {
    saveData();
    setStatus("已自动整理大纲文档到类型文件夹");
  }
}

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
  // 数据迁移：确保大纲只在小说下面，每本小说有且仅有一个大纲
  migrateOutlines();
  // 数据迁移：大纲下的文档自动归入类型文件夹
  migrateGroups();
  // 清理回收站中超过 3 天的内容
  cleanupExpiredTrash();
  applyTheme(settings.theme);
  applyBg();
  syncSettingsUI();
  renderTree();
  bindGlobal();
  setStatus("就绪");
  document.dispatchEvent(new CustomEvent("novel:ready"));
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

  // 类型圆点 + 标签（文件夹类型用文件夹图标）
  const dot = document.createElement("span");
  if (node.type === "group") {
    dot.className = "type-folder";
    dot.textContent = "📁";
  } else {
    dot.className = "type-dot";
    dot.style.background = meta.color;
  }
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = node.name || "";
  const metaTxt = document.createElement("span");
  metaTxt.className = "meta";
  metaTxt.textContent = node.type === "group" ? "" : meta.label;

  // 分屏按钮（卷和文件夹不提供文本编辑）
  const splitBtn = document.createElement("button");
  splitBtn.className = "split-btn";
  splitBtn.textContent = "⧉";
  splitBtn.title = "分屏打开";
  if (node.type === "volume" || node.type === "group") splitBtn.style.display = "none";
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

  // 双击打开编辑（卷和文件夹只是标题，不打开正文编辑器，改为切换展开）
  item.addEventListener("dblclick", () => {
    if (node.type === "storyline" || node.type === "relation") openTreeDiagram(node);
    else if (node.type === "volume" || node.type === "group") {
      setExpanded(node, !isExpanded(node));
      renderTree();
    }
    else openEditor(node);
  });

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
    // 大纲只能放在小说下面，不能拖到其他位置
    if (src.type === "outline" && node.type !== "novel") {
      setStatus("大纲只能放在小说标题下面");
      return;
    }
    // 小说已有大纲时，不能再拖入另一个大纲
    if (src.type === "outline" && node.type === "novel") {
      const hasOutline = (node.children || []).some(c => c.type === "outline");
      if (hasOutline) { setStatus("该小说已有大纲，每本小说只能有一个大纲"); return; }
    }
    // 文件夹不允许拖入不匹配的类型，也不允许拖入其他文件夹
    if (node.type === "group") {
      if (src.type === "group") { setStatus("文件夹不能嵌套"); return; }
      if (src.type !== node.group_type) {
        // 类型不匹配时，转到文件夹所在的大纲下，自动归入对应文件夹
        const outline = findParent(data, node);
        if (outline && outline.type === "outline" && GROUPABLE_TYPES.includes(src.type)) {
          removeNode(data, src);
          const targetGroup = findOrCreateGroup(outline, src.type);
          targetGroup.children.push(src);
          cleanupAllEmptyGroups();
          markDirty(); saveData(); renderTree();
          return;
        }
        setStatus(`该文件夹只收录${TYPE_META[node.group_type].label}类型`);
        return;
      }
    }
    // 大纲下拖入可分组类型文档时，自动归入对应文件夹
    if (node.type === "outline" && GROUPABLE_TYPES.includes(src.type)) {
      removeNode(data, src);
      const targetGroup = findOrCreateGroup(node, src.type);
      targetGroup.children.push(src);
      cleanupAllEmptyGroups();
      markDirty(); saveData(); renderTree();
      return;
    }
    const allowed = CHILDREN_ALLOWED[node.type] || [];
    if (allowed.includes(src.type)) {
      removeNode(data, src);
      (node.children = node.children || []).push(src);
    } else {
      // 非允许子类型时，作为同级插入；但大纲不允许作为非小说的同级
      if (src.type === "outline") { setStatus("大纲只能放在小说标题下面"); return; }
      removeNode(data, src);
      insertBefore(data, src, node);
    }
    cleanupAllEmptyGroups();
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
  if (type === "beat") return `拍 ${sibs.length + 1}`;
  return `${meta.label}${sibs.length + 1}`;
}
function makeNode(type, name, opts) {
  opts = opts || {};
  const base = { type, name };
  if (type === "group") {
    base.group_type = opts.group_type || "";
    base.children = [];
    return base;
  }
  if (type === "storyline" || type === "relation") base.tree_data = [];
  else if (type === "character" || type === "inspire") base.note = "";
  else base.content = "";
  if (type === "beat") { base.links = []; base.facts = []; }
  if (type === "foreshadow") { base.status = "open"; base.planted = ""; base.resolved = ""; }
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
  // 每本小说自动创建一个大纲
  const outline = makeNode("outline", "大纲");
  node.children.push(outline);
  (data.children = data.children || []).push(node);
  markDirty(); saveData(); renderTree();
  setStatus("已新建小说：" + node.name + "（含默认大纲）");
}
/* 在大纲下查找或创建指定类型的文件夹 */
function findOrCreateGroup(outlineNode, type) {
  const groups = (outlineNode.children || []).filter(c => c.type === "group" && c.group_type === type);
  if (groups.length) return groups[0];
  const group = makeNode("group", TYPE_META[type].label, { group_type: type });
  (outlineNode.children = outlineNode.children || []).push(group);
  return group;
}
/* 清理空文件夹：如果文件夹下没有子节点，则删除文件夹 */
function cleanupEmptyGroups(outlineNode) {
  if (!outlineNode || !outlineNode.children) return;
  const before = outlineNode.children.length;
  outlineNode.children = outlineNode.children.filter(c => {
    if (c.type === "group" && (!c.children || c.children.length === 0)) return false;
    return true;
  });
  return outlineNode.children.length !== before;
}
/* 遍历整棵树，清理所有空文件夹 */
function cleanupAllEmptyGroups() {
  let changed = false;
  (function walk(list) {
    for (const n of list) {
      if (n.type === "outline") {
        if (cleanupEmptyGroups(n)) changed = true;
      }
      if (n.children) walk(n.children);
    }
  })(data.children || []);
  return changed;
}
function createChild(node, type) {
  // 大纲下新建可分组类型文档时，自动找/建对应类型文件夹
  let parent = node;
  if (node.type === "outline" && GROUPABLE_TYPES.includes(type)) {
    parent = findOrCreateGroup(node, type);
  }
  const name = prompt(`请输入${TYPE_META[type].label}名称（留空自动命名）`, autoName(parent, type));
  if (name === null) return;
  const child = makeNode(type, name || autoName(parent, type));
  (parent.children = parent.children || []).push(child);
  parent._expanded = true;
  if (node.type === "outline") node._expanded = true;
  markDirty(); saveData(); renderTree();
}
function renameNode(node) {
  const name = prompt("重命名", node.name || "");
  if (name === null || !name.trim()) return;
  node.name = name.trim();
  markDirty(); saveData(); renderTree();
  refreshTabTitle(node);
}
/* ==================================================================
 * 回收站
 * ================================================================== */
const TRASH_TTL = 3 * 24 * 60 * 60 * 1000; // 回收站保留 3 天

/* 将节点移入回收站（不直接删除） */
function moveToTrash(node) {
  if (!data.trash) data.trash = [];
  // 先记录原父节点类型（移除后就找不到了）
  const parent = findParent(data, node);
  // 从树中移除
  removeNode(data, node);
  closeTab(node);
  // 剥离运行时临时字段，深拷贝后存入回收站
  const clone = JSON.parse(JSON.stringify(node));
  (function strip(n) {
    delete n._id; delete n._expanded;
    (n.children || []).forEach(strip);
  })(clone);
  data.trash.push({
    node: clone,
    deleted_at: Date.now(),
    original_parent_type: parent ? parent.type : null,
  });
}

/* 从回收站恢复节点 */
function restoreFromTrash(index) {
  if (!data.trash || !data.trash[index]) return false;
  const item = data.trash[index];
  const node = item.node;
  // 重新分配运行时 ID
  (function reid(n) {
    delete n._id; getNodeId(n);
    (n.children || []).forEach(reid);
  })(node);

  // 根据原父节点类型决定恢复位置
  const pType = item.original_parent_type;
  let placed = false;

  if (pType === "novel" || node.type === "novel") {
    // 小说节点恢复到根目录
    (data.children = data.children || []).push(node);
    placed = true;
  } else if (pType === "outline" || GROUPABLE_TYPES.includes(node.type)) {
    // 大纲下的文档恢复到第一本小说的大纲下（自动归入文件夹）
    const novel = (data.children || []).find(c => c.type === "novel");
    if (novel) {
      let outline = (novel.children || []).find(c => c.type === "outline");
      if (!outline) {
        outline = makeNode("outline", "大纲");
        novel.children = novel.children || [];
        novel.children.unshift(outline);
      }
      const group = findOrCreateGroup(outline, node.type);
      group.children.push(node);
      placed = true;
    }
  } else if (pType === "volume" || node.type === "volume") {
    // 卷恢复到第一本小说下
    const novel = (data.children || []).find(c => c.type === "novel");
    if (novel) {
      (novel.children = novel.children || []).push(node);
      placed = true;
    }
  } else if (pType === "chapter" || node.type === "chapter") {
    // 章恢复到第一本小说的第一卷下
    const novel = (data.children || []).find(c => c.type === "novel");
    const vol = novel ? (novel.children || []).find(c => c.type === "volume") : null;
    if (vol) {
      (vol.children = vol.children || []).push(node);
      placed = true;
    }
  } else if (pType === "group") {
    // 原来在文件夹里的，恢复到对应类型文件夹
    const novel = (data.children || []).find(c => c.type === "novel");
    const outline = novel ? (novel.children || []).find(c => c.type === "outline") : null;
    if (outline) {
      const group = findOrCreateGroup(outline, node.type);
      group.children.push(node);
      placed = true;
    }
  }

  if (!placed) {
    // 兜底：恢复到根目录
    (data.children = data.children || []).push(node);
  }

  // 从回收站移除
  data.trash.splice(index, 1);
  cleanupAllEmptyGroups();
  markDirty(); saveData(); renderTree();
  return true;
}

/* 永久删除回收站中的单个项目 */
function purgeTrashItem(index) {
  if (!data.trash || !data.trash[index]) return;
  data.trash.splice(index, 1);
  markDirty(); saveData();
}

/* 清空回收站 */
function emptyTrash() {
  if (!data.trash || !data.trash.length) return;
  if (!confirm(`确定永久删除回收站中的全部 ${data.trash.length} 项？此操作不可恢复。`)) return;
  data.trash = [];
  markDirty(); saveData();
  renderTrash();
}

/* 清理超过保留期的回收站项目 */
function cleanupExpiredTrash() {
  if (!data.trash || !data.trash.length) return 0;
  const now = Date.now();
  const before = data.trash.length;
  data.trash = data.trash.filter(item => (now - (item.deleted_at || 0)) < TRASH_TTL);
  const removed = before - data.trash.length;
  if (removed > 0) {
    saveData();
    setStatus(`回收站已自动清理 ${removed} 项超过 3 天的内容`);
  }
  return removed;
}

/* 渲染回收站列表 */
function renderTrash() {
  const list = $("#trash-list");
  if (!list) return;
  const items = data.trash || [];
  if (!items.length) {
    list.innerHTML = `<div class="trash-empty">回收站为空</div>`;
    return;
  }
  const now = Date.now();
  list.innerHTML = items.map((item, i) => {
    const n = item.node;
    const meta = TYPE_META[n.type] || { label: n.type, color: "#888" };
    const deletedAt = new Date(item.deleted_at || 0);
    const remainMs = TRASH_TTL - (now - (item.deleted_at || 0));
    const remainDays = Math.max(0, Math.ceil(remainMs / (24 * 60 * 60 * 1000)));
    const dateStr = `${deletedAt.getFullYear()}-${String(deletedAt.getMonth()+1).padStart(2,'0')}-${String(deletedAt.getDate()).padStart(2,'0')} ${String(deletedAt.getHours()).padStart(2,'0')}:${String(deletedAt.getMinutes()).padStart(2,'0')}`;
    const kids = (n.children || []).length;
    return `<div class="trash-item">
      <span class="trash-dot" style="background:${meta.color}"></span>
      <div class="trash-info">
        <div class="trash-name">${escHtml(n.name || "(未命名)")}${kids ? ` <span class="trash-kids">(${kids} 子项)</span>` : ""}</div>
        <div class="trash-meta">${meta.label} · 删除于 ${dateStr} · 剩余 ${remainDays} 天</div>
      </div>
      <div class="trash-actions">
        <button class="btn small" data-trash-restore="${i}">恢复</button>
        <button class="btn small danger" data-trash-purge="${i}">永久删除</button>
      </div>
    </div>`;
  }).join("");

  // 绑定按钮事件
  list.querySelectorAll("[data-trash-restore]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.trashRestore, 10);
      if (restoreFromTrash(idx)) {
        renderTrash();
        setStatus("已恢复");
      }
    });
  });
  list.querySelectorAll("[data-trash-purge]").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.trashPurge, 10);
      const item = data.trash && data.trash[idx];
      if (!item) return;
      if (!confirm(`确定永久删除【${item.node.name}】？此操作不可恢复。`)) return;
      purgeTrashItem(idx);
      renderTrash();
    });
  });
}

function openTrash() {
  renderTrash();
  $("#trash-mask").classList.remove("hidden");
}
function closeTrash() {
  $("#trash-mask").classList.add("hidden");
}

function escHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ==================================================================
 * 快捷粘贴面板
 * ================================================================== */
let quickCurrentType = null;

/* 获取第一本小说的大纲 */
function getFirstOutline() {
  const novel = (data.children || []).find(c => c.type === "novel");
  if (!novel) return null;
  return (novel.children || []).find(c => c.type === "outline");
}

/* 加载类型列表 */
function loadQuickTypes() {
  const outline = getFirstOutline();
  const list = $("#quick-types");
  if (!list) return;
  if (!outline || !outline.children || !outline.children.length) {
    list.innerHTML = `<div class="quick-empty">暂无内容，请先在大纲下新建文档</div>`;
    return;
  }
  // 收集有文档的类型文件夹
  const groups = outline.children.filter(c => c.type === "group" && c.children && c.children.length);
  if (!groups.length) {
    list.innerHTML = `<div class="quick-empty">暂无内容</div>`;
    return;
  }
  list.innerHTML = groups.map(g => {
    const meta = TYPE_META[g.group_type] || { label: g.group_type, color: "#888" };
    return `<div class="quick-item" data-type="${g.group_type}">
      <span class="qd-dot" style="background:${meta.color}"></span>
      <span>${escHtml(g.name || meta.label)}</span>
      <span class="qd-count">${g.children.length}</span>
    </div>`;
  }).join("");
  // 绑定点击事件
  list.querySelectorAll(".quick-item").forEach(el => {
    el.addEventListener("click", () => {
      quickCurrentType = el.dataset.type;
      loadQuickDocs(quickCurrentType);
      $("#quick-types").classList.add("hidden");
      $("#quick-docs").classList.remove("hidden");
      $("#quick-back").classList.remove("hidden");
    });
  });
}

/* 加载指定类型的文档列表 */
function loadQuickDocs(type) {
  const outline = getFirstOutline();
  const list = $("#quick-docs");
  if (!list || !outline) return;
  const group = (outline.children || []).find(c => c.type === "group" && c.group_type === type);
  if (!group || !group.children || !group.children.length) {
    list.innerHTML = `<div class="quick-empty">暂无文档</div>`;
    return;
  }
  const meta = TYPE_META[type] || { label: type, color: "#888" };
  list.innerHTML = group.children.map(n => {
    return `<div class="quick-item" data-name="${escHtml(n.name || "")}">
      <span class="qd-dot" style="background:${meta.color}"></span>
      <span>${escHtml(n.name || "(未命名)")}</span>
    </div>`;
  }).join("");
  // 绑定点击事件：点击文档名粘贴到光标前
  list.querySelectorAll(".quick-item").forEach(el => {
    el.addEventListener("click", () => {
      const name = el.dataset.name;
      if (name) insertTextAtCursor(name);
    });
  });
}

/* 在当前编辑器光标前插入文本 */
function insertTextAtCursor(text) {
  // 优先使用当前焦点元素
  let target = document.activeElement;
  // 如果焦点不在 contenteditable 元素上，用当前激活的 tab
  if (!target || !target.isContentEditable) {
    const tab = tabs.find(t => t.key === activeKey);
    if (tab && tab.body) target = tab.body;
  }
  // 再检查分屏编辑器
  if (!target || !target.isContentEditable) {
    const splitEd = document.querySelector("#split-body .editor-content");
    if (splitEd) target = splitEd;
  }
  if (!target || !target.isContentEditable) {
    setStatus("请先打开一个文档并将光标放在编辑区");
    return;
  }
  // 聚焦到目标编辑器
  target.focus();
  // 用 execCommand 插入文本（在 contenteditable 中仍广泛支持）
  try {
    document.execCommand("insertText", false, text);
  } catch (e) {
    // 降级：用 Range API 手动插入
    const sel = window.getSelection();
    if (sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      const textNode = document.createTextNode(text);
      range.insertNode(textNode);
      range.setStartAfter(textNode);
      range.setEndAfter(textNode);
      sel.removeAllRanges();
      sel.addRange(range);
    } else {
      target.innerText += text;
    }
  }
  markDirty();
  setStatus(`已粘贴：${text}`);
}

/* 展开/收起快捷面板 */
function toggleQuickPanel() {
  const panel = $("#quick-panel");
  const body = $("#quick-body");
  if (body.classList.contains("hidden")) {
    body.classList.remove("hidden");
    panel.classList.add("open");
    quickCurrentType = null;
    $("#quick-types").classList.remove("hidden");
    $("#quick-docs").classList.add("hidden");
    $("#quick-back").classList.add("hidden");
    loadQuickTypes();
  } else {
    body.classList.add("hidden");
    panel.classList.remove("open");
  }
}

/* 返回类型列表 */
function quickBackToTypes() {
  quickCurrentType = null;
  $("#quick-types").classList.remove("hidden");
  $("#quick-docs").classList.add("hidden");
  $("#quick-back").classList.add("hidden");
}

function deleteNode(node) {
  const kids = (node.children || []).length;
  const msg = kids ? `确定删除【${node.name}】及其 ${kids} 个子节点？（可在回收站恢复）` : `确定删除【${node.name}】？（可在回收站恢复）`;
  if (!confirm(msg)) return;
  moveToTrash(node);
  cleanupAllEmptyGroups();
  selectedIds.clear();
  markDirty(); saveData(); renderTree();
}
function batchDelete() {
  const nodes = [...selectedIds].map(findNode).filter(Boolean);
  if (!nodes.length) { alert("请先在左侧选中要删除的节点（Ctrl/Shift 多选）"); return; }
  if (!confirm(`确定批量删除选中的 ${nodes.length} 个节点？（可在回收站恢复）`)) return;
  nodes.forEach(n => moveToTrash(n));
  selectedIds.clear();
  cleanupAllEmptyGroups();
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

  // 确定可新建的子类型列表
  let allowed;
  if (node.type === "outline") {
    // 大纲下直接显示所有可分组类型，内部自动建文件夹收录
    allowed = GROUPABLE_TYPES;
  } else if (node.type === "group") {
    // 文件夹下只允许新建对应类型
    allowed = node.group_type ? [node.group_type] : [];
  } else {
    allowed = CHILDREN_ALLOWED[node.type] || [];
  }
  allowed.forEach(t => {
    // 每本小说只能有一个大纲，已有大纲时不显示新建大纲
    if (node.type === "novel" && t === "outline") {
      const hasOutline = (node.children || []).some(c => c.type === "outline");
      if (hasOutline) return;
    }
    const it = document.createElement("div");
    it.className = "ctx-item";
    it.textContent = `新建${TYPE_META[t].label}`;
    it.addEventListener("click", () => createChild(node, t));
    menu.appendChild(it);
  });

  if (allowed.length) {
    menu.appendChild(sep());
  }
  if (node.type !== "volume" && node.type !== "group") addItem(menu, "分屏打开", () => openSplit(node));
  addItem(menu, "重命名", () => renameNode(node));
  // 导出选项：文件夹显示批量导出，其他显示单个导出
  if (node.type === "group") {
    const docCount = (node.children || []).length;
    addItem(menu, `导出文件夹内全部文档（${docCount}个）`, () => exportFolder(node));
  } else if (node.type !== "novel" && node.type !== "outline" && node.type !== "volume") {
    addItem(menu, "导出本文档", () => exportSingleDoc(node));
  }
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
      <button class="tb-btn tb-undo" title="撤销 (Ctrl+Z)">↩ 撤销</button>
      <button class="tb-btn tb-redo" title="重做 (Ctrl+Y)">↪ 重做</button>
      <button class="tb-btn tb-history" title="查看历史版本，可回退">📜 历史</button>
      <button class="tb-btn tb-split">⧉ 分屏</button>
      <button class="tb-btn tb-script" title="将小说正文转换为剧本格式">🎬 转剧本</button>
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
  pane.querySelector(".tb-undo").addEventListener("click", () => {
    const tab = tabs.find(t => t.key === key);
    if (tab) { if (tab.undoTimer) { clearTimeout(tab.undoTimer); tab.undoTimer = null; } undoEditor(tab); }
  });
  pane.querySelector(".tb-redo").addEventListener("click", () => {
    const tab = tabs.find(t => t.key === key);
    if (tab) redoEditor(tab);
  });
  pane.querySelector(".tb-history").addEventListener("click", () => openHistoryModal(node, body));
  pane.querySelector(".tb-split").addEventListener("click", () => openSplit(node));
  pane.querySelector(".tb-script").addEventListener("click", () => openScriptModal(node, body));
  body.addEventListener("input", () => {
    markDirty();
    scheduleAutoSave(node, body);
    // 防抖记录撤销快照
    const tab = tabs.find(t => t.key === key);
    if (tab) scheduleUndoSnapshot(tab);
  });

  $("#editor-container").appendChild(pane);

  // 初始化撤销/重做栈
  const tabObj = {
    key, node, head, pane, body,
    undoStack: [],       // 撤销栈：保存之前的状态
    redoStack: [],       // 重做栈：保存撤销后的状态
    undoTimer: null,     // 撤销快照防抖定时器
  };
  tabs.push(tabObj);
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
  // 获取当前已保存的文本，用于比较是否有变化
  let oldText = node.content;
  if (node.type === "character" || node.type === "inspire") oldText = node.note;
  else if (node.type === "storyline" || node.type === "relation") {
    oldText = Array.isArray(node.tree_data) ? node.tree_data.join("\n") : (node.content || "");
  }
  // 内容有变化时才记录历史版本
  if (text !== oldText) {
    pushHistory(node, oldText || "");
  }
  if (node.type === "character" || node.type === "inspire") node.note = text;
  else if (node.type === "storyline" || node.type === "relation") node.tree_data = text.split("\n");
  else node.content = text;
  saveData();
  setStatus("已保存：" + node.name);
}

/* 记录节点的历史版本 */
function pushHistory(node, text) {
  if (!node.history) node.history = [];
  // 避免重复记录相同内容
  if (node.history.length && node.history[node.history.length - 1].text === text) return;
  node.history.push({ text, time: Date.now() });
  // 限制历史版本数量
  if (node.history.length > MAX_HISTORY) {
    node.history = node.history.slice(node.history.length - MAX_HISTORY);
  }
}

/* 回退到指定历史版本 */
function revertToHistory(node, body, index) {
  if (!node.history || !node.history[index]) return false;
  const item = node.history[index];
  // 把当前内容保存为历史版本（回退后还能回来）
  const currentText = (body.innerText || "").replace(/\n+$/, "").trim();
  pushHistory(node, currentText);
  // 恢复历史版本内容到编辑器
  body.textContent = item.text || "";
  // 保存到节点
  if (node.type === "character" || node.type === "inspire") node.note = item.text || "";
  else if (node.type === "storyline" || node.type === "relation") node.tree_data = (item.text || "").split("\n");
  else node.content = item.text || "";
  saveData();
  setStatus(`已回退到 ${formatTime(item.time)} 的版本`);
  return true;
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

/* ==================================================================
 * 撤销 / 重做（Undo / Redo）
 * ================================================================== */
const UNDO_DELAY = 500;   // 输入停止 500ms 后记录一个撤销快照
const UNDO_MAX = 50;       // 最大撤销步数

/* 获取光标在元素纯文本中的偏移量 */
function getCaretOffset(el) {
  const sel = window.getSelection();
  if (!sel.rangeCount) return 0;
  const range = sel.getRangeAt(0);
  const preRange = range.cloneRange();
  preRange.selectNodeContents(el);
  preRange.setEnd(range.endContainer, range.endOffset);
  return preRange.toString().length;
}

/* 设置光标在元素纯文本中的偏移量 */
function setCaretOffset(el, offset) {
  const range = document.createRange();
  const sel = window.getSelection();
  let current = 0;
  let found = false;
  (function walk(node) {
    if (found) return;
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent.length;
      if (current + len >= offset) {
        range.setStart(node, offset - current);
        range.collapse(true);
        found = true;
        return;
      }
      current += len;
    } else {
      for (let i = 0; i < node.childNodes.length; i++) {
        walk(node.childNodes[i]);
        if (found) return;
      }
    }
  })(el);
  if (!found) {
    range.selectNodeContents(el);
    range.collapse(false);
  }
  sel.removeAllRanges();
  sel.addRange(range);
}

/* 记录撤销快照 */
function recordUndoSnapshot(tab) {
  if (!tab || !tab.body) return;
  const text = tab.body.innerText || "";
  // 避免重复记录相同内容
  if (tab.undoStack.length && tab.undoStack[tab.undoStack.length - 1].text === text) return;
  tab.undoStack.push({
    text,
    caret: getCaretOffset(tab.body),
  });
  if (tab.undoStack.length > UNDO_MAX) {
    tab.undoStack.shift();
  }
  // 新输入时清空重做栈
  tab.redoStack = [];
}

/* 防抖记录撤销快照（输入停止 UNDO_DELAY 毫秒后记录） */
function scheduleUndoSnapshot(tab) {
  if (tab.undoTimer) clearTimeout(tab.undoTimer);
  tab.undoTimer = setTimeout(() => {
    recordUndoSnapshot(tab);
    tab.undoTimer = null;
  }, UNDO_DELAY);
}

/* 撤销 */
function undoEditor(tab) {
  if (!tab || !tab.body || !tab.undoStack.length) {
    setStatus("没有可撤销的操作");
    return;
  }
  // 先把当前状态保存到重做栈
  const currentText = tab.body.innerText || "";
  const currentCaret = getCaretOffset(tab.body);
  tab.redoStack.push({ text: currentText, caret: currentCaret });

  // 恢复到上一个状态
  const snapshot = tab.undoStack.pop();
  tab.body.innerText = snapshot.text || "";
  // 恢复光标位置
  tab.body.focus();
  setCaretOffset(tab.body, Math.min(snapshot.caret, (snapshot.text || "").length));
  markDirty();
  setStatus("已撤销");
}

/* 重做 */
function redoEditor(tab) {
  if (!tab || !tab.body || !tab.redoStack.length) {
    setStatus("没有可重做的操作");
    return;
  }
  // 先把当前状态保存到撤销栈
  const currentText = tab.body.innerText || "";
  const currentCaret = getCaretOffset(tab.body);
  tab.undoStack.push({ text: currentText, caret: currentCaret });

  // 恢复到下一个状态
  const snapshot = tab.redoStack.pop();
  tab.body.innerText = snapshot.text || "";
  tab.body.focus();
  setCaretOffset(tab.body, Math.min(snapshot.caret, (snapshot.text || "").length));
  markDirty();
  setStatus("已重做");
}

/* 获取当前激活的 tab */
function getActiveTab() {
  return tabs.find(t => t.key === activeKey);
}

/* 打开历史版本弹窗 */
let historyNode = null;
let historyBody = null;
let historySelectedIndex = -1;

function openHistoryModal(node, body) {
  historyNode = node;
  historyBody = body;
  historySelectedIndex = -1;
  renderHistoryList();
  $("#history-list").classList.remove("hidden");
  $("#history-preview").classList.add("hidden");
  $("#history-mask").classList.remove("hidden");
}

function closeHistoryModal() {
  $("#history-mask").classList.add("hidden");
  historyNode = null;
  historyBody = null;
  historySelectedIndex = -1;
}

/* 渲染历史版本列表 */
function renderHistoryList() {
  const list = $("#history-list");
  if (!historyNode || !historyNode.history || !historyNode.history.length) {
    list.innerHTML = `<div class="history-empty">暂无历史版本<br><span style="font-size:11px">编辑并保存后会自动记录版本</span></div>`;
    return;
  }
  // 倒序显示，最新的在前面
  const items = historyNode.history.slice().reverse();
  list.innerHTML = items.map((item, revIdx) => {
    const realIdx = historyNode.history.length - 1 - revIdx;
    const preview = (item.text || "").replace(/\n/g, " ").substring(0, 60);
    const len = (item.text || "").length;
    return `<div class="history-item" data-idx="${realIdx}">
      <span class="h-time">${formatTime(item.time)}</span>
      <span class="h-preview">${escHtml(preview) || "(空)"}</span>
      <span class="h-len">${len}字</span>
    </div>`;
  }).join("");
  // 绑定点击事件
  list.querySelectorAll(".history-item").forEach(el => {
    el.addEventListener("click", () => {
      historySelectedIndex = parseInt(el.dataset.idx, 10);
      showHistoryPreview(historySelectedIndex);
    });
  });
}

/* 显示历史版本预览 */
function showHistoryPreview(index) {
  if (!historyNode || !historyNode.history || !historyNode.history[index]) return;
  const item = historyNode.history[index];
  $("#history-preview-title").textContent = `${formatTime(item.time)} 的版本（${(item.text || "").length}字）`;
  $("#history-preview-content").textContent = item.text || "(空内容)";
  $("#history-list").classList.add("hidden");
  $("#history-preview").classList.remove("hidden");
}

/* 回退到选中的历史版本 */
function doRevertHistory() {
  if (historySelectedIndex < 0 || !historyNode || !historyBody) return;
  const item = historyNode.history[historySelectedIndex];
  if (!item) return;
  if (!confirm(`确定回退到 ${formatTime(item.time)} 的版本？\n当前内容会被保存为新版本，仍可恢复。`)) return;
  revertToHistory(historyNode, historyBody, historySelectedIndex);
  closeHistoryModal();
}

/* 防抖自动保存：输入停止 AUTO_SAVE_DELAY 毫秒后保存当前节点 */
function scheduleAutoSave(node, body) {
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    saveNodeField(node, body);
    autoSaveTimer = null;
  }, AUTO_SAVE_DELAY);
}

/* 立即执行待保存的自动保存（切换 tab、关闭窗口前调用） */
function flushAutoSave() {
  if (autoSaveTimer) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
    // 找到当前激活的 tab 并保存
    const tab = tabs.find(t => t.key === activeKey);
    if (tab) saveNodeField(tab.node, tab.body);
  }
}

function activateTab(key) {
  // 切换前先保存当前 tab
  if (activeKey && activeKey !== key) {
    const current = tabs.find(t => t.key === activeKey);
    if (current) saveNodeField(current.node, current.body);
  }
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
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
  // 关闭前保存该 tab 的内容
  saveNodeField(tabs[idx].node, tabs[idx].body);
  if (autoSaveTimer && tabs[idx].key === activeKey) {
    clearTimeout(autoSaveTimer);
    autoSaveTimer = null;
  }
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
  ed.addEventListener("input", () => {
    markDirty();
    // 分屏编辑器也防抖自动保存
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    autoSaveTimer = setTimeout(() => {
      let t = (ed.innerText || "").replace(/\n+$/, "").trim();
      if (node.type === "character" || node.type === "inspire") node.note = t;
      else if (node.type === "storyline" || node.type === "relation") node.tree_data = t.split("\n");
      else node.content = t;
      saveData();
      setStatus("已保存：" + node.name);
      autoSaveTimer = null;
    }, AUTO_SAVE_DELAY);
  });
  ed.addEventListener("blur", () => {
    let t = (ed.innerText || "").replace(/\n+$/, "").trim();
    if (node.type === "character" || node.type === "inspire") node.note = t;
    else if (node.type === "storyline" || node.type === "relation") node.tree_data = t.split("\n");
    else node.content = t;
  });
}
function closeSplit() {
  // 关闭分屏前保存内容
  const ed = document.querySelector("#split-body .editor-content");
  if (ed) {
    const splitTitle = $("#split-title").textContent || "";
    const nodeName = splitTitle.replace(" · 分屏", "");
    // 找到对应节点并保存
    const tab = tabs.find(t => t.node.name === nodeName);
    if (tab) saveNodeField(tab.node, ed);
    else {
      // 兜底：直接保存内容到文件
      saveData();
    }
  }
  if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
  $("#split-panel").classList.add("hidden");
}

/* ==================================================================
 * 树状图编辑器（故事线 / 人物关系）
 * tree_data 以「两个空格缩进 = 一级」的文本行存储，这里渲染为可视化树
 * ================================================================== */
function parseTreeLines(lines) {
  const roots = [];
  const stack = [{ level: -1, children: roots }];
  (lines || []).forEach(raw => {
    if (!raw || !raw.trim()) return;
    const indent = (raw.match(/^(\s*)/)[1] || "").length;
    const level = Math.floor(indent / 2);
    const text = raw.trim();
    const n = { text, children: [] };
    while (stack.length > 1 && stack[stack.length - 1].level >= level) stack.pop();
    stack[stack.length - 1].children.push(n);
    stack.push({ level, children: n.children });
  });
  return roots;
}
function serializeTree(nodes, level, out) {
  out = out || [];
  nodes.forEach(n => {
    out.push("  ".repeat(level) + (n.text || ""));
    serializeTree(n.children, level + 1, out);
  });
  return out;
}

function openTreeDiagram(node) {
  const key = getNodeId(node);
  let tab = tabs.find(t => t.key === key);
  if (tab) { activateTab(key); return; }

  const meta = TYPE_META[node.type] || { label: node.type, color: "#888" };

  // tab 头
  const head = document.createElement("div");
  head.className = "tab" + (key === activeKey ? " active" : "");
  head.innerHTML = `<span class="tab-name"></span><span class="tab-close">✕</span>`;
  head.querySelector(".tab-name").textContent = node.name;
  head.querySelector(".tab-close").addEventListener("click", e => { e.stopPropagation(); closeTab(node); });
  head.addEventListener("click", () => activateTab(key));
  $("#tabs").appendChild(head);

  // 面板
  const pane = document.createElement("div");
  pane.className = "editor-pane";
  pane.style.display = "none";
  pane.innerHTML = `
    <div class="editor-titlebar" style="background:${meta.color}">
      <span class="pane-title"></span>
    </div>
    <div class="td-toolbar">
      <button class="tb-btn td-add-root">＋ 添加根节点</button>
      <button class="tb-btn td-expand">▾ 展开全部</button>
      <button class="tb-btn td-collapse">▸ 折叠全部</button>
      <span class="td-hint">单击文字编辑 · Enter 添加同级 · Tab/Shift+Tab 升降级</span>
      <span class="spacer" style="flex:1"></span>
      <button class="tb-btn tb-split">⧉ 分屏</button>
    </div>
    <div class="td-canvas" id="td-canvas-${key}"></div>`;
  pane.querySelector(".pane-title").textContent = `${node.name} · ${meta.label}树状图`;

  const canvas = pane.querySelector(".td-canvas");
  let tree = parseTreeLines(Array.isArray(node.tree_data) ? node.tree_data : []);

  function persist() {
    node.tree_data = serializeTree(tree, 0);
    markDirty();
    saveData();
    setStatus("已保存：" + node.name);
    document.dispatchEvent(new CustomEvent("novel:data-changed"));
  }

  function render() {
    canvas.innerHTML = "";
    if (!tree.length) {
      const empty = document.createElement("div");
      empty.className = "td-empty";
      empty.innerHTML = `还没有节点，点击上方 <b>＋ 添加根节点</b> 开始制作树状图`;
      canvas.appendChild(empty);
      return;
    }
    const ul = buildTreeUL(tree, 0);
    canvas.appendChild(ul);
  }

  function buildTreeUL(nodes, depth) {
    const ul = document.createElement("ul");
    ul.className = "td-ul";
    nodes.forEach((n, idx) => {
      const li = document.createElement("li");
      li.className = "td-li";
      const row = document.createElement("div");
      row.className = "td-row";
      row.style.paddingLeft = (depth * 22) + "px";

      const toggle = document.createElement("span");
      toggle.className = "td-toggle";
      const hasKids = n.children && n.children.length;
      toggle.textContent = hasKids ? "▾" : "";
      if (hasKids) {
        toggle.addEventListener("click", () => {
          const childUl = li.querySelector(":scope > ul");
          const collapsed = childUl && childUl.style.display === "none";
          if (childUl) childUl.style.display = collapsed ? "" : "none";
          toggle.textContent = collapsed ? "▾" : "▸";
        });
      }
      row.appendChild(toggle);

      const dot = document.createElement("span");
      dot.className = "td-dot";
      dot.style.background = meta.color;
      row.appendChild(dot);

      const label = document.createElement("span");
      label.className = "td-label";
      label.textContent = n.text || "";
      label.spellcheck = false;
      label.addEventListener("click", () => {
        if (label.isContentEditable) return;
        label.contentEditable = "true";
        label.focus();
        // 选中全部
        const r = document.createRange();
        r.selectNodeContents(label);
        const s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      });
      label.addEventListener("blur", () => {
        label.contentEditable = "false";
        n.text = label.textContent.trim();
        if (!n.text) n.text = "未命名";
        label.textContent = n.text;
        persist();
      });
      label.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          label.blur();
          const sib = { text: "新节点", children: [] };
          nodes.splice(idx + 1, 0, sib);
          persist();
          render();
          // focus the new node
          requestAnimationFrame(() => {
            const rows = canvas.querySelectorAll(".td-label");
            // find the new node by matching position: it's the one after current
            const allLabels = [...rows];
            const myIdx = allLabels.indexOf(label);
            if (allLabels[myIdx + 1]) {
              allLabels[myIdx + 1].click();
            }
          });
        } else if (e.key === "Tab") {
          e.preventDefault();
          label.blur();
          if (e.shiftKey) {
            // outdent: move to parent level
            outdentNode(n, nodes, idx);
          } else {
            // indent: make it a child of previous sibling
            indentNode(n, nodes, idx);
          }
          persist();
          render();
        } else if (e.key === "Escape") {
          e.preventDefault();
          label.blur();
        }
      });
      row.appendChild(label);

      // 操作按钮
      const actions = document.createElement("span");
      actions.className = "td-actions";
      const addChild = document.createElement("button");
      addChild.className = "mini-btn";
      addChild.textContent = "＋子";
      addChild.title = "添加子节点";
      addChild.addEventListener("click", () => {
        n.children = n.children || [];
        n.children.push({ text: "新节点", children: [] });
        persist();
        render();
      });
      const addSib = document.createElement("button");
      addSib.className = "mini-btn";
      addSib.textContent = "＋同级";
      addSib.title = "添加同级节点";
      addSib.addEventListener("click", () => {
        nodes.splice(idx + 1, 0, { text: "新节点", children: [] });
        persist();
        render();
      });
      const del = document.createElement("button");
      del.className = "mini-btn danger";
      del.textContent = "🗑";
      del.title = "删除节点（含子节点）";
      del.addEventListener("click", () => {
        const cnt = countNodes(n);
        if (!confirm(cnt > 1 ? `删除该节点及其 ${cnt - 1} 个子节点？` : "删除该节点？")) return;
        nodes.splice(idx, 1);
        persist();
        render();
      });
      actions.appendChild(addChild);
      actions.appendChild(addSib);
      actions.appendChild(del);
      row.appendChild(actions);

      li.appendChild(row);
      if (hasKids) {
        li.appendChild(buildTreeUL(n.children, depth + 1));
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function countNodes(n) {
    return 1 + (n.children || []).reduce((s, c) => s + countNodes(c), 0);
  }

  function indentNode(n, siblings, idx) {
    if (idx === 0) return; // 第一个无法缩进
    const prev = siblings[idx - 1];
    prev.children = prev.children || [];
    siblings.splice(idx, 1);
    prev.children.push(n);
  }
  function outdentNode(n, siblings, idx) {
    // 找到父级列表，把 n 移到父级之后
    // 通过 DOM 定位父 ul 对应的数据：我们需要在 buildTreeUL 时记录父引用
    // 简化：重新从 tree 查找 n 的父
    const parentInfo = findParent(tree, n);
    if (!parentInfo) return; // 已经是根节点
    const { parentList, parentNode, grandList } = parentInfo;
    const pIdx = grandList ? grandList.indexOf(parentNode) : -1;
    parentList.splice(parentList.indexOf(n), 1);
    if (grandList && pIdx >= 0) {
      grandList.splice(pIdx + 1, 0, n);
    } else {
      tree.push(n);
    }
  }
  function findParent(roots, target) {
    for (let i = 0; i < roots.length; i++) {
      if (roots[i] === target) return { parentList: roots, parentNode: null, grandList: null };
      if (roots[i].children) {
        const found = findParent(roots[i].children, target);
        if (found) {
          if (!found.parentNode) found.parentNode = roots[i];
          if (!found.grandList) found.grandList = roots;
          return found;
        }
      }
    }
    return null;
  }

  // 工具栏
  pane.querySelector(".td-add-root").addEventListener("click", () => {
    tree.push({ text: "新节点", children: [] });
    persist();
    render();
  });
  pane.querySelector(".td-expand").addEventListener("click", () => {
    canvas.querySelectorAll(".td-ul").forEach(u => u.style.display = "");
    canvas.querySelectorAll(".td-toggle").forEach(t => { if (t.textContent) t.textContent = "▾"; });
  });
  pane.querySelector(".td-collapse").addEventListener("click", () => {
    canvas.querySelectorAll(".td-ul").forEach((u, i) => { if (i > 0) u.style.display = "none"; });
    canvas.querySelectorAll(".td-toggle").forEach(t => { if (t.textContent === "▾") t.textContent = "▸"; });
  });
  pane.querySelector(".tb-split").addEventListener("click", () => openSplit(node));

  $("#editor-container").appendChild(pane);
  tabs.push({ key, node, head, pane, body: null, isTree: true });
  const es = $("#empty-state");
  if (es) es.style.display = "none";
  activateTab(key);
  render();
}

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

/* 选择导出路径 */
async function chooseExportDir() {
  try {
    const res = await fetch("/api/choose-export-dir", { method: "POST" });
    const out = await res.json();
    if (out.ok && out.path) {
      settings.export_dir = out.path;
      saveSettings();
      syncSettingsUI();
      setStatus("导出路径已设置：" + out.path);
    }
  } catch (e) {
    alert("选择文件夹失败：" + e.message);
  }
}

/* 获取节点的文本内容 */
function getNodeText(node) {
  if (node.type === "character" || node.type === "inspire") return node.note || "";
  if (node.type === "storyline" || node.type === "relation") {
    return Array.isArray(node.tree_data) ? node.tree_data.join("\n") : (node.content || "");
  }
  return node.content || "";
}

/* 调用后端 API 保存导出文件 */
async function saveExportFile(filename, content, subdir) {
  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename, content, subdir: subdir || "" }),
    });
    return await res.json();
  } catch (e) {
    return { ok: false, message: "导出请求失败：" + e.message };
  }
}

/* 导出单个文档 */
async function exportSingleDoc(node) {
  const text = getNodeText(node);
  const filename = (node.name || "未命名") + ".txt";
  const result = await saveExportFile(filename, text);
  if (result.ok) {
    setStatus("已导出：" + result.path);
  } else {
    alert("导出失败：" + (result.message || "未知错误"));
  }
}

/* 导出文件夹下所有文档（分别导出，不合并） */
async function exportFolder(group) {
  if (!group.children || !group.children.length) {
    alert("该文件夹下没有文档");
    return;
  }
  const subdir = group.name || "导出";
  let success = 0;
  let failed = 0;
  for (const doc of group.children) {
    const text = getNodeText(doc);
    const filename = (doc.name || "未命名") + ".txt";
    const result = await saveExportFile(filename, text, subdir);
    if (result.ok) success++;
    else failed++;
  }
  if (failed === 0) {
    setStatus(`已导出 ${success} 个文档到「${subdir}」文件夹`);
  } else {
    alert(`导出完成：成功 ${success} 个，失败 ${failed} 个`);
    setStatus(`导出完成：成功 ${success} 个，失败 ${failed} 个`);
  }
}

/* 导出节点（根据类型自动判断单个还是文件夹） */
function exportNode(node) {
  if (node.type === "group") {
    exportFolder(node);
  } else {
    exportSingleDoc(node);
  }
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
  const aiBase = $("#set-ai-base"), aiKey = $("#set-ai-key"), aiModel = $("#set-ai-model");
  if (aiBase) aiBase.value = settings.ai_base_url || "";
  if (aiKey) aiKey.value = settings.ai_api_key || "";
  if (aiModel) aiModel.value = settings.ai_model || "";
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
  // 导出路径
  const exportDirEl = $("#export-dir-name");
  if (exportDirEl) {
    exportDirEl.textContent = settings.export_dir || "未设置（默认保存到软件目录）";
    exportDirEl.title = settings.export_dir || "";
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
function stripTrashMeta() {
  (data.trash || []).forEach(item => {
    (function strip(n) {
      delete n._id; delete n._expanded;
      (n.children || []).forEach(strip);
    })(item.node);
  });
}
async function saveData() {
  // 移除临时 meta 字段后保存
  const clone = JSON.parse(JSON.stringify(data));
  stripMeta(clone);
  // 清理回收站节点的临时字段
  (clone.trash || []).forEach(item => {
    (function strip(n) {
      delete n._id; delete n._expanded;
      (n.children || []).forEach(strip);
    })(item.node);
  });
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
    notifyDataChanged();
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

/* 数据变化通知：图谱 / 工作台监听此事件刷新 */
function notifyDataChanged() {
  document.dispatchEvent(new CustomEvent("novel:data-changed"));
}

/* ==================================================================
 * 视图切换
 * ================================================================== */
function switchView(name) {
  $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
  $$(".vbtn").forEach(b => b.classList.toggle("active", b.dataset.view === name));
  document.dispatchEvent(new CustomEvent("novel:view-changed", { detail: { view: name } }));
  if (name === "write") {
    // 写作视图保持原有尺寸
  }
}

/* ==================================================================
 * 通用弹窗（输入 / 确认 / 选择）
 * ================================================================== */
function popup({ title = "", bodyHTML = "", okText = "确定", cancelText = "取消", onOpen } = {}) {
  return new Promise((resolve) => {
    const mask = $("#popup-mask");
    $("#popup-title").textContent = title;
    const body = $("#popup-body");
    body.innerHTML = bodyHTML;
    $("#popup-ok").textContent = okText;
    $("#popup-cancel").textContent = cancelText;
    mask.classList.remove("hidden");
    if (onOpen) setTimeout(() => onOpen(body), 0);
    const close = (val) => { mask.classList.add("hidden"); resolve(val); };
    $("#popup-ok").onclick = () => close(true);
    $("#popup-cancel").onclick = () => close(false);
    $("#popup-close").onclick = () => close(false);
  });
}
function promptBox(title, defVal = "", label = "") {
  return new Promise((resolve) => {
    popup({
      title,
      bodyHTML: (label ? `<label>${label}</label>` : "") + `<input id="popup-input" type="text" value="${String(defVal).replace(/"/g, "&quot;")}">`,
      onOpen: (body) => { const i = body.querySelector("input"); i.focus(); i.select();
        i.onkeydown = (e) => { if (e.key === "Enter") { $("#popup-ok").click(); } }; },
    }).then(ok => {
      if (!ok) return resolve(null);
      resolve($("#popup-input").value);
    });
  });
}

/* ==================================================================
 * 事件绑定
 * ================================================================== */
function bindGlobal() {
  // 视图切换
  $$(".vbtn").forEach(b => b.addEventListener("click", () => switchView(b.dataset.view)));

  // 保存
  $("#btn-save").addEventListener("click", () => {
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    saveData();
  });
  document.addEventListener("keydown", (e) => {
    const ctrl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();

    // Ctrl+Z：撤销
    if (ctrl && key === "z" && !e.shiftKey) {
      const tab = getActiveTab();
      if (tab && tab.body && document.activeElement === tab.body) {
        e.preventDefault();
        // 先清除待记录的快照
        if (tab.undoTimer) { clearTimeout(tab.undoTimer); tab.undoTimer = null; }
        undoEditor(tab);
        return;
      }
    }

    // Ctrl+Y 或 Ctrl+Shift+Z：重做
    if (ctrl && (key === "y" || (key === "z" && e.shiftKey))) {
      const tab = getActiveTab();
      if (tab && tab.body && document.activeElement === tab.body) {
        e.preventDefault();
        redoEditor(tab);
        return;
      }
    }

    // Ctrl+S：保存
    if (ctrl && key === "s") {
      e.preventDefault();
      // 清除防抖定时器，立即保存
      if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
      // 保存当前激活编辑器
      const t = tabs.find(x => x.key === activeKey);
      if (t) saveNodeField(t.node, t.body);
      saveData();
    }
  });

  // 页面关闭/刷新前自动保存
  window.addEventListener("beforeunload", () => {
    if (autoSaveTimer) { clearTimeout(autoSaveTimer); autoSaveTimer = null; }
    const t = tabs.find(x => x.key === activeKey);
    if (t) saveNodeField(t.node, t.body);
    saveData();
  });

  // 新建小说
  $("#btn-new-novel").addEventListener("click", createNovel);
  $("#btn-add-root").addEventListener("click", createNovel);

  // 导出
  $("#btn-export").addEventListener("click", () => {
    if (selectedIds.size) {
      const nodes = [...selectedIds].map(findNode).filter(Boolean);
      if (nodes.length === 1) {
        exportNode(nodes[0]);
      } else {
        // 多个节点：逐个导出，每个文档单独保存
        (async () => {
          let success = 0;
          for (const n of nodes) {
            if (n.type === "group") {
              // 文件夹：导出文件夹内全部文档
              if (n.children && n.children.length) {
                for (const doc of n.children) {
                  const result = await saveExportFile((doc.name || "未命名") + ".txt", getNodeText(doc), n.name);
                  if (result.ok) success++;
                }
              }
            } else if (n.type !== "novel" && n.type !== "outline" && n.type !== "volume") {
              const result = await saveExportFile((n.name || "未命名") + ".txt", getNodeText(n));
              if (result.ok) success++;
            }
          }
          setStatus(`已导出 ${success} 个文档`);
        })();
      }
    } else {
      alert("请先在左侧选中要导出的文档或文件夹（可 Ctrl/Shift 多选），然后点导出；或右键文档选择「导出本文档」。");
    }
  });

  // 批量删除
  $("#btn-batch-del").addEventListener("click", batchDelete);

  // 回收站
  $("#btn-trash").addEventListener("click", openTrash);
  $("#trash-close").addEventListener("click", closeTrash);
  $("#trash-ok").addEventListener("click", closeTrash);
  $("#trash-empty").addEventListener("click", emptyTrash);
  $("#trash-mask").addEventListener("click", (e) => {
    if (e.target.id === "trash-mask") closeTrash();
  });

  // 快捷粘贴面板
  $("#quick-toggle").addEventListener("click", toggleQuickPanel);
  $("#quick-back").addEventListener("click", quickBackToTypes);

  // 历史版本弹窗
  $("#history-close").addEventListener("click", closeHistoryModal);
  $("#history-back").addEventListener("click", () => {
    $("#history-preview").classList.add("hidden");
    $("#history-list").classList.remove("hidden");
  });
  $("#history-revert").addEventListener("click", doRevertHistory);
  $("#history-mask").addEventListener("click", (e) => {
    if (e.target.id === "history-mask") closeHistoryModal();
  });

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

  // 选择导出路径
  const btnChooseExport = $("#btn-choose-export-dir");
  if (btnChooseExport) btnChooseExport.addEventListener("click", chooseExportDir);

  // 分段主题选择（在设置弹窗内切换，立即生效并保存）
  $$("#seg-theme button").forEach(b => b.addEventListener("click", () => {
    applyTheme(b.dataset.theme);
    settings.theme = b.dataset.theme;
    saveSettings();
    setStatus("已切换：" + b.textContent.trim());
  }));

  // 分屏关闭
  $("#split-close").addEventListener("click", closeSplit);

  // 导入 TXT 拆书（旧弹窗，按钮已移至拆书视图）
  const oldImportBtn = $("#btn-import-txt");
  if (oldImportBtn) oldImportBtn.addEventListener("click", openImportModal);
  $("#import-close").addEventListener("click", closeImportModal);
  $("#import-cancel").addEventListener("click", closeImportModal);
  $("#btn-pick-txt").addEventListener("click", () => $("#import-file").click());
  $("#import-file").addEventListener("change", onImportFilePicked);
  $("#import-ok").addEventListener("click", doImportTxt);
  $$("#seg-encoding button").forEach(b => b.addEventListener("click", () => {
    $$("#seg-encoding button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    importState.encoding = b.dataset.enc;
    if (importState.fileBuf) decodeAndPreview();
  }));
  $$("#seg-split-mode button").forEach(b => b.addEventListener("click", () => {
    $$("#seg-split-mode button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    importState.splitMode = b.dataset.mode;
    if (importState.text) renderImportPreview();
  }));

  // 小说转剧本
  $("#script-close").addEventListener("click", closeScriptModal);
  $("#script-cancel").addEventListener("click", closeScriptModal);
  $("#script-convert").addEventListener("click", convertScript);
  $("#script-copy").addEventListener("click", copyScript);
  $("#script-save").addEventListener("click", saveScript);
  $$("#seg-script-mode button").forEach(b => b.addEventListener("click", () => {
    $$("#seg-script-mode button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    scriptState.mode = b.dataset.mode;
    $("#script-hint").textContent = scriptState.mode === "ai"
      ? "AI 智能转换：由大模型理解语义，准确划分场景、角色和对白，需要先在设置中配置 AI。"
      : "规则识别：自动提取对白、说话人、动作描写和场景划分，无需联网。";
  }));

  // 点击空白关闭右键菜单
  document.addEventListener("click", (e) => {
    hideContextMenu();
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
  const aiBase = $("#set-ai-base"), aiKey = $("#set-ai-key"), aiModel = $("#set-ai-model");
  if (aiBase) settings.ai_base_url = aiBase.value.trim();
  if (aiKey) settings.ai_api_key = aiKey.value.trim();
  if (aiModel) settings.ai_model = aiModel.value.trim();
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
  settings = { theme: "day", font_size: 14, font_color: "#222222", background_image: "",
               ai_base_url: "", ai_api_key: "", ai_model: "", export_dir: "" };
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

/* ==================================================================
 * 导入 TXT 拆书
 * ================================================================== */
const importState = {
  file: null, fileBuf: null, text: "", encoding: "auto", splitMode: "auto",
  novelName: "", parsed: null,
};

const CN_NUM = "一二三四五六七八九十百千零〇两";
// 卷标题：第X卷/集/部/篇，卷X，Volume X
const VOL_RE = new RegExp(
  `^[\\s　]*(?:第[${CN_NUM}\\d]+[卷集部篇]|卷[${CN_NUM}\\d]+|(?:Volume|VOL|Vol)\\s*\\.?\\s*[${CN_NUM}\\d]+)[\\s\\u3000:：、．.．]*(.*)$`, "i"
);
// 章标题：第X章/回/节，序章/楔子/番外等，Chapter X，数字编号 1、/1.
const CH_RE = new RegExp(
  `^[\\s　]*(?:第[${CN_NUM}\\d]+[章回节]|(?:序章|楔子|序言?|前言|引子|番外篇?|后记|尾声|终章)|(?:Chapter|CHAPTER|Chap)\\s*\\.?\\s*[${CN_NUM}\\dIVXLCDMivxlcdm]+|\\d+[\\s　]*[、.．])[\\s\\u3000:：、．.．]*(.*)$`
);
const MAX_HEADING_LEN = 60;

function openImportModal() {
  importState.file = null;
  importState.fileBuf = null;
  importState.text = "";
  importState.encoding = "auto";
  importState.splitMode = "auto";
  importState.novelName = "";
  importState.parsed = null;
  $("#import-file").value = "";
  $("#import-file-name").textContent = "未选择文件";
  $("#import-novel-name").value = "";
  $("#import-preview").textContent = "请先选择 TXT 文件…";
  $("#import-ok").disabled = true;
  $$("#seg-encoding button").forEach(b => b.classList.toggle("active", b.dataset.enc === "auto"));
  $$("#seg-split-mode button").forEach(b => b.classList.toggle("active", b.dataset.mode === "auto"));
  $("#import-mask").classList.remove("hidden");
}
function closeImportModal() { $("#import-mask").classList.add("hidden"); }

function onImportFilePicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  importState.file = file;
  $("#import-file-name").textContent = file.name + `（${(file.size / 1024).toFixed(1)} KB）`;
  // 默认小说名用文件名（去扩展名）
  const baseName = file.name.replace(/\.[^.]+$/, "");
  if (!$("#import-novel-name").value) $("#import-novel-name").value = baseName;
  importState.novelName = baseName;
  // 读取为 ArrayBuffer 以便编码检测
  const reader = new FileReader();
  reader.onload = () => {
    importState.fileBuf = reader.result;
    decodeAndPreview();
  };
  reader.onerror = () => alert("文件读取失败");
  reader.readAsArrayBuffer(file);
}

function decodeBuffer(buf, enc) {
  if (enc === "auto") {
    // 先尝试 UTF-8（严格模式），失败则用 GBK
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buf);
    } catch (e) {
      try {
        return new TextDecoder("gbk").decode(buf);
      } catch (e2) {
        return new TextDecoder("utf-8").decode(buf); // 最后兜底
      }
    }
  }
  return new TextDecoder(enc).decode(buf);
}

function decodeAndPreview() {
  importState.text = decodeBuffer(importState.fileBuf, importState.encoding);
  // 去掉 BOM
  if (importState.text.charCodeAt(0) === 0xFEFF) importState.text = importState.text.slice(1);
  renderImportPreview();
}

function parseBookText(text, mode) {
  const lines = text.split(/\r\n|\r|\n/);
  const volumes = [];   // { title, chapters: [{title, content}] }
  const chapters = [];  // 无卷时的独立章
  let preamble = [];    // 第一个标题前的内容
  let curVol = null;
  let curCh = null;
  let chCount = 0, volCount = 0;

  const pushContent = (line) => {
    if (curCh) curCh.content.push(line);
    else if (curVol) curVol.intro.push(line);
    else preamble.push(line);
  };

  for (let raw of lines) {
    const line = raw.replace(/\uFEFF/g, "");
    const trimmed = line.trim();
    let isVol = false, isCh = false, volTitle = "", chTitle = "";

    if (mode !== "none" && trimmed.length > 0 && trimmed.length <= MAX_HEADING_LEN) {
      if (mode !== "chapter") {
        const vm = trimmed.match(VOL_RE);
        if (vm) { isVol = true; volTitle = trimmed; }
      }
      if (!isVol) {
        const cm = trimmed.match(CH_RE);
        if (cm) { isCh = true; chTitle = trimmed; }
      }
    }

    if (isVol) {
      curVol = { title: volTitle, intro: [], chapters: [] };
      volumes.push(curVol);
      curCh = null;
      volCount++;
    } else if (isCh) {
      curCh = { title: chTitle, content: [] };
      if (curVol) curVol.chapters.push(curCh);
      else chapters.push(curCh);
      chCount++;
    } else {
      pushContent(line);
    }
  }

  // 清理内容：去掉首尾空行，合并连续空行
  const cleanContent = (arr) => {
    let t = arr.join("\n").replace(/^\s+|\s+$/g, "");
    t = t.replace(/\n{3,}/g, "\n\n");
    return t;
  };

  const result = { volumes: [], chapters: [], preamble: "", totalChars: 0 };
  result.preamble = cleanContent(preamble);

  if (mode === "none" || (volCount === 0 && chCount === 0)) {
    // 不拆分或没识别到标题：整本书作为一章
    const all = cleanContent(lines);
    result.preamble = "";
    result.chapters = [{ title: "正文", content: all }];
    result.totalChars = all.length;
    return result;
  }

  if (volCount > 0) {
    result.volumes = volumes.map(v => ({
      title: v.title,
      intro: cleanContent(v.intro),
      chapters: v.chapters.map(c => ({ title: c.title, content: cleanContent(c.content) })),
    }));
    // 卷外的独立章（出现在第一卷之前）也放进去
    if (chapters.length) result.chapters = chapters.map(c => ({ title: c.title, content: cleanContent(c.content) }));
  } else {
    result.chapters = chapters.map(c => ({ title: c.title, content: cleanContent(c.content) }));
  }

  // 统计字数
  result.totalChars = result.preamble.length;
  result.volumes.forEach(v => {
    result.totalChars += v.intro.length;
    v.chapters.forEach(c => result.totalChars += c.content.length);
  });
  result.chapters.forEach(c => result.totalChars += c.content.length);
  return result;
}

function renderImportPreview() {
  const parsed = parseBookText(importState.text, importState.splitMode);
  importState.parsed = parsed;
  const box = $("#import-preview");
  const volN = parsed.volumes.length;
  let chN = parsed.chapters.length;
  parsed.volumes.forEach(v => chN += v.chapters.length);

  let html = `<div class="imp-stat">识别到 ${volN} 卷、${chN} 章，正文约 ${parsed.totalChars.toLocaleString()} 字</div>`;
  if (volN === 0 && chN === 0 && importState.splitMode !== "none") {
    html += `<div class="imp-warn">未识别到卷/章标题，将作为单章导入。可尝试切换「仅按章拆分」或检查文本格式。</div>`;
  }
  const showCh = (c) => `<div class="imp-ch">📄 ${escapeHtml(c.title)} <span style="color:var(--text-sub)">（${c.content.length.toLocaleString()} 字）</span></div>`;
  parsed.volumes.forEach(v => {
    html += `<div class="imp-vol">📚 ${escapeHtml(v.title)} <span style="color:var(--text-sub);font-weight:normal">（${v.chapters.length} 章）</span></div>`;
    v.chapters.slice(0, 50).forEach(c => html += showCh(c));
    if (v.chapters.length > 50) html += `<div class="imp-ch">… 还有 ${v.chapters.length - 50} 章</div>`;
  });
  if (parsed.chapters.length) {
    if (volN > 0) html += `<div class="imp-vol">📚 （卷前章节）</div>`;
    parsed.chapters.slice(0, 50).forEach(c => html += showCh(c));
    if (parsed.chapters.length > 50) html += `<div class="imp-ch">… 还有 ${parsed.chapters.length - 50} 章</div>`;
  }
  box.innerHTML = html;
  $("#import-ok").disabled = !(chN > 0 || parsed.preamble.length > 0);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

async function doImportTxt() {
  const parsed = importState.parsed;
  if (!parsed) return;
  const novelName = ($("#import-novel-name").value || importState.novelName || "导入的小说").trim();

  // 创建小说节点
  const novel = makeNode("novel", novelName);
  let totalCh = 0, totalVol = 0;

  const makeCh = (c) => {
    const ch = makeNode("chapter", c.title);
    ch.content = c.content;
    totalCh++;
    return ch;
  };

  if (parsed.volumes.length > 0) {
    // 卷前独立章 + 前言 → 放进一个"正文"卷
    if (parsed.chapters.length || parsed.preamble) {
      const vol = makeNode("volume", "正文");
      if (parsed.preamble) vol.children.push(makeCh({ title: "前言", content: parsed.preamble }));
      parsed.chapters.forEach(c => vol.children.push(makeCh(c)));
      novel.children.push(vol);
      totalVol++;
    }
    parsed.volumes.forEach(v => {
      const vol = makeNode("volume", v.title);
      if (v.intro) vol.content = v.intro;
      v.chapters.forEach(c => vol.children.push(makeCh(c)));
      novel.children.push(vol);
      totalVol++;
    });
  } else {
    // 没有卷：所有章节包进一个"正文"卷
    const vol = makeNode("volume", "正文");
    if (parsed.preamble) vol.children.push(makeCh({ title: "前言", content: parsed.preamble }));
    parsed.chapters.forEach(c => vol.children.push(makeCh(c)));
    novel.children.push(vol);
    totalVol++;
  }

  (data.children = data.children || []).push(novel);
  novel._expanded = true;
  closeImportModal();
  markDirty();
  await saveData();
  renderTree();
  setStatus(`已导入《${novelName}》：${totalVol} 卷、${totalCh} 章`);
}

/* ==================================================================
 * 小说转剧本
 * ================================================================== */
const scriptState = {
  node: null, body: null, mode: "rule", result: "",
};

function openScriptModal(node, body) {
  scriptState.node = node;
  scriptState.body = body;
  scriptState.mode = "rule";
  scriptState.result = "";
  $("#script-source").textContent = `${node.name} · ${TYPE_META[node.type]?.label || node.type}`;
  $("#script-result").value = "";
  $("#script-status").textContent = "";
  $("#script-copy").disabled = true;
  $("#script-save").disabled = true;
  $$("#seg-script-mode button").forEach(b => b.classList.toggle("active", b.dataset.mode === "rule"));
  $("#script-hint").textContent = "规则识别：自动提取对白、说话人、动作描写和场景划分，无需联网。";
  $("#script-mask").classList.remove("hidden");
}
function closeScriptModal() { $("#script-mask").classList.add("hidden"); }

/* ---------- 规则识别 ---------- */
// 说话动词（多字优先，避免单字误判）
const SPEECH_VERBS = "说道|问道|笑道|喊道|叫道|骂道|吼道|答道|嚷道|劝道|答道|开口道|插话道|回答道|回应道|冷声道|沉声道|缓缓道|轻声道|低声道|高声道|大声道|微笑道|冷笑道|大笑道|怒道|喜道|惊道|奇道|续道|又道|再道|叹道|哼道|嘀咕道|嘟囔道|抱怨道|说道|说|问|喊|叫|骂|吼|答|劝|笑|叹|哼|嘀咕|嘟囔|抱怨|开口|回答|回应|告诉|道";
const PAREN_RE = /[（(]([^）)]{1,20})[）)][：:]?\s*$/;

// 人名后常接的动作动词（用于判断名字边界）
const ACTION_VERBS = "拉推拉走跑坐站蹲跪躺转回看望盯瞪眯听拿取抓放扔挥抬低点摇摆伸缩叹吸呼想皱咬抿张闭睁迈跨退进出上下靠迎追逃躲闪举握攥摸拍打敲撞提扛背抱搂扶牵擦抹洗倒喝吃嚼吞吐咳哭笑怒骂喊叫道说问答哼叹息喘愣怔沉默";

function extractName(str) {
  if (!str) return null;
  // 单字代词
  if (/^[他她它我你]$/.test(str)) return str;
  // 先试 2 字
  if (str.length >= 2) {
    const ch2 = str.charAt(2);
    if (str.length === 2 || ACTION_VERBS.includes(ch2) || /[，,。.！!？?：:、\s]/.test(ch2)) {
      return str.slice(0, 2);
    }
  }
  // 试 3 字
  if (str.length >= 3) {
    const ch3 = str.charAt(3);
    if (str.length === 3 || ACTION_VERBS.includes(ch3) || /[，,。.！!？?：:、\s]/.test(ch3)) {
      return str.slice(0, 3);
    }
  }
  // 试 4 字
  if (str.length >= 4) return str.slice(0, 4);
  return str.length >= 2 ? str.slice(0, 2) : null;
}

// 从「引号前的叙述」提取说话人：返回 {name, paren} 或 null
function extractSpeakerBefore(text) {
  let paren = "";
  let work = text.trim();
  let hadColon = /[：:]\s*$/.test(work);
  // 先处理括号提示：张三（冷笑）：
  const pm = work.match(PAREN_RE);
  if (pm) {
    paren = pm[1];
    work = work.slice(0, pm.index).trim();
  }
  // 情况一：以说话动词结尾
  const verbEndRe = new RegExp(`(?:${SPEECH_VERBS})[：:]?\\s*$`);
  if (verbEndRe.test(work)) {
    // 去掉末尾动词和冒号
    let stripped = work.replace(verbEndRe, "").trim();
    stripped = stripped.replace(/[，,。.！!？?：:、\s]+$/, "").trim();
    if (!stripped) return null;
    // 反复剥掉末尾的副词/情态描述
    const advRe = /(冷冷地?|淡淡(?:地)?|缓缓(?:地)?|轻声(?:地)?|低声(?:地)?|高声(?:地)?|大声(?:地)?|默默(?:地)?|悄悄(?:地)?|突然|忽然|笑[着了]?|哈哈大笑?|嘿嘿一笑?|冷笑(?:一声)?|微笑(?:着)?|皱眉(?:头)?|叹了口气?|顿了顿|想了想|沉吟(?:片刻|一会)?|犹豫(?:了一下)?|摇了摇头|点了点头|冷哼一声|清了清嗓子|勃然大怒|大喜|大惊|一怔|一愣|一喜|一惊|皱了皱眉|头也不回|下意识|不由自主|情不自禁|没好气|不耐烦|兴高采烈|得意洋洋|笑容满面|一脸严肃|沉声|厉声|正声|朗声|悄声|柔声|缓声|寒声|冷然|淡然|坦然|肃然|凛然|慢慢|迅速|连忙|急忙|赶紧|随即|继续|接着|这才|方才|终于|似乎|仿佛|好像|犹豫了?片刻?|沉默了?片刻?|思忖了?片刻?|考虑了?片刻?|开口|插话|回答|回应|告诉)$/;
    let prev, guard = 0;
    do {
      prev = stripped;
      stripped = stripped.replace(advRe, "").trim();
      stripped = stripped.replace(/[，,。.！!？?：:、\s]+$/, "").trim();
      guard++;
    } while (stripped && stripped !== prev && guard < 5);
    if (!stripped) return null;
    // 取最后一个逗号前的片段（名字在动作描述前）
    const commaIdx = stripped.lastIndexOf("，");
    const namePart = (commaIdx >= 0 ? stripped.slice(0, commaIdx) : stripped).trim();
    const name = extractName(namePart);
    if (name) return { name, paren };
    return null;
  }
  // 情况二：以冒号结尾但无动词（如 "张三皱眉："、"李四（冷笑）："、"李四："）
  if (hadColon || /[：:]\s*$/.test(work)) {
    let stripped = work.replace(/[：:]\s*$/, "").trim();
    stripped = stripped.replace(/[，,。.！!？?：:、\s]+$/, "").trim();
    if (!stripped) return null;
    const name = extractName(stripped);
    if (name) return { name, paren };
  }
  return null;
}

// 从「引号后的叙述」提取说话人：返回名字或 null
function extractSpeakerAfter(text) {
  let work = text.trim();
  work = work.replace(/^[，,。.！!？?：:、\s]+/, "");
  // 名字（非贪婪，优先短名字）+ 可选副词 + 说话动词
  const re = new RegExp(`^([\\u4e00-\\u9fa5A-Za-z·]{1,4}?)(?:[\\u4e00-\\u9fa5]{0,6}?)(?:${SPEECH_VERBS})`);
  const m = work.match(re);
  if (m) {
    let name = m[1];
    if (name.length === 1 && !/^[他她它我你]$/.test(name)) {
      // 单字非代词，尝试扩展到 2 字
      const m2 = work.match(new RegExp(`^([\\u4e00-\\u9fa5A-Za-z·]{2,4}?)(?:[\\u4e00-\\u9fa5]{0,6}?)(?:${SPEECH_VERBS})`));
      if (m2) name = m2[1];
      else return null;
    }
    return name;
  }
  return null;
}

function ruleToScript(text) {
  const rawLines = text.split(/\n/);
  // 按空行分段
  const paragraphs = [];
  let buf = [];
  for (const line of rawLines) {
    if (line.trim() === "") {
      if (buf.length) { paragraphs.push(buf.join(" ").trim()); buf = []; }
    } else {
      buf.push(line.trim());
    }
  }
  if (buf.length) paragraphs.push(buf.join(" ").trim());

  const SCENE_HINT = /(房间里|屋中|屋内|室内|客厅|卧室|书房|院子里?|院中|花园里?|街上|街道上?|路上|村口|村里|城门处?|大殿内?|大殿之中|酒楼里?|客栈里?|茶馆里?|山巅|山顶|河边|湖边|林子里?|森林中?|洞穴内?|战场之上?|门口|门外|窗外|车中|马车里|船上|甲板上?|宫中|皇宫里?|府中|后院|前厅|牢房里?|天牢里?|城外|郊外|荒野之中?|夜色中|月光下|烛光下|灯火下|黄昏时分|清晨|黎明时分|正午时分|傍晚时分|深夜|半夜里?|午夜时分|凌晨|次日清晨|第二天早上|三日后|片刻之后|不久之后|与此同时|另一边|话说|镜头一转|场景一转|转场)/;

  const out = [];
  let sceneNum = 0;
  let lastSpeaker = null;

  const startScene = (title) => {
    sceneNum++;
    out.push("");
    out.push(`━━━ 第${sceneNum}场${title ? " · " + title : ""} ━━━`);
    out.push("");
  };
  startScene("");

  for (const para of paragraphs) {
    // 短段落且含场景关键词、无对白 → 新场景
    if (para.length <= 25 && SCENE_HINT.test(para) && !/[""「」]/.test(para)) {
      if (out.length > 3) startScene(para);
      continue;
    }

    // 提取引号对白（中文双引号 / 直角引号）
    const quoteRe = /[""「]([^""」]+)[""」]/g;
    const segs = [];
    let lastIdx = 0, m;
    while ((m = quoteRe.exec(para)) !== null) {
      const before = para.slice(lastIdx, m.index);
      if (before.trim()) segs.push({ t: "n", v: before.trim() });
      segs.push({ t: "d", v: m[1].trim() });
      lastIdx = m.index + m[0].length;
    }
    const after = para.slice(lastIdx);
    if (after.trim()) segs.push({ t: "n", v: after.trim() });

    if (segs.length === 0) {
      out.push(`△ ${para}`);
      out.push("");
      continue;
    }

    // 预处理：为每个对白段计算前后叙述中的说话人
    for (let i = 0; i < segs.length; i++) {
      if (segs[i].t !== "d") continue;
      // 前叙述
      if (i > 0 && segs[i-1].t === "n" && !segs[i-1].speaker) {
        const sp = extractSpeakerBefore(segs[i-1].v);
        if (sp) segs[i-1].speaker = sp;
      }
      // 后叙述
      if (i < segs.length-1 && segs[i+1].t === "n") {
        let sp = extractSpeakerAfter(segs[i+1].v);
        if (!sp) {
          // 启发式：NAME + 动作动词
          const am = segs[i+1].v.trim().match(
            new RegExp(`^[，,。.！!？?\\s]*([\\u4e00-\\u9fa5A-Za-z·]{2,4})(?=[${ACTION_VERBS}])`)
          );
          if (am) sp = am[1];
        }
        if (sp) segs[i+1].afterSpeaker = sp;
      }
    }

    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.t === "n") {
        const isBeforeD = i < segs.length - 1 && segs[i+1].t === "d";
        const isAfterD = i > 0 && segs[i-1].t === "d";
        let action = s.v;

        if (isBeforeD && s.speaker) {
          // 去掉末尾的说话人分句
          action = action.replace(new RegExp(`[，,]?\\s*[\\u4e00-\\u9fa5A-Za-z·]{1,4}(?:[^。！？\\n]{0,12}?)(?:${SPEECH_VERBS})[：:]?\\s*$`), "");
          action = action.replace(/[，,]?\s*[\u4e00-\u9fa5A-Za-z·]{1,4}\s*[（(][^）)]{1,20}[）)][：:]?\s*$/, "");
          action = action.replace(new RegExp(`[，,]?\\s*[\\u4e00-\\u9fa5A-Za-z·]{1,4}[：:]\\s*$`), "");
        }
        if (isAfterD && s.afterSpeaker) {
          // 去掉开头的说话人分句（动词型）
          action = action.replace(new RegExp(`^[，,。.！!？?\\s]*[\\u4e00-\\u9fa5A-Za-z·]{1,4}(?:[\\u4e00-\\u9fa5]{0,6}?)(?:${SPEECH_VERBS})[，,]?\\s*`), "");
          // 启发式：用检测到的名字精确去掉 "NAME动作动词，"
          if (extractSpeakerAfter(s.v) === null) {
            const name = s.afterSpeaker;
            action = action.replace(new RegExp(`^[，,。.！!？?\\s]*${name}[${ACTION_VERBS}][^，,。！？\\n]{0,8}[，,]?\\s*`), "");
          }
        }
        action = action.replace(/^[，,。.！!？?：:、\s]+|[，,。.！!？?：:\s]+$/g, "").trim();
        if (action) {
          out.push(`△ ${action}`);
          out.push("");
        }
      } else {
        // 对白：确定说话人
        let speaker = null, paren = "";
        if (i > 0 && segs[i-1].t === "n" && segs[i-1].speaker) {
          speaker = segs[i-1].speaker.name;
          paren = segs[i-1].speaker.paren || "";
        }
        if (!speaker && i < segs.length-1 && segs[i+1].t === "n" && segs[i+1].afterSpeaker) {
          speaker = segs[i+1].afterSpeaker;
        }
        if (!speaker) speaker = lastSpeaker || "（未知）";
        else lastSpeaker = speaker;

        out.push(`${speaker}${paren ? "（" + paren + "）" : ""}：`);
        out.push(`　　${s.v}`);
        out.push("");
      }
    }
  }

  let result = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return result;
}

/* ---------- AI 转换 ---------- */
async function aiToScript(text, nodeName) {
  if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
    throw new Error("AI 未配置，请先在「设置」中填写 API 地址、Key 和模型");
  }
  const sys = `你是专业编剧。把小说正文改写为标准中文剧本格式，要求：
1. 按情节划分场景，每场以「━━━ 第N场 · 场景名 ━━━」开头
2. 动作/环境/心理描写用「△ 」开头
3. 对白格式为「角色名：」换行后缩进两格写台词
4. 角色的表情动作用括号标注在角色名后，如「张三（冷笑）：」
5. 保留原文关键情节和台词，不要自行增删剧情
6. 只输出剧本文本，不要解释`;
  const res = await fetch("/api/ai/chat", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        { role: "system", content: sys },
        { role: "user", content: `章节：${nodeName}\n\n${text}` },
      ],
      temperature: 0.5, max_tokens: 4096,
    }),
  }).then(r => r.json());
  if (!res.ok) throw new Error(res.error || "AI 请求失败");
  return (res.content || "").trim();
}

/* ---------- 转换 / 复制 / 保存 ---------- */
async function convertScript() {
  const text = (scriptState.body?.innerText || scriptState.node?.content || "").trim();
  if (!text) { alert("当前章节没有内容"); return; }
  const btn = $("#script-convert");
  btn.disabled = true;
  $("#script-status").textContent = "转换中…";
  $("#script-result").value = "";
  try {
    if (scriptState.mode === "ai") {
      scriptState.result = await aiToScript(text, scriptState.node.name);
    } else {
      scriptState.result = ruleToScript(text);
    }
    $("#script-result").value = scriptState.result;
    $("#script-status").textContent = `完成，约 ${scriptState.result.length} 字`;
    $("#script-copy").disabled = false;
    $("#script-save").disabled = false;
  } catch (e) {
    $("#script-status").textContent = "转换失败";
    alert("转换失败：" + e.message);
  } finally {
    btn.disabled = false;
  }
}

function copyScript() {
  const text = $("#script-result").value;
  if (!text) return;
  navigator.clipboard?.writeText(text).then(
    () => setStatus("剧本已复制到剪贴板"),
    () => {
      // 兜底
      const ta = $("#script-result");
      ta.select(); document.execCommand("copy");
      setStatus("剧本已复制到剪贴板");
    }
  );
}

async function saveScript() {
  const text = $("#script-result").value;
  if (!text) return;
  const node = scriptState.node;
  // 剧本节点挂在父级（卷或章）下
  const parent = findParent(data, node);
  if (!parent) { alert("无法确定保存位置"); return; }
  const allowed = CHILDREN_ALLOWED[parent.type] || [];
  if (!allowed.includes("script")) {
    alert(`「${TYPE_META[parent.type]?.label}」下不能创建剧本节点`);
    return;
  }
  const scriptNode = makeNode("script", node.name + "（剧本）");
  scriptNode.content = text;
  (parent.children = parent.children || []).push(scriptNode);
  parent._expanded = true;
  closeScriptModal();
  markDirty();
  await saveData();
  renderTree();
  setStatus(`已保存剧本：${scriptNode.name}`);
}

function findParent(root, target) {
  let found = null;
  (function walk(list) {
    for (const n of list) {
      if ((n.children || []).includes(target)) { found = n; return; }
      walk(n.children || []);
    }
  })(root.children || []);
  return found;
}

init();
