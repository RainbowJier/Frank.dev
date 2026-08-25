---
title: Elasticsearch 从零到一（10）：商品搜索综合实战
date: 2026-08-26 10:40:00
categories:
  - 教程
tags:
  - Elasticsearch
  - 商品搜索
  - Spring Boot
  - MySQL
  - Java
description: 以商品搜索为完整案例，从 MySQL 模型、Elasticsearch Mapping、全量与增量同步到 Spring Boot 查询接口、灰度重建和生产验收。
keywords:
  - 商品搜索实战
  - Spring Boot Elasticsearch
  - MySQL 同步 Elasticsearch
  - Elasticsearch PIT
  - search_after
lang: zh-CN
---

> **适合人群**：已经学习 Elasticsearch 基础、查询、Java 客户端、批量写入和集群运维，希望通过一个可以拆分为工程任务的商品搜索案例完成闭环的 Java 开发者。
> 本章不把 ES 当成订单系统，而是构建一个由 MySQL 事实数据驱动、面向读请求优化的搜索读模型。

## 一、项目目标与边界

我们实现一个面向消费者的商品搜索服务，支持：

- 关键词搜索商品名称、卖点和品牌，并返回相关性排序；
- 品牌、分类、价格区间、库存、上架状态和属性筛选；
- 价格区间、品牌、分类聚合，列表高亮；
- 稳定分页，支持搜索结果导出或长列表滚动；
- MySQL 全量初始化、消息增量同步、失败补偿和 Alias 重建；
- Spring Boot 接口的参数校验、超时、指标和可测试性。

明确不在 ES 中完成扣库存、下单、支付或跨表事务。商品主数据、库存事实和审核状态仍由 MySQL 或专门的库存服务负责；ES 的延迟可见是可接受的，搜索接口要能处理短暂不一致。

![图1：MySQL、事件总线、索引任务、ES Alias 与搜索 API 的端到端架构](end-to-end-architecture.svg)

## 二、MySQL 事实模型

### 2.1 表结构设计

商品搜索需要一个稳定的业务主键和明确的变更时间。下面的简化模型将商品核心信息、分类关系和可搜索属性拆开；真实项目可以根据商品中心的领域边界调整。

```sql
CREATE TABLE product (
    id BIGINT PRIMARY KEY,
    sku VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(200) NOT NULL,
    brand_id BIGINT NOT NULL,
    category_id BIGINT NOT NULL,
    description TEXT,
    price DECIMAL(12, 2) NOT NULL,
    stock INT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL,
    version BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMP(3) NOT NULL,
    created_at TIMESTAMP(3) NOT NULL,
    INDEX idx_product_updated (updated_at, id),
    INDEX idx_product_status (status, updated_at)
);

CREATE TABLE product_attribute (
    id BIGINT PRIMARY KEY,
    product_id BIGINT NOT NULL,
    attr_name VARCHAR(64) NOT NULL,
    attr_value VARCHAR(256) NOT NULL,
    updated_at TIMESTAMP(3) NOT NULL,
    INDEX idx_attribute_product (product_id),
    CONSTRAINT fk_attribute_product FOREIGN KEY (product_id) REFERENCES product(id)
);
```

`version` 用于判断事件新旧，`updated_at + id` 用于稳定的全量游标。不要使用没有唯一 tie-breaker 的时间戳分页，否则同一毫秒内的商品可能重复或漏掉。商品删除也要产生事件；只靠扫描现存行无法发现已删除文档。

### 2.2 搜索读模型

ES 文档把一次搜索需要的字段预先展开。品牌名称、分类路径和属性可以从 MySQL 关联表拼装出来，避免搜索请求为了显示筛选项再逐条回查。

```json
{
  "id": 10001,
  "sku": "PHONE-10001",
  "name": "轻薄长续航智能手机",
  "suggest": "轻薄 长续航 智能手机",
  "description": "支持高速网络与多摄像头拍摄。",
  "brand": {"id": 7, "name": "示例品牌"},
  "category": {"id": 21, "path": ["手机", "智能手机"]},
  "attributes": [
    {"name":"颜色","value":"曜石黑"},
    {"name":"内存","value":"256GB"}
  ],
  "price": 3999.00,
  "stock": 18,
  "status": "ON_SALE",
  "updatedAt": "2026-08-24T10:00:00.123Z",
  "version": 42
}
```

