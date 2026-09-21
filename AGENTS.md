# AGENTS.md

Frank 的个人技术博客与作品集（https://frank-dev.site）：Hexo 8.1.2 静态站点 + 深度定制的 Oranges 主题（MIT），GitHub Actions 自动部署到 GitHub Pages。内容为中文技术文章与项目复盘，无测试/lint 体系，以内容与主题维护为主。

## 常用命令

- 包管理器固定为 pnpm 11.17.0（Node 22，与 CI 一致），不要用 npm/yarn 执行脚本。
- `pnpm install` 安装依赖；`pnpm server` 本地预览（http://localhost:4000，端口被占时 `pnpm exec hexo server -p 4321`）。
- `pnpm build` 生成到 public/；`pnpm clean` 清理 public/ 与 Hexo 缓存。
- 修改 `_config.yml` / `_config.oranges.yml` 后需重启 `pnpm server` 才生效。

## 目录结构与边界

- `source/_posts/articles/<专栏>/` — 博客文章；二级目录名即归档页"按分组"视图的专栏名。现有专栏：AI、Database、Elasticsearch、Java、MYSQL、MinIO、MongoDB、Oracle、RabbitMQ、Redis、RuoYi、Springboot、Vue、http-sse-websocket。
- `source/_posts/projects/` — 项目经历文章，front matter 必须含 `categories: [项目经历]`（首页与 /projects/ 聚合的识别标记，勿改），并使用 period/role/stack/description 字段；正文按"项目背景/我的职责/技术方案/成果"组织（见 `scaffolds/project.md`）。
- `themes/oranges/` — 本地化定制主题：`layout/`（EJS 模板）、`source/css/`、`source/js/`、`languages/`。
- `scaffolds/` — post/draft/page/project 写作脚手架；`scripts/skills.js` — 构建期扫描技能生成 /skills/ 页面。
- `public/` 与 `db.json` 是生成产物（已 gitignore），不要编辑或提交。
- 配置分两层：`_config.yml`（站点）与 `_config.oranges.yml`（主题：首页资料、导航、搜索、AI 助手等开关）。

## 写作约定

- 新文章：`pnpm exec hexo new post "标题"`，然后把文件移入对应专栏目录；front matter 含 title/date/categories/tags/description。
- 新增专栏目录时，同步在 `themes/oranges/layout/archive.ejs` 的 `groupDisplayNames`（第 12 行起）里加中文展示名。
- 文章配图放在与 .md 同名的资源目录（`post_asset_folder` 与 `marked.postAsset` 已开启），正文用相对文件名引用：`![图N：描述](<文章同名目录>/xxx.svg)`。
- 博客配图优先用工作区技能 `research-svg` 生成科研论文风格 SVG（Nature NPG 配色），存入文章资源目录。

## Skill-Hub

`scripts/skills.js` 按优先级扫描 `.agents/skills/<slug>/SKILL.md` → `source/skills/<slug>/SKILL.md`，同名只取第一份。SKILL.md front matter 至少要有 name 和 description；`source/skills/**` 在 `_config.yml` 中被 exclude，正文不会发布。`.agents/skills/` 是 ZCode 工作区技能目录（当前含 research-svg）。

## 已知取舍（勿"修复"）

- AI 阅读助手的 API key 不入仓库：`_config.oranges.yml` 的 `aiChat.apiKey` 留空，线上由 GitHub Secrets 的 `AI_CHAT_KEY` 在构建时注入；本地预览用 `AI_CHAT_KEY=sk-xxx pnpm server`。这是公开仓库 key 被扫盗刷事故（commit 97d824a）后的定案，不要再改回明文方案。
- 推送 main 即触发 `.github/workflows/deploy.yml` 部署（Node 22 + pnpm 11.17.0 + `pnpm install --frozen-lockfile`）；依赖变化时务必一并提交 `pnpm-lock.yaml`。

## spec-kit 开发流程

本项目用 GitHub spec-kit 管理功能性改动，设施在 `.specify/`（模板/脚本/宪章），技能在 `.agents/skills/speckit-*`（`scripts/skills.js` 已排除其发布到 Skill-Hub）。

**工作分两类，别走错道**：

- **日常写作**（新增/修改文章、配图）：不走 spec-kit，按上文"写作约定"直接操作，conventional commits 提交。
- **功能性改动**（主题模板/CSS/JS、构建脚本、新页面类型、配置结构调整、涉及多篇文章的批量重构）：走 spec-kit 流程。

**流程纪律（硬性）**：

1. 新 feature 先建目录：`bash .specify/scripts/bash/create-new-feature.sh "short-name"`（ASCII 名），会自动建分支与 `.specify/feature.json`。
2. 顺序不可跳：specify → plan → tasks → implement；每步产出（`specs/NNN-xxx/` 下的 spec.md / plan.md / tasks.md）落盘并经我确认后才进下一步。
3. 实现与 spec 冲突时以 spec 为准；需求变更先改 spec（经我确认）再改代码。
4. 一个任务一个原子提交，conventional commits 格式，正文引用任务编号。
5. 验收以 spec 的 Given/When/Then 为准：涉及页面效果的必须 `pnpm server` 本地跑通并截图/描述给我，涉及构建的必须 `pnpm build` 成功。
6. 推送 main 即触发线上部署——implement 完成后**先停下等我确认，禁止自行 push**。

**项目宪章**：`.specify/memory/constitution.md` 定义技术原则（与 AGENTS.md 冲突时以宪章为准）。

## 提交信息

沿用 conventional commits + 中文描述，如 `docs(article): 新增 MongoDB 从零到一 03 CRUD 全解`、`feat(aichat): ...`、`chore(output): ...`。
