// bridge.js — mobile-uploader bridge: pure node HTTP server (no deps)
// POST   /upload {origName,name,data(base64),tag}   legacy base64 path (fallback)
// POST   /upload_raw?name&tag&origName              binary body (fast path, progress-tracked)
// GET    /albums                                    [{name, cover(thumb rel under content/.thumbs)}]
// GET    /thumb?p=<rel>                             serve thumbnail webp (album covers)
// GET    /history                                   inbox items newest-first {id,name,tag,status,ts,size}
// GET    /status                                    summary {total,pending,processed,failed}
// GET    /info                                      {ips, port, token} for QR codes
// GET    /monitor-data                              {inflight, recent} polled by monitor page
// GET    /monitor                                   desktop 监控窗 (QR + live uploads + delete)
// DELETE /monitor-item?id=<id>                      remove staging file + inbox entry
// GET    /                                          serve app/ (PWA)
// Mutations require: Authorization: Bearer <token>
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto"), os = require("os");

const MAX_BODY = 12 * 1024 * 1024;   // base64 cap (legacy path)
const MAX_RAW  = 200 * 1024 * 1024;  // raw cap (videos OK)

// ---- live upload tracker (feeds the desktop monitor window) ----
const inflight = new Map(); // id -> {id,name,received,total}
const recent = [];          // [{id,name,tag,received,ts}] newest first
const RECENT_MAX = 30;
function trackStart(id, name, total){ inflight.set(id, { id, name, received: 0, total: total || 0, ts: Date.now() }); }
function trackAdd(id, n){ const t = inflight.get(id); if (t) t.received += n; }
function trackDone(id, name, tag, received){
  inflight.delete(id);
  recent.unshift({ id, name, tag, received, ts: Date.now() });
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
  return [...new Set(out)];
}
function json(res, code, obj){ res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); }

