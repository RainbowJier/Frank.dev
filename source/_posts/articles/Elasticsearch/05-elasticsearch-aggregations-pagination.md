---
title: Elasticsearch 从零到一（05）：聚合、筛选面板与深分页方案
date: 2026-08-25 10:00:00
categories:
  - 教程
tags:
  - Elasticsearch
  - 聚合
  - 分页
  - Query DSL
  - Java
description: 面向 Java 开发者讲解 Elasticsearch 8.x 的桶聚合、指标聚合、搜索筛选面板，以及 from 加 size、search_after、PIT 和 Scroll 的分页边界。
keywords:
  - Elasticsearch 聚合
  - Elasticsearch 筛选面板
  - search_after
  - Point in Time
  - Elasticsearch 深分页
lang: zh-CN
---
> **适合人群**：已经能写 `bool`、`match`、`term` 和排序条件，希望实现搜索页筛选面板、统计趋势与稳定翻页的 Java 开发者。
> 本文沿用 `blog_articles` 索引。示例基于 Elasticsearch 8.x；聚合面对的是已命中的文档集合，而不是关系型数据库中任意的联表结果。
在 {% post_link articles/Elasticsearch/04-elasticsearch-query-dsl 'Elasticsearch 从零到一（04）：Query DSL、相关性与高亮搜索' %} 中，查询 DSL 解决了“哪些文章应该被命中”。 搜索页通常还要回答另一组问题：命中文档按什么分类、不同标签各有多少篇、发布时间如何变化、作者平均阅读量是多少，以及用户翻到很后面时如何保证结果稳定。
## 一、先区分命中、桶与指标
一次 `_search` 响应有三种常被混淆的数据：
- `hits` 是具体文档，用于渲染文章卡片或列表。
- bucket aggregation（桶聚合）把命中的文档按字段或规则分组。
- metric aggregation（指标聚合）从一个文档集合计算数值。
可以把它类比成一条 SQL 同时返回明细和 `GROUP BY` 统计，但 ES 会在各分片上先计算局部聚合，再由协调节点合并。 因此，字段 Mapping 和 bucket 数量都会直接影响延迟与内存消耗。
![图1：在 blog_articles 上由全局查询、分桶和指标组成的聚合树](aggregation-tree.svg)
假设文档结构中除了前文的字段，还包含阅读与状态字段：
```json
PUT /blog_articles/_doc/201
{   "id": 201,
"title": "Spring Boot 配置绑定实践",   "content": "使用配置属性完成类型安全的参数绑定。",
"category": "Spring Boot",   "tags": ["配置", "Java"],
"status": "PUBLISHED",   "viewCount": 1830,
"publishedAt": "2026-08-20T09:30:00Z"
}
```
为了让分类、标签和状态可用于聚合，它们应是 `keyword` 字段。 数值应使用 `integer`、`long`、`double` 等数值类型，时间应使用 `date`；不要尝试在 `text` 字段上直接聚合。 如果确实保留了 `title` 的多字段，可对 `title.keyword` 做精确聚合，但“标题有多少种”通常没有业务意义。
## 二、桶聚合：把结果集切成可解释的分组
### 2.1 `terms`：分类、标签和状态的高频选择
`terms` 按字段值产生多个桶，是搜索筛选面板最常见的基础。 下面的请求只返回前 10 个分类桶，文档明细设为 `size: 0`，避免为统计场景取回无用 `_source`：
```json
GET /blog_articles/_search
{ "size": 0, "query": { "term": {
"status": "PUBLISHED" } }, "aggs": {
"category_counts": { "terms": { "field": "category", "size": 10,
"order": { "_count": "desc" } }
}, "tag_counts": { "terms": { "field": "tags",
"size": 20 } } }
}
```
响应的重点在 `aggregations`，而不是 `hits.hits`：
```json
{
"aggregations": {     "category_counts": {
"buckets": [         { "key": "Java", "doc_count": 42 },
{ "key": "Spring Boot", "doc_count": 35 }       ]
}   }
}
```
`key` 是桶值，`doc_count` 是符合外层 `query` 且字段落入该桶的文档数。 数组字段 `tags` 会让一篇带有两个标签的文章分别计入两个桶；这不是重复文档，而是多值字段的正常语义。
不要盲目把 `size` 调得很大。 `terms` 默认只取每个分片的候选桶再合并，长尾、高基数字段可能出现 `sum_other_doc_count` 或 `doc_count_error_upper_bound`。 筛选面板通常应限制为少量业务维度；要枚举全部唯一值，应重新评估字段模型和接口需求。
### 2.2 `range`：将连续数值变成产品可读区间
价格、阅读量、评分等连续值不适合直接展示为无数个 `terms` 桶。 `range` 允许把它们切成预定义区间，边界是“下含上不含”，最后一个区间可省略 `to`：
```json
GET /blog_articles/_search
{   "size": 0,
"aggs": {     "view_ranges": {
"range": {         "field": "viewCount",
"ranges": [           { "key": "0-99", "to": 100 },
{ "key": "100-999", "from": 100, "to": 1000 },           { "key": "1000+", "from": 1000 }
]       }
}   }
}
```
产品可以将 `0-99`、`100-999`、`1000+` 直接作为筛选文案，但筛选请求本身仍应用对应的 `range` query。 聚合名称、桶的 `key` 和接口字段最好固定，避免前端把展示文本反向解析成查询条件。
### 2.3 `date_histogram`：按固定时间粒度观察趋势
`date_histogram` 根据日期字段按日、周、月或日历周期生成桶。 文章发布趋势使用 `calendar_interval: "month"` 更符合自然月含义：
```json
GET /blog_articles/_search
{ "size": 0, "query": { "range": {
"publishedAt": { "gte": "2026-01-01", "lt": "2027-01-01" }
} }, "aggs": { "monthly_publications": {
"date_histogram": { "field": "publishedAt", "calendar_interval": "month", "min_doc_count": 0,
"extended_bounds": { "min": "2026-01-01", "max": "2026-12-31" }
} }
} }
```
`min_doc_count: 0` 与 `extended_bounds` 让没有文章的月份也返回零值桶，折线图不会因此断开。 如果业务要求每 15 分钟、每 6 小时这类绝对时长，请使用 `fixed_interval`，不要把它和受时区、夏令时影响的 `calendar_interval` 混为一谈。
## 三、指标聚合：在桶内计算数值
指标聚合不会分组，而是对当前文档集合计算一个结果。 最常用的五种是 `avg`、`sum`、`min`、`max` 和 `cardinality`：
```json
GET /blog_articles/_search
{   "size": 0,
"query": {     "term": {
"status": "PUBLISHED"     }
},   "aggs": {
"avg_views": { "avg": { "field": "viewCount" } },     "total_views": { "sum": { "field": "viewCount" } },
"min_views": { "min": { "field": "viewCount" } },     "max_views": { "max": { "field": "viewCount" } },
"distinct_categories": { "cardinality": { "field": "category" } }   }
}
```
`avg`、`sum`、`min`、`max` 返回 `value`，空集合或字段缺失时的行为要在接口层处理。 `cardinality` 用 HyperLogLog++ 估算去重数量，速度和内存表现通常很好，但它不是任意规模下的绝对精确计数。 当页面显示“约有多少作者”时可用它；当结算、配额等业务必须精确时，应回到事实库或专门的精确模型。
桶可以继续嵌套指标。 例如按分类统计文章数和平均阅读量：
```json
GET /blog_articles/_search
{ "size": 0, "aggs": { "by_category": {
"terms": { "field": "category", "size": 10 },
"aggs": { "average_views": { "avg": { "field": "viewCount"
} } } }
} }
```
嵌套层级越深、桶越多，协调节点合并的工作越重。 先从“面板真正展示哪些桶”倒推请求，而不是把所有字段和统计一次性塞进一个万能接口。
## 四、查询过滤与聚合过滤：筛选面板的关键边界
搜索页通常有关键词、分类、标签、年份等条件。 最简单的规则是：外层 `query` 里的过滤同时影响文档命中和全部聚合。 例如选择了 `category = Java` 后，分类聚合只剩 Java；这在统计“当前结果集”时完全正确，却不能给用户展示其他可切换分类。
### 4.1 `query` 过滤：结果和统计都收窄
下面请求中，关键词和状态作为全局条件，分类选择也进入 `filter`。 `hits` 与所有 buckets 都只针对已选分类：
```json
GET /blog_articles/_search
{ "query": { "bool": { "must": [
{ "match": { "title": "Spring" } } ], "filter": [ { "term": { "status": "PUBLISHED" } },
{ "term": { "category": "Spring Boot" } } ] } },
"aggs": { "categories": { "terms": { "field": "category", "size": 10 } }
} }
```
适合“统计本次已筛选结果”的后台报表。 但通用搜索面板往往期望分类桶保留当前关键词下的其他分类数量。
### 4.2 `post_filter`：先聚合，再只收窄命中列表
将面板选择条件移到 `post_filter` 后，外层 query 仍负责关键词与公共约束。 聚合先基于公共结果计算，最终 `hits` 再应用用户已选择的分类：
```json
GET /blog_articles/_search
{   "query": {
"bool": {       "must": [
{ "match": { "title": "Spring" } }       ],
"filter": [         { "term": { "status": "PUBLISHED" } }
]     }
},   "post_filter": {
"term": {       "category": "Spring Boot"
}   },
"aggs": {     "categories": {
"terms": { "field": "category", "size": 10 }     },
"tags": {       "terms": { "field": "tags", "size": 20 }
}   }
}
```
`post_filter` 的核心语义是：**只影响 hits，不影响 aggregation。** 它适合一个或少数维度需要“保留未选择选项计数”的搜索页，但不能把所有条件都不加区分地塞进去。 例如状态、权限、租户隔离必须进入 `query.filter`，否则聚合会泄漏不应展示的统计信息。
![图2：浅分页、search_after 加 PIT 与 Scroll 的使用边界对比](pagination-comparison.svg)
更复杂的面板可使用 `filter` aggregation：每个面板聚合自行排除“本面板的已选项”，但保留其他面板选择。 这种做法表达力更强，也更难维护；应先把“哪些条件影响计数、哪些只影响列表”写成接口契约，再实现 DSL。
一个适合前端消费的响应可以裁剪为：
```json
{
"total": { "value": 128, "relation": "eq" },   "items": [
{ "id": 201, "title": "Spring Boot 配置绑定实践" }   ],
"filters": {     "categories": [
{ "value": "Java", "count": 42, "selected": false },       { "value": "Spring Boot", "count": 35, "selected": true }
],     "tags": [
{ "value": "配置", "count": 18, "selected": false }     ]
}
}
```
ES 原始聚合结构不一定等于对外 API。 在 Java 服务层统一翻译 bucket、空值、显示顺序和选中态，能避免前端依赖内部聚合名称，也方便后续更换统计策略。
## 五、分页不是只加 `from` 与 `size`
### 5.1 浅分页：`from` + `size`
最常见的分页请求如下：
```json
GET /blog_articles/_search
{   "from": 20,
"size": 10,   "query": {
"term": {       "status": "PUBLISHED"
}   },
"sort": [     { "publishedAt": "desc" },
{ "id": "desc" }   ]
}
```
第 3 页为 `from = 20`、`size = 10`。 它适合普通列表前几页，却不适合让用户跳到几万条之后：各分片都要准备 `from + size` 个候选，再由协调节点合并、排序、丢弃前面的结果。
ES 默认还受 `index.max_result_window`（通常为 10,000）保护。 不要为了“支持任意页码”直接调大这个阈值；深分页压力会随偏移量增大，且数据刷新时会产生重复或漏项。
### 5.2 `search_after`：用上一页排序值向后游标化
`search_after` 不接收页号，而接收上一页最后一个 hit 的 `sort` 数组。 排序必须稳定且唯一，常见写法是业务时间字段加 `id` 作为并列打破字段：
```json
GET /blog_articles/_search
{   "size": 20,
"query": {     "term": {
"status": "PUBLISHED"     }
},   "sort": [
{ "publishedAt": "desc" },     { "id": "desc" }
],   "search_after": ["2026-08-20T09:30:00Z", 201]
}
```
服务端应把最后一条文档的 `sort` 值编码成不透明 cursor 返回给前端，而不是让前端拼 ES 字段名。 它天然适合“下一页”和无限滚动，不擅长“直接跳到第 500 页”或随机回跳。
### 5.3 PIT：为连续翻页固定一个查询视图
索引在用户翻页期间可能 refresh、写入或删除文档。 Point in Time（PIT）固定的是查询时所见的分片视图，不是把所有数据复制一份到内存；它常与 `search_after` 配合以避免翻页漂移。
先创建 PIT：
```json
POST /blog_articles/_pit?keep_alive=1m
```
后续请求使用响应中的 PIT ID，并留意每次 search 响应可能返回新的 `pit_id`，应将它作为下一次 cursor 状态的一部分：
```json
POST /_search
{   "size": 20,
"pit": {     "id": "PIT_ID_FROM_PREVIOUS_RESPONSE",
"keep_alive": "1m"   },
"sort": [     { "publishedAt": "desc" },
{ "id": "desc" }   ],
"search_after": ["2026-08-20T09:30:00Z", 201]
}
```
结束、超时或用户取消浏览后，应显式关闭 PIT：
```json
DELETE /_pit
{   "id": "PIT_ID_TO_CLOSE"
}
```
PIT 会保留相关历史段和删除标记，`keep_alive` 不是越长越好。 为 API 设置合理最大存活时间、限制并发 cursor 数量，并在异常路径关闭，是生产环境的基本保护。
### 5.4 Scroll：只用于批量遍历，不用于用户翻页
Scroll 创建可持续读取的大结果集快照，典型用途是离线导出、迁移和批处理：
```json
POST /blog_articles/_search?scroll=1m
{   "size": 500,
"sort": ["_doc"],   "query": {
"term": {       "status": "PUBLISHED"
}   }
}
```
随后将首个响应的 `_scroll_id` 传给 `/_search/scroll`，直到 `hits.hits` 为空，并使用 `/_search/scroll` 的 DELETE 接口清理上下文。 Scroll 持有服务端搜索上下文、结果排序也不面向交互体验；用户搜索页请优先 `search_after` + PIT。
## 六、性能与接口设计清单
1. 为筛选和聚合字段建好 `keyword`、数值、日期 Mapping，避免对 `text` 开启昂贵 fielddata。
2. 设定每个 `terms` aggregation 的合理 `size`，控制嵌套桶与高基数字段。
3. 将权限、租户、状态等安全边界放进 `query.filter`，不要误用 `post_filter`。
4. 普通后台列表使用受限的 `from` + `size`；连续深翻使用带稳定排序的 `search_after` + PIT。
5. 把 PIT ID、排序游标封装成短期 cursor，校验调用者和查询条件，过期时返回明确的重新搜索提示。
6. 导出任务走异步批处理和 Scroll，记录进度、支持取消，不要复用在线搜索接口。
## 七、总结与练习
- `terms`、`range`、`date_histogram` 负责分桶；`avg`、`sum`、`min`、`max`、`cardinality` 负责在集合或桶内计算指标。
- 外层 `query` 同时约束 hits 和 aggregation；`post_filter` 只在聚合之后收窄 hits，是构建筛选面板时的重要工具。
- `from` + `size` 只适合浅分页；深翻应采用稳定排序、`search_after` 与 PIT 组成的游标协议。
- Scroll 面向离线遍历，不应成为用户可点击分页的底层实现。
> **思考与练习**
>
> 1. 为 `blog_articles` 设计“分类、标签、月份、阅读量区间”四个筛选项，标明哪些应走 `terms`、`date_histogram`、`range`。
> 2. 选择分类后，分类面板应显示其他分类数量还是只显示当前分类？分别用 `post_filter` 和 `filter` aggregation 画出请求边界。
> 3. 为无限滚动 API 设计一个 Base64 cursor，至少包含 PIT ID、最后一条排序值和查询条件摘要；思考如何拒绝篡改的 cursor。
**下一篇预告**：查询 DSL 需要可靠地落到 Java 服务中。接下来会用官方 Java API Client 配置 Spring Boot、构建类型化请求、解析高亮和聚合响应。详见 {% post_link articles/Elasticsearch/06-elasticsearch-java-client-springboot 'Elasticsearch 从零到一（06）：Spring Boot 整合与 Java API Client 实战' %}。
