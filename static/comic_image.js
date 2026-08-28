/* ==================================================================
 * 漫画/图片提示词：将小说转换为 AI 图片生成提示词
 * 与漫剧提示词分开存储（comic_image.json vs comic_drama.json）
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
  let imgStyle = "anime";
  let converting = false;
  let externalText = "";
  let externalName = "";
  let prompts = [];

  /* ---------- 子标签切换 ---------- */
  function initSubtabs() {
    $$(".comic-subtab").forEach(btn => {
      btn.addEventListener("click", () => {
        $$(".comic-subtab").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        const tab = btn.dataset.subtab;
        $("#comic-drama-panel").classList.toggle("hidden", tab !== "drama");
        $("#comic-image-panel").classList.toggle("hidden", tab !== "image");
      });
    });
  }

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
    const sel = $("#img-novel");
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
    const sel = $("#img-chapter");
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
    const chVal = $("#img-chapter").value;
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
    const tag = $("#img-source-tag");
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
    updateSourceTag(); $("#img-file").value = "";
    setStatus("已移除外部文件");
  }

  /* ---------- 风格配置 ---------- */
  const STYLE_CONFIG = {
    anime: {
      name: "日系动漫",
      style: "anime style, cel shading, clean line art, vibrant colors, expressive eyes, detailed hair",
      quality: "masterpiece, best quality, ultra detailed, 8k",
    },
    guoman: {
      name: "国漫风格",
      style: "Chinese comic style, cinematic lighting, detailed backgrounds, semi-realistic, rich colors",
      quality: "masterpiece, best quality, ultra detailed, 8k, cinematic",
    },
    realistic: {
      name: "写实风格",
      style: "photorealistic, realistic, detailed skin texture, natural lighting, shallow depth of field",
      quality: "8k uhd, dslr, soft lighting, high quality, film grain, Fujifilm XT3",
    },
    oil: {
      name: "油画风格",
      style: "oil painting style, thick brushstrokes, rich texture, classical composition, dramatic lighting",
      quality: "masterpiece, museum quality, detailed brushwork, classical art",
    },
    watercolor: {
      name: "水彩风格",
      style: "watercolor painting, soft edges, translucent colors, delicate brushwork, light and airy",
      quality: "masterpiece, best quality, delicate watercolor, artistic",
    },
  };

  const NEGATIVE_PROMPT = "low quality, worst quality, blurry, deformed, bad anatomy, bad hands, missing fingers, extra fingers, mutated hands, poorly drawn face, ugly, duplicate, morbid, mutilated, out of frame, extra limbs, watermark, signature, text, logo";

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

  // 从文本中提取角色名
  function extractCharacters(text) {
    const nameRe = /(?:^|[，,。！？\n\s　])([\u4e00-\u9fa5]{2,3})[\u4e00-\u9fa5，,、：:\s]{0,10}?(?:道|说|问|答|叫|喊|笑|骂|吼|叹)/g;
    const count = {};
    let m;
    const skip = new Set(["缓缓", "淡淡", "轻声", "高声", "低声", "大声", "冷冷", "微微", "默默", "喃喃", "沉声", "厉声", "随即", "心中", "心里", "眼中", "眼里", "脸上", "手中", "手里", "身上", "脚下", "点头", "点点", "摇头", "转身", "抬头", "低头", "睁眼", "闭眼", "一声", "只听", "只见", "但见", "却说", "原来", "说着", "想着", "看着", "听着", "不禁", "不由", "暗自", "赶紧", "连忙", "急忙", "忽然", "突然", "众人", "大家", "人们", "旁人", "路人", "所有人", "他们", "她们", "我们", "你们"]);
    while ((m = nameRe.exec(text)) !== null) {
      let n = m[1];
      if (n.length === 3 && /[沉沉默思想看听说说道问答叫喊哭笑打骂走跑吃喝来去起坐站转抬低睁闭点摇挥迎上下出进退拿放给找等回过关开接送买卖读写画唱跳爬飞游骑推拉提踩踢抓握拍靠叹呼吸愣怒愁怕爱恨盼望瞪闪想思知道认识以为觉得]/.test(n[2])) {
        n = n.substring(0, 2);
      }
      if (!skip.has(n) && !/^[了着过不没是非有无可很最都也就还又再把被在从向对和跟与及或且而但如假若虽尽即哪那这你我他她它]/.test(n)) {
        count[n] = (count[n] || 0) + 1;
      }
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1]).map(([n]) => n).slice(0, 4);
  }

  // 推断场景环境
  function inferEnvironment(content) {
    let location = "室内场景";
    if (/山|林|野|外|街|路|河|海|天|云|风|雨|雪|城|村|镇|草原|沙漠|森林/.test(content)) location = "室外自然场景";
    if (/酒馆|客栈|店|堂|宫|殿|府|宅|楼|阁|亭|台|庙|寺|观|院|园/.test(content)) location = "建筑内部场景";
    if (/战场|战|厮杀|打斗|交锋|比武|擂台/.test(content)) location = "战斗场景";

    let timeOfDay = "白天";
    if (/夜|晚|暮|昏|星|月|灯|暗|深夜|夜晚/.test(content)) timeOfDay = "夜晚";
    if (/晨|早|曦|朝阳|日出|清晨/.test(content)) timeOfDay = "清晨";
    if (/黄昏|夕阳|落日|傍晚|暮色/.test(content)) timeOfDay = "黄昏";

    let weather = "晴朗";
    if (/雨|下雨|细雨|大雨|暴雨/.test(content)) weather = "下雨";
    if (/雪|下雪|雪花|大雪/.test(content)) weather = "下雪";
    if (/风|大风|狂风|微风/.test(content)) weather = "有风";
    if (/雾|雾气|浓雾|薄雾/.test(content)) weather = "有雾";

    return { location, timeOfDay, weather };
  }

  // 推断角色动作和表情
  function inferActionEmotion(content) {
    let action = "站立";
    if (/坐|坐下|坐着/.test(content)) action = "坐着";
    if (/站|站立|站着/.test(content)) action = "站立";
    if (/走|行走|步行|漫步/.test(content)) action = "行走";
    if (/跑|奔跑|飞奔|冲刺/.test(content)) action = "奔跑";
    if (/跳|跳跃|跃起/.test(content)) action = "跳跃";
    if (/跪|跪下|跪着/.test(content)) action = "跪下";
    if (/躺|躺下|躺着|卧/.test(content)) action = "躺着";
    if (/ fight|打|打斗|挥剑|拔刀|出招|攻击/.test(content)) action = "战斗姿态";

    let emotion = "平静";
    if (/笑|微笑|大笑|欢喜|开心|高兴/.test(content)) emotion = "微笑";
    if (/怒|愤怒|生气|咬牙|铁青|怒吼/.test(content)) emotion = "愤怒";
    if (/悲|伤|难过|哭泣|流泪|眼泪|哀伤/.test(content)) emotion = "悲伤";
    if (/惊|惊讶|震惊|吃惊|瞪大眼/.test(content)) emotion = "惊讶";
    if (/怕|恐惧|害怕|颤抖|发抖/.test(content)) emotion = "恐惧";
    if (/冷|冷淡|冷漠|面无表情|不动声色/.test(content)) emotion = "冷漠";
    if (/思|想|沉思|思索|皱眉/.test(content)) emotion = "沉思";

    return { action, emotion };
  }

  const COMPOSITIONS = ["close-up portrait", "upper body shot", "full body shot", "medium shot", "wide angle shot", "over-the-shoulder shot", "low angle shot", "high angle shot", "Dutch angle", "centered composition"];
  const LIGHTINGS = ["soft natural lighting", "dramatic side lighting", "backlit rim lighting", "golden hour lighting", "moonlight", "candlelight", "neon lighting", "studio lighting", "volumetric lighting", "cinematic lighting"];

  function generateRuleImagePrompt(scene, index, title) {
    const content = scene.content.join("\n").trim();
    if (!content) return null;

    const chars = extractCharacters(content);
    const env = inferEnvironment(content);
    const act = inferActionEmotion(content);
    const cfg = STYLE_CONFIG[imgStyle] || STYLE_CONFIG.anime;
    const composition = COMPOSITIONS[index % COMPOSITIONS.length];
    const lighting = LIGHTINGS[index % LIGHTINGS.length];

    // 构建角色描述
    let charDesc = "";
    if (chars.length) {
      charDesc = chars.slice(0, 2).map((c, i) => {
        const role = i === 0 ? "main character" : "secondary character";
        return `${role} ${c}, ${act.emotion} expression, ${act.action} pose`;
      }).join(", ");
    } else {
      charDesc = `a person, ${act.emotion} expression, ${act.action} pose`;
    }

    // 提取关键道具
    let props = "";
    if (/剑|刀|枪|弓|箭|武器/.test(content)) props += ", holding a weapon";
    if (/酒|杯|壶|茶/.test(content)) props += ", with drinkware";
    if (/书|卷|纸|笔/.test(content)) props += ", with books or scrolls";
    if (/花|树|叶|草/.test(content)) props += ", surrounded by nature elements";

    let prompt = `【画面 ${index + 1}】${scene.name}\n\n`;
    prompt += `【正向提示词】\n`;
    prompt += `${cfg.quality}, ${cfg.style}, ${composition}, ${lighting}\n`;
    prompt += `${charDesc}${props}\n`;
    prompt += `${env.location}, ${env.timeOfDay}, ${env.weather} atmosphere\n`;
    prompt += `detailed background, atmospheric perspective, depth of field\n\n`;
    prompt += `【负面提示词】\n${NEGATIVE_PROMPT}\n\n`;
    prompt += `【画面说明】\n`;
    prompt += `场景：${env.location}（${env.timeOfDay}，${env.weather}）\n`;
    prompt += `角色：${chars.length ? chars.join("、") : "未明确角色"}\n`;
    prompt += `动作：${act.action}，表情：${act.emotion}\n`;
    prompt += `构图：${composition}，光影：${lighting}\n`;
    prompt += `风格：${cfg.name}`;

    return {
      num: index + 1,
      title: scene.name,
      prompt: prompt,
      chars: content.length,
      characters: chars,
    };
  }

  function ruleConvert(text, title) {
    const scenes = splitTextToScenes(text);
    const results = [];
    let shotNum = 0;
    scenes.forEach((scene) => {
      const p = generateRuleImagePrompt(scene, shotNum, title);
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

    const cfg = STYLE_CONFIG[imgStyle] || STYLE_CONFIG.anime;

    const sys = `你是专业的 AI 图片提示词工程师。将小说片段转换为适合 AI 图片生成工具（如 Midjourney、Stable Diffusion、DALL-E）的画面提示词。

目标风格：${cfg.name}（${cfg.style}）

严格输出 JSON 数组，每个元素代表一张画面：
{
  "num": 画面序号,
  "title": "场景/画面标题",
  "prompt": "完整的生成提示词",
  "chars": 对应正文字数,
  "characters": ["角色名1", "角色名2"]
}

prompt 字段必须包含以下结构（用英文写提示词，用中文写画面说明）：
1. 【正向提示词】：画质词 + 风格词 + 构图 + 光影 + 角色外貌/服装/表情/动作 + 场景环境 + 背景细节
2. 【负面提示词】：需要避免的低质量元素
3. 【画面说明】：场景、角色、动作表情、构图、光影、风格的中文说明

要求：
- 按情节关键画面拆分，每张图一个核心视觉瞬间
- 角色外貌和服装要具体描述（发型、发色、瞳色、服装款式、配饰），保持一致性
- 画面描述要可视化、具体，避免抽象词汇
- 只输出 JSON 数组，不要解释文字`;

    const user = `小说《${title || "未命名"}》\n请将以下内容转换为 AI 图片生成提示词：\n${text}${truncated ? "\n\n（原文较长，以上为前半部分）" : ""}`;

    setStatus("AI 正在生成图片提示词…");
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
      return [{ num: 1, title: "全文", prompt: res.content, chars: text.length, characters: [] }];
    }
    return elements.filter(e => e && e.prompt).map(e => ({
      num: e.num || 0,
      title: e.title || "画面",
      prompt: String(e.prompt),
      chars: e.chars || 0,
      characters: Array.isArray(e.characters) ? e.characters : [],
    }));
  }

  /* ---------- 渲染 ---------- */
  function renderPrompts(list) {
    prompts = list || [];
    const editor = $("#img-editor");
    if (!prompts.length) { editor.innerHTML = ""; return; }
    editor.innerHTML = prompts.map(p => `
      <div class="comic-prompt">
        <div class="comic-prompt-header">
          <span class="comic-prompt-num">画面 ${p.num}</span>
          <span class="comic-prompt-title">${esc(p.title)}</span>
        </div>
        <div class="comic-prompt-body">${esc(p.prompt)}</div>
        <div class="comic-prompt-meta">
          <span>📝 ${p.chars} 字</span>
          ${p.characters && p.characters.length ? `<span>👤 ${p.characters.join("、")}</span>` : ""}
        </div>
      </div>
    `).join("");
  }

  /* ---------- 一句话生成提示词 ---------- */
  async function quickGenerate() {
    if (converting) return;
    const input = $("#img-quick-input");
    const sentence = input.value.trim();
    if (!sentence) { alert("请输入一句话描述"); input.focus(); return; }

    if (!settings.ai_base_url || !settings.ai_api_key || !settings.ai_model) {
      alert("AI 未配置，请先在设置中配置 AI 接口"); return;
    }

    const styleNames = { anime: "日漫风格", guoman: "国漫风格", realistic: "写实风格", oil: "油画风格", watercolor: "水彩风格" };
    const styleName = styleNames[imgStyle] || "日漫风格";

    converting = true;
    const btn = $("#btn-img-quick");
    btn.disabled = true; btn.textContent = "⏳ 生成中…";

    const sys = `你是专业的 AI 图片提示词工程师。根据用户的一句话描述，扩展为适合 AI 图片生成工具（如 Midjourney、Stable Diffusion、即梦）的详细图片生成提示词。

严格输出 JSON 数组，每个元素代表一张画面：
{
  "num": 画面序号,
  "title": "画面标题",
  "prompt": "完整的图片生成提示词",
  "chars": 描述字数,
  "characters": ["角色名1", "角色名2"]
}

prompt 字段必须包含以下结构（用中文）：
1. 主体描述：画面中的人物/物体、外貌、服装、姿态、表情
2. 场景环境：地点、时间、天气、背景细节
3. 构图镜头：景别（特写/半身/全身/全景）、视角、构图方式
4. 光影色彩：光线方向、色调、氛围、色彩搭配
5. 风格画质：画风、画质、细节程度、艺术风格
6. 负面提示：需要避免的元素

要求：
- 根据描述生成 1-4 张不同角度/构图的画面
- 描述要具体、可视化，避免抽象词汇
- 当前风格：${styleName}
- 只输出 JSON 数组，不要解释文字`;

    const user = `一句话描述：${sentence}\n\n风格：${styleName}\n\n请根据这句话扩展为详细的 AI 图片生成提示词。`;

    try {
      setStatus("AI 正在根据一句话生成图片提示词…");
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
        renderPrompts([{ num: 1, title: "生成结果", prompt: res.content, chars: sentence.length, characters: [] }]);
        setStatus("AI 返回非 JSON，已按纯文本显示");
        return;
      }
      const results = elements.filter(e => e && e.prompt).map(e => ({
        num: e.num || 0, title: e.title || "画面",
        prompt: String(e.prompt), chars: e.chars || 0,
        characters: Array.isArray(e.characters) ? e.characters : [],
      }));
      renderPrompts(results);
      setStatus(`一句话生成完成：${results.length} 张画面`);
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
    const btn = $("#btn-img-convert");
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
        setStatus(`图片提示词生成完成：${results.length} 张画面`);
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
    const name = prompt("请输入保存名称：", externalName || "图片提示词 " + new Date().toLocaleString());
    if (!name) return;
    try {
      const res = await fetch("/api/comic/image", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, prompts }),
      }).then(r => r.json());
      if (res.ok) {
        setStatus(`已保存到漫画图库：${name}`);
      } else {
        alert("保存失败：" + (res.error || "未知错误"));
      }
    } catch (e) {
      alert("保存失败：" + e.message);
    }
  }

  async function loadPrompts() {
    try {
      const res = await fetch("/api/comic/image").then(r => r.json());
      const items = (res && res.items) || [];
      if (!items.length) { alert("漫画图库为空"); return; }

      const list = items.map((it, i) => `${i + 1}. ${it.name}（${it.count}张，${it.created}）`).join("\n");
      const input = prompt(`请输入要加载的序号：\n\n${list}\n\n输入序号加载，输入 "d序号" 删除（如 d1）：`, "1");
      if (!input) return;

      const delMatch = input.match(/^d\s*(\d+)$/i);
      if (delMatch) {
        const idx = parseInt(delMatch[1]) - 1;
        if (idx < 0 || idx >= items.length) { alert("序号无效"); return; }
        if (!confirm(`确认删除「${items[idx].name}」？`)) return;
        const delRes = await fetch(`/api/comic/image/${items[idx].id}`, { method: "POST" }).then(r => r.json());
        if (delRes.ok) { setStatus("已删除"); } else { alert("删除失败"); }
        return;
      }

      const idx = parseInt(input) - 1;
      if (isNaN(idx) || idx < 0 || idx >= items.length) { alert("序号无效"); return; }
      renderPrompts(items[idx].prompts);
      externalName = items[idx].name;
      setStatus(`已加载：${items[idx].name}（${items[idx].count}张）`);
    } catch (e) {
      alert("加载失败：" + e.message);
    }
  }

  /* ---------- 复制/导出 ---------- */
  function getAllText() {
    if (!prompts.length) return "";
    return prompts.map(p =>
      `===== 画面 ${p.num}：${p.title} =====\n${p.prompt}\n`
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
    a.download = `${externalName || "图片提示词"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
    setStatus("已导出图片提示词 TXT");
  }

  /* ---------- 初始化 ---------- */
  function init() {
    initSubtabs();
    refreshNovelSelect();

    $("#img-novel").addEventListener("change", e => {
      currentNovelId = e.target.value; refreshChapterSelect();
    });
    $$("#img-mode-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#img-mode-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active"); convertMode = b.dataset.mode;
    }));
    $$("#img-style-seg button").forEach(b => b.addEventListener("click", () => {
      $$("#img-style-seg button").forEach(x => x.classList.remove("active"));
      b.classList.add("active"); imgStyle = b.dataset.style;
    }));
    $("#btn-img-convert").addEventListener("click", doConvert);
    $("#btn-img-quick").addEventListener("click", quickGenerate);
    $("#img-quick-input").addEventListener("keydown", e => {
      if (e.key === "Enter") quickGenerate();
    });
    $("#btn-img-save").addEventListener("click", savePrompts);
    $("#btn-img-load").addEventListener("click", loadPrompts);
    $("#btn-img-copy").addEventListener("click", copyAll);
    $("#btn-img-export").addEventListener("click", exportTxt);

    // 外部导入
    $("#btn-img-import").addEventListener("click", () => $("#img-file").click());
    $("#img-file").addEventListener("change", e => {
      if (e.target.files[0]) loadExternalFile(e.target.files[0]);
    });

    // 拖拽
    const wrap = $("#img-wrap");
    const zone = $("#img-drop-zone");
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
