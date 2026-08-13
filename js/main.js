/* ============================================================
   Frank's Notes · 交互脚本
   移动端导航 / 返回顶部 / 页脚年份 / 列表卡片整块可点
   ============================================================ */

// 移动端导航菜单开关
(function () {
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".masthead-links");
  if (!toggle || !links) return;

  toggle.addEventListener("click", function () {
    toggle.classList.toggle("open");
    links.classList.toggle("open");
  });

  // 点击菜单项后自动收起
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

// 页脚自动年份
(function () {
  var el = document.querySelector(".footer-year");
  if (el) el.textContent = new Date().getFullYear();
})();

// 让整张文章卡片可点击（点击卡片任意位置跳到链接）
// 给 .post-card 加 data-href 即可启用
(function () {
  var cards = document.querySelectorAll(".post-card[data-href]");
  cards.forEach(function (card) {
    card.style.cursor = "pointer";
    card.addEventListener("click", function (e) {
      // 点到卡片内的真实链接时，交给它自己处理
      if (e.target.closest("a")) return;
      window.location.href = card.getAttribute("data-href");
    });
  });
})();
