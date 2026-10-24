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
    var hq = $("#heroQuote");
    if (hq) hq.textContent = p.quote || "";
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

    // 技能进度条（替代标签）
    var skills = p.skills || [];
    if (skills.length) {
      $("#tagList").innerHTML = '<div class="skills">' + skills.map(function (s) {
        var lvl = Math.max(0, Math.min(100, s.level || 0));
        return '<div class="skill-row"><span class="skill-name">' + esc(s.name) + '</span>' +
          '<span class="skill-track"><span class="skill-fill" style="--lvl:' + lvl + '%"></span></span>' +
          '<span class="skill-val">' + lvl + '</span></div>';
      }).join("") + '</div>';
    } else {
      var tags = p.tags || [];
      $("#tagList").innerHTML = tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join("");
    }

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
              ${tagsHtml}
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
    var items = [];
    if (c.email) items.push(["📧", "邮箱", c.email, null]);
    if (c.wechat) items.push(["💬", "微信", c.wechat, null]);
    if (c.bilibili) items.push(["📺", "B 站", "点击访问主页", c.bilibili]);
    if (c.douyin) items.push(["🎵", "抖音", "点击访问主页", c.douyin]);
    if (c.zhihu) items.push(["💡", "知乎", "点击访问主页", c.zhihu]);
    if (c.github) items.push(["🐙", "GitHub", "点击访问主页", c.github]);
    if (c.phone) items.push(["📱", "电话", c.phone, null]);
    if (c.location) items.push(["📍", "所在地", c.location, null]);
    if (!items.length) items.push(["✉️", "联系我", "（在 content/profile.json 里填写联系方式）", null]);

    var html = items.map(function (arr, i) {
      var icon = arr[0], label = arr[1], value = arr[2], link = arr[3];
      var tag = link ? "a" : "div";
      var href = link ? ' href="' + esc(link) + '" target="_blank" rel="noopener"' : "";
      return '<' + tag + ' class="contact-item reveal"' + href + ' style="transition-delay:' + ((i % 4) * 80) + 'ms">' +
        '<div class="icon">' + icon + '</div><h4>' + label + '</h4><p>' + esc(value) + '</p></' + tag + '>';
    }).join("");

    $("#contactGrid").innerHTML = html;
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

    // ====== 5秒后或首次页面交互后自动收起 + 气泡提示 ======
    var autoCollapsed = false;
    function autoCollapse() {
      if (autoCollapsed) return;
      autoCollapsed = true;
      card.classList.add("is-collapsed");
      // 弹出气泡，3 秒后消失
      var bubble = document.createElement("div");
      bubble.className = "music-bubble";
      bubble.textContent = "背景音乐调节设置藏在这里哦~";
      document.body.appendChild(bubble);
      requestAnimationFrame(function () { bubble.classList.add("is-show"); });
      setTimeout(function () {
        bubble.classList.remove("is-show");
        setTimeout(function () { if (bubble.parentNode) bubble.remove(); }, 400);
      }, 3000);
    }
    // 开场动画约 3 秒，计时和交互监听都在动画结束后才开始
    // 5 秒后自动收起（= 开场结束 + 5 秒展示时间）
    setTimeout(autoCollapse, 8000);
    // 首次点击/触摸/滚动（不在音乐卡片上）也触发收起
    function onInteract(e) {
      if (autoCollapsed) return;
      if (e && e.target && card.contains(e.target)) return;
      setTimeout(autoCollapse, 50);
    }
    // 延迟到开场动画结束后再监听，避免开场期间误触
    setTimeout(function () {
      document.addEventListener("click", onInteract, { passive: true });
      document.addEventListener("touchstart", onInteract, { passive: true });
      document.addEventListener("scroll", onInteract, { passive: true });
    }, 3500);
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
        return (
          '<article class="project-card reveal" style="--p:' + progress + '%;transition-delay:' + ((i % 4) * 80) + 'ms">' +
            '<div class="project-body">' +
              '<h3 class="project-name">' + esc(p.name) + '</h3>' +
              (p.desc ? '<p class="project-desc">' + esc(p.desc) + '</p>' : '') +
              (p.goal ? '<div class="project-field"><span class="project-label">目标</span><span class="project-value">' + esc(p.goal) + '</span></div>' : '') +
              '<div class="project-field"><span class="project-label">进度</span>' +
                '<div class="project-progress-wrap"><span class="project-progress"><i></i></span>' +
                '<span class="project-progress-val">' + progress + '%</span></div>' +
              '</div>' +
              (p.expected ? '<div class="project-field"><span class="project-label">期望结果</span><span class="project-value">' + esc(p.expected) + '</span></div>' : '') +
              (p.learned ? '<div class="project-field"><span class="project-label">我收获了什么</span><span class="project-value">' + esc(p.learned) + '</span></div>' : '') +
            '</div>' +
          '</article>'
        );
      })
      .join("");
  }

  /* ---------- 渲染：我还想做的（清单卡片） ---------- */
  function renderWishlist(items) {
    var grid = $("#wishlistGrid");
    if (!items || !items.length) {
      grid.innerHTML = '<div class="empty-state">还没有内容～ 编辑 <code>content/wishlist.json</code> 后运行 <code>node build.js</code></div>';
      return;
    }
    grid.innerHTML = items
      .map(function (item, i) {
        var imp = Math.max(0, Math.min(5, item.importance || 0));
        var att = Math.max(0, Math.min(5, item.attraction || 0));
        var impDots = "";
        var attDots = "";
        for (var j = 1; j <= 5; j++) {
          impDots += '<i class="' + (j <= imp ? "on" : "") + '"></i>';
          attDots += '<i class="' + (j <= att ? "on" : "") + '"></i>';
        }
        return (
          '<div class="wishlist-item reveal" style="transition-delay:' + ((i % 6) * 60) + 'ms">' +
            '<p class="wishlist-text">' + esc(item.text) + '</p>' +
            '<div class="wishlist-ratings">' +
              '<span class="wr"><label>重要性</label><span class="rating-dots">' + impDots + '</span></span>' +
              '<span class="wr"><label>吸引度</label><span class="rating-dots">' + attDots + '</span></span>' +
            '</div>' +
          '</div>'
        );
      })
      .join("");
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
      return '<div class="timeline-item reveal" style="transition-delay:' + ((i % 5) * 80) + 'ms">' +
        '<div class="timeline-date">' + esc(t.date || "") + '</div>' +
        '<div class="timeline-event">' + esc(t.event || "") + '</div>' +
        (t.desc ? '<div class="timeline-desc">' + esc(t.desc) + '</div>' : '') +
      '</div>';
    }).join("");
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
    });
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
    var overlay = document.createElement("div");
    overlay.className = "card-stack-overlay";
    var stage = document.createElement("div");
    stage.className = "card-stack-stage";
    var hint = document.createElement("p");
    hint.className = "card-stack-hint";
    hint.textContent = "点击卡片翻到下一张 · " + item.files.length + " 张";
    var closeBtn = document.createElement("button");
    closeBtn.className = "card-stack-close";
    closeBtn.innerHTML = "✕";
    closeBtn.addEventListener("click", function () { closeStack(); });
    overlay.appendChild(closeBtn);
    overlay.appendChild(stage);
    overlay.appendChild(hint);
    document.body.appendChild(overlay);
    document.body.style.overflow = "hidden";

    var idx = 0;
    function renderStack() {
      stage.innerHTML = "";
      var showCount = Math.min(3, item.files.length - idx);
      for (var i = showCount - 1; i >= 0; i--) {
        var fileIdx = idx + i;
        var card = document.createElement("div");
        card.className = "stack-card";
        card.style.zIndex = String(showCount - i);
        if (i === 0) {
          card.style.transform = "translate(0,0) rotate(0)";
        } else {
          card.style.transform = "translate(" + (i * 6) + "px," + (i * 8) + "px) rotate(" + (i * 2) + "deg)";
          card.style.opacity = String(1 - i * 0.15);
        }
        var img = document.createElement("img");
        img.src = item.files[fileIdx];
        img.alt = item.title || "";
        card.appendChild(img);
        var meta = document.createElement("div");
        meta.className = "stack-card-meta";
        meta.innerHTML = "<b>" + esc(item.title || "") + "</b>" +
          "<small>" + (fileIdx + 1) + "/" + item.files.length + (item.desc ? " · " + esc(item.desc) : "") + "</small>";
        card.appendChild(meta);
        if (i === 0) {
          card.addEventListener("click", function () { nextCard(); });
        }
        stage.appendChild(card);
      }
      hint.textContent = "点击卡片翻到下一张 · " + (idx + 1) + "/" + item.files.length;
    }
    function nextCard() {
      var top = stage.querySelector(".stack-card:last-child") || stage.querySelector(".stack-card");
      if (top) {
        top.style.transform = "translateX(120%) rotate(25deg)";
        top.style.opacity = "0";
      }
      setTimeout(function () {
        idx++;
        if (idx >= item.files.length) idx = 0;
        renderStack();
      }, 450);
    }
    function closeStack() {
      overlay.classList.remove("is-open");
      document.body.style.overflow = "";
      setTimeout(function () { if (overlay.parentNode) overlay.remove(); }, 300);
    }
    // 点击背景关闭
    overlay.addEventListener("click", function (e) {
      if (e.target === overlay) closeStack();
    });
    document.addEventListener("keydown", function stackKey(e) {
      if (!overlay.parentNode) { document.removeEventListener("keydown", stackKey); return; }
      if (e.key === "Escape") closeStack();
      if (e.key === "ArrowRight" || e.key === "Enter") nextCard();
    });
    requestAnimationFrame(function () { overlay.classList.add("is-open"); });
    renderStack();
  }

  /* ---------- 启动 ---------- */
  initIntro();
  setupChrome();
  setupSideNav();
  setupMusic();
  setupThemeToggle();
  setupVisitCounter();
  setupEasterEgg();
  loadData().then((data) => {
    DATA = data || {};
    const p = DATA.profile || {};
    renderProfile(p);
    renderTimeline(p.timeline);
    renderDaily(DATA.daily);
    renderWorks(DATA.works);
    renderProjects(DATA.projects);
    renderWishlist(DATA.wishlist);
    if (typeof renderChangelog === "function") renderChangelog(DATA.changelog);
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
