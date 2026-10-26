#!/usr/bin/env node
/* analyze_and_record.js —— 分析 git 改动（暂存区优先，无则用最近提交），生成详细更新概述并记录到 changelog.json */
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHANGLOG = path.join(ROOT, "content", "changelog.json");

/* 判断暂存区是否有改动，没有则用 HEAD~1..HEAD */
function pickDiffBase() {
  try {
    const staged = execSync('git -c core.quotepath=false diff --cached --name-status',
      { cwd: ROOT, encoding: "utf8" }).trim();
    if (staged) return "--cached";
  } catch (e) {}
  return "HEAD~1 HEAD";
}
const DIFF_BASE = pickDiffBase();

/* 代码文件 → 功能描述 */
function codeFunc(file) {
  if (file === "index.html") return "网页结构";
  if (file === "css/style.css") return "网页样式";
  if (file === "js/main.js") return "页面交互逻辑";
  if (file === "js/data.js" || file === "data.json") return "站点数据";
  if (file === "build.js") return "构建脚本";
  if (file.startsWith("tools/")) return "工具脚本";
  if (file.endsWith(".bat")) return "发布脚本";
  if (file === ".gitignore") return "配置";
  if (file === "README.md") return "说明文档";
  return "代码";
}

/* 从文件路径提取短文件名（去掉目录前缀） */
function shortName(file) {
  const parts = file.split("/");
  return parts[parts.length - 1];
}