商品价格使用 `scaled_float` 或最小货币单位的 `long`，不要使用 `double` 作为金额比较的唯一依据。属性若需要“同一属性名和值同时匹配”，使用 `nested`，否则数组对象内部字段可能被交叉匹配。

## 三、创建 Mapping 与 Alias

先创建具体索引，再创建读写 Alias。应用只依赖 Alias，具体版本名可带模板版本和日期，例如 `products-20260824-001`。

```http
PUT /products-20260824-001
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1,
    "refresh_interval": "1s",
    "analysis": {
      "normalizer": {
        "lowercase_normalizer": {
          "type": "custom",
          "filter": ["lowercase"]
        }
      }
    }
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "id": {"type":"long"},
      "sku": {"type":"keyword"},
      "name": {
        "type":"text",
        "analyzer":"ik_max_word",
        "search_analyzer":"ik_smart",
        "fields":{"keyword":{"type":"keyword","ignore_above":256}}
      },
      "suggest": {"type":"text","analyzer":"ik_smart"},
      "description": {"type":"text","analyzer":"ik_max_word","search_analyzer":"ik_smart"},
      "brand": {
        "properties": {
          "id":{"type":"long"},
          "name":{"type":"keyword","normalizer":"lowercase_normalizer"}
        }
      },
      "category": {
        "properties": {
          "id":{"type":"long"},
          "path":{"type":"keyword"}
        }
      },
      "attributes": {
        "type":"nested",
        "properties":{"name":{"type":"keyword"},"value":{"type":"keyword"}}
      },
      "price":{"type":"scaled_float","scaling_factor":100},
      "stock":{"type":"integer"},
      "status":{"type":"keyword"},
      "updatedAt":{"type":"date"},
      "version":{"type":"long"}
    }
  }
}

POST /_aliases
{
  "actions": [
    {"add":{"index":"products-20260824-001","alias":"products-read"}},
    {"add":{"index":"products-20260824-001","alias":"products-write","is_write_index":true}}
  ]
}
```

`dynamic: strict` 能防止上游属性名称失控地扩张 Mapping。它也意味着新增字段必须先改索引模板或新建版本；捕获 `strict_dynamic_mapping_exception` 后要进入告警和发布流程，而不是静默丢字段。

## 四、全量同步：可恢复而不是一次性脚本

### 4.1 读取 MySQL 的稳定游标

初始化任务按 `(updated_at, id)` 递增读取：

```sql
SELECT id, sku, name, brand_id, category_id, description,
       price, stock, status, version, updated_at
FROM product
WHERE (updated_at > :lastTime)
   OR (updated_at = :lastTime AND id > :lastId)
ORDER BY updated_at, id
LIMIT 1000;
```

任务启动时记录一个上界时间 `snapshotTime`，只读取 `updated_at <= snapshotTime` 的数据；每一批成功写入后持久化游标。这样任务可以暂停和重启，不会因为内存中保存全部商品而失控。关联属性在批量查询中一次取回，避免 N+1 SQL；必要时用临时表或分段查询。

### 4.2 Bulk 写入与校验

全量任务写入 `products-next`，不要直接覆盖线上 Alias 指向的索引。导入期可以调大 refresh 间隔并暂时设置副本为 0，但完成后必须恢复副本、refresh，并等待健康状态稳定。

```java
public void writeBatch(List<ProductDocument> docs, String index) {
    List<BulkOperation> ops = docs.stream()
        .map(doc -> BulkOperation.of(o -> o.index(i -> i
            .index(index).id(doc.id().toString()).document(doc))))
        .toList();
    BulkResponse response = esClient.bulk(b -> b.operations(ops));
    response.items().forEach(item -> {
        if (item.status() >= 300) {
            retryOrDeadLetter(item.id(), item.error());
        }
    });
}
```

校验不能只比较 `_count`。至少要比较 MySQL 与 ES 的 ID 集合抽样、状态/库存统计、价格分布、最新更新时间和 20 个关键查询的 Top N。全量任务完成后，让消息补偿器回放 `snapshotTime` 期间发生的变更，再进入切换。

