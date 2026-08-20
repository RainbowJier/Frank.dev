---
name: feature-new
description: >-
  新功能设计与开发工作流，核心流程与技术栈无关。Use when the user asks for a new feature,
  requirements design, feature development, or says "新功能"、"需求设计"、"功能开发"、"fjgtkj-new".
  先探测项目规范、架构、工具链和影响范围，再经过需求评审、任务拆分、增量实现与验证。
  仅在目标项目确认存在时启用 DDD、Java/Spring、数据库、前端或其他技术 profile。
  本工作区部署附带 fjgtkj-2026 项目 profile（references/profiles/fjgtkj-2026.md），
  提供项目术语映射；其他项目删除该 profiles 目录即为纯通用版。
version: 3.3.0
---

# 通用新功能工作流 — 路由器

这是项目结构感知的通用工作流，不预设语言、框架、目录、数据库或构建工具。先加载项目事实，再按需加载阶段片段和 profile 参考。

## 路由协议

### 1. 加载 manifest 与核心立场

读取 [manifest.yaml](manifest.yaml) 和 `static/core/stance.md`。核心立场规定项目探测、规范优先级、工具降级、确认关卡、任务状态和验证闭环。

### 2. 解析输入

| 参数 | 来源 | 说明 |
|------|------|------|
| `$ARGUMENTS` | 触发命令 | 需求描述文本 |
| `$DOC_PATH` | 触发命令或用户确认 | 设计文档输出目录；未提供时根据项目习惯提议，不擅自选择已有目录 |
| `$DISPLAY_NAME` | 需求描述 | 功能的业务显示名称 |
| `$FILE_SLUG` | 从显示名称生成并确认 | 安全的 lowercase kebab-case 文件名，不含路径分隔符 |
| `$TASK_PREFIX` | 从 slug 生成 | 稳定的 ASCII 任务 ID 前缀 |
| `$AUTO_MODE` | 从 `$ARGUMENTS` 解析 `--auto` 或 `-y` | 缺省 `false`。`true` 时阶段一、二确认关卡改为自检放行，规则见 `static/core/stance.md`「确认关卡与自动模式」 |

如果目标范围、输出位置、功能边界或高风险约束不明确，先询问用户；不要因缺少技术信息而套用默认架构。`$AUTO_MODE=true` 只改变确认关卡行为，不豁免高风险项——它们保持 `blocked`（见核心立场）。

### 命名规则（唯一定义处，其余文件引用此处）

1. `$DISPLAY_NAME`：业务显示名，可含中文。
2. `$FILE_SLUG`：由显示名生成的 lowercase kebab-case，仅 `[a-z0-9-]`，不含路径分隔符，需用户确认。
3. `$TASK_PREFIX` = `$FILE_SLUG`。
4. 任务文件名 = `{NN}_{type}_{short-slug}.md`：`NN` 为两位依赖拓扑序号；`type` 为任务类型之一（见任务拆分片段）；`short-slug` 为 kebab-case。
5. 任务 ID = `{$TASK_PREFIX}_{NN}_{type}_{short_slug}`：即文件名去扩展名、加前缀，连字符替换为下划线。
6. 示例：显示名“数据导出” → slug `data-export` → 文件 `03_migration_add-record.md` → ID `data-export_03_migration_add_record`。

**通用产物约定**：

| 路径 | 内容 |
|------|------|
| `$DOC_PATH/$FILE_SLUG.html` | 可选的单文件设计文档；纯文档项目可改为 Markdown |
| `$DOC_PATH/tasks/*.md` | 按依赖排序的任务文件 |
| `$DOC_PATH/schema/` 或项目既有迁移目录 | 仅在检测到数据库和迁移机制时生成对应脚本 |

### 3. 探测项目并选择 profile

先读取项目规范、README、构建清单、CI 配置和相邻实现，确认适用 profile：

- `architecture`：DDD、分层、MVC、六边形、模块化单体或项目自定义边界。
- `backend`：Java/Spring、Python、Go、Node、.NET 等后端模式。
- `frontend`：React、Vue、Angular、Svelte 或其他 UI/状态/路由模式。
- `database`：数据库类型、迁移工具、表/模型/索引规范；未知方言时不生成可执行 DDL。
- `api`：REST、GraphQL、RPC、事件或内部契约。
- `integration`：HTTP、消息队列、第三方 SDK、AI/数据处理等外部依赖。
- `testing`：项目实际的 lint、unit、integration、e2e、build 或 CI 命令。

只启用已由项目事实证实的 profile；没有 UI、数据库或远程依赖时不创建对应任务。

### 4. 按阶段加载片段

| 阶段 | 文件 | 需要确认 |
|------|------|----------|
| 一：需求分析与设计 | `static/fragments/analysis.md` | 是 |
| 二：任务拆分 | `static/fragments/task-decomposition.md` | 是 |
| 三：增量开发与验证 | `static/fragments/development.md` | 否 |
| 特殊场景：已有字段/Schema 变更 | `static/fragments/field-add.md` | 条件确认 |

阶段一、二结束后默认暂停等待用户确认；`$AUTO_MODE=true` 时按核心立场「确认关卡与自动模式」自检放行。缺少项目规范、关键调用链、迁移依据或验证命令时，记录限制并将受影响任务标记为 `blocked`；不得虚报完成。

### 5. 按需加载参考

| 场景 | 文件 |
|------|------|
| 项目探测命中本工作区，需要项目术语映射 | `references/profiles/fjgtkj-2026.md` |
| 编写设计文档 | `references/templates/design-doc.html` |
| 数据库或 Schema 变更 | `references/templates/sql.md` |
| 拆分任务 | `references/templates/task.md` |
| 需要架构/实现示例 | `references/code-conventions.md` |

参考文件中的具体技术示例只有在对应 profile 已确认后才可使用。项目 profile 是项目文档的索引与翻译层，与项目文档冲突时以后者为准。