/* 从 git diff 中提取新增/删除的关键模式 */
function extractDiffPatterns(file) {
  let diff = "";
  try {
    diff = execSync('git -c core.quotepath=false diff ' + DIFF_BASE + ' -- "' + file + '"',
      { cwd: ROOT, encoding: "utf8", maxBuffer: 2 * 1024 * 1024 });
  } catch (e) { return { added: [], removed: [] }; }

  const added = [];
  const removed = [];

  // CSS 类名：以 + 开头且包含 .classname { 或 .classname.
  const cssClassRe = /^\+[^+].*?\.([a-zA-Z][\w-]*)\s*[\{,]/gm;
  const cssClassReRem = /^-[^-].*?\.([a-zA-Z][\w-]*)\s*[\{,]/gm;
  let m;
  // 新增的 CSS 类
  const addedClasses = new Set();
  const removedClasses = new Set();
  while ((m = cssClassRe.exec(diff)) !== null) addedClasses.add(m[1]);
  while ((m = cssClassReRem.exec(diff)) !== null) removedClasses.add(m[1]);
  // 只保留真正新增的（不在删除列表中的不算新增）
  for (const cls of addedClasses) {
    if (!removedClasses.has(cls)) added.push("." + cls);
  }
  for (const cls of removedClasses) {
    if (!addedClasses.has(cls)) removed.push("." + cls);
  }

  // JS 函数：function funcName 或 var funcName = function
  const funcRe = /^\+[^+].*?function\s+(\w+)/gm;
  const funcReRem = /^-[^-].*?function\s+(\w+)/gm;
  const addedFuncs = new Set();
  const removedFuncs = new Set();
  while ((m = funcRe.exec(diff)) !== null) addedFuncs.add(m[1]);
  while ((m = funcReRem.exec(diff)) !== null) removedFuncs.add(m[1]);
  for (const fn of addedFuncs) {
    if (!removedFuncs.has(fn)) added.push(fn + "()");
  }
  for (const fn of removedFuncs) {
    if (!addedFuncs.has(fn)) removed.push(fn + "()");
  }

  // HTML section/id：新增的 section 或带 id 的元素
  if (file === "index.html") {
    const sectionRe = /^\+[^+].*?<section[^>]*id="(\w+)"/gm;
    const sectionReRem = /^-[^-].*?<section[^>]*id="(\w+)"/gm;
    const addedSecs = new Set();
    const removedSecs = new Set();
    while ((m = sectionRe.exec(diff)) !== null) addedSecs.add(m[1]);
    while ((m = sectionReRem.exec(diff)) !== null) removedSecs.add(m[1]);
    for (const s of addedSecs) {
      if (!removedSecs.has(s)) added.push("#" + s + " 板块");
    }
    for (const s of removedSecs) {
      if (!addedSecs.has(s)) removed.push("#" + s + " 板块");
    }
  }

  // 截取前 5 个，避免太长
  return {
    added: [...new Set(added)].slice(0, 5),
    removed: [...new Set(removed)].slice(0, 5)
  };
}

/* 获取文件的行变动统计 */
function diffStat(file) {
  try {
    const stat = execSync('git -c core.quotepath=false diff ' + DIFF_BASE + ' --numstat -- "' + file + '"',
      { cwd: ROOT, encoding: "utf8" });
    const parts = stat.trim().split(/\s+/);
    if (parts.length >= 2) {
      return { add: parts[0] === "-" ? 0 : parseInt(parts[0]), del: parts[1] === "-" ? 0 : parseInt(parts[1]) };
    }
  } catch (e) {}
  return { add: 0, del: 0 };
}

const uniq = (a) => [...new Set(a)];

/* 1. 读暂存区改动（A新增/M修改/D删除）*/
let out = "";
try {
  out = execSync('git -c core.quotepath=false diff ' + DIFF_BASE + ' --name-status',
    { cwd: ROOT, encoding: "utf8" });
} catch (e) { out = ""; }

const lines = out.trim().split("\n").filter(Boolean);

/* 收集各类改动 */
const contentFiles = { daily: [], video: [], image: [], doc: [], project: [] };
const profileChanged = false;
const codeChanges = { add: [], mod: [], del: [] };

for (const line of lines) {
  const m = /^([AMD])\s+"?(.+?)"?\s*$/.exec(line);
  if (!m) continue;
  const status = m[1], file = m[2];
  if (file.startsWith("content/daily/")) { if (status !== "D") contentFiles.daily.push(shortName(file)); }
  else if (file.startsWith("content/works/video/")) {
    if (status !== "D" && /\.(mp4|webm|mov|avi|mkv|gif)$/i.test(file)) contentFiles.video.push(shortName(file));
  }
  else if (file.startsWith("content/works/image/")) { if (status !== "D") contentFiles.image.push(shortName(file)); }
  else if (file.startsWith("content/works/doc/")) { if (status !== "D") contentFiles.doc.push(shortName(file)); }
  else if (file.startsWith("content/projects/")) { if (status !== "D") contentFiles.project.push(shortName(file)); }
  else if (file === "content/profile.json") { codeChanges.mod.push({ func: "个人资料", file }); }
  else if (file === "content/changelog.json" || file === "content/version.json") { /* skip */ }
  else if (file === "content/hero-dusk.jpg" || file.startsWith("content/audio/")) {
    if (status !== "D") codeChanges.add.push({ func: "素材文件", file, detail: shortName(file) });
  }
  else if (!file.startsWith("content/") && (/\.(js|css|html|bat)$/.test(file) || file === ".gitignore" || file === "README.md" || file === "data.json")) {
    const func = codeFunc(file);
    if (status === "A") codeChanges.add.push({ func, file });
    else if (status === "M") codeChanges.mod.push({ func, file });
    else if (status === "D") codeChanges.del.push({ func, file });
  }
}

/* 2. 生成详细分点概述 */
const points = [];

// 内容文件：列出实际文件名
if (contentFiles.daily.length) {
  const names = contentFiles.daily.slice(0, 4).join("、");
  const more = contentFiles.daily.length > 4 ? " 等" + contentFiles.daily.length + "张" : "";
  points.push("新增日常照：" + names + more);
}
if (contentFiles.video.length) {
  const names = contentFiles.video.slice(0, 3).join("、");
  const more = contentFiles.video.length > 3 ? " 等" + contentFiles.video.length + "个" : "";
  points.push("新增视频：" + names + more);
}
if (contentFiles.image.length) {
  const names = contentFiles.image.slice(0, 4).join("、");
  const more = contentFiles.image.length > 4 ? " 等" + contentFiles.image.length + "张" : "";
  points.push("新增作品图：" + names + more);
}
if (contentFiles.doc.length) {
  points.push("新增文档：" + contentFiles.doc.join("、"));
}
if (contentFiles.project.length) {
  points.push("更新项目：" + contentFiles.project.join("、"));
}

// 代码文件修改：包含文件名 + 行数 + 具体改动
function describeCodeChange(change) {
  const stat = diffStat(change.file);
  const patterns = extractDiffPatterns(change.file);
  let desc = change.func + "（" + shortName(change.file);
  if (stat.add || stat.del) desc += " +" + stat.add + " -" + stat.del;
  desc += "）";
  // 添加具体改动描述
  const details = [];
  if (patterns.added.length) details.push("新增 " + patterns.added.join("、"));
  if (patterns.removed.length) details.push("移除 " + patterns.removed.join("、"));
  if (details.length) desc += "：" + details.join("，");
  if (change.detail) desc = change.func + "：" + change.detail;
  return desc;
}

if (codeChanges.mod.length) {
  const descs = codeChanges.mod.map(describeCodeChange);
  points.push("调整了 " + descs.join("；"));
}
if (codeChanges.add.length) {
  const descs = codeChanges.add.map(describeCodeChange);
  points.push("新增了 " + descs.join("；"));
}
if (codeChanges.del.length) {
  const descs = codeChanges.del.map(function (c) { return c.func + "（" + shortName(c.file) + "）"; });
  points.push("删除了 " + descs.join("、"));
}

let summary = points.map((p, i) => (i + 1) + "." + p).join("；");
if (!points.length) summary = "1.内容更新";

/* 3. 记录到 changelog.json */
const now = new Date();
const pad = (n) => String(n).padStart(2, "0");
const date = now.getFullYear() + "-" + pad(now.getMonth() + 1) + "-" + pad(now.getDate()) +
  " " + pad(now.getHours()) + ":" + pad(now.getMinutes());
let arr = [];
try { arr = JSON.parse(fs.readFileSync(CHANGLOG, "utf8")); } catch (e) {}
if (!Array.isArray(arr)) arr = [];
arr.unshift({ date, summary });
arr = arr.slice(0, 20);
fs.writeFileSync(CHANGLOG, JSON.stringify(arr, null, 2) + "\n", "utf8");
console.log("已记录更新：" + date + " | " + summary);
