# AGENTS.md

Frank 的个人技术博客与作品集（https://frank-dev.site）：Hexo 8.1.2 静态站点 + 深度定制的 Oranges 主题（MIT），GitHub Actions 自动部署。内容为中文技术文章与项目复盘。优先级：用户即时指令 > 本文件。

## 工作路由（每次会话先判断）

| 活的类型 | 走法 |
|---|---|
| **写作**：新增/修改文章、配图 | 按下文"写作约定"直接操作 |
| **功能改动**：主题模板/CSS/JS、构建脚本、新页面类型、配置结构调整、多篇文章批量重构 | 直接改，`pnpm build` 零错误 + `pnpm server` 确认后提交 |
| **小修**：改错字、修断链 | 直接改，注明范围提交 |

## 硬性红线（违反即返工）

1. **产物不入库**：`public/`、`db.json` 已 gitignore，不编辑不提交；仓库只放源文件。
2. **密钥不入仓库**：`aiChat.apiKey` 留空，线上由 GitHub Secrets 的 `AI_CHAT_KEY` 构建期注入；本地预览用 `AI_CHAT_KEY=sk-xxx pnpm server`。公开仓库 key 被扫盗刷事故（commit 97d824a）后定案，勿改回明文。
3. **先验证后推送**：push main 即触发线上部署（无 staging，main 就是生产）。推送前必须 `pnpm build` 零错误 + `pnpm server` 本地确认效果 + 用户点头。
4. **AI 禁止自行 push**：implement 或任何改动完成后停下等用户确认。
5. **已知取舍勿"修复"**：见上两条，它们是深思熟虑的结果，不是 bug。

## 常用命令

- 包管理器固定 pnpm 11.17.0（Node 22，与 CI 一致），不用 npm/yarn。
- `pnpm install` 装依赖；`pnpm server` 本地预览（http://localhost:4000，被占时 `pnpm exec hexo server -p 4321`）。
- `pnpm build` 生成到 public/；`pnpm clean` 清理产物与缓存。
- 改 `_config.yml` / `_config.oranges.yml` 后需重启 `pnpm server` 才生效。

## 目录结构与边界

- `source/_posts/articles/<专栏>/` — 博客文章；二级目录名即归档页"按分组"视图的专栏名。现有专栏：AI、Database、Elasticsearch、Java、MYSQL、MinIO、MongoDB、Oracle、RabbitMQ、Redis、RuoYi、Springboot、Vue、http-sse-websocket。
- `source/_posts/projects/` — 项目经历文章，front matter 必须含 `categories: [项目经历]`（首页与 /projects/ 聚合的识别标记，勿改），并使用 period/role/stack/description 字段；正文按"项目背景/我的职责/技术方案/成果"组织（见 `scaffolds/project.md`）。
- `themes/oranges/` — 本地化定制主题：`layout/`（EJS）、`source/css/`、`source/js/`、`languages/`。定制保持小而集中，提交信息说明动机；不盲目跟上游升级。
- `scaffolds/` — post/draft/page/project 写作脚手架；`scripts/` — 构建期脚本（skills.js 生成 /skills/ 页面）。
- 配置分两层：`_config.yml`（站点）与 `_config.oranges.yml`（主题：首页资料、导航、搜索、AI 助手等开关）。

## 写作约定

- 新文章：`pnpm exec hexo new post "标题"`，然后移入对应专栏目录；front matter 含 title/date/categories/tags/description。
- 新增专栏目录时，同步在 `themes/oranges/layout/archive.ejs` 的 `groupDisplayNames`（第 12 行起）加中文展示名。
- 配图放与 .md 同名的资源目录（`post_asset_folder` 与 `marked.postAsset` 已开启），正文相对引用：`![图N：描述](<文章同名目录>/xxx.svg)`。
- 配图优先用工作区技能 `research-svg` 生成科研论文风 SVG（Nature NPG 配色），存入文章资源目录。

## Skill-Hub

`scripts/skills.js` 按优先级扫描 `.agents/skills/<slug>/SKILL.md` → `source/skills/<slug>/SKILL.md`，同名取第一份；SKILL.md front matter 至少含 name 和 description。`source/skills/**` 已被 exclude，正文不发布。`.agents/skills/` 当前含 research-svg。

## 提交规范

conventional commits + 中文描述，所有工作通用。示例：`docs(article): 新增 MongoDB 从零到一 03 CRUD 全解`、`feat(aichat): ...`、`chore(output): ...`。依赖变化时务必一并提交 `pnpm-lock.yaml`。
