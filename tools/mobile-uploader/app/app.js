// app.js — PWA uploader: preview + rename + tag, then POST /upload {origName, name, tag, data}
const $url = document.getElementById("url");
const $tok = document.getElementById("tok");
const $file = document.getElementById("file");
const $stage = document.getElementById("stage");
$url.value = localStorage.getItem("mu_url") || location.origin;
$tok.value = localStorage.getItem("mu_tok") || "";
function save(){ localStorage.setItem("mu_url", $url.value); localStorage.setItem("mu_tok", $tok.value); }
$url.addEventListener("change", () => { save(); loadAlbums(); });
$tok.addEventListener("change", () => { save(); loadAlbums(); });

let ALBUMS = [];
function loadAlbums(){
  const base = $url.value.replace(/\/$/, "");
  if (!base || !$tok.value) return;
  fetch(base + "/albums", { headers: { "Authorization": "Bearer " + $tok.value } })
    .then(r => r.json()).then(j => { if (j && j.albums) { ALBUMS = j.albums; rebuildSelects(); } })
    .catch(() => {}); // optional: 未连上 /albums 时 select 退回 日常/作品 兜底
}
function tagOptions(sel){
  const cur = sel.value;
  sel.innerHTML = "";
  // 占位：必选（避免静默落到不该去的相册）；ALBUMS 空 = /albums 没连上（旧 bridge）→ 只给 日常/作品 兜底
  const ph = document.createElement("option");
  ph.value = ""; ph.textContent = ALBUMS.length ? "选择相册 / 作品…" : "选择相册…（未连上相册列表，仅 日常/作品）";
  ph.disabled = true; ph.selected = true; sel.appendChild(ph);
  // 作品 + 日常内每一个相册（ALBUMS 来自 /albums = content/daily/* 实时读出）
  const fixed = ALBUMS.length ? ["作品"] : ["作品", "日常"];
  for (const t of [...new Set([...fixed, ...ALBUMS])]){
    const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
  }
  const o = document.createElement("option"); o.value = "__new__"; o.textContent = "＋ 新建相册…"; sel.appendChild(o);
  if (cur) sel.value = cur;
}
function rebuildSelects(){
  for (const sel of $stage.querySelectorAll("select")) tagOptions(sel);
}

$file.addEventListener("change", () => {
  save(); loadAlbums();
  for (const f of $file.files) buildRow(f);
  $file.value = "";
});

// 批量工具栏：一个相册应用到全部行 + 一键全部上传（省掉逐张选相册/点提交）
const $bar = document.createElement("div"); $bar.className = "toolbar";
const $applyAll = document.createElement("select"); $applyAll.title = "把相册应用到全部行";
const ph2 = document.createElement("option"); ph2.value = ""; ph2.textContent = "相册应用到全部…"; ph2.disabled = true; ph2.selected = true; $applyAll.appendChild(ph2);
const $allBtn = document.createElement("button"); $allBtn.className = "allbtn"; $allBtn.textContent = "全部上传";
$bar.appendChild($applyAll); $bar.appendChild($allBtn);
$stage.append($bar);
function refreshBar(){ const cur = $applyAll.value; tagOptions($applyAll); if (cur) $applyAll.value = cur; }
$applyAll.addEventListener("change", () => {
  const t = $applyAll.value;
  if (!t || t.startsWith("__")){ $applyAll.value = ""; return; }
  for (const row of $stage.querySelectorAll(".row")){
    const sel = row.querySelector("select");
    if (sel.value === "" || sel.value === "__new__"){
      sel.value = t;
      const n = row.querySelector(".newtag"); if (n) n.style.display = "none";
    }
  }
  $applyAll.value = "";
});
$allBtn.addEventListener("click", () => {
  for (const row of $stage.querySelectorAll(".row")){
    if (row.classList.contains("done")) continue;
    const btn = row.querySelector("button"); if (btn.disabled) continue;
    btn.click();
  }
});

