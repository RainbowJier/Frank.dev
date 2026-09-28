# AI 开发流程

**权威**：用户指令 > 宪章 > `AGENTS.md` > 本文。红线与写作约定见 `AGENTS.md`，不重复。

## 一、spec-kit 工作流程

核心思路：**先把「做什么」写成可验收的规格，再设计、拆任务、实现**。需求和实现分离，改需求先改 spec，不会边写边漂。

四步顺序不可跳，产出落盘到 `specs/NNN-短名/`，**每步经你确认才进下一步**。

### 在 agent 里怎么调用

| 工具 | 形式 |
|---|---|
| ZCode | `/speckit-specify` |
| Codex | `$speckit-specify` |

分隔符来自 `.specify/integration.json` 的 `invoke_separator`（本项目配 `-`，所以 Codex 用 `$speckit-specify` 而非 `$speckit.specify`）。

在对话框里输入命令 + 需求文字即可，**目录与文件由技能自动创建**，不用手敲 bash。

### 四步

| 步骤 | 命令 | 产出 | 要确认什么 |
|---|---|---|---|
| 1 写规格 | `/speckit-specify "需求描述"` | `specs/001-xxx/spec.md` | 用户故事分级（P1/P2/P3）、Given/When/Then 验收标准 |
| 2 设计 | `/speckit-plan` | `plan.md`，及 `research.md`、`data-model.md` 等 | 技术方案；与宪章冲突会报 ERROR |
| 3 拆任务 | `/speckit-tasks` | `tasks.md` | 任务粒度与依赖顺序（`[P]` 可并行） |
| 4 实现 | `/speckit-implement` | 代码改动 + 勾选任务 | 一个任务一个原子提交，正文引用任务编号 |

`plan.md` 的 **Constitution Check** 是宪章唯一变成硬门禁的地方：与六项原则冲突且未在「复杂度追踪」里给出理由，该步直接报错。

### 辅助（按需插入，不占主链）

| 命令 | 用途 | 时机 |
|---|---|---|
| `/speckit-clarify` | 就规格欠明确处提最多 5 个问题，答案回写 spec | specify 后、plan 前 |
| `/speckit-checklist` | 生成需求质量检查清单 | 任意 |
| `/speckit-analyze` | 跨 spec/plan/tasks 一致性分析 | tasks 后、implement 前 |
| `/speckit-converge` | 比对代码与 spec，把漏项追加为新任务 | implement 中途发现漏项 |

### 收尾

`pnpm build` 零错误 → `pnpm server` 确认效果 → 你点头 → 才 push。AI 不自行 push。

---

## 二、场景案例

### 场景 1：新增文章 — 不走 spec-kit

直接说「写一篇 MongoDB 副本集搭建，配 4 张图」。

流程：`hexo new post` 建骨架 → 移入专栏目录 → 写正文 → 用 `research-svg` 技能生成配图存入同名资源目录 → 正文相对引用 → `pnpm server` 预览 → 提交。**不建 spec 目录。**

判定：改的是 Markdown 与图片（数据），不碰模板与脚本。

### 场景 2：给主题加交互功能 — 完整走 spec-kit

```text
/speckit-specify "首页文章卡片加分类筛选标签"
```
→ 自动建 `specs/001-post-filter-tags/spec.md`，确认用户故事与验收标准

```text
/speckit-plan
```
→ 生成 `plan.md`（技术方案 + Constitution Check），确认方案

```text
/speckit-tasks
```
→ 生成 `tasks.md`，确认任务粒度与执行顺序

```text
/speckit-implement
```
→ 按任务实现，一个任务一个原子提交

```bash
pnpm build && pnpm server   # 收尾验证，然后停下等你确认
```

Codex 里把每条 `/speckit-xxx` 换成 `$speckit-xxx`。

判定：改 `themes/oranges/` 下的 EJS 模板与 CSS/JS，改变站点行为与结构。

### 场景 3：改错字、修断链 — 不走 spec-kit

直接说「RuoYi 那篇 07 有个错别字，链接也断了一条」。改完提交注明范围，例如 `docs(article): 修正 RuoYi 07 错别字与断链`。

判定：单点改动，不改变任何行为。

### 场景 4：批量重构多篇文章 — 走 spec-kit

命令与流程同场景 2。区别在 `/speckit-specify` 的需求文字里要写清**哪几篇、重构成什么结构、验收标准**。

判定：看着像写作，实际是「多篇文章批量重构」，会确立新的组织规范并影响后续同类文章。**这类最容易判错，代价也最大**——多篇正文加几十张配图的全量重写，返工成本远高于走流程。

### 场景 5：改构建期配置 — 走 spec-kit

命令与流程同场景 2。**验收必须含 `pnpm build`**：注入链路（如 `AI_CHAT_KEY`）断了只有构建期才暴露，`pnpm server` 未必发现得了。

判定：动的是构建期注入链路——配置 + `deploy.yml` + 本地预览方式。

### 拿不准时

1. 改的是**数据**还是**程序**？数据（Markdown/图片）直接改；程序（模板/脚本/配置）走流程。
2. 动**一处**还是**一批**？单点是修，成批是功能改动。
3. 只跑 `pnpm build` **够不够**？需要预览交互才能确认的，基本都是功能改动。

仍拿不准按功能改动走——流程多花的时间比返工少。

---

## 三、实测偏差

`AGENTS.md` 未提及或与实测不符之处：

1. **目录由技能自动创建，bash 脚本非必需。** `AGENTS.md` 把 `create-new-feature.sh` 列为第 1 步，实测 `/speckit-specify` 内部会自己 `mkdir` 并复制模板。脚本只是手动入口，好处是能用 `--dry-run` 预览目录名、用 `--short-name` 指定短名。
2. **该脚本不建 git 分支。** `AGENTS.md` 说「自动建分支」，实测全文无 `git checkout`，只在当前分支（通常 main）上建目录并写 `.specify/feature.json`。要独立分支得自己 `git checkout -b`。
3. **`specify` CLI 不在本机 PATH。** 入口只有 agent 命令或 bash 脚本。
4. **`.specify/workflows/speckit/workflow.yml` 是死配置。** 它声明的两道审核门依赖 spec-kit runner，CLI 不可用就跑不起来；实际靠 agent 依次调技能。其集成列表也不含本仓库配置的 codex（文件自注为 advisory hint，不算错误）。
5. **implement 可能提议改 `.gitignore`。** 它会按技术栈补 `.env*` 等模式——本仓库 `.gitignore` 精心维护且 `.zcodeignore` 由它同步，遇到提议需人工判断。
6. **spec-kit 从未实跑过。** `specs/` 当前不存在，全历史无此路径；流程步骤据技能定义与脚本源码核实。首次跑通后回填本节。
