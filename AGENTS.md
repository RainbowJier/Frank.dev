# AGENTS.md

个人网站 Frank.dev：个人主页 + 博客 + 作品集三合一的纯静态站点。

## 项目概况
- 纯静态：HTML + CSS + JavaScript，零框架、零构建、零依赖、无 package.json。
- 站点语言为中文（`<html lang="zh-CN">`），代码注释也用中文。
- 本地预览：直接双击 `index.html`，或运行 `python -m http.server` 后访问 localhost:8000。
- 没有构建/测试/lint 命令；改完直接刷新浏览器验证。

## 目录结构
- `index.html` — 个人主页/简历（导航、Hero、关于我、技能、经历时间线）
- `blog.html` — 博客文章列表（卡片式）
- `posts/` — 博客文章页（hello-world.html、deploy-static-site.html）
- `projects.html` — 作品集项目卡片
- `css/style.css` — 全站统一样式
- `js/main.js` — 移动端菜单、返回顶部、页脚年份
- `assets/` — 图片等静态资源

## 约定与注意事项
- 每个页面都是完整独立 HTML，导航和页脚在每个文件里重复出现——新增/修改导航时须同步所有页面；`posts/` 内的页面用相对路径 `../`（如 `../css/style.css`）。
- 样式全部走 `css/style.css` 顶部 `:root` 的 CSS 变量（颜色/圆角/阴影），不要写死颜色；深色模式由 `prefers-color-scheme` 自动适配，无需手动切换。
- 新增博客文章：复制 `posts/hello-world.html` 改内容，并在 `blog.html` 复制一张文章卡片；新增项目卡片同理（`.project-card`）。
- 页面目前仍是模板占位内容（「你的名字」等），改信息时保持结构。

## 部署
- 部署到腾讯云 EdgeOne Pages（上传文件夹或 Gitee 仓库自动部署），步骤详见 `deploy.md`（改部署相关前先读它）。
- ⚠️ 注意：本地当前分支是 `master`，而 `deploy.md` 的推送示例是 `git push -u origin main`——推送前先确认远程分支名，避免推到错误分支。
