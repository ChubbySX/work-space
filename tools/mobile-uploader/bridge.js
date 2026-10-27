// bridge.js — mobile-uploader bridge: HTTP server, pure node (no deps).
// POST /upload {name, data(base64)} + Bearer token -> store file + append _inbox.json
// GET /status -> inbox summary {total,pending,processed,failed}
// GET / -> serve app/ files (Task 2)
const http = require("http"), fs = require("fs"), path = require("path");

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
function readInbox(root){
  try { return JSON.parse(fs.readFileSync(path.join(root, "_inbox.json"), "utf8")); }
  catch { return []; }
}
function writeInbox(root, arr){
  fs.writeFileSync(path.join(root, "_inbox.json"), JSON.stringify(arr, null, 2), "utf8");
}

function startServer(cfg){
  const token = cfg.token, uploadRoot = cfg.uploadRoot, bindPort = cfg.bindPort || 0;
  const srv = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

    const auth = req.headers["authorization"] || "";
    const tok = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    const authed = tok === token && !!token;

    if (req.method === "POST" && req.url === "/upload"){
      if (!authed){ res.writeHead(401, {"Content-Type":"application/json"}); res.end('{"error":"unauthorized"}'); return; }
      let body = "", tooBig = false;
      req.on("data", c => {
        if (tooBig) return; // drain: discard further data after 413 sent
        body += c;
        if (body.length > MAX_BODY + 1024){
          tooBig = true;
          res.writeHead(413, {"Content-Type":"application/json"});
          res.end('{"error":"too large"}');
          body = ""; // free mem
        }
      });
      req.on("end", () => {
        if (tooBig) return;
        let j;
        try { j = JSON.parse(body); } catch { res.writeHead(400, {"Content-Type":"application/json"}); res.end('{"error":"bad json"}'); return; }
        if (!j || !j.name || typeof j.data !== "string"){ res.writeHead(400, {"Content-Type":"application/json"}); res.end('{"error":"missing name/data"}'); return; }
        if (j.data.length > MAX_BODY){ res.writeHead(413, {"Content-Type":"application/json"}); res.end('{"error":"too large"}'); return; }
        const id = tsId();
        const sn = safeName(j.name);
        const fname = `${id}_${sn}`;
        try {
          fs.writeFileSync(path.join(uploadRoot, fname), Buffer.from(j.data, "base64"));
          const inbox = readInbox(uploadRoot);
          inbox.push({ id, file: fname, origName: j.name, ts: id, status: "pending" });
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

    if (req.method === "GET" && req.url === "/status"){
      if (!authed){ res.writeHead(401, {"Content-Type":"application/json"}); res.end('{"error":"unauthorized"}'); return; }
      const inbox = readInbox(uploadRoot);
      const sum = { total: inbox.length, pending: 0, processed: 0, failed: 0 };
      for (const e of inbox) if (sum[e.status] != null) sum[e.status]++;
      res.writeHead(200, {"Content-Type":"application/json"});
      res.end(JSON.stringify(sum));
      return;
    }

    if (req.method === "GET"){
      const appDir = path.join(__dirname, "app");
      const rel = req.url === "/" ? "index.html" : decodeURIComponent(req.url.slice(1).split("?")[0]);
      const fp = path.join(appDir, rel);
      if (fp.startsWith(appDir) && fs.existsSync(fp) && fs.statSync(fp).isFile()){
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

    res.writeHead(405); res.end("method not allowed");
  });
  srv.listen(bindPort);
  return srv;
}

module.exports = { startServer };
