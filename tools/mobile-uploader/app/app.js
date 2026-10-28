// app.js — phone uploader (PWA): preview / rename / album / batch name / progress / retry / history
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

// 扫码即连：二维码链接里带了 ?t=token，扫开后自动填好地址和 token
const tParam = new URLSearchParams(location.search).get("t");
$url.value = localStorage.getItem("mu_url") || location.origin;
$tok.value = tParam || localStorage.getItem("mu_tok") || "";
function save(){ localStorage.setItem("mu_url", $url.value); localStorage.setItem("mu_tok", $tok.value); }
$url.addEventListener("change", () => { save(); loadAlbums(); });
$tok.addEventListener("change", () => { save(); loadAlbums(); });
const httphdr = () => ({ "Authorization": "Bearer " + $tok.value });
const api = () => $url.value.replace(/\/+$/, "");

let ALBUMS = []; // [{name, cover}]，cover 是 content/.thumbs 的相对路径
function loadAlbums(){
  if (!api() || !$tok.value) return;
  fetch(api() + "/albums", { headers: httphdr() })
    .then(r => r.json())
    .then(j => { if (j && j.albums){ ALBUMS = j.albums; rebuildSelects(); } })
    .catch(() => {});
}
function tagOptions(sel){
  const cur = sel.value;
  sel.innerHTML = "";
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = ALBUMS.length ? "选择相册 / 作品…" : "选择相册…（未连上相册列表，仅 日常/作品）";
  ph.disabled = true; ph.selected = true; sel.appendChild(ph);
  const fixed = ALBUMS.length ? ["作品"] : ["作品", "日常"];
  const names = [...new Set([...fixed, ...ALBUMS.map(a => a.name)])];
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
  if (c){ cov.innerHTML = '<img src="' + api() + '/thumb?p=' + encodeURIComponent(c) + '" alt="cover">'; cov.style.display = "inline-block"; }
  else cov.style.display = "none";
}

function buildRow(file){
  const row = document.createElement("div"); row.className = "row";
  if (/^video\//.test(file.type)){
    const v = document.createElement("video"); v.src = URL.createObjectURL(file); v.muted = true; v.controls = true; row.appendChild(v);
    row.dataset.isVideo = "1";
  } else {
    const img = document.createElement("img"); img.src = URL.createObjectURL(file); row.appendChild(img);
  }
  const nameIn = document.createElement("input");
  nameIn.className = "name"; nameIn.placeholder = "重命名（留空用原名）";
  nameIn.value = file.name.replace(/\.[^.]+$/, "");
  row.appendChild(nameIn);

  const sel = document.createElement("select"); tagOptions(sel); row.appendChild(sel);

  const cl = document.createElement("div"); cl.className = "cl";
  const newTag = document.createElement("input");
  newTag.className = "newtag"; newTag.placeholder = "新相册名（会新建到 日常/ 下）"; newTag.style.display = "none";
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

  const extOf = () => { const m = file.name.match(/\.[^.]+$/); return m ? m[1].toLowerCase() : (/^video\//.test(file.type) ? "mp4" : "jpg"); };
  const finalName = () => (nameIn.value.trim() || file.name.replace(/\.[^.]+$/, "")) + "." + extOf();
  btn.onclick = () => submit(file, sel, newTag, nameIn, prog, btn, st, finalName);
  $stage.prepend(row);
  showCover(row, sel);
}

let uploading = 0;
function submit(file, sel, newTag, nameIn, prog, btn, st, finalName){
  let tag = sel.value;
  if (!tag){ st.className = "st fail"; st.textContent = "请先选择相册"; return; }
  if (tag === "__new__"){ tag = newTag.value.trim(); if (!tag){ st.className = "st fail"; st.textContent = "请填新相册名"; return; } }
  const name = finalName();
  const row = btn.closest(".row");
  const chkIn = row ? row.querySelector(".covchk input") : null;
  const wantCover = !!(chkIn && chkIn.checked && tag && tag !== "__new__");
  const bar = prog.querySelector("i");
  const ok = msg => { rowDone(st, btn, "ok", "✓ " + msg); if (bar) bar.style.width = "100%"; };
  const fail = msg => { st.className = "st fail"; st.textContent = "✗ " + msg; btn.disabled = false; btn.textContent = "重试"; refreshBar(); };
  btn.disabled = true; btn.textContent = "上传中…"; uploading++;
  st.className = "st pend"; st.textContent = "0%"; if (bar) bar.style.width = "0%";

  const xhr = new XMLHttpRequest();
  let qs = "?origName=" + encodeURIComponent(file.name)
    + "&name=" + encodeURIComponent(name) + "&tag=" + encodeURIComponent(tag);
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
      body: JSON.stringify({ origName: file.name, name, tag, data, ...(wantCover ? { cover: true } : {}) })
    }).then(r => r.json().then(j => ({ code: r.status, j })))
      .then(({ code, j }) => { if (code === 200 && j && j.ok) ok("已收到（" + tag + " · " + name + "）"); else fail((j && j.error) || code); })
      .catch(e => fail(String(e)));
  };
  fr.onerror = () => fail("读取失败");
  fr.readAsDataURL(file);
}

// ---- 给电脑发指令 / 请求发布（发到桥接 → 落 待上传/_requests.json，桌面端监听/我来读）----
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
    body: JSON.stringify({ intent, text })
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

// ---- 批量工具栏：相册应用到全部 / 批量命名 / 全部上传 ----
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
  fetch(api() + "/history", { headers: httphdr() })
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
    .catch(() => { $hist.innerHTML = '<div class="empty">连不上桥接，点“上传”确认地址已填对</div>'; });
}

$file.addEventListener("change", () => {
  save(); loadAlbums();
  for (const f of $file.files) buildRow(f);
  $file.value = "";
  $tabUp.classList.add("on"); $tabHist.classList.remove("on");
  $stage.hidden = false; $hist.hidden = true;
  refreshBar();
});
$file.dispatchEvent(new Event("change"));

loadAlbums();