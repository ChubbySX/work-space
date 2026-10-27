// app.js — PWA uploader: readAsDataURL → base64 → POST /upload
const $url = document.getElementById("url");
const $tok = document.getElementById("tok");
const $list = document.getElementById("list");
const $file = document.querySelector('input[type=file]');
$url.value = localStorage.getItem("mu_url") || location.origin;
$tok.value = localStorage.getItem("mu_tok") || "";
function save(){ localStorage.setItem("mu_url", $url.value); localStorage.setItem("mu_tok", $tok.value); }
$url.addEventListener("change", save); $tok.addEventListener("change", save);
function row(name, size, status){
  const li = document.createElement("li");
  li.className = status;
  li.textContent = name + (size ? " (" + Math.round(size/1024) + "KB) " : " ") + status;
  $list.prepend(li);
  return li;
}
function addRetry(li, file){
  const b = document.createElement("button");
  b.textContent = "重试";
  b.onclick = () => { li.className = "pend"; li.textContent = file.name + " …"; upload(file, li); b.remove(); };
  li.appendChild(b);
}
function upload(file, li){
  const fr = new FileReader();
  fr.onload = () => {
    const data = fr.result.split(",")[1];
    fetch($url.value.replace(/\/$/, "") + "/upload", {
      method: "POST",
      headers: { "Authorization": "Bearer " + $tok.value, "Content-Type": "application/json" },
      body: JSON.stringify({ name: file.name, data })
    }).then(r => r.json().then(j => ({ code: r.status, j })))
      .then(({ code, j }) => {
        if (code === 200 && j.ok) { li.className = "ok"; li.textContent = file.name + " ✓ 已收到"; }
        else { li.className = "fail"; li.textContent = file.name + " ✗ " + (j.error || code); addRetry(li, file); }
      }).catch(e => { li.className = "fail"; li.textContent = file.name + " ✗ " + e; addRetry(li, file); });
  };
  fr.onerror = () => { li.className = "fail"; li.textContent = file.name + " ✗ 读取失败"; };
  fr.readAsDataURL(file);
}
$file.addEventListener("change", () => {
  save();
  for (const f of $file.files) { const li = row(f.name, f.size, "…"); upload(f, li); }
  $file.value = "";
});
