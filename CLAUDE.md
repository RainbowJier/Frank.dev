# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概览

Frank 的个人技术博客与作品集（https://frank-dev.site）：Hexo 8.1.2 静态站点 + 深度本地化定制的 Oranges 主题（MIT），推送 main 由 GitHub Actions 构建并发布到 GitHub Pages。内容为中文技术文章与项目复盘。

**权威工作规则在 [AGENTS.md](AGENTS.md)**：工作路由（写作 / 功能改动 / 小修）、硬性红线（产物不入库、密钥不入仓库、push 前必须 `pnpm build` 零错误 + 本地确认、AI 禁止自行 push）、写作与提交规范。本文件只补充跨文件架构，不重复其内容。

## 常用命令

```bash
pnpm install          # Node 22 + pnpm 11.17.0（packageManager 固定；CI 用 --frozen-lockfile）
pnpm server           # 本地预览 http://localhost:4000（被占时 pnpm exec hexo server -p 4321）
pnpm build            # 生成静态站点到 public/（验证标准：零错误）
pnpm clean            # 清理 public/ 与 Hexo 缓存

pnpm exec hexo new post "标题"     # 新文章，生成后移入 source/_posts/articles/<专栏>/
pnpm exec hexo new project "名称"  # 新项目文章，移入 source/_posts/projects/

AI_CHAT_KEY=sk-xxx pnpm server    # 本地预览 AI 阅读助手时注入 key
```

本仓库无测试与 lint；功能改动的验证方式是 `pnpm build` 零错误 + `pnpm server` 目检。改 `_config.yml` / `_config.oranges.yml` 后需重启 `pnpm server` 才生效。

## 架构

### 构建管线与自定义 generator

- Hexo 构建时自动加载仓库根 `scripts/*.js` 作为扩展。`scripts/skills.js` 注册名为 `skills` 的 generator：构建期按优先级扫描 `.agents/skills/<slug>/SKILL.md` → `source/skills/<slug>/SKILL.md`（同名取第一份），读 front matter 的 `name`/`description` 生成 `/skills/` 索引页；详情页渲染的是同目录 `README.md`，`SKILL.md` 正文不发布（`_config.yml` 中 `exclude: skills/**`）。
- 文章资源：`post_asset_folder` + `marked.postAsset` 开启，与文章同名的资源目录发布到文章 URL 下，正文用相对路径引用配图。

### 双层配置

- `_config.yml`：站点级（URL、permalink、生成器、exclude）。
- `_config.oranges.yml`：主题级，覆盖 `themes/oranges/_config.yml` 的默认值——首页资料 `intro`、导航 `navbar`、搜索、AI 助手 `aiChat` 等开关都在这里。
- 主题模板内分别以 `config.*` / `theme.*` 读取两级配置。

### 主题结构（themes/oranges/，本地定制不跟上游升级）

- `layout/layout.ejs` 是 HTML 外壳：header / navigation / footer partial + `<%- body %>`（页面级模板渲染进来）+ 右下角工具条 partial（backtotop / search / aichat / colorscheme / shares）。
- 页面级模板：`index / post / archive / tag / category / todo / skills / skill.ejs`；可复用组件在 `layout/_partial/`。
- JS 无打包、无依赖：`source/js/` 一个交互一个原生 JS 文件，由对应模板或 partial 用 hexo `js()` 助手按需引入（如 `todo.ejs` → todo.js，`_partial/aichat.ejs` → aichat.js，`index.ejs` → postCalendar.js 首页发布热力图）。
- CSS 入口 `source/css/main.css`（由 `main.styl` 经 hexo-renderer-stylus 编译）+ color-scheme.css；深浅色由 colorscheme.js 切换（View Transitions，不支持或 `prefers-reduced-motion` 时降级）。
- `archive.ejs` 中的 `groupDisplayNames` 维护「专栏目录名 → 中文展示名」映射，新增专栏目录时要同步维护。

### 内容聚合约定（无手工列表配置）

- 项目文章识别：front matter `categories: [项目经历]`（勿改）；首页「项目经历」区块与 `/projects/` 页直接读 `period / role / stack / description` 字段聚合。
- 归档页「按分组」视图：分组依据 = `source/_posts/articles/` 下的二级目录名。

### 特殊页面

- `/todo/`（`source/todo/index.md` + `layout/todo.ejs` + `todo.js`）：纯前端本地待办。数据层双层结构：localStorage 镜像（key `todo-items`，永远写入）+ 可选 File System Access API 关联磁盘 `todo.json`（文件句柄存 IndexedDB，重启后按 `updatedAt` 整表对账）。
- AI 阅读助手（`_partial/aichat.ejs` + `aichat.js`）：仅文章详情页渲染，SSE 流式。`aiChat.apiKey` 留空，构建期从环境变量 `AI_CHAT_KEY` 注入（CI 读 GitHub Secret）；前端直连、key 随页面源码公开是明确接受的取舍，勿改回仓库明文。

### 部署

push main（或手动 workflow_dispatch）→ `.github/workflows/deploy.yml`：Node 22 + pnpm 11.17.0 + `pnpm install --frozen-lockfile` → `hexo generate`（此时注入 `AI_CHAT_KEY`）→ 上传 `public/` 到 GitHub Pages。main 即生产，无 staging。

### specs/

`specs/<编号-功能名>/`（`spec.md` + `checklists/`）是较大功能的需求与验收规格目录，不参与构建。
