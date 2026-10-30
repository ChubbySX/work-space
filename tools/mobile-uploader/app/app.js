// app.js — phone uploader (PWA): preview / rename / album / batch name / progress / retry / history
// Multi-site: site selector at top, sends ?site=<key> with every request
const $url = document.getElementById("url");
const $tok = document.getElementById("tok");
const $file = document.getElementById("file");
const $stage = document.getElementById("stage");
const $hist = document.getElementById("hist");
const $tabUp = document.getElementById("tabUp");
const $tabHist = document.getElementById("tabHist");
const $prefix = document.getElementById("prefix");
const $nameAll = document.getElementById("nameAll");
const $applyAll = document.getElementById("applyAll");
const $allBtn = document.getElementById("allBtn");
const $siteSel = document.getElementById("siteSel");

// 扫码即连：二维码链接里带了 ?t=token，扫开后自动填好地址和 token
const tParam = new URLSearchParams(location.search).get("t");
$url.value = localStorage.getItem("mu_url") || location.origin;
$tok.value = tParam || localStorage.getItem("mu_tok") || "";
function save(){ localStorage.setItem("mu_url", $url.value); localStorage.setItem("mu_tok", $tok.value); }
$url.addEventListener("change", () => { save(); loadSites(); loadAlbums(); });
$tok.addEventListener("change", () => { save(); loadSites(); loadAlbums(); });
const httphdr = () => ({ "Authorization": "Bearer " + $tok.value });
const api = () => $url.value.replace(/\/+$/, "");

// ---- site selector ----
let SITES = [];        // [{key, name}]
let currentSite = localStorage.getItem("mu_site") || "";
let FIXED_TAGS = ["作品", "日常"];  // default; updated from /albums response

function loadSites(){
  if (!api()) return;
  fetch(api() + "/sites")
    .then(r => r.json())
    .then(j => {
      if (j && j.sites && j.sites.length){
        SITES = j.sites;
        if (!currentSite || !SITES.find(s => s.key === currentSite)){
          currentSite = j.default || SITES[0].key;
          localStorage.setItem("mu_site", currentSite);
        }
        renderSiteSel();
        loadAlbums();
      }
    })
    .catch(() => {});
}
function renderSiteSel(){
  $siteSel.innerHTML = "";
  SITES.forEach(s => {
    const btn = document.createElement("button");
    btn.textContent = s.name;
    btn.className = (s.key === currentSite) ? "on" : "";
    btn.onclick = () => {
      currentSite = s.key;
      localStorage.setItem("mu_site", currentSite);
      renderSiteSel();
      loadAlbums();
    };
    $siteSel.appendChild(btn);
  });
}
function siteQs(){ return currentSite ? "&site=" + encodeURIComponent(currentSite) : ""; }
function siteQsLead(){ return currentSite ? "?site=" + encodeURIComponent(currentSite) : ""; }

let ALBUMS = []; // [{name, cover}]
function loadAlbums(){
  if (!api() || !$tok.value) return;
  fetch(api() + "/albums" + siteQsLead(), { headers: httphdr() })
    .then(r => r.json())
    .then(j => {
      if (j && j.albums){
        ALBUMS = j.albums;
        if (j.fixedTags && j.fixedTags.length) FIXED_TAGS = j.fixedTags;
        else FIXED_TAGS = ["作品", "日常"];
        rebuildSelects();
      }
    })
    .catch(() => {});
}
function tagOptions(sel){
  const cur = sel.value;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = ALBUMS.length ? "选择相册 / 作品…" : "选择相册…（未连上相册列表）";
  ph.disabled = true; ph.selected = true; sel.appendChild(ph);
  const names = [...new Set([...FIXED_TAGS, ...ALBUMS.map(a => a.name)])];
  for (const t of names){ const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o); }
  const o = document.createElement("option"); o.value = "__new__"; o.textContent = "＋ 新建相册…"; sel.appendChild(o);
  if (cur) sel.value = cur;
}
function rebuildSelects(){ for (const sel of $stage.querySelectorAll(".row select")) tagOptions(sel); }

