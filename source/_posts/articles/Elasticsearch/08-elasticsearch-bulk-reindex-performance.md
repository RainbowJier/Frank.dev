---
title: Elasticsearch 从零到一（08）：Bulk 写入、Reindex 与查询性能优化
date: 2026-08-26 10:00:00
categories:
  - 教程
tags:
  - Elasticsearch
  - Bulk API
  - Reindex
  - 性能优化
  - Java
description: 面向 Java 开发者系统讲解 Elasticsearch 8.x 的 Bulk 批量写入、Reindex 重建、Alias 零停机迁移与查询性能优化。
keywords:
  - Elasticsearch Bulk
  - Elasticsearch Reindex
  - Elasticsearch Alias
  - Elasticsearch 性能优化
  - Java Elasticsearch Client
lang: zh-CN
---

> **适合人群**：已经能够创建索引、编写 Query DSL，希望把开发环境的 ES 写入和查询方案推进到生产级的 Java 开发者。
> 本章使用 Elasticsearch 8.x API。性能优化的第一原则不是“加机器”，而是先找到瓶颈、建立基线，再做一项可回滚的改动。
## 一、先认识批量写入问题

逐条调用 `PUT /products/_doc/{id}` 很容易写出来，却很难在导入百万级商品时保持吞吐。每个 HTTP 请求都要付出连接、JSON 编解码、线程池调度和 refresh 协调成本。应用的事务线程还会被网络往返拖慢。

Bulk API 把多个操作放在一个请求中，减少网络往返；但它不是“无限大的请求包装器”。一个批次过大，会让客户端堆积更多 JSON、占用协调节点内存，并可能触发 HTTP 413、写入拒绝或长时间 GC。批次大小必须和文档平均大小、字段数量、节点规格一起调出来。

![图1：Bulk 生产者、缓冲区与 ES 写入线程池之间的背压关系](bulk-backpressure.svg)
### 1.1 Bulk 请求格式

Bulk 的请求体是 NDJSON：一行动作元数据，下一行是文档或更新内容；最后必须有换行。动作和数据不能写成一个普通 JSON 数组。

```http
POST /products/_bulk
Content-Type: application/x-ndjson

{"index":{"_id":"p-1001"}}
{"sku":"p-1001","name":"Java 编程思想","brand":"A","price":89.00,"stock":42}
{"update":{"_index":"products","_id":"p-1002","retry_on_conflict":3}}
{"doc":{"stock":40},"doc_as_upsert":false}
{"delete":{"_index":"products","_id":"p-1003"}}
```
ES 8.x 的 Bulk 响应即使 HTTP 状态是 200，也可能在 `items` 中包含部分失败。应用必须逐项检查 `errors` 和每个操作的 `status`，不能只看 HTTP 状态。

```json
{
  "errors": true,
  "items": [
    {"index": {"_id": "p-1001", "status": 201}},
    {"index": {"_id": "p-1002", "status": 429, "error": {"type": "es_rejected_execution_exception"}}}
  ]
}
```
对 `429`、临时连接断开和节点切换，可以指数退避后重试；Mapping 错误、非法日期、脚本编译错误等确定性失败应进入失败队列，不要无限重试。重试动作要保证幂等：以业务主键作为 `_id`，同一事件重复消费时使用 `index` 或带版本条件的 `update`。
### 1.2 Java API Client 的批处理骨架

Java 项目建议使用与 ES 服务端主版本匹配的 `elasticsearch-java` 客户端。下面的代码保留了“积累、发送、逐项处理”的关键结构；生产代码还应注入指标、超时和死信处理。

```java
var operations = new ArrayList<BulkOperation>();
for (Product product : products) {
    operations.add(BulkOperation.of(op -> op.index(i -> i
        .index("products")
        .id(product.id().toString())
        .document(product))));
}
BulkResponse response = client.bulk(b -> b.operations(operations));
if (response.errors()) {
    response.items().forEach(item -> {
        if (item.status() >= 300) {
            failedEvents.offer(new FailedEvent(item.id(), item.error()));
        }
    });
}
```
如果使用 `BulkIngester`，要明确它的并发请求数、最大操作数、最大字节数和关闭时 flush 行为。不要把一个无限生产的 `Flux` 或线程池直接接到 ingester，却没有队列上限。
## 二、批次大小、并发与背压
### 2.1 怎样选择 batch size

没有对所有集群都适用的数字。可以从每批 500–2,000 条、或 5–15 MB 开始，在压测中观察写入吞吐、`429` 比例、JVM Old GC、refresh 时间和磁盘写入。批次最好同时设置“条数上限”和“字节上限”，因为一条带长描述的商品可能比数十条短文档还大。

