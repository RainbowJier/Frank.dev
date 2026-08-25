---
title: Elasticsearch 从零到一（01）：全文检索与核心概念
date: 2026-08-24 10:00:00
categories:
  - 教程
tags:
  - Elasticsearch
  - 全文检索
  - 搜索引擎
  - Java
description: 面向 Java 开发者讲清 Elasticsearch 为什么适合全文检索、倒排索引如何工作，以及 Index、Document、Shard、Replica 和 Query DSL 等核心概念。
keywords:
  - Elasticsearch 入门
  - Elasticsearch 全文检索
  - 倒排索引
  - Elasticsearch DSL
  - Java 搜索引擎
lang: zh-CN
---

> **适合人群**：会写 MySQL 基础 CRUD，遇到过商品、文章或日志搜索需求，想系统学习 Elasticsearch 的 Java 开发者。
> 本文按 Elasticsearch 8.x 的通用概念讲解。先记住最重要的一条边界：**Elasticsearch 是搜索与分析引擎，不是 MySQL 的直接替代品。**业务事实、事务写入通常仍由关系型数据库承载，ES 是面向检索场景构建的读模型。

## 一、为什么 MySQL 的 `LIKE` 不够用

一开始，很多搜索需求都从下面的 SQL 起步：

```sql
SELECT id, title, summary
FROM article
WHERE title LIKE '%Spring Boot%'
ORDER BY publish_time DESC
LIMIT 20;
```

数据量小、功能简单时，这样写没有问题。但当文章、商品或日志增长到几十万、几百万条，并且用户希望同时获得“包含多个词的结果、按相关度排序、关键词高亮、筛选聚合、中文分词和拼写容错”时，普通关系型查询会越来越吃力。

问题不在于 MySQL “不能搜索”，而在于它的常规 B+ 树索引更擅长：**按完整值或有序范围快速定位记录**。`title LIKE 'Spring%'` 有机会利用前缀；`title LIKE '%Spring%'` 的开头不确定，通常无法按常规索引直接定位，只能扫描更多候选行再逐条判断。

![图1：MySQL 前导通配匹配与 Elasticsearch 倒排索引的检索路径对比](mysql-like-vs-inverted-index.svg)

全文检索关心的不是“第 N 行字符串的第几个字符”，而是：**某个词出现在哪些文档中，它出现得多不多、位置是否接近、哪个文档更相关。**Elasticsearch 会把文本分析成词项，并建立“词项 → 文档列表”的倒排索引，查询时先从词项定位候选文档，而不是从第一条记录开始逐字比对。

这并不意味着所有模糊查询都该迁到 ES：后台管理的少量记录、按编号/状态的精确筛选、强事务写入，继续由 MySQL 处理更简单可靠。可以先阅读 {% post_link articles/Database/mysql-postgresql-oracle-comparison 'MySQL、PostgreSQL（PG）与 Oracle：区别、SQL 对照与选型指南' %}，理解关系型数据库的基本选型边界。

### 1.1 ES 最常见的四类场景

- **内容与商品搜索**：按标题、正文、品牌、标签和分类检索，再按相关度、时间、销量等规则排序。
- **日志检索与分析**：按服务、时间、请求 ID、异常栈快速定位问题，并统计错误率与耗时趋势。
- **筛选与聚合**：在搜索结果上统计品牌、分类、价格区间、日期趋势，支撑搜索筛选面板和运营看板。
- **知识库检索**：先用关键词召回相关段落；后续也可结合向量字段做语义检索和混合检索。

### 1.2 它与数据库如何协作

一个稳妥的业务链路通常是：订单、商品等数据先写入 MySQL；应用再通过消息队列、Binlog 同步、定时任务或应用层事件，把可搜索字段写入 ES；用户搜索时查询 ES，必要时再回 MySQL 补充强一致数据。

```text
管理后台写商品 → MySQL（事务事实来源） → 同步链路 → Elasticsearch（搜索读模型）
用户检索商品 → Elasticsearch（召回、排序、聚合） → 按需回查业务数据
```

因此，后续设计 ES 时必须一并考虑数据同步、失败重试、幂等、索引重建和版本兼容；不要只把它当成一个“更快的数据库”。

## 二、Elasticsearch 在 Elastic Stack 中的位置

Elasticsearch 建立在 **Apache Lucene** 之上。Lucene 是成熟的 Java 搜索库，负责许多底层索引与检索能力；Elasticsearch 在它之上补齐了 REST API、分布式集群、分片副本、安全和运维能力，让应用不必直接操作 Lucene 的底层对象。

