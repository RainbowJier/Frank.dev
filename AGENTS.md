# AGENTS.md

个人网站 Frank's Notes：个人主页 + 博客 + 作品集三合一，基于 **Hexo** + **hexo-theme-pure** 主题（官方原版照搬），中英双语（内容层）。

## 项目概况
- **框架**：Hexo 7（静态站点生成器）。源码是 Markdown/EJS，构建出纯静态 HTML 发布。
- **主题**：`hexo-theme-pure`（极简、亮/暗模式），**官方原版照搬、无任何定制**，以普通文件提交在 `themes/pure/`（**不是** submodule）。
- **双语**：双构建方案。中文在站点根 `/`（读 `source/`），英文在 `/en/`（读 `source_en/`）。**仅内容双语**——原版主题无 i18n（菜单/搜索/页脚等 UI 硬编码中文），英文站的 UI 同样为中文；**没有语言切换器**，英文站直接访问 `/en/` 路径。
- 站点语言中文（`<html lang="zh-cn">`），英文构建为 `lang="en"`；代码注释用中文。
- 深色模式：主题自带亮/暗切换（按钮 + 跟随系统）。
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
├── _config.pure.yml       # ★ 主题配置覆盖（菜单、关于页、社交、页脚）—— 主题配置真源
├── _config.zh.yml         # 中文构建覆盖（source/public/root/language）
├── _config.en.yml         # 英文构建覆盖（source_en/public/en//en//en）
├── package.json           # 依赖与脚本
├── scripts/reading-time.js# 站点脚本：计算文章阅读时长（文章页显示「X 分钟阅读」）
├── .github/workflows/deploy.yml  # GitHub Actions：push main 自动双构建并发布
├── source/                # ★ 中文内容（输出到 public/ 根）
│   ├── _posts/            #   文章 Markdown
│   ├── about/ projects/ tags/ categories/ 404.md
│   ├── images/avatar.jpg  #   头像（兼 favicon）
│   └── CNAME              #   自定义域名 → 复制到 public/ 根
├── source_en/             # ★ 英文镜像（输出到 public/en/），结构与 source/ 对应
└── themes/pure/           # hexo-theme-pure 官方原版（照搬，无定制）
    ├── layout/            #   官方模板（index=文章列表、post/page/about/archive 等）
    ├── scripts/           #   官方功能脚本（admonition/series/outdated）
    └── source/css|js      #   官方样式与交互
```

## 新增博客文章（标准流程）
1. 写中文：在 `source/_posts/` 新建 `<英文标识>.md`，带 front-matter（title/date/categories/tags/description）+ Markdown 正文。
2. 写英文（可选）：在 `source_en/_posts/` 建同名 `.md`（英文内容）。不写则英文站缺该篇（不会报错）。
3. 首页文章列表、`/archives/`、`/categories/`、`/tags/` 全部由 Hexo **自动生成**，无需手改列表。
4. 详见 `docs/写文章指南.md`。

## 双语约定（重要）
- **内容**（文章/页面正文）：中文写在 `source/`，英文写在 `source_en/`，两套独立 Markdown（作品集页 `projects/index.md` 同）。
- **UI 文案**：原版主题硬编码中文，**不支持也不修改**（英文站 UI 为中文，属预期）。
- **关于页资料**：`_config.pure.yml` 的 `about` 块（头像/名称/简介/链接）为共享配置，中英站一致；页内正文各自 Markdown。
- 英文缺失不会崩：英文站只是少一篇/一段。

## 主题说明
- `themes/pure/` 为官方原版（Zcxx0322/hexo-theme-pure），**未做任何定制**；站点级调整一律走 `_config.pure.yml`（菜单/关于/社交/页脚/功能开关）。
- 升级主题：`rm -rf themes/pure` 后重新 clone（注意先备份 `_config.pure.yml` 在站点根，不受影响）。

## 部署
- **主渠道**：GitHub Actions（`.github/workflows/deploy.yml`）。push 到 `main` → 自动 `npm ci` + 双构建 → 发布 `public/` 到 GitHub Pages → **https://frank-dev.site**（自定义域名，`source/CNAME`）。
- 前提：仓库 **Settings → Pages → Source 已选「GitHub Actions」**（2026-08-14 已设置，勿改回）。
- 备用：EdgeOne Pages（手动 `npm run build` 后上传 `public/`）。
- 本地分支：源码在 `main`；功能开发用 `feat/*` 分支，合并 `main` 触发部署。SSH 走 443（`~/.ssh/config` 配 `ssh.github.com`），勿改。
- 推送后约 1 分钟生效；CDN 有缓存，验证时 URL 加 `?b=时间戳` 穿透，浏览器强刷。

## 注意事项
- 曾有两版主题方案（定制版 pure：i18n/CV 首页/语言切换器；hexo-theme-oranges 未实施），均已回退/废弃，保留在 git 历史。回滚需 checkout 历史版本。
- 旧版纯静态站点（index.html / blog.html / posts/*.html / css/ / js/ / i18n 字典）已删除，保留在 git 历史（迁移前最后提交）。回滚需 checkout 历史版本。
- 构建产物 `public/`、`node_modules/`、`db.json`、`_multiconfig.yml` 已在 `.gitignore`，勿提交。
