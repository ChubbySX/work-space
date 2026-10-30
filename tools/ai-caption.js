#!/usr/bin/env node
/*
 * ai-caption.js — Stage B (B1 档): 用 GLM API 批量生成照片配文（1-2 句 + #标签）
 *
 * 用法:
 *   node ai-caption.js [--repo <网站根>] [--album <相册名>] [--force] [--limit N]
 *                      [--dry-run] [--concurrency 2] [--no-tags]
 *
 * 默认行为: 扫描 repo 的 content/daily 各相册子目录里的照片，为「缺配文」或「配文=纯文件名兜底」的照片
 * 生成 1-2 句配文 + #标签，写同名 .txt（UTF-8 无 BOM）。
 *   --force      忽略已有配文，全部重新生成（小心：会覆盖手写/已生成的文案）
 *   --limit N    最多处理 N 张（演示/试跑用）
 *   --dry-run    只打印将处理哪些照片，不调用 API
 *   --album 名   只扫指定相册
 *
 * API 配置（按优先级）:
 *   1) 环境变量 GLM12_API_KEY（DSH 用的那把）
 *   2) 文件 %LOCALAPPDATA%\MobileBridge\ai-key.json（本地保存，不进 git）
 *   地址/模型: 环境变量 AI_BASE_URL（默认 https://api2.yunshuzhilian.asia/v1）、AI_MODEL（默认 glm-5.2）
 *
 * 输出: 成功 X 张 / 跳过 Y 张（已有配文）/ 失败 Z 张；退出码 0（有失败也 0，看日志）。
 */
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// ---------- 参数 ----------
const args = process.argv.slice(2);
function flag(name, def) {
  const i = args.indexOf("--" + name);
  if (i < 0) return def;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return true;
  return v;
}
const REPO = path.resolve(flag("repo", path.join(__dirname, "..")));
const ALBUM_ONLY = flag("album", "");
const FORCE = flag("force", false) === true || flag("force", false) === "true";
const LIMIT = parseInt(flag("limit", "0"), 10) || 0;
const DRY = flag("dry-run", false) === true || flag("dry-run", false) === "true";
const CONC = Math.min(8, parseInt(flag("concurrency", "2"), 10) || 2);
const STRICT_TAGS = flag("no-tags", false) !== true;
const POLISH = flag("polish", false) === true || flag("polish", false) === "true"; // 云端润色本地草稿
const TAGS_ONLY = flag("tags-only", false) === true || flag("tags-only", false) === "true"; // 名字当正文，AI 只补 #标签
const DRAFT_MARK = "#draft";

