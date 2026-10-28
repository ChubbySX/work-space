// test-bridge.js — no framework; node built-in http + assert
// Task-1 baseline:  auth(401/200) / upload{file,inbox,status} / oversize(413)
//                  / malformed-URI(400) / /?query(200) / sibling-containment(404)
//                  / bad-token-large-body(401 clean) / parallel-same-name / corrupt-inbox
// Upload cluster (1-7):  /upload_raw{tag, default-tag, missing-name, oversize}
//                  /albums{name,cover} + mirror real content/daily + cover file exists
//                  /thumb(200 webp) / /history(newest-first) / /info / /monitor-data
//                  /monitor(page) / /vendor/qrcode.js / DELETE /monitor-item{401,404,400,ok removes}
const http = require("http"), assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const { startServer } = require("./bridge");
const tmpRoot = path.join(os.tmpdir(), "mu-test-" + Date.now());
fs.mkdirSync(tmpRoot, { recursive: true });
// sibling "app-test" next to app/ (for prefix-containment test)
const appDir = path.join(__dirname, "app");
const sibDir = path.join(__dirname, "app-test");
fs.mkdirSync(sibDir, { recursive: true });
fs.writeFileSync(path.join(sibDir, "leak.txt"), "SECRET-TOKEN-LIKE");
const cfg = { token: "t-ok", bindPort: 0, uploadRoot: tmpRoot, maxRaw: 1024 * 1024 };
const srv = startServer(cfg);
const { port } = srv.address();
let checks = 0;
function ok(cond, msg){ checks++; assert.ok(cond, msg); }
function eq(a, b, msg){ checks++; assert.strictEqual(a, b, msg + " | got " + a); }
function req(method, url, obj, token, rawBody){
  return new Promise(res => {
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    const body = rawBody !== undefined ? rawBody : (obj ? JSON.stringify(obj) : null);
    if (body) headers["Content-Type"] = "application/json";
    const r = http.request({ port, method, path: url, headers }, rr => {
      let d = ""; rr.on("data", c => d += c); rr.on("end", () => res({ code: rr.statusCode, body: d }));
    });
    r.on("error", e => res({ code: -1, body: String(e) }));
    if (body) r.write(body);
    r.end();
  });
}
function wipe(){ for (const f of fs.readdirSync(tmpRoot)) { try { fs.unlinkSync(path.join(tmpRoot, f)); } catch {} } }
function cleanup(){ srv.close(); try { fs.unlinkSync(path.join(sibDir,"leak.txt")); fs.rmdirSync(sibDir); } catch {} }
(async () => {
  try {
    // --- Task 1 baseline (still green) ---
    wipe();
    let r = await req("POST", "/upload", { name: "a.jpg", data: "dGVzdA==" }, "t-bad");
    eq(r.code, 401, "bad token 401");
    r = await req("POST", "/upload", { name: "a.jpg", data: "dGVzdA==" }, "t-ok");
    eq(r.code, 200, "good token 200");
    const j = JSON.parse(r.body);
    ok(j.ok && j.id, "resp {ok,id}");
    ok(fs.existsSync(path.join(tmpRoot, j.id + "_a.jpg")), "file written");
    let ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib.length, 1, "inbox 1");
    eq(ib[0].status, "pending", "pending");
    eq(ib[0].tag, "日常", "default tag 日常");
    eq(ib[0].name, "a.jpg", "name a.jpg");

    // --- /albums: auth + array + {name,cover} shape + mirrors real content/daily ---
    r = await req("GET", "/albums", null, "t-ok");
    eq(r.code, 200, "/albums 200");
    const list = JSON.parse(r.body).albums;
    ok(Array.isArray(list), "/albums array");
    ok(list.every(a => typeof a.name === "string" && (a.cover === null || typeof a.cover === "string")), "albums {name,cover} shape");
    r = await req("GET", "/albums", null, "t-bad");
    eq(r.code, 401, "/albums 401 bad token");
    {
      const dailyDir = path.join(__dirname, "..", "..", "content", "daily");
      const real = fs.readdirSync(dailyDir).filter(n => { try { return fs.statSync(path.join(dailyDir, n)).isDirectory(); } catch { return false; } });
      for (const name of real) ok(list.some(a => a.name === name), "/albums missing " + name);
      const withCover = list.find(a => a.cover);
      ok(!!withCover, "at least one album cover");
      const fp = path.join(__dirname, "..", "..", "content", ".thumbs", ...withCover.cover.split("/"));
      ok(fs.existsSync(fp), "cover file exists: " + withCover.cover);
      r = await req("GET", "/thumb?p=" + encodeURIComponent(withCover.cover), null, null);
      eq(r.code, 200, "thumb 200");
      ok(r.body.startsWith("RIFF") && r.body.indexOf("WEBP") > 0, "thumb is webp body");
    }

    // --- /status ---
    r = await req("GET", "/status", null, "t-ok");
    eq(JSON.parse(r.body).pending, 1, "status pending 1");
    r = await req("POST", "/upload", { name: "b.jpg", data: "dGVzdA==" }, null);
    eq(r.code, 401, "missing token 401");
    r = await req("POST", "/upload", { name: "big.jpg", data: "A".repeat(13 * 1024 * 1024) }, "t-ok");
    eq(r.code, 413, "oversize 413");

    // --- #10 GET /?foo=bar -> 200 index.html (not 404) ---
    r = await req("GET", "/?foo=bar", null, null);
    eq(r.code, 200, "#10 /?query 200");
    ok(r.body.indexOf("<html") >= 0 || r.body.indexOf("<!DOCTYPE") >= 0, "#10 serves index");

    // --- #1 malformed URI -> 400 (not crash) ---
    r = await req("GET", "/%ZZ", null, null);
    eq(r.code, 400, "#1 malformed URI 400");
    r = await req("GET", "/%E2%82", null, null);
    eq(r.code, 400, "#1 truncated UTF-8 400");

    // --- #3 sibling containment: /../app-test/leak.txt -> 404 (not served) ---
    r = await req("GET", "/../app-test/leak.txt", null, null);
    eq(r.code, 404, "#3 sibling 404");
    ok(r.body.indexOf("SECRET") < 0, "#3 leak not served");

    // --- #9 bad token + large body -> 401 clean (not -1/ECONNRESET) ---
    wipe();
    r = await req("POST", "/upload", null, "t-bad", JSON.stringify({ name: "x.jpg", data: "A".repeat(2 * 1024 * 1024) }));
    eq(r.code, 401, "#9 bad token + large body 401");

    // --- #2/#5 concurrency: N parallel same-name -> N distinct files + N inbox ---
    wipe();
    const N = 5;
    const ups = [];
    for (let i = 0; i < N; i++) ups.push(req("POST", "/upload", { name: "same.jpg", data: "dGVzdA==" }, "t-ok"));
    const rs = await Promise.all(ups);
    for (const x of rs) eq(x.code, 200, "#2 parallel 200");
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib.length, N, "#2/#5 inbox N");
    eq(new Set(ib.map(e => e.file)).size, N, "#2 N distinct files");

    // --- #4 corrupt _inbox.json -> /status error + upload backs up corrupt ---
    wipe();
    fs.writeFileSync(path.join(tmpRoot, "_inbox.json"), "{NOT JSON", "utf8");
    r = await req("GET", "/status", null, "t-ok");
    eq(r.code, 200, "#4 status 200 on corrupt");
    ok(JSON.parse(r.body).error, "#4 status has error");
    r = await req("POST", "/upload", { name: "c.jpg", data: "dGVzdA==" }, "t-ok");
    eq(r.code, 200, "#4 upload proceeds on corrupt");
    ok(fs.readdirSync(tmpRoot).some(f => f.indexOf("corrupt") >= 0), "#4 corrupt backed up");
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib.length, 1, "#4 fresh inbox 1");

    // --- /upload_raw: binary body + tag + default tag + missing name + oversize ---
    wipe();
    r = await req("POST", "/upload_raw?name=raw.jpg&tag=" + encodeURIComponent("手工艺人"), null, "t-bad", Buffer.from("abc"));
    eq(r.code, 401, "raw bad token 401");
    r = await req("POST", "/upload_raw?name=raw.jpg&tag=" + encodeURIComponent("手工艺人"), null, "t-ok", Buffer.from("RAWBYTES"));
    eq(r.code, 200, "raw 200");
    const rj = JSON.parse(r.body);
    ok(rj.ok && rj.id, "raw {ok,id}");
    ok(fs.existsSync(path.join(tmpRoot, rj.id + "_raw.jpg")), "raw file written");
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib.length, 1, "raw inbox 1");
    eq(ib[0].name, "raw.jpg", "raw name");
    eq(ib[0].tag, "手工艺人", "raw tag set");
    assert.deepStrictEqual(fs.readFileSync(path.join(tmpRoot, ib[0].file)), Buffer.from("RAWBYTES"), "raw bytes roundtrip"); checks++;
    wipe();
    r = await req("POST", "/upload_raw?name=cv.jpg&tag=" + encodeURIComponent("手工艺人") + "&cover=1", null, "t-ok", Buffer.from("COVER"));
    eq(r.code, 200, "raw cover 200");
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib[0].cover, true, "raw cover flag stored");
    r = await req("POST", "/upload_raw?name=", null, "t-ok", Buffer.from("abc"));
    eq(r.code, 400, "raw missing name 400");
    wipe();
    r = await req("POST", "/upload_raw?name=dt.jpg", null, "t-ok", Buffer.from("XYZ"));
    eq(r.code, 200, "raw default-tag 200");
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib[0].tag, "日常", "raw default tag 日常");
    wipe();
    r = await req("POST", "/upload_raw?name=big.bin", null, "t-ok", Buffer.alloc(1024 * 1024 + 1024, 65));
    eq(r.code, 413, "raw oversize 413 (maxRaw=1MB)");

    // --- /history: auth + newest-first + fields ---
    wipe();
    await req("POST", "/upload", { name: "h1.jpg", data: "dGVzdA==" }, "t-ok");
    await req("POST", "/upload_raw?name=h2.jpg", null, "t-ok", Buffer.from("hi"));
    r = await req("GET", "/history", null, "t-ok");
    eq(r.code, 200, "history 200");
    const items = JSON.parse(r.body).items;
    eq(items.length, 2, "history 2 items");
    eq(items[0].name, "h2.jpg", "history newest first");
    ok(items.every(it => typeof it.name === "string" && typeof it.status === "string" && it.ts), "history fields");
    ok(items.every(it => it.size === null || typeof it.size === "number"), "history size field");
    r = await req("GET", "/history", null, "t-bad");
    eq(r.code, 401, "history 401");

    // --- /info / monitor-data / monitor / vendor qrcode ---
    r = await req("GET", "/info", null, null);
    eq(r.code, 200, "info 200");
    const info = JSON.parse(r.body);
    ok(Array.isArray(info.ips) && typeof info.port === "number" && info.token === "t-ok", "info {ips,port,token}");
    r = await req("GET", "/monitor-data", null, null);
    eq(r.code, 200, "monitor-data 200");
    const md = JSON.parse(r.body);
    ok(Array.isArray(md.inflight) && Array.isArray(md.recent), "monitor-data arrays");
    r = await req("GET", "/monitor", null, null);
    eq(r.code, 200, "monitor 200");
    ok(r.body.indexOf("上传监控") >= 0, "monitor page title");
    r = await req("GET", "/vendor/qrcode.js", null, null);
    eq(r.code, 200, "vendor qrcode 200");
    ok(r.body.indexOf("qrcode") >= 0, "vendor qrcode body");

    // --- DELETE /monitor-item ---
    r = await req("DELETE", "/monitor-item?id=x", null, "t-bad");
    eq(r.code, 401, "delete 401");
    r = await req("DELETE", "/monitor-item?id=", null, "t-ok");
    eq(r.code, 400, "delete missing id 400");
    r = await req("DELETE", "/monitor-item?id=x", null, "t-ok");
    eq(r.code, 404, "delete not-found 404");
    wipe();
    r = await req("POST", "/upload_raw?name=del.jpg", null, "t-ok", Buffer.from("DEL"));
    const delId = JSON.parse(r.body).id;
    const delFname = delId + "_del.jpg";
    ok(fs.existsSync(path.join(tmpRoot, delFname)), "del file exists");
    r = await req("DELETE", "/monitor-item?id=" + encodeURIComponent(delId), null, "t-ok");
    eq(r.code, 200, "delete ok");
    ok(!fs.existsSync(path.join(tmpRoot, delFname)), "del file removed");
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    eq(ib.length, 0, "inbox empty after delete");

    // --- /request + /requests: 手机端发指令/发布请求（落 _requests.json）---
    r = await req("POST", "/request", { text: "试试" }, "t-bad");
    eq(r.code, 401, "request bad token 401");
    r = await req("POST", "/request", { text: "   " }, "t-ok");
    eq(r.code, 400, "request empty text 400");
    r = await req("POST", "/request", { intent: "publish", text: "发布现在的内容，把重点照片处理下" }, "t-ok");
    eq(r.code, 200, "request publish 200");
    r = await req("POST", "/request", { text: "记得配文" }, "t-ok");
    eq(r.code, 200, "request note 200");
    const reqs = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_requests.json"), "utf8"));
    ok(Array.isArray(reqs) && reqs.length === 2, "requests file 2 entries");
    eq(reqs[0].intent, "publish", "request intent publish");
    ok(reqs.every(x => x.id && x.text && x.status === "pending" && x.ts), "request fields");
    r = await req("GET", "/requests", null, "t-ok");
    eq(r.code, 200, "requests 200");
    const ritems = JSON.parse(r.body).items;
    eq(ritems.length, 2, "requests 2 items");
    eq(ritems[0].text, "记得配文", "requests newest first");
    r = await req("GET", "/requests", null, "t-bad");
    eq(r.code, 401, "requests 401");
    r = await req("GET", "/monitor-data", null, null);
    ok(JSON.parse(r.body).requests.length >= 2, "monitor-data includes requests");

    console.log("bridge OK (" + checks + " checks)");
    cleanup();
    process.exit(0);
  } catch (e) {
    console.error("bridge FAIL:", e.message);
    cleanup();
    process.exit(1);
  }
})();