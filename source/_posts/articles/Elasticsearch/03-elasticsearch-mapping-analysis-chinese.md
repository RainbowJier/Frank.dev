---
title: Elasticsearch 从零到一（03）：Mapping、分词与中文搜索设计
date: 2026-08-24 10:40:00
categories:
  - 教程
tags:
  - Elasticsearch
  - Mapping
  - 中文分词
  - IK
  - Java
description: 从显式 Mapping 与动态 Mapping 出发，系统讲解 text、keyword、数值、日期、object、nested、geo_point、多字段和分析器，并用 IK 设计中文 blog_articles 搜索索引。
keywords:
  - Elasticsearch Mapping
  - Elasticsearch 中文分词
  - IK analyzer
  - ik_smart
  - ik_max_word
  - Elasticsearch reindex
lang: zh-CN
---
> **适合人群**：已经能写入 `blog_articles`，想弄清字段为什么无法聚合、中文为什么搜不到，以及如何让 Java DTO 与 ES 索引保持稳定契约的开发者。
> 文章采用 ES 8.x 语法。分析插件、Java 客户端和服务端必须核对版本兼容性；不要把旧版教程中的插件坐标直接用于当前容器。
上一章完成 Docker、Kibana 与 CRUD：{% post_link articles/Elasticsearch/02-elasticsearch-docker-kibana-crud '第 02 篇：Docker、Kibana 与 CRUD 调试' %}。这一篇解决搜索质量的地基：**Mapping 决定字段怎么建索引，Analysis 决定字符串变成哪些词项。**
## 一、显式 Mapping 是搜索契约
ES Document 虽然是 JSON，但不能只按“保存 JSON”来设计。标题需要按词召回，分类按完整值过滤，发布时间按范围比较，地点按距离筛选；不同查询意图对应不同字段类型。
```http
PUT /blog_articles_v2
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "dynamic": "strict",
    "properties": {
      "id": { "type": "long" },
      "title": {
        "type": "text",
        "fields": { "raw": { "type": "keyword" } }
      },
      "content": { "type": "text" },
      "category": { "type": "keyword" },
      "tags": { "type": "keyword" },
      "publishedAt": { "type": "date" },
      "viewCount": { "type": "integer" },
      "author": {
        "properties": {
          "id": { "type": "long" },
          "name": { "type": "keyword" }
        }
      },
      "location": { "type": "geo_point" }
    }
  }
}
```
`dynamic: strict` 让未声明字段失败，能尽早发现 Java DTO 拼写错误和不受控 JSON。也可以使用 `dynamic: false` 保留未知字段到 `_source` 却不索引，或使用动态模板限定一类字段；核心业务索引不应无限制 `dynamic: true`。
![图3：Character Filter、Tokenizer 与 Token Filter 的分析顺序](analysis-pipeline.svg)
### 1.1 动态 Mapping 的便利与风险
ES 会从首次写入的值推断类型：整数倾向于 `long`，日期字符串可能成为 `date`，普通字符串通常推断为 `text` 加 `keyword` 子字段。探索数据时很方便，但第一条样本会锁定类型；`viewCount` 先写字符串、后写数字，或者任意 key 不断进入 Mapping，都可能造成解析失败或字段爆炸。
动态模板把“默认规则”显式化：
```json
PUT /article_template_demo
{
  "mappings": {
    "dynamic_templates": [
      {
        "strings_as_keywords": {
          "match_mapping_type": "string",
          "mapping": { "type": "keyword", "ignore_above": 256 }
        }
      }
    ]
  }
}
```
模板不代替设计。标题正文仍要显式 `text`，金额、时间和地理字段也不应由偶然样本决定。
## 二、字段类型要服务查询方式
| 类型 | `blog_articles` 字段 | 主要用途 | 典型查询 |
| --- | --- | --- | --- |
| `text` | `title`、`content` | 分析后的全文检索 | `match`、短语、高亮 |
| `keyword` | `category`、`tags` | 完整值、聚合、排序 | `term`、`terms` |
| 数值 | `viewCount`、`price` | 比较和统计 | `range`、排序、聚合 |
| `date` | `publishedAt` | 时间范围与排序 | `range`、日期聚合 |
| `object` | `author` | 简单对象属性 | `author.id` 过滤 |
| `nested` | `contacts` | 对象数组内关联 | `nested` query |
| `geo_point` | `location` | 经纬度与距离 | `geo_distance` |
### 2.1 `text`、`keyword` 与 multi-fields
`text` 把字符串交给 analyzer，适合“事务”“线程池”这类用户词；`keyword` 把完整值作为一个词项，适合分类、标签、状态、编号。标题通常同时需要两种能力：
```json
"title": {
  "type": "text",
  "analyzer": "ik_max_word",
  "search_analyzer": "ik_smart",
  "fields": {
    "raw": { "type": "keyword" }
  }
}
```
这就是 multi-fields：写一次 `_source.title`，同时得到 `title` 全文索引和 `title.raw` 精确排序/聚合字段。不要对 `text` 直接做 `term`，也不要对标题全文只建 `keyword`。`keyword` 需要忽略大小写时，可加 normalizer；normalizer 不会产生多个 token，不能替代中文 analyzer。
### 2.2 数值和日期
浏览量通常是 `integer` 或 `long`。金额可以用 `scaled_float`，例如 `scaling_factor: 100` 把两位小数转为整数索引，避免浮点精度陷阱。
```json
"price": { "type": "scaled_float", "scaling_factor": 100 },
"publishedAt": {
  "type": "date",
  "format": "strict_date_optional_time||epoch_millis"
}
```
不要把数字存为 keyword：字符串排序会把 `100` 排到 `20` 前。Java 与 ES 应统一使用 `Instant` 或带 offset 的时间；无时区日期必须先在接口层转换为明确区间。
### 2.3 `object` 与 `nested` 的关键差别
普通对象适合单值关联：
```json
"author": {
  "properties": {
    "id": { "type": "long" },
    "name": { "type": "keyword" }
  }
}
```
对象数组会被普通 `object` 扁平化。若 `contacts` 同时包含 Frank 的 email 和 Ada 的 phone，`name=Frank AND type=phone` 可能跨数组元素误命中。要保持一个数组元素内部的字段关系，使用 `nested`：
```json
"contacts": {
  "type": "nested",
  "properties": {
    "name": { "type": "keyword" },
    "type": { "type": "keyword" },
    "value": { "type": "keyword" }
  }
}
```
此时查询也必须是 `nested` query 并声明 `path`。`nested` 创建额外 Lucene 文档，只有存在“同一个对象的多字段必须一起满足”需求时使用。
### 2.4 `geo_point`
```json
"location": { "type": "geo_point" }
```
它支持 `{ "lat": 31.2304, "lon": 121.4737 }` 以及距离过滤、距离排序。经纬度顺序与范围应在 Java 入参校验阶段确认，不能指望前端从不传反。
![图4：中文文章索引的字段类型与查询职责分工](chinese-field-design.svg)
## 三、Analyzer：字符串如何变成词项
一个 analyzer 通常经过三段：
1. **Character Filter**：分词前清理 HTML、字符映射等。
2. **Tokenizer**：切分 token，是文本边界的核心。
3. **Token Filter**：小写化、停用词、同义词、词干等后处理。
索引期结果写入倒排索引，查询期也会分析用户输入。两边可以不同，但查询期必须产出可与索引期匹配的词项；改了 analyzer 却不重建旧数据，往往就是“文本存在但搜不到”的根源。
### 3.1 `_analyze` 不要靠猜
```http
POST /_analyze
{
  "analyzer": "standard",
  "text": "Spring Boot 事务失效的常见原因"
}
POST /blog_articles_v2/_analyze
{
  "field": "title",
  "text": "Java工程师喜欢用Elasticsearch做中文搜索"
}
```
观察响应中的 `token`、`position` 和 offset。短语查询、高亮和同义词问题都要先看真实 token，再修改 Query DSL；不要盲目调 boost。
### 3.2 内置 analyzer 的边界
`standard` 适合通用 Unicode 切分，`whitespace` 仅按空格，`keyword` 把整个输入当一个 token。英文和标识符可用自定义组合：
```json
"analysis": {
  "analyzer": {
    "article_index": {
      "type": "custom",
      "tokenizer": "standard",
      "filter": ["lowercase", "asciifolding"]
    }
  }
}
```
这些过滤器不能完成高质量中文切词。中文搜索需要专门 tokenizer，例如安装并正确维护的 IK。
## 四、IK 分词与中文字段设计
IK Analysis 是常见社区插件，通常提供：
- `ik_smart`：偏粗粒度，词项较少，常用于查询期。
- `ik_max_word`：偏细粒度，词项更多、召回更宽，常用于索引期。
一个常见但非唯一的折中是：
```http
PUT /blog_articles_ik
{
  "settings": {
    "analysis": {
      "analyzer": {
        "ik_index": { "type": "custom", "tokenizer": "ik_max_word" },
        "ik_search": { "type": "custom", "tokenizer": "ik_smart" }
      }
    }
  },
  "mappings": {
    "properties": {
      "title": {
        "type": "text",
        "analyzer": "ik_index",
        "search_analyzer": "ik_search",
        "fields": { "raw": { "type": "keyword" } }
      },
      "content": {
        "type": "text",
        "analyzer": "ik_index",
        "search_analyzer": "ik_search"
      }
    }
  }
}
```
IK 不是“中文开关”。标题、正文、标签和搜索建议的目标不同；用真实 query 日志比较召回、误召回和高亮，才能决定粒度。安装时应制作与 ES 完全匹配的自定义镜像，锁定插件版本并在 CI 用 `_analyze` 验证。插件 URL、压缩包和版本必须从 IK 的官方发布渠道核对，不能复制不明镜像。
### 4.1 自定义词典和同义词
通用词典不知道公司名、框架名、产品型号和业务缩写。自定义词典需要版本、审批、节点一致性、更新发布和回滚流程；改变索引期切词后，还可能需要重建历史文档。
同义词能够增加召回，例如业务上确实等价的别名。但展开过宽会产生误召回：将“必须同义的正式别名”和“内容相关的推荐词”分开。查询期同义词通常比索引期更容易更新；短语语义使用与当前版本匹配的 `synonym_graph`，并始终用 `_analyze` 验证位置关系。
## 五、Mapping 改错后为什么要 reindex
`keyword` 不能直接变成 `text`，已索引 `text` 的 analyzer 也不能原地更换。倒排索引已经按旧规则写好；修改配置不会重新计算历史 token。正确做法是建新索引、复制、验证、切 Alias：
```http
PUT /blog_articles_v3
{
  "mappings": {
    "properties": {
      "id": { "type": "long" },
      "title": {
        "type": "text",
        "analyzer": "ik_max_word",
        "search_analyzer": "ik_smart",
        "fields": { "raw": { "type": "keyword" } }
      },
      "content": { "type": "text", "analyzer": "ik_max_word" },
      "category": { "type": "keyword" },
      "publishedAt": { "type": "date" }
    }
  }
}
POST /_reindex
{
  "source": { "index": "blog_articles" },
  "dest": { "index": "blog_articles_v3" }
}
```
`_reindex` 只是一次复制，不会持续同步。线上写入不停时需暂停写、双写或按更新时间补偿，并校验数量、ID、抽样查询和错误项。验证完成后用 Alias 切读流量：
```http
POST /_aliases
{
  "actions": [
    { "remove": { "alias": "blog_articles_read", "index": "blog_articles" } },
    { "add": { "alias": "blog_articles_read", "index": "blog_articles_v3" } }
  ]
}
```
Java 代码应访问 Alias 或集中配置，不要将版本索引名散落在 Repository 和业务逻辑中。
## 六、Java 验证与排障顺序
为关键 Mapping 写集成测试：创建索引、`_analyze`、写文章、执行全文/精确/日期/nested 查询。至少断言标题中文可命中、`title.raw` 可排序、未知字段在 strict 下失败、日期时区正确，以及 nested 条件不会跨对象串联。
遇到“搜不到”按顺序查：
1. 文档是否在目标 Index，`GET /index/_doc/id`。
2. `_source` 是否真的有字段值，Mapping 的字段类型是否正确。
3. 索引期和查询期 token 分别是什么，使用 `_analyze`。
4. 是否对 text 错用了 `term`，是否还未 refresh。
5. 是否被 bool filter、权限或时间范围排除了。
6. 修改过 analyzer 或类型时，是否已经在新索引完成 reindex。
这个顺序先验证数据和契约，再验证分词和查询，比直接调相关性参数更高效。
## 七、总结与练习
Mapping 是搜索索引的长期契约。`text` 服务全文检索，`keyword` 服务精确筛选、排序与聚合；数值、日期、object、nested、geo_point 都对应具体查询模型。multi-fields 让一个业务值兼顾全文与精确使用。
中文搜索的质量取决于 analyzer 的三段式过程和词典设计。IK 的 `ik_smart`、`ik_max_word` 代表不同粒度，不是固定最佳答案；插件版本、词典、同义词和 `_analyze` 必须一起管理。类型或 analyzer 的不兼容变更通常要新建索引、reindex、用 Alias 切换。
下一篇：{% post_link articles/Elasticsearch/04-elasticsearch-query-dsl '第 04 篇：Query DSL、相关性、高亮与组合检索' %}。
> **思考与练习**
>
> 1. 比较 `standard`、`ik_smart`、`ik_max_word` 对五条真实中文标题的 token，记录过度切分和漏切词。
> 2. 为 `title` 增加 `title.raw`，分别用 `match`、`term` 与排序验证字段差异。
> 3. 构造 nested 作者数组，证明“同一对象满足条件”和“两个对象拼接满足”的查询差别。
> 4. 创建 `blog_articles_v3` 并 reindex，用 Alias 切读索引，为切换前后写 Java 集成测试。
