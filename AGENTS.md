# AGENTS.md

个人网站 Frank's Notes：个人主页 + 博客 + 作品集三合一，基于 **Hexo** + **hexo-theme-pure** 主题，中英双语。

## 项目概况
- **框架**：Hexo 7（静态站点生成器）。源码是 Markdown/EJS，构建出纯静态 HTML 发布。
- **主题**：`hexo-theme-pure`（极简、亮/暗模式），以普通文件提交在 `themes/pure/`（已做 i18n 与首页定制补丁，**不是** submodule）。
- **双语**：双构建方案。中文在站点根 `/`（读 `source/`），英文在 `/en/`（读 `source_en/`）。头部有语言切换器（JS 把当前页映射到另一语言对应路径）。UI 文案走主题 `languages/*.yml`（Hexo `__()`）。
- 站点语言中文（`<html lang="zh-cn">`），英文构建为 `lang="en"`；代码注释用中文。
- 无深色偏好硬编码：主题自带亮/暗切换（按钮 + 跟随系统）。
- 本地预览：`npm install` 后 `npm run server`（中文）→ http://localhost:4000 。
- **没有 lint/测试命令**；改完用 `npm run build` 生成 `public/`，或 `npm run server` 预览，浏览器验证。

## 常用命令
```bash
npm install                # 装依赖（首次）
npm run server             # 本地预览（中文，hexo server）
npm run build              # 一次构建中英两套：public/ + public/en/
npm run build:zh           # 只构建中文 → public/
npm run build:en           # 只构建英文 → public/en/
npm run clean              # 清理 public/ 与 db.json
```
> ⚠️ 双构建共享 `db.json`，连续构建英文会串入中文资产。完整流程见 `package.json` 的 `build` 脚本：先中文，`rm db.json`，再英文。`npm run build` 已内置该顺序。

## 目录结构
```
Frank.dev/
├── _config.yml            # 站点基础配置（共享 + 中文默认）：theme/url/permalink/插件
├── _config.pure.yml       # ★ 主题配置覆盖（菜单 ID、关于页、社交、页脚）—— 主题配置真源
├── _config.zh.yml         # 中文构建覆盖（source/public/root/language）
├── _config.en.yml         # 英文构建覆盖（source_en/public/en//en//en）
├── package.json           # 依赖与脚本
├── scripts/reading-time.js# 站点脚本：计算文章阅读时长
├── .github/workflows/deploy.yml  # GitHub Actions：push main 自动双构建并发布
├── source/                # ★ 中文内容（输出到 public/ 根）
│   ├── _posts/            #   文章 Markdown
│   ├── _data/projects.yml #   作品集数据（含 zh/en 描述）
│   ├── about/ projects/ tags/ categories/ 404.md
│   ├── images/avatar.jpg  #   头像（兼 favicon）
│   └── CNAME              #   自定义域名 → 复制到 public/ 根
├── source_en/             # ★ 英文镜像（输出到 public/en/），结构与 source/ 对应
└── themes/pure/           # hexo-theme-pure 主题（已定制）
    ├── languages/zh-cn.yml, en.yml  # ★ 所有 UI 文案 + 首页 CV 内容
    ├── layout/
    │   ├── index.ejs      #   ★ 已替换为 CV 单页首页
    │   ├── projects.ejs   #   ★ 新增：作品集布局
    │   └── _partial/*.ejs #   已 i18n 化（__())；header.ejs 含语言切换器
    └── source/css/custom.css  # ★ CV 首页 / 作品集 / 语言切换样式
```

## 新增博客文章（标准流程）
1. 写中文：在 `source/_posts/` 新建 `<英文标识>.md`，带 front-matter（title/date/categories/tags/description）+ Markdown 正文。
2. 写英文（可选）：在 `source_en/_posts/` 建同名 `.md`（英文内容）。不写则英文站缺该篇（不会报错）。
3. 首页「最新文章」、`/archives/`、`/categories/`、`/tags/` 全部由 Hexo **自动生成**，无需手改列表。
4. 详见 `docs/写文章指南.md`。

## 双语约定（重要）
- **内容**（文章/页面正文）：中文写在 `source/`，英文写在 `source_en/`，两套独立 Markdown。
- **UI 文案 + 首页 CV 文本**：统一在 `themes/pure/languages/zh-cn.yml` 与 `en.yml`，模板用 `<%= __('key') %>` 取。新增/改文案**两个文件都要改**。
- **作品集数据**：`source/_data/projects.yml` 与 `source_en/_data/projects.yml` 内容**必须一致**（同一文件含 zh/en 两份描述，布局按 `config.language` 取）。
- 英文缺失不会崩：Hexo `__()` 找不到 key 会原样输出 key；文章则英文站直接少一篇。

## 主题定制（已做的补丁）
- `layout/index.ejs`：替换为 CV 单页（Hero/关于/技能/经历/最新文章/作品入口）。
- `layout/projects.ejs`：新增，读 `_data/projects.yml` 渲染卡片。
- `layout/_partial/header.ejs`：菜单 label 走 `__('menu.'+id)`、新增语言切换器。
- 其余 partial（footer/toc/search/share/outdated/comments/pagination/series/404 等）已把硬编码中文换成 `__()`。
- `source/js/main.js`：加了前端双语字典 `T`（按 `<html lang>` 切换）+ 语言切换 href 改写。
- `source/css/custom.css`：CV 与作品集样式，复用主题 CSS 变量（自动适配亮/暗）。
- 改主题模板/样式直接改 `themes/pure/` 下的文件即可（已纳入版本控制）。

## 部署
- **主渠道**：GitHub Actions（`.github/workflows/deploy.yml`）。push 到 `main` → 自动 `npm ci` + 双构建 → 发布 `public/` 到 GitHub Pages → **https://frank-dev.site**（自定义域名，`source/CNAME`）。
- 前提：仓库 **Settings → Pages → Source 必须选「GitHub Actions」**（不是分支根目录）。
- 备用：EdgeOne Pages（手动 `npm run build` 后上传 `public/`）。旧版「推 Gitee」纯静态方案已不适用（现在需先构建）。
- 本地分支：源码在 `main`；功能开发用 `feat/*` 分支，合并 `main` 触发部署。SSH 走 443（`~/.ssh/config` 配 `ssh.github.com`），勿改。
- 推送后约 1 分钟生效；CDN 有缓存，验证时 URL 加 `?b=时间戳` 穿透，浏览器强刷。

## 注意事项
- 旧版纯静态站点（index.html / blog.html / posts/*.html / css/ / js/ / i18n 字典）已删除，保留在 git 历史（迁移前最后提交）。回滚需 checkout 历史版本。
- 主题以普通文件提交：升级 pure 主题需手动 merge，注意保留上述定制补丁。
- 构建产物 `public/`、`node_modules/`、`db.json` 已在 `.gitignore`，勿提交。