// 相册封面缩略图（桥接 /thumb 提供）
function coverOf(tag){
  const a = ALBUMS.find(x => x.name === tag);
  return (a && a.cover) ? a.cover : null;
}
function showCover(row, sel){
  const cov = row.querySelector(".cov"); if (!cov) return;
  const c = coverOf(sel.value);
  if (c){ cov.innerHTML = '<img src="' + api() + '/thumb?p=' + encodeURIComponent(c) + siteQs() + '" alt="cover">'; cov.style.display = "inline-block"; }
  else cov.style.display = "none";
}

function buildRow(file){
  const row = document.createElement("div"); row.className = "row";
  const fName = (file && file.name) || "";
  const fType = (file && file.type) || "";
  if (/^video\//.test(fType)){
    const v = document.createElement("video"); v.src = URL.createObjectURL(file); v.muted = true; v.controls = true; row.appendChild(v);
    row.dataset.isVideo = "1";
  } else {
    const img = document.createElement("img"); img.src = URL.createObjectURL(file); row.appendChild(img);
  }
  const nameIn = document.createElement("input");
  nameIn.className = "name"; nameIn.placeholder = "重命名（留空用原名）";
  // 手机相册里选的图，file.name 有可能是空串（部分安卓 webview / 分享入口），
  // 这里必须兜底，否则下面的 .replace 直接抛错，整行构建失败。
  nameIn.value = fName.replace(/\.[^.]+$/, "");
  row.appendChild(nameIn);

  const sel = document.createElement("select"); tagOptions(sel); row.appendChild(sel);

  const cl = document.createElement("div"); cl.className = "cl";
  const newTag = document.createElement("input");
  newTag.className = "newtag"; newTag.placeholder = "新相册名（会新建到对应目录）"; newTag.style.display = "none";
  const cov = document.createElement("span"); cov.className = "cov"; cov.style.display = "none";
  const chk = document.createElement("label"); chk.className = "covchk"; chk.style.display = "none";
  const chkIn = document.createElement("input"); chkIn.type = "checkbox";
  chk.appendChild(chkIn); chk.appendChild(document.createTextNode("设封面"));
  cl.appendChild(newTag); cl.appendChild(chk); cl.appendChild(cov); row.appendChild(cl);
  sel.addEventListener("change", () => {
    newTag.style.display = (sel.value === "__new__") ? "block" : "none";
    chk.style.display = (sel.value && sel.value !== "__new__") ? "inline-flex" : "none";
    if (sel.value === "__new__") chkIn.checked = false;
    showCover(row, sel);
  });

  const prog = document.createElement("div"); prog.className = "prog"; prog.innerHTML = "<i></i>"; row.appendChild(prog);

  const btn = document.createElement("button"); btn.className = "up"; btn.textContent = "上传"; row.appendChild(btn);
  const st = document.createElement("div"); st.className = "st"; st.textContent = "待上传"; row.appendChild(st);

  // 注意：手机上（尤其相册选的图片）file.name 可能是空字符串或缺失扩展名，
  // 此时 m 为 null / m[1] 为 undefined，直接 toLowerCase() 会抛
  // "Cannot read properties of null (reading 'toLowerCase')" —— 上传就静默失败。
  const extOf = () => {
    const nm = (file && file.name) || "";
    const typ = (file && file.type) || "";
    const m = nm.match(/\.[^.]+$/);
    if (m && m[1]) return m[1].toLowerCase();
    if (/^video\//.test(typ)) return "mp4";
    if (/^image\/(jpeg|jpg)/.test(typ)) return "jpg";
    if (/^image\/png/.test(typ)) return "png";
    if (/^image\/webp/.test(typ)) return "webp";
    if (/^image\/gif/.test(typ)) return "gif";
    return "jpg";
  };
  const baseNameOf = (f) => {
    const nm = (f && f.name) || "";
    return nm.replace(/\.[^.]+$/, "");
  };
  const finalName = () => {
    const typed = (nameIn.value || "").trim();
    const base = typed || baseNameOf(file) || ("上传_" + Date.now());
    return base + "." + extOf();
  };
  // 关键：事件绑定要在渲染动作（prepend/showCover）之前完成。
  // 否则 showCover/coverOf 等任何一个抛错，都会让按钮永远没有 onclick（点了完全无反应）。
  btn.onclick = () => {
    try { submit(file, sel, newTag, nameIn, prog, btn, st, finalName); }
    catch (e) {
      st.className = "st fail";
      st.textContent = "✗ 上传出错：" + ((e && e.message) || e);
      btn.disabled = false; btn.textContent = "重试";
      console.error("[upload] submit failed:", e);
    }
  };
  $stage.prepend(row);
  try { showCover(row, sel); } catch (e) { console.error("[upload] showCover failed:", e); }
}

let uploading = 0;
let batchOk = 0;       // 本批成功上传张数（决定是否自动处理）
let autoFired = false; // 本批是否已触发自动处理
function submit(file, sel, newTag, nameIn, prog, btn, st, finalName){
  let tag = sel.value;
  if (!tag){ st.className = "st fail"; st.textContent = "请先选择相册"; return; }
  if (tag === "__new__"){ tag = newTag.value.trim(); if (!tag){ st.className = "st fail"; st.textContent = "请填新相册名"; return; } }
  const name = finalName();
  const row = btn.closest(".row");
  const chkIn = row ? row.querySelector(".covchk input") : null;
  const wantCover = !!(chkIn && chkIn.checked && tag && tag !== "__new__");
  const bar = prog.querySelector("i");
  const ok = msg => { rowDone(st, btn, "ok", "✓ " + msg); if (bar) bar.style.width = "100%"; batchOk++; maybeAuto(); };
  const fail = msg => { st.className = "st fail"; st.textContent = "✗ " + msg; btn.disabled = false; btn.textContent = "重试"; refreshBar(); maybeAuto(); };
  btn.disabled = true; btn.textContent = "上传中…"; uploading++; st._up = 1; // st._up: rowDone 据此减计数（修复 uploading 永不归零）
  st.className = "st pend"; st.textContent = "0%"; if (bar) bar.style.width = "0%";

  const xhr = new XMLHttpRequest();
  // file.name 在部分手机环境为空；origName 是服务端判类型/归档的关键线索，必须给值
  const origName = (file && file.name) || name;
  let qs = "?origName=" + encodeURIComponent(origName)
    + "&name=" + encodeURIComponent(name) + "&tag=" + encodeURIComponent(tag) + siteQs();
  if (wantCover) qs += "&cover=1";
  xhr.open("POST", api() + "/upload_raw" + qs);
  xhr.setRequestHeader("Authorization", "Bearer " + $tok.value);
  xhr.upload.onprogress = e => {
    if (e.lengthComputable && e.total){
      const p = Math.min(99, Math.round(e.loaded / e.total * 100));
      st.textContent = p + "%"; if (bar) bar.style.width = p + "%";
    }
  };
  xhr.onload = () => {
    if (xhr.status === 200){
      let j = null; try { j = JSON.parse(xhr.responseText); } catch {}
      if (j && j.ok) ok("已收到（" + tag + " · " + name + "）");
      else fail((j && j.error) || "HTTP " + xhr.status);
    } else if (xhr.status === 404 || xhr.status === 405){
      legacy(file, name, tag, wantCover, ok, fail); // 旧桥接没有 /upload_raw → 回退 base64
    } else {
      fail(xhr.status + (xhr.responseText ? " " + xhr.responseText.slice(0, 60) : ""));
    }
  };
  xhr.onerror = () => fail("网络错误");
  xhr.timeout = 120000; xhr.ontimeout = () => fail("超时");
  xhr.send(file); // 直接发 File：流式上传，监控窗能看到实时进度
}
function rowDone(st, btn, cls, msg){ st.className = "st " + cls; st.textContent = msg; btn.disabled = true; btn.textContent = "完成"; if (st._up){ uploading--; st._up = null; } }
function legacy(file, name, tag, wantCover, ok, fail){
  const fr = new FileReader();
  fr.onload = () => {
    const data = String(fr.result).split(",")[1];
    fetch(api() + "/upload", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, httphdr()),
      body: JSON.stringify({ origName: (file && file.name) || name, name, tag, data, site: currentSite, ...(wantCover ? { cover: true } : {}) })
    }).then(r => r.json().then(j => ({ code: r.status, j })))
      .then(({ code, j }) => { if (code === 200 && j && j.ok) ok("已收到（" + tag + " · " + name + "）"); else fail((j && j.error) || code); })
      .catch(e => fail(String(e)));
  };
  fr.onerror = () => fail("读取失败");
  fr.readAsDataURL(file);
}

