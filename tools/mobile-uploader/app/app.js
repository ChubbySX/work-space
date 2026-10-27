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
    .catch(() => {}); // optional; selects still have 日常/作品/新建
}
function tagOptions(sel){
  const fixed = ["日常", "作品"];
  const all = [...new Set([...fixed, ...ALBUMS])];
  const cur = sel.value;
  sel.innerHTML = "";
  for (const t of all){
    const o = document.createElement("option"); o.value = t; o.textContent = t; sel.appendChild(o);
  }
  const o = document.createElement("option"); o.value = "__new__"; o.textContent = "＋ 新建标签…"; sel.appendChild(o);
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

function buildRow(file){
  const row = document.createElement("div"); row.className = "row";
  const img = document.createElement("img"); img.src = URL.createObjectURL(file); row.appendChild(img);
  const nameIn = document.createElement("input"); nameIn.type = "text";
  nameIn.value = file.name.replace(/\.[^.]+$/, ""); // prefilled without extension
  nameIn.placeholder = "给个名（替代 " + file.name + "）";
  row.appendChild(nameIn);
  const sel = document.createElement("select"); row.appendChild(sel); tagOptions(sel);
  const newTag = document.createElement("input"); newTag.type = "text"; newTag.className = "newtag";
  newTag.placeholder = "新标签名（= 新相册名）"; row.appendChild(newTag);
  sel.addEventListener("change", () => { newTag.style.display = (sel.value === "__new__") ? "block" : "none"; });
  const btn = document.createElement("button"); btn.textContent = "提交"; row.appendChild(btn);
  const st = document.createElement("div"); st.className = "st pend"; st.textContent = "待提交"; row.appendChild(st);
  btn.onclick = () => submit(row, file, nameIn, sel, newTag, btn, st);
  $stage.prepend(row);
}

function submit(row, file, nameIn, sel, newTag, btn, st){
  let tag = sel.value;
  if (tag === "__new__"){ tag = newTag.value.trim(); if (!tag){ st.className = "st fail"; st.textContent = "请填新标签名"; return; } }
  // name: user input or origName-without-ext, forced .jpg (compress_image.py outputs jpg)
  const base = nameIn.value.trim() || file.name.replace(/\.[^.]+$/, "");
  const name = base + ".jpg";
  btn.disabled = true; st.className = "st pend"; st.textContent = "上传中…";
  const fr = new FileReader();
  fr.onload = () => {
    const data = fr.result.split(",")[1];
    fetch($url.value.replace(/\/$/, "") + "/upload", {
      method: "POST",
      headers: { "Authorization": "Bearer " + $tok.value, "Content-Type": "application/json" },
      body: JSON.stringify({ origName: file.name, name: name, tag: tag, data })
    }).then(r => r.json().then(j => ({ code: r.status, j })))
      .then(({ code, j }) => {
        if (code === 200 && j.ok){ row.classList.add("done"); st.className = "st ok"; st.textContent = "✓ 已收到（" + tag + " · " + name + "）"; }
        else { st.className = "st fail"; st.textContent = "✗ " + (j.error || code); btn.disabled = false; }
      }).catch(e => { st.className = "st fail"; st.textContent = "✗ " + e; btn.disabled = false; });
  };
  fr.onerror = () => { st.className = "st fail"; st.textContent = "✗ 读取失败"; btn.disabled = false; };
  fr.readAsDataURL(file);
}
