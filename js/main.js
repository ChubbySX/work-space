/* ============================================================
   钟智轩个人主页 · 交互脚本
   数据来源：js/data.js（由 build.js 生成）或 data.json
   ============================================================ */

(function () {
  "use strict";

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  let DATA = null;          // 站点数据
  let currentFilter = "all";
  let currentTag = null;     // 主题标签筛选
  let lightboxList = [];    // 当前灯箱可切换的条目
  let lightboxIndex = 0;
  let videoVolume = 0.8;    // 视频音量（由音乐卡片控制）
  let bgMusicWasPlaying = false;  // 灯箱打开前背景音乐是否在播放
  const MAX_MUSIC_VOL = 0.0825;  // 音乐音量上限（当前设置的50%）
  let musicVolume = 0;           // 当前音乐音量（0~MAX_MUSIC_VOL）
  var PRELOAD = { total: 0, loaded: 0, revealFn: null, active: false, done: false, startTime: 0 };
  var eggFound = {};
  var tracksPlayed = {};
  var brandClicks = 0;
  var flippedCards = {};
  var seasonsTried = {};
  var sectionsVisited = {};

  /* ---------- 开场齿轮咔哒声（Web Audio API，无需音频文件） ---------- */
  // 共享 AudioContext：首次用户交互时创建，确保浏览器允许播放
  var gearCtx = null;
  function unlockAudio() {
    if (gearCtx) { if (gearCtx.state === "suspended") gearCtx.resume().catch(function(){}); return; }
    try {
      gearCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (gearCtx.state === "suspended") gearCtx.resume().catch(function(){});
    } catch (e) {}
  }
  ["click", "touchstart", "keydown"].forEach(function (ev) {
    document.addEventListener(ev, unlockAudio, { passive: true });
  });

  function playGearSound() {
    if (!gearCtx || gearCtx.state !== "running") return;
    try {
      var now = gearCtx.currentTime;
      for (var i = 0; i < 3; i++) {
        var t = now + i * 0.07;
        // 机械咔哒声：短促带通滤波噪声
        var buf = gearCtx.createBuffer(1, Math.floor(gearCtx.sampleRate * 0.025), gearCtx.sampleRate);
        var data = buf.getChannelData(0);
        for (var j = 0; j < data.length; j++) {
          data[j] = (Math.random() * 2 - 1) * Math.pow(1 - j / data.length, 3);
        }
        var src = gearCtx.createBufferSource();
        src.buffer = buf;
        var filter = gearCtx.createBiquadFilter();
        filter.type = "bandpass";
        filter.frequency.value = 600 + i * 300;
        filter.Q.value = 4;
        var gain = gearCtx.createGain();
        gain.gain.setValueAtTime(0.18, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
        src.connect(filter).connect(gain).connect(gearCtx.destination);
        src.start(t);
        // 低频撞击感
        var osc = gearCtx.createOscillator();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.04);
        var og = gearCtx.createGain();
        og.gain.setValueAtTime(0.12, t);
        og.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
        osc.connect(og).connect(gearCtx.destination);
        osc.start(t);
        osc.stop(t + 0.05);
      }
    } catch (e) {}
  }

  /* ---------- 数据加载：优先 window.SITE_DATA（file:// 也能用） ---------- */
  function loadData() {
    return new Promise((resolve) => {
      if (window.SITE_DATA && Object.keys(window.SITE_DATA).length) {
        resolve(window.SITE_DATA);
        return;
      }
      fetch("data.json")
        .then((r) => {
          if (!r.ok) throw new Error("no data.json");
          return r.json();
        })
        .then(resolve)
        .catch(() => resolve(null));
    });
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function fileExt(name) {
    const m = /\.([A-Za-z0-9]+)$/.exec(name || "");
    return m ? m[1].toUpperCase() : "";
  }

  function isVideoFile(name) {
    return /\.(mp4|webm|mov|avi|mkv|m4v)$/i.test(name || "");
  }

  /* ---------- 渲染：关于我 ---------- */
  function renderProfile(p) {
    if (!p) return;
    const name = p.name || "钟智轩";
    $("#heroName").textContent = name;
    $("#heroSub").textContent = p.tagline || "";
    if (p.heroKicker) $("#heroKicker").textContent = p.heroKicker;
    $("#aboutName").textContent = name;
    $("#aboutAlias").textContent = [p.enName, p.nickname].filter(Boolean).join(" · ");
    if (p.avatar) $("#avatar").src = p.avatar;

    // 开场动画文字
    if (p.intro) {
      if (p.intro.mark) $("#introMark").textContent = p.intro.mark;
      if (p.intro.name) $("#introName").textContent = p.intro.name;
      if (p.intro.sub) $("#introSub").textContent = p.intro.sub;
    }

    // 标签（技能已在数据看板雷达图展示）
    var tags = p.tags || [];
    $("#tagList").innerHTML = tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join("");

    // 简介（数组或字符串）
    const bioEl = $("#bio");
    let paras = p.bio || [];
    if (typeof paras === "string") paras = [paras];
    bioEl.innerHTML = paras.map((t) => `<p>${esc(t)}</p>`).join("");
  }

  /* ---------- 渲染：日常（单图 / 图片组 / 视频） ---------- */
  function renderDaily(daily) {
    const grid = $("#dailyGrid");
    if (!daily || !daily.length) {
      grid.innerHTML = '<div class="empty-state">还没有日常内容～ 把照片或视频放进 <code>content/daily/</code> 文件夹后运行 <code>node build.js</code></div>';
      return;
    }
    grid.innerHTML = daily
      .map((d, i) => {
        let media;
        if (d.type === "album") {
          media = `
            <img src="${esc(d.thumb || d.files[0])}" alt="${esc(d.title)}" loading="lazy">
            <span class="daily-badge">📷 共 ${d.files.length} 张</span>`;
        } else if (d.type === "video") {
          media = `
            <img src="${esc(d.thumb || d.poster || "content/works/video.svg")}" alt="${esc(d.title)}" loading="lazy">
            <span class="daily-badge video">🎬 视频</span>
            <div class="play-overlay"><span class="play-icon">▶</span></div>`;
        } else {
          media = `<img src="${esc(d.thumb || d.src)}" alt="${esc(d.title)}" loading="lazy">`;
        }
        return `
      <figure class="daily-item reveal" data-index="${i}" style="transition-delay:${(i % 8) * 70}ms">
        ${media}
        <figcaption class="daily-meta">
          <span>${esc(d.title)}</span>
          ${d.date ? `<time>${esc(d.date)}</time>` : ""}
          ${d.desc ? `<em>${esc(d.desc)}</em>` : ""}
        </figcaption>
      </figure>`;
      })
      .join("");

    // 点击查看：单图/视频进灯箱；图片组展开为多张轮播
    $$(".daily-item", grid).forEach((el) => {
      el.addEventListener("click", () => {
        const item = daily[+el.dataset.index];
        if (!item) return;
        // 图片组用卡片堆叠查看器，单图/视频用灯箱
        if (item.type === "album") {
          openCardStack(item);
          return;
        }
        const slides = [];
        if (item.type === "video") {
          slides.push({ type: "video", file: item.file, title: item.title, desc: item.desc });
        } else {
          slides.push({ type: "image", file: item.src, title: item.title, desc: item.desc });
        }
        openLightbox(slides, 0, slides[0].type);
      });
    });
  }

  /* ---------- 每日精选照片 ---------- */
  function renderFeatured(daily) {
    var el = $("#featuredPhoto");
    if (!el || !daily || !daily.length) { if (el) el.style.display = "none"; return; }
    // 用日期确定性地选一张（每天不同）
    var now = new Date();
    var dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
    var item = daily[dayOfYear % daily.length];
    var img = $("#featuredImg");
    var src = "";
    // 使用原图而非缩略图（今日精选展示较大尺寸，需要清晰度）
    if (item.type === "album") src = item.files && item.files.length ? item.files[0] : "";
    else if (item.type === "video") src = item.poster || "";
    else src = item.src || "";
    if (!src) { el.style.display = "none"; return; }
    img.src = src;
    img.alt = item.title || "今日精选";
    $("#featuredTitle").textContent = item.title || "";
    var dateStr = "";
    if (item.date) dateStr = item.date;
    else dateStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
    $("#featuredDate").textContent = dateStr;
    el.addEventListener("click", function () {
      if (item.type === "album") { openCardStack(item); return; }
      var slides = [];
      if (item.type === "video") slides.push({ type: "video", file: item.file, title: item.title, desc: item.desc });
      else slides.push({ type: "image", file: item.src, title: item.title, desc: item.desc });
      openLightbox(slides, 0, slides[0].type);
    });
  }

  /* ---------- 渲染：作品 ---------- */
  const TYPE_LABEL = { video: "视频", image: "图片", doc: "文档" };

  function renderWorks(works) {
    const grid = $("#worksGrid");
    // 收集所有标签
    var allTags = [];
    (works || []).forEach(function (w) {
      (w.tags || []).forEach(function (t) { if (!allTags.includes(t)) allTags.push(t); });
    });
    // 渲染标签筛选栏（有标签时才显示）
    var tagBar = $("#tagFilterBar");
    if (tagBar) tagBar.remove();
    if (allTags.length) {
      tagBar = document.createElement("div");
      tagBar.id = "tagFilterBar";
      tagBar.className = "tag-filter-bar reveal";
      var btns = '<button class="tag-filter-btn is-active" data-tag="">全部主题</button>';
      allTags.forEach(function (t) {
        btns += '<button class="tag-filter-btn' + (currentTag === t ? " is-active" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</button>";
      });
      tagBar.innerHTML = btns;
      var filterBar = $("#filterBar");
      if (filterBar && filterBar.parentNode) filterBar.parentNode.insertBefore(tagBar, filterBar.nextSibling);
      $$(".tag-filter-btn", tagBar).forEach(function (b) {
        b.addEventListener("click", function () {
          $$(".tag-filter-btn", tagBar).forEach(function (x) { x.classList.remove("is-active"); });
          b.classList.add("is-active");
          currentTag = b.dataset.tag || null;
          renderWorks(DATA.works);
          setupReveal();
        });
      });
    }

    const list = (works || []).filter(function (w) {
      if (currentFilter !== "all" && w.type !== currentFilter) return false;
      if (currentTag && !(w.tags || []).includes(currentTag)) return false;
      return true;
    });

    if (!list.length) {
      grid.innerHTML = `<div class="empty-state">${
        works && works.length
          ? "这个分类下还没有作品～"
          : "还没有作品～ 把文件放进 <code>content/works/video|image|doc/</code> 后运行 <code>node build.js</code>"
      }</div>`;
      return;
    }

    grid.innerHTML = list
      .map((w, i) => {
        const ext = fileExt(w.file);
        const badge = `<span class="work-badge ${w.type}">${TYPE_LABEL[w.type] || w.type}${ext ? " · " + ext : ""}</span>`;
        const tagsHtml = (w.tags && w.tags.length) ? `<div class="work-tags">${w.tags.map((t) => `<span class="work-tag">#${esc(t)}</span>`).join("")}</div>` : "";

        if (w.type === "doc") {
          return `
          <article class="work-card reveal" data-type="${w.type}" style="transition-delay:${(i % 8) * 70}ms">
            <div class="work-media" style="cursor:default">
              <img src="${esc(w.poster || "content/works/doc.svg")}" alt="${esc(w.title)}" loading="lazy">
              <span class="work-dimmer"></span>
              ${badge}
              <span class="work-comment">⬇ 点击下载${ext ? " · " + ext + " 文件" : ""}</span>
            </div>
            <div class="work-body">
              <h3 class="work-title">${esc(w.title)}</h3>
              ${w.desc ? `<p class="work-desc">${esc(w.desc)}</p>` : ""}
              <div class="doc-actions">
                <a class="doc-btn primary" href="${esc(w.file)}" download>⬇ 下载文件</a>
                <a class="doc-btn" href="${esc(w.file)}" target="_blank" rel="noopener">打开</a>
              </div>
              <div class="work-foot">
                <span class="doc-type ${ext}">${ext || "FILE"}</span>
                <span>${w.date || ""}${w.size ? " · " + w.size : ""}</span>
              </div>
              ${tagsHtml}
            </div>
          </article>`;
        }

        if (w.type === "video") {
          return `
          <article class="work-card reveal" data-type="${w.type}" data-index="${i}" style="transition-delay:${(i % 8) * 70}ms">
            <div class="work-media">
              <img src="${esc(w.thumb || w.poster || "content/works/video.svg")}" alt="${esc(w.title)}" loading="lazy">
              <span class="work-dimmer"></span>
              ${badge}
              <div class="play-overlay"><span class="play-icon">▶</span></div>
              <span class="work-comment">${esc(w.desc || "点击播放视频")}</span>
            </div>
            <div class="work-body">
              <h3 class="work-title">${esc(w.title)}</h3>
              ${w.desc ? `<p class="work-desc">${esc(w.desc)}</p>` : ""}
              <div class="work-foot">
                <span>${esc(w.date || "")}</span>
                <span>${w.size || ""}</span>
              </div>
              ${tagsHtml}
            </div>
          </article>`;
        }

        // image
        return `
        <article class="work-card reveal" data-type="${w.type}" data-index="${i}" style="transition-delay:${(i % 8) * 70}ms">
          <div class="work-media">
            <img src="${esc(w.thumb || w.file)}" alt="${esc(w.title)}" loading="lazy">
            <span class="work-dimmer"></span>
            ${badge}
            <span class="work-comment">${esc(w.desc || "点击查看大图")}</span>
          </div>
          <div class="work-body">
            <h3 class="work-title">${esc(w.title)}</h3>
            ${w.desc ? `<p class="work-desc">${esc(w.desc)}</p>` : ""}
            <div class="work-foot">
              <span>${esc(w.date || "")}</span>
              <span>${w.size || ""}</span>
            </div>
            ${tagsHtml}
          </div>
        </article>`;
      })
      .join("");

    // 绑定点击：图片/视频进灯箱
    $$(".work-card[data-index]", grid).forEach((el) => {
      el.addEventListener("click", () => {
        const i = +el.dataset.index;
        const kind = el.dataset.type;
        openLightbox(list, i, kind);
      });
    });
  }

  /* ---------- 渲染：联系 ---------- */
  function renderContact(c) {
    if (!c) return;
    var LOGOS = {
      wechat: '<svg viewBox="0 0 24 24" fill="#07c160" width="30" height="30"><path d="M9.5 4C5.36 4 2 6.69 2 10c0 1.89 1.02 3.56 2.62 4.66L4 17l2.84-1.5c.86.24 1.74.37 2.66.37.16 0 .31-.01.47-.02A5.7 5.7 0 0 1 9.7 14c0-3.14 2.91-5.7 6.5-5.7.16 0 .31.01.47.02C16.13 5.85 13.1 4 9.5 4zm-2.06 4.5a.94.94 0 1 1 0 1.88.94.94 0 0 1 0-1.88zm4.12 0a.94.94 0 1 1 0 1.88.94.94 0 0 1 0-1.88zm4.64 1.8c-3.04 0-5.5 2.1-5.5 4.7s2.46 4.7 5.5 4.7c.7 0 1.36-.11 1.96-.3L21 20l-.55-1.68c1.05-.86 1.7-2.04 1.7-3.32 0-2.6-2.46-4.7-5.5-4.7zm-1.8 2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5zm3.6 0a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z"/></svg>',
      bilibili: '<svg viewBox="0 0 24 24" fill="#fb7299" width="30" height="30"><path d="M17.8 4.65h.85c1.51.05 2.77.46 3.77 1.21 1.25 1.05 1.88 2.68 1.88 4.91v6.43c0 2.23-.63 3.86-1.88 4.91-1 .75-2.26 1.16-3.77 1.21H6.04c-1.51-.06-2.77-.46-3.77-1.21C1.02 21.06.39 19.43.39 17.2V10.77c0-2.23.63-3.86 1.88-4.91 1-.75 2.26-1.16 3.77-1.21h11.76zM7.3 8.04a.93.93 0 0 0-.93.93v6.06a.93.93 0 0 0 .93.93h.07a.93.93 0 0 0 .93-.93V8.97a.93.93 0 0 0-.93-.93zm4.5 0a.93.93 0 0 0-.93.93v6.06a.93.93 0 0 0 .93.93h.07a.93.93 0 0 0 .93-.93V8.97a.93.93 0 0 0-.93-.93zM5.2 1.5l2.02 2.02a.7.7 0 0 1-.99.99L4.21 2.49a.7.7 0 0 1 .99-.99zm13.6 0a.7.7 0 0 1 .99.99l-2.02 2.02a.7.7 0 0 1-.99-.99z"/></svg>',
      xhh: '<svg viewBox="0 0 24 24" width="30" height="30"><rect x="2" y="2" width="20" height="20" rx="5" fill="#1a1a1a"/><path d="M12 6.5L7 9.5v5l5 3 5-3v-5z" fill="none" stroke="#ff6b35" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="2" fill="#ff6b35"/></svg>'
    };
    var items = [];
    if (c.email) items.push(["📧", "邮箱", c.email, null, false]);
    if (c.wechat) items.push([LOGOS.wechat, "微信", c.wechat, null, true]);
    if (c.bilibili) items.push([LOGOS.bilibili, "B 站", "点击访问主页", c.bilibili, true]);
    if (c.xhh) items.push([LOGOS.xhh, "小黑盒", c.xhh, null, true]);
    if (c.douyin) items.push(["🎵", "抖音", "点击访问主页", c.douyin, false]);
    if (c.zhihu) items.push(["💡", "知乎", "点击访问主页", c.zhihu, false]);
    if (c.github) items.push(["🐙", "GitHub", "点击访问主页", c.github, false]);
    if (c.phone) items.push(["📱", "电话", c.phone, null, false]);
    if (c.location) items.push(["📍", "所在地", c.location, null, false]);
    if (!items.length) items.push(["✉️", "联系我", "（在 content/profile.json 里填写联系方式）", null, false]);

    var html = items.map(function (arr, i) {
      var icon = arr[0], label = arr[1], value = arr[2], link = arr[3], isSvg = arr[4];
      var tag = link ? "a" : "div";
      var href = link ? ' href="' + esc(link) + '" target="_blank" rel="noopener"' : "";
      return '<' + tag + ' class="contact-item reveal"' + href + ' style="transition-delay:' + ((i % 4) * 80) + 'ms">' +
        '<div class="icon' + (isSvg ? " icon-svg" : "") + '">' + icon + '</div><h4>' + label + '</h4><p>' + esc(value) + '</p></' + tag + '>';
    }).join("");

    $("#contactGrid").innerHTML = html;
  }

  /* ---------- 渲染：友情链接 ---------- */
  function renderFriends(friends) {
    var grid = $("#friendsGrid");
    if (!grid) return;
    if (!friends || !friends.length) { grid.innerHTML = '<div class="friends-empty">广告位招租！（皮一下，欢迎各位好盆友们互挂友链）</div>'; return; }
    grid.innerHTML = friends.map(function (f, i) {
      var initial = (f.name || "?").charAt(0);
      var avatar = f.avatar
        ? '<div class="friend-avatar"><img src="' + esc(f.avatar) + '" alt="' + esc(f.name) + '" loading="lazy"></div>'
        : '<div class="friend-avatar">' + esc(initial) + '</div>';
      return '<a class="friend-card reveal" href="' + esc(f.url || "#") + '" target="_blank" rel="noopener" style="transition-delay:' + ((i % 4) * 80) + 'ms">' +
        avatar +
        '<div class="friend-info">' +
        '<div class="friend-name">' + esc(f.name || "") + '</div>' +
        (f.desc ? '<div class="friend-desc">' + esc(f.desc) + '</div>' : '') +
        '</div></a>';
    }).join("");
  }

  /* ---------- 灯箱 ---------- */
  function openLightbox(list, index, kind) {
    if (!list || !list.length) return;
    lightboxList = list;
    lightboxIndex = index;
    const lb = $("#lightbox");

    const render = () => {
      const item = lightboxList[lightboxIndex];
      if (!item) return;
      let inner = "";
      const srcFile = item.file || item.src || "";
      if (kind === "video" || isVideoFile(srcFile)) {
        // 彩蛋：视频鉴赏
        if (typeof discoverEgg === "function") discoverEgg("video-viewer");
        inner = srcFile
          ? `<video src="${esc(srcFile)}" controls autoplay preload="metadata" playsinline></video>
             <div class="video-controls">
               <span class="vc-label">倍速</span>
               <button class="vc-btn" data-rate="0.5">0.5×</button>
               <button class="vc-btn is-active" data-rate="1">1×</button>
               <button class="vc-btn" data-rate="2">2×</button>
             </div>`
          : `<div style="color:#fff;text-align:center;padding:30px">🎬 示例占位<br><small>把真实视频文件放进 content/works/video/ 后重新构建</small></div>`;
      } else {
        inner = `<img src="${esc(srcFile)}" alt="${esc(item.title)}">`;
      }
      $("#lightboxBody").innerHTML = inner;
      // 视频音量 + 暂停背景音乐
      const vid = $("#lightboxBody video");
      if (vid) {
        vid.volume = videoVolume;
        const bg = $("#bgMusic");
        if (bg && !bg.paused) {
          bgMusicWasPlaying = true;
          bg.pause();
          const btn = $("#musicPlay");
          if (btn) { btn.classList.remove("is-playing"); btn.textContent = "▶"; }
        } else {
          bgMusicWasPlaying = false;
        }
        // 倍速控制
        $$(".vc-btn", $("#lightboxBody")).forEach(function (b) {
          b.addEventListener("click", function () {
            $$(".vc-btn", $("#lightboxBody")).forEach(function (x) { x.classList.remove("is-active"); });
            b.classList.add("is-active");
            vid.playbackRate = parseFloat(b.dataset.rate);
          });
        });
      }
      // ===== 生成右侧配文（基于文件名 + 合集上下文） =====
      const srcFile2 = item.file || item.src || "";
      var baseName = srcFile2.split("/").pop().replace(/\.[^.]+$/, "");
      var cleanName = baseName.replace(/^\d{4}[-_.]\d{2}[-_.]\d{2}[_\s]*/, "").trim();
      var capTitle = item.title || cleanName || "";
      var capDesc = item.desc || "";
      // 判断合集来源
      var collection = "";
      if (srcFile2.indexOf("/daily/") !== -1) {
        var parts = srcFile2.split("/");
        var idx = parts.indexOf("daily");
        if (idx >= 0 && parts[idx + 1]) collection = parts[idx + 1];
      } else if (srcFile2.indexOf("/works/") !== -1) {
        collection = "作品集";
      }
      var capHtml = '<div class="lb-cap-title">' + esc(capTitle) + '</div>';
      if (capDesc) capHtml += '<div class="lb-cap-desc">' + esc(capDesc) + '</div>';
      if (collection && collection !== capTitle) {
        capHtml += '<div class="lb-cap-desc" style="opacity:.6;font-size:.8rem">收录于「' + esc(collection) + '」</div>';
      }
      if (cleanName && cleanName !== capTitle) {
        capHtml += '<div class="lb-cap-file">' + esc(cleanName) + '</div>';
      }
      $("#lightboxCaption").innerHTML = capHtml;
      lb.classList.toggle("has-nav", lightboxList.length > 1);
    };

    render();
    lb.classList.add("is-open");
    lb.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";

    const prev = () => {
      lightboxIndex = (lightboxIndex - 1 + lightboxList.length) % lightboxList.length;
      render();
    };
    const next = () => {
      lightboxIndex = (lightboxIndex + 1) % lightboxList.length;
      render();
    };
    const close = () => {
      lb.classList.remove("is-open");
      lb.setAttribute("aria-hidden", "true");
      document.body.style.overflow = "";
      $("#lightboxBody").innerHTML = "";
      // 恢复背景音乐
      if (bgMusicWasPlaying) {
        const bg = $("#bgMusic");
        if (bg) {
          bg.volume = musicVolume;
          bg.play().catch(function () {});
          const btn = $("#musicPlay");
          if (btn) { btn.classList.add("is-playing"); btn.textContent = "⏸"; }
        }
        bgMusicWasPlaying = false;
      }
    };

    lb._prev = prev;
    lb._next = next;
    lb._close = close;
  }

  function closeLightbox() {
    const lb = $("#lightbox");
    if (lb._close) lb._close();
  }

  /* ---------- 滚动入场 ---------- */
  function setupReveal() {
    const els = $$(".reveal");
    if (!("IntersectionObserver" in window)) {
      els.forEach((el) => el.classList.add("is-visible"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        });
      },
      { threshold: 0.12 }
    );
    els.forEach((el) => io.observe(el));
  }

  /* ---------- 导航行为 ---------- */
  function setupNav() {
    const toggle = $("#navToggle");
    const links = $("#navLinks");

    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
      // 移动端：打开菜单时锁定页面滚动，关闭时恢复
      if (window.innerWidth <= 640) {
        document.body.style.overflow = open ? "hidden" : "";
      }
    });
    $$(".nav-link", links).forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("is-open");
        toggle.classList.remove("is-open");
        document.body.style.overflow = "";
      })
    );

    // 高亮当前区块
    const sections = $$("main section[id]");
    const navLinks = $$(".nav-link");
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          navLinks.forEach((l) =>
            l.classList.toggle("is-active", l.getAttribute("href") === "#" + e.target.id)
          );
        });
      },
      { rootMargin: "-40% 0px -55% 0px" }
    );
    sections.forEach((s) => spy.observe(s));
  }

  /* ---------- 灯箱全局事件 ---------- */
  function setupLightboxEvents() {
    $("#lightboxClose").addEventListener("click", closeLightbox);
    $("#lightboxPrev").addEventListener("click", () => $("#lightbox")._prev && $("#lightbox")._prev());
    $("#lightboxNext").addEventListener("click", () => $("#lightbox")._next && $("#lightbox")._next());
    $("#lightbox").addEventListener("click", (e) => {
      if (e.target === $("#lightbox")) closeLightbox();
    });
    document.addEventListener("keydown", (e) => {
      if (!$("#lightbox").classList.contains("is-open")) return;
      if (e.key === "Escape") closeLightbox();
      if (e.key === "ArrowLeft") $("#lightbox")._prev && $("#lightbox")._prev();
      if (e.key === "ArrowRight") $("#lightbox")._next && $("#lightbox")._next();
    });
  }

  /* ---------- 作品筛选 ---------- */
  function setupFilters(works) {
    $$(".filter-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        $$(".filter-btn").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        currentFilter = btn.dataset.filter;
        renderWorks(works);
        setupReveal();
      });
    });
  }

  /* ---------- 入场过渡动画 ---------- */
  function initIntro() {
    const intro = $("#intro");
    const hero = $(".hero");
    if (!intro || !hero) return;

    // 配置：true = 同一会话只播一次（刷新不重播）；
    //       false = 每次进入都播放（默认，方便随时看效果）
    const ONCE_PER_SESSION = false;

    let hidden = false;
    const revealHome = (opts) => {
      if (hidden) return;
      hidden = true;
      document.body.style.overflow = "";
      hero.classList.add("is-ready");               // 首页元素开始逐帧入场
      setTimeout(() => {
        intro.classList.add("is-hidden");           // 向上滑退动画开始
        playGearSound();                             // 齿轮声与滑退同步出现
      }, 800);
      document.dispatchEvent(new CustomEvent("intro-done", { detail: { skipped: !!(opts && opts.skipped) } }));
    };

    // 可选：同一会话内不再重播（file:// 无 sessionStorage 时每次都会播）
    if (ONCE_PER_SESSION) {
      let seen = false;
      try { seen = !!sessionStorage.getItem("intro-seen"); } catch (e) {}
      if (seen) {
        intro.classList.add("is-hidden");
        hero.classList.add("is-ready");
        document.dispatchEvent(new CustomEvent("intro-done"));
        return;
      }
      try { sessionStorage.setItem("intro-seen", "1"); } catch (e) {}
    }

    var ver = (window.SITE_DATA && window.SITE_DATA.version) || "1.0.0.1";
    var ivEl = $("#introVersion"); if (ivEl) ivEl.textContent = "v" + ver;
    document.body.style.overflow = "hidden";        // 播放期间锁定滚动
    const skipBtn = $("#introSkip");
    if (skipBtn) skipBtn.addEventListener("click", () => revealHome({ skipped: true }));

    // 日常预加载见 loadData.then（new Image 触发，开场期间执行，带进度跟踪）

    // 开场动画持续 15-25 秒（随机），无视 reduced motion 设置
    // 若预加载提前 100% 完成，会在 ≥3.5s 后提前结束（见 loadData.then）
    var introDur = 15000 + Math.floor(Math.random() * 10000);
    PRELOAD.revealFn = revealHome;
    PRELOAD.active = true;
    PRELOAD.startTime = Date.now();
    setTimeout(revealHome, introDur);
  }

  /* ---------- 滚动进度条 / 回到顶部 / 侧边导航填充 / 导航栏状态 ---------- */
  function setupChrome() {
    const bar = $("#scrollProgress");
    const toTop = $("#toTop");
    const sideFill = $("#sideFill");
    const header = $("#siteHeader");
    const update = () => {
      const st = window.scrollY || document.documentElement.scrollTop || 0;
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      const pct = Math.min(100, (st / max) * 100);
      if (bar) bar.style.width = pct + "%";
      if (sideFill) sideFill.style.height = pct + "%";
      if (toTop) toTop.classList.toggle("is-visible", st > 600);
      if (header) header.classList.toggle("is-scrolled", st > 10);
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
    if (toTop) toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  /* ---------- 打字机循环 ---------- */
  function setupTyped() {
    const el = $("#typedText");
    if (!el) return;
    const words = (DATA.profile && DATA.profile.tags) || ["机械", "3D建模", "动手DIY"];
    // 打字效果是文字内容，不受 reduced-motion 影响——始终运行

    let wi = 0, ci = 0, deleting = false;
    const tick = () => {
      const word = words[wi];
      if (!deleting) {
        ci++;
        el.textContent = word.slice(0, ci);
        if (ci >= word.length) { deleting = true; setTimeout(tick, 1500); return; }
        setTimeout(tick, 95);
      } else {
        ci--;
        el.textContent = word.slice(0, ci);
        if (ci <= 0) { deleting = false; wi = (wi + 1) % words.length; setTimeout(tick, 350); return; }
        setTimeout(tick, 45);
      }
    };
    var started = false;
    function startTick() { if (started) return; started = true; setTimeout(tick, 200); }
    // 开场动画结束后启动打字效果
    document.addEventListener("intro-done", startTick);
    // 兜底：26 秒后无论如何都启动（≥ 开场最大 25 秒 + 1 秒余量）
    setTimeout(startTick, 26000);
  }

  /* ---------- 左侧章节导航 ---------- */
  function setupSideNav() {
    const dots = $$(".side-dot");
    if (!dots.length) return;

    // 高亮当前章节（滚动进度填充由 setupChrome 统一处理）
    const spy = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          dots.forEach((d) =>
            d.classList.toggle("is-active", d.getAttribute("href") === "#" + e.target.id)
          );
        });
      },
      { rootMargin: "-38% 0px -55% 0px" }
    );
    $$("main section[id]").forEach((s) => spy.observe(s));
  }

  /* ---------- 背景音乐播放器 ---------- */
  function setupMusic() {
    const TRACKS = [
      { name: "海风海浪", icon: "🌊", file: "content/audio/海风海浪.mp3?v=2" },
      { name: "春日鸟鸣", icon: "🌿", file: "content/audio/春日鸟鸣.mp3?v=2" },
      { name: "都市喧嚣", icon: "🏙️", file: "content/audio/都市喧嚣.mp3?v=2" },
    ];

    const audio = $("#bgMusic");
    const card = $("#musicCard");
    const playBtn = $("#musicPlay");
    const collapseBtn = $("#musicCollapse");
    const tracksEl = $("#musicTracks");
    const musicVol = $("#musicVol");
    const musicVolVal = $("#musicVolVal");
    const videoVol = $("#videoVol");
    const videoVolVal = $("#videoVolVal");
    const musicIcon = $("#musicIcon");
    const musicNow = $("#musicNow");
    const musicPrev = $("#musicPrev");
    const musicNext = $("#musicNext");
    const musicBar = $("#musicBar");
    const musicBarFill = $("#musicBarFill");
    const musicTime = $("#musicTime");
    const musicTotal = $("#musicTotal");
    if (!audio || !playBtn) return;

    let currentTrack = 0;
    let isPlaying = false;

    // 实际音量 = 滑块值 × 上限（拉满也不刺耳）
    function calcVol() {
      return (parseInt(musicVol.value, 10) / 100) * MAX_MUSIC_VOL;
    }

    function updateIcon() {
      if (musicIcon) musicIcon.textContent = TRACKS[currentTrack].icon;
      if (musicNow) musicNow.textContent = TRACKS[currentTrack].icon + " " + TRACKS[currentTrack].name;
    }

    function fmtTime(s) {
      if (!s || isNaN(s)) return "0:00";
      var m = Math.floor(s / 60), sec = Math.floor(s % 60);
      return m + ":" + (sec < 10 ? "0" : "") + sec;
    }

    function switchTrack(idx) {
      currentTrack = idx;
      audio.src = TRACKS[idx].file;
      $$(".track-btn", tracksEl).forEach(function (b, i) {
        b.classList.toggle("is-active", i === idx);
      });
      updateIcon();
      if (isPlaying) audio.play().catch(function () {});
      tracksPlayed[idx] = true;
      if (Object.keys(tracksPlayed).length >= TRACKS.length && typeof discoverEgg === "function") discoverEgg("music-lover");
    }

    function setPlaying(playing) {
      isPlaying = playing;
      playBtn.classList.toggle("is-playing", playing);
      playBtn.textContent = playing ? "⏸" : "▶";
      card.classList.toggle("is-playing", playing);
    }

    // 渐入：从 0 平滑升到目标音量（约 3 秒）
    function fadeIn() {
      var target = calcVol();
      musicVolume = target;
      audio.volume = 0;
      var step = 0, total = 100; // 100×50ms = 5秒渐入
      var timer = setInterval(function () {
        step++;
        audio.volume = Math.min(target, target * (step / total));
        if (step >= total) { audio.volume = target; clearInterval(timer); }
      }, 50);
    }

    // 自动播放（开场动画结束后触发；被拦截则等首次交互）
    function tryAutoPlay() {
      if (!audio.src) switchTrack(0);
      audio.volume = 0;
      audio.play().then(function () {
        setPlaying(true);
        fadeIn();
      }).catch(function () {
        var onInteract = function () {
          document.removeEventListener("click", onInteract);
          document.removeEventListener("touchstart", onInteract);
          audio.volume = 0;
          audio.play().then(function () { setPlaying(true); fadeIn(); }).catch(function () {});
        };
        document.addEventListener("click", onInteract, { once: true });
        document.addEventListener("touchstart", onInteract, { once: true });
      });
    }

    // 播放/暂停
    playBtn.addEventListener("click", function () {
      if (!audio.src) switchTrack(0);
      if (audio.paused) {
        audio.volume = calcVol();
        musicVolume = calcVol();
        audio.play().then(function () { setPlaying(true); }).catch(function () { setPlaying(false); });
      } else {
        audio.pause();
        setPlaying(false);
      }
    });

    // 曲目选择
    $$(".track-btn", tracksEl).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.dataset.track, 10);
        if (idx !== currentTrack || !isPlaying) {
          switchTrack(idx);
          if (!isPlaying) {
            audio.volume = calcVol();
            musicVolume = calcVol();
            audio.play().then(function () { setPlaying(true); }).catch(function () {});
          }
        }
      });
    });

    // 音乐音量（上限限制）
    musicVol.addEventListener("input", function () {
      musicVolume = calcVol();
      audio.volume = musicVolume;
      musicVolVal.textContent = musicVol.value;
    });
    musicVolume = calcVol();
    audio.volume = musicVolume;

    // 视频音量
    videoVol.addEventListener("input", function () {
      videoVolume = parseInt(videoVol.value, 10) / 100;
      videoVolVal.textContent = videoVol.value;
      document.querySelectorAll("video").forEach(function (v) { v.volume = videoVolume; });
    });

    // 收起/展开
    var expandTimer1 = null, expandTimer2 = null;
    function toggleCollapse() {
      if (card.classList.contains("is-collapsed")) {
        // 展开：先测量目标尺寸，再触发动画
        clearTimeout(expandTimer1); clearTimeout(expandTimer2);
        hideBubble(true);
        card.classList.add("no-anim");
        card.classList.remove("is-collapsed");
        card.style.setProperty("--cw", card.offsetWidth + "px");
        card.style.setProperty("--ch", card.offsetHeight + "px");
        card.classList.add("is-collapsed"); // 先回到球状态
        card.offsetWidth; // 强制 reflow
        card.classList.remove("no-anim");
        card.classList.remove("is-collapsed"); // 触发展开动画
        card.classList.add("is-expanding");
        // 0.8s 后内容淡入（此时卡片已展开到足够宽度）
        expandTimer1 = setTimeout(function () { card.classList.add("is-content-in"); }, 800);
        // 1.2s 后清理动画类
        expandTimer2 = setTimeout(function () { card.classList.remove("is-expanding"); card.classList.remove("is-content-in"); }, 1200);
      } else {
        // 缩球：清理展开状态，记录当前尺寸
        clearTimeout(expandTimer1); clearTimeout(expandTimer2);
        card.classList.remove("is-expanding", "is-content-in");
        card.style.setProperty("--cw", card.offsetWidth + "px");
        card.style.setProperty("--ch", card.offsetHeight + "px");
        card.classList.add("is-collapsed");
      }
    }
    if (collapseBtn) collapseBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleCollapse(); });
    card.addEventListener("click", function () {
      if (card.classList.contains("is-collapsed")) toggleCollapse();
    });

    audio.addEventListener("ended", function () {
      // 自动播放下一首（循环到最后再回到第一首）
      var next = (currentTrack + 1) % TRACKS.length;
      switchTrack(next);
    });

    // 进度条
    audio.addEventListener("timeupdate", function () {
      if (musicBarFill && audio.duration) {
        musicBarFill.style.width = (audio.currentTime / audio.duration * 100) + "%";
      }
      if (musicTime) musicTime.textContent = fmtTime(audio.currentTime);
    });
    audio.addEventListener("loadedmetadata", function () {
      if (musicTotal) musicTotal.textContent = fmtTime(audio.duration);
    });
    // 点击进度条跳转
    if (musicBar) musicBar.addEventListener("click", function (e) {
      var rect = musicBar.getBoundingClientRect();
      var pct = (e.clientX - rect.left) / rect.width;
      if (audio.duration) audio.currentTime = pct * audio.duration;
    });
    // 上一首/下一首
    if (musicPrev) musicPrev.addEventListener("click", function (e) {
      e.stopPropagation();
      var prev = (currentTrack - 1 + TRACKS.length) % TRACKS.length;
      switchTrack(prev);
      if (!isPlaying) { audio.volume = calcVol(); musicVolume = calcVol(); audio.play().then(function () { setPlaying(true); }).catch(function () {}); }
    });
    if (musicNext) musicNext.addEventListener("click", function (e) {
      e.stopPropagation();
      var next = (currentTrack + 1) % TRACKS.length;
      switchTrack(next);
      if (!isPlaying) { audio.volume = calcVol(); musicVolume = calcVol(); audio.play().then(function () { setPlaying(true); }).catch(function () {}); }
    });

    updateIcon();
    // 开场动画结束后自动渐入播放
    var autoPlayed = false;
    function startAutoPlay() { if (autoPlayed) return; autoPlayed = true; tryAutoPlay(); }
    document.addEventListener("intro-done", startAutoPlay);
    // 兜底：26 秒后无论如何都尝试播放（≥ 开场最大 25 秒 + 1 秒余量）
    setTimeout(startAutoPlay, 26000);

    // 页面隐藏/关闭时暂停音乐（切标签页、最小化、关闭网站）
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        if (!audio.paused) { audio.pause(); setPlaying(false); }
      }
    });
    window.addEventListener("pagehide", function () { audio.pause(); });

    // ====== 5秒后或首次页面交互后自动收起 + 气泡提示 ======
    var autoCollapsed = false;
    var bubbleRef = null, bubbleShowTimer = null, bubbleHideTimer = null;
    function hideBubble(removeNow) {
      if (bubbleShowTimer) { clearTimeout(bubbleShowTimer); bubbleShowTimer = null; }
      if (bubbleHideTimer) { clearTimeout(bubbleHideTimer); bubbleHideTimer = null; }
      if (!bubbleRef) return;
      var b = bubbleRef;
      b.classList.remove("is-show");
      bubbleRef = null;
      if (removeNow) {
        if (b.parentNode) b.parentNode.removeChild(b);
      } else {
        setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 400);
      }
    }
    function autoCollapse() {
      if (autoCollapsed) return;
      autoCollapsed = true;
      clearTimeout(expandTimer1); clearTimeout(expandTimer2);
      card.classList.remove("is-expanding", "is-content-in");
      card.style.setProperty("--cw", card.offsetWidth + "px");
      card.style.setProperty("--ch", card.offsetHeight + "px");
      card.classList.add("is-collapsed");
      // 等卡片完全缩成球（collapse-to-ball 动画 1.1s）后再弹气泡，3 秒后消失
      var bubble = document.createElement("div");
      bubble.className = "music-bubble";
      bubble.textContent = "背景音乐调节设置藏在这里哦~";
      document.body.appendChild(bubble);
      bubbleRef = bubble;
      bubbleShowTimer = setTimeout(function () {
        bubbleShowTimer = null;
        if (!bubbleRef) return;
        bubble.classList.add("is-show");
        bubbleHideTimer = setTimeout(function () {
          bubbleHideTimer = null;
          hideBubble(false);
        }, 3000);
      }, 1100);
    }
    // 开场动画结束后开始计时，5 秒后自动收起（= 开场结束 + 5 秒展示时间）
    document.addEventListener("intro-done", function (e) {
      if (e.detail && e.detail.skipped) return; // 点击跳过时不自动收起音乐卡片
      setTimeout(autoCollapse, 5000);
    });
    // 兜底：30 秒后无论如何都收起（≥ 开场最大 25 秒 + 5 秒）
    setTimeout(autoCollapse, 30000);
    // 首次点击/触摸/滚动（不在音乐卡片上）也触发收起
    function onInteract(e) {
      if (autoCollapsed) return;
      if (e && e.target && card.contains(e.target)) return;
      setTimeout(autoCollapse, 50);
    }
    // 延迟到开场动画结束后再监听，避免开场期间误触
    document.addEventListener("intro-done", function () {
      document.addEventListener("click", onInteract, { passive: true });
      document.addEventListener("touchstart", onInteract, { passive: true });
      document.addEventListener("scroll", onInteract, { passive: true });
    });
  }

  /* ---------- 数据看板 ---------- */
  function renderDashboard(data) {
    var p = data.profile || {};
    var daily = data.daily || [];
    var works = data.works || [];
    var projects = data.projects || [];
    var timeline = p.timeline || [];
    var friends = p.friends || [];
    var tags = p.tags || [];
    var skills = p.skills || [];
    var stats = [
      { emoji: "🎬", num: works.length, label: "件作品" },
      { emoji: "📸", num: daily.length, label: "条日常" },
      { emoji: "🔧", num: projects.length, label: "个项目" },
      { emoji: "📅", num: timeline.length, label: "个里程碑" },
      { emoji: "🏷️", num: tags.length, label: "个标签" },
      { emoji: "🤝", num: friends.length, label: "位好友" }
    ];
    $("#dashStats").innerHTML = stats.map(function (s) {
      return '<div class="dash-stat"><span class="dash-stat-emoji">' + s.emoji + '</span>' +
        '<div class="dash-stat-num" data-target="' + s.num + '">0</div>' +
        '<div class="dash-stat-label">' + s.label + '</div></div>';
    }).join("");
    var byType = { video: 0, image: 0, doc: 0 };
    works.forEach(function (w) { if (byType[w.type] !== undefined) byType[w.type]++; });
    var maxV = Math.max(1, byType.video, byType.image, byType.doc);
    var barColors = { video: "var(--accent)", image: "var(--sea)", doc: "var(--accent-dark)" };
    var barLabels = { video: "视频", image: "图片", doc: "文档" };
    var barsHtml = "";
    ["video", "image", "doc"].forEach(function (t) {
      var pct = Math.round(byType[t] / maxV * 100);
      barsHtml += '<div class="dash-bar-row"><span class="dash-bar-label">' + barLabels[t] + '</span>' +
        '<div class="dash-bar-track"><div class="dash-bar-fill" data-w="' + pct + '" style="width:0%;background:' + barColors[t] + '"></div></div>' +
        '<span class="dash-bar-val">' + byType[t] + ' 份</span></div>';
    });
    $("#dashBars").innerHTML = barsHtml;
    if (skills.length >= 3) renderRadar(skills);
    else $("#dashRadar").innerHTML = '<p style="color:var(--ink-faint);font-size:.85rem;text-align:center">至少需要3项技能才能绘制雷达图</p>';
    function animateDashboard() {
      $$(".dash-stat-num").forEach(function (el) {
        var target = +el.dataset.target;
        if (el.dataset.done) return;
        el.dataset.done = "1";
        if (target === 0) { el.textContent = "0"; return; }
        var cur = 0, step = Math.max(1, Math.ceil(target / 30));
        var timer = setInterval(function () { cur += step; if (cur >= target) { cur = target; clearInterval(timer); } el.textContent = cur; }, 30);
      });
      $$(".dash-bar-fill").forEach(function (el) {
        if (el.dataset.done) return;
        el.dataset.done = "1";
        var w = el.dataset.w || "0";
        requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.width = w + "%"; }); });
      });
    }
    var dashEl = $("#dashboard");
    if (dashEl) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) { animateDashboard(); io.disconnect(); } });
      }, { threshold: 0.2 });
      io.observe(dashEl);
    }
  }
  function renderRadar(skills) {
    var n = skills.length, cx = 160, cy = 160, R = 80, levels = 4;
    var html = '<svg viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg" style="overflow:visible">';
    for (var lv = levels; lv >= 1; lv--) {
      var pts = [];
      for (var i = 0; i < n; i++) { var ang = -Math.PI/2 + i*2*Math.PI/n; var r = R*lv/levels; pts.push((cx+Math.cos(ang)*r)+","+(cy+Math.sin(ang)*r)); }
      html += '<polygon points="'+pts.join(" ")+'" fill="'+(lv===levels?"rgba(201,106,46,.04)":"none")+'" stroke="var(--line)" stroke-width="1" opacity=".5"/>';
    }
    for (var i = 0; i < n; i++) { var ang = -Math.PI/2 + i*2*Math.PI/n; html += '<line x1="'+cx+'" y1="'+cy+'" x2="'+(cx+Math.cos(ang)*R)+'" y2="'+(cy+Math.sin(ang)*R)+'" stroke="var(--line)" stroke-width="1" opacity=".4"/>'; }
    var dpts = [];
    for (var i = 0; i < n; i++) { var ang = -Math.PI/2 + i*2*Math.PI/n; var r = R*(skills[i].level||0)/100; dpts.push((cx+Math.cos(ang)*r)+","+(cy+Math.sin(ang)*r)); }
    html += '<polygon points="'+dpts.join(" ")+'" fill="rgba(201,106,46,.25)" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round"/>';
    for (var i = 0; i < n; i++) { var ang = -Math.PI/2 + i*2*Math.PI/n; var r = R*(skills[i].level||0)/100; html += '<circle cx="'+(cx+Math.cos(ang)*r)+'" cy="'+(cy+Math.sin(ang)*r)+'" r="5" fill="var(--accent)" class="radar-vertex" style="cursor:pointer"><title>'+esc(skills[i].name)+'：'+(skills[i].level||0)+'</title></circle>'; }
    for (var i = 0; i < n; i++) { var ang = -Math.PI/2 + i*2*Math.PI/n; var r = R+18; var lx = cx+Math.cos(ang)*r, ly = cy+Math.sin(ang)*r; var anchor = Math.abs(Math.cos(ang)) < 0.3 ? "middle" : (Math.cos(ang) > 0 ? "start" : "end"); html += '<text x="'+lx+'" y="'+ly+'" text-anchor="'+anchor+'" dominant-baseline="middle" font-size="11" fill="var(--ink-soft)">'+esc(skills[i].name)+'</text>'; }
    html += '</svg>';
    $("#dashRadar").innerHTML = html;
  }

  /* ---------- 项目甘特图 ---------- */
  function renderGantt(projects) {
    var wrap = $("#ganttChart");
    if (!wrap || !projects || !projects.length) return;
    var hasDates = projects.some(function (p) { return p.start; });
    if (!hasDates) { if ($("#ganttWrap")) $("#ganttWrap").style.display = "none"; return; }

    function parseDate(s) {
      if (!s) return null;
      var parts = s.split("-");
      var y = parseInt(parts[0], 10);
      var m = parseInt(parts[1] || "1", 10);
      var d = parseInt(parts[2] || "1", 10);
      return y * 372 + (m - 1) * 31 + d;
    }
    function fmtDate(days) {
      var y = Math.floor(days / 372);
      var rem = days % 372;
      var m = Math.floor(rem / 31) + 1;
      var d = rem % 31 + 1;
      return (m < 10 ? "0" + m : m) + "/" + (d < 10 ? "0" + d : d);
    }
    var now = new Date();
    var nowDays = now.getFullYear() * 372 + now.getMonth() * 31 + now.getDate();
    var minD = Infinity, maxD = 0;
    projects.forEach(function (p) {
      var s = parseDate(p.start) || nowDays;
      var e = p.end ? parseDate(p.end) : nowDays;
      if (e < s) e = s;
      if (p.end === "" && p.status !== "paused") e = nowDays;
      minD = Math.min(minD, s); maxD = Math.max(maxD, e);
    });
    var span = Math.max(1, maxD - minD);

    // 时间轴
    var axisHtml = '<div class="gantt-axis">';
    for (var i = 0; i <= 4; i++) {
      var dd = minD + Math.round(span * i / 4);
      axisHtml += '<span>' + fmtDate(dd) + '</span>';
    }
    axisHtml += '</div>';

    var rowsHtml = "";
    projects.forEach(function (p) {
      var s = parseDate(p.start) || nowDays;
      var isPaused = p.status === "paused";
      var e = p.end ? parseDate(p.end) : nowDays;
      if (p.end === "" && !isPaused) e = nowDays;
      if (e < s) e = s;
      var left = (s - minD) / span * 100;
      var width = Math.max(3, (e - s) / span * 100);
      var prog = p.progress || 0;
      var isDone = prog >= 100 && p.end;
      var pctLeft = left + width;
      var pctStyle = pctLeft > 88 ? "right:8px" : "left:calc(" + pctLeft + "% + 8px)";
      var statusCls = isPaused ? " paused" : (p.end === "" ? " ongoing" : "");
      var statusTxt = isPaused ? "已暂停 " : (p.end === "" ? "进行中 " : "");
      rowsHtml += '<div class="gantt-row' + statusCls + '">' +
        '<span class="gantt-label">' + esc(p.name) + '</span>' +
        '<div class="gantt-track"><div class="gantt-bar' + (isDone ? " done" : "") + statusCls + '" style="left:' + left + '%;width:' + width + '%">' +
        '<div class="gantt-bar-fill" style="width:' + prog + '%"></div>' +
        '</div><span class="gantt-pct' + statusCls + '" style="' + pctStyle + '">' + statusTxt + prog + '%</span>' +
        '</div></div>';
    });

    wrap.innerHTML = axisHtml + rowsHtml;

    // 动画：进入视口时触发 bar 填充
    var ganttEl = $("#ganttWrap");
    if (ganttEl) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) {
            $$(".gantt-bar", wrap).forEach(function (bar) {
              bar.style.opacity = "0";
              setTimeout(function () { bar.style.transition = "opacity .5s"; bar.style.opacity = "1"; }, 100);
            });
            io.disconnect();
          }
        });
      }, { threshold: 0.15 });
      io.observe(ganttEl);
    }
  }

  /* ---------- 渲染：我正在做的（项目卡片） ---------- */
  function renderProjects(projects) {
    const grid = $("#projectsGrid");
    if (!projects || !projects.length) {
      grid.innerHTML = '<div class="empty-state">还没有项目～ 把项目信息写成 .json 文件放进 <code>content/projects/</code> 后运行 <code>node build.js</code></div>';
      return;
    }
    grid.innerHTML = projects
      .map(function (p, i) {
        var progress = Math.max(0, Math.min(100, p.progress || 0));
        var body =
            '<div class="project-body">' +
              '<h3 class="project-name">' + esc(p.name) + (p.status === "paused" ? ' <span class="project-badge paused">⏸ 已暂停</span>' : '') + '</h3>' +
              (p.desc ? '<p class="project-desc">' + esc(p.desc) + '</p>' : '') +
              (p.goal ? '<div class="project-field"><span class="project-label">目标</span><span class="project-value">' + esc(p.goal) + '</span></div>' : '') +
              '<div class="project-field project-progress-field">' +
                '<div class="project-progress-head">' +
                  '<span class="project-label">进度' + (p.status === "paused" ? '（已暂停）' : '') + '</span>' +
                  '<span class="project-progress-val">' + progress + '%</span>' +
                '</div>' +
                '<span class="project-progress' + (p.status === "paused" ? " paused" : "") + '"><i></i></span>' +
              '</div>' +
              (p.expected ? '<div class="project-field"><span class="project-label">期望结果</span><span class="project-value">' + esc(p.expected) + '</span></div>' : '') +
              (p.learned ? '<div class="project-field"><span class="project-label">我收获了什么</span><span class="project-value">' + esc(p.learned) + '</span></div>' : '') +
              (p.url ? '<a class="project-link" href="' + esc(p.url) + '" target="_blank" rel="noopener">🌐 访问网站</a>' : '') +
            '</div>';
        return (
          '<article class="project-card reveal' + (p.status === "paused" ? " is-paused" : "") + '" style="--p:' + progress + '%;transition-delay:' + ((i % 4) * 80) + 'ms">' +
            '<div class="project-card-inner">' +
              '<div class="project-back">' +
                '<span class="project-back-mark">?</span>' +
                '<span class="flip-hint">点击翻开</span>' +
                (p.url ? '<span class="project-back-link">🌐 有网站</span>' : '') +
              '</div>' +
              body +
            '</div>' +
          '</article>'
        );
      })
      .join("");
    // 点击翻开（已翻开的不会盖回）
    $$(".project-card", grid).forEach(function (card) {
      card.addEventListener("click", function () {
        card.classList.add("is-flipped");
        // 彩蛋：翻牌达人
        if (!card.dataset.eggCounted) {
          card.dataset.eggCounted = "1";
          if (typeof discoverEgg === "function") {
            var total = $$(".project-card", grid).length;
            var flipped = $$(".project-card.is-flipped", grid).length;
            if (flipped >= total) discoverEgg("card-flipper");
          }
        }
      });
      // 阻止链接点击冒泡到卡片（避免误触发翻转）
      var link = card.querySelector(".project-link");
      if (link) link.addEventListener("click", function (e) { e.stopPropagation(); });
    });
  }

  /* ---------- 渲染：我还想做的（清单卡片） ---------- */
  function renderWishlist(items) {
    var grid = $("#wishlistGrid");
    if (!items || !items.length) {
      grid.innerHTML = '<div class="empty-state">还没有内容～ 编辑 <code>content/profile.json</code> 里的 wishlist 字段后运行 <code>node build.js</code></div>';
      return;
    }
    grid.innerHTML = items
      .map(function (item, i) {
        var imp = Math.max(0, Math.min(5, item.importance || 0));
        var att = Math.max(0, Math.min(5, item.attraction || 0));
        var impDots = "";
        var attDots = "";
        for (var j = 1; j <= 5; j++) {
          impDots += '<i class="' + (j <= imp ? "on" : "") + '" data-group="imp" data-idx="' + j + '"></i>';
          attDots += '<i class="' + (j <= att ? "on" : "") + '" data-group="att" data-idx="' + j + '"></i>';
        }
        return (
          '<div class="wishlist-item" data-index="' + i + '">' +
            '<p class="wishlist-text">' + esc(item.text) + '</p>' +
            '<div class="wishlist-ratings">' +
              '<span class="wr"><label>重要性</label><span class="rating-dots">' + impDots + '</span></span>' +
              '<span class="wr"><label>吸引度</label><span class="rating-dots">' + attDots + '</span></span>' +
            '</div>' +
          '</div>'
        );
      })
      .join("");

    // 纸箱触发：首次进入视口时，条框依次从纸箱飞出 + 小红点闪烁
    var triggered = false;
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting && !triggered) {
          triggered = true;
          io.disconnect();
          var itemList = grid.querySelectorAll(".wishlist-item");
          itemList.forEach(function (item, i) {
            setTimeout(function () {
              item.classList.add("is-shown");
              // 落位后小红点依次闪烁
              setTimeout(function () {
                var dots = item.querySelectorAll(".rating-dots i.on");
                dots.forEach(function (dot, di) {
                  setTimeout(function () {
                    dot.classList.add("is-flash");
                    setTimeout(function () { dot.classList.remove("is-flash"); dot.classList.add("is-lit"); }, 500);
                  }, di * 300);
                });
              }, 950);
            }, i * 1200);
          });
        }
      });
    }, { threshold: 0.15 });
    io.observe(grid);

    // 打字机动画
    var descEl = $("#wishlistDesc");
    if (descEl) {
      var fullText = descEl.dataset.text || "那些吸引着我、想要去尝试和完成的事";
      var descStarted = false;
      var ioDesc = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting && !descStarted) {
            descStarted = true;
            ioDesc.disconnect();
            startDescTyping();
          }
        });
      }, { threshold: 0.3 });
      ioDesc.observe(descEl);

      function startDescTyping() {
        var ci = 0, deleting = false;
        function tick() {
          if (!deleting) {
            ci++;
            descEl.textContent = fullText.slice(0, ci);
            if (ci >= fullText.length) { deleting = true; setTimeout(tick, 5000); return; }
            setTimeout(tick, 80);
          } else {
            ci--;
            descEl.textContent = fullText.slice(0, ci);
            if (ci <= 0) { deleting = false; setTimeout(tick, 500); return; }
            setTimeout(tick, 40);
          }
        }
        descEl.textContent = "";
        setTimeout(tick, 300);
      }
    }
  }

  /* ---------- 渲染：更新历史 ---------- */
  function renderChangelog(logs) {
    var grid = $("#changelogGrid");
    if (!logs || !logs.length) {
      grid.innerHTML = '<div class="empty-state">还没有更新记录～ 编辑 <code>content/changelog.json</code> 后运行 <code>node build.js</code></div>';
      return;
    }
    grid.innerHTML = logs
      .map(function (c, i) {
        return (
          '<div class="changelog-item reveal" style="transition-delay:' + ((i % 5) * 60) + 'ms">' +
            '<span class="changelog-date">' + esc(c.date) + '</span>' +
            '<p class="changelog-summary">' + esc(c.summary) + '</p>' +
          '</div>'
        );
      })
      .join("");
  }

  /* ---------- 渲染：成长轨迹 ---------- */
  function renderTimeline(items) {
    var el = $("#timelineGrid");
    if (!el) return;
    if (!items || !items.length) {
      el.innerHTML = '<div class="empty-state">还没有记录～ 在 content/profile.json 的 timeline 字段里添加</div>';
      return;
    }
    el.innerHTML = items.map(function (t, i) {
      return '<div class="timeline-item" style="transition-delay:' + ((i % 5) * 80) + 'ms">' +
        '<div class="timeline-date">' + esc(t.date || "") + '</div>' +
        '<div class="timeline-event">' + esc(t.event || "") + '</div>' +
        (t.desc ? '<div class="timeline-desc">' + esc(t.desc) + '</div>' : '') +
      '</div>';
    }).join("");

    // 渲染后生成不规则蜿蜒 SVG 连线
    requestAnimationFrame(function () {
      var itemList = el.querySelectorAll(".timeline-item");
      if (!itemList.length) return;
      var NS = "http://www.w3.org/2000/svg";
      // 测量每个圆点的中心 Y 坐标
      var dotYs = [];
      for (var k = 0; k < itemList.length; k++) {
        dotYs.push(itemList[k].offsetTop + 4 + 7); // offsetTop + ::before top(4) + 半径(7)
      }
      var lastItem = itemList[itemList.length - 1];
      var totalH = lastItem.offsetTop + lastItem.offsetHeight;

      var svg = document.createElementNS(NS, "svg");
      svg.setAttribute("class", "timeline-wave");
      svg.setAttribute("width", "60");
      svg.setAttribute("height", String(totalH));

      var cx = 18; // 基准 X（道路右移4单位）
      // 圆点偏移更大 + 弯度更大更曲折
      var xOffs = [0, 18, -14, 22, -8, 16, -20, 10, 24, -12, 14, -18, 6, -22, 20];
      var amps = [35, 60, 42, 70, 30, 55, 48, 65, 38, 68, 45, 58, 32, 62, 50];

      // 计算每个圆点实际 X 坐标
      var dotX = [];
      for (var j = 0; j < dotYs.length; j++) {
        dotX.push(cx + (xOffs[j % xOffs.length] || 0));
        // 同步移动 CSS 圆点位置
        itemList[j].style.setProperty("--dot-x", (-81 + (xOffs[j % xOffs.length] || 0)) + "px");
      }

      // ====== 用 Catmull-Rom 样条生成平滑路径（切线连续，小车不急转弯） ======
      var pts = [{ x: dotX[0], y: 0 }];
      for (var pi = 0; pi < dotYs.length; pi++) pts.push({ x: dotX[pi], y: dotYs[pi] });
      pts.push({ x: dotX[dotX.length - 1], y: totalH + 10 });

      var tension = 1.8; // 张力 > 1 弯更明显
      var d = "M" + pts[1].x + "," + pts[1].y;
      for (var si = 1; si < pts.length - 1; si++) {
        var p0 = pts[Math.max(0, si - 1)];
        var p1 = pts[si];
        var p2 = pts[si + 1];
        var p3 = pts[Math.min(pts.length - 1, si + 2)];
        var bc1x = p1.x + (p2.x - p0.x) / 6 * tension;
        var bc1y = p1.y + (p2.y - p0.y) / 6 * tension;
        var bc2x = p2.x - (p3.x - p1.x) / 6 * tension;
        var bc2y = p2.y - (p3.y - p1.y) / 6 * tension;
        d += " C" + bc1x + "," + bc1y + " " + bc2x + "," + bc2y + " " + p2.x + "," + p2.y;
      }

      // ====== 双车道道路 ======
      var ROAD_W = 9; // 半宽
      // 路面底色（粗线）
      var road = document.createElementNS(NS, "path");
      road.setAttribute("d", d);
      road.setAttribute("fill", "none");
      road.setAttribute("stroke", "currentColor");
      road.setAttribute("stroke-width", String(ROAD_W * 2));
      road.setAttribute("stroke-linecap", "round");
      road.setAttribute("opacity", "0.08");
      svg.appendChild(road);
      // 左边线
      var edgeL = document.createElementNS(NS, "path");
      edgeL.setAttribute("d", d);
      edgeL.setAttribute("fill", "none");
      edgeL.setAttribute("stroke", "currentColor");
      edgeL.setAttribute("stroke-width", "2");
      edgeL.setAttribute("opacity", "0.3");
      edgeL.setAttribute("transform", "translate(" + (-ROAD_W) + ",0)");
      svg.appendChild(edgeL);
      // 右边线
      var edgeR = document.createElementNS(NS, "path");
      edgeR.setAttribute("d", d);
      edgeR.setAttribute("fill", "none");
      edgeR.setAttribute("stroke", "currentColor");
      edgeR.setAttribute("stroke-width", "2");
      edgeR.setAttribute("opacity", "0.3");
      edgeR.setAttribute("transform", "translate(" + ROAD_W + ",0)");
      svg.appendChild(edgeR);
      // 中间虚线（同时作为小车运动路径）
      var dash = document.createElementNS(NS, "path");
      dash.setAttribute("d", d);
      dash.setAttribute("id", "timeline-center-path");
      dash.setAttribute("fill", "none");
      dash.setAttribute("stroke", "#e0a060");
      dash.setAttribute("stroke-width", "1.5");
      dash.setAttribute("stroke-dasharray", "5 5");
      dash.setAttribute("opacity", "0.45");
      svg.appendChild(dash);

      // ====== 小车沿路径行驶（横向绘制，rotate=auto 旋转后竖向行驶） ======
      var car = document.createElementNS(NS, "g");
      car.setAttribute("class", "timeline-car");
      // 车身：横向矩形（宽16 高10），指向 +X 方向
      var body = document.createElementNS(NS, "rect");
      body.setAttribute("x", "-8"); body.setAttribute("y", "-5");
      body.setAttribute("width", "16"); body.setAttribute("height", "10");
      body.setAttribute("rx", "3");
      body.setAttribute("fill", "#c96a2e");
      car.appendChild(body);
      // 挡风玻璃（前部=右侧）
      var win = document.createElementNS(NS, "rect");
      win.setAttribute("x", "1"); win.setAttribute("y", "-3.5");
      win.setAttribute("width", "5"); win.setAttribute("height", "7");
      win.setAttribute("rx", "1");
      win.setAttribute("fill", "#fff");
      win.setAttribute("opacity", "0.55");
      car.appendChild(win);
      // 车灯（最前端）
      var light = document.createElementNS(NS, "rect");
      light.setAttribute("x", "6.5"); light.setAttribute("y", "-3");
      light.setAttribute("width", "1.5"); light.setAttribute("height", "6");
      light.setAttribute("rx", "0.5");
      light.setAttribute("fill", "#ffe08a");
      car.appendChild(light);

      // 小车位置由滚动进度驱动（不再用 animateMotion）
      svg.appendChild(car);
      car.style.opacity = "0";
      car.style.transition = "opacity .5s";

      el.insertBefore(svg, el.firstChild);

      // 道路绘制 + 小车位置 统一由 setupRoadDraw 管理（完全同步）
      var dashPath = svg.querySelector("#timeline-center-path");
      var pathLen = 0;
      try { pathLen = dashPath.getTotalLength(); } catch (e) {}
      setupRoadDraw(el, svg, car, dashPath, pathLen, itemList, dotYs);
    });
  }

  /* ---------- 暗色模式切换 ---------- */
  function setupThemeToggle() {
    var btn = $("#themeToggle");
    if (!btn) return;
    var saved = null;
    try { saved = localStorage.getItem("theme"); } catch (e) {}
    if (saved === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      btn.textContent = "☀️";
    }
    btn.addEventListener("click", function () {
      var isDark = document.documentElement.getAttribute("data-theme") === "dark";
      if (isDark) {
        document.documentElement.removeAttribute("data-theme");
        btn.textContent = "🌙";
        try { localStorage.setItem("theme", "light"); } catch (e) {}
      } else {
        document.documentElement.setAttribute("data-theme", "dark");
        btn.textContent = "☀️";
        try { localStorage.setItem("theme", "dark"); } catch (e) {}
      }
      if (typeof discoverEgg === "function") discoverEgg("dark-mode");
    });
  }

  /* ---------- 季节主题 ---------- */
  function setupSeasonalThemes() {
    var btn = $("#seasonToggle");
    if (!btn) return;
    var SEASONS = [
      { id: "spring", icon: "🌸", name: "春" },
      { id: "summer", icon: "🌊", name: "夏" },
      { id: "autumn", icon: "🍂", name: "秋" },
      { id: "winter", icon: "❄️", name: "冬" }
    ];
    function detectSeason() {
      var m = new Date().getMonth() + 1;
      if (m >= 3 && m <= 5) return "spring";
      if (m >= 6 && m <= 8) return "summer";
      if (m >= 9 && m <= 11) return "autumn";
      return "winter";
    }
    var saved = null;
    try { saved = localStorage.getItem("season"); } catch (e) {}
    var current = saved || detectSeason();
    function applySeason(id) {
      if (id === "autumn") document.documentElement.removeAttribute("data-season");
      else document.documentElement.setAttribute("data-season", id);
      var s = SEASONS.find(function (x) { return x.id === id; });
      if (s) btn.textContent = s.icon;
      // 彩蛋：四季收藏
      seasonsTried[id] = true;
      if (Object.keys(seasonsTried).length >= 4 && typeof discoverEgg === "function") discoverEgg("season-collector");
    }
    applySeason(current);
    btn.addEventListener("click", function () {
      var idx = SEASONS.findIndex(function (x) { return x.id === current; });
      idx = (idx + 1) % SEASONS.length;
      current = SEASONS[idx].id;
      try { localStorage.setItem("season", current); } catch (e) {}
      applySeason(current);
    });
  }

  /* ---------- 青岛地图（底图 + 编号标记 + 点击展开照片 + 悬停预览） ---------- */
  function setupMap() {
    var container = $("#cityMap");
    var markersEl = $("#mapMarkers");
    var popupEl = $("#mapPopup");
    var previewEl = $("#mapPreview");
    if (!container || !markersEl || !popupEl) return;

    var MARKERS = (window.SITE_DATA && window.SITE_DATA.mapMarkers) || [];
    if (!MARKERS.length) return;

    // 渲染编号标记
    markersEl.innerHTML = MARKERS.map(function (m, i) {
      var hasPhotos = m.photos && m.photos.length;
      return '<div class="map-pin" data-idx="' + i + '" ' +
        'style="left:' + m.x + '%;top:' + m.y + '%;background:' + m.color +
        ';--pin-glow:' + m.color + '33;">' +
        "<span>" + (i + 1) + "</span>" +
        '<div class="map-pin-label">' + m.icon + " " + m.name +
        (hasPhotos ? ' <em>(' + m.photos.length + '张)</em>' : "") + "</div>" +
        "</div>";
    }).join("");

    // 点击标记 → 展开照片弹层
    var currentIdx = -1;
    var previewTimer = null;
    document.querySelectorAll(".map-pin").forEach(function (pin) {
      pin.addEventListener("click", function (e) {
        e.stopPropagation();
        var idx = parseInt(pin.dataset.idx, 10);
        var m = MARKERS[idx];
        if (!m) return;
        // 彩蛋：地图探索
        if (typeof discoverEgg === "function") discoverEgg("map-explorer");
        pin.classList.add("is-pulse");
        setTimeout(function () { pin.classList.remove("is-pulse"); }, 600);

        // 同一标记再次点击 → 收起
        if (currentIdx === idx) {
          closePopup();
          return;
        }
        currentIdx = idx;

        var photosHtml = "";
        if (m.photos && m.photos.length) {
          photosHtml = '<div class="map-popup-photos">' +
            m.photos.map(function (src) {
              return '<img src="' + src + '" alt="' + esc(m.name) + '" loading="lazy">';
            }).join("") +
            "</div>";
        } else {
          photosHtml = '<p class="map-popup-empty">还没有这里的风景照～</p>';
        }

        popupEl.innerHTML =
          '<div class="map-popup-head">' +
            '<span class="map-popup-title">' + m.icon + " " + esc(m.name) + "</span>" +
            '<button class="map-popup-close" id="mapPopupClose" aria-label="关闭">✕</button>' +
          "</div>" +
          '<p class="map-popup-desc">' + esc(m.desc) + "</p>" +
          photosHtml;
        popupEl.classList.add("is-open");

        var closeBtn = $("#mapPopupClose");
        if (closeBtn) closeBtn.addEventListener("click", closePopup);
      });

      // 悬停 → 侧边预览面板
      if (previewEl) {
        pin.addEventListener("mouseenter", function () {
          if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
          var idx = parseInt(pin.dataset.idx, 10);
          var m = MARKERS[idx];
          if (!m) return;

          // 判断锚点在视口左半还是右半 → 面板放对侧
          var rect = pin.getBoundingClientRect();
          var pinCenter = rect.left + rect.width / 2;
          var showOnRight = pinCenter > window.innerWidth / 2;

          // 构建内容
          var photos = m.photos || [];
          var photosHtml;
          if (photos.length) {
            photosHtml = '<div class="map-preview-photos">' +
              photos.map(function (src) {
                return '<img src="' + src + '" alt="" loading="lazy">';
              }).join("") +
              "</div>";
          } else {
            photosHtml = '<div class="map-preview-empty">暂无照片</div>';
          }

          previewEl.innerHTML =
            '<div class="map-preview-title">' + m.icon + " " + m.name + "</div>" +
            '<div class="map-preview-desc">' + m.desc + "</div>" +
            photosHtml;

          previewEl.classList.remove("from-left", "from-right");
          previewEl.classList.add(showOnRight ? "from-right" : "from-left");

          requestAnimationFrame(function () {
            previewEl.classList.add("show");
          });
        });

        pin.addEventListener("mouseleave", function () {
          // 延迟关闭，避免光标在锚点边缘抖动时闪烁
          previewTimer = setTimeout(function () {
            previewEl.classList.remove("show");
            previewTimer = null;
          }, 200);
        });

        // 光标移到面板上 → 保持显示
        previewEl.addEventListener("mouseenter", function () {
          if (previewTimer) { clearTimeout(previewTimer); previewTimer = null; }
        });
        previewEl.addEventListener("mouseleave", function () {
          previewEl.classList.remove("show");
        });
      }
    });

    function closePopup() {
      popupEl.classList.remove("is-open");
      currentIdx = -1;
      setTimeout(function () { popupEl.innerHTML = ""; }, 300);
    }

    // ── 地图缩放与平移（解决锚点密集重叠问题） ──
    var zoomInner = $("#mapZoomInner");
    if (zoomInner && container) {
      var mZoom = 1, mPanX = 0, mPanY = 0;
      var mPanning = false, mPanSX = 0, mPanSY = 0;
      var ccX = container.clientWidth / 2;

      function applyZoom(animate) {
        if (animate) zoomInner.classList.remove("no-trans");
        else zoomInner.classList.add("no-trans");
        zoomInner.style.transform = "translate(" + mPanX + "px," + mPanY + "px) scale(" + mZoom + ")";
        markersEl.style.setProperty("--inv-zoom", String(1 / mZoom));
      }

      function clampPan() {
        var cw = container.clientWidth, ch = container.clientHeight;
        var iw = zoomInner.offsetWidth, ih = zoomInner.offsetHeight;
        var sw = iw * mZoom, sh = ih * mZoom;
        ccX = cw / 2;
        if (sw > cw) {
          var mx = (sw - cw) / 2;
          mPanX = Math.max(-mx, Math.min(mx, mPanX));
        } else { mPanX = 0; }
        if (sh > ch) {
          mPanY = Math.max(ch - sh, Math.min(0, mPanY));
        } else { mPanY = 0; }
      }

      applyZoom(false);

      // 滚轮缩放（Shift+滚轮，以光标位置为中心；不按Shift → 页面正常滚动）
      container.addEventListener("wheel", function (e) {
        if (!e.shiftKey) return;
        e.preventDefault();
        var rect = container.getBoundingClientRect();
        var mx = e.clientX - rect.left, my = e.clientY - rect.top;
        var delta = e.deltaY > 0 ? 0.85 : 1.18;
        var nz = Math.max(1, Math.min(6, mZoom * delta));
        var r = nz / mZoom;
        mPanX = (mx - ccX) * (1 - r) + mPanX * r;
        mPanY = my * (1 - r) + mPanY * r;
        mZoom = nz;
        clampPan();
        applyZoom(false);
      }, { passive: false });

      // 鼠标拖拽平移（点锚点或按钮时不触发）
      container.addEventListener("mousedown", function (e) {
        if (e.target.closest(".map-pin") || e.target.closest(".map-zoom-btn")) return;
        mPanning = true;
        mPanSX = e.clientX - mPanX;
        mPanSY = e.clientY - mPanY;
        container.classList.add("grabbing");
        zoomInner.classList.add("no-trans");
        e.preventDefault();
      });
      document.addEventListener("mousemove", function (e) {
        if (!mPanning) return;
        mPanX = e.clientX - mPanSX;
        mPanY = e.clientY - mPanSY;
        clampPan();
        applyZoom(false);
      });
      document.addEventListener("mouseup", function () {
        if (mPanning) { mPanning = false; container.classList.remove("grabbing"); }
      });

      // 触摸：单指 → 页面正常滚动；双指 → 缩放+平移
      var tPinch = null;
      function tDist(a, b) {
        var dx = a.clientX - b.clientX, dy = a.clientY - b.clientY;
        return Math.sqrt(dx * dx + dy * dy);
      }
      function tMid(a, b) {
        return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
      }
      container.addEventListener("touchstart", function (e) {
        if (e.target.closest(".map-pin") || e.target.closest(".map-zoom-btn")) return;
        if (e.touches.length === 2) {
          var m = tMid(e.touches[0], e.touches[1]);
          tPinch = {
            d0: tDist(e.touches[0], e.touches[1]),
            z0: mZoom, mx0: m.x, my0: m.y, px0: mPanX, py0: mPanY
          };
        }
      }, { passive: true });
      container.addEventListener("touchmove", function (e) {
        if (!tPinch || e.touches.length !== 2) return;
        e.preventDefault();
        var m = tMid(e.touches[0], e.touches[1]);
        var d = tDist(e.touches[0], e.touches[1]);
        var r = d / tPinch.d0;
        var nz = Math.max(1, Math.min(6, tPinch.z0 * r));
        var ar = nz / tPinch.z0;
        mPanX = m.x - (tPinch.mx0 - tPinch.px0) * ar;
        mPanY = m.y - (tPinch.my0 - tPinch.py0) * ar;
        mZoom = nz;
        clampPan();
        applyZoom(false);
      }, { passive: false });
      container.addEventListener("touchend", function (e) {
        if (e.touches.length < 2) tPinch = null;
      });
      container.addEventListener("touchcancel", function () { tPinch = null; });

      // 缩放按钮
      var btnIn = $("#mapZoomIn"), btnOut = $("#mapZoomOut"), btnFit = $("#mapZoomFit");
      function zoomCenter(factor) {
        var ch = container.clientHeight;
        var nz = Math.max(1, Math.min(6, mZoom * factor));
        var r = nz / mZoom;
        mPanX = mPanX * r;
        mPanY = (ch / 2) * (1 - r) + mPanY * r;
        mZoom = nz;
        clampPan();
        applyZoom(true);
      }
      if (btnIn) btnIn.addEventListener("click", function () { zoomCenter(1.4); });
      if (btnOut) btnOut.addEventListener("click", function () { zoomCenter(0.71); });
      if (btnFit) btnFit.addEventListener("click", function () {
        mZoom = 1; mPanX = 0; mPanY = 0;
        applyZoom(true);
      });

      // 窗口大小变化 → 重新限制平移范围
      window.addEventListener("resize", function () { clampPan(); applyZoom(false); });
    }
  }

  /* ---------- 访问统计（localStorage） ---------- */
  function setupVisitCounter() {
    var el = $("#visitCount");
    if (!el) return;
    var key = "visit-count";
    var n = 0;
    try {
      n = parseInt(localStorage.getItem(key) || "0", 10);
      n++;
      localStorage.setItem(key, String(n));
    } catch (e) { n = 1; }
    el.textContent = "本站已被访问 " + n + " 次";
  }

  /* ---------- 节日彩蛋 ---------- */
  function setupEasterEgg() {
    var now = new Date();
    var m = now.getMonth() + 1;
    var d = now.getDate();
    // 冬季（12月-2月）：飘雪
    if (m === 12 || m === 1 || m === 2) {
      var layer = document.createElement("div");
      layer.id = "snow-layer";
      document.body.appendChild(layer);
      var chars = ["❄", "❅", "❆", "✦"];
      for (var i = 0; i < 30; i++) {
        var s = document.createElement("span");
        s.className = "snowflake";
        s.textContent = chars[Math.floor(Math.random() * chars.length)];
        s.style.left = Math.random() * 100 + "%";
        s.style.fontSize = (10 + Math.random() * 12) + "px";
        s.style.animationDuration = (4 + Math.random() * 6) + "s";
        s.style.animationDelay = Math.random() * 4 + "s";
        layer.appendChild(s);
      }
    }
  }

  /* ---------- 卡片堆叠相册查看器 ---------- */
  function openCardStack(item) {
    if (!item || !item.files || !item.files.length) return;
    var CARD_W = 360, CARD_H = 460;
    var MAX_W = Math.min(980, window.innerWidth * 0.9);
    var MAX_H = Math.min(860, window.innerHeight * 0.8);

    var overlay = document.createElement("div");
    overlay.className = "card-stack-overlay";
    var stage = document.createElement("div");
    stage.className = "card-stack-stage";
    var hint = document.createElement("p");
    hint.className = "card-stack-hint";
    var closeBtn = document.createElement("button");
    closeBtn.className = "card-stack-close";
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", function () { closeStack(); });
    overlay.appendChild(closeBtn);
    overlay.appendChild(stage);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    // 预加载所有图片，缓存自然尺寸
    var dims = {};
    var loaded = 0;
    item.files.forEach(function (src, i) {
      var im = new Image();
      im.onload = function () {
        dims[i] = { w: im.naturalWidth, h: im.naturalHeight };
        loaded++;
      };
      im.src = src;
    });

    // 根据图片自然尺寸计算展开后的目标宽高
    function targetSize(i) {
      var d = dims[i];
      if (!d) return { w: CARD_W, h: CARD_H };
      var ratio = d.w / d.h;
      var w = MAX_W, h = MAX_W / ratio;
      if (h > MAX_H) { h = MAX_H; w = MAX_H * ratio; }
      return { w: Math.round(w), h: Math.round(h) };
    }

    var idx = 0;
    var zCounter = 10;
    var cards = []; // 保存已创建的卡片元素

    // 相册内单张照片的展示名：去掉扩展名与可选日期前缀
    function photoName(src) {
      var b = String(src).split("/").pop().replace(/\.[^.]+$/, "");
      return b.replace(/^\d{4}[-_.]\d{2}[-_.]\d{2}[_\s]*/, "").trim() || b;
    }

    function makeCard(i) {
      var card = document.createElement("div");
      card.className = "stack-card";
      card.dataset.idx = String(i);
      var img = document.createElement("img");
      img.src = item.files[i];
      img.alt = item.title || "";
      card.appendChild(img);
      var meta = document.createElement("div");
      meta.className = "stack-card-meta";
      var ph = photoName(item.files[i]);
      var cap = item.descs && item.descs[i] ? item.descs[i] : "";
      meta.innerHTML = "<b>" + esc(ph) + "</b>" +
        "<small>" + (i + 1) + "/" + item.files.length + (cap ? " · " + esc(cap) : "") + "</small>";
      card.appendChild(meta);
      card.addEventListener("click", function () { nextCard(); });
      return card;
    }

    function renderStack() {
      stage.innerHTML = "";
      cards = [];
      // 底层：放 2-3 张牌作为牌堆背景，最新索引在最上面
      var peekCount = Math.min(3, item.files.length);
      var startIdx = (idx - peekCount + 1 + item.files.length * 10) % item.files.length;
      var order = [];
      for (var k = 0; k < peekCount; k++) {
        order.push((startIdx + k) % item.files.length);
      }
      // 最后一张（order 末尾）是当前活跃卡片，展开显示
      order.forEach(function (fi, pos) {
        var card = makeCard(fi);
        var isTop = (pos === order.length - 1);
        if (isTop) {
          card.classList.add("is-expanded");
          card.style.zIndex = String(zCounter);
          var ts = targetSize(fi);
          card.style.width = ts.w + "px";
          card.style.height = ts.h + "px";
          card.style.transform = "translate(0, 0) rotate(0)";
          card.style.opacity = "1";
          cards.push(card);
        } else {
          card.style.zIndex = String(zCounter - (peekCount - pos));
          card.style.width = CARD_W + "px";
          card.style.height = CARD_H + "px";
          var off = (peekCount - 1 - pos);
          card.style.transform = "translate(" + (off * 8) + "px, " + (off * 10) + "px) rotate(" + (off * 2.5) + "deg)";
          card.style.opacity = String(1 - off * 0.15);
          stage.appendChild(card);
        }
      });
      // 把活跃卡片最后 append（最上层）
      if (cards.length) stage.appendChild(cards[0]);
      hint.textContent = "点击卡片从牌堆抽下一张 · " + (idx + 1) + "/" + item.files.length;
    }

    // ====== 音效（Web Audio API 合成） ======
    var audioCtx = null;
    function getAudio() {
      if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
      if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
      return audioCtx;
    }
    function playSound(type) {
      var ctx = getAudio(); if (!ctx) return;
      if (type === "draw") {
        // 沙沙摩擦声：窄带噪声 + 幅度调制（模拟牌面摩擦颗粒感）
        var dur = 0.45;
        var buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
        var d = buf.getChannelData(0);
        for (var i = 0; i < d.length; i++) {
          var env = 1 - i / d.length;
          var lfo = 0.5 + 0.5 * Math.sin(2 * Math.PI * 14 * i / ctx.sampleRate);
          d[i] = (Math.random() * 2 - 1) * env * lfo * 0.8;
        }
        var src = ctx.createBufferSource(); src.buffer = buf;
        var f = ctx.createBiquadFilter(); f.type = "bandpass";
        f.frequency.setValueAtTime(1600, ctx.currentTime);
        f.Q.setValueAtTime(1.5, ctx.currentTime);
        var g = ctx.createGain(); g.gain.setValueAtTime(0.055, ctx.currentTime);
        src.connect(f); f.connect(g); g.connect(ctx.destination); src.start();
      } else if (type === "cover") {
        // 覆盖声：tap（短促正弦波，频率下扫）
        var osc = ctx.createOscillator(); osc.type = "sine";
        osc.frequency.setValueAtTime(340, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(160, ctx.currentTime + 0.1);
        var g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.1, ctx.currentTime);
        g2.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
        osc.connect(g2); g2.connect(ctx.destination);
        osc.start(); osc.stop(ctx.currentTime + 0.15);
      }
    }

    var isAnimating = false;
    function nextCard() {
      if (isAnimating) return;  // 动画进行中，禁止连点
      isAnimating = true;
      var nextIdx = (idx + 1) % item.files.length;
      // 创建新卡片，从底部滑上来覆盖
      var newCard = makeCard(nextIdx);
      newCard.style.width = CARD_W + "px";
      newCard.style.height = CARD_H + "px";
      newCard.style.zIndex = String(++zCounter);
      // 初始：在牌堆底部下方，可见但半透明，稍微旋转缩小
      newCard.style.transform = "translate(0, 340px) rotate(-4deg) scale(0.92)";
      newCard.style.opacity = "0.4";
      stage.appendChild(newCard);

      // 音效：抽牌沙沙声
      playSound("draw");

      // 强制 reflow，确保初始状态生效后再触发过渡
      void newCard.offsetWidth;

      // 第一阶段：从底部滑上来覆盖（0→500ms）
      newCard.style.transform = "translate(0, 0) rotate(0) scale(1)";
      newCard.style.opacity = "1";

      // 第二阶段：滑到位后展开到完整画面（520ms 后）+ 音效 tap
      setTimeout(function () {
        playSound("cover");
        newCard.classList.add("is-expanded");
        var ts = targetSize(nextIdx);
        newCard.style.width = ts.w + "px";
        newCard.style.height = ts.h + "px";
      }, 520);

      // 第三阶段：展开完成后，重建牌堆并解锁点击
      setTimeout(function () {
        idx = nextIdx;
        renderStack();
        isAnimating = false;
      }, 1150);
    }

    function closeStack() {
      overlay.classList.remove("is-open");
      document.body.style.overflow = "";
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 300);
    }

    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeStack();
    });
    document.addEventListener("keydown", function stackKey(e) {
      if (!overlay.parentNode) { document.removeEventListener("keydown", stackKey); return; }
      if (e.key === "Escape") closeStack();
      if (e.key === "ArrowRight" || e.key === "Enter") nextCard();
    });

    requestAnimationFrame(function () { overlay.classList.add("is-open"); });
    // 等图片预加载完再渲染（最多等 500ms）
    function initRender() {
      if (loaded >= item.files.length || dims[0]) {
        renderStack();
      } else {
        setTimeout(initRender, 100);
      }
    }
    setTimeout(initRender, 150);
  }

  /* ---------- 首页视差（照片/太阳/云层不同速度移动） ---------- */
  function setupHeroParallax() {
    var hero = document.querySelector(".hero");
    if (!hero) return;
    var photo = hero.querySelector(".hero-photo");
    var sun = $("#heroSun");
    var mist = $("#heroMist");
    var mistScrollY = 0;

    /* ====== 云层配置（桌面端才有，移动端 CSS display:none） ====== */
    var isMobile = window.matchMedia("(max-width: 768px)").matches;
    var cloudDefs = [
      { el: $("#cloud1"), w: 320 },
      { el: $("#cloud2"), w: 420 },
      { el: $("#cloud3"), w: 240 },
    ].filter(function (c) { return c.el; });
    var SPEED_MIN = 18, SPEED_MAX = 52;
    var PAUSE_GAP_MIN = 3000, PAUSE_GAP_MAX = 7000;
    var PAUSE_DUR_MIN = 800, PAUSE_DUR_MAX = 2800;
    function randSpeed() { return SPEED_MIN + Math.random() * (SPEED_MAX - SPEED_MIN); }
    function randGap() { return PAUSE_GAP_MIN + Math.random() * (PAUSE_GAP_MAX - PAUSE_GAP_MIN); }
    var cloudState = cloudDefs.map(function (c) {
      var vw = window.innerWidth;
      return {
        el: c.el, w: c.w,
        x: Math.random() * vw,
        speed: randSpeed(),
        pausing: false,
        pauseTimer: randGap(),
        scrollY: 0,
        pf: 0.03 + Math.random() * 0.04,
      };
    });
    var cloudScrollY = 0;

    var lastTime = performance.now();

    function tick(now) {
      var dt = (now - lastTime) / 1000;
      lastTime = now;
      if (dt > 0.1) dt = 0.1;
      var vw = window.innerWidth;

      /* 雾气：正弦波缓慢左右飘 + 滚动视差 Y */
      if (mist) {
        var mx = Math.sin(now / 1000 * 0.35) * 28;
        mist.style.transform = "translate(" + mx.toFixed(1) + "px," + (mistScrollY * 0.2).toFixed(1) + "px)";
      }

      /* 云层：变速度飘动 + 随机暂停（桌面端） */
      if (!isMobile) {
        cloudState.forEach(function (c) {
          if (c.pausing) {
            c.pauseTimer -= dt * 1000;
            c.speed *= 0.92;
            if (c.pauseTimer <= 0) { c.pausing = false; c.speed = randSpeed(); c.pauseTimer = randGap(); }
          } else {
            c.pauseTimer -= dt * 1000;
            if (c.pauseTimer <= 0) { c.pausing = true; c.pauseTimer = PAUSE_DUR_MIN + Math.random() * (PAUSE_DUR_MAX - PAUSE_DUR_MIN); }
          }
          c.x += c.speed * dt;
          if (c.x > vw + c.w + 60) { c.x = -c.w - 60; c.speed = randSpeed(); }
          c.el.style.transform = "translate(" + c.x.toFixed(1) + "px," + (cloudScrollY * c.pf).toFixed(1) + "px)";
        });
      }

      requestAnimationFrame(tick);
    }

    function onScroll() {
      var y = window.scrollY;
      if (y > window.innerHeight) return;
      if (photo) photo.style.transform = "translateY(" + (y * 0.1) + "px)";
      if (sun) sun.style.marginTop = (y * 0.05) + "px";
      mistScrollY = y;
      cloudScrollY = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });

    /* 始终启动云层 + 雾气 + 飞鸟动画 */
    requestAnimationFrame(tick);
  }

  /* ---------- 轨迹道路绘制 + 小车循环 + 圆点随路出现 ---------- */
  function setupRoadDraw(el, svg, car, dashPath, pathLen, items, dotYs) {
    var paths = svg.querySelectorAll("path:not([stroke-dasharray])");
    if (!paths.length) return;
    var totalLen = 0;
    try { totalLen = paths[0].getTotalLength(); } catch (e) { return; }
    if (!totalLen || totalLen < 10) return;
    paths.forEach(function (p) {
      p.style.strokeDasharray = totalLen;
      p.style.strokeDashoffset = totalLen;
    });

    var totalH = (dotYs && dotYs.length) ? dotYs[dotYs.length - 1] : 100;
    // 每个圆点的进度阈值 = Y位置 / 总高度，提前 0.06 让圆点在道路刚抵达时就出现
    var thresholds = (dotYs || []).map(function (y) { return y / totalH - 0.1; });

    var currentProg = 0;

    function update() {
      if (!el.parentNode) { window.removeEventListener("scroll", update); return; }
      var rect = el.getBoundingClientRect();
      var winH = window.innerHeight;
      // 阈值：0.95 开始绘制，0.5 完成线
      var prog = (winH * 0.95 - rect.top) / (rect.height + winH * 0.5);
      prog = Math.max(0, Math.min(1, prog));
      currentProg = prog;
      // 绘制道路
      paths.forEach(function (p) {
        p.style.strokeDashoffset = totalLen * (1 - prog);
      });
      // 圆点在道路铺到后才出现
      if (items) {
        items.forEach(function (item, i) {
          if (prog >= thresholds[i] && !item.classList.contains("is-visible")) {
            item.classList.add("is-visible");
          }
        });
      }
    }
    window.addEventListener("scroll", update, { passive: true });
    update();

    // 小车循环行驶：在已绘制道路范围内来回跑
    var startTime = Date.now();
    function animateCar() {
      if (!el.parentNode) return;
      var drawnLen = currentProg * pathLen;
      if (drawnLen < 10 || !dashPath) {
        car.style.opacity = "0";
      } else {
        car.style.opacity = "1";
        var elapsed = (Date.now() - startTime) / 1000;
        var loopDur = 5; // 5 秒走完当前已绘制部分
        var frac = (elapsed % loopDur) / loopDur;
        var dist = frac * drawnLen;
        var pt = dashPath.getPointAtLength(dist);
        var pt2 = dashPath.getPointAtLength(Math.min(dist + 2, pathLen));
        var angle = Math.atan2(pt2.y - pt.y, pt2.x - pt.x) * 180 / Math.PI;
        car.setAttribute("transform", "translate(" + pt.x + "," + pt.y + ") rotate(" + angle + ")");
      }
      requestAnimationFrame(animateCar);
    }
    requestAnimationFrame(animateCar);
  }

  /* ---------- 启动 ---------- */
  initIntro();
  setupChrome();
  setupSideNav();
  setupMusic();
  setupThemeToggle();
  setupSeasonalThemes();
  setupMap();
  setupVisitCounter();
  setupEasterEgg();
  setupHeroParallax();
  loadData().then((data) => {
    DATA = data || {};
    // 开场动画期间预加载预览图（带进度跟踪 + 提前结束）
    var preloadUrls = [];
    (DATA.daily || []).forEach(function (item) {
      if (item.src) preloadUrls.push(item.src);
      if (item.files) item.files.forEach(function (f) { preloadUrls.push(f); });
    });
    (DATA.works || []).forEach(function (w) {
      if (w.type === "image" && w.file) preloadUrls.push(w.file);
      else if (w.poster) preloadUrls.push(w.poster);
    });
    // 去重
    preloadUrls = preloadUrls.filter(function (u, i, arr) { return u && arr.indexOf(u) === i; });

    PRELOAD.total = preloadUrls.length;
    PRELOAD.loaded = 0;
    var preEl = $("#introPreload");

    function updatePreloadDisplay() {
      if (!preEl) return;
      var pct = PRELOAD.total > 0 ? Math.floor(PRELOAD.loaded / PRELOAD.total * 100) : 100;
      if (PRELOAD.total === 0) {
        preEl.textContent = "无需预加载 · 即将进入";
      } else if (PRELOAD.loaded >= PRELOAD.total) {
        preEl.textContent = "预加载完成 · " + PRELOAD.total + " 张 · 100%";
      } else {
        preEl.textContent = "需要加载" + PRELOAD.total + "张预览图 — 已加载" + PRELOAD.loaded + "张   进度" + pct + "%";
      }
    }

    function tryEarlyReveal() {
      if (!PRELOAD.active || !PRELOAD.revealFn) return;
      var elapsed = Date.now() - PRELOAD.startTime;
      var minWait = 3500; // 最少播放 3.5 秒，保证视觉完整性
      if (elapsed >= minWait) {
        PRELOAD.active = false;
        PRELOAD.revealFn();
      } else {
        setTimeout(function () {
          if (PRELOAD.active && PRELOAD.revealFn) {
            PRELOAD.active = false;
            PRELOAD.revealFn();
          }
        }, minWait - elapsed);
      }
    }

    function onPreloadItemDone() {
      PRELOAD.loaded++;
      updatePreloadDisplay();
      if (PRELOAD.loaded >= PRELOAD.total) {
        PRELOAD.done = true;
        tryEarlyReveal();
      }
    }

    updatePreloadDisplay();
    if (PRELOAD.total > 0) {
      preloadUrls.forEach(function (url) {
        var img = new Image();
        img.onload = img.onerror = onPreloadItemDone;
        img.src = url;
      });
    } else {
      // 无需预加载，直接尝试提前结束
      PRELOAD.done = true;
      tryEarlyReveal();
    }

    const p = DATA.profile || {};
    // 防御性渲染：单个函数出错不影响其他模块
    function safe(label, fn) {
      try { fn(); }
      catch (err) { console.error("[渲染失败] " + label + ":", err.message); }
    }
    safe("profile",   function () { renderProfile(p); });
    safe("timeline",  function () { renderTimeline(p.timeline); });
    safe("daily",     function () { renderDaily(DATA.daily); });
    safe("featured",  function () { renderFeatured(DATA.daily); });
    safe("works",     function () { renderWorks(DATA.works); });
    safe("projects",  function () { renderProjects(DATA.projects); });
    safe("dashboard", function () { renderDashboard(DATA); });
    safe("gantt",     function () { renderGantt(DATA.projects); });
    safe("wishlist",  function () { renderWishlist(DATA.wishlist); });
    safe("changelog", function () { renderChangelog(DATA.changelog); });
    safe("filters",   function () { setupFilters(DATA.works); });
    safe("contact",   function () { renderContact(p.contact); });
    safe("friends",   function () { renderFriends(p.friends); });
    safe("typed",     function () { setupTyped(); });

    $("#year").textContent = new Date().getFullYear();
    var svEl = $("#siteVersion"); if (svEl) svEl.textContent = (window.SITE_DATA && window.SITE_DATA.version) || "1.0.0.1";

    safe("nav",       function () { setupNav(); });
    safe("lightbox",  function () { setupLightboxEvents(); });
    safe("reveal",    function () { setupReveal(); });
    safe("daily-tgl", function () { setupDailyToggle(); });
    safe("eggs",      function () { setupEggs(); });
    safe("hero-par",  function () { setupHeroParallax(); });
  });

  /* ---------- 彩蛋合集系统 ---------- */
  var EGGS = [
    { id: "night-owl", emoji: "🦉", name: "夜猫子", hint: "深夜造访（0~6点）" },
    { id: "dark-mode", emoji: "🌙", name: "暗影模式", hint: "切换深色主题" },
    { id: "music-lover", emoji: "🎧", name: "音乐发烧友", hint: "听完3首背景音乐" },
    { id: "skip-intro", emoji: "⏭️", name: "急性子", hint: "跳过开场动画" },
    { id: "scroll-bottom", emoji: "📜", name: "到底了", hint: "滚动到页面最底部" },
    { id: "ten-clicks", emoji: "👆", name: "十连击", hint: "点击左上角logo十次" },
    { id: "site-tour", emoji: "🗺️", name: "全站巡游", hint: "浏览所有板块" },
    { id: "card-flipper", emoji: "🃏", name: "翻牌达人", hint: "翻开全部项目卡片" },
    { id: "map-explorer", emoji: "📍", name: "地图探索", hint: "点击地图上的标记" },
    { id: "season-collector", emoji: "🍂", name: "四季收藏", hint: "体验春夏秋冬四种主题" },
    { id: "video-viewer", emoji: "🎬", name: "视频鉴赏", hint: "在灯箱中观看视频" },
    { id: "daily-toggle", emoji: "🔄", name: "双面日常", hint: "切换日常的展示方式" }
  ];
  // 彩蛋变量已在 IIFE 顶部声明（eggFound / tracksPlayed / brandClicks / flippedCards / seasonsTried / sectionsVisited）

  function loadEggs() {
    try { eggFound = JSON.parse(localStorage.getItem("eggs") || "{}"); } catch (e) { eggFound = {}; }
    // 清理已移除的彩蛋记录
    var validIds = EGGS.map(function (e) { return e.id; });
    var changed = false;
    Object.keys(eggFound).forEach(function (k) {
      if (validIds.indexOf(k) < 0) { delete eggFound[k]; changed = true; }
    });
    if (changed) saveEggs();
  }
  function saveEggs() {
    try { localStorage.setItem("eggs", JSON.stringify(eggFound)); } catch (e) {}
  }
  function discoverEgg(id) {
    if (eggFound[id]) return;
    eggFound[id] = Date.now();
    saveEggs();
    updateEggBadge();
    var badge = $("#eggBadge");
    if (badge) { badge.classList.add("has-new"); setTimeout(function () { badge.classList.remove("has-new"); }, 600); }
    var egg = EGGS.find(function (e) { return e.id === id; });
    if (egg) showEggToast(egg);
  }
  function showEggToast(egg) {
    var t = document.createElement("div");
    t.className = "egg-toast";
    t.innerHTML = '<span style="font-size:1.6rem">' + egg.emoji + '</span><div><b>🎉 发现彩蛋！</b><br><span style="opacity:.8">' + egg.name + '</span></div>';
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("is-show"); });
    setTimeout(function () { t.classList.remove("is-show"); setTimeout(function () { t.remove(); }, 400); }, 3500);
  }
  function updateEggBadge() {
    var count = Object.keys(eggFound).length;
    var el = $("#eggCount"); if (el) el.textContent = count + "/" + EGGS.length;
    var found = $("#eggFound"); if (found) found.textContent = count;
    var total = $("#eggTotal"); if (total) total.textContent = EGGS.length;
  }
  function renderEggGrid() {
    var grid = $("#eggGrid");
    if (!grid) return;
    grid.innerHTML = EGGS.map(function (e) {
      var found = !!eggFound[e.id];
      return '<div class="egg-card' + (found ? " found" : "") + '">' +
        '<span class="egg-card-emoji">' + e.emoji + '</span>' +
        '<div class="egg-card-info">' +
        '<div class="egg-card-name">' + (found ? e.name : "？？？") + '</div>' +
        '<div class="egg-card-hint">' + (found ? "已发现" : e.hint) + '</div>' +
        '</div></div>';
    }).join("");
  }
  function setupEggs() {
    loadEggs();
    updateEggBadge();
    // 夜猫子
    var h = new Date().getHours();
    if (h >= 0 && h < 6) discoverEgg("night-owl");
    // 跳过开场
    document.addEventListener("intro-done", function (e) {
      if (e.detail && e.detail.skipped) discoverEgg("skip-intro");
    });
    // 滚动到底部
    var footSeen = false;
    window.addEventListener("scroll", function () {
      if (footSeen) return;
      if (window.innerHeight + window.scrollY >= document.body.scrollHeight - 50) {
        footSeen = true;
        discoverEgg("scroll-bottom");
      }
    }, { passive: true });
    // 全站巡游：追踪所有 section 可见
    var SECTIONS = ["home", "about", "timeline", "dashboard", "projects", "daily", "works", "friends", "map", "wishlist", "contact", "changelog"];
    if (window.IntersectionObserver) {
      var secObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
          if (en.isIntersecting) {
            var id = en.target.id;
            if (id && SECTIONS.indexOf(id) >= 0) {
              sectionsVisited[id] = true;
              if (Object.keys(sectionsVisited).length >= SECTIONS.length) discoverEgg("site-tour");
            }
          }
        });
      }, { rootMargin: "-20% 0px -20% 0px" });
      SECTIONS.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) secObs.observe(el);
      });
    }
    // 品牌十连击
    var brand = $(".brand");
    if (brand) brand.addEventListener("click", function () {
      brandClicks++;
      if (brandClicks >= 10) discoverEgg("ten-clicks");
    });
    // 徽章点击 → 打开弹窗
    var badge = $("#eggBadge");
    var modal = $("#eggModal");
    if (badge && modal) {
      badge.addEventListener("click", function () {
        renderEggGrid();
        modal.classList.add("is-open");
        modal.setAttribute("aria-hidden", "false");
      });
    }
    var closeBtn = $("#eggModalClose");
    var bg = $("#eggModalBg");
    function closeModal() { modal.classList.remove("is-open"); modal.setAttribute("aria-hidden", "true"); }
    if (closeBtn) closeBtn.addEventListener("click", closeModal);
    if (bg) bg.addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && modal.classList.contains("is-open")) closeModal();
    });
  }

  /* ---------- 日常区视图切换（卡片 / 瀑布流）---------- */
  function setupDailyToggle() {
    var grid = $("#dailyGrid");
    var toggle = $("#dailyToggle");
    if (!grid || !toggle) return;
    var saved = localStorage.getItem("dailyView") || "card";
    applyMode(saved);
    toggle.addEventListener("click", function (e) {
      var btn = e.target.closest(".vt-btn");
      if (!btn) return;
      var mode = btn.dataset.mode;
      applyMode(mode);
      localStorage.setItem("dailyView", mode);
      // 彩蛋：双面日常
      if (typeof discoverEgg === "function") discoverEgg("daily-toggle");
    });
    function applyMode(mode) {
      toggle.querySelectorAll(".vt-btn").forEach(function (b) {
        b.classList.toggle("is-active", b.dataset.mode === mode);
      });
      grid.classList.toggle("is-card", mode === "card");
      grid.classList.toggle("is-masonry", mode === "masonry");
    }
  }
})();