// ---------- API 配置 ----------
const isLocal = flag("local", false) === true || flag("local", false) === "true";
const preferLocal = flag("prefer-local", false) === true || flag("prefer-local", false) === "true";
const AI_ENGINE = (process.env.AI_ENGINE || "").trim().toLowerCase(); // 可被 env 指定: auto / local / api（process-uploads 用）
let BASE = process.env.AI_BASE_URL || "https://api2.yunshuzhilian.asia/v1";
let MODEL = process.env.AI_MODEL || "deepseek-v4.1-flash";
const LOCAL_BASE = process.env.AI_LOCAL_BASE || "http://127.0.0.1:11434/v1";
const LOCAL_MODEL = process.env.AI_LOCAL_MODEL || "qwen2.5vl:7b";
let VISION = true;                                     // 本地模型能否读图；AI_LOCAL_VISION=0 可关
function useLocal() { BASE = LOCAL_BASE; MODEL = LOCAL_MODEL; LOCAL_ACTIVE = true; }
let LOCAL_ACTIVE = isLocal || AI_ENGINE === "local"; // 请求时是否视为本地（决定 key 头是否需要）
async function localUp() {
  try {
    const r = await fetch(LOCAL_BASE.replace(/\/$/, "") + "/models", { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch { return false; }
}
function readKey() {
  if (process.env.GLM12_API_KEY && process.env.GLM12_API_KEY.trim()) {
    return process.env.GLM12_API_KEY.trim();
  }
  const kf = path.join(os.homedir(), "AppData", "Local", "MobileBridge", "ai-key.json");
  try {
    const raw = fs.readFileSync(kf, "utf8").trim();
    try { return JSON.parse(raw).key.trim(); } catch { return raw; }
  } catch { return ""; }
}
const KEY = readKey();

const IMG = /\.(jpe?g|png|webp|bmp)$/i;
const dailyDir = path.join(REPO, "content", "daily");
const ALBUM_DESC = "album_desc"; // 相册简介占位

// ---------- 工具 ----------
function listDir(d) { try { return fs.readdirSync(d, { encoding: "utf8" }); } catch { return []; } }
function readTxt(p) { try { return fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "").trim(); } catch { return ""; } }
function writeTxt(p, s) { fs.writeFileSync(p, s, "utf8"); } // UTF-8 无 BOM
function baseOf(f) { return f.replace(/\.[^.]+$/, ""); }
function isBareCaption(txt, base) {
  if (!txt) return true;
  const noTags = txt.replace(/#[\w\u4e00-\u9fa5]+/g, "").trim();
  if (!noTags) return true;
  return noTags.toLowerCase() === base.toLowerCase() || noTags.length <= 4;
}
function isDraft(txt) { return (txt || "").includes(DRAFT_MARK); }
function stripDraft(txt) { return (txt || "").replace(/\n?#draft\s*$/m, "").trim(); }

// ---------- 扫描 ----------
const needs = []; // {album, base, src, txtPath, bare}
function scan() {
  const albumNames = ALBUM_ONLY ? [ALBUM_ONLY] : listDir(dailyDir).filter((d) => fs.statSync(path.join(dailyDir, d)).isDirectory());
  for (const alb of albumNames) {
    const albDir = path.join(dailyDir, alb);
    if (!fs.existsSync(albDir)) { console.error("✗ 相册不存在: " + alb); process.exit(2); }
    const pics = listDir(albDir).filter((f) => IMG.test(f));
    for (const f of pics) {
      const base = baseOf(f);
      const txtPath = path.join(albDir, base + ".txt");
      const txt = readTxt(txtPath);
      // --polish 只挑本地草稿（带 #draft 标记）；--tags-only / 常规都只补「缺配文或纯文件名兜底」的照片
      //（手写配文一律不碰，绝不降级正文）
      let bare;
      if (POLISH) bare = isDraft(txt);
      else bare = FORCE || isBareCaption(txt, base);
      needs.push({ album: alb, base, src: path.join(albDir, f), txtPath, bare, existing: txt });
    }
  }
  return needs.filter((x) => x.bare);
}
const targets = scan();
if (LIMIT) targets.length = Math.min(targets.length, LIMIT);

// 相册简介 + 风格样例
function albumDesc(alb) { return readTxt(path.join(dailyDir, alb + ".txt")) || ""; }
function styleExamples(alb) {
  const picks = [];
  const albDir = path.join(dailyDir, alb);
  const cands = listDir(albDir).filter((f) => f.endsWith(".txt"));
  for (const f of cands) {
    if (picks.length >= 3) break;
    const t = readTxt(path.join(albDir, f));
    if (t && t.length > 14 && !isBareCaption(t, baseOf(f))) picks.push(t.replace(/\n/g, " "));
  }
  if (!picks.length) {
    // 全网随便挑三条像样的当风格参考
    for (const alb2 of listDir(dailyDir)) {
      if (picks.length >= 3) break;
      for (const f of listDir(path.join(dailyDir, alb2))) {
        if (!f.endsWith(".txt")) continue;
        const t = readTxt(path.join(dailyDir, alb2, f));
        if (t && t.length > 14) picks.push(t.replace(/\n/g, " "));
        if (picks.length >= 3) break;
      }
    }
  }
  return picks;
}

// ---------- 调用 API ----------
// 本地视觉模型：能直接读到照片，写「画面里真有的东西」，比只看文件名强得多。
// 走 Ollama 原生 /api/chat（/v1 兼容层对 images 与 think 的支持都不稳）。
// --tags-only：只看图给标签（正文=文件名），模型产出里取 # 标签即可（去重、去 #draft）。
function extractTags(text) {
  const seen = [];
  for (const m of (text.match(/#[^\s#]+/g) || [])) {
    const t = m.slice(1).replace(/#+$/, "");
    if (t && t !== "draft" && !seen.includes(t)) seen.push(t);
  }
  return seen.map((t) => "#" + t).join(" ");
}
async function captionLocalVision(it) {
  const desc = albumDesc(it.album) || "无";
  const ex = styleExamples(it.album);
  const sys = TAGS_ONLY
    ? "你是「ChubbySX 个人网站」的图片标签员。看清这张照片里真实存在的东西（场景、物件、光线、人物动作、细节）。" +
      "只输出 1-3 个 #中文标签（#英文可），用空格隔开，放在一行。不要任何解释、不要配文、不要标点以外的字符。"
    : "你是「ChubbySX 个人网站」的照片配文写手。先看清这张照片里真实存在的东西（场景、物件、光线、人物动作、细节），再据此写配文。" +
      "写 1-2 句中文，具体、生活化、有观察感（说出你看见了什么，而不是泛泛的抒情形容词），可带一点幽默或温情。" +
      "不要\"这张照片\"开头，不要引号，不要解释，不要复述指令。" +
      "然后换行，给 1-3 个 #标签。只输出配文和标签，绝对不要输出别的照片的内容。";
  const user =
    "相册：" + it.album + "\n" +
    "相册简介：" + desc + "\n" +
    "文件名：" + it.base + "（文件名只是提示，以你在画面里看到的为准）\n" +
    (ex.length ? "以下是同相册其它照片的配文，只用于体会语气和长度，禁止照抄、禁止输出它们的内容：\n" + ex.map((e, i) => (i + 1) + ". " + e).join("\n") + "\n" : "") +
    (TAGS_ONLY ? "\n只针对这一张照片，列出 1-3 个最能代表画面内容的 #标签。" : "\n只针对这一张照片，写出你实际看到的画面 + 1-2 句配文，再换行给 #标签。");
  let imgB64 = "";
  try { imgB64 = fs.readFileSync(it.src).toString("base64"); } catch (e) { throw new Error("读图失败: " + e.message); }
  const endpoint = LOCAL_BASE.replace(/\/+$/, "").replace(/\/v1$/, "") + "/api/chat";
  const payload = {
    model: MODEL,
    stream: false,
    options: { num_predict: TAGS_ONLY ? 100 : 400, temperature: TAGS_ONLY ? 0.5 : 0.75 },
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user, images: [imgB64] },
    ],
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(300000),
      });
      if (!res.ok) { lastErr = "HTTP " + res.status + " " + (await res.text()).slice(0, 160); await sleep(2000); continue; }
      const j = await res.json();
      const text = ((j.message && j.message.content) || "").trim();
      if (!text) { lastErr = "空回复"; await sleep(2000); continue; }
      if (TAGS_ONLY) {
        const tags = extractTags(text);
        return it.base + (tags ? "\n" + tags : "");
      }
      // 标记来源：本地视觉草稿，供 --polish 后续升级（build.js 会过滤掉不显示）
      const body = parse(text);
      return POLISH ? body : body + "\n#draft";
    } catch (e) { lastErr = String((e && e.message) || e); await sleep(2000); }
  }
  throw new Error(lastErr || "本地调用失败 ×3");
}

async function captionOne(it) {
  if (POLISH) return polishOne(it);
  if (LOCAL_ACTIVE && VISION) return captionLocalVision(it);
  if (TAGS_ONLY) return captionTagsOnly(it);
  const desc = albumDesc(it.album) || "无";
  const ex = styleExamples(it.album);
  const sys = "你是「ChubbySX 个人网站」的照片配文写手。每张照片给 1-2 句中文配文（具体、生活化、贴合文件名称本身，可带一点幽默或温情，不要\"这张照片\"开头，不要引号，不要解释）+ 换行 + 1-3 个 #标签。只输出这一张照片的配文和标签，绝对不要输出别的照片的配文，不要罗列多条，不要加\"照片：\"前缀。";
  const user =
    "相册：" + it.album + "\n" +
    "相册简介：" + desc + "\n" +
    "照片文件名：" + it.base + "\n" +
    (ex.length ? "以下是同相册其它照片的配文，只用于体会语气和长度，禁止照抄、禁止输出它们的内容：\n" + ex.map((e, i) => (i + 1) + ". " + e).join("\n") + "\n" : "") +
    "\n只针对「" + it.base + "」这一张，给出 1-2 句配文 + 换行 + #标签。";
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.8,
    max_tokens: 400,
  };
  let lastErr = "";
  const backoff = [5000, 10000, 20000, 40000];
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(BASE + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", ...(LOCAL_ACTIVE || !KEY ? {} : { authorization: "Bearer " + KEY }) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429) {
        lastErr = "上游限流(429)：" + (await res.text()).slice(0, 120);
        await sleep(backoff[Math.min(attempt, backoff.length - 1)]);
        continue;
      }
      if (!res.ok) {
        lastErr = "HTTP " + res.status + " " + (await res.text()).slice(0, 200);
        await sleep(2000);
        continue;
      }
      const j = await res.json();
      const text = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || "").trim();
      if (!text) { lastErr = "空回复"; await sleep(2000); continue; }
      return parse(text);
    } catch (e) { lastErr = String(e && e.message || e); await sleep(2000); }
  }
  throw new Error(lastErr || "调用失败 ×5");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- 云端 tags-only（--tags-only 且本地模型不可用）----------