// ---- 给电脑发指令 / 请求发布 ----
const $cmdTxt = document.getElementById("cmdTxt");
const $cmdBtn = document.getElementById("cmdBtn");
const $cmdNoteBtn = document.getElementById("cmdNoteBtn");
const $cmdSt = document.getElementById("cmdSt");
function sendCmd(intent){
  const text = $cmdTxt.value.trim();
  if (!api()){ $cmdSt.className = "st fail"; $cmdSt.textContent = "先填桥接地址"; return; }
  if (!$tok.value){ $cmdSt.className = "st fail"; $cmdSt.textContent = "先填 Token（扫二维码链接会自动带）"; return; }
  $cmdBtn.disabled = true; $cmdNoteBtn.disabled = true;
  $cmdSt.className = "st pend"; $cmdSt.textContent = (intent === "publish" ? "正在发送发布请求…" : "正在发送指令…");
  fetch(api() + "/request", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, httphdr()),
    body: JSON.stringify({ intent, text, site: currentSite })
  }).then(r => r.json().then(j => ({ code: r.status, j })))
    .then(({ code, j }) => {
      $cmdBtn.disabled = false; $cmdNoteBtn.disabled = false;
      if (code === 200 && j && j.ok){
        $cmdSt.className = "st ok";
        $cmdSt.textContent = intent === "publish" ? "✓ 发布请求（带备注）已发给电脑，回对话框说一声就处理" : "✓ 指令已发给电脑";
        $cmdTxt.value = "";
      } else {
        $cmdSt.className = "st fail"; $cmdSt.textContent = "✗ " + ((j && j.error) || code);
      }
    })
    .catch(() => { $cmdBtn.disabled = false; $cmdNoteBtn.disabled = false; $cmdSt.className = "st fail"; $cmdSt.textContent = "✗ 连不上桥接（地址或 Token 不对？）"; });
}
$cmdBtn.addEventListener("click", () => sendCmd("publish"));
$cmdNoteBtn.addEventListener("click", () => sendCmd("command"));

