// 点击侧栏头像：放大查看 + 导出图片
(function () {
  const avatarImg = document.querySelector(".header .avatar > a > img");
  if (!avatarImg) return;

  let viewer = null;

  const open = () => {
    if (viewer) return;
    const src = avatarImg.getAttribute("src");
    const filename = src.slice(src.lastIndexOf("/") + 1) || "avatar.png";

    viewer = document.createElement("div");
    viewer.className = "avatar-viewer";
    viewer.setAttribute("role", "dialog");
    viewer.setAttribute("aria-label", "查看头像大图");
    viewer.innerHTML =
      `<figure class="avatar-viewer-body">` +
      `<img src="${src}" alt="头像大图">` +
      `</figure>` +
      `<div class="avatar-viewer-actions">` +
      `<a class="avatar-viewer-btn" href="${src}" download="${filename}">导出图片</a>` +
      `<button class="avatar-viewer-btn" type="button" data-close>关闭</button>` +
      `</div>`;

    viewer.addEventListener("click", (e) => {
      if (e.target === viewer || e.target.closest("[data-close]")) close();
    });
    document.body.appendChild(viewer);
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
  };

  const close = () => {
    if (!viewer) return;
    const node = viewer;
    viewer = null;
    node.classList.add("closing");
    setTimeout(() => node.remove(), 200);
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
  };

  const onKey = (e) => {
    if (e.key === "Escape") close();
  };

  const link = avatarImg.parentElement;
  link.title = "点击放大查看";
  link.addEventListener("click", (e) => {
    e.preventDefault();
    open();
  });
})();
