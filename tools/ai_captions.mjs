#!/usr/bin/env node
/**
 * AI 批量配文生成 — 为 content/daily 里没有同名 .txt 的照片批量生成 1-2 句配文。
 *
 * 用法（在项目根跑）:
 *   node tools/ai_captions.mjs            # 全量补齐（缺 .txt 的照片）
 *   node tools/ai_captions.mjs --dry      # 只列出待配文清单，不调 API
 *   node tools/ai_captions.mjs --album=青岛在青理   # 只处理指定相册
 *   node tools/ai_captions.mjs --limit=20 # 最多处理 20 张（新照片进来时逐批补）
 *
 * 配置（环境变量，优先取 GLM12_API_KEY）:
 *   GLM12_API_KEY 或 DEEPSEEK_API_KEY      API key（缺则 --dry 可跑、真跑退出码 2）
 *   AI_CAPTION_BASE   默认 https://api2.yunshuzhilian.asia/v1（OpenAI 兼容 /chat/completions）
 *   AI_CAPTION_MODEL  默认 glm-5.2（可换 deepseek-chat 等）
 *
 * 输出: 每张照片旁写 <base>.txt（UTF-8 无 BOM，1-2 句，保留文件名里的 #标签 说明）。
 * 幂等: 已有 .txt 的照片跳过；已写过的不会再写。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DAILY = path.join(ROOT, "content", "daily");
const IMG_EXT = /\.(jpe?g|png|webp|gif)$/i;

const KEY = process.env.GLM12_API_KEY || process.env.DEEPSEEK_API_KEY || "";
const BASE = process.env.AI_CAPTION_BASE || "https://api2.yunshuzhilian.asia/v1";
const MODEL = process.env.AI_CAPTION_MODEL || "glm-5.2";
const BATCH = 12; // 每批张数（一次请求内拼多条）

const args = process.argv.slice(2);
const dry = args.includes("--dry");
const onlyAlbum = args.find((a) => a.startsWith("--album="))?.slice(8) || "";
const limit = parseInt(args.find((a) => a.startsWith("--limit="))?.slice(8) || "0", 10);

function listJobs() {
  const jobs = [];
  for (const alb of fs.readdirSync(DAILY)) {
    const d = path.join(DAILY, alb);
    if (!fs.statSync(d).isDirectory()) continue;
    if (onlyAlbum && alb !== onlyAlbum) continue;
    for (const f of fs.readdirSync(d)) {
      if (!IMG_EXT.test(f)) continue;
      const base = f.replace(IMG_EXT, "");
      if (!fs.existsSync(path.join(d, base + ".txt"))) jobs.push({ alb, base });
    }
  }
  return jobs;
}

async function askCaptions(items) {
  // items: [{alb, base, name}] — 组装成 prompt，要求返回 JSON {captions:[{name,text}]}
  const lines = items.map((it, i) => `${i + 1}. 相册《${it.alb}》 照片名「${it.base}」`);
  const prompt =
    "你是个人网站的照片配文助手。下面每张照片给出：照片名 + 所在相册。请为每张照片写一条 1-2 句的中文配文，" +
    "风格口语化、有生活气息，结合相册主题与照片名展开（不要编造照片里没有的具体细节，不要写「#标签」以外的格式）。" +
    "按相同编号返回严格 JSON：{\"captions\":[{\"name\":\"原照片名\",\"text\":\"配文\"}]}，只输出 JSON。\n\n" +
    lines.join("\n");
  const resp = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + KEY },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.9,
      response_format: { type: "json_object" },
    }),
  });
  if (!resp.ok) throw new Error(`API ${resp.status} ${(await resp.text()).slice(0, 200)}`);
  const data = await resp.json();
  const raw = data.choices?.[0]?.message?.content || "";
  const parsed = JSON.parse(raw.replace(/^```(json)?|```$/g, "").trim());
  return parsed.captions || [];
}

function writeTxt(d, base, text) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  fs.writeFileSync(path.join(d, base + ".txt"), clean, { encoding: "utf8" }); // node 默认无 BOM
}

const jobs = listJobs();
if (!jobs.length) {
  console.log("无需配文：content/daily 全部照片都已有 .txt。");
  process.exit(0);
}
const sliced = limit > 0 ? jobs.slice(0, limit) : jobs;
console.log(`待配文 ${jobs.length} 张（本次处理 ${sliced.length} 张）` + (dry ? "，dry-run 不调 API" : "，模型 " + MODEL));
for (const j of sliced) console.log("  " + j.alb + " / " + j.base);
if (dry) process.exit(0);
if (!KEY) {
  console.error("未找到 API key：设环境变量 GLM12_API_KEY（或 DEEPSEEK_API_KEY）后重跑。退出码 2。");
  process.exit(2);
}

let done = 0;
for (let i = 0; i < sliced.length; i += BATCH) {
  const batch = sliced.slice(i, i + BATCH);
  let caps = [];
  try {
    caps = await askCaptions(batch);
  } catch (e) {
    console.error("批次失败（跳过该批）: " + e.message);
    continue;
  }
  const byName = new Map(caps.map((c) => [String(c.name).trim(), String(c.text).trim()]));
  for (const j of batch) {
    const text = byName.get(j.base) || byName.get(j.base + ".jpg");
    if (!text) { console.log("  ✗ 未返回配文: " + j.alb + "/" + j.base); continue; }
    writeTxt(path.join(DAILY, j.alb), j.base, text);
    done++;
    console.log("  ✓ " + j.alb + "/" + j.base + ".txt <- " + text.slice(0, 40) + "…");
  }
}
console.log(`完成 ${done}/${sliced.length} 张。`);
