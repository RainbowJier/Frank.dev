# my-site · 个人网站

个人主页 + 博客 + 作品集三合一的纯静态网站。

- **技术**：HTML + CSS + JavaScript，零框架、零构建、零依赖
- **部署**：EdgeOne Pages（免费、国内访问快、无需备案）→ 见 [deploy.md](deploy.md)
- **预览**：直接双击 `index.html` 即可在浏览器打开

## 目录结构

```
Frank.dev/             # 项目根目录
├── index.html          # 个人主页/简历：关于我、技能、经历
├── blog.html           # 博客文章列表
├── posts/              # 博客文章（hello-world、deploy-static-site）
├── projects.html       # 作品集：项目卡片
├── css/style.css       # 全站统一样式（响应式、深浅色自适应）
├── js/main.js          # 移动端菜单、返回顶部等交互
├── assets/             # 图片等静态资源（自行放入）
├── deploy.md           # ★ 部署步骤：EdgeOne Pages 图文指南
└── README.md           # 本文件
```

## 快速开始

1. **本地预览**：双击 `index.html`，或运行 `python -m http.server` 后访问 `http://localhost:8000`。
2. **改成你的信息**：
   - `index.html`：姓名、副标题、介绍、技能、经历时间线
   - `projects.html`：项目卡片
   - `blog.html` + `posts/`：博客文章
3. **发布上线**：按 [deploy.md](deploy.md) 操作，上传文件夹或推送到 Gitee 即可获得在线网址。

## 自定义样式

- 颜色、圆角、阴影等都在 `css/style.css` 顶部的 `:root` 变量中定义，改一处全局生效
- 深色模式自动跟随系统（`prefers-color-scheme`），无需手动切换