## 五、增量同步、幂等与补偿

### 5.1 事件模型

事务提交后发送商品变更事件，事件至少带 `eventId`、`productId`、`operation`、`version`、`occurredAt` 和必要的重试元数据：

```json
{
  "eventId":"product-10001-v42",
  "productId":10001,
  "operation":"UPSERT",
  "version":42,
  "occurredAt":"2026-08-24T10:00:00.123Z"
}
```

直接在 MySQL 事务里“双写 ES”容易出现 MySQL 成功、ES 失败或反过来的不一致。更可靠的方案是 Outbox：在同一事务写入商品和 outbox 事件，后台发布器投递消息；消费者以业务 ID 写 ES，失败时重试并把最终失败事件放入死信。

### 5.2 版本保护与删除

事件到达顺序可能反转。消费者读取当前文档版本，只接受更高版本，或者使用 ES 外部版本控制。删除事件要用 `delete`；如果删除后又收到旧的 upsert，版本检查必须阻止旧数据复活。

```http
PUT /products-write/_doc/10001?if_seq_no=17&if_primary_term=3
{
  "id":10001,
  "version":43,
  "status":"ON_SALE"
}
```

上面的条件写入适合已经知道 ES 乐观并发元数据的场景；业务事件版本更适合跨重建索引维持顺序。不要仅依赖消费者内存中的“最后版本”，进程重启后它会丢失。

### 5.3 补偿任务

补偿任务按时间窗口重新从 MySQL 读取变更，并与 ES 中的 `version` 对比。每日或每小时对比总数、删除数、库存异常和随机 ID；发现差异后生成可重放任务。修复要有速率限制，避免补偿任务再次冲击集群。

## 六、Spring Boot 搜索接口

### 6.1 API 契约

设计 `GET /api/products/search`，参数包括 `q`、`brand`、`categoryId`、`minPrice`、`maxPrice`、`inStock`、`pageSize` 和游标 `searchAfter`。接口限制关键词长度、页大小和排序白名单；排序不能让调用者任意传字段名。

```java
public record ProductSearchRequest(
    @Size(max = 100) String q,
    List<String> brand,
    Long categoryId,
    @PositiveOrZero BigDecimal minPrice,
    @PositiveOrZero BigDecimal maxPrice,
    Boolean inStock,
    @Min(1) @Max(100) Integer pageSize,
    String searchAfter
) {}

public record ProductSearchResponse(
    List<ProductHit> items,
    List<Bucket> brands,
    List<Bucket> categories,
    String nextSearchAfter,
    long tookMs
) {}
```

`minPrice > maxPrice`、游标无法解析、品牌数量超限时返回 400；ES 超时返回可区分的 504 或业务降级响应。不要把原始 ES 异常堆栈返回客户端。

### 6.2 构建 bool 查询

Java API Client 的查询构造要让全文条件和 filter 条件分离。`match` 参与相关度，`term`/`range` 放 filter；库存和状态这些业务规则不要用脚本计算。

```java
Query query = Query.of(q -> q.bool(b -> {
    if (request.q() != null && !request.q().isBlank()) {
        b.must(m -> m.multiMatch(mm -> mm
            .query(request.q())
            .fields("name^4", "brand.name^2", "description")
            .operator(Operator.And)));
    } else {
        b.must(m -> m.matchAll(new MatchAllQuery.Builder().build()));
    }
    b.filter(f -> f.term(t -> t.field("status").value("ON_SALE")));
    if (Boolean.TRUE.equals(request.inStock())) {
        b.filter(f -> f.range(r -> r.field("stock").gt(JsonData.of(0))));
    }
    if (request.minPrice() != null || request.maxPrice() != null) {
        b.filter(f -> f.range(r -> r.field("price")
            .gte(request.minPrice() == null ? null : JsonData.of(request.minPrice()))
            .lte(request.maxPrice() == null ? null : JsonData.of(request.maxPrice()))));
    }
    return b;
}));
```

示例为了突出结构省略了部分空值处理。Java Client 的 builder 不能把 `null` 当成任意字段的合法值，项目中应通过条件分支构建 range，并统一 BigDecimal 到分值或整数分的转换。