// ---- 一键润色 AI 草稿（本地模型写的 #draft 交给云端改写）----
const $polishBtn = document.getElementById("polishBtn");
const $polishSt = document.getElementById("polishSt");
let polishPoll = null;
function stopPolishPoll(){ if (polishPoll){ clearInterval(polishPoll); polishPoll = null; } }
function renderPolishReport(rep){
  if (!rep) return;
  const t = new Date(rep.ts);
  const hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
  if (rep.done === 0 && rep.failed === 0){
    $polishSt.className = "st";
    $polishSt.textContent = hh + " 没有待润色的 AI 草稿";
  } else if (rep.ok){
    $polishSt.className = "st ok";
    $polishSt.textContent = "✓ " + hh + " 润色完成：" + rep.done + " 张" + (rep.failed ? "，失败 " + rep.failed : "");
  } else {
    $polishSt.className = "st fail";
    $polishSt.textContent = "✗ " + hh + " 润色异常（成功 " + rep.done + " / 失败 " + rep.failed + "）";
  }
}
function pollPolish(){
  return fetch(api() + "/polish-status", { headers: httphdr() })
    .then(r => r.json())
    .then(j => {
      if (j && j.running){
        $polishSt.className = "st pend"; $polishSt.textContent = "润色中…（云端模型逐张改写，耐心等）";
        return false;
      }
      $polishBtn.disabled = false;
      renderPolishReport(j && j.report);
      return true;
    })
    .catch(() => false);
}
$polishBtn.addEventListener("click", () => {
  if (!api()){ $polishSt.className = "st fail"; $polishSt.textContent = "先填桥接地址"; return; }
  if (!$tok.value){ $polishSt.className = "st fail"; $polishSt.textContent = "先填 Token"; return; }
  $polishBtn.disabled = true;
  $polishSt.className = "st pend"; $polishSt.textContent = "正在启动润色…";
  fetch(api() + "/polish", { headers: httphdr() })
    .then(r => r.json())
    .then(j => {
      if (j && j.ok){
        $polishSt.className = "st pend"; $polishSt.textContent = "润色中…";
        stopPolishPoll();
        polishPoll = setInterval(() => { pollPolish().then(done => { if (done) stopPolishPoll(); }); }, 3000);
      } else {
        $polishBtn.disabled = false;
        $polishSt.className = "st fail";
        $polishSt.textContent = "✗ " + ((j && j.msg) || "启动失败");
      }
    })
    .catch(() => { $polishBtn.disabled = false; $polishSt.className = "st fail"; $polishSt.textContent = "✗ 连不上桥接"; });
});
// 进页面先看一眼有没有历史结果
setTimeout(() => { if (api() && $tok.value) pollPolish(); }, 1200);

