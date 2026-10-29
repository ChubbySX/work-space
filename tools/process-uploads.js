#!/usr/bin/env node
// ============================================================
// process-uploads.js — Stage A「一键处理」：脱离 DSH 的规则流水线
// 读 待上传/_inbox.json 里 status=pending 的项 →
//   ① 分类（tag 直通 / 文件名关键词+已有照片相似度，无模型）
//   ② 压缩（compress_image.py / compress_video.ps1）
//   ③ 归位（content/daily|works，同名 _2 后缀；cover 写 <相册>/_cover.txt）
//   ④ 原图归档（待上传/已处理/）
//   ⑤ 配文补齐（缺同名 .txt 时以文件名为基线；Stage B 再升级为 AI 配文）
//   ⑥ 构建（make_posters / make_thumbs / build.js）
// 结果写 待上传/_process-report.json + 控制台汇总。零外部依赖，node 直接跑。
// 用法：node tools/process-uploads.js   （或双击 tools/process-uploads.bat）
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const REPO = path.resolve(__dirname, "..");
const WS = path.resolve(REPO, "..");            // work station 根（压缩脚本所在）
const UPLOAD = path.join(WS, "待上传");
const STAGE = path.join(WS, "待压缩");
const DONE = path.join(WS, "已压缩");
const ARCHIVE = path.join(UPLOAD, "已处理");
const CONTENT = path.join(REPO, "content");
const INBOX = path.join(UPLOAD, "_inbox.json");
const REPORT = path.join(UPLOAD, "_process-report.json");

const PY = fs.existsSync("C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe")
  ? "C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe" : "python";
const NODE = fs.existsSync("C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe")
  ? "C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe" : "node";

const IMG_RE = /\.(jpe?g|png|webp|bmp)/i;
const VID_RE = /\.(mp4|mov|mkv|avi|webm|gif)/i;
const EXT_RE = /\.(jpe?g|png|webp|bmp|mp4|mov|mkv|avi|webm|gif|heic|txt)$/i;

// 相册关键词词典（来自现有 71 张照片的命名习惯；以后再补新相册时加一行即可）
const ALBUM_KW = {
  "不爱出门的旅游": ["重庆", "洪崖洞", "旅游", "旅行", "上海", "车站", "景点", "民宿", "高铁", "五一", "景区"],
  "工作日记": ["工作", "工位", "师哥", "上班", "车间", "领导", "会议", "班车"],
  "美食就是好吃的意思！": ["吃", "饭", "面", "菜", "美食", "食堂", "海鲜", "面包", "奶茶", "火锅", "烧烤", "好吃", "咖啡"],
  "青岛在青理": ["青岛", "青理", "校园", "宿舍", "操场", "体测", "上课", "晚霞", "教室", "图书馆"],
  "实习是探索": ["实习", "探索", "培训", "学习"],
  "手工艺人": ["加工", "螺栓", "cnc", "数控", "齿轮", "波箱", "减速器", "螺丝", "拆波", "电机", "铣", "车床", "机械"],
  "我的小玩具们": ["玩具", "发射器", "波壳", "键盘", "键帽", "收纳盒", "水弹", "手办"],
  "我们都是“成功学长”": ["母校", "高中", "成功学长", "回母校", "同学"],
};
const WORKS_RE = /渲染|建模|blender|作品|导出|showreel|海报|成片|演示/i;

