# 部署指南

Frank's Notes 基于 Hexo，构建出纯静态站点后发布。

---

## ✅ 主渠道：GitHub Actions（自动，推荐）

push 到 `main` 分支后，`.github/workflows/deploy.yml` 会自动：

1. `npm ci` 装依赖
2. 双构建：中文 → `public/`，英文 → `public/en/`（中途清 `db.json` 防串资产）
3. 把 `public/` 发布到 GitHub Pages
4. 自定义域名 **https://frank-dev.site** 生效（`source/CNAME` 自动复制到 `public/` 根）

### 一次性前提（已设置完成 ✅）
仓库 **Settings → Pages → Build and deployment → Source** 已选 **「GitHub Actions」**（2026-08-14 设置）。如误改回「Deploy from a branch」，需改回来，否则会和 Hexo 产物冲突。

### 日常发布
```bash
git add -A && git commit -m "..." && git push   # 推 main，约 1 分钟上线
```
功能开发请在 `feat/*` 分支进行，合并到 `main` 才触发部署。

### 验证
- Actions 页面看构建是否绿。
- 线上 URL 加 `?b=时间戳` 穿透 CDN 缓存，浏览器强刷。
- 中：https://frank-dev.site ｜ 英：https://frank-dev.site/en/

---

## 本地预览 / 手动构建
```bash
npm install
npm run server     # 本地预览中文 http://localhost:4000
npm run build      # 构建中英两套到 public/
```
手动检查 `public/`（中）与 `public/en/`（英）输出齐全即可。

---

## 备用渠道：EdgeOne Pages（手动上传）

需要先本地 `npm run build` 产出 `public/`，再把 `public/` 文件夹（注意是 `public/` 里的内容，不是整个项目）上传到 EdgeOne Pages。
- 国内访问快、免费额度、免备案子域名。
- 绑定自定义域名时，到 DNS 服务商加 CNAME 指向 EdgeOne 提供的地址。
- ⚠️ 旧版「直接上传项目根目录 / 推 Gitee 自动部署」**已不适用**——现在必须先构建。

---

## 常见问题

**Q：GitHub Pages 显示 404 或还是旧站？**
A：99% 是 Settings → Pages 的 Source 没改成「GitHub Actions」。改完重跑一次 workflow。

**Q：`/en/` 页面 404？**
A：确认 workflow 里英文构建步骤跑过；本地 `npm run build` 后检查 `public/en/index.html` 是否存在。

**Q：自定义域名失效？**
A：`source/CNAME` 内容是 `frank-dev.site`，构建会复制到 `public/CNAME`；DNS 的 CNAME/A 记录指向 `<user>.github.io` 即可。

**Q：怎么新增文章 / 项目？**
A：见 [`docs/写文章指南.md`](docs/写文章指南.md)。项目改 `source/_data/projects.yml` 与 `source_en/_data/projects.yml`（两份保持一致）。