在实际项目里，经常会同时看到这些名字：

| 组件 | 主要职责 | 可以怎样理解 |
| --- | --- | --- |
| Lucene | 本地索引和检索库 | 搜索能力的底层引擎 |
| Elasticsearch | 分布式搜索与分析服务 | 对外提供 JSON/HTTP API 的搜索集群 |
| Kibana | 管理、调试、可视化 | ES 的 Web 控制台和数据看板 |
| Beats / Logstash | 采集、清洗、转发数据 | 日志与指标进入 ES 前的数据管道 |

刚开始学习时，先用 Kibana 的 **Dev Tools** 执行 REST 请求最直接：请求和响应都是 JSON，能清楚看到 Mapping、文档与查询结果。第二篇会从 Docker 启动 Elasticsearch + Kibana 开始，再完成本地环境验证。

> **版本提醒**：客户端、服务端和插件必须关注兼容性。尤其是中文分词插件、Java 客户端和 Elasticsearch 主版本，不要只复制旧教程的依赖坐标就直接用于 ES 8.x。

## 三、先建立正确的核心模型

Elasticsearch 的名词很多，但可以按“集群 → 索引 → 文档”三层逐步理解。

![图2：Elasticsearch 的集群、索引、分片副本与文档层级](elasticsearch-core-model.svg)

| ES 概念 | 作用 | 关系型数据库类比 | 需要避免的误解 |
| --- | --- | --- | --- |
| Cluster（集群） | 多个节点组成的整体服务 | 一个数据库集群 | 不等同于单个 database |
| Node（节点） | 运行 ES 的一个实例 | 集群中的一个数据库实例 | 节点可承担不同角色 |
| Index（索引） | 一类文档的逻辑集合与检索结构 | 常被类比为表 | 不只是表，还包含索引设置和 Mapping |
| Document（文档） | 一条 JSON 业务记录 | 一行数据 | 文档更新本质上会写入新版本 |
| Field（字段） | 文档中的一个属性 | 列 | 同一字段的 Mapping 要保持稳定 |
| Shard（分片） | 索引数据的水平分区 | 分库分表中的一个数据片段 | 它是 Lucene 索引单元，不是随意拆表 |
| Replica（副本） | 主分片的复制副本 | 从库中的副本数据 | 它既提升可用性，也可分担读请求 |

### 3.1 Index、Document 与 Field

假设要做博客搜索，可以创建名为 `blog_articles` 的 Index。其中每篇文章是一份 Document：

```json
{
  "id": 101,
  "title": "Spring Boot 事务失效的常见原因",
  "content": "事务代理、调用方式和异常类型都会影响回滚行为。",
  "category": "Spring Boot",
  "tags": ["事务", "AOP"],
  "publishedAt": "2026-08-24T10:00:00Z"
}
```

它看起来像一条表记录，但 ES 的核心读写单位是 JSON Document。不同字段必须预先考虑用途：`title`、`content` 需要分词搜索；`category`、`tags` 常用于精确筛选与聚合；日期要支持时间范围筛选和排序。

### 3.2 Shard 与 Replica 为什么存在

一个 Index 可以切分成多个主分片（Primary Shard），不同分片分布到不同节点上。某条文档写入时，ES 根据文档 ID（或显式 routing）计算它属于哪个主分片；副本分片（Replica Shard）保存主分片的数据副本。

这样做有两个目的：

1. **数据规模可横向扩展**：单个节点放不下或处理不过来时，多个分片可以分摊数据和请求。
2. **节点故障仍可服务**：一个主分片所在节点失效时，健康的副本可以被提升为主分片。

分片不是越多越好。过多小分片会带来额外的堆内存、文件句柄和协调开销；分片规划要结合数据量、节点规格、写入量和查询模式评估，不能只按“多机器就多分片”的直觉设置。

## 四、倒排索引：文本为什么能被快速找到

倒排索引的方向与“文档 → 包含哪些词”相反。它先把每份文档的文本拆成词项，再记录每个词项出现在哪些文档中。

假设有三篇文章标题：

| 文档 ID | 标题 |
| --- | --- |
| `1` | Spring Boot 事务管理 |
| `2` | Spring Cloud 网关实践 |
| `3` | Java 事务与并发控制 |

为了便于说明，先把词项简化为 `spring`、`boot`、`cloud`、`事务`、`java` 等。倒排结构可理解为：

```text
spring → [1, 2]
boot   → [1]
cloud  → [2]
事务    → [1, 3]
java   → [3]
```

