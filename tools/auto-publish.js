#!/usr/bin/env node
// ============================================================
// auto-publish.js — T4 手机端「推新至线上」自动发布链（无人值守）
// 手机上传时勾选“推新至线上” → bridge /auto-process?publish=1 →
// 处理完（process-uploads.js）后由本脚本完成：analyze → build → bump → commit → push
//  1. git add（排除 .superpowers → 不把 DSH 工作记录入站）
//  2. 备份 content/changelog.json + content/version.json → *.bak
//  3. node tools/analyze_and_record.js   （写 changelog 条目）
//  4. node build.js                      （版本 c+1/d+1，data.js、index.html?v 更新）
//  5. python tools/bump_publish.py       （b+1 / c=0 / d-1，同步 data.js）
//  6. git add -A + commit '更新内容 <TS>'
//  7. powershell tools/github-push-gui.ps1 -Repo <repo> -NoGui（探活+推送，带重试）
// 失败不回滚、不阻断：内容+commit 留在本地，下次勾选发布会把未推送的一起补推。
// 输出最后一行契约：PUBLISH_OK version=<v> elapsed=<s>   /   PUBLISH_FAIL reason=...
// 用法：node tools/auto-publish.js --repo <网站根> [--dry-run]
// ============================================================
"use strict";
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const args = process.argv.slice(2);
function arg(name, def){
  const i = args.indexOf("--" + name);
  if (i < 0) return def;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) return true;
  return v;
}
const REPO = path.resolve(arg("repo", path.join(__dirname, "..")));
const DRY = arg("dry-run", false) === true || arg("dry-run", false) === "true";
const TOOLS = path.join(REPO, "tools");

const PY = fs.existsSync("C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe")
  ? "C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\python\\python.exe" : "python";
const NODE = fs.existsSync("C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe")
  ? "C:\\Users\\23003\\.dsh\\dsh-runtimes\\dsh-primary-runtime\\dependencies\\node\\bin\\node.exe" : "node";

function log(s){ console.log("[auto-publish] " + s); }
function run(cmd, a, timeoutSec){
  const r = cp.spawnSync(cmd, a, { cwd: REPO, encoding: "utf8", timeout: (timeoutSec || 600) * 1000, windowsHide: true });
  const tail = ((r.stdout || "") + "\n" + (r.stderr || "")).split("\n").filter(Boolean).slice(-3).join(" | ");
  if (r.error) throw new Error(cmd + " 启动失败: " + r.error.message);
  if (r.status !== 0) throw new Error(cmd + " 退出码 " + r.status + "： " + tail);
  return (r.stdout || "") + (r.stderr || "");
}
function git(a, allowNothing){
  const r = cp.spawnSync("git", a, { cwd: REPO, encoding: "utf8", timeout: 120000, windowsHide: true });
  const out = ((r.stdout || "") + "\n" + (r.stderr || "")).trim();
  if (r.status !== 0){
    if (allowNothing && /nothing to commit|no changes added/i.test(out)) return out;
    throw new Error("git " + a.slice(0, 4).join(" ") + " 退出码 " + r.status + "： " + out.split("\n").filter(Boolean).slice(-3).join(" | "));
  }
  return out;
}
function nowTs(){
  const d = new Date(); const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
function readVersion(){
  try { return (JSON.parse(fs.readFileSync(path.join(REPO, "content", "version.json"), "utf8")).version) || ""; }
  catch { return ""; }
}

(async () => {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(REPO, ".git"))) { console.log("PUBLISH_FAIL reason=非 git 仓库: " + REPO); process.exit(1); }
  log("仓库 " + REPO + (DRY ? "（dry-run 预览）" : ""));

  try {
    // 0. 预检：确保工作树没有让 git 卡死的状态（只读操作）
    git(["--version"]);
    git(["status", "--short"], false);

    if (DRY){
      log("DRY-RUN：仅预览将执行的步骤");
      log("  1. git add -A -- . :(exclude).superpowers");
      log("  2. 备份 changelog.json / version.json → .bak");
      log("  3. node tools/analyze_and_record.js");
      log("  4. node build.js");
      log("  5. " + PY + " tools/bump_publish.py");
      log("  6. git commit '更新内容 " + nowTs() + "'");
      log("  7. github-push-gui.ps1 -Repo <repo> -NoGui");
      console.log("PUBLISH_OK version=" + (readVersion() || "?") + " elapsed=" + (((Date.now()-t0)/1000).toFixed(1)) + "s（dry-run 未推送）");
      process.exit(0);
    }

    // 1. 暂存全部内容（排除 .superpowers 工作记录，避免入站）
    log("1/7 暂存内容（排除 .superpowers）…");
    git(["add", "-A", "--", ".", ":(exclude).superpowers"]);

    const contentDir = path.join(REPO, "content");
    const chg = path.join(contentDir, "changelog.json");
    const ver = path.join(contentDir, "version.json");
    // 2. 备份（发布失败回滚用；本次失败不回滚，但流程与手动发布对齐）
    log("2/7 备份 changelog/version → .bak");
    for (const f of [chg, ver]) if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");

    // 3. 记录更新历史
    log("3/7 analyze_and_record.js…");
    run(NODE, [path.join(TOOLS, "analyze_and_record.js")], 300);

    // 4. 构建（版本 c+1/d+1，重生成 data.js + index.html?v）
    log("4/7 build.js…");
    run(NODE, [path.join(REPO, "build.js")], 600);

    // 5. 版本号提升（b+1/c=0/d-1，同步 data.json/js/data.js）
    log("5/7 bump_publish.py…");
    run(PY, [path.join(TOOLS, "bump_publish.py")], 300);

    // 6. 提交（内容 + 版本变更一把提交，commit 格式对齐手动发布）
    log("6/7 git commit…");
    git(["add", "-A", "--", ".", ":(exclude).superpowers"], true);
    const vAfter = readVersion();
    git(["commit", "-m", "更新内容 " + nowTs()], true);

    // 7. 推送（github-push-gui.ps1 -NoGui：探活 443 + 带重试；失败不阻断）
    log("7/7 推送（github-push -NoGui）…");
    const ps = path.join(TOOLS, "github-push-gui.ps1");
    if (!fs.existsSync(ps)) throw new Error("缺少 tools/github-push-gui.ps1");
    const r = cp.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", ps, "-Repo", REPO, "-NoGui"],
      { cwd: REPO, encoding: "utf8", timeout: 20 * 60 * 1000, windowsHide: true });
    const pout = (r.stdout || "") + "\n" + (r.stderr || "");
    const last = pout.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" | ");
    const pushOk = r.status === 0 && /SUCCESS/.test(pout);
    const elapsed = (((Date.now() - t0) / 1000).toFixed(1)) + "s";
    if (!pushOk){
      log("推送失败：" + (last || ("exit " + r.status)));
      // 不回滚：内容+commit 留本地，下次勾选发布会把未推送的一起补推
      console.log("PUBLISH_FAIL reason=" + ("推送失败 " + (last || "exit " + r.status) + "（内容已留本地，下次勾选发布会补推）") + " elapsed=" + elapsed);
      process.exit(1);
    }
    console.log("PUBLISH_OK version=" + (vAfter || (readVersion() || "?")) + " elapsed=" + elapsed);
    process.exit(0);
  } catch (e) {
    console.log("PUBLISH_FAIL reason=" + String(e && e.message || e));
    process.exit(1);
  }
})();