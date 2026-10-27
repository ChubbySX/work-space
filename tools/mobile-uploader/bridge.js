// bridge.js — mobile-uploader bridge: HTTP server, pure node (no deps).
// POST /upload {origName, name, data(base64), tag} + Bearer -> store file + append _inbox.json
// GET /albums -> existing daily album names (from siteRoot/content/daily) for the app's tag dropdown
// GET /status -> inbox summary {total,pending,processed,failed[,error]}
// GET / -> serve app/ files
const http = require("http"), fs = require("fs"), path = require("path"), crypto = require("crypto");

const MAX_BODY = 12 * 1024 * 1024; // 12MB cap on base64 body

function safeName(n){
  const base = path.basename(String(n)).replace(/[\\/:*?"<>|]/g, "").replace(/\s+/g, "_");
  return base.slice(0, 80) || "upload.jpg";
}
function tsId(){
  const d = new Date();
  const p = x => String(x).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${String(d.getMilliseconds()).padStart(3,"0")}`;
}
// readInbox: distinguish corrupt from empty/missing. Returns {ok:true,arr} or {ok:false,error}
function readInbox(root){
  const p = path.join(root, "_inbox.json");
  let raw;
  try { raw = fs.readFileSync(p, "utf8"); }
  catch { return { ok: true, arr: [] }; }               // missing = first run -> empty
  try { return { ok: true, arr: JSON.parse(raw) }; }
  catch { return { ok: false, error: "清单损坏" }; }     // corrupt -> caller backs up before fresh
}
function writeInbox(root, arr){
  fs.writeFileSync(path.join(root, "_inbox.json"), JSON.stringify(arr, null, 2), "utf8");
}

function startServer(cfg){
  const token = cfg.token, uploadRoot = cfg.uploadRoot, bindPort = cfg.bindPort || 0;
  const siteRoot = cfg.siteRoot || path.resolve(__dirname, "..", ".."); // personal-website repo root
  const srv = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const auth = req.headers["authorization"] || "";
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const authed = tok === token && !!token;
    // deny(): drain+discard the request body (prevents unauth memory DoS via large body on a 401)
    function deny(code, msg){ try { req.resume(); } catch {}; res.writeHead(code, {"Content-Type":"application/json"}); res.end(msg); return; }

    // GET /albums — list existing daily album names (source of truth: siteRoot/content/daily)
    if (req.method === "GET" && req.url.split("?")[0] === "/albums"){
      if (!authed){ return deny(401, '{"error":"unauthorized"}'); }
      let albums = [];
      try {
        const dailyDir = path.join(siteRoot, "content", "daily");
        for (const name of fs.readdirSync(dailyDir)) {
          try { if (fs.statSync(path.join(dailyDir, name)).isDirectory()) albums.push(name); } catch {}
        }
      } catch {} // siteRoot/content/daily missing -> empty list
      albums.sort((a, b) => a.localeCompare(b, "zh"));
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify({ albums }));
      return;
    }

    if (req.method === "POST" && req.url.split("?")[0] === "/upload"){
      if (!authed){ return deny(401, '{"error":"unauthorized"}'); }
      let body = "", tooBig = false;
      req.on("data", c => {
        if (tooBig) return; // drain: discard further data after 413 sent
        body += c;
        if (body.length > MAX_BODY + 1024){
          tooBig = true;
          res.writeHead(413, {"Content-Type":"application/json"});
          res.end('{"error":"too large"}');
          body = "";
        }
      });
      req.on("end", () => {
        if (tooBig) return;
        let j;
        try { j = JSON.parse(body); } catch { return deny(400, '{"error":"bad json"}'); }
        if (!j || !j.name || typeof j.data !== "string"){ return deny(400, '{"error":"missing name/data"}'); }
        if (j.data.length > MAX_BODY){ return deny(413, '{"error":"too large"}'); }
        // random suffix defeats same-millisecond same-name collisions (PWA fires concurrent POSTs)
        const id = tsId() + "_" + crypto.randomBytes(3).toString("hex");
        const sn = safeName(j.name);
        const fname = `${id}_${sn}`;
        try {
          fs.writeFileSync(path.join(uploadRoot, fname), Buffer.from(j.data, "base64"));
          // CONCURRENCY NOTE: readInbox+push+writeInbox use SYNCHRONOUS fs — this RMW runs
          // atomically on the single-threaded event loop (no await/yield), so concurrent uploads
          // cannot interleave or lose entries. Do NOT switch to async fs without a lock.
          const r = readInbox(uploadRoot);
          let inbox;
          if (r.ok) { inbox = r.arr; }
          else { // corrupt inbox: back up for recovery, start fresh
            try { fs.renameSync(path.join(uploadRoot, "_inbox.json"), path.join(uploadRoot, "_inbox.json.corrupt-" + tsId())); } catch {}
            inbox = [];
          }
          inbox.push({ id, file: fname, origName: j.origName || j.name, name: j.name, tag: j.tag || "日常", ts: id, status: "pending" });
          writeInbox(uploadRoot, inbox);
          res.writeHead(200, {"Content-Type":"application/json"});
          res.end(JSON.stringify({ ok: true, id }));
        } catch (e){
          res.writeHead(500, {"Content-Type":"application/json"});
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
      return;
    }

    if (req.method === "GET" && req.url.split("?")[0] === "/status"){
      if (!authed){ return deny(401, '{"error":"unauthorized"}'); }
      const r = readInbox(uploadRoot);
      let sum;
      if (r.ok) {
        const inbox = r.arr;
        sum = { total: inbox.length, pending: 0, processed: 0, failed: 0 };
        for (const e of inbox) if (sum[e.status] != null) sum[e.status]++;
      } else {
        sum = { total: 0, pending: 0, processed: 0, failed: 0, error: r.error };
      }
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify(sum));
      return;
    }

    if (req.method === "GET"){
      const appDir = path.join(__dirname, "app");
      const u = req.url.split("?")[0];
      let rel;
      if (u === "/") { rel = "index.html"; }
      else { try { rel = decodeURIComponent(u.slice(1)); } catch { return deny(400, '{"error":"bad uri"}'); } }
      const fp = path.join(appDir, rel);
      // containment WITH separator (prevents sibling "app-*" prefix traversal)
      const inside = fp === appDir || fp.startsWith(appDir + path.sep);
      let isFile = false;
      try { isFile = inside && fs.statSync(fp).isFile(); } catch { isFile = false; }
      if (isFile){
        const ext = path.extname(fp).toLowerCase();
        const types = { ".html":"text/html; charset=utf-8", ".js":"text/javascript", ".css":"text/css", ".json":"application/json", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon", ".webmanifest":"application/manifest+json" };
        res.writeHead(200, {"Content-Type": types[ext] || "application/octet-stream"});
        fs.createReadStream(fp).pipe(res);
        return;
      }
      res.writeHead(404, {"Content-Type":"text/plain"});
      res.end("not found");
      return;
    }

    return deny(405, '{"error":"method not allowed"}');
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
  });
}
