# Frank's Notes

个人博客：**[https://frank-dev.site](https://frank-dev.site)**

分享 Java 后端、全栈开发与 AI 工程化的技术笔记，也记录一些思考与生活。

![Hexo](https://img.shields.io/badge/Hexo-8.1.2-0e83cd) ![Theme](https://img.shields.io/badge/主题-Oranges%20定制-fd8c2e) ![Deploy](https://img.shields.io/badge/部署-GitHub%20Actions-2088ff) ![License](https://img.shields.io/badge/License-MIT-green)

## 网站截图

### 首页 · 浅色模式

![首页（浅色）](docs/screenshots/home-light.png)

### 首页 · 深色模式

![首页（深色）](docs/screenshots/home-dark.png)

*深浅双主题一键切换，新配色沿对角线从左下角扫入。*

首页包含富简介区：姓名与职位、个人简介、技能标签、数据概览、工作与教育经历（自动按时间排序、机构 logo 展示）、项目经历（自动聚合）、常用链接。

### 项目经历页

![项目经历页](docs/screenshots/projects.png)

每个项目是一篇 Markdown 文章，卡片展示期间、角色、简介与技术栈，点击进入项目详情。

### 文章阅读

![文章详情页](docs/screenshots/article.png)

文章页带右侧目录（scrollspy 高亮）、代码高亮与一键复制、标签、上一篇/下一篇导航。

### 头像查看器

![头像查看器](docs/screenshots/avatar-viewer.png)

点击侧栏头像放大查看，支持导出图片，Esc / 点击背景关闭。

## 功能特性

- **内容体系**：博客文章与项目经历两类内容，各自独立目录与聚合页面，首页自动同步展示
- **深浅双主题**：一键切换，对角线扫入过渡动画（View Transitions API）
- **文章体验**：代码高亮 + 复制、目录导航与滚动高亮、锚点平滑滚动、上一篇/下一篇
- **首页动效**：内容错落入场、悬停微交互、跨页过渡（`prefers-reduced-motion` 自动降级）
- **本地搜索**：原生 `fetch` + `DOMParser` 实现的全文搜索
- **AI 阅读助手**：文章页悬浮入口 + 侧边聊天面板，提问时把文章全文发给 OpenAI 兼容接口（中转站），流式输出、多轮追问
- **RSS 订阅**：`hexo-generator-feed` 生成 `/atom.xml`
- **自动部署**：推送 `main` 分支即通过 GitHub Actions 构建并发布

## 技术栈

| 组件 | 说明 |
| --- | --- |
| [Hexo 8](https://hexo.io/) | 静态站点生成器 |
| [Oranges 主题](https://github.com/zchengsite/hexo-theme-oranges) | 本地化深度定制（MIT） |
| pnpm 11 | 包管理 |
| GitHub Actions + Pages | 构建与部署 |

## 目录结构

```
Frank.dev/
├── _config.yml               # 站点配置
├── _config.oranges.yml       # 主题配置（首页简介/经历/导航等数据源）
├── scaffolds/                # 写作脚手架：post / draft / project
├── docs/screenshots/         # README 截图
├── source/
│   ├── _posts/
│   │   ├── articles/         # 博客文章
│   │   └── projects/         # 项目经历（categories: 项目经历）
│   ├── about/                # 关于页
│   ├── projects/             # 项目经历列表页
│   ├── tags/                 # 标签页
│   └── images/               # 全站图片（头像/favicon/机构 logo）
├── themes/oranges/           # 定制主题
│   ├── layout/               # EJS 模板
│   ├── source/css|js|plugins # 样式、脚本、clipboard
│   └── languages/            # i18n（zh-CN / default）
└── .github/workflows/        # 自动部署
```

## 快速开始

```bash
pnpm install
pnpm server          # 本地预览 http://localhost:4000
pnpm build           # 生成静态文件至 public/
```

## 写作指南

**博客文章**：

```bash
pnpm exec hexo new post "文章标题"
# 把生成的文件移入 source/_posts/articles/
```

```yaml
---
title: 文章标题
date: 2026-08-16 10:00:00
categories: [教程]        # 随意
tags: [Hexo]
description: 一句话摘要
---
```

**项目经历**：

```bash
pnpm exec hexo new project "项目名称"
# 把生成的文件移入 source/_posts/projects/
```

```yaml
---
title: 项目名称
categories: [项目经历]     # 识别标记，勿改
period: 2024.10 - 2025.02  # 展示期间
role: 后端核心开发         # 担任角色
stack: [Spring Boot, Redis] # 技术栈标签
description: 一句话项目简介
---
```

正文为 Markdown，首页「项目经历」区块与 `/projects/` 页面会自动聚合更新，无需改任何配置。

## 主题定制要点

- 首页简介/经历/导航数据全部在 `_config.oranges.yml` 的 `intro` 与 `navbar` 块，改配置后需重启本地服务
- 动画统一定义在 `themes/oranges/source/css/base.css` 末尾「动效与细节」段
- 头像与 favicon 资源在 `source/images/favicon.png`，直接覆盖即换图
- 文章目录 `catalog`、代码复制 `codeBlock`、搜索 `search` 等功能均有独立开关

## AI 阅读助手配置

文章页右下角工具栏的 AI 入口，配置在 `_config.oranges.yml` 的 `aiChat` 块：

```yaml
aiChat:
  enable: true
  endpoint: ""            # OpenAI 兼容接口完整地址（中转站），留空则不渲染
  apiKey: ""              # 优先读环境变量 AI_CHAT_KEY
  model: "glm-4.7-flash"  # 按中转站可用模型填写
  stream: true            # 中转站不支持 SSE 透传时改 false
  maxContextTurns: 6      # 每次请求携带的最近对话轮数
```

**key 的注入方式（避免进公开仓库）**：GitHub 仓库 `Settings → Secrets and variables → Actions` 添加 `AI_CHAT_KEY`，`deploy.yml` 构建时会通过环境变量传给 Hexo；本地联调用 `AI_CHAT_KEY=sk-xxx pnpm server`。

**安全须知**：前端直连方案下，key 会出现在部署后的网页源码中（用户知情选择），任何访客都可能提取。务必在中转站侧为该 key 单独设置额度上限/限流，且不要使用与付费服务共用的 key。

## 部署

推送到 `main` 分支，GitHub Actions 自动构建并发布至 GitHub Pages（约 75 秒）：

```bash
git push origin main
```

## 许可

- 站点内容版权归 [Frank](https://github.com/RainbowJier) 所有
- 主题基于 [hexo-theme-oranges](https://github.com/zchengsite/hexo-theme-oranges)（MIT License）定制，见 `themes/oranges/LICENSE`
