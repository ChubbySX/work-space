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

// ---------- API 配置 ----------
const isLocal = flag("local", false) === true || flag("local", false) === "true";
const preferLocal = flag("prefer-local", false) === true || flag("prefer-local", false) === "true";
const AI_ENGINE = (process.env.AI_ENGINE || "").trim().toLowerCase(); // 可被 env 指定: auto / local / api（process-uploads 用）
let BASE = process.env.AI_BASE_URL || "https://api2.yunshuzhilian.asia/v1";
let MODEL = process.env.AI_MODEL || "deepseek-v4-flash";
const LOCAL_BASE = process.env.AI_LOCAL_BASE || "http://127.0.0.1:11434/v1";
const LOCAL_MODEL = process.env.AI_LOCAL_MODEL || "qwen2.5:3b";
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
      const bare = FORCE || isBareCaption(txt, base);
      needs.push({ album: alb, base, src: path.join(albDir, f), txtPath, bare });
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
async function captionOne(it) {
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
    max_tokens: 200,
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
function parse(text) {
  const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  let cap = [], tags = [];
  for (const ln of lines) {
    if (STRICT_TAGS && /^#/.test(ln)) tags.push(ln);
    else cap.push(ln);
  }
  let caption = cap.join(" ").trim().replace(/^["“”]+|["“”]+$/g, "");
  if (!caption && tags.length) caption = tags.shift().replace(/^#/, "");
  const tagStr = STRICT_TAGS && tags.length ? "\n" + tags.join("\n") : "";
  return caption + tagStr;
}

// ---------- 主流程 ----------
(async () => {
  // Stage C：--local / --prefer-local / AI_ENGINE 决定引擎；本地可用优先
  const wantLocal = isLocal || preferLocal || AI_ENGINE === "auto" || AI_ENGINE === "local";
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
    console.log("ℹ 没有需要配文的照片（全部已有合格配文；--force 可强制重写）。");
    process.exit(0);
  }
  if (!localActive && !KEY && !DRY) {
    console.error("✗ 找不到 API key：设 GLM12_API_KEY 环境变量，或把 key 写入 %LOCALAPPDATA%\\MobileBridge\\ai-key.json");
    process.exitCode = 3;
    return;
  }
  console.log("扫描: " + needs.length + " 张照片，需要配文: " + targets.length + "（相册 " + new Set(targets.map((t) => t.album)).size + " 个）  concurrency=" + CONC + "  dry=" + DRY);
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