function buildRow(file){
  const row = document.createElement("div"); row.className = "row";
  const img = document.createElement("img"); img.src = URL.createObjectURL(file); row.appendChild(img);
  const nameIn = document.createElement("input"); nameIn.type = "text";
  nameIn.value = file.name.replace(/\.[^.]+$/, ""); // prefilled without extension
  nameIn.placeholder = "给个名（替代 " + file.name + "）";
  row.appendChild(nameIn);
  const sel = document.createElement("select"); row.appendChild(sel); tagOptions(sel);
  const newTag = document.createElement("input"); newTag.type = "text"; newTag.className = "newtag";
  newTag.placeholder = "新相册名（会新建到 日常/ 下）"; row.appendChild(newTag);
  sel.addEventListener("change", () => { newTag.style.display = (sel.value === "__new__") ? "block" : "none"; });
  const btn = document.createElement("button"); btn.textContent = "提交"; row.appendChild(btn);
  const st = document.createElement("div"); st.className = "st pend"; st.textContent = "待提交"; row.appendChild(st);
  btn.onclick = () => submit(row, file, nameIn, sel, newTag, btn, st);
  $stage.prepend(row);
}

function submit(row, file, nameIn, sel, newTag, btn, st){
  let tag = sel.value;
  if (!tag){ st.className = "st fail"; st.textContent = "请先选择相册"; return; }
  if (tag === "__new__"){ tag = newTag.value.trim(); if (!tag){ st.className = "st fail"; st.textContent = "请填新相册名"; return; } }
  // name: user input or origName-without-ext, forced .jpg (compress_image.py outputs jpg)
  const base = nameIn.value.trim() || file.name.replace(/\.[^.]+$/, "");
  const name = base + ".jpg";
  btn.disabled = true; st.className = "st pend"; st.textContent = "上传中…";
  const api = $url.value.replace(/\/$/, "");
  const fin = (code, j) => {
    if (code === 200 && j && j.ok){ row.classList.add("done"); st.className = "st ok"; st.textContent = "✓ 已收到（" + tag + " · " + name + "）"; }
    else { st.className = "st fail"; st.textContent = "✗ " + ((j && j.error) || code); btn.disabled = false; }
  };
  // 优先二进制 /upload_raw（省 ~33% 流量 + 支持更大文件）；旧 bridge 没有该端点（404/405）→ 回退 base64 /upload
  const raw = () => {
    const fr = new FileReader();
    fr.onload = () => {
      fetch(api + "/upload_raw?origName=" + encodeURIComponent(file.name) + "&name=" + encodeURIComponent(name) + "&tag=" + encodeURIComponent(tag), {
        method: "POST",
        headers: { "Authorization": "Bearer " + $tok.value, "Content-Type": "application/octet-stream" },
        body: new Uint8Array(fr.result)
      }).then(r => r.json().then(j => ({ code: r.status, j })))
        .then(({ code, j }) => { if (code === 404 || code === 405){ legacy(); } else { fin(code, j); } })
        .catch(e => fin(0, { error: String(e) }));
    };
    fr.onerror = () => fin(0, { error: "读取失败" });
    fr.readAsArrayBuffer(file);
  };
  const legacy = () => {
    const fr = new FileReader();
    fr.onload = () => {
      const data = fr.result.split(",")[1];
      fetch(api + "/upload", {
        method: "POST",
        headers: { "Authorization": "Bearer " + $tok.value, "Content-Type": "application/json" },
        body: JSON.stringify({ origName: file.name, name, tag, data })
      }).then(r => r.json().then(j => ({ code: r.status, j })))
        .then(({ code, j }) => fin(code, j))
        .catch(e => fin(0, { error: String(e) }));
    };
    fr.onerror = () => fin(0, { error: "读取失败" });
    fr.readAsDataURL(file);
  };
  raw();
}
