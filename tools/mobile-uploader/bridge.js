// bridge.js — mobile-uploader bridge: pure node HTTP server (no deps)
// Multi-site: supports routing uploads/albums/thumbs per-site via ?site=<key>
// POST   /upload {origName,name,data(base64),tag,site}   legacy base64 path (fallback)
// POST   /upload_raw?name&tag&origName&site              binary body (fast path, progress-tracked)
// GET    /albums?site=<key>                              [{name, cover}] + fixedTags
// GET    /thumb?p=<rel>&site=<key>                       serve thumbnail
// GET    /history?site=<key>                             inbox items newest-first
// GET    /status?site=<key>                              summary
// GET    /info                                           {ips, port, token} for QR codes
// GET    /sites                                          [{key, name}] list of configured sites
// GET    /monitor-data                                   {inflight, recent, requests} polled by monitor
// GET    /monitor                                        desktop 监控窗 (QR + live uploads + delete)
// POST   /request {intent,text,site}                     手机端指令/发布请求
// GET    /requests?site=<key>                            pending 指令列表
// DELETE /monitor-item?id=<id>&site=<key>                remove staging file + inbox entry
// GET    /                               serve app/ (PWA)
// Mutations require: Authorization: Bearer <token>
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), os = require("os");
const cp = require("child_process");

const MAX_BODY = 12 * 1024 * 1024;   // base64 cap (legacy path)
const MAX_RAW  = 200 * 1024 * 1024;  // raw cap (videos OK)

// ---- live upload tracker (feeds the desktop monitor window) ----
const inflight = new Map(); // id -> {id,name,received,total,site}
const recent = [];          // [{id,name,tag,received,ts,site}] newest first
const RECENT_MAX = 30;
function trackStart(id, name, total, siteName){ inflight.set(id, { id, name, received: 0, total: total || 0, ts: Date.now(), site: siteName || "" }); }
function trackAdd(id, n){ const t = inflight.get(id); if (t) t.received += n; }
function trackDone(id, name, tag, received, siteName){
  inflight.delete(id);
  recent.unshift({ id, name, tag, received, ts: Date.now(), site: siteName || "" });
  if (recent.length > RECENT_MAX) recent.length = RECENT_MAX;
}

