#!/usr/bin/env node
/* analyze_and_record.js —— 分析 git 暂存区改动，自动生成分点概述并记录到 changelog.json
   用法：node tools/analyze_and_record.js   （需先 git add .）*/
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CHANGLOG = path.join(ROOT, "content", "changelog.json");

/* 1. 读 git 暂存区改动（name-status：A新增/M修改/D删除）*/
let out = "";
try {
  out = execSync('git -c core.quotepath=false diff --cached --name-status',
    { cwd: ROOT, encoding: "utf8" });
} catch (e) { out = ""; }

const lines = out.trim().split("\n").filter(Boolean);
const c = { daily: 0, video: 0, image: 0, doc: 0, project: 0, profile: false, code: 0 };
for (const line of lines) {
  const m = /^([AMD])\s+"?(.+?)"?\s*$/.exec(line);
  if (!m) continue;
  const status = m[1], file = m[2];
  if (status === "D") continue;                 // 删除不计
  if (file.startsWith("content/daily/")) c.daily++;
  else if (file.startsWith("content/works/video/")) c.video++;
  else if (file.startsWith("content/works/image/")) c.image++;
  else if (file.startsWith("content/works/doc/")) c.doc++;
  else if (file.startsWith("content/projects/")) c.project++;
  else if (file === "content/profile.json") c.profile = true;
  else if (/\.(js|css|html|bat)$/.test(file) && !file.startsWith("content/")) c.code++;
}

/* 2. 生成分点概述（编号 + 具体描述）*/
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
if (c.code) points.push("修改了部分代码、调整了网页样式");
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
arr = arr.slice(0, 20);   // 保留最近 20 条
fs.writeFileSync(CHANGLOG, JSON.stringify(arr, null, 2) + "\n", "utf8");
console.log("已记录更新：" + date + " | " + summary);
