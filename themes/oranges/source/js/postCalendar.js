// 首页文章发布热力图：悬停方格时在其上方浮层显示日期与当天发布篇数（原生 title 提示慢且样式不可控）
(function () {
  const calendar = document.querySelector(".post-calendar");
  const svg = calendar && calendar.querySelector("svg");
  if (!svg) return;

  const tip = document.createElement("div");
  tip.className = "post-calendar-tip";
  tip.setAttribute("aria-hidden", "true");
  document.body.appendChild(tip);

  // 悬停目标方格：文本取构建时写入的 aria-label，水平方向夹在视口内，贴方格顶部 8px
  const show = (cell) => {
    tip.textContent = cell.getAttribute("aria-label");
    tip.classList.add("show");
    const rect = cell.getBoundingClientRect();
    const width = tip.offsetWidth;
    const centerX = Math.min(
      Math.max(rect.left + rect.width / 2, width / 2 + 8),
      window.innerWidth - width / 2 - 8
    );
    tip.style.left = centerX + "px";
    tip.style.top = rect.top - 8 + "px";
  };

  const hide = () => tip.classList.remove("show");

  const cellFrom = (target) =>
    target instanceof Element ? target.closest("rect[data-date]") : null;

  svg.addEventListener("mouseover", (e) => {
    const cell = cellFrom(e.target);
    if (cell) show(cell);
  });

  // 在方格间移动不熄灭，移出热力图才隐藏
  svg.addEventListener("mouseout", (e) => {
    if (!cellFrom(e.relatedTarget)) hide();
  });

  svg.addEventListener("mouseleave", hide);
})();
