# AGENTS.md

个人网站 Frank's Notes：个人主页 + 博客 + 作品集三合一，基于 **Hexo**（标准安装）+ **hexo-theme-pure** 主题（官方原版，零修改），单语言中文站。

## 项目概况
- **框架**：Hexo 7（标准 `hexo init` 结构），源码是 Markdown/EJS，构建出纯静态 HTML。
- **主题**：`hexo-theme-pure`（Zcxx0322，极简、亮/暗模式），**官方原版、整个主题未做任何修改**，以普通文件提交在 `themes/pure/`。
- **单语言中文站**：无双语、无 /en/、无语言切换器。
- 深色模式：主题自带亮/暗切换（按钮 + 跟随系统）。
- 本地预览：`npm install` 后 `npm run server` → http://localhost:4000 。
- **没有 lint/测试命令**；改完用 `npm run build` 生成 `public/`，或 `npm run server` 预览，浏览器验证。

## 常用命令
```bash
npm install        # 装依赖（首次）
npm run server     # 本地预览 http://localhost:4000
npm run build      # 构建 → public/
npm run clean      # 清理 public/ 与 db.json
```

## 目录结构
```
Frank.dev/
├── _config.yml            # 站点配置（标准 hexo 结构）：title/url/permalink/theme/插件
├── _config.pure.yml       # ★ 主题配置覆盖（菜单、关于页、社交、页脚）—— 主题配置真源
├── package.json           # 依赖与脚本（hexo + 官方生成器 + search/feed）
├── scripts/reading-time.js# 站点脚本：计算文章阅读时长（文章页显示「X 分钟阅读」）
├── .github/workflows/deploy.yml  # GitHub Actions：push main 自动构建并发布
├── source/                # ★ 内容（Markdown）
│   ├── _posts/            #   文章
│   ├── about/ projects/ tags/ categories/ 404.md
│   ├── images/avatar.jpg  #   头像（兼 favicon）
│   └── CNAME              #   自定义域名 → 复制到 public/ 根
└── themes/pure/           # hexo-theme-pure 官方原版（零修改）
    ├── layout/            #   官方模板（index=文章列表、post/page/about/archive 等）
    ├── scripts/           #   官方功能脚本
    └── source/css|js      #   官方样式与交互
```

## 新增博客文章（标准流程）
1. 在 `source/_posts/` 新建 `<英文标识>.md`，带 front-matter（title/date/categories/tags/description）+ Markdown 正文。
2. 首页文章列表、`/archives/`、`/categories/`、`/tags/` 全部由 Hexo **自动生成**，无需手改列表。
3. 详见 `docs/写文章指南.md`。

## 主题说明
- `themes/pure/` 为官方原版（Zcxx0322/hexo-theme-pure），**未做任何修改**；站点级调整一律走 `_config.pure.yml`（菜单/关于/社交/页脚/功能开关）。
- 升级主题：`rm -rf themes/pure` 后重新 clone（`_config.pure.yml` 在站点根，不受影响）。

## 部署
- **主渠道**：GitHub Actions（`.github/workflows/deploy.yml`）。push 到 `main` → 自动 `npm ci` + `hexo generate` → 发布 `public/` 到 GitHub Pages → **https://frank-dev.site**（自定义域名，`source/CNAME`）。
- 前提：仓库 **Settings → Pages → Source 已选「GitHub Actions」**（已设置，勿改回）。
- 备用：EdgeOne Pages（手动 `npm run build` 后上传 `public/`）。
- 本地分支：源码在 `main`；功能开发用 `feat/*` 分支，合并 `main` 触发部署。SSH 走 443（`~/.ssh/config` 配 `ssh.github.com`），勿改。
- 推送后约 1 分钟生效；CDN 有缓存，验证时 URL 加 `?b=时间戳` 穿透，浏览器强刷。

## 注意事项
- 曾经历多轮重构（纯静态 → Hexo 双构建 → 主题定制 → 本次标准重装），全部历史保留在 git，回滚需 checkout 历史版本。
- 构建产物 `public/`、`node_modules/`、`db.json`、`_multiconfig.yml` 已在 `.gitignore`，勿提交。
