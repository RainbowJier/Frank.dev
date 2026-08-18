## 已确认的调整
将原先单篇长文改为一套多篇 Markdown 教程，所有文章保存到：
`D:\Projects\Frank.dev\source\_posts\articles\MYSQL`

目标目录当前不存在，也没有发现已有 MySQL 文章，因此可以按系列新建，不会覆盖同主题旧稿。

## 文章拆分方案
按用户给出的目录结构拆分为 9 篇，保留所有条目，不删减、不合并：

1. `01-mysql-database-and-sql-basics.md`
   - 关系型数据库发展简史
   - MySQL 安装与基本配置（Linux/Docker/Windows）
   - DDL / DML / DQL / DCL
   - 库表创建与数据类型
   - 基础查询与用户订单案例

2. `02-mysql-advanced-sql.md`
   - 聚合函数与 GROUP BY/HAVING
   - 多表连接及历史动机
   - 子查询、EXISTS/NOT EXISTS 性能对比
   - 窗口函数与报表案例

3. `03-mysql-transactions-and-isolation.md`
   - 事务的起源与银行转账
   - ACID、undo log、redo log
   - 四种隔离级别及并发异常双会话实验
   - 显式事务、保存点

4. `04-mysql-case-sensitivity-and-naming.md`
   - 大小写敏感的历史原因与 `lower_case_table_names`
   - 库名、表名、列名、别名跨平台差异
   - 企业级命名规范和建模示例

5. `05-mysql-storage-engines.md`
   - MyISAM 到 InnoDB 默认引擎的演进
   - InnoDB/MyISAM 对比
   - Memory/CSV/Archive 场景
   - 引擎选择决策流程

6. `06-mysql-indexes-basics.md`
   - B-Tree 到 B+Tree 的演进
   - 聚簇/非聚簇、回表、覆盖索引
   - 最左匹配、索引失效、EXPLAIN
   - 索引创建删除与选择性建议

7. `07-mysql-million-data-optimization.md`
   - 百万数据性能挑战
   - 批量插入、`bulk_insert_buffer_size`、`LOAD DATA INFILE`
   - 分页优化、延迟关联、游标
   - 慢日志与 EXPLAIN
   - 分区表和分库分表前奏

8. `08-mysql-backup-and-recovery.md`
   - 物理/逻辑备份演进
   - `mysqldump` 全量恢复
   - binlog 增量与 PITR
   - XtraBackup 热备
   - 恢复演练与测试规范

9. `09-mysql-ecommerce-comprehensive-practice.md`
   - 电商订单系统核心表、索引、隔离级别
   - DDL 变更与 pt-osc/gh-ost
   - 读写分离和主从复制
   - 学习路线、优化器、锁、组复制

每篇文章均使用现有 Hexo 文章的 YAML Front Matter 风格，标题会标明系列序号和主题；日期统一使用当前日期 `2026-08-17`，分类使用“教程”，标签包含 `MySQL` 及对应主题标签。

## 内容与可运行性
- 全系列总字数目标不少于 8,000 字，并按主题合理分配篇幅。
- 全系列至少 20 个 ` ```sql` 可直接运行代码块；每个代码块带用途注释，后接执行结果或预期效果说明。
- 统一使用 `mysql_zero_to_one` 演示库，第一篇负责初始化用户、商品、订单、订单明细等基础表；后续文章在开头注明依赖并提供必要的补充数据脚本，避免示例脱离上下文。
- 双会话事务实验会明确标记“会话 A/会话 B”和执行顺序。
- 涉及操作系统、Docker、binlog、`LOAD DATA INFILE`、XtraBackup 的部分会注明版本、权限、路径和安全前提，避免把生产操作写成无条件命令。
- 每篇文章结尾固定包含：
  - “思考与练习”或“常见误区提醒”；
  - “本章核心总结”；
  - “下一步学习建议”。

## SVG 配图方案
根据 `research-svg` skill 的模板和约束，生成并保存到 `source/images/svg/`，再在对应文章中用 Markdown 引用。计划生成 6 张自包含静态 SVG：

1. `mysql-history-evolution.svg`：数据库模型与 MySQL 版本/生态演进时间线。
2. `mysql-sql-execution-flow.svg`：一条 SQL 从连接器、解析器、优化器到存储引擎的流程图。
3. `mysql-transaction-wal-flow.svg`：InnoDB 事务提交、Undo/Redo/Binlog 协作流程。
4. `mysql-bplus-tree-index.svg`：B+Tree、聚簇索引、二级索引与回表原理图。
5. `mysql-replication-and-recovery.svg`：主从复制与备份恢复数据流架构图。
6. `mysql-ecommerce-schema.svg`：综合电商订单系统核心表关系与访问路径示意图。

每张图遵守白色显式背景、`#D9DFE8` 边框、NPG 配色、中文字体栈、图注、无外部依赖和文本不溢出要求。每次生成后执行 XML 合法性校验，并在文章中提供形如：
`![图1：MySQL SQL 执行流程](/images/svg/mysql-sql-execution-flow.svg)` 的引用。

## 实施与校验步骤
1. 创建 `source/_posts/articles/MYSQL/` 目录及 9 篇 Markdown 文件。
2. 调用 `research-svg` skill，基于其模板生成 6 张配图，并写入 `source/images/svg/`。
3. 在各篇文章中插入配图引用，补全代码、表格、文字流程图和章节收束内容。
4. 用脚本统计 Markdown 文件数量、目录标题、`sql` 代码块数量和总字数。
5. 用 Python XML 解析器逐张验证 SVG 合法性，并检查是否存在外部资源引用。
6. 使用仓库可用的包管理/Hexo 生成命令做构建验证；若环境依赖或既有改动导致构建失败，原样报告失败原因，不修改无关文件。