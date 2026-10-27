// test-bridge.js — no framework; node built-in http + assert
// Covers: auth(401/200) + file+inbox + status + oversize(413)  [Task 1]
//       + malformed-URI(400) + /?query(200) + sibling-containment(404)  [#1/#10/#3]
//       + bad-token-large-body(401 clean)  [#9]
//       + parallel-same-name(N distinct)  [#2/#5]
//       + corrupt-inbox(error field + backup)  [#4]
const http = require("http"), assert = require("assert"), fs = require("fs"), path = require("path"), os = require("os");
const { startServer } = require("./bridge");
const tmpRoot = path.join(os.tmpdir(), "mu-test-" + Date.now());
fs.mkdirSync(tmpRoot, { recursive: true });
// sibling "app-test" next to app/ (for #3 prefix-containment test)
const appDir = path.join(__dirname, "app");
const sibDir = path.join(__dirname, "app-test");
fs.mkdirSync(sibDir, { recursive: true });
fs.writeFileSync(path.join(sibDir, "leak.txt"), "SECRET-TOKEN-LIKE");
const cfg = { token: "t-ok", bindPort: 0, uploadRoot: tmpRoot };
const srv = startServer(cfg);
const { port } = srv.address();
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
    assert.strictEqual(r.code, 401, "bad token 401 got " + r.code);
    r = await req("POST", "/upload", { name: "a.jpg", data: "dGVzdA==" }, "t-ok");
    assert.strictEqual(r.code, 200, "good token 200 got " + r.code);
    const j = JSON.parse(r.body);
    assert.ok(j.ok && j.id, "resp {ok,id} got " + r.body);
    assert.ok(fs.existsSync(path.join(tmpRoot, j.id + "_a.jpg")), "file written");
    let ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    assert.strictEqual(ib.length, 1, "inbox 1 got " + ib.length);
    assert.strictEqual(ib[0].status, "pending", "pending");
    assert.strictEqual(ib[0].tag, "日常", "default tag 日常 got " + ib[0].tag);
    assert.strictEqual(ib[0].name, "a.jpg", "name a.jpg got " + ib[0].name);
    // --- /albums (new): existing daily album names + auth ---
    r = await req("GET", "/albums", null, "t-ok");
    assert.strictEqual(r.code, 200, "/albums 200 got " + r.code);
    assert.ok(Array.isArray(JSON.parse(r.body).albums), "/albums array got " + r.body);
    r = await req("GET", "/albums", null, "t-bad");
    assert.strictEqual(r.code, 401, "/albums 401 bad token got " + r.code);
    r = await req("GET", "/status", null, "t-ok");
    assert.strictEqual(JSON.parse(r.body).pending, 1, "status pending 1");
    r = await req("POST", "/upload", { name: "b.jpg", data: "dGVzdA==" }, null);
    assert.strictEqual(r.code, 401, "missing token 401");
    r = await req("POST", "/upload", { name: "big.jpg", data: "A".repeat(13 * 1024 * 1024) }, "t-ok");
    assert.strictEqual(r.code, 413, "oversize 413 got " + r.code);

    // --- #10 GET /?foo=bar -> 200 index.html (not 404) ---
    r = await req("GET", "/?foo=bar", null, null);
    assert.strictEqual(r.code, 200, "#10 /?query 200 got " + r.code);
    assert.ok(r.body.indexOf("<html") >= 0 || r.body.indexOf("<!DOCTYPE") >= 0, "#10 serves index");

    // --- #1 malformed URI -> 400 (not crash) ---
    r = await req("GET", "/%ZZ", null, null);
    assert.strictEqual(r.code, 400, "#1 malformed URI 400 got " + r.code);
    r = await req("GET", "/%E2%82", null, null);
    assert.strictEqual(r.code, 400, "#1 truncated UTF-8 400 got " + r.code);

    // --- #3 sibling containment: /../app-test/leak.txt -> 404 (not served) ---
    r = await req("GET", "/../app-test/leak.txt", null, null);
    assert.strictEqual(r.code, 404, "#3 sibling 404 got " + r.code);
    assert.ok(r.body.indexOf("SECRET") < 0, "#3 leak not served");

    // --- #9 bad token + large body -> 401 clean (not -1/ECONNRESET) ---
    wipe();
    r = await req("POST", "/upload", null, "t-bad", JSON.stringify({ name: "x.jpg", data: "A".repeat(2 * 1024 * 1024) }));
    assert.strictEqual(r.code, 401, "#9 bad token + large body 401 got " + r.code);

    // --- #2/#5 concurrency: N parallel same-name -> N distinct files + N inbox ---
    wipe();
    const N = 5;
    const ups = [];
    for (let i = 0; i < N; i++) ups.push(req("POST", "/upload", { name: "same.jpg", data: "dGVzdA==" }, "t-ok"));
    const rs = await Promise.all(ups);
    for (const x of rs) assert.strictEqual(x.code, 200, "#2 parallel 200 got " + x.code);
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    assert.strictEqual(ib.length, N, "#2/#5 inbox N=" + ib.length + " want " + N);
    const fnames = new Set(ib.map(e => e.file));
    assert.strictEqual(fnames.size, N, "#2 N distinct files got " + fnames.size);

    // --- #4 corrupt _inbox.json -> /status error + upload backs up corrupt ---
    wipe();
    fs.writeFileSync(path.join(tmpRoot, "_inbox.json"), "{NOT JSON", "utf8");
    r = await req("GET", "/status", null, "t-ok");
    assert.strictEqual(r.code, 200, "#4 status 200 on corrupt");
    assert.ok(JSON.parse(r.body).error, "#4 status has error got " + r.body);
    r = await req("POST", "/upload", { name: "c.jpg", data: "dGVzdA==" }, "t-ok");
    assert.strictEqual(r.code, 200, "#4 upload proceeds on corrupt got " + r.code);
    const backs = fs.readdirSync(tmpRoot).filter(f => f.indexOf("corrupt") >= 0);
    assert.ok(backs.length >= 1, "#4 corrupt backed up got " + backs);
    ib = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    assert.strictEqual(ib.length, 1, "#4 fresh inbox 1 got " + ib.length);

    console.log("bridge OK (18 checks)");
    cleanup();
    process.exit(0);
  } catch (e) {
    console.error("bridge FAIL:", e.message);
    cleanup();
    process.exit(1);
  }
})();
