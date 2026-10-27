# 移动上传器 + 桥接 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A mobile PWA + PC Node bridge that lets the user upload photos from a phone → staged on PC (`待上传/` + `_inbox.json`) → personal-website skill processes the batch on manual trigger ("处理待上传").

**Architecture:** PWA (vanilla HTML/JS, base64 JSON POST) → Node bridge (pure `http` module, zero deps, DSH node.exe) → `待上传/<ts>_<名>.jpg` + `_inbox.json` → [手动触发] → personal-website 技能 阶段1 reads `_inbox.json` batch → classify→压缩→归位→txt → 阶段2 构建 → 聊天报 → 用户发布.

**Tech Stack:** Node `http` (no npm/npx — DSH node.exe only), vanilla JS PWA (no build), pwsh for behavioral tests, personal-website skill (markdown).

**Spec:** `docs/superpowers/specs/2026-10-27-mobile-uploader-design.md`

## Global Constraints

- DSH node.exe: `C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` — **no npm/npx**; bridge uses pure Node `http`/`fs`/`path`, zero external deps.
- 待上传 root: `D:\DS harnessw\work station\待上传`（work-station，仓库外；bridge writes `<ts>_<safename>.jpg` + `_inbox.json` here；**不动** `待压缩/`、`已压缩/`）。
- bridge code lives in `personal-website/tools/mobile-uploader/`（git-tracked）；`_bridge_config.json` has the token → **GITIGNORED**.
- token + port + uploadRoot in `_bridge_config.json`: `{token, bindPort:8390, uploadRoot:"D:\\DS harnessw\\work station\\待上传"}`.
- upload wire format: base64 JSON `{name, data}` (zero-dep; +33% size, MVP photos only — videos/large files = follow-up).
- PWA: vanilla HTML/JS, no build step, served by bridge `GET /`.
- skill adaptation edits BOTH `docs/superpowers/skills/personal-website.skill.md` (source) + live `C:\Users\23003\.dsh\skills\personal-website\SKILL.md` (keep in sync).
- no real-time trigger (④-③ ACP not feasible); manual trigger only ("处理待上传").
- 构建不碰 git；发布用户触发（github-push GUI 已有）。

## Review Focus

1. **token 缺失/错 → 401，不写盘**（安全；不能因为一个缺 token 的请求污染 待上传/）。
2. **并发上传 → `_inbox.json` 不丢项/不串行阻塞**（多张图同时 POST，清单追加要原子/不互踩）。
3. **超大 base64 → bridge 不崩**（设内存上限，超 N MB 拒绝 413，别 OOM）。
4. **同名文件 → 不覆盖**（`<ts>_<safename>` 前缀保证唯一；safeName 去特殊字符）。
5. **skill 读 `_inbox.json` 时清单损坏/空 → 不崩，报告**（JSON 解析失败/无 pending → 告知用户"清单空/损坏"，不静默跳过）。

---

## File Structure

- Create `tools/mobile-uploader/bridge.js` — Node http server (GET /, GET /status, POST /upload). Exports `startServer(config)` + `__main` guard (read config + listen).
- Create `tools/mobile-uploader/_bridge_config.json` — `{token, bindPort, uploadRoot}` (GITIGNORED).
- Create `tools/mobile-uploader/test-bridge.js` — Node test (built-in http + assert, no framework).
- Create `tools/mobile-uploader/app/index.html` — PWA shell (file input + status list).
- Create `tools/mobile-uploader/app/app.js` — readAsDataURL → base64 → POST → render status.
- Create `tools/mobile-uploader/app/manifest.json` — PWA manifest (name, display:standalone).
- Create `tools/mobile-uploader/启动桥接.bat` — launch DSH node.exe bridge.js.
- Modify `tools/mobile-uploader/.gitignore` (or root .gitignore) — `_bridge_config.json`.
- Modify `docs/superpowers/skills/personal-website.skill.md` + live `SKILL.md` — 阶段1 add inbox-batch path.

---

## Task 1: Bridge Node service