// 正文=文件名，云端模型只看图补 1-3 个 #标签；失败抛错（调用方保留文件名兜底）。
async function captionTagsOnly(it) {
  const desc = albumDesc(it.album) || "无";
  const sys = "你是图片标签员。看清这张照片里真实存在的东西（场景、物件、光线、人物动作、细节）。" +
    "只输出 1-3 个 #标签（#中文或#英文），用空格隔开，放在一行。不要任何解释、不要配文、不要别的照片的内容。";
  const user =
    "相册：" + it.album + "\n" +
    "相册简介：" + desc + "\n" +
    "文件名：" + it.base + "（文件名只是提示，以你在画面里看到的为准）\n" +
    "\n只针对这一张照片，列出 1-3 个最能代表画面内容的 #标签。";
  let imgB64 = "";
  try { imgB64 = fs.readFileSync(it.src).toString("base64"); } catch (e) { throw new Error("读图失败: " + e.message); }
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user, images: [imgB64] },
    ],
    temperature: 0.5,
    max_tokens: 100,
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", ...(LOCAL_ACTIVE || !KEY ? {} : { authorization: "Bearer " + KEY }) },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120000),
      });
      if (res.status === 429) {
        lastErr = "上游限流(429)：" + (await res.text()).slice(0, 120);
        await sleep(5000);
        continue;
      }
      if (!res.ok) { lastErr = "HTTP " + res.status + " " + (await res.text()).slice(0, 200); await sleep(2000); continue; }
      const j = await res.json();
      const text = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
      if (!text) { lastErr = "空回复"; await sleep(2000); continue; }
      const tags = extractTags(text);
      return it.base + (tags ? "\n" + tags : "");
    } catch (e) { lastErr = String(e && e.message || e); await sleep(2000); }
  }
  throw new Error(lastErr || "云端补标签失败 ×3");
}

