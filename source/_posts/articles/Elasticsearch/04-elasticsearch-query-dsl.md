---
title: Elasticsearch 从零到一（04）：Query DSL、相关性、高亮与组合检索
date: 2026-08-24 11:00:00
categories:
  - 教程
tags:
  - Elasticsearch
  - Query DSL
  - 相关性
  - 高亮
  - Java
description: 以 blog_articles 为例掌握 Elasticsearch 8.x request body search，覆盖 match、multi_match、短语、精确条件、bool 组合、评分、排序、_source、高亮、explain 与 Profile 诊断。
keywords:
  - Elasticsearch Query DSL
  - bool query
  - Elasticsearch relevance
  - Elasticsearch highlight
  - function_score
  - Elasticsearch profile
lang: zh-CN
---
> **适合人群**：已经创建 `blog_articles` Mapping，想把“用户关键词 + 业务筛选 + 排序展示”实现为可解释、可测试 Query DSL 的 Java 开发者。
> 本文使用 Elasticsearch 8.x request body search。查询字段必须与 Mapping 对应，不能脱离 `text`、`keyword` 和 analyzer 直接复制 JSON。
前两篇完成了环境和字段基础：{% post_link articles/Elasticsearch/02-elasticsearch-docker-kibana-crud '第 02 篇：Docker、Kibana 与 CRUD 调试' %}、{% post_link articles/Elasticsearch/03-elasticsearch-mapping-analysis-chinese '第 03 篇：Mapping、分词与中文搜索设计' %}。本篇将召回、过滤、评分、高亮和诊断组织成一个搜索接口。
## 一、request body search 的结果结构
搜索通常写为 `GET /blog_articles/_search`，也可以使用 POST 以兼容不支持 GET body 的 HTTP 客户端：
```http
GET /blog_articles/_search
{
  "query": { "match": { "title": "事务" } },
  "size": 10
}
```
响应中的 `hits.total` 是命中数，`hits.hits` 是当前页，`_source` 是业务文档，`_score` 是当前查询下的相关性分数。`_score` 会随查询、分析器、索引统计和分片变化，不能作为跨查询可比较的业务分数。
```json
{
  "hits": {
    "total": { "value": 2, "relation": "eq" },
    "hits": [{ "_id": "101", "_score": 1.42,
      "_source": { "id": 101, "title": "Spring Boot 事务失效的常见原因" } }]
  }
}
```
大结果集的 `total.relation` 可能是 `gte`，只表示达到某个下限。列表页不必总是精确计数；需要精确总数时显式设置 `track_total_hits: true`，同时了解统计成本。
## 二、全文查询：match、multi_match、match_phrase
### 2.1 `match` 让查询文本经过分析
`match` 用字段的 `search_analyzer` 处理自然语言，再到倒排索引召回：
```http
GET /blog_articles/_search
{
  "query": {
    "match": { "content": { "query": "事务 回滚", "operator": "and" } }
  }
}
```
默认 `operator` 是 `or`，任一词项命中即可；`and` 要求全部词项命中，召回更窄。中长中文输入可以用 `minimum_should_match`，而不是一律要求全部词：
```json
"match": {
  "content": {
    "query": "事务 代理 回滚 异常",
    "minimum_should_match": "75%"
  }
}
```
不要对 `text` 字段直接用 `term` 期待“用户搜索”。如果结果异常，先用 `_analyze` 对比索引期和查询期 token，再决定是否调整 analyzer 或条件。
### 2.2 `multi_match` 同时搜索标题和正文
```http
GET /blog_articles/_search
{
  "query": {
    "multi_match": { "query": "线程池", "fields": ["title^3", "content"] }
  }
}
```
`title^3` 表示标题信号更重要。常用类型有默认 `best_fields`（取一个字段的最佳匹配）、`most_fields`（累加多个字段信号）、`cross_fields`（把多个字段当组合字段）和 `phrase`（多字段短语）。字段 boost 是相对权重，不保证每次结果的分数按整数倍变化。
### 2.3 `match_phrase` 处理词项顺序和距离
```http
GET /blog_articles/_search
{
  "query": { "match_phrase": { "title": { "query": "Java 线程池", "slop": 1 } } }
}
```
`slop` 是 token 位置距离，不是字符编辑距离。中文分词后一个业务词可能对应多个 token，调大前先观察 positions。短语常作为加分而不是唯一召回条件：
```json
"bool": {
  "must": [
    { "match": { "content": "Java 线程池" } }
  ],
  "should": [
    { "match_phrase": { "title": { "query": "Java 线程池", "boost": 2 } } }
  ]
}
```
## 三、精确条件：term、terms、range、exists
`term` 不分析查询值，适合 keyword、数值、日期和布尔字段：
```json
"term": { "category": "Java" }
```
`terms` 表达一组完整值的 OR：
```json
"terms": { "category": ["Java", "Elasticsearch", "Spring Boot"] }
```
用户输入不能不加限制地传入 `terms`；Java 层应校验允许值和列表长度。若 category 是 text 或 normalizer 改变了大小写，先确认实际索引词项。
日期和数值范围使用 `range`：
```json
"range": {
  "publishedAt": {
    "gte": "2026-08-01T00:00:00Z",
    "lt": "2026-09-01T00:00:00Z"
  }
}
```
Java 接口应把用户日期和时区转换为明确的 `Instant` 区间，避免“当天 23:59:59”遗漏毫秒。`exists` 只判断是否有可索引值，不等同于业务上已经发布：
```json
"exists": { "field": "publishedAt" }
```
业务状态应使用明确的 `status` 字段，不要把字段存在性当作领域规则。
![图5：将召回、过滤、加分和排除拆进 bool 的四个槽位](bool-query-composition.svg)
## 四、bool：让每个条件各司其职
文章搜索常见目标是：关键词匹配标题或正文；分类、时间和租户必须通过；短语或标签命中加分；草稿排除。用 bool 把意图分开：
```http
GET /blog_articles/_search
{
  "query": {
    "bool": {
      "must": [{ "multi_match": { "query": "事务 代理", "fields": ["title^3", "content"] } }],
      "filter": [
        { "terms": { "category": ["Java", "Spring Boot"] } },
        { "range": { "publishedAt": { "gte": "2026-01-01" } } }
      ],
      "should": [
        { "match_phrase": { "title": { "query": "事务代理", "boost": 2 } } },
        { "term": { "tags": { "value": "AOP", "boost": 1.2 } } }
      ],
      "must_not": [{ "term": { "status": "draft" } }],
      "minimum_should_match": 0
    }
  }
}
```
- **must**：必须匹配并参与评分，通常承载全文召回。
- **filter**：必须通过但不计分，适合状态、分类、租户、时间和权限范围。
- **should**：命中后加分；若 bool 没有 must/filter，默认至少命中一个，复杂条件请显式设置 `minimum_should_match`。
- **must_not**：排除黑名单、草稿、软删除数据，不产生正向分数。
把精确条件全部塞进 must 会让过滤也参与评分；把租户 filter 完全交给前端则是越权风险。服务端必须强制注入不可绕过的权限条件。
## 五、相关性、boost 与 function_score
默认全文评分通常基于 BM25。直觉上，稀有词、词频、字段长度和各个子查询都会影响分数。它解决“当前搜索谁更像”，并不自动代表热门度、新鲜度或业务优先级。
字段和子查询可用 boost：
```json
"multi_match": {
  "query": "Spring 事务",
  "fields": ["title^4", "tags^2", "content"]
}
```
先修复召回、Mapping、分析器和 filter，再调 boost。调参要覆盖真实 query 日志中的短词、长句、同义词、零结果和跨分类样本，评价首条命中、点击和零结果率，而不是只看 `_score` 数字。
`function_score` 可把业务数值温和地合进相关性：
```http
GET /blog_articles/_search
{
  "query": {
    "function_score": {
      "query": { "multi_match": { "query": "事务", "fields": ["title^3", "content"] } },
      "field_value_factor": {
        "field": "viewCount", "modifier": "log1p", "factor": 0.2, "missing": 0
      },
      "boost_mode": "sum", "max_boost": 5
    }
  }
}
```
`field_value_factor` 适合浏览量等数值；`gauss` 等衰减函数可以表达发布时间或距离越近分越高。`max_boost` 防止热门度压过文本意图。热门信号会产生马太效应，应结合新鲜度、探索流量和业务指标评估。
![图6：Query DSL 从用户输入到相关性结果与高亮展示的链路](relevance-highlight-flow.svg)
## 六、排序、`_source` 与分页
默认按 `_score` 降序。需要稳定页面时声明完整 sort 并加 tie-breaker：
```http
GET /blog_articles/_search
{
  "query": { "match": { "content": "Elasticsearch" } },
  "sort": [
    { "_score": "desc" }, { "publishedAt": { "order": "desc", "missing": "_last" } }, { "id": "asc" }
  ],
  "_source": { "includes": ["id", "title", "category", "publishedAt", "tags"], "excludes": ["content"] }
}
```
`text` 不能直接排序，使用 `title.raw` 等 keyword multi-field。`_source` 过滤只缩小响应，不是权限脱敏；敏感数据仍要由 Mapping、权限和 Java DTO 共同控制。
小页码可用 `from/size`，深分页应使用 `search_after`：
```http
GET /blog_articles/_search
{
  "size": 20,
  "query": { "match_all": {} },
  "sort": [
    { "publishedAt": "desc" },
    { "id": "asc" }
  ],
  "search_after": ["2026-08-24T10:00:00.000Z", 101]
}
```
将上一页最后一个 hit 的 `sort` 数组作为下一页游标。数据持续写入时边界仍可能变化；需要一致快照时使用 Point in Time（PIT）并管理其 keep_alive。
## 七、高亮：在正确位置展示命中
```http
GET /blog_articles/_search
{
  "query": {
    "multi_match": {
      "query": "事务代理",
      "fields": ["title^3", "content"]
    }
  },
  "highlight": {
    "pre_tags": ["<mark>"],
    "post_tags": ["</mark>"],
    "fields": {
      "title": { "number_of_fragments": 0 },
      "content": {
        "fragment_size": 120,
        "number_of_fragments": 2,
        "no_match_size": 80
      }
    }
  }
}
```
标题用完整片段，正文返回有限片段，避免列表页携带全文。`highlight` 是包含标签的片段；前端必须采用白名单方式安全渲染，不能把它当可信 HTML。高亮不自然时检查分析器、词项、字段位置和 query，再配置 `require_field_match`、`boundary_scanner` 或 `matched_fields`。
## 八、`_explain` 与 Profile：让结果可诊断
`_explain` 分析特定文档为什么匹配、各分数从哪里来：
```http
GET /blog_articles/_explain/101
{
  "query": {
    "bool": {
      "must": [
        { "multi_match": { "query": "事务", "fields": ["title^3", "content"] } }
      ],
      "filter": [
        { "term": { "category": "Spring Boot" } }
      ]
    }
  }
}
```
它适合确认标题 boost、should 与 BM25 是否生效，但不能在生产接口中对每一条 hit 自动调用。对慢查询使用 `profile: true`：
```http
GET /blog_articles/_search
{
  "profile": true,
  "query": {
    "bool": {
      "must": [
        { "multi_match": { "query": "Elasticsearch 中文搜索", "fields": ["title^3", "content"] } }
      ],
      "filter": [
        { "range": { "publishedAt": { "gte": "now-30d" } } }
      ]
    }
  }
}
```
Profile 的 `query`、`rewrite_time` 等帮助定位哪个阶段耗时，但 Profile 自身会改变性能，且不包含网络、排队和所有磁盘等待。结合慢日志、节点指标、分片数量和真实流量建立基线再优化。
## 九、Java 服务如何组织查询
不要让前端传入任意 field name 或原始 DSL。服务端将参数转成白名单字段、限定分类列表和时间范围，再用官方 Java API Client 或 Spring Data 的 `NativeQuery` 构造 bool。核心约束是：
- 文本为空时定义清楚是 `match_all`、仅 filter，还是拒绝请求。
- 租户、权限和软删除 filter 由服务端强制加入。
- 排序字段、方向、分页大小都使用允许列表和上限。
- 最终请求 JSON、Mapping、典型命中与高亮响应应由集成测试覆盖。
一个可维护的调试顺序是：先用单 `match` 验证召回；加 `multi_match`；再加 filter；最后加 should、sort、`_source`、highlight。每一步保留请求与结果，使用 explain 回答“为什么排前”，Profile 回答“哪一段慢”。
## 十、总结与练习
Query DSL 的骨架是：`match`、`multi_match`、`match_phrase` 处理全文意图；`term`、`terms`、`range`、`exists` 表达结构化条件；bool 用 must、filter、should、must_not 清楚分工。相关性可通过 boost 与 function_score 融合业务信号，但它必须由真实数据验证。
稳定搜索还需要正确的排序与分页、受控 `_source`、安全高亮以及 explain/Profile 诊断。Java 应用应以 Mapping 为契约、以白名单构造查询、以集成测试保存关键请求和预期结果。
基础检索链路至此完整：{% post_link articles/Elasticsearch/01-elasticsearch-introduction '第 01 篇：全文检索与核心概念' %} → {% post_link articles/Elasticsearch/02-elasticsearch-docker-kibana-crud '第 02 篇：Docker、Kibana 与 CRUD 调试' %} → {% post_link articles/Elasticsearch/03-elasticsearch-mapping-analysis-chinese '第 03 篇：Mapping、分词与中文搜索设计' %} → 本篇。接下来进入搜索页工程化：{% post_link articles/Elasticsearch/05-elasticsearch-aggregations-pagination '第 05 篇：聚合、筛选面板与深分页方案' %}。
> **思考与练习**
>
> 1. 为 `blog_articles` 写“标题权重高、分类和时间过滤、短语加分、草稿排除”的查询，并用 explain 比较两篇文档。
> 2. 用 `search_after` 替换深分页，为日期相同的文档加入稳定 ID 排序，验证翻页不重复。
> 3. 增加 `_source` includes 和正文高亮，设计前端安全渲染 highlight 片段的响应 DTO。
> 4. 使用 Profile 比较分类进入 must 与 filter 的表现；结合慢日志写出一次可复现的优化结论。