// ---- 页面级开关「推新至线上」+ 自动处理/发布 ----
const $pubChk = document.getElementById("pubChk");
const $pubLbl = document.getElementById("pubLbl");
const $autoSt = document.getElementById("autoSt");
let autoPoll = null;

// 开关默认不勾选（仅本地）；记住用户选择
$pubChk.checked = localStorage.getItem("mu_publish") === "1";
function drawPub(){ if ($pubLbl) $pubLbl.classList.toggle("on", $pubChk.checked); }
$pubChk.addEventListener("change", () => {
  localStorage.setItem("mu_publish", $pubChk.checked ? "1" : "0");
  drawPub();
});
drawPub();

function stopAutoPoll(){ if (autoPoll){ clearInterval(autoPoll); autoPoll = null; } }
function setAutoSt(cls, txt){ if ($autoSt){ $autoSt.className = "st" + (cls ? " " + cls : ""); $autoSt.textContent = txt; } }

// 本批全部传完且至少 1 张成功 → 自动触发一次处理（按开关决定是否推送上线）
function maybeAuto(){
  if (uploading > 0 || batchOk === 0 || autoFired) return;
  if (!api() || !$tok.value) return;
  autoFired = true;
  const publish = $pubChk.checked ? 1 : 0;
  fetch(api() + "/auto-process?publish=" + publish + siteQs(), { method: "POST", headers: httphdr() })
    .then(r => r.json())
    .then(j => {
      if (!j || !j.ok){
        if (j && j.running){ setTimeout(maybeAuto, 5000); return; } // 上一轮还在跑，稍后重试
        setAutoSt("fail", "✗ 自动处理未启动：" + ((j && j.msg) || "未知错误"));
        autoFired = false;
        return;
      }
      setAutoSt("pend", j.publish ? "🚀 自动处理中…完成后推送上线" : "🔄 自动处理中…（仅本地）");
      startAutoPoll();
    })
    .catch(() => { setAutoSt("fail", "✗ 连不上桥接，自动处理未启动"); autoFired = false; });
}

// 状态轮询：处理中 → 已处理·本地 / 已上线 / 推送失败
function renderAutoStatus(j){
  if (!j) return;
  if (j.running){
    setAutoSt("pend", j.phase === "publishing" ? "🚀 处理完成，正在推送上线…" : "🔄 自动处理中…");
    return;
  }
  const rep = j.report, ar = j.autoRun;
  if (rep && rep.ts){
    stopAutoPoll();
    const t = new Date(rep.ts);
    const hh = String(t.getHours()).padStart(2, "0") + ":" + String(t.getMinutes()).padStart(2, "0");
    if (rep.ok) setAutoSt("ok", "✅ " + hh + " 已上线" + (rep.version ? " v" + rep.version : "") + (rep.msg ? " · " + rep.msg : ""));
    else setAutoSt("fail", "⚠ " + hh + " " + (rep.msg || "推送失败") + "（内容已留本地，下次勾选发布时会补推）");
    return;
  }
  if (ar){
    if (!ar.finished){ setAutoSt("pend", ar.publish ? "🚀 自动处理中…完成后推送上线" : "🔄 自动处理中…（仅本地）"); return; }
    if (ar.publish) return; // 发布收尾中，等 report
    // publish=0：处理完不推送 → 显示「已处理 · 本地」
    stopAutoPoll();
    const n = (j.lastOp && j.lastOp.placed && j.lastOp.placed.length) || 0;
    setAutoSt("ok", "✅ 已处理 · 本地" + (n ? "（归位 " + n + " 项）" : "") + "，未推送");
  }
}
function pollAuto(){
  return fetch(api() + "/publish-status" + siteQsLead(), { headers: httphdr() })
    .then(r => r.json())
    .then(j => { renderAutoStatus(j); return !j.running; })
    .catch(() => { setAutoSt("fail", "✗ 桥接断开"); stopAutoPoll(); return true; });
}
function startAutoPoll(){
  stopAutoPoll();
  autoPoll = setInterval(() => { pollAuto().then(done => { if (done) stopAutoPoll(); }); }, 3000);
  pollAuto();
}
// 进页面先看一眼上次的结果
setTimeout(() => { if (api() && $tok.value) pollAuto(); }, 1200);