### 6.3 品牌、分类与属性过滤

多个品牌可使用 `terms`；分类树若存储完整路径，可以对 `category.path` 做 `terms` 过滤。属性组合使用 nested 查询，保证“颜色=黑色且内存=256GB”不会匹配到来自不同数组对象的字段：

```json
{
  "nested": {
    "path": "attributes",
    "query": {
      "bool": {
        "must": [
          {"term":{"attributes.name":"颜色"}},
          {"term":{"attributes.value":"曜石黑"}}
        ]
      }
    }
  }
}
```

筛选面板的聚合要保持与用户选择一致。最简单的实现是在当前 filter 后做 `terms` 聚合；如果要显示“当前品牌之外仍有多少品牌”，需要 filter aggregation 或 `post_filter` 设计，先明确交互语义再写 DSL。

## 七、聚合、高亮与排序

下面是一个完整的搜索请求骨架，包含过滤、聚合、高亮和稳定排序：

```http
GET /products-read/_search
{
  "size": 20,
  "track_total_hits": 10000,
  "query": {
    "bool": {
      "must": [{"multi_match":{"query":"无线耳机","fields":["name^4","description","brand.name^2"]}}],
      "filter": [
        {"term":{"status":"ON_SALE"}},
        {"range":{"price":{"gte":100,"lte":1000}}},
        {"range":{"stock":{"gt":0}}}
      ]
    }
  },
  "aggs": {
    "brands": {"terms":{"field":"brand.name","size":20}},
    "categories": {"terms":{"field":"category.path","size":20}},
    "price_stats": {"stats":{"field":"price"}}
  },
  "highlight": {
    "fields": {"name": {}, "description": {"fragment_size":120,"number_of_fragments":1}},
    "pre_tags":["<em>"],
    "post_tags":["</em>"]
  },
  "sort": [
    {"_score":"desc"},
    {"updatedAt":"desc"},
    {"id":"asc"}
  ]
}
```

`_score` 和业务排序混合时要确认结果稳定性；最后增加唯一的 `id` tie-breaker，避免同一分数和更新时间的商品在翻页时漂移。高亮片段来自索引字段，前端必须按不可信 HTML 处理并限制标签，避免把危险内容原样注入页面。

价格聚合若用 `scaled_float`，业务层按实际金额解释数值；货币、税率和促销价需要统一口径。聚合 `size` 不是结果总数，超过 size 的品牌不会出现在当前面板。

## 八、search_after 与 PIT

`from + size` 在深页会让每个分片收集并排序大量前置结果。连续导出或长列表使用 `search_after`，把上一页最后一条命中的 sort 数组带到下一页：

```http
GET /products-read/_search
{
  "size": 20,
  "query": {"match":{"name":"耳机"}},
  "sort": [{"_score":"desc"},{"updatedAt":"desc"},{"id":"asc"}],
  "search_after": [4.8123,"2026-08-24T10:00:00.123Z",10001]
}
```

`search_after` 本身不保存索引快照。若用户翻页期间索引持续 refresh，结果可能变化；需要一致视图时先创建 PIT：

```http
POST /products-read/_pit?keep_alive=2m

GET /_search
{
  "pit": {"id":"<pit-id>","keep_alive":"2m"},
  "size": 20,
  "query": {"match":{"name":"耳机"}},
  "sort": [{"_score":"desc"},{"updatedAt":"desc"},{"id":"asc"}],
  "search_after": [4.8123,"2026-08-24T10:00:00.123Z",10001]
}

DELETE /_pit
{"id":"<pit-id>"}
```

PIT 会保留旧 reader，过长的 keep_alive 会增加资源压力。接口应在客户端放弃翻页、超时或完成时关闭 PIT，并在服务端设置最大存活时间。排序字段必须在所有分片存在且值稳定；没有 tie-breaker 时仍可能出现不稳定结果。

![图2：Spring Boot 商品搜索请求的校验、查询与结果返回时序](request-sequence.svg)

## 九、Alias 重建与零停机发布

当需要更换分词器、增加字段或调整分片数量时，执行“创建 next → 全量同步 → 增量补偿 → 质量校验 → 原子切 Alias”：