// ---------- 小工具 ----------
function readJson(p, fb) { try { return JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); } catch { return fb; } }
function writeUtf8(p, s) { fs.writeFileSync(p, s, "utf8"); }
function baseOf(f) { return f.replace(EXT_RE, ""); }
function extOf(f) { const m = f.match(/\.([A-Za-z0-9]+)$/); return m ? m[1].toLowerCase() : ""; }
function stripDate(n) { return n.replace(/^\d{4}[-_.]\d{1,2}[-_.]\d{1,2}\s*/, ""); }
function listDir(p) { try { return fs.readdirSync(p); } catch { return []; } }
function listDirs(p) { try { return fs.readdirSync(p, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { return []; } }

function scanAlbums() {
  return listDirs(path.join(CONTENT, "daily")).map(name => ({
    name,
    photos: listDir(path.join(CONTENT, "daily", name)).filter(f => IMG_RE.test(f)).map(baseOf),
  }));
}

// ---------- 无模型分类 ----------
// tag 直通优先级最高；无 tag（或 legacy "日常"）→ 文件名关键词 + 已有照片名相似度。
function classify(name) {
  const n = name.toLowerCase().replace(/\s+/g, "");
  if (WORKS_RE.test(n)) return "WORKS";
  const albums = scanAlbums();
  const nameClean = stripDate(baseOf(name)).toLowerCase();
  let best = null, bestScore = 0;
  for (const a of albums) {
    let score = 0;
    for (const k of (ALBUM_KW[a.name] || [])) if (n.includes(k.toLowerCase())) score += 1;
    for (const p of a.photos) {
      const pc = stripDate(p).toLowerCase();
      if (pc.length >= 3 && nameClean.length >= 3 && (pc.includes(nameClean) || nameClean.includes(pc))) score += 2;
    }
    if (score > bestScore) { bestScore = score; best = a.name; }
  }
  return bestScore > 0 ? best : null;
}

// ---------- 压缩 ----------
function run(cmd, args, cwd, timeoutMs) {
  const r = cp.spawnSync(cmd, args, { cwd, encoding: "utf8", timeout: timeoutMs, windowsHide: true });
  const tail = (r.stdout || "") + "\n" + (r.stderr || "");
  if (r.error) throw new Error(cmd + " 启动失败: " + r.error.message);
  if (r.status !== 0) throw new Error(cmd + " 退出码 " + r.status + "： " + tail.split("\n").filter(Boolean).slice(-3).join(" | "));
  return tail;
}

// 图片：stage 到 待压缩/<base>.<ext>（先清同名），跑脚本，从 已压缩 取 <base>.jpg|.webp
function compressImage(base, origFile) {
  const ext = extOf(origFile) || "jpg";
  for (const f of listDir(STAGE)) if (baseOf(f) === base) { try { fs.unlinkSync(path.join(STAGE, f)); } catch {} }
  for (const f of listDir(DONE)) if (baseOf(f) === base) { try { fs.unlinkSync(path.join(DONE, f)); } catch {} }
  fs.copyFileSync(path.join(UPLOAD, origFile), path.join(STAGE, base + "." + ext));
  run(PY, [path.join(WS, "compress_image.py")], WS, 300000);
  for (const e of [".jpg", ".webp"]) { const out = path.join(DONE, base + e); if (fs.existsSync(out)) return out; }
  throw new Error("压缩未产出 " + base + ".jpg/.webp");
}

// 视频：stage 到 待压缩/<base>.<ext>，跑 compress_video.ps1，取 已压缩/<base>.mp4
function compressVideo(base, origFile) {
  const ext = extOf(origFile) || "mp4";
  for (const f of listDir(STAGE)) if (baseOf(f) === base) { try { fs.unlinkSync(path.join(STAGE, f)); } catch {} }
  for (const f of listDir(DONE)) if (baseOf(f) === base) { try { fs.unlinkSync(path.join(DONE, f)); } catch {} }
  const staged = path.join(STAGE, base + "." + ext);
  fs.copyFileSync(path.join(UPLOAD, origFile), staged);
  run("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(WS, "compress_video.ps1"), "-InputPath", staged], WS, 60 * 60 * 1000);
  const out = path.join(DONE, base + ".mp4");
  if (!fs.existsSync(out)) throw new Error("视频压缩未产出 " + base + ".mp4");
  return out;
}

// 目标名去重（同名加 _2/_3…），不静默覆盖
function uniqueTarget(dir, base, ext) {
  let n = base, i = 2;
  while (fs.existsSync(path.join(dir, n + ext))) { n = base + "_" + i++; }
  return n;
}

// ---------- 主流程 ----------
function main() {
  const t0 = Date.now();
  const out = { ts: new Date().toISOString().slice(0, 19).replace("T", " "), ok: true, placed: [], unclassified: [], failed: [], build: null };
  if (!fs.existsSync(INBOX)) throw new Error("缺少 " + INBOX);
  const inbox = readJson(INBOX, null);
  if (!Array.isArray(inbox)) throw new Error("_inbox.json 损坏（非数组）");
  const items = inbox.filter(it => it && it.status === "pending" && it.file && !String(it.file).startsWith("已处理"));
  if (!items.length) { out.skipped = true; return out; }

  let placedAny = false, videoPlaced = false;
  for (const it of items) {
    const srcPath = path.join(UPLOAD, it.file);
    if (!fs.existsSync(srcPath)) { out.failed.push({ name: it.name || it.id, error: "文件不存在: " + it.file }); continue; }
    // 类型判定：文件名可能不带扩展名（桥接写的 <id>_<sn>），兜底查 origName/name
    const probe = [path.basename(srcPath), it.origName || "", it.name || ""].join(" ");
    const isVideo = VID_RE.test(probe);
    const isImage = !isVideo && IMG_RE.test(probe);
    if (!isVideo && !isImage) { out.failed.push({ name: it.name || it.id, error: "无法识别的文件类型" }); continue; }

    // ① 分类
    const tag = (it.tag || "").trim();
    let target; // {kind:'daily'|'video'|'image', dir, album}
    if (tag && tag !== "日常" && tag !== "作品") {
      target = { kind: "daily", dir: path.join(CONTENT, "daily", tag) };
    } else if (tag === "作品") {
      target = isVideo
        ? { kind: "video", dir: path.join(CONTENT, "works", "video") }
        : { kind: "image", dir: path.join(CONTENT, "works", "image") };
    } else {
      const cls = classify(it.origName ? baseOf(it.origName) : it.name || it.file);
      if (cls === "WORKS") {
        target = isVideo
          ? { kind: "video", dir: path.join(CONTENT, "works", "video") }
          : { kind: "image", dir: path.join(CONTENT, "works", "image") };
      } else if (cls) {
        target = { kind: "daily", dir: path.join(CONTENT, "daily", cls), album: cls };
      } else {
        out.unclassified.push(it.name || it.origName || it.file);
        continue; // 不归位、不归档，等人工定相册（或手机端选好 tag 重传）
      }
    }
    const base = baseOf(it.name && it.name.trim() ? it.name : (it.origName || it.file));
    if (!base) { out.failed.push({ name: it.id, error: "空文件名" }); continue; }

    // ② 压缩 → ③ 归位
    try {
      let comp, finalName;
      if (isVideo) {
        comp = compressVideo(base, it.file);
      } else {
        comp = compressImage(base, it.file);
      }
      const finalBase = baseOf(path.basename(comp));          // 对齐压缩产物名（含改名）
      const ext = path.extname(comp) || "";
      fs.mkdirSync(target.dir, { recursive: true });
      const fn = uniqueTarget(target.dir, finalBase, ext) + ext;
      fs.copyFileSync(comp, path.join(target.dir, fn));
      placedAny = true; if (isVideo) videoPlaced = true;

      // ⑤ 配文补齐（缺 .txt 时以文件名为基线）
      const txtP = path.join(target.dir, baseOf(fn) + ".txt");
      if (!fs.existsSync(txtP)) writeUtf8(txtP, baseOf(fn));

      // cover
      if (it.cover && target.kind === "daily") writeUtf8(path.join(target.dir, "_cover.txt"), baseOf(fn));

      // ④ 归档原图（扩展名可能不在文件名里，用 probe 得真实扩展名）
      fs.mkdirSync(ARCHIVE, { recursive: true });
      const arcExt = isVideo ? (extOf(probe) || "mp4") : (extOf(probe) || "jpg");
      let arcName = base + "." + arcExt;
      let ai = 2; while (fs.existsSync(path.join(ARCHIVE, arcName))) { arcName = base + "_" + ai++ + "." + arcExt; }
      fs.renameSync(srcPath, path.join(ARCHIVE, arcName));

      it.status = "processed"; it.file = "已处理/" + arcName;
      it.result = { target: (target.album || (target.kind === "daily" ? tag : target.kind)) + "/" + baseOf(fn) + ext };
      out.placed.push({ name: it.name || it.origName || it.file, target: it.result.target, cover: !!it.cover });
    } catch (e) {
      out.failed.push({ name: it.name || it.id, error: e.message });
    }
  }

  // ⑤b Stage B/C——AI 配文：新照片刚写了「文件名兜底」.txt，若有 AI 引擎则升级为 1-2 句配文 + 标签。
  //     AI_ENGINE=auto(默认, 本地 Ollama 在跑就走本地否则云端) / local(强制本地) / api(强制云端) / off(关闭)。
  //     无 key / 断网 / 上游限流时保留兜底，不阻断流程。
  if (placedAny && process.env.AI_CAPTION !== "off") {
    const eng = (process.env.AI_ENGINE || "auto").trim().toLowerCase();
    const aiArgs = [path.join(REPO, "tools", "ai-caption.js"), "--repo", REPO];
    if (eng === "local") aiArgs.push("--local");
    else if (eng !== "api") aiArgs.push("--prefer-local");
    try {
      const tail = eng === "off" ? "" : run(NODE, aiArgs, REPO, 600000);
      const m = tail.match(/成功 (\d+)/);
      out.aiCaption = { ok: true, engine: eng, changed: m ? Number(m[1]) : 0 };
    } catch (e) {
      out.aiCaption = { ok: false, engine: eng, error: e.message };
    }
  }

  // ⑥ 构建（有归位才跑）
  if (placedAny) {
    const b = {};
    if (videoPlaced) { try { run(PY, [path.join(REPO, "tools", "make_posters.py")], REPO, 300000); b.posters = "ok"; } catch (e) { b.posters = e.message; } }
    try { run(PY, [path.join(REPO, "tools", "make_thumbs.py")], REPO, 300000); b.thumbs = "ok"; } catch (e) { b.thumbs = e.message; }
    try { run(NODE, [path.join(REPO, "build.js")], REPO, 300000); b.build = "ok"; } catch (e) { b.build = e.message; }
    out.build = b;
  }

  fs.writeFileSync(INBOX, JSON.stringify(inbox, null, 2));
  out.elapsed = ((Date.now() - t0) / 1000).toFixed(1) + "s";
  return out;
}

// ---------- 出口 ----------
let report;
try {
  report = main();
} catch (e) {
  report = { ts: new Date().toISOString().slice(0, 19).replace("T", " "), ok: false, fatal: e.message, placed: [], unclassified: [], failed: [] };
}
try { writeUtf8(REPORT, JSON.stringify(report, null, 2)); } catch {}

// 控制台汇总
console.log("═══ 一键处理结果 ═══");
if (report.fatal) { console.log("❌ 致命错误: " + report.fatal); process.exit(1); }
if (report.skipped) { console.log("ℹ 没有待处理的上传（_inbox 无 pending）"); process.exit(0); }
console.log("已归位 " + report.placed.length + " 项:");
for (const p of report.placed) console.log("  ✓ " + p.name + " → " + p.target + (p.cover ? "（设封面）" : ""));
if (report.unclassified.length) console.log("⚠ 无法自动分类 " + report.unclassified.length + " 项（请手动指定相册或重传）:\n  " + report.unclassified.join("\n  "));
if (report.failed.length) {
  console.log("❌ 失败 " + report.failed.length + " 项:");
  for (const f of report.failed) console.log("  ✗ " + f.name + "：" + f.error);
}
if (report.build) console.log("构建: posters=" + report.build.posters + " thumbs=" + report.build.thumbs + " build.js=" + report.build.build);
console.log("用时 " + (report.elapsed || "?") + "，结果已写 _process-report.json");