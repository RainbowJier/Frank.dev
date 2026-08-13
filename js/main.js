/* ============================================================
   Frank's Notes · 交互脚本
   移动端导航 / 返回顶部 / 页脚年份
   ============================================================ */

// 移动端导航菜单开关
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", function () {
    toggle.classList.toggle("open");
    links.classList.toggle("open");
  });

  links.addEventListener("click", function (e) {
    if (e.target.tagName === "A") {
      toggle.classList.remove("open");
      links.classList.remove("open");
    }
  });
})();

// 返回顶部按钮
(function () {
  var btn = document.querySelector(".back-top");
  if (!btn) return;

  window.addEventListener("scroll", function () {
    if (window.scrollY > 480) btn.classList.add("show");
    else btn.classList.remove("show");
  }, { passive: true });

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

// 页脚年份（data-i18n-year 由 i18n.js 处理，这里兜底）
(function () {
  var el = document.querySelector(".footer-year");
  if (el && !el.getAttribute("data-i18n-year")) {
    el.textContent = new Date().getFullYear();
  }
})();
