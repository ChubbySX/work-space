/* 发布失败回滚后调用：仅同步 version.json → data.js（不递增版本号） */
const fs = require("fs");
const path = require("path");
const ROOT = path.dirname(path.dirname(__filename));
const vf = path.join(ROOT, "content", "version.json");
const jf = path.join(ROOT, "js", "data.js");
const ver = JSON.parse(fs.readFileSync(vf, "utf8")).version;
let txt = fs.readFileSync(jf, "utf8");
txt = txt.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${ver}"`);
fs.writeFileSync(jf, txt, "utf8");
console.log(`  data.js synced -> ${ver}`);