// ---- 批量工具栏 ----
function refreshBar(){
  const rows = [...$stage.querySelectorAll(".row:not(.done)")];
  const pend = rows.filter(r => r.querySelector(".up").disabled);
  $allBtn.disabled = !rows.length || pend.length > 0;
  $allBtn.textContent = "全部上传（" + rows.length + "）";
}
function applyToAllRows(){
  const v = $applyAll.value;
  const nw = $applyAll.options[$applyAll.selectedIndex] && $applyAll.options[$applyAll.selectedIndex].text;
  if (!v) return;
  for (const row of $stage.querySelectorAll(".row")){
    const sel = row.querySelector("select");
    if (!sel || row.classList.contains("done")) continue;
    sel.value = v;
    const newTag = row.querySelector(".newtag");
    if (newTag){
      newTag.style.display = (v === "__new__") ? "block" : "none";
      if (v === "__new__") newTag.value = nw.replace("＋ 新建相册…", "").trim() || "";
      if (v !== "__new__") newTag.value = "";
    }
    showCover(row, sel);
  }
  refreshBar();
}
function nameAllRows(){
  const pfx = $prefix.value.trim();
  if (!pfx){ $prefix.focus(); return; }
  const rows = [...$stage.querySelectorAll(".row")];
  rows.forEach((row, i) => {
    const nameIn = row.querySelector(".name");
    if (nameIn && !nameIn.value && !row.classList.contains("done")) nameIn.value = pfx + "_" + String(i + 1).padStart(2, "0");
  });
}
$nameAll.addEventListener("click", nameAllRows);
$applyAll.addEventListener("change", applyToAllRows);
$allBtn.addEventListener("click", () => {
  for (const row of $stage.querySelectorAll(".row")){
    const b = row.querySelector(".up");
    if (b && !b.disabled) b.click();
  }
});

// ---- 历史 tab ----
$tabUp.addEventListener("click", () => { $stage.hidden = false; $hist.hidden = true; $tabUp.classList.add("on"); $tabHist.classList.remove("on"); });
$tabHist.addEventListener("click", () => {
  $stage.hidden = true; $hist.hidden = false;
  $tabUp.classList.remove("on"); $tabHist.classList.add("on");
  loadHist();
});
function loadHist(){
  $hist.innerHTML = '<div class="empty">加载中…</div>';
  fetch(api() + "/history" + siteQsLead(), { headers: httphdr() })
    .then(r => r.json())
    .then(j => {
      if (!j || !j.items){ $hist.innerHTML = '<div class="empty">读取失败</div>'; return; }
      if (!j.items.length){ $hist.innerHTML = '<div class="empty">还没有上传记录</div>'; return; }
      $hist.innerHTML = "";
      for (const it of j.items){
        const d = document.createElement("div"); d.className = "row h-item";
        const n = document.createElement("div"); n.className = "h-name"; n.textContent = it.name;
        const m = document.createElement("div"); m.className = "h-meta";
        const tagTxt = it.tag || "日常";
        const stTxt = it.status === "processed" ? "已处理" : it.status === "failed" ? "处理失败" : "等待处理";
        m.textContent = tagTxt + " · " + stTxt + (it.size != null ? " · " + Math.max(1, Math.round(it.size / 1024)) + "KB" : "");
        d.appendChild(n); d.appendChild(m); $hist.appendChild(d);
      }
    })
    .catch(() => { $hist.innerHTML = '<div class="empty">连不上桥接，点"上传"确认地址已填对</div>'; });
}

$file.addEventListener("change", () => {
  save(); loadAlbums();
  batchOk = 0; autoFired = false; // 新一批：重置批计数，允许再次自动触发
  for (const f of $file.files) buildRow(f);
  $file.value = "";
  $tabUp.classList.add("on"); $tabHist.classList.remove("on");
  $stage.hidden = false; $hist.hidden = true;
  refreshBar();
});
$file.dispatchEvent(new Event("change"));

loadSites();
