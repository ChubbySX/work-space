// test-bridge.js — no framework; node built-in http + assert
const http = require("http"), assert = require("assert"), fs = require("fs"), path = require("path");
const { startServer } = require("./bridge");
const tmpRoot = path.join(require("os").tmpdir(), "mu-test-" + Date.now());
fs.mkdirSync(tmpRoot, { recursive: true });
const cfg = { token: "t-ok", bindPort: 0, uploadRoot: tmpRoot }; // port 0 = ephemeral
const srv = startServer(cfg);
const { port } = srv.address();
function req(method, url, body, token){
  return new Promise(res => {
    const headers = {};
    if (token) headers["Authorization"] = "Bearer " + token;
    if (body) headers["Content-Type"] = "application/json";
    const r = http.request({ port, method, path: url, headers }, rr => {
      let d = ""; rr.on("data", c => d += c); rr.on("end", () => res({ code: rr.statusCode, body: d }));
    });
    r.on("error", e => res({ code: -1, body: String(e) }));
    if (body) r.write(JSON.stringify(body));
    r.end();
  });
}
(async () => {
  try {
    // 1. bad token -> 401
    let r = await req("POST", "/upload", { name: "a.jpg", data: "dGVzdA==" }, "t-bad");
    assert.strictEqual(r.code, 401, "bad token should 401, got " + r.code);
    // 2. good token -> 200 + {ok, id}, file written, inbox appended
    r = await req("POST", "/upload", { name: "a.jpg", data: "dGVzdA==" }, "t-ok");
    assert.strictEqual(r.code, 200, "good token should 200, got " + r.code);
    const j = JSON.parse(r.body);
    assert.ok(j.ok && j.id, "response should have {ok, id}, got " + r.body);
    const fp = path.join(tmpRoot, j.id + "_a.jpg");
    assert.ok(fs.existsSync(fp), "file should be written: " + fp);
    const inbox = JSON.parse(fs.readFileSync(path.join(tmpRoot, "_inbox.json"), "utf8"));
    assert.strictEqual(inbox.length, 1, "inbox should have 1 entry, got " + inbox.length);
    assert.strictEqual(inbox[0].status, "pending", "entry status should be pending");
    assert.strictEqual(inbox[0].origName, "a.jpg", "entry origName should be a.jpg");
    // 3. GET /status -> pending:1
    r = await req("GET", "/status", null, "t-ok");
    assert.strictEqual(JSON.parse(r.body).pending, 1, "status pending should be 1");
    // 4. missing token -> 401
    r = await req("POST", "/upload", { name: "b.jpg", data: "dGVzdA==" }, null);
    assert.strictEqual(r.code, 401, "missing token should 401, got " + r.code);
    // 5. oversize -> 413 (cap 12MB; send ~13MB)
    const big = "A".repeat(13 * 1024 * 1024);
    r = await req("POST", "/upload", { name: "big.jpg", data: big }, "t-ok");
    assert.strictEqual(r.code, 413, "oversize should 413, got " + r.code);
    console.log("bridge OK");
    srv.close();
    process.exit(0);
  } catch (e) {
    console.error("bridge FAIL:", e.message);
    srv.close();
    process.exit(1);
  }
})();
