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
  let lightboxList = [];    // 当前灯箱可切换的条目
  let lightboxIndex = 0;
  let videoVolume = 0.8;    // 视频音量（由音乐卡片控制）
  let bgMusicWasPlaying = false;  // 灯箱打开前背景音乐是否在播放
  const MAX_MUSIC_VOL = 0.55;    // 音乐音量上限（拉满也不刺耳）
  let musicVolume = 0;           // 当前音乐音量（0~MAX_MUSIC_VOL）

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

  function fmtSize(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(1) + " MB";
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
    $("#heroQuote").textContent = p.quote || "";
    $("#aboutName").textContent = name;
    $("#aboutAlias").textContent = [p.enName, p.nickname].filter(Boolean).join(" · ");
    if (p.avatar) $("#avatar").src = p.avatar;

    // 标签
    const tags = p.tags || [];
    $("#tagList").innerHTML = tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("");

    // 简介（数组或字符串）
    const bioEl = $("#bio");
    let paras = p.bio || [];
    if (typeof paras === "string") paras = [paras];
    bioEl.innerHTML = paras.map((t) => `<p>${esc(t)}</p>`).join("");

    // 数据
    const stats = p.stats || [];
    $("#stats").innerHTML = stats
      .map((s) => `<div class="stat"><b>${esc(s.value)}</b><span>${esc(s.label)}</span></div>`)
      .join("");
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
            <img src="${esc(d.files[0])}" alt="${esc(d.title)}" loading="lazy">
            <span class="daily-badge">📷 共 ${d.files.length} 张</span>`;
        } else if (d.type === "video") {
          media = `
            <img src="${esc(d.poster || "content/works/video.svg")}" alt="${esc(d.title)}" loading="lazy">
            <span class="daily-badge video">🎬 视频</span>
            <div class="play-overlay"><span class="play-icon">▶</span></div>`;
        } else {
          media = `<img src="${esc(d.src)}" alt="${esc(d.title)}" loading="lazy">`;
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
        const slides = [];
        if (item.type === "album") {
          item.files.forEach((f, k) =>
            slides.push({
              type: "image",
              file: f,
              title: item.title,
              desc: item.desc ? `${item.desc}（${k + 1}/${item.files.length}）` : `${k + 1}/${item.files.length}`,
            })
          );
        } else if (item.type === "video") {
          slides.push({ type: "video", file: item.file, title: item.title, desc: item.desc });
        } else {
          slides.push({ type: "image", file: item.src, title: item.title, desc: item.desc });
        }
        openLightbox(slides, 0, slides[0].type);
      });
    });
  }

  /* ---------- 渲染：作品 ---------- */
  const TYPE_LABEL = { video: "视频", image: "图片", doc: "文档" };

  function renderWorks(works) {
    const grid = $("#worksGrid");
    const list = (works || []).filter(
      (w) => currentFilter === "all" || w.type === currentFilter
    );

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
            </div>
          </article>`;
        }

        if (w.type === "video") {
          return `
          <article class="work-card reveal" data-type="${w.type}" data-index="${i}" style="transition-delay:${(i % 8) * 70}ms">
            <div class="work-media">
              <img src="${esc(w.poster || "content/works/video.svg")}" alt="${esc(w.title)}" loading="lazy">
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
            </div>
          </article>`;
        }

        // image
        return `
        <article class="work-card reveal" data-type="${w.type}" data-index="${i}" style="transition-delay:${(i % 8) * 70}ms">
          <div class="work-media">
            <img src="${esc(w.file)}" alt="${esc(w.title)}" loading="lazy">
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
    const items = [];
    if (c.email) items.push(["📧", "邮箱", c.email]);
    if (c.wechat) items.push(["💬", "微信", c.wechat]);
    if (c.github) items.push(["🐙", "GitHub", c.github]);
    if (c.phone) items.push(["📱", "电话", c.phone]);
    if (c.location) items.push(["📍", "所在地", c.location]);
    if (!items.length) items.push(["✉️", "联系我", "（在 content/profile.json 里填写联系方式）"]);

    $("#contactGrid").innerHTML = items
      .map(
        ([icon, label, value], i) => `
      <div class="contact-item reveal" style="transition-delay:${(i % 4) * 80}ms">
        <div class="icon">${icon}</div>
        <h4>${label}</h4>
        <p>${esc(value)}</p>
      </div>`
      )
      .join("");
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
        inner = srcFile
          ? `<video src="${esc(srcFile)}" controls autoplay></video>
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
      const cap = item.title || "";
      $("#lightboxCaption").innerHTML = cap
        ? esc(cap) + (item.desc ? `<br><small style="opacity:.75">${esc(item.desc)}</small>` : "")
        : "";
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
    const header = $("#siteHeader");
    const toggle = $("#navToggle");
    const links = $("#navLinks");

    const onScroll = () => header.classList.toggle("is-scrolled", window.scrollY > 10);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    toggle.addEventListener("click", () => {
      const open = links.classList.toggle("is-open");
      toggle.classList.toggle("is-open", open);
    });
    $$(".nav-link", links).forEach((a) =>
      a.addEventListener("click", () => {
        links.classList.remove("is-open");
        toggle.classList.remove("is-open");
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

    const reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let hidden = false;
    const revealHome = () => {
      if (hidden) return;
      hidden = true;
      document.body.style.overflow = "";
      hero.classList.add("is-ready");               // 首页元素开始逐帧入场
      setTimeout(() => intro.classList.add("is-hidden"), 800); // 等滑出动画收尾
    };

    // 可选：同一会话内不再重播（file:// 无 sessionStorage 时每次都会播）
    if (ONCE_PER_SESSION) {
      let seen = false;
      try { seen = !!sessionStorage.getItem("intro-seen"); } catch (e) {}
      if (seen) {
        intro.classList.add("is-hidden");
        hero.classList.add("is-ready");
        return;
      }
      try { sessionStorage.setItem("intro-seen", "1"); } catch (e) {}
    }

    document.body.style.overflow = "hidden";        // 播放期间锁定滚动
    const skipBtn = $("#introSkip");
    if (skipBtn) skipBtn.addEventListener("click", revealHome);

    // 系统开启“减弱动态效果”时：不播动画，短暂停留品牌页后直接进入
    if (reduced) {
      setTimeout(revealHome, 1600);
      return;
    }

    // CSS 动画 2.4s 后自行滑出；这里同步触发首页入场 + 兜底
    setTimeout(revealHome, 2500);
    intro.addEventListener("animationend", (e) => {
      if (e.animationName === "intro-exit") revealHome();
    });
  }

  /* ---------- 滚动进度条 / 回到顶部 ---------- */
  function setupChrome() {
    const bar = $("#scrollProgress");
    const toTop = $("#toTop");
    const update = () => {
      const st = window.scrollY || document.documentElement.scrollTop || 0;
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      if (bar) bar.style.width = Math.min(100, (st / max) * 100) + "%";
      if (toTop) toTop.classList.toggle("is-visible", st > 600);
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
    const reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const words = (DATA.profile && DATA.profile.tags) || ["机械", "3D建模", "动手DIY"];
    if (reduced) { el.textContent = words[0]; return; }

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
    setTimeout(tick, 2300); // 等开场动画播完再开始
  }

  /* ---------- 统计数字滚动 ---------- */
  function setupStats() {
    const statsEl = $("#stats");
    if (!statsEl) return;
    const nums = $$(".stat b", statsEl);
    if (!nums.length) return;
    const reduced =
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          io.unobserve(e.target);
          nums.forEach((b) => {
            const end = parseInt(b.textContent, 10);
            if (isNaN(end)) return;
            const t0 = performance.now();
            const dur = 900;
            const step = (t) => {
              const p = Math.min(1, (t - t0) / dur);
              b.textContent = Math.round(end * (1 - Math.pow(1 - p, 3)));
              if (p < 1) requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
          });
        });
      },
      { threshold: 0.4 }
    );
    io.observe(statsEl);
  }

  /* ---------- 左侧章节导航 ---------- */
  function setupSideNav() {
    const fill = $("#sideFill");
    const dots = $$(".side-dot");
    if (!dots.length) return;

    const update = () => {
      const st = window.scrollY || document.documentElement.scrollTop || 0;
      const max = (document.documentElement.scrollHeight - window.innerHeight) || 1;
      if (fill) fill.style.height = Math.min(100, (st / max) * 100) + "%";
    };
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();

    // 高亮当前章节
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
    if (!audio || !playBtn) return;

    let currentTrack = 0;
    let isPlaying = false;

    // 实际音量 = 滑块值 × 上限（拉满也不刺耳）
    function calcVol() {
      return (parseInt(musicVol.value, 10) / 100) * MAX_MUSIC_VOL;
    }

    function updateIcon() {
      if (musicIcon) musicIcon.textContent = TRACKS[currentTrack].icon;
    }

    function switchTrack(idx) {
      currentTrack = idx;
      audio.src = TRACKS[idx].file;
      $$(".track-btn", tracksEl).forEach(function (b, i) {
        b.classList.toggle("is-active", i === idx);
      });
      updateIcon();
      if (isPlaying) audio.play().catch(function () {});
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
      var step = 0, total = 60;
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
    function toggleCollapse() { card.classList.toggle("is-collapsed"); }
    if (collapseBtn) collapseBtn.addEventListener("click", function (e) { e.stopPropagation(); toggleCollapse(); });
    card.addEventListener("click", function () {
      if (card.classList.contains("is-collapsed")) toggleCollapse();
    });

    audio.addEventListener("ended", function () { if (isPlaying) audio.play().catch(function () {}); });

    updateIcon();
    // 入场动画结束后自动渐入播放
    setTimeout(tryAutoPlay, 3000);
  }

  /* ---------- 启动 ---------- */
  initIntro();
  setupChrome();
  setupSideNav();
  setupMusic();
  loadData().then((data) => {
    DATA = data || {};
    const p = DATA.profile || {};
    renderProfile(p);
    renderDaily(DATA.daily);
    renderWorks(DATA.works);
    setupFilters(DATA.works);
    renderContact(p.contact);
    setupTyped();
    setupStats();

    $("#year").textContent = new Date().getFullYear();

    setupNav();
    setupLightboxEvents();
    setupReveal();
  });
})();