**Files:**
- Create: `tools/mobile-uploader/bridge.js`
- Create: `tools/mobile-uploader/_bridge_config.json` (gitignored)
- Create: `tools/mobile-uploader/test-bridge.js`
- Modify: `tools/mobile-uploader/.gitignore` (add `_bridge_config.json`)

**Interfaces:**
- Produces: `bridge.js` exports `startServer(config) -> http.Server` where `config = {token, bindPort, uploadRoot}`. Routes: `POST /upload` (auth Bearer, JSON `{name, data}` → write file + append `_inbox.json` → `{ok, id}`); `GET /status` (→ `{pending, ok, fail, total}` from `_inbox.json`); `GET /` (serve `app/index.html` if exists else `200 "bridge up"`).
- `_inbox.json` entry shape: `{id, file, origName, ts, status}` (status ∈ pending|processed|failed).

- [ ] **Step 1: Write `test-bridge.js` (failing)**

```js
// test-bridge.js — no framework; node built-in http + assert
const http = require("http"), assert = require("assert"), fs = require("fs"), path = require("path");
const { startServer } = require("./bridge");
const tmpRoot = path.join(require("os").tmpdir(), "mu-test-" + Date.now());
fs.mkdirSync(tmpRoot, { recursive: true });
const cfg = { token:"t-ok", bindPort:0, uploadRoot: tmpRoot }; // port 0 = ephemeral
const srv = startServer(cfg);
const { port } = srv.address();
function req(method, path, body, token){
  return new Promise(res => {
    const r = http.request({port, method, path, headers: token?{Authorization:"Bearer "+token}:{}, "Content-Type":"application/json"}, rr=>{
      let d=""; rr.on("data",c=>d+=c); rr.on("end",()=>res({code:rr.statusCode, body:d}));
    });
    if(body) r.write(JSON.stringify(body)); r.end();
  });
}
(async()=>{
  // 1. bad token → 401
  let r = await req("POST","/upload",{name:"a.jpg", data:"dGVzdA=="},"t-bad");
  assert.strictEqual(r.code, 401);
  // 2. good token → 200 + {ok, id}, file written, inbox appended
  r = await req("POST","/upload",{name:"a.jpg", data:"dGVzdA=="},"t-ok");
  assert.strictEqual(r.code, 200);
  const j = JSON.parse(r.body); assert.ok(j.ok && j.id);
  assert.ok(fs.existsSync(path.join(tmpRoot, j.id+"_a.jpg")));
  const inbox = JSON.parse(fs.readFileSync(path.join(tmpRoot,"_inbox.json"),"utf8"));
  assert.strictEqual(inbox.length, 1);
  assert.strictEqual(inbox[0].status, "pending");
  // 3. GET /status → pending:1
  r = await req("GET","/status",null,"t-ok");
  assert.strictEqual(JSON.parse(r.body).pending, 1);
  // 4. missing token → 401
  r = await req("POST","/upload",{name:"b.jpg",data:"dGVzdA=="},null);
  assert.strictEqual(r.code, 401);
  console.log("bridge OK"); srv.close(); process.exit(0);
})();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe tools\mobile-uploader\test-bridge.js`  
Expected: FAIL — `Cannot find module './bridge'`

- [ ] **Step 3: Implement `bridge.js`**

