#!/usr/bin/env node
/**
 * preflight.js — 发布前校验（#15）
 * 用法: node tools\preflight.js [--inbox <path>]
 * 在发布流程（阶段3 步骤3 之前）运行。阻塞项 exit 1，警告项仅打印。
 * 零依赖，node 标准库。
 */
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const inboxDefault = path.resolve(root, "..", "待上传", "_inbox.json");
const args = process.argv.slice(2);
let inboxPath = inboxDefault;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--inbox" && args[i + 1]) inboxPath = path.resolve(args[i + 1]);
}

let fail = 0;
const ok = (m) => console.log("  ✅ " + m);
const warn = (m) => console.log("  ⚠️  " + m);
const bad = (m) => { console.log("  ❌ " + m); fail++; };

console.log("── 发布前校验 ──");

// 1. 必需目录/文件存在
const needs = ["content/daily", "content/works", "content/.thumbs", "js", "js/data.js",
  "content/version.json", "content/changelog.json"];
for (const n of needs) {
  if (fs.existsSync(path.join(root, n))) ok(n);
  else bad("缺少 " + n);
}

// 2. 仓库根目录的临时/测试垃圾（发布会随 git add . 带上）
try {
  const junk = fs.readdirSync(root).filter((f) =>
    /^_v\d*\.html$/.test(f) || /^_bench.*\.mp4$/i.test(f) || /^_test.*\.(mp4|jpg)$/i.test(f)
  );
  if (junk.length) bad("根目录有测试/临时文件会被发布带进仓库: " + junk.join(", "));
  else ok("根目录无测试/临时文件");
} catch (e) { bad("读取根目录失败: " + e.message); }

// 3. 待上传 inbox 是否有 pending（阻塞项：有未处理内容却发布会漏内容）
if (fs.existsSync(inboxPath)) {
  try {
    const inbox = JSON.parse(fs.readFileSync(inboxPath, "utf8"));
    const pend = (inbox || []).filter((x) => x && x.status === "pending").length;
    if (pend) bad(`待上传还有 ${pend} 项 pending（手机上传未处理）`);
    else ok("待上传 0 pending");
  } catch (e) { warn("待上传 _inbox.json 读不了（" + e.message + "），已跳过"); }
} else {
  warn("找不到待上传 inbox（" + inboxPath + "），已跳过");
}

// 4. 每张 daily 照片都有 .txt 配文 + .thumbs 缩略图（警告项）
{
  const daily = path.join(root, "content/daily");
  let photos = 0, noTxt = 0, noThumb = 0;
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const full = path.join(dir, f);
      if (fs.statSync(full).isDirectory()) walk(full);
      else if (/\.(jpg|jpeg|webp|png|gif)$/i.test(f)) {
        photos++;
        const base = f.replace(/\.[^.]+$/, "");
        if (!fs.existsSync(path.join(dir, base + ".txt"))) noTxt++;
        // 相对 content/ 的路径 → content/.thumbs/<rel>.webp（与 build.js thumbFor 一致）
        const rel = path.relative(path.join(root, "content"), full).replace(/\\/g, "/");
        const th = path.join(root, "content/.thumbs", rel.replace(/\.[^.]+$/, "") + ".webp");
        if (!fs.existsSync(th)) noThumb++;
      }
    }
  };
  try { walk(daily); } catch (e) { bad("扫描 daily 失败: " + e.message); }
  if (photos) {
    ok(`${photos} 张 daily 照片`);
    if (noTxt) warn(`${noTxt} 张缺 .txt 配文`);
    if (noThumb) warn(`${noThumb} 张缺缩略图（跑一次 make_thumbs.py）`);
    if (!noTxt && !noThumb) ok("配文与缩略图齐全");
  }
}

// 5. version.json / changelog.json 可解析
for (const n of ["content/version.json", "content/changelog.json"]) {
  try { JSON.parse(fs.readFileSync(path.join(root, n), "utf8")); ok(n + " 合法"); }
  catch (e) { bad(n + " 不是合法 JSON: " + e.message); }
}

// 6. js/data.js 是最新构建（比 content 下最新照片新）
{
  try {
    const dataJs = path.join(root, "js/data.js");
    let newestContent = 0;
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir)) {
        const full = path.join(dir, f);
        if (fs.statSync(full).isDirectory()) walk(full);
        else newestContent = Math.max(newestContent, fs.statSync(full).mtimeMs);
      }
    };
    walk(path.join(root, "content"));
    if (fs.statSync(dataJs).mtimeMs >= newestContent) ok("data.js 已是最新构建");
    else warn("data.js 比某些 content 文件旧（建议先跑 build.js）");
  } catch (e) { warn("data.js 时间比对失败: " + e.message); }
}

console.log(fail ? `── 校验失败：${fail} 项阻塞，请先处理 ──` : "── 校验通过，可以发布 ──");
process.exit(fail ? 1 : 0);