实用的调参顺序是：先固定一个发送线程和较小批次，记录基线；逐步增加批次直到平均延迟不再下降；再增加并发，直到写线程池出现拒绝或节点资源达到预算；最后回退一个档位作为安全余量。

```text
吞吐基线 → 增加批次 → 观察 429/GC → 增加并发 → 找到拐点 → 保留余量
```
需要关注的信号包括：

- **Bulk 平均/分位延迟**：P95、P99 长时间上升，说明队列或磁盘已成为瓶颈。
- **写入拒绝**：`_nodes/stats/thread_pool` 中 `write` 或 `bulk` 的 `rejected` 增长，说明生产者过快。
- **JVM 与堆**：堆使用率长期超过 75% 或 Old GC 频繁，先降低批次和并发。
- **磁盘与段合并**：磁盘吞吐饱和、merge 时间增加时，继续加并发只会互相争抢。
- **失败率**：每批记录成功、失败、重试、丢弃数量，不能只记录总条数。
### 2.2 背压要落到代码

背压不是一句“异步发送”。生产者必须能感知消费者变慢，并限制内存中的待发送数据。常见做法是有界队列、Semaphore 或响应式流的 `request(n)`；队列满时阻塞读取、降低消费速度或把事件交给消息系统，而不是继续创建对象。

```java
Semaphore permits = new Semaphore(4); // 最多四个飞行中的 bulk
ExecutorService pool = Executors.newFixedThreadPool(4);
for (List<Product> batch : batches) {
    permits.acquire();
    pool.submit(() -> {
        try {
            sendAndClassify(batch);
        } finally {
            permits.release();
        }
    });
}
pool.shutdown();
```
这个例子只是限并发的最小模型。实际实现应设置获取许可超时、任务取消、优雅关闭和失败批次持久化。并发数不是越高越好：同一分片上的热点 ID、脚本更新或单个大分片会让整体吞吐被最慢路径限制。
### 2.3 导入期 refresh 与 replica 的取舍

默认 refresh 会让新写入的文档近实时可搜索。大批量初始化期间，如果业务允许延迟可见，可以暂时把 `refresh_interval` 调大，甚至设置为 `-1`，导入完成后再恢复并手工 refresh：

```http
PUT /products/_settings
{"index":{"refresh_interval":"-1","number_of_replicas":0}}

POST /products/_refresh

PUT /products/_settings
{"index":{"refresh_interval":"1s","number_of_replicas":1}}
```
关闭副本可以减少导入时的复制和磁盘开销，但会降低故障期间的可用性。只适合可重建的初始化索引，并且应在切流量前恢复副本、等待分片变绿。在线业务导入不要为了吞吐盲目关闭副本；应将导入流量隔离、错峰，或使用独立的新索引。

`refresh=wait_for` 适合少数需要等待可搜索的写请求；不要在每一条 Bulk 后都 `refresh=true`，否则会把近实时引擎变成高频小段生成器。导入完成后，监控 segment count、merge、磁盘和搜索延迟，确认恢复设置没有引入回压。

## 三、Reindex：重建读模型的标准工具

Mapping、分析器或字段结构需要变化时，通常不能直接修改已有字段类型。正确路径是新建目标索引，用 `_reindex` 复制并转换文档，再校验结果。

```http
PUT /products-v2
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "30s"
  },
  "mappings": {
    "properties": {
      "sku": {"type":"keyword"},
      "name": {"type":"text","analyzer":"ik_max_word","search_analyzer":"ik_smart"},
      "brand": {"type":"keyword"},
      "price": {"type":"scaled_float","scaling_factor":100},
      "available": {"type":"boolean"}
    }
  }
}

POST /_reindex?wait_for_completion=false
{
  "source": {"index":"products-v1","size":500},
  "dest": {"index":"products-v2","op_type":"create"}
}
```
异步 Reindex 返回 task ID，可以用 `_tasks/{taskId}` 查询进度；长任务还要保存响应里的 `created`、`updated`、`version_conflicts` 和失败明细。`op_type=create` 避免覆盖迁移期间已经写入的新版本，但它也意味着冲突必须进入补偿流程。

### 3.1 脚本转换与切分

可以在 Reindex 中使用 Painless 对旧字段做轻量转换，但脚本要经过测试，避免访问不存在字段造成任务失败：

```http
POST /_reindex
{
  "source":{"index":"products-v1"},
  "dest":{"index":"products-v2"},
  "script":{
    "lang":"painless",
    "source":"if (ctx._source.price != null) { ctx._source.price_cents = Math.round(ctx._source.price * 100); }"
  }
}
```
大索引可以设置 `slices` 并行读取：`"slices": "auto"` 是方便的起点，但并行切片会增加磁盘和 CPU 竞争。迁移中持续观察集群，不要把切片数量当作吞吐开关无限调大。

