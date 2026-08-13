/* ============================================================
   Frank's Notes · 交互脚本
   侧边栏汉堡菜单 / 返回顶部
   ============================================================ */

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

// 返回顶部按钮（rAF 缓动动画，比浏览器自带 smooth 更丝滑）
(function () {
  var btn = document.querySelector(".back-top");
  if (!btn) return;

  window.addEventListener("scroll", function () {
    btn.classList.toggle("show", window.scrollY > 480);
  }, { passive: true });

  btn.addEventListener("click", function () {
    var start = window.scrollY;
    var dur = 480;
    var t0 = null;

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(ts) {
      if (t0 === null) t0 = ts;
      var p = Math.min((ts - t0) / dur, 1);
      window.scrollTo(0, Math.round(start * (1 - easeInOutCubic(p))));
      if (p < 1) requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  });
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