const MONITOR_HTML = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>上传监控</title><style>
body{margin:0;font:14px/1.5 system-ui,"Microsoft YaHei",sans-serif;background:#222236;color:#eee;padding:16px;box-sizing:border-box}
h1{font-size:16px;margin:0 0 4px}
.sub{color:#9aa;font-size:12px;margin-bottom:12px}
.qrs{display:flex;flex-wrap:wrap;gap:14px;margin-bottom:14px}
.qr{background:#1a1a2a;border:1px solid #333;border-radius:10px;padding:10px;text-align:center}
.qr img{width:150px;height:150px;image-rendering:pixelated;background:#fff;padding:6px;border-radius:6px;margin-bottom:6px}
.qr .lbl{font-size:12px;color:#9aa}
.qr .tip{font-size:10px;color:#667;margin-top:2px;word-break:break-all}
.item{display:flex;align-items:center;gap:10px;background:#1a1a2a;border:1px solid #333;border-radius:8px;padding:8px 10px;margin:8px 0}
.item .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.item .st{font-size:12px;white-space:nowrap}
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
<div class="qrs" id="qrs"></div>
<div id="list"></div>
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
function del(id){
  if (!confirm("删除这条已上传的内容？")) return;
  fetch(base + "/monitor-item?id=" + encodeURIComponent(id), { method: "DELETE" })
    .then(function(r){ return r.json(); }).then(function(j){ if (j && j.ok) toast("已删除该上传"); }).catch(function(){});
}
function render(d){
  document.getElementById("sub").textContent = "上传中 " + d.inflight.length + " · 最近 " + d.recent.length + " 项";
  var list = document.getElementById("list"); list.innerHTML = "";
  d.inflight.forEach(function(it){
    var row = document.createElement("div"); row.className = "item";
    var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = it.name + "（" + fmt(it.received) + (it.total ? " / " + fmt(it.total) : "") + "）";
    var bar = document.createElement("div"); bar.className = "bar";
    var i = document.createElement("i"); var pct = it.total ? Math.min(100, Math.round(it.received / it.total * 100)) : 0; i.style.width = pct + "%";
    bar.appendChild(i);
    var st = document.createElement("div"); st.className = "st pend"; st.textContent = "上传中 " + pct + "%";
    row.appendChild(nm); row.appendChild(bar); row.appendChild(st); list.appendChild(row);
  });
  if (!d.inflight.length){ var h = document.createElement("div"); h.className = "empty"; h.textContent = "— 当前没有上传中 —"; list.appendChild(h); }
  d.recent.forEach(function(it){
    var row = document.createElement("div"); row.className = "item";
    var nm = document.createElement("div"); nm.className = "nm"; nm.textContent = it.name + "（" + fmt(it.received) + "）";
    var st = document.createElement("div"); st.className = "st ok"; st.textContent = "已收到 · " + it.tag;
    var rm = document.createElement("button"); rm.className = "rm"; rm.textContent = "删除"; rm.onclick = function(){ del(it.id); };
    row.appendChild(nm); row.appendChild(st); row.appendChild(rm); list.appendChild(row);
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
  fetch(base + "/monitor-data").then(function(r){ return r.json(); }).then(render).catch(function(){});
}, 1000);
setInterval(function(){
  fetch(base + "/monitor-data").then(function(r){ return r.json(); }).then(function(d){
    d.recent.forEach(function(it){ if (!seen[it.id]){ seen[it.id] = 1; toast("✓ 上传完成：" + it.name); } });
  }).catch(function(){});
}, 1500);
</script>
</body></html>`;

function startServer(cfg){
  const token = cfg.token, uploadRoot = cfg.uploadRoot, bindPort = cfg.bindPort || 0;
  const maxRaw = cfg.maxRaw || MAX_RAW;
  const siteRoot = cfg.siteRoot || path.resolve(__dirname, "..", ".."); // personal-website repo root
  const srv = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
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
    // GET /albums — [{name, cover}] covers = content/.thumbs rel of first image
    if (req.method === "GET" && req.url.split("?")[0] === "/albums"){
      if (!authed){ return deny(401, "unauthorized"); }
      let albums = [];
      try {
        const dailyDir = path.join(siteRoot, "content", "daily");
        for (const name of fs.readdirSync(dailyDir)) {
          try { if (!fs.statSync(path.join(dailyDir, name)).isDirectory()) continue; } catch { continue; }
          let cover = null;
          try {
            const first = fs.readdirSync(path.join(dailyDir, name)).find(f => /\.(jpg|jpeg|png|webp)$/i.test(f));
            if (first) cover = "daily/" + name + "/" + first.replace(/\.[^.]+$/, "") + ".webp";
          } catch {}
          albums.push({ name, cover });
        }
      } catch {}
      albums.sort((a, b) => a.name.localeCompare(b.name, "zh"));
      json(res, 200, { albums });
      return;
    }
    // GET /thumb?p= — serve a thumbnail (containment: content/.thumbs/<p>)
    if (req.method === "GET" && req.url.split("?")[0] === "/thumb"){
      const u = url(); if (!u) return deny(400, "bad uri");
      let p; try { p = decodeURIComponent(u.searchParams.get("p") || ""); } catch { return deny(400, "bad uri"); }
      if (!p){ json(res, 404, { error: "no thumb" }); return; }
      const base = path.join(siteRoot, "content", ".thumbs");
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
    // GET /history — inbox newest-first
    if (req.method === "GET" && req.url.split("?")[0] === "/history"){
      if (!authed){ return deny(401, "unauthorized"); }
      const r = readInbox(uploadRoot);
      if (!r.ok){ return json(res, 500, { error: r.error }); }
      const items = r.arr.slice().reverse().map(e => {
        let size = null;
        try { const s = fs.statSync(path.join(uploadRoot, e.file)); if (s.isFile()) size = s.size; } catch {}
        return { id: e.id, name: e.name || e.file, tag: e.tag, status: e.status, ts: e.ts, size };
      });
      json(res, 200, { items });
      return;
    }
    // GET /monitor-data — polling feed for the monitor window
    if (req.method === "GET" && req.url.split("?")[0] === "/monitor-data"){
      json(res, 200, { inflight: [...inflight.values()], recent });
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
        const id = tsId() + "_" + crypto.randomBytes(3).toString("hex");
        const fname = `${id}_${safeName(j.name)}`;
        try {
          const buf = Buffer.from(j.data, "base64");
          fs.writeFileSync(path.join(uploadRoot, fname), buf);
          appendInbox(uploadRoot, { id, file: fname, origName: j.origName || j.name, name: j.name, tag: j.tag || "日常", ts: id, status: "pending" });
          trackDone(id, j.name, j.tag || "日常", buf.length);
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
      const id = tsId() + "_" + crypto.randomBytes(3).toString("hex");
      const fname = `${id}_${safeName(name)}`;
      const total = parseInt(req.headers["content-length"] || "0", 10);
      trackStart(id, name, total);
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
          fs.writeFileSync(path.join(uploadRoot, fname), buf);
          appendInbox(uploadRoot, { id, file: fname, origName, name, tag, ts: id, status: "pending" });
          trackDone(id, name, tag, buf.length);
          json(res, 200, { ok: true, id });
        } catch (e){
          inflight.delete(id);
          json(res, 500, { error: String(e) });
        }
      });
      return;
    }

    if (req.method === "DELETE" && req.url.split("?")[0] === "/monitor-item"){
      if (!authed){ return deny(401, "unauthorized"); }
      const u = url(); if (!u) return deny(400, "bad uri");
      const id = u.searchParams.get("id");
      if (!id){ return deny(400, "missing id"); }
      const r = readInbox(uploadRoot);
      if (!r.ok){ return json(res, 500, { error: r.error }); }
      const idx = r.arr.findIndex(e => e.id === id);
      if (idx < 0){ return json(res, 404, { error: "not found" }); }
      try { fs.unlinkSync(path.join(uploadRoot, r.arr[idx].file)); } catch {}
      r.arr.splice(idx, 1);
      writeInbox(uploadRoot, r.arr);
      const ri = recent.findIndex(x => x.id === id); if (ri >= 0) recent.splice(ri, 1);
      inflight.delete(id);
      json(res, 200, { ok: true });
      return;
    }

    if (req.method === "GET" && req.url.split("?")[0] === "/status"){
      if (!authed){ return deny(401, "unauthorized"); }
      const r = readInbox(uploadRoot);
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
        const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon", ".webmanifest":"application/manifest+json" };
        res.writeHead(200, { "Content-Type": types[ext] || "application/octet-stream" });
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
  if (!cfg.token || !cfg.uploadRoot) { console.error("配置缺 token 或 uploadRoot"); process.exit(1); }
  const srv = startServer(cfg);
  srv.on("listening", () => {
    const a = srv.address();
    console.log("bridge listening http://0.0.0.0:" + a.port + " (uploadRoot=" + cfg.uploadRoot + ")");
    console.log("monitor window: http://127.0.0.1:" + a.port + "/monitor");
    if (cfg.openMonitor !== false){
      try { require("child_process").exec('cmd /c start "" "http://127.0.0.1:' + a.port + '/monitor"'); } catch {}
    }
  });
}