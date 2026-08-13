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
