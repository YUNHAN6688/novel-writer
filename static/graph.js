/* ==================================================================
 * 关系图谱视图：2D / 3D 力导向图，纯 Canvas 实现，无外部依赖
 * ================================================================== */
(function () {
  "use strict";

  const canvas = document.getElementById("graph-canvas");
  const ctx = canvas.getContext("2d");
  const wrap = document.getElementById("graph-wrap");

  let nodes = [];
  let edges = [];
  let byId = {};
  let selectedId = null;
  let hoverId = null;
  let mode = "2d";
  let showLabels = true;
  let showStruct = true;
  let showSemantic = true;
  let autoRotate = true;
  let searchTerm = "";
  let enabledTypes = new Set();
  let currentNovelId = null;

  // 视图变换
  let scale = 1, ox = 0, oy = 0;
  // 3D 旋转
  let rotY = 0.4, rotX = 0.3;
  let dragging = null;       // 拖拽的节点 id
  let panStart = null;       // 画布平移起点
  let dragMoved = false;

  const DPR = Math.max(1, window.devicePixelRatio || 1);

  /* ---------- 画布尺寸 ---------- */
  function resize() {
    const r = wrap.getBoundingClientRect();
    canvas.width = r.width * DPR;
    canvas.height = r.height * DPR;
    canvas.style.width = r.width + "px";
    canvas.style.height = r.height + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);

  /* ---------- 构建图数据 ---------- */
  function walk(node, parent, out) {
    const id = getNodeId(node);
    const meta = TYPE_META[node.type] || { label: node.type, color: "#888" };
    const radius = node.type === "novel" ? 14 : node.type === "volume" ? 10
      : node.type === "chapter" ? 7 : node.type === "beat" ? 4 : 6;
    out.nodes.push({
      id, label: node.name || meta.label, type: node.type, color: meta.color,
      node, radius,
      x: (Math.random() - 0.5) * 400,
      y: (Math.random() - 0.5) * 400,
      z: (Math.random() - 0.5) * 600,
      vx: 0, vy: 0, vz: 0,
    });
    if (parent) {
      out.edges.push({ source: parent, target: id, kind: "struct" });
    }
    (node.children || []).forEach(c => walk(c, id, out));
  }

  function findEntityByName(name) {
    const target = name.trim().toLowerCase();
    let exact = null, partial = null;
    for (const n of nodes) {
      if (n.type === "novel" || n.type === "volume" || n.type === "chapter" || n.type === "beat") continue;
      const ln = (n.label || "").toLowerCase();
      if (ln === target) exact = n.id;
      else if (!partial && ln.includes(target)) partial = n.id;
    }
    return exact || partial;
  }

  function buildGraph() {
    nodes = [];
    edges = [];
    byId = {};
    if (!currentNovelId) return;
    const novel = findNode(currentNovelId);
    if (!novel) return;
    const out = { nodes: [], edges: [] };
    walk(novel, null, out);
    nodes = out.nodes;
    edges = out.edges;
    nodes.forEach(n => byId[n.id] = n);

    // 语义连线：拍的 links、[[双链]]、伏笔埋设/回收
    nodes.forEach(n => {
      if (n.type === "beat") {
        const links = Array.isArray(n.node.links) ? n.node.links : [];
        links.forEach(l => {
          if (!l) return;
          const tid = findEntityByName(String(l.target || l.name || l));
          if (tid) edges.push({ source: n.id, target: tid, kind: "semantic", label: l.rel || "关联" });
        });
        // [[实体名]]
        const content = n.node.content || "";
        const re = /\[\[([^\[\]]+)\]\]/g;
        let m;
        const seen = new Set();
        while ((m = re.exec(content)) !== null) {
          const tid = findEntityByName(m[1]);
          if (tid && !seen.has(tid)) { seen.add(tid); edges.push({ source: n.id, target: tid, kind: "semantic", label: "提及" }); }
        }
      }
      if (n.type === "foreshadow") {
        if (n.node.planted) {
          const p = byId[n.node.planted];
          if (p) edges.push({ source: n.id, target: p.id, kind: "semantic", label: "埋设" });
        }
        if (n.node.resolved) {
          const r = byId[n.node.resolved];
          if (r) edges.push({ source: n.id, target: r.id, kind: "semantic", label: "回收" });
        }
      }
    });

    // 初始化启用的类型
    if (enabledTypes.size === 0) {
      new Set(nodes.map(n => n.type)).forEach(t => enabledTypes.add(t));
    } else {
      // 保留仍存在的，新增的默认启用
      new Set(nodes.map(n => n.type)).forEach(t => enabledTypes.add(t));
    }
    renderFilters();
    updateStats();
    fitView();
  }

  /* ---------- 类型筛选 ---------- */
  function renderFilters() {
    const box = document.getElementById("graph-filters");
    box.innerHTML = "";
    const counts = {};
    nodes.forEach(n => counts[n.type] = (counts[n.type] || 0) + 1);
    Object.keys(counts).sort((a, b) => counts[b] - counts[a]).forEach(t => {
      const meta = TYPE_META[t] || { label: t, color: "#888" };
      const lab = document.createElement("label");
      lab.className = "gp-filter";
      lab.innerHTML = `<span class="gd-dot" style="background:${meta.color}"></span>
        <span>${meta.label}</span><span class="cnt">${counts[t]}</span>`;
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = enabledTypes.has(t);
      cb.style.marginLeft = "auto";
      cb.addEventListener("change", () => {
        if (cb.checked) enabledTypes.add(t); else enabledTypes.delete(t);
        updateStats();
      });
      lab.appendChild(cb);
      box.appendChild(lab);
    });
  }

  function updateStats() {
    const visNodes = nodes.filter(n => enabledTypes.has(n.type));
    const visIds = new Set(visNodes.map(n => n.id));
    const visEdges = edges.filter(e => visIds.has(e.source) && visIds.has(e.target));
    document.getElementById("graph-stats").textContent =
      `实体 ${visNodes.length} / ${nodes.length}　关系 ${visEdges.length}`;
  }

  /* ---------- 小说选择 ---------- */
  function refreshNovelSelect() {
    const sel = document.getElementById("graph-novel");
    const novels = ((data && data.children) || []).filter(n => n.type === "novel");
    const prev = currentNovelId;
    sel.innerHTML = novels.map(n =>
      `<option value="${getNodeId(n)}">${escapeHtml(n.name)}</option>`).join("");
    if (prev && novels.some(n => getNodeId(n) === prev)) {
      sel.value = prev;
      currentNovelId = prev;
    } else if (novels.length) {
      currentNovelId = getNodeId(novels[0]);
      sel.value = currentNovelId;
    } else {
      currentNovelId = null;
    }
  }

  /* ---------- 力导向模拟 ---------- */
  function tick() {
    if (nodes.length < 2) return;
    const cx = 0, cy = 0;
    const is3d = mode === "3d";
    const REP = is3d ? 4800 : 5200;
    const SPRING = 0.02;
    const LEN = is3d ? 85 : 70;
    const GRAV = is3d ? 0.008 : 0.012;
    const DAMP = 0.82;
    const visIds = new Set(nodes.filter(n => enabledTypes.has(n.type)).map(n => n.id));

    // 斥力（仅对可见节点）
    const arr = nodes.filter(n => visIds.has(n.id));
    for (let i = 0; i < arr.length; i++) {
      for (let j = i + 1; j < arr.length; j++) {
        const a = arr[i], b = arr[j];
        const dz = is3d ? (a.z - b.z) : 0;
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy + dz * dz + 0.01;
        const d = Math.sqrt(d2);
        const f = REP / d2;
        const fx = f * dx / d, fy = f * dy / d, fz = f * dz / d;
        a.vx += fx; a.vy += fy; a.vz += fz;
        b.vx -= fx; b.vy -= fy; b.vz -= fz;
      }
    }
    // 弹簧
    edges.forEach(e => {
      const a = byId[e.source], b = byId[e.target];
      if (!a || !b || !visIds.has(a.id) || !visIds.has(b.id)) return;
      const dz = is3d ? (b.z - a.z) : 0;
      let dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) + 0.01;
      const f = (d - LEN) * SPRING;
      const fx = f * dx / d, fy = f * dy / d, fz = f * dz / d;
      a.vx += fx; a.vy += fy; a.vz += fz;
      b.vx -= fx; b.vy -= fy; b.vz -= fz;
    });
    // 中心引力 + 阻尼 + 积分
    arr.forEach(n => {
      n.vx += (cx - n.x) * GRAV;
      n.vy += (cy - n.y) * GRAV;
      if (is3d) n.vz += (0 - n.z) * GRAV;
      if (n === dragging) { n.vx = 0; n.vy = 0; n.vz = 0; return; }
      n.vx *= DAMP; n.vy *= DAMP; n.vz *= DAMP;
      n.x += n.vx; n.y += n.vy; n.z += n.vz;
    });
  }

  /* ---------- 坐标变换 ---------- */
  function project(n) {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (mode === "3d") {
      const cy = Math.cos(rotY), sy = Math.sin(rotY);
      const cx = Math.cos(rotX), sx = Math.sin(rotX);
      const x1 = n.x * cy - n.z * sy;
      const z1 = n.x * sy + n.z * cy;
      const y1 = n.y * cx - z1 * sx;
      const z2 = n.y * sx + z1 * cx;
      const f = 900 / (900 + z2);
      return {
        x: W / 2 + ox + x1 * f * scale,
        y: H / 2 + oy + y1 * f * scale,
        r: n.radius * f * scale,
        depth: z2, f,
      };
    }
    return {
      x: W / 2 + ox + n.x * scale,
      y: H / 2 + oy + n.y * scale,
      r: n.radius * scale,
      depth: 0, f: 1,
    };
  }

  function unproject(sx, sy) {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    return { x: (sx - W / 2 - ox) / scale, y: (sy - H / 2 - oy) / scale };
  }

  /* ---------- 颜色工具 ---------- */
  function hexToRgb(hex) {
    const h = String(hex).replace("#", "");
    const n = parseInt(h.length === 3 ? h.split("").map(c => c + c).join("") : h, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function mix(c1, c2, t) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return `rgb(${Math.round(a.r + (b.r - a.r) * t)},${Math.round(a.g + (b.g - a.g) * t)},${Math.round(a.b + (b.b - a.b) * t)})`;
  }
  // 景深雾化：越远（depth 越大）越暗越透明
  function fogOf(depth) {
    if (mode !== "3d") return 1;
    return Math.max(0.22, Math.min(1, 1 - (depth + 150) / 950));
  }

  /* ---------- 绘制 ---------- */
  function draw() {
    const W = wrap.clientWidth, H = wrap.clientHeight;
    ctx.clearRect(0, 0, W, H);

    const visIds = new Set(nodes.filter(n => enabledTypes.has(n.type)).map(n => n.id));
    const proj = {};
    nodes.forEach(n => { if (visIds.has(n.id)) proj[n.id] = project(n); });

    const is3d = mode === "3d";

    // 边
    edges.forEach(e => {
      if (!showStruct && e.kind === "struct") return;
      if (!showSemantic && e.kind === "semantic") return;
      const a = proj[e.source], b = proj[e.target];
      if (!a || !b) return;
      const isSem = e.kind === "semantic";
      const isHi = selectedId && (e.source === selectedId || e.target === selectedId);
      const fog = is3d ? (fogOf(a.depth) + fogOf(b.depth)) / 2 : 1;
      ctx.globalAlpha = (isHi ? 0.95 : isSem ? 0.5 : 0.32) * fog;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      if (isSem) {
        ctx.strokeStyle = isHi ? "#e91e63" : "#e91e63";
        ctx.lineWidth = isHi ? 2 : 1;
        ctx.setLineDash([4, 4]);
      } else {
        ctx.strokeStyle = isHi ? "#7aa2f7" : "#8c96aa";
        ctx.lineWidth = isHi ? 2 : 1;
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    });

    // 节点（按深度排序，远的先画）
    const order = nodes.filter(n => visIds.has(n.id)).sort((a, b) => proj[a.id].depth - proj[b.id].depth);
    order.forEach(n => {
      const p = proj[n.id];
      const isSel = n.id === selectedId;
      const isHover = n.id === hoverId;
      const matchSearch = searchTerm && (n.label || "").toLowerCase().includes(searchTerm);
      const dimBySelect = selectedId && !isSel &&
        !edges.some(e => (e.source === selectedId && e.target === n.id) ||
                        (e.target === selectedId && e.source === n.id));
      const dimBySearch = searchTerm && !matchSearch;
      const fog = fogOf(p.depth);
      const baseAlpha = (dimBySelect || dimBySearch) ? 0.15 : fog;
      ctx.globalAlpha = baseAlpha;

      const r = Math.max(1.5, p.r);

      // 光晕
      if (isSel || isHover) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 6 * p.f, 0, Math.PI * 2);
        ctx.fillStyle = n.color + "55";
        ctx.fill();
      }

      if (is3d) {
        // 3D 球体：径向渐变模拟光照
        const grd = ctx.createRadialGradient(
          p.x - r * 0.35, p.y - r * 0.35, r * 0.1,
          p.x, p.y, r
        );
        grd.addColorStop(0, mix(n.color, "#ffffff", 0.55));
        grd.addColorStop(0.55, n.color);
        grd.addColorStop(1, mix(n.color, "#000000", 0.45));
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = grd;
        ctx.fill();
        // 高光点
        if (r > 3) {
          ctx.beginPath();
          ctx.arc(p.x - r * 0.32, p.y - r * 0.32, r * 0.18, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,255,255,0.55)";
          ctx.fill();
        }
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
      }

      if (isSel) {
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = "#fff";
        ctx.globalAlpha = baseAlpha;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }

      // 标签
      if (showLabels && r > 2.5 && (isSel || isHover || r > 5 * scale || matchSearch)) {
        const fs = Math.max(10, 12 * p.f);
        ctx.font = `${fs}px "Microsoft YaHei", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        const ty = p.y + r + 3;
        const tw = ctx.measureText(n.label).width;
        ctx.fillStyle = `rgba(0,0,0,${0.55 * fog})`;
        ctx.fillRect(p.x - tw / 2 - 3, ty - 1, tw + 6, fs + 3);
        ctx.fillStyle = `rgba(255,255,255,${fog})`;
        ctx.fillText(n.label, p.x, ty);
      }
      ctx.globalAlpha = 1;
    });
  }

  function loop() {
    tick();
    // 3D 自动旋转：非交互状态下缓慢转动
    if (mode === "3d" && autoRotate && !dragging && !panStart) {
      rotY += 0.0035;
    }
    draw();
    requestAnimationFrame(loop);
  }

  /* ---------- 命中检测 ---------- */
  function hitTest(sx, sy) {
    const visIds = new Set(nodes.filter(n => enabledTypes.has(n.type)).map(n => n.id));
    let best = null, bestD = Infinity;
    nodes.forEach(n => {
      if (!visIds.has(n.id)) return;
      const p = project(n);
      const d = Math.hypot(p.x - sx, p.y - sy);
      if (d < p.r + 6 && d < bestD) { best = n; bestD = d; }
    });
    return best;
  }

  /* ---------- 交互 ---------- */
  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  canvas.addEventListener("mousedown", (e) => {
    const p = canvasPos(e);
    const hit = hitTest(p.x, p.y);
    dragMoved = false;
    if (hit) {
      dragging = hit.id;
      if (mode === "3d") { rotY = rotY; } // 节点拖拽在 3D 下也允许
    } else {
      panStart = { x: p.x, y: p.y, ox, oy, ry: rotY, rx: rotX, btn: e.button };
    }
  });

  canvas.addEventListener("mousemove", (e) => {
    const p = canvasPos(e);
    if (dragging) {
      dragMoved = true;
      const n = byId[dragging];
      if (n) {
        if (mode === "3d") {
          const wp = unproject(p.x, p.y);
          n.x = wp.x; n.y = wp.y;
        } else {
          n.x = (p.x - wrap.clientWidth / 2 - ox) / scale;
          n.y = (p.y - wrap.clientHeight / 2 - oy) / scale;
        }
        n.vx = 0; n.vy = 0; n.vz = 0;
      }
    } else if (panStart) {
      dragMoved = true;
      if (mode === "3d" && panStart.btn === 2) {
        // 右键在 3D 下平移
        ox = panStart.ox + (p.x - panStart.x);
        oy = panStart.oy + (p.y - panStart.y);
      } else if (mode === "3d") {
        rotY = panStart.ry + (p.x - panStart.x) * 0.008;
        rotX = Math.max(-1.2, Math.min(1.2, panStart.rx + (p.y - panStart.y) * 0.008));
      } else {
        ox = panStart.ox + (p.x - panStart.x);
        oy = panStart.oy + (p.y - panStart.y);
      }
    } else {
      const hit = hitTest(p.x, p.y);
      hoverId = hit ? hit.id : null;
      canvas.style.cursor = hit ? "pointer" : "grab";
    }
  });

  window.addEventListener("mouseup", (e) => {
    if (dragging && !dragMoved) {
      selectNode(dragging);
    } else if (!dragging && panStart && !dragMoved) {
      // 点击空白：取消选择
      selectNode(null);
    }
    dragging = null;
    panStart = null;
  });

  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = canvasPos(e);
    const factor = e.deltaY < 0 ? 1.12 : 0.89;
    const newScale = Math.max(0.15, Math.min(4, scale * factor));
    const W = wrap.clientWidth, H = wrap.clientHeight;
    ox = p.x - W / 2 - (p.x - W / 2 - ox) * (newScale / scale);
    oy = p.y - H / 2 - (p.y - H / 2 - oy) * (newScale / scale);
    scale = newScale;
  }, { passive: false });

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  canvas.addEventListener("dblclick", (e) => {
    const p = canvasPos(e);
    const hit = hitTest(p.x, p.y);
    if (hit) { selectNode(hit.id); centerOn(hit.id); }
    else fitView();
  });

  function centerOn(id) {
    const n = byId[id];
    if (!n) return;
    if (mode === "3d") { ox = -n.x * scale; oy = -n.y * scale; }
    else { ox = -n.x * scale; oy = -n.y * scale; }
  }

  function fitView() {
    if (!nodes.length) { scale = 1; ox = 0; oy = 0; return; }
    const vis = nodes.filter(n => enabledTypes.has(n.type));
    if (!vis.length) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    vis.forEach(n => {
      minX = Math.min(minX, n.x - n.radius); maxX = Math.max(maxX, n.x + n.radius);
      minY = Math.min(minY, n.y - n.radius); maxY = Math.max(maxY, n.y + n.radius);
    });
    const W = wrap.clientWidth, H = wrap.clientHeight;
    const gw = maxX - minX + 80, gh = maxY - minY + 80;
    scale = Math.min(W / gw, H / gh, 2);
    ox = -(minX + maxX) / 2 * scale;
    oy = -(minY + maxY) / 2 * scale;
  }

  /* ---------- 详情面板 ---------- */
  function selectNode(id) {
    selectedId = id;
    const panel = document.getElementById("graph-detail");
    if (!id) { panel.classList.add("hidden"); return; }
    const n = byId[id];
    if (!n) { panel.classList.add("hidden"); return; }
    panel.classList.remove("hidden");
    const meta = TYPE_META[n.type] || { label: n.type, color: "#888" };
    document.getElementById("gd-type").textContent = meta.label;
    document.getElementById("gd-type").style.background = n.color;
    document.getElementById("gd-title").textContent = n.label;

    const neighbors = edges
      .filter(e => e.source === id || e.target === id)
      .map(e => {
        const otherId = e.source === id ? e.target : e.source;
        return { n: byId[otherId], kind: e.kind, label: e.label, dir: e.source === id ? "→" : "←" };
      })
      .filter(x => x.n);

    let desc = n.node.content || n.node.note || "";
    if (Array.isArray(n.node.tree_data)) desc = (desc ? desc + "\n" : "") + n.node.tree_data.join("\n");
    if (n.type === "foreshadow") {
      desc += desc ? "\n" : "";
      desc += `状态：${n.node.status === "resolved" ? "已回收" : "未回收"}`;
    }

    let html = "";
    if (desc && desc.trim()) {
      html += `<div class="gd-k">内容</div><div class="gd-desc">${escapeHtml(desc.trim())}</div>`;
    }
    if (n.type === "beat" && Array.isArray(n.node.links) && n.node.links.length) {
      html += `<div class="gd-k">关联实体</div>`;
      n.node.links.forEach(l => {
        html += `<div class="gd-rel"><span class="gd-dot" style="background:#e91e63"></span>${escapeHtml(l.target || "")}<span class="rel-tag">${escapeHtml(l.rel || "关联")}</span></div>`;
      });
    }
    html += `<div class="gd-section gd-k">关系（${neighbors.length}）</div>`;
    neighbors.slice(0, 60).forEach(x => {
      html += `<div class="gd-rel" data-id="${x.n.id}">
        <span class="gd-dot" style="background:${x.n.color}"></span>
        <span>${escapeHtml(x.n.label)}</span>
        <span class="rel-tag">${x.kind === "semantic" ? escapeHtml(x.label || "关联") : "结构"} ${x.dir}</span>
      </div>`;
    });
    if (neighbors.length > 60) html += `<div class="gd-k">…还有 ${neighbors.length - 60} 条</div>`;
    document.getElementById("gd-body").innerHTML = html;
    panel.querySelectorAll(".gd-rel[data-id]").forEach(el => {
      el.addEventListener("click", () => { selectNode(el.dataset.id); centerOn(el.dataset.id); });
    });
  }

  /* ---------- 工具栏事件 ---------- */
  function setMode(m) {
    mode = m;
    document.getElementById("gp-2d").classList.toggle("active", m === "2d");
    document.getElementById("gp-3d").classList.toggle("active", m === "3d");
    document.getElementById("gp-autorotate-wrap").style.display = m === "3d" ? "" : "none";
    document.getElementById("graph-hint").textContent = m === "3d"
      ? "左键拖拽旋转视角 · 右键拖拽平移 · 滚轮缩放 · 拖拽节点 · 单击查看关系"
      : "滚轮缩放 · 拖拽节点 · 单击查看关系 · 双击定位";
    if (m === "3d") {
      // 给节点一个 z 轴初速，让 3D 结构散开
      nodes.forEach(n => { n.vz += (Math.random() - 0.5) * 30; });
    }
    reheat();
  }
  document.getElementById("gd-close").addEventListener("click", () => selectNode(null));
  document.getElementById("gp-2d").addEventListener("click", () => setMode("2d"));
  document.getElementById("gp-3d").addEventListener("click", () => setMode("3d"));
  document.getElementById("gp-fit").addEventListener("click", fitView);
  document.getElementById("gp-reheat").addEventListener("click", reheat);
  document.getElementById("gp-autorotate").addEventListener("change", e => autoRotate = e.target.checked);
  document.getElementById("gp-labels").addEventListener("change", e => showLabels = e.target.checked);
  document.getElementById("gp-struct").addEventListener("change", e => showStruct = e.target.checked);
  document.getElementById("gp-semantic").addEventListener("change", e => showSemantic = e.target.checked);
  document.getElementById("graph-search").addEventListener("input", e => searchTerm = e.target.value.trim().toLowerCase());
  document.getElementById("graph-novel").addEventListener("change", e => {
    currentNovelId = e.target.value;
    enabledTypes = new Set();
    buildGraph();
  });

  function reheat() {
    nodes.forEach(n => {
      n.vx += (Math.random() - 0.5) * 20;
      n.vy += (Math.random() - 0.5) * 20;
      if (mode === "3d") n.vz += (Math.random() - 0.5) * 30;
    });
  }

  /* ---------- 工具 ---------- */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 对外刷新 ---------- */
  function refresh() {
    if (!document.getElementById("view-graph").classList.contains("active")) return;
    refreshNovelSelect();
    buildGraph();
  }
  document.addEventListener("novel:data-changed", refresh);
  document.addEventListener("novel:view-changed", (e) => {
    if (e.detail.view === "graph") { resize(); refresh(); }
  });

  // 初始化：渲染循环立即启动，数据就绪后构建图
  resize();
  document.getElementById("gp-2d").classList.add("active");
  requestAnimationFrame(loop);
  if (data && data.children) {
    refreshNovelSelect();
    buildGraph();
  } else {
    document.addEventListener("novel:ready", () => {
      refreshNovelSelect();
      buildGraph();
    });
  }
})();
