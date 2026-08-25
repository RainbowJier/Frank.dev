---
title: Elasticsearch 从零到一（07）：MySQL 数据同步、幂等与一致性设计
date: 2026-08-25 10:40:00
categories:
  - 教程
tags:
  - Elasticsearch
  - MySQL
  - 数据同步
  - CDC
  - 分布式系统
description: 面向 Java 开发者设计 MySQL 到 Elasticsearch 的读模型同步，比较双写、消息队列、Binlog CDC 与定时同步，并处理幂等、删除、重试、对账、重建和最终一致性。
keywords:
  - MySQL Elasticsearch 同步
  - Elasticsearch 幂等
  - Binlog CDC
  - Elasticsearch 索引重建
  - 最终一致性
lang: zh-CN
---
> **适合人群**：准备让 MySQL 业务数据进入 Elasticsearch，且希望在失败、重复、乱序、删除和索引变更时仍能解释系统行为的 Java 开发者。
> 结论先行：MySQL 是业务事实来源（source of truth），Elasticsearch 是面向搜索和分析的读模型。同步目标不是“每一毫秒都相同”，而是在可观测的延迟内可恢复地趋于一致。
前两篇分别完成了 {% post_link articles/Elasticsearch/05-elasticsearch-aggregations-pagination '聚合、筛选面板与深分页方案' %} 和 {% post_link articles/Elasticsearch/06-elasticsearch-java-client-springboot 'Spring Boot 与官方 Java API Client 实战' %}。 真正进入生产后，最危险的问题往往不在查询语句，而在“数据库已提交，为什么 ES 没有”“消息重放后为什么重复”“删除的文章为何仍能搜到”。
## 一、先建立事实来源与读模型边界
假设后台编辑一篇文章，事务最终写入 `article`、`article_tag` 与可能的作者、分类表。 MySQL 的事务、约束与行锁负责业务正确性；`blog_articles` 是为全文搜索、聚合和排序准备的反规范化文档。
```text
MySQL article / tag / category（事实来源）
                │ 业务变更事件或 Binlog
                ▼
同步消费者 / 投影器（组装全文检索文档）
                ▼
Elasticsearch blog_articles（可重建读模型）
```
![图1：MySQL 事实表、事件管道、投影器与 Elasticsearch 读模型的同步链路](mysql-es-sync-pipeline.svg)
因此要接受两条原则：
1. 用户刚发布文章后，短时间内搜索不到，通常是异步投影延迟，不一定是数据丢失。
2. 订单状态、权限、库存等强一致判断必须回 MySQL 或权威服务，不能因为 ES 返回了旧文档就做业务决策。
可以在搜索 API 响应中暴露索引版本、事件时间或同步水位，帮助客服与监控区分“正常延迟”和“链路故障”。
## 二、四种同步方案的能力与缺口
### 2.1 应用层双写：最简单，也最容易出现中间态
应用提交 MySQL 后再调用 ES：
```java
@Transactional
public void publishArticle(PublishArticleCommand command) {
    Article article = articleRepository.save(command.toEntity());
    // 事务提交之前或之后直接写 ES 都有失败窗口。
    searchIndexer.index(article);
}
```
先写 MySQL：ES 写失败则数据库已成功；先写 ES：数据库失败则搜索出现幽灵文档。 把 ES 调用塞进同一个 Spring `@Transactional` 并不能让它拥有数据库两阶段提交语义。
双写只适合低风险、可人工补偿的小系统，且至少应配合 outbox、重试和对账；不要把“失败后打印日志”当作可靠同步方案。
### 2.2 事务 Outbox + MQ：业务系统常用的平衡方案
在同一 MySQL 事务中写入业务数据和 `outbox_event`：
```sql
CREATE TABLE outbox_event (
  event_id BIGINT PRIMARY KEY,
  aggregate_type VARCHAR(64) NOT NULL,
  aggregate_id BIGINT NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  payload JSON NOT NULL,
  occurred_at DATETIME(3) NOT NULL,
  published_at DATETIME(3) NULL
);
```
事务提交后，发布器可靠地把 outbox 记录投递到 Kafka、RocketMQ 或其他 MQ；消费者按事件更新 ES。 这样“业务数据存在但事件根本没有落库”的窗口被消除，但仍须接受至少一次投递：发布器、MQ 或消费者重试都可能制造重复消息。
优点是领域事件明确、可按业务聚合投影；缺点是需要维护 outbox 清理、投递确认、消费者积压与多表变更的事件定义。
### 2.3 Binlog CDC：从已提交变更捕获事实
Canal、Debezium 等 CDC 工具消费 MySQL Binlog，将已提交的 INSERT、UPDATE、DELETE 变更输出到消息系统或消费者。 它不要求每个业务方法手写同步事件，适合存量系统、多服务共用数据或希望以数据库提交为准的场景。
CDC 不是免设计：消费者仍需要把多张表变更组装成一份 `blog_articles` 文档，处理 DDL、schema 演进、Binlog 保留窗口、位点恢复和同一业务变更的顺序。 特别是 `article_tag` 变化时，消费者通常要按 article ID 回查或维护局部状态，再重新投影整篇文章。
### 2.4 定时同步：补偿工具而不是唯一实时通道
定时任务按 `updated_at` 和主键扫描 MySQL，再批量 upsert 到 ES，部署简单、适合低实时要求。 但仅用 `WHERE updated_at > ?` 会在相同时间戳、时钟精度、任务中断或删除场景中漏数据。
安全的扫描游标至少是 `(updated_at, id)`，使用稳定排序与重叠窗口；删除还需软删除字段、删除日志表或独立 tombstone 来源。 定时任务适合作为全量初始化、凌晨校正或 CDC/MQ 的兜底补偿，而不是高频搜索的唯一同步手段。
| 方案 | 延迟 | 主要优点 | 关键风险 |
| --- | --- | --- | --- |
| 应用双写 | 低 | 代码直观 | 数据库和 ES 之间有不可消除的失败窗口 |
| Outbox + MQ | 低到中 | 事务内记录意图，可异步扩展 | 至少一次、积压与消费者幂等 |
| Binlog CDC | 低到中 | 基于已提交事实，侵入业务低 | 事件组装、位点与表结构演进 |
| 定时扫描 | 分钟级 | 易部署，适合补偿 | 延迟、漏扫、删除处理复杂 |
## 三、投影设计：用业务主键、版本和完整文档换取幂等
### 3.1 `_id` 对齐业务主键
推荐使用 `article.id` 作为 ES `_id`：
```http
PUT /blog_articles/_doc/201
{
  "id": 201,
  "title": "Spring Boot 配置绑定实践",
  "category": "Spring Boot",
  "tags": ["配置", "Java"],
  "status": "PUBLISHED",
  "updatedAt": "2026-08-25T10:00:00Z"
}
```
相同 `_id` 的 `index` 请求会覆盖同一文档，而不是追加一条副本。 这解决“同一事件被重复消费”的第一层问题，也让删除、排查、回放和重建有稳定锚点。
不要把数据库自增 ID 和随机 ES ID 混用；否则消费者重试会产生多份搜索文档，聚合计数也会失真。
### 3.2 事件至少携带可比较的版本
仅凭“最后到达的消息覆盖前一条”无法应对乱序。 例如更新事件版本 12 延迟到达，而删除事件版本 13 已经处理；若版本 12 之后覆盖，会复活已删文章。
为每个聚合维护单调递增的 `version`，或使用数据库提交位点/明确的业务版本作为外部版本：
```java
public void index(ArticleProjection projection) throws IOException {
    client.index(request -> request
        .index("blog_articles_write")
        .id(projection.id().toString())
        .document(projection)
        .version(projection.version())
        .versionType(VersionType.ExternalGte)
    );
}
```
`external_gte` 允许相同版本的重放成功，并拒绝更旧版本覆盖新版本。 版本必须来自可信且单调的源；不能用消费者本机 `System.currentTimeMillis()` 伪造版本，也不要在不同聚合之间比较无关的版本号。
### 3.3 删除也必须是有版本的事件
硬删除时要投递带 `id` 与 `version` 的 DELETE 事件：
```java
public void delete(long articleId, long version) throws IOException {
    client.delete(request -> request
        .index("blog_articles_write")
        .id(Long.toString(articleId))
        .version(version)
        .versionType(VersionType.ExternalGte)
    );
}
```
实际的删除请求、版本参数和客户端支持范围应以当前 ES 8.x 官方 API 为准；核心思想不变：删除不能只靠“找不到源记录”悄悄发生，而应有可重放、可排序的 tombstone。 软删除则可以把 `status: DELETED` 投影到 ES，再由查询统一过滤，并按保留期物理清理。
对于删除后可能收到旧更新的系统，单独保存 tombstone 或最高已处理版本尤为重要；否则文档不存在时，旧 update 可能再次创建它。
## 四、重试、积压与死信：把失败变成有限状态
同步消费者的失败通常分为两类：
- **短暂失败**：ES 节点切换、网络抖动、429 限流、短暂超时，可指数退避重试。
- **永久失败**：字段 Mapping 不兼容、事件格式损坏、权限配置错误，盲目重试只会堵塞队列。
一个可操作的消费者流程是：
```text
消费事件 → 校验 schema / 版本 → 投影文档 → Bulk 写 ES
    │ 成功                         │ 可重试失败
    ▼                              ▼
提交位点 / ack                延迟队列，指数退避
                                   │ 超过次数或永久失败
                                   ▼
                              死信队列 + 告警 + 人工或自动修复
```
`Bulk` 能显著降低 HTTP 往返，但响应必须逐项检查；一个 bulk HTTP 200 不代表每一条都写成功。 对 429、503 等可重试条目分批退避；对 mapping exception 等不可重试条目保存原事件、异常类型、目标索引和重放次数后进入 DLQ。
应监控以下信号：
- 事件生产到消费的延迟（event time 到 index time）；
- 队列 backlog、消费速率、重试率、DLQ 数量；
- ES bulk 的 item 失败率、429 比率、写入延迟；
- 各分区或 shard 的热点与同步水位；
- 源表行数、ES 文档数和抽样校验差异。
告警必须有处理动作，例如 backlog 超过阈值先扩消费者或限流写入；DLQ 非零则阻断自动确认并建立工单。仅仅看“消费者进程仍活着”无法证明索引是新鲜的。
![图2：消费失败后经重试、死信、对账和重放回到索引的补偿闭环](failure-compensation-loop.svg)
## 五、全量初始化与增量变更不能互相覆盖
新建索引或首次上线时，需要把历史数据完整导入；同时线上仍在发生新增、更新和删除。 直接“先全量扫完，再启动增量”会留下扫描期间的变更空洞。
一种常见顺序如下：
1. 记录 CDC 位点或业务时间水位 `T0`；
2. 从 `T0` 开始持续捕获增量事件，但暂不完全切流；
3. 按主键稳定分页扫描 MySQL，批量构建完整文档写入新索引；
4. 回放 `T0` 之后的增量，依赖版本控制消除全量与增量的乱序覆盖；
5. 对账、抽样查询、检查 mapping 和文档数；
6. 原子切换读别名，再继续消费增量。
全量扫描可使用 `id > lastId ORDER BY id LIMIT ?` 或快照一致性读取，具体选择取决于表结构和事务隔离级别。 不要使用越来越大的 `OFFSET`，它会导致 MySQL 也出现深分页问题；也不要长期持有超大事务快照而不评估 undo 与存储压力。
### 5.1 用 Alias 无停机重建 Mapping
Mapping 的不兼容变化不能原地修改，例如把字段类型从 `text` 改成 `keyword`。 正确路径是创建版本化索引、回填、验证、原子切 alias：
```json
POST /_aliases
{
  "actions": [
    { "remove": { "index": "blog_articles_v1", "alias": "blog_articles_read" } },
    { "add": { "index": "blog_articles_v2", "alias": "blog_articles_read" } },
    { "add": { "index": "blog_articles_v2", "alias": "blog_articles_write", "is_write_index": true } }
  ]
}
```
应用查询 `blog_articles_read`，同步器写 `blog_articles_write`，代码永远不应在核心路径硬编码物理索引名。 切换之前务必移除或更新旧写别名，保证写入只有一个明确目标；旧索引先保留一段可回滚窗口，再按治理策略删除。
## 六、最终一致性如何向产品和用户解释
最终一致性不是“允许任意错误”，而是明确承诺：MySQL 提交后，ES 会在目标延迟内收到同版本或更新版本的投影；发生故障时，能够从事件、Binlog 或全量源恢复。
常见产品策略包括：
- 发布成功页直接展示 MySQL 返回的数据，而不是立刻再搜索 ES 验证；
- 用户查询自己的刚编辑内容时，短时间内合并数据库回查或加“索引处理中”提示；
- 权限、可见性、封禁状态在读路径二次校验，避免 ES 延迟造成越权；
- 后台展示“数据同步至 10:32:04”，把延迟显式化而不是制造“搜索坏了”的错觉。
不要用每次写入都 `refresh=true` 来模拟强一致。 它会明显影响写入吞吐，也无法解决消息丢失、乱序、错误 Mapping 和跨系统事务问题。对用户可见的即时反馈应通过权威数据回显或业务状态处理，而不是强迫搜索索引承担事务职责。
## 七、上线前检查清单
1. 明确 MySQL 是唯一事实来源，ES 物理索引与 Mapping 可以从源重建。
2. 选择同步方案，并记录事件格式、顺序保证、位点、重放和删除语义。
3. 使用业务主键作为 `_id`，为事件提供单调版本，覆盖重试和乱序。
4. Bulk 逐项处理失败，区分可重试、不可重试与 DLQ，建立 backlog、延迟和差异告警。
5. 设计全量初始化与增量并行方案，使用版本控制与对账消除切换空洞。
6. 使用读写 Alias，演练 mapping 重建、切换、回滚和旧索引保留策略。
7. 和产品确认可接受同步延迟、刚写后读策略、权限二次校验与故障提示。
## 八、总结与练习
- MySQL 保存事务事实，Elasticsearch 保存可重建搜索读模型；两者之间通常是最终一致而非分布式事务。
- 双写简单但脆弱；Outbox + MQ 和 Binlog CDC 更可靠，定时扫描适合初始化与补偿。
- 稳定 `_id`、幂等 upsert、带版本删除、乱序拒绝和 tombstone 共同构成可重放同步。
- 重试、积压、DLQ、指标和对账不是运维附加项，而是同步设计的一部分。
- 全量与增量必须并行衔接；通过版本化索引和 Alias 完成可回滚的重建切换。
> **思考与练习**
>
> 1. 为 `article`、`article_tag` 的 CDC 事件定义投影策略：标签变化后是回查 MySQL 重建全文档，还是维护局部状态？比较一致性和吞吐。
> 2. 模拟“删除版本 13 先到、更新版本 12 后到”，写出消费者的预期行为，并设计 tombstone 的保存期限。
> 3. 设计一次 `blog_articles_v2` 重建演练：包含 `T0` 水位、全量扫描、增量回放、抽样对账、Alias 切换、回滚条件与告警。
**下一篇预告**：完成数据链路后，继续处理高吞吐写入与重建效率：Bulk 的逐项失败、Reindex、Alias 零停机迁移和查询性能优化。详见 {% post_link articles/Elasticsearch/08-elasticsearch-bulk-reindex-performance 'Elasticsearch 从零到一（08）：Bulk 写入、Reindex 与查询性能优化' %}。
