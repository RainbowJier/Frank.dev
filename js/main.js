/* ============================================================
   my-site 交互脚本：移动端菜单 / 返回顶部 / 年份
   ============================================================ */

// 移动端导航菜单
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");

  if (toggle && links) {
    toggle.addEventListener("click", function () {
      toggle.classList.toggle("open");
      links.classList.toggle("open");
    });

    // 点击菜单项后自动收起（移动端）
    links.addEventListener("click", function (e) {
      if (e.target.tagName === "A") {
        toggle.classList.remove("open");
        links.classList.remove("open");
      }
    });
  }
})();

// 返回顶部按钮
(function () {
  var btn = document.querySelector(".back-top");
  if (!btn) return;

  window.addEventListener("scroll", function () {
    if (window.scrollY > 400) {
      btn.classList.add("show");
    } else {
      btn.classList.remove("show");
    }
  });

  btn.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

// 页脚自动年份
(function () {
  var el = document.querySelector(".footer-year");
  if (el) el.textContent = new Date().getFullYear();
})();