跨集群迁移不一定用 `_reindex`；可以结合快照、远程 Reindex 或离线导出。无论工具是什么，都要先解决源目标版本兼容、凭据权限、网络、字段转换和校验策略。

## 四、Alias 实现零停机迁移

应用不要把 `products-v1` 写死在代码里，而是访问 `products-read` 和 `products-write` alias。迁移时，先创建 v2、全量复制，再补增量，最后用一个原子 `_aliases` 请求切换：

![图2：通过 Alias 将 v1 原子切换为 v2 的重建流程](alias-reindex.svg)

```http
PUT /products-v1/_alias/products-read
PUT /products-v1/_alias/products-write

POST /_aliases
{
  "actions": [
    {"remove":{"index":"products-v1","alias":"products-read"}},
    {"add":{"index":"products-v2","alias":"products-read"}},
    {"remove":{"index":"products-v1","alias":"products-write"}},
    {"add":{"index":"products-v2","alias":"products-write","is_write_index":true}}
  ]
}
```
如果一个 Alias 指向多个索引，写入端必须有唯一的 `is_write_index`，否则 Bulk 写入会失败或行为不符合预期。切换前应做文档数、抽样哈希、关键查询、聚合和延迟对比；切换后保留 v1 一段观察窗口，不要马上删除，便于快速回滚。

迁移期间的增量一致性有三种常见方案：暂停短时间写入、双写 v1/v2、或记录变更日志并在切换前回放。最稳妥的工程实践通常是“全量快照时间点 + 变更事件补偿 + 原子切换”，并给每个事件带版本号或更新时间，防止旧事件覆盖新数据。

## 五、分片、路由与数据布局

### 5.1 分片大小不是常数答案

分片承载 Lucene 段、文件句柄、缓存和恢复成本。分片过小会让集群管理大量对象；过大则恢复慢、单分片查询和 merge 压力高。规划时至少估算：源数据体积、`_source` 与索引膨胀、未来增长、节点磁盘水位、恢复时间目标和查询并发。

常见经验是让分片处在“几十 GB 到百 GB 级别”的可运维区间，但这不是 ES 的硬性限制。以压测和恢复演练结果为准；不要仅根据文档条数估算，因为长文本、nested 字段和高基数字段都会显著改变体积。

```http
GET /_cat/shards/products-v2?v&h=index,shard,prirep,store,docs,node
GET /_cluster/allocation/explain
```
### 5.2 Routing 的收益与陷阱

默认路由用 `_id` 计算分片，分布通常较均匀。多租户场景可使用租户 ID 作为 routing，让同一租户查询只命中一个分片：

```http
PUT /products/_doc/p-1001?routing=tenant-7
{"tenantId":"tenant-7","sku":"p-1001","name":"搜索服务器"}

GET /products/_search?routing=tenant-7
{"query":{"term":{"tenantId":"tenant-7"}}}
```
路由能减少 fan-out，却可能把大租户变成热点，并且读写请求必须始终带相同 routing。忘记 routing 会查不全，迁移文档时也要保留 routing。不要用高偏斜的字段做全局路由，先用真实租户分布压测。

## 六、定位查询慢在哪里

![图3：从请求、查询结构到缓存与数据模型的性能优化检查清单](optimization-checklist.svg)

### 6.1 Profile 看单次查询，慢日志看长期趋势

Profile API 会拆解一次搜索各查询组件的耗时，适合发现 `wildcard`、高基数聚合或大量分片 fan-out：

```http
GET /products/_search
{
  "profile": true,
  "size": 10,
  "query": {"bool":{"filter":[{"term":{"brand":"A"}}],"must":[{"match":{"name":"Java"}}]}}
}
```
Profile 有额外开销，不能在生产所有请求上长期开启。慢日志用于按阈值记录查询与 fetch 阶段：

```http
PUT /products/_settings
{
  "index.search.slowlog.threshold.query.warn":"2s",
  "index.search.slowlog.threshold.fetch.warn":"1s",
  "index.search.slowlog.level":"info"
}
```
阈值应按业务 P95/P99 和资源预算设定。日志中要带索引、分片和查询摘要，避免把用户输入原文不加控制地写入日志。

### 6.2 `_source`、缓存与返回体

搜索列表不要返回完整正文或大图片字段，使用 `_source` includes/excludes 或 `fields` 控制响应：

```json
{
  "_source": ["sku", "name", "price", "brand", "thumbnail"],
  "size": 20,
  "query": {"match":{"name":"耳机"}}
}
```
`_source` 是更新、重建和排查的重要原始数据，不要为了省一点网络流量而全局禁用。对特别大的原文，可以保留 `_source` 但在列表查询中排除。

