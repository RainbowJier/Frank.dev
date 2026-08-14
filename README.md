# Frank's Notes · 个人网站

个人主页 + 博客 + 作品集三合一，基于 **Hexo** + **hexo-theme-pure**（官方原版）。

- **技术**：Hexo 7 + hexo-theme-pure（极简、亮/暗模式，官方原版照搬）
- **双语**：双构建——中文 `/`、英文 `/en/`（内容双语；UI 为中文，无切换按钮，英文站直接访问 `/en/`）
- **部署**：GitHub Actions 自动构建发布 → **https://frank-dev.site**（见 [deploy.md](deploy.md)）

## 目录结构

```
Frank.dev/
├── _config.yml / _config.pure.yml   # 站点配置 / 主题配置
├── _config.zh.yml / _config.en.yml  # 中英双构建覆盖
├── source/          # 中文内容（文章 / 页面 / 头像 / CNAME）
├── source_en/       # 英文镜像
├── themes/pure/     # hexo-theme-pure 官方原版（照搬，无定制）
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

push 到 `main` → GitHub Actions 自动双构建并发布（Pages Source 已设为 GitHub Actions）。详见 [deploy.md](deploy.md)。

## 自定义

- 主题为官方原版：站点级调整全部走 `_config.pure.yml`（菜单/关于/社交/页脚/功能开关），**不要改 `themes/pure/` 里的文件**。
- 亮/暗配色走主题 `themes/pure/source/css/main.css` 的 `:root` 变量（如需要）。