// ---------- 云端润色（--polish）----------
// 输入：本地草稿 + 照片 + 相册语境；输出：替换草稿的新配文，并去掉 #draft 标记。
// 用云端模型（更强）但只轻度改：保留原意与标签，把空泛描写换成具体观察。
async function polishOne(it) {
  if (!KEY) throw new Error("润色需要云端 API key（--polish 不走本地模型）");
  const desc = albumDesc(it.album) || "无";
  const draftRaw = stripDraft(it.existing);
  const draftTags = (draftRaw.match(/#[^\s#]+/g) || []).map((t) => t.slice(1)).filter((t) => t && t !== "draft");
  const draft = draftRaw.replace(/#[^\s#]+/g, "").trim();
  const sys = "你是中文文案编辑。用户有一张照片和一条\"本地小模型写的草稿配文\"，草稿往往空泛（比如只说繁华忙碌、目光所及皆美好）。" +
    "你的任务：看着照片，把这条草稿改得具体、有观察感、像真人写的。" +
    "硬性要求：必须把草稿里的空泛形容词（繁华、忙碌、美好、岁月、时光、青春、活力、越来越、祥和、宁静、格外醒目、灯火辉煌）换成照片里能看见的具体东西（招牌文字、建筑形状、车辆颜色、天气、路人的动作或衣服颜色、某样物的位置等）。" +
    "绝对不许编造画面里没有的东西：看不清的细节就去写构图里能确认的（比如\"楼挡住了一半天空\"\"右边那排灯比左边亮\"），宁可写得朴素也不能瞎猜。" +
    "保留原配文的语气。" +
    "不要解释、不要复述指令。输出格式：一行 1-2 句配文，换行，原样带上用户给的标签。";
  const user =
    "相册：" + it.album + "\n" +
    "相册简介：" + desc + "\n" +
    "文件名：" + it.base + "\n" +
    "草稿配文：" + draft + "\n" +
    "必须原样保留的标签：" + (draftTags.length ? draftTags.map((t) => "#" + t).join(" ") : "（无）") + "\n" +
    "\n看着照片，给出润色后的配文 + 标签。";
  let imgB64 = "";
  try { imgB64 = fs.readFileSync(it.src).toString("base64"); } catch (e) { throw new Error("读图失败: " + e.message); }
  const body = {
    model: MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user, images: [imgB64] },
    ],
    temperature: 0.7,
    max_tokens: 200,
  };
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(BASE + "/chat/completions", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer " + KEY },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(280000),
      });
      if (res.status === 429) {
        lastErr = "上游限流(429)：" + (await res.text()).slice(0, 120);
        await sleep([5000, 10000, 20000][Math.min(attempt, 2)]);
        continue;
      }
      if (!res.ok) { lastErr = "HTTP " + res.status + " " + (await res.text()).slice(0, 200); await sleep(2000); continue; }
      const j = await res.json();
      const text = ((j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "").trim();
      if (!text) { lastErr = "空回复"; await sleep(2000); continue; }
      // 润色完即视为成稿（不加 #draft）；但必须保住原标签，模型常把标签换掉
      const out = parse(text);
      const m = out.match(/#[^\s#]+/g) || [];
      const have = m.map((t) => t.slice(1));
      const missing = draftTags.filter((t) => !have.includes(t));
      return missing.length ? out + " " + missing.map((t) => "#" + t).join(" ") : out;
    } catch (e) { lastErr = String((e && e.message) || e); await sleep(2000); }
  }
  throw new Error(lastErr || "润色失败 ×3");
}
function parse(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let cap = [], tags = [];
  for (const ln of lines) {
    if (STRICT_TAGS && /^#/.test(ln)) tags.push(ln);
    else cap.push(ln);
  }
  let caption = cap.join(" ").trim().replace(/^["“”]+|["“”]+$/g, "");
  // 标签清洗：模型常输出 "#标签#" 或行内混排的 "#a #b"，统一拆成规范形式
  const cleanTags = [];
  for (const t of tags) {
    for (const m of t.match(/#[^\s#]+/g) || []) {
      const tag = m.slice(1);
      if (tag && tag !== "draft" && !cleanTags.includes(tag)) cleanTags.push(tag);
    }
  }
  if (!caption && cleanTags.length) caption = cleanTags.shift();
  const tagStr = cleanTags.length ? "\n" + cleanTags.map((t) => "#" + t).join(" ") : "";
  return caption + tagStr;
}

// ---------- 主流程 ----------
(async () => {
  // Stage C：--local / --prefer-local / AI_ENGINE 决定引擎；本地可用优先
  // --polish 是云端任务，永远不启用本地引擎
  const wantLocal = !POLISH && (isLocal || preferLocal || AI_ENGINE === "auto" || AI_ENGINE === "local");
  let localActive = false;
  if (wantLocal) {
    const up = await localUp();
    if (up) { localActive = true; useLocal(); console.log("ℹ 本地模型可用 → " + MODEL); }
    else if (isLocal || AI_ENGINE === "local") {
      console.error("✗ --local 模式但 Ollama 未启动（" + LOCAL_BASE + "）。先启动 Ollama 再跑。");
      process.exitCode = 2;
      return;
    }
    else console.log("ℹ 本地模型未运行（11434 无响应），回落云端 API");
  }
  if (!targets.length) {
    console.log(POLISH
      ? "ℹ 没有待润色的草稿（带 #draft 标记的配文）。"
      : TAGS_ONLY
        ? "ℹ 没有需要补标签的照片（全部已有 #标签；--force 可强制重补）。"
        : "ℹ 没有需要配文的照片（全部已有合格配文；--force 可强制重写）。");
    process.exit(0);
  }
  if (!localActive && !KEY && !DRY) {
    console.error("✗ 找不到 API key：设 GLM12_API_KEY 环境变量，或把 key 写入 %LOCALAPPDATA%\\MobileBridge\\ai-key.json");
    process.exitCode = 3;
    return;
  }
  if (POLISH && !KEY && !DRY) {
    console.error("✗ 润色需要云端 API key（--polish 不走本地模型）");
    process.exitCode = 3;
    return;
  }
  console.log((POLISH ? "润色" : TAGS_ONLY ? "补标签" : "扫描") + ": " + needs.length + " 张照片，" + (POLISH ? "待润色草稿: " : TAGS_ONLY ? "待补标签: " : "需要配文: ") + targets.length + "（相册 " + new Set(targets.map((t) => t.album)).size + " 个）  concurrency=" + CONC + "  dry=" + DRY);
  let ok = 0, done = 0, fail = 0;
  const queue = targets.slice();
  async function worker() {
    while (queue.length) {
      const it = queue.shift();
      if (DRY) { console.log("· " + it.album + "/" + it.base + (it.bare ? "（需要）" : "（已有，--force）")); done++; continue; }
      try {
        const txt = await captionOne(it);
        if (!txt) throw new Error("空结果");
        writeTxt(it.txtPath, txt.replace(/^#/, "") ? txt : txt);
        console.log("[✓] " + it.album + "/" + it.base + ".txt ← \"" + txt.replace(/\n/g, "  ") + "\"");
        ok++;
      } catch (e) {
        console.error("[✗] " + it.album + "/" + it.base + ": " + (e && e.message || e));
        fail++;
      }
      done++;
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, targets.length) }, worker));
  console.log("完成: 成功 " + ok + " / 跳过或失败 " + fail + "（共 " + done + "）");
})().catch((e) => { console.error(e); process.exit(1); });