```text
products-read → products-current
                    │
          创建 products-next
                    │
        MySQL 全量 + 事件回放
                    │
          查询与数据验收通过
                    ▼
products-read ─────→ products-next
```

切换请求必须是一个 `_aliases` 原子操作，并明确 write alias：

```http
POST /_aliases
{
  "actions": [
    {"remove":{"index":"products-20260824-001","alias":"products-read"}},
    {"add":{"index":"products-20260824-002","alias":"products-read"}},
    {"remove":{"index":"products-20260824-001","alias":"products-write"}},
    {"add":{"index":"products-20260824-002","alias":"products-write","is_write_index":true}}
  ]
}
```

在切换之前冻结 Mapping 变更、确认消费者已经追平事件偏移量、比较新旧索引的关键查询结果。切换后监控错误率、零结果率、点击率、P95/P99 与增量延迟，保留旧索引直到观察窗口结束。回滚的本质仍是一次相反的 Alias 原子切换，不是把数据重新导入旧索引。

## 十、同步实现的 Java 分层

推荐把搜索工程拆成几个边界清楚的组件：

```text
ProductRepository       读取 MySQL 事实模型
ProductDocumentMapper   组装搜索读模型
ProductIndexWriter      Bulk upsert/delete 与重试
ProductEventConsumer    Outbox/MQ 消费与版本校验
ProductSearchService    DSL、分页、聚合和结果转换
IndexRebuildJob         全量、补偿、校验、Alias 切换
```

`ProductSearchService` 不应直接拼接用户提供的 JSON。将可搜索字段、排序键和聚合名定义为枚举或常量，参数转成类型安全的 Java 查询。`ProductIndexWriter` 负责 idempotency、重试分类、死信和指标；`IndexRebuildJob` 负责 checkpoint、限流和可回滚状态。

### 10.1 Controller 与超时

```java
@RestController
@RequestMapping("/api/products")
class ProductSearchController {
    private final ProductSearchService searchService;

    @GetMapping("/search")
    ProductSearchResponse search(@Valid ProductSearchRequest request) {
        return searchService.search(request);
    }
}
```

Web 层还应配置请求超时、熔断、并发隔离和返回体上限。搜索服务失败时可以返回明确的降级状态，但不能把 ES `hits`、内部节点名和脚本错误泄漏给用户。

### 10.2 测试切入点

使用 Testcontainers 启动与生产主版本一致的 Elasticsearch，开启安全配置或使用受支持的测试凭据。不要只 mock `ElasticsearchClient`，否则 Mapping、分析器、聚合、PIT 和 sort 行为都没有被验证。

```java
@Testcontainers
class ProductSearchIT {
    @Container
    static ElasticsearchContainer es = new ElasticsearchContainer(
        DockerImageName.parse("docker.elastic.co/elasticsearch/elasticsearch:8.15.3"));

    @Test
    void filtersAndHighlightsProducts() {
        // 创建测试索引，写入商品，refresh 后调用真实搜索接口
        // 断言品牌过滤、价格边界、聚合和高亮片段
    }
}
```

测试用例至少包括中文分词、大小写规范化、价格边界、库存为零、多个 nested 属性、删除事件、乱序版本事件、Bulk 429 重试、PIT 过期和 Alias 回滚。

## 十一、测试与验收标准

### 11.1 功能验收

- 输入“无线 耳机”能召回名称和描述相关商品，名称权重高于描述；
- 下架商品、库存为零商品按业务规则被过滤；
- 多品牌、多分类、价格区间组合筛选结果正确；
- 品牌、分类和价格聚合与当前搜索语义一致；
- 高亮只出现在允许字段，特殊字符经过前端安全处理；
- 第一页与后续 `search_after` 页不重复、不漏项，排序稳定；
- 删除 MySQL 商品后，事件最终使 ES 文档消失；乱序旧事件不能覆盖新版本。

### 11.2 数据验收

取 MySQL 的商品 ID、状态、库存和版本与 ES 比较。全量完成后，允许短暂同步延迟，但必须有明确的最大延迟阈值。对随机商品抽取完整 JSON，与读模型转换结果比较；对聚合结果按离线 SQL 计算的基准核对。