Filter context、结构化 `term/range` 条件更可能受 query cache 益处；缓存是节点和分片级的，数据频繁变动或查询值几乎不重复时收益有限。不要把业务结果缓存误解成 ES query cache；热点商品页可在应用层用 Redis，并明确失效策略。

### 6.3 避免高成本查询

- **深分页**：`from + size` 适合浅页，超过默认 `index.max_result_window` 后会消耗协调节点内存；导出或连续翻页使用 `search_after`，长时间一致视图结合 PIT。
- **Wildcard**：前导 `*` 不能有效利用倒排词项，可能扫描大量词项。优先使用 `keyword` 的规范化字段、`prefix`、edge-ngram 或专门的 autocomplete 字段。
- **Script query/sort**：脚本逐文档执行，容易绕过索引优化。把可计算值在写入期预计算成字段；必须脚本时限制候选集并压测。
- **高基数聚合**：对订单号、用户 ID 做大规模 `terms` 会占用内存；需要全量遍历时考虑 composite aggregation。
- **不必要的 wildcard 分片广播**：查询具体租户时带 routing，过滤条件放 `filter`，并控制返回字段。

`track_total_hits` 也有成本。只需要判断是否还有结果时可以设置较小阈值；但订单报表需要准确总数时必须明确打开并接受代价。

## 七、一个可执行的优化清单

1. 记录真实请求样本、数据规模、分片数量和节点规格，建立 P50/P95/P99 基线。
2. 确认 Mapping：全文字段、精确字段、多字段、数值精度和日期格式是否满足查询。
3. 先看 Profile、慢日志、线程池、GC、磁盘和 merge，不凭直觉改 DSL。
4. 通过过滤、查询裁剪、`_source` 控制和 `search_after` 消除明显浪费。
5. 再评估分片数量、routing、refresh、replica 与硬件；每次只改一个变量。
6. 用线上流量回放和故障场景验证 P99、错误率、恢复时间及结果正确性。
7. 把参数、基线、回滚命令写入变更记录，保留旧索引和旧 Alias。

## 八、Java 服务中的边界与可观测性

Bulk、Reindex 通常是后台任务，不应占满 Web 请求线程。建议把导入任务拆成可暂停的作业，记录 checkpoint（最后事件 ID、时间戳或游标）、批次统计和失败事件。应用指标至少包含 `bulk_batch_size`、`bulk_latency`、`bulk_retries`、`bulk_failed_items`、`reindex_progress` 和 `search_latency`。

查询端对用户输入做长度限制和字段白名单，不要直接拼接 JSON DSL；尤其禁止把用户输入拼到脚本、索引名或 `sort` 字段中。Java 客户端的异常要区分连接超时、429、4xx 参数错误和 5xx 集群错误，分别采取重试、降级或告警。

如果 ES 暂时不可用，搜索接口可以返回缓存结果、热门商品或“搜索服务繁忙”，但不能悄悄把未验证的数据库 `LIKE` 当成等价降级。写入同步失败则应依靠消息重试、死信和补偿任务，而不是在请求线程里无限等待。

## 九、总结与练习

本章的核心不是记住某个批次数字，而是建立可验证的性能工程流程：Bulk 降低协议开销，背压保护集群，导入期合理调节 refresh/replica，Reindex 配合 Alias 实现结构迁移；查询侧通过 Profile、慢日志、Mapping、分片和分页策略持续压测。`_source` 保留可恢复性，缓存和预计算服务于明确的访问模式，Wildcard、脚本和深分页必须谨慎。

**思考与练习**

1. 用 100 万条商品生成器测试 500、1,000、2,000 条批次，比较 P95、429、GC 和磁盘吞吐。
2. 为 `products-v1` 增加 `available` 字段并创建 v2，使用 Reindex、增量补偿和 Alias 原子切换完成迁移。
3. 对同一个查询分别使用 `from/size`、`search_after` 和 PIT，记录深页时的耗时与堆变化。
4. 写一个失败事件重试器：只重试 429 和网络瞬时错误，其他错误进入死信，并实现幂等校验。

## 十、系列导航

- 上一篇：{% post_link articles/Elasticsearch/07-elasticsearch-mysql-sync 'Elasticsearch 从零到一（07）：MySQL 与 Elasticsearch 数据同步' %}
- 本篇：Bulk 写入、Reindex 与查询性能优化
- 下一篇：{% post_link articles/Elasticsearch/09-elasticsearch-cluster-ha-security 'Elasticsearch 从零到一（09）：集群高可用、快照恢复与安全运维' %}
- 综合实战：{% post_link articles/Elasticsearch/10-elasticsearch-comprehensive-practice 'Elasticsearch 从零到一（10）：商品搜索综合实战' %}