当用户搜索“Spring 事务”时，查询文本也会被分析成词项，ES 先分别找到 `spring` 和 `事务` 对应的候选列表，再根据查询规则决定求交集、并集，最后按相关性排序。

### 4.1 索引期分析与查询期分析

分析（Analysis）不是单一“分词器”那么简单，通常包括：

1. **Character Filter**：预处理字符，例如移除特定 HTML 标记；
2. **Tokenizer**：把文本切为 token；
3. **Token Filter**：做小写化、停用词过滤、同义词扩展等处理。

写入文档时，索引期分析决定要写入哪些词项；搜索时，查询期分析决定用户输入如何转成查询词项。两侧策略明显不一致，就可能出现“明明文本里有，为什么搜不到”的问题。

中文没有英文那样天然的空格边界，不能只沿用默认分析器。后续会单独讲 IK 分词、同义词、拼音与搜索建议；现在只需记住：**Mapping 中的字段类型和分析器，是搜索质量的地基。**

### 4.2 相关性不是简单的“包含就排前面”

全文查询默认会返回 `_score`，代表文档与当前查询的相关程度。现代 ES 默认使用 BM25 相关性模型，直觉上会综合词项在文档中出现的情况、词项在整个索引中的稀有程度和字段长度等因素。

相关性是排序信号之一，不是业务规则的替代品。电商搜索常会把文本相关性、商品销量、库存状态、上架时间组合起来；日志排查则通常优先按时间排序。如何调节字段权重和业务评分，会在搜索相关性专题继续展开。

## 五、第一个 Index 与查询 DSL

下面以 `blog_articles` 为例，演示“先定义 Mapping，再写文档，最后搜索”的完整最小路径。示例可直接在 Kibana Dev Tools 中执行。

### 5.1 创建明确的 Mapping

生产环境不建议完全依赖动态 Mapping。字段一旦被首次推断为不合适的类型，通常不能直接原地改成另一种类型；更常见的正确处理是新建 Index、重建数据，再用 Alias 切换读写流量。

```json
PUT /blog_articles
{
  "mappings": {
    "properties": {
      "id": {
        "type": "long"
      },
      "title": {
        "type": "text"
      },
      "content": {
        "type": "text"
      },
      "category": {
        "type": "keyword"
      },
      "tags": {
        "type": "keyword"
      },
      "publishedAt": {
        "type": "date"
      }
    }
  }
}
```

这里最重要的是 `text` 与 `keyword`：

- `text` 会经过分析，适合标题、正文等全文检索字段；它追求“用户输入的词能否找到相关文本”。
- `keyword` 按完整值建立索引，适合分类、状态、标签、订单号等精确筛选、排序与聚合字段。

例如 `category: "Spring Boot"` 若被定义为 `text`，它会被拆成多个词，不适合“按完整分类筛选”；反过来，如果标题定义成 `keyword`，用户搜索“事务”也无法按词项匹配标题。

### 5.2 写入两份文档

`_id` 是 ES 的文档标识。这里让它与业务主键一致，方便排查与同步；实际项目要明确 ID 生成与重复写入策略。

```json
PUT /blog_articles/_doc/101
{
  "id": 101,
  "title": "Spring Boot 事务失效的常见原因",
  "content": "事务代理、调用方式和异常类型都会影响回滚行为。",
  "category": "Spring Boot",
  "tags": ["事务", "AOP"],
  "publishedAt": "2026-08-24T10:00:00Z"
}

PUT /blog_articles/_doc/102
{
  "id": 102,
  "title": "Java 并发控制与线程池实践",
  "content": "从线程池参数、队列和拒绝策略理解并发任务的执行过程。",
  "category": "Java",
  "tags": ["并发", "线程池"],
  "publishedAt": "2026-08-23T10:00:00Z"
}
```

### 5.3 `match` 与 `term` 分别解决什么问题

搜索“事务”这类自然语言时，使用 `match`。它会按该字段的分析器处理查询词：

```json
GET /blog_articles/_search
{
  "query": {
    "match": {
      "title": "事务"
    }
  }
}
```

按完整分类筛选时，使用 `term`：

```json
GET /blog_articles/_search
{
  "query": {
    "term": {
      "category": "Spring Boot"
    }
  }
}
```

不要把两者混用：对已分析的 `text` 字段直接执行 `term`，往往会因词项不一致而查不到预期结果；而对 `keyword` 字段使用 `match`，通常也不是表达精确业务条件的最佳方式。

### 5.4 用 `bool` 组合搜索与过滤

真实检索常常既有全文匹配，也有分类、日期、状态等过滤。`bool` 查询把它们分开表达：`must` 参与匹配和评分，`filter` 只负责过滤且更适合可缓存的精确条件。