发现差异时不要直接手工改 ES。先查事件偏移、Outbox、失败队列、Mapping 拒绝和版本冲突，再决定重放事件或运行补偿任务。手工修复要有审计记录，避免下次全量重建再次丢失。

### 11.3 性能验收

以生产数据分布或脱敏样本压测：

| 场景 | 观察指标 | 通过条件示例 |
| --- | --- | --- |
| 关键词搜索 | P95/P99、错误率 | 在业务预算内且无 429 |
| 多条件筛选 | 延迟、分片 fan-out | 不随过滤项线性失控 |
| 聚合筛选 | 堆、响应体、桶数 | 无 circuit breaker |
| 深分页 | PIT reader、延迟 | 有上限并能及时释放 |
| Bulk 导入 | 吞吐、重试、GC | 失败可重放、堆稳定 |
| 节点故障 | RTO、数据正确性 | 副本提升后可读可写 |

数字要以真实 SLA 为准，不要把示例阈值当成通用标准。压测结果要注明索引版本、分片、数据量、节点规格、客户端并发和查询样本。

![图3：商品搜索索引发布以多维验收和可逆 Alias 切换形成闭环](release-acceptance-loop.svg)

## 十二、生产发布清单

1. **Schema**：Mapping、分析器、模板和 Alias 已审核，动态字段策略明确。
2. **数据**：全量任务可断点续跑，事件有 Outbox、重试、死信和补偿窗口。
3. **发布**：新索引完成 warm-up、refresh、replica 恢复和关键查询对比，Alias 原子切换可回滚。
4. **查询**：关键词、filter、聚合、高亮、排序和 PIT 参数有白名单与上限。
5. **可靠性**：Java 客户端有连接池、超时、重试分类、熔断和隔离；Bulk 不阻塞 Web 请求。
6. **高可用**：跨故障域、快照成功、恢复演练通过，节点/磁盘/GC/线程池有告警。
7. **安全**：TLS、应用专用账号、最小权限、Secret 轮换和审计策略生效。
8. **运营**：零结果率、点击率、搜索延迟、同步延迟、事件失败率和索引版本可观测。
9. **回滚**：保留上一版本索引和 Alias，演练过反向切换；明确旧索引删除时间。

## 十三、总结与练习

商品搜索的工程难点不是写出一个 `match`，而是把事实数据、读模型、查询体验、失败恢复和发布流程连接起来。MySQL 提供事务事实，Outbox/MQ 提供可追踪变更，ES Mapping 让字段适合搜索与聚合，Spring Boot 负责安全地暴露 DSL 能力，PIT/search_after 保证深分页在可控资源内运行，Alias 让索引结构可以零停机演进。

一次可靠的上线应同时满足功能正确、数据可解释、性能可测、高可用可恢复、安全权限最小和回滚可执行。不要把“索引创建成功”当作项目完成；只有全量、增量、补偿、验收和发布门禁都闭环，商品搜索才算真正可运营。

**综合练习**

1. 创建商品 MySQL 表和 `products-001` Mapping，导入至少 10,000 条包含中文、价格、品牌、nested 属性的测试数据。
2. 编写 Outbox 消费者，模拟 upsert、delete、乱序版本和重复投递，验证 ES 最终状态与 MySQL 一致。
3. 实现 `/api/products/search`：支持全文、品牌/分类/价格/库存筛选、聚合、高亮、`search_after` 与 PIT 关闭。
4. 创建 `products-002`，更换分析器并完成全量、增量追平、关键查询验收、Alias 原子切换和反向回滚。
5. 用 Testcontainers 和压测工具记录功能、数据、性能、故障、安全五类验收结果，形成可执行的生产 runbook。

## 十四、系列导航

- 上一篇：{% post_link articles/Elasticsearch/09-elasticsearch-cluster-ha-security 'Elasticsearch 从零到一（09）：集群高可用、快照恢复与安全运维' %}
- 本篇：商品搜索综合实战
- 起点：{% post_link articles/Elasticsearch/01-elasticsearch-introduction 'Elasticsearch 从零到一（01）：全文检索与核心概念' %}
- 性能专题：{% post_link articles/Elasticsearch/08-elasticsearch-bulk-reindex-performance 'Elasticsearch 从零到一（08）：Bulk 写入、Reindex 与查询性能优化' %}
