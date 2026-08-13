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

// 返回顶部按钮
(function () {
  var btn = document.querySelector(".back-top");
  if (!btn) return;

  window.addEventListener("scroll", function () {
    btn.classList.toggle("show", window.scrollY > 480);
  }, { passive: true });

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
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

  // 同父级下的 .reveal 按索引错峰 70ms
  items.forEach(function (el) {
    var siblings = Array.prototype.filter.call(el.parentNode.children, function (c) {
      return c.classList.contains("reveal");
    });
    var idx = siblings.indexOf(el);
    if (idx > 0) el.style.transitionDelay = idx * 70 + "ms";
  });

  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (en) {
      if (en.isIntersecting) {
        en.target.classList.add("in");
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12, rootMargin: "0px 0px -8% 0px" });

  items.forEach(function (el) { io.observe(el); });
})();
