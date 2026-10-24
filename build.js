#!/usr/bin/env node
/* ============================================================
   build.js —— 扫描 content/ 文件夹，生成站点数据
   ------------------------------------------------------------
   用法：node build.js          （生成 js/data.js + data.json）
   原理：把文件放进下面的目录，运行一次即可自动上架：

     content/profile.json             个人资料（姓名/简介/联系方式…）
     content/avatar.svg|jpg|png       头像
     content/daily/*.jpg|png|webp|gif|svg|avif     日常照片
     content/works/video/*.mp4|webm|mov|avi|mkv    视频作品
     content/works/image/*.*                       图片作品
     content/works/doc/*.docx|doc|pdf|pptx|ppt|...  文档作品

   文件名规则（可选）：
     "2025-06-01 标题.jpg"        → 日期 + 标题
     "标题.jpg"                   → 仅标题
     同名的 .txt 文件（如 标题.txt）→ 作品描述
     视频同名前缀 .poster.jpg    → 视频封面
   ============================================================ */

"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const CONTENT = path.join(ROOT, "content");

const IMG_EXT = /\.(jpe?g|png|webp|gif|svg|avif|bmp|tiff?)$/i;
/* gif 也允许放在 video/ 里当“动画演示”占位（真实视频请用 mp4/webm/mov） */
const VIDEO_EXT = /\.(mp4|webm|mov|avi|mkv|m4v|gif)$/i;
const DOC_EXT = /\.(docx?|pdf|pptx?|xlsx?|txt|md|zip|rar|7z|odt|ods|odp)$/i;

/* ---------- 小工具 ---------- */
function listDir(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => !f.startsWith("."));
  } catch (e) {
    return [];
  }
}

function stat(file) {
  try {
    return fs.statSync(file);
  } catch (e) {
    return null;
  }
}

function isFile(file) {
  const s = stat(file);
  return s && s.isFile();
}

function readText(file) {
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch (e) {
    return "";
  }
}

/* 文件名 → { title, date }  （"2025-06-01 标题" / "2025-06-01_标题"） */
function parseName(file) {
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  const m = /^(\d{4}[-_.]\d{1,2}[-_.]\d{1,2})[\s_-]+(.+)$/.exec(base);
  if (m) {
    return { date: m[1].replace(/[-_.]/g, "-"), title: m[2] };
  }
  return { date: "", title: base };
}

function fmtSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / 1024 / 1024).toFixed(1) + " MB";
}