```json
GET /blog_articles/_search
{
  "query": {
    "bool": {
      "must": [
        {
          "match": {
            "title": "事务"
          }
        }
      ],
      "filter": [
        {
          "term": {
            "category": "Spring Boot"
          }
        },
        {
          "range": {
            "publishedAt": {
              "gte": "2026-08-01"
            }
          }
        }
      ]
    }
  },
  "sort": [
    {
      "_score": "desc"
    },
    {
      "publishedAt": "desc"
    }
  ]
}
```

![图3：关键词经过分析、倒排索引召回、过滤与排序后返回结果的链路](elasticsearch-search-flow.svg)

这个例子表达了一个可复用的思路：**全文条件放 `must`，精确业务条件放 `filter`，排序规则单独声明。**后续学习高亮、聚合、分页时，也是在这个查询骨架上继续扩展。

> **近实时提醒**：文档写入 ES 后通常不是立刻对搜索可见。默认情况下，ES 会周期性 refresh，使新数据在很短时间后可被检索。这是“近实时（NRT）”而不是严格实时；不要在每次普通写入后都强制 refresh 来掩盖设计问题。

## 六、ES 能做什么，不能替代什么

Elasticsearch 很强，但边界清楚才能长期稳定使用。

### 6.1 适合交给 ES 的能力

| 需求 | ES 的典型能力 |
| --- | --- |
| 文章、商品、知识库检索 | 分词、多字段匹配、相关性排序、高亮 |
| 搜索页筛选 | `terms`、`range`、日期等聚合 |
| 日志排障 | 时间范围过滤、结构化字段检索、全文异常栈搜索 |
| 指标趋势 | `date_histogram`、平均值、去重数等聚合 |
| 地理与自动补全 | `geo_point`、前缀匹配、completion suggester |

### 6.2 不应忽略的生产边界

1. **不要把 ES 当成唯一事实来源**：误删 Index、错误 Mapping、同步延迟和重建过程都会影响检索数据；业务主数据仍应有可恢复的权威来源。
2. **不要期待跨文档事务**：ES 单文档写入具有原子性，但它不是关系型数据库的多表事务系统。库存扣减、支付、订单状态等强一致写入应由事务数据库处理。
3. **不要随意让动态字段增长**：日志或 JSON 扩展字段无约束地进入 Mapping，会导致字段数膨胀，进而拖慢集群并增加内存压力。
4. **不要忽略同步链路**：双写、异步消息、Canal/Debezium、定时全量同步各有一致性取舍；必须设计失败重试、幂等和索引重建方案。
5. **不要跳过版本兼容检查**：升级 ES、切换 Java Client、安装分析插件前，应先核对服务端主版本、客户端版本和插件发布版本。

这些限制不是缺点，而是架构分工：用 MySQL 保证事务与业务正确性，用 ES 解决大规模检索、排序与聚合，两者组合才是常见生产方案。

## 七、总结与下一步

- Elasticsearch 基于 Lucene 构建，是面向全文检索与分析的分布式引擎；它通常补充而不是替代 MySQL。
- 倒排索引把“文本包含哪些词”转换为“词出现在哪些文档”，让关键词召回不必逐行扫描全部文本。
- Cluster、Node、Index、Document、Shard 和 Replica 分别描述了 ES 的服务层级、数据模型与可扩展性设计；它们只能辅助类比关系型数据库，不能直接画等号。
- `text` 服务全文检索，`keyword` 服务精确过滤、排序和聚合；在写入第一批数据前就要设计 Mapping。
- 查询 DSL 的常见骨架是：`match` 做全文匹配，`filter` 承载精确业务约束，`bool` 组合条件，`sort` 声明排序。

**下一篇**：从 Docker 启动 Elasticsearch 与 Kibana，完成健康检查、Kibana Dev Tools 调试和第一套 CRUD 请求。详见 {% post_link articles/Elasticsearch/02-elasticsearch-docker-kibana-crud 'Elasticsearch 从零到一（02）：Docker 启动、Kibana 与 CRUD 调试' %}。

> **思考与练习**
>
> 1. 找一个现有的文章或商品列表接口，标出哪些条件是全文匹配、哪些是精确过滤、哪些是排序规则。
> 2. 为“商品”设计一份 Mapping：商品名称、描述、品牌、分类、价格、库存、上架时间分别应该使用什么字段类型？
> 3. 用自己的三条标题画一份简化倒排表，再思考查询两个关键词时，是应该取交集还是并集。
