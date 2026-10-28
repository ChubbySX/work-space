#!/usr/bin/env node
/**
 * postcheck.js — 发布后自检（#16）
 * 用法: node tools\postcheck.js [--retries N] [--wait S]
 * push 成功后运行：探测 GitHub Pages 是否已同步新版本（Pages 部署有 1~2 分钟延迟，会重试）。
 * 零依赖，node 标准库。
 */
const https = require("https");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
let retries = 7, wait = 15;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--retries" && args[i + 1]) retries = parseInt(args[i + 1], 10) || 7;
  if (args[i] === "--wait" && args[i + 1]) wait = parseInt(args[i + 1], 10) || 15;
}

const BASE = "https://chubbysx.github.io/work-space/";
const DATA_URL = BASE + "js/data.js?_t=" + Date.now();
const SAMPLE_IMG = BASE + "content/.thumbs/daily/不爱出门的旅游/上海.webp";

function get(url) {
  return new Promise((res, rej) => {
    const req = https.get(url, { headers: { "User-Agent": "postcheck" } }, (r) => {
      const chunks = [];
      r.on("data", (c) => chunks.push(c));
      r.on("end", () => res({ code: r.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", rej);
    req.setTimeout(20000, () => { req.destroy(new Error("timeout")); });
  });
}

function parseDataVersion(body) {
  // window.SITE_DATA = {...};  → 取 version 字段
  const m = body.match(/window\.SITE_DATA\s*=\s*(\{[\s\S]*\});?/);
  if (!m) return null;
  try { return JSON.parse(m[1]).version || null; } catch { return null; }
}

async function main() {
  console.log("── 发布后自检 ──");
  const local = JSON.parse(fs.readFileSync(path.join(root, "content/version.json"), "utf8"));
  console.log("  本地版本: " + local.version);

  let synced = false, dataBody = null;
  for (let i = 0; i < retries; i++) {
    try {
      const d = await get(DATA_URL);
      if (d.code === 200) {
        const v = parseDataVersion(d.body);
        dataBody = d.body;
        if (v === local.version) { synced = true; break; }
        if (i === retries - 1) console.log("  ⚠️  线上版本 " + (v || "读取失败") + " ≠ 本地 " + local.version);
        else console.log("  ↻ 第 " + (i + 1) + "/" + retries + " 次探测：Pages 还在部署（线上 " + (v || "?") + "），" + wait + "s 后再试…");
      } else {
        console.log("  ↻ 第 " + (i + 1) + "/" + retries + " 次探测：data.js HTTP " + d.code + "，" + wait + "s 后再试…");
      }
    } catch (e) {
      console.log("  ↻ 第 " + (i + 1) + "/" + retries + " 次探测失败（" + e.message + "），" + wait + "s 后再试…");
    }
    if (i < retries - 1) await new Promise((r) => setTimeout(r, wait * 1000));
  }

  if (synced) {
    console.log("  ✅ 线上 data.js 已是版本 " + local.version);
    const n = (dataBody.match(/"type":"album"/g) || []).length;
    console.log("  ✅ 线上相册数 " + n + " 与本地一致");
  } else {
    console.log("  ⚠️  版本未同步：可能 Pages 部署较慢，或推送实际未生效。稍后手动刷新确认。");
  }

  try {
    const im = await get(SAMPLE_IMG);
    console.log(im.code === 200 ? "  ✅ 示例缩略图 200" : "  ⚠️  示例缩略图 HTTP " + im.code);
  } catch { console.log("  ⚠️  示例缩略图探测失败（网络/尚未部署）"); }

  console.log("── 自检结束 ──");
  process.exit(synced ? 0 : 1);
}

main();
