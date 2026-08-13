/* ============================================================
   Frank's Notes · 交互脚本
   侧边栏汉堡菜单 / 平滑滚动 / 返回顶部 / 滚动高亮 / 入场动画 / 分类筛选
   ============================================================ */

// 通用平滑滚动（easeInOutExpo，参考站同款缓动）
function smoothScrollTo(targetY, dur) {
  var start = window.scrollY;
  var d = dur || 800;
  var t0 = null;

  function easeInOutExpo(t) {
    return t === 0 ? 0 : t === 1 ? 1 :
      t < 0.5 ? Math.pow(2, 20 * t - 10) / 2
              : (2 - Math.pow(2, -20 * t + 10)) / 2;
  }

  function step(ts) {
    if (t0 === null) t0 = ts;
    var p = Math.min((ts - t0) / d, 1);
    window.scrollTo(0, Math.round(start + (targetY - start) * easeInOutExpo(p)));
    if (p < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// 侧边栏移动端开关
(function () {
  var toggle  = document.querySelector(".sidebar-toggle");
  var sidebar = document.querySelector(".sidebar");
  var overlay = document.querySelector(".sidebar-overlay");
  if (!toggle || !sidebar) return;

  function openSidebar() {
    toggle.classList.add("open");
    sidebar.classList.add("open");
    if (overlay) overlay.classList.add("show");
    document.body.style.overflow = "hidden";
  }

  function closeSidebar() {
    toggle.classList.remove("open");
    sidebar.classList.remove("open");
    if (overlay) overlay.classList.remove("show");
    document.body.style.overflow = "";
  }

  toggle.addEventListener("click", function () {
    sidebar.classList.contains("open") ? closeSidebar() : openSidebar();
  });

  if (overlay) overlay.addEventListener("click", closeSidebar);

  // 点击侧边栏内链接后关闭
  sidebar.addEventListener("click", function (e) {
    if (e.target.tagName === "A") closeSidebar();
  });
})();

// 返回顶部按钮（复用 smoothScrollTo）
(function () {
  var btn = document.querySelector(".back-top");
  if (!btn) return;

  window.addEventListener("scroll", function () {
    btn.classList.toggle("show", window.scrollY > 480);
  }, { passive: true });

  btn.addEventListener("click", function () {
    smoothScrollTo(0, 480);
  });
})();

// 首页锚点平滑滚动 + 滚动高亮（scrollspy，参考站效果）
(function () {
  var anchorLinks = document.querySelectorAll('.sidebar-links a[href^="#"]');
  if (!anchorLinks.length) return;

  // 1) 点击导航 → 平滑滚动到区块
  anchorLinks.forEach(function (a) {
    a.addEventListener("click", function (ev) {
      var el = document.querySelector(a.getAttribute("href"));
      if (!el) return;
      ev.preventDefault();
      smoothScrollTo(el.getBoundingClientRect().top + window.scrollY - 10, 900);
      if (history.replaceState) history.replaceState(null, "", a.getAttribute("href"));
    });
  });

  // 2) scrollspy：滚动时高亮当前区块对应的导航项
  //    技能/经历区归「关于」，文章区→文章，作品区→作品
  var spySections = [
    { id: "about",      link: '.sidebar a[href="#about"]' },
    { id: "skills",     link: '.sidebar a[href="#about"]' },
    { id: "experience", link: '.sidebar a[href="#about"]' },
    { id: "posts",      link: '.sidebar a[href="#posts"]' },
    { id: "projects",   link: '.sidebar a[href="#projects"]' },
  ].filter(function (s) { return document.getElementById(s.id); });

  if (!spySections.length) return;

  var spyTops = spySections.map(function (s) {
    return { top: document.getElementById(s.id).offsetTop, link: s.link };
  });
  var navLinks = document.querySelectorAll(".sidebar-links a");

  function updateSpy() {
    var mid = window.scrollY + window.innerHeight / 2;
    var cur = null;
    spyTops.forEach(function (t) { if (t.top <= mid) cur = t; });

    navLinks.forEach(function (l) { l.classList.remove("active"); });
    if (cur) {
      var target = document.querySelector(cur.link);
      if (target) target.classList.add("active");
    } else {
      // 顶部区域 → 首页高亮
      var home = document.querySelector('.sidebar-links a[href="#top"]');
      if (home) home.classList.add("active");
    }
  }

  var ticking = false;
  window.addEventListener("scroll", function () {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(function () { updateSpy(); ticking = false; });
    }
  }, { passive: true });

  updateSpy();
})();

// 滚动入场动画（IntersectionObserver + 同组错峰 + 降级）
(function () {
  var items = document.querySelectorAll(".reveal");
  if (!items.length) return;

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // 无障碍偏好或浏览器不支持：全部立即显示
  if (reduce || !("IntersectionObserver" in window)) {
    items.forEach(function (el) { el.classList.add("in"); });
    return;
  }

  // 同父级下的 .reveal 按索引错峰 45ms
  items.forEach(function (el) {
    var siblings = Array.prototype.filter.call(el.parentNode.children, function (c) {
      return c.classList.contains("reveal");
    });
    var idx = siblings.indexOf(el);
    if (idx > 0) el.style.transitionDelay = idx * 45 + "ms";
  });

  // 动画结束后释放合成层（移除 will-change/transition，滚动不卡）
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        io.unobserve(en.target);
        var delay = parseFloat(en.target.style.transitionDelay) || 0;
        setTimeout(function () {
          en.target.classList.add("reveal-done");
        }, 520 + delay);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  items.forEach(function (el) { io.observe(el); });
})();

// 文章分类筛选（blog 页筛选标签）
(function () {
  var bar = document.querySelector(".filter-bar");
  if (!bar) return;
  var btns = bar.querySelectorAll(".filter-btn");
  if (!btns.length) return;

  function applyFilter(f) {
    btns.forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-filter") === f);
    });
    document.querySelectorAll(".post-item").forEach(function (item) {
      var show = f === "all" || item.getAttribute("data-cat") === f;
      item.style.display = show ? "" : "none";
    });
  }

  // 每个按钮直接绑定，不依赖事件委托
  btns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      applyFilter(btn.getAttribute("data-filter"));
    });
  });
})();
