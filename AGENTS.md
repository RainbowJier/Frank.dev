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

- AI 阅读助手的 API key 明文写在 `_config.oranges.yml` 的 `aiChat.apiKey`——静态博客无后端，key 随页面源码公开是明确接受的取舍，不要改回环境变量/GitHub Secrets 注入方案。
- 推送 main 即触发 `.github/workflows/deploy.yml` 部署（Node 22 + pnpm 11.17.0 + `pnpm install --frozen-lockfile`）；依赖变化时务必一并提交 `pnpm-lock.yaml`。

## 提交信息

沿用 conventional commits + 中文描述，如 `docs(article): 新增 MongoDB 从零到一 03 CRUD 全解`、`feat(aichat): ...`、`chore(output): ...`。