function safeName(n){
  const base = path.basename(String(n)).replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
  return base.slice(0, 80) || "upload.jpg";
}
function tsId(){
  const d = new Date();
  const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${String(d.getMilliseconds()).padStart(3,"0")}`;
}
function readInbox(root){
  const p = path.join(root, "_inbox.json");
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); }
  catch { return { ok: true, arr: [] }; }
  try { return { ok: true, arr: JSON.parse(raw) }; }
  catch { return { ok: false, error: "清单损坏" }; }
}
function writeInbox(root, arr){
  fs.writeFileSync(path.join(root, "_inbox.json"), JSON.stringify(arr, null, 2), "utf8");
}
function readReq(root){ // 手机端发来的指令/发布请求
  const p = path.join(root, "_requests.json");
  try { const arr = JSON.parse(fs.readFileSync(p, "utf8")); return Array.isArray(arr) ? arr : []; }
  catch { return []; }
}
function writeReq(root, arr){ fs.writeFileSync(path.join(root, "_requests.json"), JSON.stringify(arr, null, 2), "utf8"); }
function appendInbox(root, entry){
  const r = readInbox(root);
  let inbox;
  if (r.ok) { inbox = r.arr; }
  else {
    try { fs.renameSync(path.join(root, "_inbox.json"), path.join(root, "_inbox.json.corrupt-" + tsId())); } catch {}
    inbox = [];
  }
  inbox.push(entry);
  writeInbox(root, inbox);
}
function lanIPs(){
  const out = [];
  for (const ifs of Object.values(os.networkInterfaces()))
    for (const i of ifs || []) if (i.family === "IPv4" && !i.internal) out.push(i.address);
  try {
    const r = cp.execFileSync("C:\\Program Files\\Tailscale\\tailscale.exe", ["ip", "-4"], { encoding: "utf8", timeout: 3000 });
    r.split(/\r?\n/).forEach(line => {
      line = line.trim();
      if (/^100\.\d+\.\d+\.\d+$/.test(line)) out.push(line);
    });
  } catch (e) {}
  return [...new Set(out)];
}
function json(res, code, obj){ res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

// ---- build multi-site config map (backward compatible with old single-site format) ----
function buildSites(cfg){
  if (cfg.sites && typeof cfg.sites === "object") {
    const sites = {};
    for (const [key, sc] of Object.entries(cfg.sites)) {
      sites[key] = {
        key,
        name: sc.name || key,
        siteRoot: sc.siteRoot || path.resolve(__dirname, "..", ".."),
        uploadRoot: sc.uploadRoot,
        albumsMode: sc.albumsMode || "dirs",
        albumsDir: sc.albumsDir || "content/daily",
        thumbsDir: sc.thumbsDir || "content/.thumbs",
        fixedTags: sc.fixedTags || []
      };
    }
    return sites;
  }
  // Old single-site format — wrap in "personal" site for backward compat
  return {
    personal: {
      key: "personal",
      name: "个人网站",
      siteRoot: cfg.siteRoot || path.resolve(__dirname, "..", ".."),
      uploadRoot: cfg.uploadRoot,
      albumsMode: "dirs",
      albumsDir: "content/daily",
      thumbsDir: "content/.thumbs",
      fixedTags: ["作品", "日常"]
    }
  };
}

const MONITOR_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>上传监控</title><style>
body{margin:0;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;background:#222236;color:#eee;padding:16px;box-sizing:border-box}
h1{font-size:16px;margin:0 0 4px}
h2{font-size:14px;margin:14px 0 4px;color:#9aa}
.sub{color:#9aa;font-size:12px;margin-bottom:12px}
.qrs{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:14px}
.qr{background:#1a1a2a;border:1px solid #333;border-radius:10px;padding:10px;text-align:center}
.qr img{width:150px;height:150px;image-rendering:pixelated;background:#fff;padding:6px;border-radius:6px;margin-bottom:6px}
.qr .lbl{font-size:12px;color:#9aa}
.qr .tip{font-size:10px;color:#667;margin-top:2px;word-break:break-all}
.item{display:flex;align-items:center;gap:10px;background:#1a1a2a;border:1px solid #333;border-radius:8px;padding:8px 10px;margin:8px 0}
.item .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .st{font-size:12px;white-space:nowrap}
.item .badge{font-size:10px;background:#345;border-radius:4px;padding:2px 6px;color:#adf;white-space:nowrap}
.bar{height:5px;background:#333;border-radius:3px;overflow:hidden;flex:1;min-width:80px}
.bar i{display:block;height:100%;background:#5ad676;transition:width .2s}
.ok{color:#5ad676}.bad{color:#e85555}.pend{color:#e8b442}
button{background:#3a5;border:none;color:#fff;border-radius:6px;padding:5px 12px;cursor:pointer}
button.rm{background:#8a3c3c}
.empty{color:#667;text-align:center;padding:24px 0}
#toasts{position:fixed;top:14px;right:14px;z-index:9;display:flex;flex-direction:column;gap:8px}
.toast{background:#1a3b2a;border:1px solid #3a6;color:#adf;border-radius:8px;padding:9px 14px;animation:fadein .25s}
@keyframes fadein{from{opacity:0;transform:translateY(-6px)}to{opacity:1}}
</style></head><body>
<h1>📲 上传监控</h1>
<div class="sub" id="sub">连接：</div>
  <div style="margin:10px 0"><button id="procBtn" style="background:#4CAF50;color:#fff;border:0;border-radius:6px;padding:8px 16px;font:inherit;cursor:pointer">🔄 一键处理</button><span id="procSt" style="font-size:12px;color:#9aa;margin-left:10px"></span></div>
  <div id="pubBox" style="display:none;margin:4px 0 10px;background:#1a1a2a;border:1px solid #3a5;border-radius:8px;padding:8px 12px;font-size:13px"><b>🚀 手机端自动发布：</b><span id="pubSt"></span></div>
<div class="qrs" id="qrs"></div>
<div id="list"></div>
<h2 id="reqh">📌 来自手机的指令</h2><div id="req"></div>
<div id="toasts"></div>
<script src="vendor/qrcode.js"></script>
<script>
var base = location.origin;
var seen = {};
function toast(m){ var t = document.createElement("div"); t.className = "toast"; t.textContent = m; document.getElementById("toasts").appendChild(t); setTimeout(function(){ t.remove(); }, 4000); }
function fmt(n){ if (n >= 1048576) return (n/1048576).toFixed(1) + "MB"; if (n >= 1024) return Math.round(n/1024) + "KB"; return n + "B"; }
function qrCard(url, label){
  var cell = document.createElement("div"); cell.className = "qr";
  var img = document.createElement("img");
  try { var q = qrcode(0, "M"); q.addData(url); q.make(); img.src = q.createDataURL(4, 6); } catch(e){ img.alt = "(qrcode error)"; }
  cell.appendChild(img);
  var l = document.createElement("div"); l.className = "lbl"; l.textContent = label; cell.appendChild(l);
  var t = document.createElement("div"); t.className = "tip"; t.textContent = url; cell.appendChild(t);
  document.getElementById("qrs").appendChild(cell);
}
function del(id, site){
  if (!confirm("删除这条已上传的内容？")) return;
  var qs = "?id=" + encodeURIComponent(id);
  if (site) qs += "&site=" + encodeURIComponent(site);
  fetch(base + "/monitor-item" + qs, { method: "DELETE" })
    .then(function(r){ return r.json(); }).then(function(j){ if (j && j.ok) toast("已删除该上传"); }).catch(function(){});
}
function render(d){
  document.getElementById("sub").textContent = "上传中 " + d.inflight.length + " · 最近 " + d.recent.length + " 项" + (d.requests && d.requests.length ? " · 指令 " + d.requests.length + " 条" : "");
  var list = document.getElementById("list"); list.innerHTML = "";
  d.inflight.forEach(function(it){
    var row = document.createElement("div"); row.className = "item";
    var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = it.name + "（" + fmt(it.received) + (it.total ? " / " + fmt(it.total) : "") + "）";
    var bar = document.createElement("div"); bar.className = "bar";
    var i = document.createElement("i"); var pct = it.total ? Math.min(100, Math.round(it.received / it.total * 100)) : 0; i.style.width = pct + "%";
    bar.appendChild(i);
    var st = document.createElement("div"); st.className = "st pend"; st.textContent = "上传中 " + pct + "%";
    if (it.site) { var bd = document.createElement("span"); bd.className = "badge"; bd.textContent = it.site; row.appendChild(bd); }
    row.appendChild(nm); row.appendChild(bar); row.appendChild(st); list.appendChild(row);
  });
  if (!d.inflight.length){ var h = document.createElement("div"); h.className = "empty"; h.textContent = "— 当前没有上传中 —"; list.appendChild(h); }
  d.recent.forEach(function(it){
    var row = document.createElement("div"); row.className = "item";
    var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = it.name + "（" + fmt(it.received) + "）";
    var st = document.createElement("div"); st.className = "st ok"; st.textContent = "已收到 · " + it.tag;
    var rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "删除"; rm.onclick = function(){ del(it.id, it.site); };
    if (it.site) { var bd = document.createElement("span"); bd.className = "badge"; bd.textContent = it.site; row.appendChild(bd); }
    row.appendChild(nm); row.appendChild(st); row.appendChild(rm); list.appendChild(row);
  });
  var reqh = document.getElementById("reqh"), req = document.getElementById("req");
  if (!req) return;
  var reqs = d.requests || [];
  reqh.style.display = reqs.length ? "" : "none";
  req.innerHTML = "";
  if (!reqs.length){ var e = document.createElement("div"); e.className = "empty"; e.textContent = "— 手机还没发过指令 —"; req.appendChild(e); }
  reqs.forEach(function(it){
    var row = document.createElement("div"); row.className = "item";
    var nm = document.createElement("div"); nm.className = "nm";
    nm.textContent = (it.intent === "publish" ? "🚀 发布请求" : "📝 指令") + "：" + it.text;
    var st = document.createElement("div"); st.className = "st pend"; st.textContent = "待处理";
    if (it.site) { var bd = document.createElement("span"); bd.className = "badge"; bd.textContent = it.site; row.appendChild(bd); }
    row.appendChild(nm); row.appendChild(st); req.appendChild(row);
  });
}
// baseline: 记住当前已存在的 recent ids（不弹 toast），之后新增的才提示
fetch(base + "/monitor-data").then(function(r){ return r.json(); }).then(function(d){
  d.recent.forEach(function(it){ seen[it.id] = 1; });
}).catch(function(){});
fetch(base + "/info").then(function(r){ return r.json(); }).then(function(j){
  if (j && j.ips && j.ips.length){
    j.ips.forEach(function(ip){ qrCard("http://" + ip + ":" + j.port + "/?t=" + j.token, "扫码连接（" + ip + "）"); });
  } else { qrCard("", "(获取本机地址失败)"); }
}).catch(function(){});
setInterval(function(){
  fetch(base + "/monitor-data").then(function(r){ return r.json(); }).then(function(d){
    render(d);
    var ps = document.getElementById("procSt"), pb = document.getElementById("procBtn");
    if (ps && pb){
      if (d.lastOp && d.lastOp.ts){
        pb.disabled = false;
        ps.textContent = d.lastOp.fatal ? "上次：❌ 致命 " + d.lastOp.fatal
          : "上次：" + d.lastOp.ts + " — 归位 " + (d.lastOp.placed || []).length + " · 未识别 " + (d.lastOp.unclassified || []).length + " · 失败 " + (d.lastOp.failed || []).length
            + (d.lastOp.build ? " · 构建 " + (d.lastOp.build.build || "?") : "");
      } else { ps.textContent = ""; }
    }
    var pub = d.publish || {}, pbx = document.getElementById("pubBox"), pst = document.getElementById("pubSt");
    if (pbx && pst){
      if (pub.running){ pbx.style.display = ""; pst.textContent = "处理/发布进行中…"; }
      else if (pub.report){
        pbx.style.display = "";
        pst.textContent = pub.report.ok
          ? "✅ 已上线" + (pub.report.version ? " v" + pub.report.version : "") + "（" + (pub.report.msg || "推送成功") + "）"
          : "❌ " + (pub.report.msg || "发布失败") + "（内容已留本地，下次勾选发布会补推）";
        pbx.style.borderColor = pub.report.ok ? "#3a5" : "#a55";
      } else { pbx.style.display = "none"; }
    }
  }).catch(function(){});
}, 1000);
setInterval(function(){
  fetch(base + "/monitor-data").then(function(r){ return r.json(); }).then(function(d){
    d.recent.forEach(function(it){ if (!seen[it.id]){ seen[it.id] = 1; toast("✓ 上传完成：" + it.name + (it.site ? "（" + it.site + "）" : "")); } });
  }).catch(function(){});
}, 1500);

document.getElementById("procBtn").addEventListener("click", function(){
  var pb = this, ps = document.getElementById("procSt");
  pb.disabled = true; ps.textContent = "启动中…";
  fetch(base + "/process").then(function(r){ return r.json(); }).then(function(j){
    if (j && j.ok){ ps.textContent = "处理中…完成后自动显示结果"; }
    else { pb.disabled = false; ps.textContent = (j && j.msg) || "启动失败"; }
  }).catch(function(){ pb.disabled = false; ps.textContent = "桥接未连接"; });
});
</script>
</body></html>`;

function startServer(cfg){
  const token = cfg.token, bindPort = cfg.bindPort || 0;
  const maxRaw = cfg.maxRaw || MAX_RAW;
  const SITES = buildSites(cfg);
  const defaultSiteKey = cfg.defaultSite || Object.keys(SITES)[0];

  // ---- 一键处理状态：待上传/_process-report.json 懒读缓存 ----
  let procRunning = false, opReportTs = 0, opReport = null;
  let polishRunning = false, polishReport = null;
  let publishRunning = false, publishReport = null; // 手机端「推新至线上」自动发布（auto-publish.js）
  let lastAutoRun = null; // { ts, publish, finished } 手机端自动处理最近一次运行（区分「已处理·本地」与「已上线」）
  function readOpReport(root){
    if (!root) return null;
    const p = path.join(root, "_process-report.json");
    try {
      const st = fs.statSync(p);
      if (st.mtimeMs !== opReportTs){ opReportTs = st.mtimeMs; opReport = JSON.parse(fs.readFileSync(p, "utf8").replace(/^\uFEFF/, "")); }
    } catch { opReport = null; opReportTs = 0; }
    return opReport;
  }

  // 手机自动发布：node tools/auto-publish.js --repo <siteRoot>（无人值守，失败不回滚）
  function runPublish(repo, srcTail){
    const tools = path.resolve(__dirname, "..", "..", "tools");
    const apj = path.join(tools, "auto-publish.js");
    if (!fs.existsSync(apj)){
      publishReport = { ts: Date.now(), ok: false, code: 1, version: null, msg: "缺少 tools/auto-publish.js", tail: srcTail || "" };
      return;
    }
    publishRunning = true;
    publishReport = null;
    try {
      const s = cp.spawn(process.execPath, [apj, "--repo", repo], { cwd: tools, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      const keep = (d) => { out = (out + d.toString()).slice(-4000); };
      if (s.stdout) s.stdout.on("data", keep);
      if (s.stderr) s.stderr.on("data", keep);
      s.on("exit", (code) => {
        publishRunning = false;
        const lines = out.trim().split(/\r?\n/).filter(Boolean);
        const fin = lines[lines.length - 1] || "";
        const okLine = /^PUBLISH_OK /.test(fin), failLine = /^PUBLISH_FAIL /.test(fin);
        const ver = (fin.match(/version=([\d.]+)/) || [])[1] || null;
        publishReport = {
          ts: Date.now(),
          ok: code === 0 && okLine,
          code,
          version: ver,
          msg: failLine ? fin.replace(/^PUBLISH_FAIL ?/, "") : (okLine ? fin : out.trim().split(/\r?\n/).slice(-3).join(" | ")),
          tail: out.slice(-1200) || (srcTail || "")
        };
      });
      s.unref();
    } catch (e) {
      publishRunning = false;
      publishReport = { ts: Date.now(), ok: false, code: 1, version: null, msg: String(e.message), tail: srcTail || "" };
    }
  }

  // Resolve site config from request: ?site=<key> or X-Site header or default
  function resolveSite(req){
    const u = (() => { try { return new URL(req.url, "http://x"); } catch { return null; } })();
    let key = null;
    if (u) key = u.searchParams.get("site");
    if (!key) key = req.headers["x-site"];
    if (!key || !SITES[key]) key = defaultSiteKey;
    return SITES[key];
  }

  const srv = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type, X-Site");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const auth = req.headers["authorization"] || "";
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const authed = tok === token && !!token;
    function deny(code, msg){ try { req.resume(); } catch {}; json(res, code, { error: msg }); return; }
    const url = () => { try { return new URL(req.url, "http://x"); } catch { return null; } };

    // GET /info — addresses + port + token for the monitor QR codes
    if (req.method === "GET" && req.url.split("?")[0] === "/info"){
      const port = srv.address() ? srv.address().port : bindPort;
      json(res, 200, { ips: lanIPs(), port, token });
      return;
    }

    // GET /sites — list of configured sites (for the app to build site selector)
    if (req.method === "GET" && req.url.split("?")[0] === "/sites"){
      json(res, 200, {
        sites: Object.values(SITES).map(s => ({ key: s.key, name: s.name })),
        default: defaultSiteKey
      });
      return;
    }

    // GET /albums?site=<key> — [{name, cover}] + fixedTags
    if (req.method === "GET" && req.url.split("?")[0] === "/albums"){
      if (!authed){ return deny(401, "unauthorized"); }
      const sc = resolveSite(req);
      let albums = [];
      if (sc.albumsMode === "profile") {
        // Couple-site: read album names from profile.json
        try {
          const profile = JSON.parse(fs.readFileSync(path.join(sc.siteRoot, "content", "profile.json"), "utf8"));
          const al = (profile.photos && profile.photos.albums) || [];
          albums = al.map(a => ({ name: a.title || a.name || "未命名", cover: null }));
        } catch {}
      } else {
        // Personal-site: list directories in albumsDir (content/daily)
        try {
          const dailyDir = path.join(sc.siteRoot, sc.albumsDir);
          for (const name of fs.readdirSync(dailyDir)) {
            try { if (!fs.statSync(path.join(dailyDir, name)).isDirectory()) continue; } catch { continue; }
            let cover = null;
            try {
              const imgs = fs.readdirSync(path.join(dailyDir, name)).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
              let first = imgs[0];
              try {
                const ct = fs.readFileSync(path.join(dailyDir, name, "_cover.txt"), "utf8").trim().replace(/\.[^.]+$/, "");
                const hit = imgs.find(f => f.replace(/\.[^.]+$/, "") === ct);
                if (hit) first = hit;
              } catch {}
              if (first) cover = sc.albumsDir.replace(/^content\//, "") + "/" + name + "/" + first.replace(/\.[^.]+$/, "") + ".webp";
            } catch {}
            albums.push({ name, cover });
          }
        } catch {}
        albums.sort((a, b) => a.name.localeCompare(b.name, "zh"));
      }
      json(res, 200, { albums, fixedTags: sc.fixedTags });
      return;
    }

    // GET /thumb?p=<rel>&site=<key> — serve a thumbnail
    if (req.method === "GET" && req.url.split("?")[0] === "/thumb"){
      const u = url(); if (!u) return deny(400, "bad uri");
      let p; try { p = decodeURIComponent(u.searchParams.get("p") || ""); } catch { return deny(400, "bad uri"); }
      if (!p){ json(res, 404, { error: "no thumb" }); return; }
      const sc = resolveSite(req);
      const base = path.join(sc.siteRoot, sc.thumbsDir);
      const fp = path.resolve(base, p);
      if (fp !== base && !fp.startsWith(base + path.sep)){ return deny(400, "bad path"); }
      try {
        if (fs.statSync(fp).isFile()){
          res.writeHead(200, { "Content-Type": "image/webp", "Cache-Control": "max-age=3600" });
          fs.createReadStream(fp).pipe(res); return;
        }
      } catch {}
      json(res, 404, { error: "no thumb" });
      return;
    }

    // GET /history?site=<key> — inbox newest-first
    if (req.method === "GET" && req.url.split("?")[0] === "/history"){
      if (!authed){ return deny(401, "unauthorized"); }
      const sc = resolveSite(req);
      const r = readInbox(sc.uploadRoot);
      if (!r.ok){ return json(res, 500, { error: r.error }); }
      const items = r.arr.slice().reverse().map(e => {
        let size = null;
        try { const s = fs.statSync(path.join(sc.uploadRoot, e.file)); if (s.isFile()) size = s.size; } catch {}
        return { id: e.id, name: e.name || e.file, tag: e.tag, status: e.status, ts: e.ts, size, site: e.site || sc.key };
      });
      json(res, 200, { items });
      return;
    }

    // GET /monitor-data — polling feed for the monitor window (merges ALL sites)
    if (req.method === "GET" && req.url.split("?")[0] === "/monitor-data"){
      const allReqs = [];
      for (const sc of Object.values(SITES)) {
        try { allReqs.push(...readReq(sc.uploadRoot)); } catch {}
      }
      const sc0 = SITES[defaultSiteKey];
      json(res, 200, { inflight: [...inflight.values()], recent, requests: allReqs.slice(-8).reverse(), lastOp: sc0 ? readOpReport(sc0.uploadRoot) : null, publish: { running: publishRunning, report: publishReport } });
      return;
    }

    // GET /process — 一键处理（分类/压缩/归位/配文/构建），后台异步跑 tools/process-uploads.js
    if (req.method === "GET" && req.url.split("?")[0] === "/process"){
      if (!authed){ return deny(401, "unauthorized"); }
      if (procRunning){ json(res, 200, { ok: false, running: true, msg: "上一轮处理还没结束" }); return; }
      const pj = path.join(path.resolve(__dirname, "..", ".."), "tools", "process-uploads.js");
      if (!fs.existsSync(pj)){ json(res, 200, { ok: false, msg: "缺少 tools/process-uploads.js" }); return; }
      procRunning = true;
      try {
        const s = cp.spawn(process.execPath, [pj], { cwd: path.dirname(pj), detached: true, stdio: "ignore" });
        s.on("exit", () => { procRunning = false; opReport = null; opReportTs = 0; });
        s.unref();
      } catch (e) { procRunning = false; json(res, 200, { ok: false, msg: String(e.message) }); return; }
      json(res, 200, { ok: true, msg: "已启动一键处理，完成后自动显示结果" });
      return;
    }

    // POST /auto-process?publish=0|1&site=<key> — 手机端「推新至线上」触发：
    // 自动处理（同 /process），勾选 publish=1 时处理完成后自动发布上线（tools/auto-publish.js）
    if (req.method === "POST" && req.url.split("?")[0] === "/auto-process"){
      if (!authed){ return deny(401, "unauthorized"); }
      if (procRunning){ json(res, 200, { ok: false, running: true, msg: "上一轮处理还没结束" }); return; }
      const u = url(); if (!u) return deny(400, "bad uri");
      const publish = u.searchParams.get("publish") === "1";
      const sc = resolveSite(req);
      const pj = path.join(path.resolve(__dirname, "..", ".."), "tools", "process-uploads.js");
      if (!fs.existsSync(pj)){ json(res, 200, { ok: false, msg: "缺少 tools/process-uploads.js" }); return; }
      procRunning = true;
      lastAutoRun = { ts: Date.now(), publish, finished: false };
      try {
        const s = cp.spawn(process.execPath, [pj], { cwd: path.dirname(pj), detached: true, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        const keep = (d) => { out = (out + d.toString()).slice(-4000); };
        if (s.stdout) s.stdout.on("data", keep);
        if (s.stderr) s.stderr.on("data", keep);
        s.on("exit", (code) => {
          procRunning = false; opReport = null; opReportTs = 0;
          lastAutoRun.finished = true;
          const rep = readOpReport(sc.uploadRoot);
          const placed = rep && rep.placed ? rep.placed.length : 0;
          const fatal = !!(rep && rep.fatal);
          // 处理完且有内容归位 → 按勾选决定是否自动发布（失败不回滚，留待下次补推）
          if (publish && !fatal && placed > 0) runPublish(sc.siteRoot, out);
        });
        s.unref();
      } catch (e) { procRunning = false; json(res, 200, { ok: false, msg: String(e.message) }); return; }
      json(res, 200, { ok: true, publish, msg: "已启动自动处理" + (publish ? "，完成后自动推送上线" : "（仅本地，不推送）") });
      return;
    }

    // GET /polish — 一键润色：把带 #draft 标记的本地草稿交给云端模型改写，后台异步跑 tools/ai-caption.js --polish
    if (req.method === "GET" && req.url.split("?")[0] === "/polish"){
      if (!authed){ return deny(401, "unauthorized"); }
      if (polishRunning){ json(res, 200, { ok: false, running: true, msg: "上一轮润色还没结束" }); return; }
      const pj = path.join(path.resolve(__dirname, "..", ".."), "tools", "ai-caption.js");
      if (!fs.existsSync(pj)){ json(res, 200, { ok: false, msg: "缺少 tools/ai-caption.js" }); return; }
      polishRunning = true;
      try {
        const s = cp.spawn(process.execPath, [pj, "--repo", path.resolve(__dirname, "..", ".."), "--polish"], { cwd: path.dirname(pj), detached: true, stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        const keep = (d) => { out = (out + d.toString()).slice(-4000); };
        if (s.stdout) s.stdout.on("data", keep);
        if (s.stderr) s.stderr.on("data", keep);
        s.on("exit", (code) => {
          polishRunning = false;
          const okN = (out.match(/\[✓\]/g) || []).length;
          const badN = (out.match(/\[✗\]/g) || []).length;
          polishReport = { ts: Date.now(), ok: code === 0, code, done: okN, failed: badN, tail: out.slice(-1500) };
          // 配文写回 .txt 后必须重建，否则 data.js 仍是旧草稿（网站/手机端看到的都是旧文案）
          if (okN > 0){
            try {
              const bj = path.join(path.resolve(__dirname, "..", ".."), "build.js");
              const bs = cp.spawn(process.execPath, [bj], { cwd: path.resolve(__dirname, "..", ".."), detached: true, stdio: "ignore" });
              bs.on("exit", (bc) => { polishReport.rebuild = bc === 0 ? "ok" : ("fail(" + bc + ")"); });
              bs.unref();
            } catch (e){ polishReport.rebuild = "error: " + e.message; }
          }
        });
        s.unref();
      } catch (e) { polishRunning = false; json(res, 200, { ok: false, msg: String(e.message) }); return; }
      json(res, 200, { ok: true, msg: "已启动润色，完成后自动显示结果" });
      return;
    }

    // GET /polish-status — 查润色进度/结果（手机端轮询）
    if (req.method === "GET" && req.url.split("?")[0] === "/polish-status"){
      if (!authed){ return deny(401, "unauthorized"); }
      json(res, 200, { running: polishRunning, report: polishReport });
      return;
    }

    // GET /publish-status — 查「推新至线上」进度/结果（手机端轮询）
    if (req.method === "GET" && req.url.split("?")[0] === "/publish-status"){
      if (!authed){ return deny(401, "unauthorized"); }
      const sc = resolveSite(req);
      json(res, 200, {
        phase: procRunning ? "processing" : (publishRunning ? "publishing" : "idle"),
        running: procRunning || publishRunning,
        publishRunning,
        report: publishReport,
        autoRun: lastAutoRun,
        lastOp: readOpReport(sc.uploadRoot)   // 处理报告（区分「已处理·本地」与「已上线」）
      });
      return;
    }

    // GET /monitor — the desktop 监控窗 page
    if (req.method === "GET" && req.url.split("?")[0] === "/monitor"){
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(MONITOR_HTML);
      return;
    }

    if (req.method === "POST" && req.url.split("?")[0] === "/upload"){
      if (!authed){ return deny(401, "unauthorized"); }
      let body = "", tooBig = false;
      req.on("data", c => {
        if (tooBig) return;
        body += c;
        if (body.length > MAX_BODY + 1024){
          tooBig = true;
          res.writeHead(413, { "Content-Type": "application/json" }); res.end('{"error":"too large"}');
          body = "";
        }
      });
      req.on("end", () => {
        if (tooBig) return;
        let j;
        try { j = JSON.parse(body); } catch { return deny(400, "bad json"); }
        if (!j || !j.name || typeof j.data !== "string"){ return deny(400, "missing name/data"); }
        if (j.data.length > MAX_BODY){ return deny(413, "too large"); }
        const sc = j.site && SITES[j.site] ? SITES[j.site] : SITES[defaultSiteKey];
        const id = tsId() + "_" + crypto.randomBytes(3).toString("hex");
        const fname = `${id}_${safeName(j.name)}`;
        try {
          const buf = Buffer.from(j.data, "base64");
          fs.writeFileSync(path.join(sc.uploadRoot, fname), buf);
          appendInbox(sc.uploadRoot, { id, file: fname, origName: j.origName || j.name, name: j.name, tag: j.tag || "日常", ts: id, status: "pending", site: sc.key, ...(j.cover ? { cover: true } : {}) });
          trackDone(id, j.name, j.tag || "日常", buf.length, sc.name);
          json(res, 200, { ok: true, id });
        } catch (e){ json(res, 500, { error: String(e) }); }
      });
      return;
    }

    if (req.method === "POST" && req.url.split("?")[0] === "/upload_raw"){
      if (!authed){ return deny(401, "unauthorized"); }
      const u = url(); if (!u) return deny(400, "bad uri");
      const name = (u.searchParams.get("name") || "").trim();
      if (!name){ return deny(400, "missing name"); }
      const tag = u.searchParams.get("tag") || "日常";
      const origName = u.searchParams.get("origName") || name;
      const cover = u.searchParams.get("cover") === "1";
      const sc = resolveSite(req);
      const id = tsId() + "_" + crypto.randomBytes(3).toString("hex");
      const fname = `${id}_${safeName(name)}`;
      const total = parseInt(req.headers["content-length"] || "0", 10);
      trackStart(id, name, total, sc.name);
      const chunks = []; let size = 0, tooBig = false;
      req.on("data", c => {
        if (tooBig) return;
        size += c.length; trackAdd(id, c.length);
        if (size > maxRaw){
          tooBig = true;
          res.writeHead(413, { "Content-Type": "application/json" }); res.end('{"error":"too large"}');
          chunks.length = 0; inflight.delete(id);
        } else { chunks.push(c); }
      });
      req.on("end", () => {
        if (tooBig) return;
        const buf = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks);
        try {
          fs.writeFileSync(path.join(sc.uploadRoot, fname), buf);
          appendInbox(sc.uploadRoot, { id, file: fname, origName, name, tag, ts: id, status: "pending", site: sc.key, ...(cover ? { cover: true } : {}) });
          trackDone(id, name, tag, buf.length, sc.name);
          json(res, 200, { ok: true, id });
        } catch (e){
          inflight.delete(id);
          json(res, 500, { error: String(e) });
        }
      });
      return;
    }

    // POST /request {intent,text,site} — 手机端把「发布」请求/备注/指令发到桌面
    if (req.method === "POST" && req.url.split("?")[0] === "/request"){
      if (!authed){ return deny(401, "unauthorized"); }
      let body = "", tooBig = false;
      req.on("data", c => {
        if (tooBig) return;
        body += c;
        if (body.length > 8192){
          tooBig = true;
          res.writeHead(413, { "Content-Type": "application/json" }); res.end('{"error":"too large"}');
          body = "";
        }
      });
      req.on("end", () => {
        if (tooBig) return;
        let j; try { j = JSON.parse(body); } catch { return deny(400, "bad json"); }
        const text = String(j.text || "").trim();
        if (!text){ return deny(400, "empty text"); }
        const sc = j.site && SITES[j.site] ? SITES[j.site] : SITES[defaultSiteKey];
        const id = tsId() + "_" + crypto.randomBytes(3).toString("hex");
        const arr = readReq(sc.uploadRoot);
        arr.push({ id, intent: j.intent || "command", text, ts: id, status: "pending", site: sc.key });
        if (arr.length > 50) arr.splice(0, arr.length - 50);
        writeReq(sc.uploadRoot, arr);
        json(res, 200, { ok: true, id });
      });
      return;
    }

    // ---- AI key 配置接口（写入 %LOCALAPPDATA%\MobileBridge\ai-key.json，供 ai-caption.js 读取）----
    const AIKEY_FILE = path.join(process.env.LOCALAPPDATA || "", "MobileBridge", "ai-key.json");
    const readAiKey = function () {
      try {
        const s = fs.readFileSync(AIKEY_FILE, "utf8").trim();
        if (!s) return "";
        return s.startsWith("{") ? (JSON.parse(s).key || "").trim() : s.trim();
      } catch { return ""; }
    };

    // GET /ai-key — 查状态（不回显完整 key）
    if (req.method === "GET" && req.url.split("?")[0] === "/ai-key"){
      if (!authed){ return deny(401, "unauthorized"); }
      const k = readAiKey();
      json(res, 200, { has: !!k, hint: k ? k.slice(0, 8) + "…" : "" });
      return;
    }

    // POST /ai-key {key} 或 {clear:true} — 保存 / 清除 key
    if (req.method === "POST" && req.url.split("?")[0] === "/ai-key"){
      if (!authed){ return deny(401, "unauthorized"); }
      let body = "", tooBig = false;
      req.on("data", c => { if (tooBig) return; body += c; if (body.length > 8192){ tooBig = true; res.writeHead(413, { "Content-Type": "application/json" }); res.end('{"error":"too large"}'); body = ""; } });
      req.on("end", () => {
        if (tooBig) return;
        let j; try { j = JSON.parse(body || "{}"); } catch { return deny(400, "bad json"); }
        try {
          if (j.clear){ try { fs.unlinkSync(AIKEY_FILE); } catch {} return json(res, 200, { ok: true, has: false }); }
          const key = String(j.key || "").trim();
          if (!key) return deny(400, "missing key");
          fs.mkdirSync(path.dirname(AIKEY_FILE), { recursive: true });
          fs.writeFileSync(AIKEY_FILE, JSON.stringify({ key }), "utf8");
          json(res, 200, { ok: true, has: true, hint: key.slice(0, 8) + "…" });
        } catch (e) { json(res, 500, { error: String(e && e.message || e) }); }
      });
      return;
    }

    // GET /requests?site=<key> — 查指令（最新在前）
    if (req.method === "GET" && req.url.split("?")[0] === "/requests"){
      if (!authed){ return deny(401, "unauthorized"); }
      const sc = resolveSite(req);
      json(res, 200, { items: readReq(sc.uploadRoot).slice().reverse() });
      return;
    }

    if (req.method === "DELETE" && req.url.split("?")[0] === "/monitor-item"){
      if (!authed){ return deny(401, "unauthorized"); }
      const u = url(); if (!u) return deny(400, "bad uri");
      const id = u.searchParams.get("id");
      if (!id){ return deny(400, "missing id"); }
      const sc = resolveSite(req);
      const r = readInbox(sc.uploadRoot);
      if (!r.ok){ return json(res, 500, { error: r.error }); }
      const idx = r.arr.findIndex(e => e.id === id);
      if (idx < 0){ return json(res, 404, { error: "not found" }); }
      try { fs.unlinkSync(path.join(sc.uploadRoot, r.arr[idx].file)); } catch {}
      r.arr.splice(idx, 1);
      writeInbox(sc.uploadRoot, r.arr);
      const ri = recent.findIndex(x => x.id === id); if (ri >= 0) recent.splice(ri, 1);
      inflight.delete(id);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url.split("?")[0] === "/status"){
      if (!authed){ return deny(401, "unauthorized"); }
      const sc = resolveSite(req);
      const r = readInbox(sc.uploadRoot);
      let sum;
      if (r.ok) {
        const inbox = r.arr;
        sum = { total: inbox.length, pending: 0, processed: 0, failed: 0 };
        for (const e of inbox) if (sum[e.status] != null) sum[e.status]++;
      } else {
        sum = { total: 0, pending: 0, processed: 0, failed: 0, error: r.error };
      }
      json(res, 200, sum);
      return;
    }

    if (req.method === "GET"){
      const appDir = path.join(__dirname, "app");
      const u0 = req.url.split("?")[0];
      let rel;
      if (u0 === "/") { rel = "index.html"; }
      else { try { rel = decodeURIComponent(u0.slice(1)); } catch { return deny(400, "bad uri"); } }
      const fp = path.join(appDir, rel);
      const inside = fp === appDir || fp.startsWith(appDir + path.sep);
      let isFile = false;
      try { isFile = inside && fs.statSync(fp).isFile(); } catch { isFile = false; }
      if (isFile){
        const ext = path.extname(fp).toLowerCase();
        const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon", ".webmanifest":"application/manifest+json; charset=utf-8" };
        // no-cache：手机浏览器很容易把旧 app.js 缓住，改了代码却看不到效果
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream", "Cache-Control": "no-cache, must-revalidate" });
        fs.createReadStream(fp).pipe(res);
        return;
      }
      json(res, 404, { error: "not found" });
      return;
    }

    return deny(405, "method not allowed");
  });
  srv.listen(bindPort);
  return srv;
}

module.exports = { startServer };

if (require.main === module) {
  const cfgPath = path.join(__dirname, "_bridge_config.json");
  let cfg;
  try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); }
  catch (e) { console.error("无法读取配置 " + cfgPath + ": " + e.message); process.exit(1); }
  if (!cfg.token) { console.error("配置缺 token"); process.exit(1); }
  const SITES = buildSites(cfg);
  // Ensure uploadRoot directories exist
  for (const sc of Object.values(SITES)) {
    if (sc.uploadRoot) {
      try { fs.mkdirSync(sc.uploadRoot, { recursive: true }); } catch {}
    }
  }
  const srv = startServer(cfg);
  srv.on("listening", () => {
    const a = srv.address();
    const siteList = Object.values(SITES).map(s => s.name + "(" + s.key + ")").join(", ");
    console.log("bridge listening http://0.0.0.0:" + a.port + " sites: " + siteList);
    console.log("monitor window: http://127.0.0.1:" + a.port + "/monitor");
    if (cfg.openMonitor !== false){
      try { cp.exec('cmd /c start "" "http://127.0.0.1:' + a.port + '/monitor"'); } catch {}
    }
  });
}