/* 同名的 .txt 描述、同名前缀 .poster.* 封面 */
function sidecar(file) {
  const dir = path.dirname(file);
  const base = path.basename(file).replace(/\.[^.]+$/, "");
  let desc = "";
  for (const ext of ["txt", "md"]) {
    const t = path.join(dir, base + "." + ext);
    if (isFile(t)) { desc = readText(t); break; }
  }
  // 从描述里提取 #标签（如 #机械 #建模），并从描述文本中移除
  const tags = [];
  if (desc) {
    const matches = desc.match(/#[^\s#]+/g);
    if (matches) matches.forEach((t) => { const tag = t.slice(1); if (!tags.includes(tag)) tags.push(tag); });
    desc = desc.replace(/#[^\s#]+/g, "").replace(/\s{2,}/g, " ").trim();
  }
  let poster = "";
  for (const ext of ["jpg", "jpeg", "png", "webp", "svg", "gif"]) {
    const p = path.join(dir, base + ".poster." + ext);
    if (isFile(p)) { poster = rel(p); break; }
  }
  return { desc, poster, tags };
}

function rel(p) {
  return path.relative(ROOT, p).split(path.sep).join("/");
}

/* ---------- 扫描日常（支持：单图 / 图片组专辑 / 视频+说明） ---------- */
function scanDaily() {
  const dir = path.join(CONTENT, "daily");
  const out = [];

  for (const f of listDir(dir)) {
    const full = path.join(dir, f);
    const s = stat(full);
    if (!s) continue;

    // 子文件夹 = 一组照片（专辑）
    if (s.isDirectory()) {
      const imgs = listDir(full).filter((x) => IMG_EXT.test(x));
      if (!imgs.length) continue;
      const { title, date } = parseName(f);
      const { desc } = sidecar(full); // 读“专辑名.txt”
      out.push({
        type: "album",
        files: imgs.map((x) => rel(path.join(full, x))),
        title,
        date,
        desc,
        size: imgs.length + " 张",
      });
      continue;
    }

    // 视频（gif 当作小动画演示）
    if (VIDEO_EXT.test(f)) {
      const { title, date } = parseName(f);
      const { desc, poster } = sidecar(full);
      out.push({
        type: "video",
        file: rel(full),
        title,
        date,
        desc,
        poster: poster || (/\.gif$/i.test(f) ? rel(full) : ""),
        size: fmtSize(s.size),
      });
      continue;
    }

    // 单图
    if (IMG_EXT.test(f)) {
      const { title, date } = parseName(f);
      const { desc } = sidecar(full);
      out.push({
        type: "image",
        src: rel(full),
        title,
        date,
        desc,
        size: fmtSize(s.size),
      });
    }
  }
  return out;
}

/* ---------- 扫描作品 ---------- */
function scanWorks() {
  const base = path.join(CONTENT, "works");
  const out = [];

  // 视频
  for (const f of listDir(path.join(base, "video"))) {
    if (!VIDEO_EXT.test(f)) continue;
    const full = path.join(base, "video", f);
    const { title, date } = parseName(f);
    const { desc, poster, tags } = sidecar(full);
    const s = stat(full);
    out.push({
      type: "video",
      file: rel(full),
      title,
      date,
      desc,
      tags,
      poster: poster || (/\.gif$/i.test(f) ? rel(full) : ""),
      size: s ? fmtSize(s.size) : "",
    });
  }

  // 图片
  for (const f of listDir(path.join(base, "image"))) {
    if (!IMG_EXT.test(f)) continue;
    const full = path.join(base, "image", f);
    const { title, date } = parseName(f);
    const { desc, tags } = sidecar(full);
    const s = stat(full);
    out.push({
      type: "image",
      file: rel(full),
      title,
      date,
      desc,
      tags,
      size: s ? fmtSize(s.size) : "",
    });
  }

  // 文档
  for (const f of listDir(path.join(base, "doc"))) {
    if (!DOC_EXT.test(f)) continue;
    const full = path.join(base, "doc", f);
    const { title, date } = parseName(f);
    const { desc, tags } = sidecar(full);
    const s = stat(full);
    out.push({
      type: "doc",
      file: rel(full),
      title,
      date,
      desc,
      tags,
      size: s ? fmtSize(s.size) : "",
    });
  }

  return out;
}

/* ---------- 读取资料 ---------- */
function readProfile() {
  const f = path.join(CONTENT, "profile.json");
  if (!isFile(f)) return {};
  try {
    return JSON.parse(readText(f));
  } catch (e) {
    console.error("⚠ content/profile.json 解析失败：" + e.message);
    return {};
  }
}

/* ---------- 扫描"我正在做的"项目（content/projects/*.json） ---------- */
function scanProjects() {
  const dir = path.join(CONTENT, "projects");
  return listDir(dir)
    .filter((f) => /\.json$/i.test(f))
    .map((f) => {
      const full = path.join(dir, f);
      try {
        const p = JSON.parse(readText(full));
        if (!p.name) p.name = f.replace(/\.json$/i, "");
        if (typeof p.progress !== "number") p.progress = 0;
        return p;
      } catch (e) {
        console.error("⚠ 项目解析失败 " + f + "：" + e.message);
        return null;
      }
    })
    .filter((p) => p && p.name);
}

/* ---------- 读取更新历史（content/changelog.json，取最近 5 条）---------- */
function readChangelog() {
  const f = path.join(CONTENT, "changelog.json");
  if (!isFile(f)) return [];
  try {
    const arr = JSON.parse(readText(f));
    if (!Array.isArray(arr)) return [];
    return arr.slice(0, 5).map(function (c) {
      return { date: String(c.date || ""), summary: String(c.summary || "") };
    });
  } catch (e) {
    console.error("⚠ content/changelog.json 解析失败：" + e.message);
    return [];
  }
}

/* ---------- 输出 ---------- */
function writeData(data) {
  const json = JSON.stringify(data, null, 2);

  fs.writeFileSync(path.join(ROOT, "data.json"), json, "utf8");

  // js/data.js：file:// 双击打开也能用
  const js = "/* 自动生成，请勿手改 —— 由 node build.js 生成 */\n" +
    "window.SITE_DATA = " + json + ";\n";
  fs.writeFileSync(path.join(ROOT, "js", "data.js"), js, "utf8");
}

/* ---------- 主流程 ---------- */
const profile = readProfile();
const works = scanWorks();
const daily = scanDaily();
const projects = scanProjects();
const changelog = readChangelog();

/* "我还想做的"清单从 profile.json 读取（统一在一个文件里管理） */
const wishlist = (profile.wishlist || []).map(function (item) {
  return {
    text: item.text || item.name || "",
    importance: Math.max(0, Math.min(5, Number(item.importance) || 0)),
    attraction: Math.max(0, Math.min(5, Number(item.attraction) || 0)),
  };
}).filter(function (item) { return item.text; });

/* 清除 profile 里的 _说明 注释字段（只用于 profile.json 内部，不输出到数据） */
Object.keys(profile).forEach(function (k) { if (k.startsWith("_")) delete profile[k]; });

/* 始终按实际内容自动统计（覆盖 profile.json 里的 stats） */
profile.stats = [
  { value: String(works.length), label: "件作品" },
  { value: String(daily.length), label: "条日常" },
  { value: String(projects.length), label: "个进行中" },
  { value: String((profile.tags || []).length), label: "个标签" },
];

const data = {
  profile,
  daily,
  works,
  projects,
  wishlist,
  changelog,
};

writeData(data);

console.log("✅ 构建完成：");
console.log("   日常       " + data.daily.length + " 条");
console.log("   作品       " + data.works.length + " 个（" +
  data.works.filter(w => w.type === "video").length + " 视频 / " +
  data.works.filter(w => w.type === "image").length + " 图片 / " +
  data.works.filter(w => w.type === "doc").length + " 文档）");
console.log("   项目       " + data.projects.length + " 个");
console.log("   清单       " + data.wishlist.length + " 条");
console.log("   更新历史   " + data.changelog.length + " 条");
console.log("   输出：data.json + js/data.js");
