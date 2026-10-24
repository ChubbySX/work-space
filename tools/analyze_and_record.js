#!/usr/bin/env node
/* analyze_and_record.js —— 分析 git 暂存区改动，生成具体分点概述并记录到 changelog.json */
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHANGLOG = path.join(ROOT, "content", "changelog.json");

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
const uniq = (a) => [...new Set(a)];

/* 1. 读暂存区改动（A新增/M修改/D删除）*/
let out = "";
try {
  out = execSync('git -c core.quotepath=false diff --cached --name-status',
    { cwd: ROOT, encoding: "utf8" });
} catch (e) { out = ""; }

const lines = out.trim().split("\n").filter(Boolean);
const c = { daily: 0, video: 0, image: 0, doc: 0, project: 0, profile: false,
  add: [], mod: [], del: [] };

for (const line of lines) {
  const m = /^([AMD])\s+"?(.+?)"?\s*$/.exec(line);
  if (!m) continue;
  const status = m[1], file = m[2];
  if (file.startsWith("content/daily/")) { if (status !== "D") c.daily++; }
  else if (file.startsWith("content/works/video/")) { if (status !== "D") c.video++; }
  else if (file.startsWith("content/works/image/")) { if (status !== "D") c.image++; }
  else if (file.startsWith("content/works/doc/")) { if (status !== "D") c.doc++; }
  else if (file.startsWith("content/projects/")) { if (status !== "D") c.project++; }
  else if (file === "content/profile.json") { if (status !== "D") c.profile = true; }
  else if (!file.startsWith("content/") && (/\.(js|css|html|bat)$/.test(file) || file === ".gitignore" || file === "README.md" || file === "data.json")) {
    const f = codeFunc(file);
    if (status === "A") c.add.push(f);
    else if (status === "M") c.mod.push(f);
    else if (status === "D") c.del.push(f);
  }
}

/* 2. 生成分点概述（具体到文件功能 + 动作）*/
const points = [];
if (c.daily || c.video) {
  const parts = [];
  if (c.daily) parts.push(c.daily + "张日常照");
  if (c.video) parts.push(c.video + "个视频");
  points.push("新增" + parts.join("+"));
}
if (c.image) points.push("增加了" + c.image + "张作品图");
if (c.doc) points.push("增加了" + c.doc + "份文档");
if (c.project) points.push("更新了" + c.project + "个项目");
if (c.profile) points.push("个人资料更新");
if (uniq(c.mod).length) points.push("调整了" + uniq(c.mod).join("、"));
if (uniq(c.add).length) points.push("新增了" + uniq(c.add).join("、"));
if (uniq(c.del).length) points.push("删除了" + uniq(c.del).join("、"));
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