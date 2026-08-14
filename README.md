# Frank's Notes · 个人网站

个人主页 + 博客 + 作品集三合一，基于 **Hexo** + **hexo-theme-pure**，中英双语。

- **技术**：Hexo 7 + hexo-theme-pure（极简、亮/暗模式）
- **双语**：双构建——中文 `/`、英文 `/en/`，头部一键切换
- **部署**：GitHub Actions 自动构建发布 → **https://frank-dev.site**（见 [deploy.md](deploy.md)）

## 目录结构

```
Frank.dev/
├── _config.yml / _config.pure.yml   # 站点配置 / 主题配置
├── _config.zh.yml / _config.en.yml  # 中英双构建覆盖
├── source/          # 中文内容（文章 / 页面 / 作品数据 / CNAME）
├── source_en/       # 英文镜像
├── themes/pure/     # 主题（已 i18n + CV 首页定制）
│   ├── languages/   # 中英文案（UI + 首页 CV）
│   └── layout/      # index.ejs(CV首页) projects.ejs 等
├── scripts/         # 阅读时长等站点脚本
└── .github/workflows/deploy.yml  # GitHub Actions 部署
```

## 快速开始

```bash
npm install        # 装依赖
npm run server     # 本地预览 http://localhost:4000
npm run build      # 构建中英两套到 public/
```

## 写文章

在 `source/_posts/` 新建 Markdown（front-matter + 正文），英文版放 `source_en/_posts/` 同名文件。首页、归档、分类、标签、搜索、RSS 全部自动生成。详见 [`docs/写文章指南.md`](docs/写文章指南.md)。

## 部署

push 到 `main` → GitHub Actions 自动双构建并发布。前提：仓库 Settings → Pages → Source 选「GitHub Actions」。详见 [deploy.md](deploy.md)。

## 自定义

- 主题配色走 `themes/pure/source/css/main.css` 的 `:root` 变量（亮/暗两套 token）。
- CV 首页 / 作品集额外样式在 `themes/pure/source/css/custom.css`。
- UI 文案与首页 CV 文本在 `themes/pure/languages/zh-cn.yml` 与 `en.yml`（两个都要改）。
