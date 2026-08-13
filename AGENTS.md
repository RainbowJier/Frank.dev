# AGENTS.md

个人网站 Frank's Notes：个人主页 + 博客 + 作品集三合一的纯静态站点（学术 CV 风，砖橙主题）。

## 项目概况
- 纯静态：HTML + CSS + JavaScript，零框架、零构建、零依赖、无 package.json。
- 站点语言为中文（`<html lang="zh-CN">`），代码注释也用中文。
- 中英双语：`js/i18n.js` 字典 + `data-i18n` 属性；**英文缺 key 自动回退中文**（新内容只需写中文）。
- 布局：左侧固定砖橙侧边栏（220px）+ 白色内容区；移动端折叠为汉堡菜单。
- **无深色模式**（已移除 `prefers-color-scheme: dark`），始终亮色。
- 本地预览：`python -m http.server` 后访问 localhost:8000。
- 没有构建/测试/lint 命令；改完刷新浏览器验证。

## 目录结构
- `index.html` — 首页（Hero、关于、技能、经历、最新文章、精选作品）
- `blog.html` — 文章列表 + **分类筛选标签**（`.filter-bar` / `.filter-btn`，文章项带 `data-cat`）
- `posts/` — 文章页（hello-world、deploy-static-site、**TEMPLATE.html 模板**）
- `projects.html` — 作品集项目卡片
- `about.html` — 关于页
- `docs/写文章指南.md` — ★ 用户写文章的完整操作手册（新增文章先看它）
- `css/style.css` — 全站统一样式（`:root` CSS 变量，含 reveal 动画、link-more、filter-bar）
- `js/i18n.js` — 双语字典 + 切换逻辑（新文章字典加在结尾「★ 新文章字典从这里添加」处）
- `js/main.js` — 侧边栏菜单、返回顶部、滚动入场动画（IntersectionObserver）、分类筛选
- `assets/` — 图片等静态资源（`avatar.jpg` 头像）

## 新增博客文章（标准流程）
1. 复制 `posts/TEMPLATE.html` → `posts/<英文标识>.html`，全文替换 `<PREFIX>` 为标识
2. 正文元素保留 `data-i18n="<PREFIX>.p1|h2_1|li1|quote"` 编号约定
3. `js/i18n.js` 结尾「新文章字典区」补 zh（必写）+ en（可选）
4. `blog.html` 复制一条 `.post-item`（`data-cat` 分类 + 日期 + 链接）；新分类时加 `.filter-btn` + `cat.xxx` 键
5. 详见 `docs/写文章指南.md`

## 约定与注意事项
- 每个页面都是完整独立 HTML，侧边栏在每个文件里重复出现——改侧边栏/导航须同步全部 7 个页面（`posts/` 内用 `../` 相对路径）。
- 样式全走 `:root` CSS 变量，不写死颜色；主题色 `--accent: #bd5d38`（砖橙）。
- 交互：滚动入场动画（`.reveal`，JS 加 `.in`，`html.js` 门控，无 JS 时内容正常显示）、按钮按下缩放、`prefers-reduced-motion` 尊重。
- 页脚已隐藏（`display:none`），版权信息在侧边栏底部。

## 部署
- 主渠道：GitHub Pages，`git push origin main` 自动构建 → **https://frank-dev.site**（自定义域名，CNAME 文件在仓库根目录）。
- 备用：EdgeOne Pages（项目 pebble，预览令牌链接）。
- 本地分支为 `main`；SSH 走 443 端口（`~/.ssh/config` 配了 `ssh.github.com`），勿改。
- 推送后约 1 分钟生效；CDN 有缓存，验证时 URL 加 `?b=时间戳` 穿透，浏览器需强刷。