`startServer(config)` creates `http.createServer`. Key logic:
- `POST /upload`: check `Authorization: Bearer <config.token>` → mismatch/missing → `401` (Review Focus #1). Collect body with a **size cap** (e.g. 12 MB; Review Focus #3 → 413 if exceeded). `JSON.parse` → validate `{name, data}`. `safeName = origName.replace(/[^\w.\u4e00-\u9fff-]/g,"_")` (keep CJK + word + .-). `id = Date.now()`. Write `fs.writeFileSync(path.join(uploadRoot, id+"_"+safeName), Buffer.from(data,"base64"))`. **Append `_inbox.json` atomically**: read (or `[]`), push entry, write back (Review Focus #2 — for MVP, synchronous read-modify-write per request; note concurrent risk + TODO lock if needed). Return `{ok:true, id}`.
- `GET /status`: read `_inbox.json` (handle missing/corrupt → Review Focus #5 → return `{pending:0, total:0, error:"清单不存在或损坏"}`), count statuses, return JSON.
- `GET /`: if `app/index.html` exists → serve it; else `200 "bridge up"`.
- `__main`: if `require.main===module`, read `_bridge_config.json` (next to script), `startServer` + `listen(bindPort)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `...\node.exe tools\mobile-uploader\test-bridge.js`  
Expected: `bridge OK`, exit 0.

- [ ] **Step 5: Commit**

```bash
git add tools/mobile-uploader/bridge.js tools/mobile-uploader/test-bridge.js tools/mobile-uploader/.gitignore
git commit -m "feat(mobile-uploader): Node bridge — /upload /status + token auth"
```
(`_bridge_config.json` stays gitignored; create it locally with a real token.)

---

## Task 2: PWA app

**Files:**
- Create: `tools/mobile-uploader/app/index.html`
- Create: `tools/mobile-uploader/app/app.js`
- Create: `tools/mobile-uploader/app/manifest.json`
- Modify: `tools/mobile-uploader/bridge.js` (GET / already serves `app/index.html` from Task 1)

**Interfaces:**
- `index.html`: `<input type=file accept=image/* multiple>`, status list `<ul id=list>`, `<script src=app.js>`, manifest link.
- `app.js`: `fileInput.change` → for each file, `FileReader.readAsDataURL` → strip `data:...;base64,` prefix → `POST /upload` JSON `{name:file.name, data}` with `Authorization: Bearer <token>` (token from localStorage) → render `{file, status}` in list.
- `manifest.json`: `{name:"上传器", display:"standalone", start_url:"/"}`.

- [ ] **Step 1: Write `app/index.html` + `app.js` + `manifest.json`**

`index.html`: viewport meta, manifest link, file input (capture+multiple), token input (saved to localStorage), status `<ul>`, script tag.  
`app.js`: read token from localStorage (prompt if missing → save); on file input change, iterate files, readAsDataURL each, POST base64, render row (name/size + pending→ok/fail). Failed → retry button.  
`manifest.json`: minimal PWA manifest.

- [ ] **Step 2: Verify GET / serves the app**

Run: start bridge (`启动桥接.bat` or node bridge.js with config), then `curl http://127.0.0.1:8390/`  
Expected: HTML containing `<input type=file` + `<script src="app.js"`.

- [ ] **Step 3: Commit**

```bash
git add tools/mobile-uploader/app
git commit -m "feat(mobile-uploader): PWA app — select/upload/status"
```

---

## Task 3: Skill adaptation — personal-website 阶段1 inbox path

**Files:**
- Modify: `docs/superpowers/skills/personal-website.skill.md` (source)
- Modify: live `C:\Users\23003\.dsh\skills\personal-website\SKILL.md` (mirror)

**Interfaces:**
- Consumes: bridge writes `D:\DS harnessw\work station\待上传\_inbox.json` (entries `{id, file, origName, ts, status:"pending"}`).
- Produces: 阶段1 new path: if user says "处理待上传" (or `_inbox.json` has pending), read batch → per item: classify→定名→压缩(同对话附件路径)→归位→txt → update `_inbox.json` item `status` (processed/failed).

- [ ] **Step 1: Write the failing behavioral test (pwsh)**

Create a test image + a fake `_inbox.json` with 1 pending entry → invoke the skill path → assert: file moved from `待上传/` to `content/` (compressed), `.txt` sidecar written, `_inbox.json` entry `status=processed`.

- [ ] **Step 2: Run to verify it fails (skill body not yet edited)**

Expected: skill doesn't know "处理待上传" → path not taken.

- [ ] **Step 3: Edit `personal-website.skill.md` 阶段1**

Add after step 1 "接收素材": a branch — 若用户说"处理待上传"（或 `待上传/_inbox.json` 存在且有 `pending`）→ 读清单 → 逐 pending 项走 step 3-7（定名→压缩→归位→txt）→ 更新该项 `status`（成功=processed / 压缩失败=failed + 记 stderr 关键行）→ 全部处理完报"处理了 N 项，M 成功 K 失败"。空清单/损坏 → 告知"清单空或损坏"，不静默跳过（Review Focus #5）。Mirror to live `SKILL.md`.

- [ ] **Step 4: Verify (grep + behavioral)**

Grep both files: `处理待上传` / `_inbox.json` / `pending` / `processed` present. Run the behavioral test from Step 1 → assert file placed + txt + status=processed.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/skills/personal-website.skill.md
git commit -m "feat(personal-website skill): 阶段1 增 读待上传/_inbox.json 批次路径"
```

---

## Task 4: LAN integration test

**Files:**
- Create: `tools/mobile-uploader/启动桥接.bat`
- Modify: (none — bridge.js + app from Tasks 1-2)

**Interfaces:** `启动桥接.bat` runs `"%DSH_NODE%" "%~dp0bridge.js"` (DSH node.exe).

- [ ] **Step 1: Write `启动桥接.bat`**

`chcp 65001` + `cd /d %~dp0` + `set NODE=C:\Users\23003\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` + `"%NODE%" bridge.js` + `pause`.

- [ ] **Step 2: Start bridge on LAN + phone upload**

Start `启动桥接.bat`. Note LAN IP (`ipconfig`). On phone (same WiFi), open `http://<LAN-IP>:8390/`, set token, upload 1 test photo.  
Expected: phone shows "ok"; `待上传/` has the file + `_inbox.json` appended.

- [ ] **Step 3: End-to-end — trigger skill + build**

In DSH chat say "处理待上传" → skill reads `_inbox.json` → classify→compress→place→txt. Then "构建" → `js/data.js` has the new photo. Preview `8367`.  
Expected: photo on site preview.

- [ ] **Step 4: Commit**

```bash
git add tools/mobile-uploader/启动桥接.bat
git commit -m "feat(mobile-uploader): 启动桥接.bat + LAN integration verified"
```

---

## Task 5: Tunnel probe (随时随地访问)

**Files:** (none created unless probe succeeds — Tailscale/自建中继)

- [ ] **Step 1: Probe Tailscale feasibility in China**

Check if `tailscale` is installable + can reach control plane (`login.tailscale.com`) + two devices connect.  
Expected outcome: report — either (a) works → set up tailscale on PC + phone, note tunnel URL, wire into `_bridge_config.json` as secondary; or (b) blocked → report "Tailscale 不可行，自建中继(frp类)为后续", defer.

- [ ] **Step 2: If feasible — wire tunnel + re-test remote upload**

If Tailscale works: phone on cellular → upload via tunnel URL → verify `待上传/` receives. If not: record finding in ledger + stop (no commit; tunnel = follow-up).

- [ ] **Step 3: (No commit unless tunnel code added)**

Tunnel config is runtime (Tailscale daemon), not repo code. If a config helper script was added, commit it; else note in ledger.

---

## Self-Review (run after writing)

1. **Spec coverage:** §5.1 PWA app → Task 2 ✓; §5.2 bridge → Task 1 ✓; §5.3 manual trigger → Task 3/4 ✓; §5.4 skill adaptation → Task 3 ✓; §6 data flow → Tasks 1-4 ✓; §7 errors (token/存盘/压缩失败/同名) → Task 1 + 3 ✓; §8 testing → each task's test ✓; §9 non-goals respected ✓; §10 tunnel follow-up → Task 5 ✓.
2. **Step scan:** each step one action + checkable result ✓; no TBD / no over-specified bodies.
3. **Type consistency:** `_inbox.json` entry shape (`{id, file, origName, ts, status}`) consistent across Task 1 (writes) + Task 3 (reads) ✓; config shape `{token, bindPort, uploadRoot}` consistent ✓.
4. **Review Focus:** #1 token→Task 1 test ✓; #2 并发→Task 1 note (sync R-M-W, TODO lock) ✓; #3 大文件→Task 1 size cap + 413 ✓; #4 同名→Task 1 `<ts>_<safeName>` ✓; #5 清单损坏→Task 1 GET /status + Task 3 path ✓.
5. **Proportion:** plan ~ proportional to spec (spec 118 lines, plan ~150 lines) ✓; bodies kept to signatures + key logic notes.
