---
title: Elasticsearch 从零到一（02）：Docker 启动、Kibana 与 CRUD 调试
date: 2026-08-24 10:20:00
categories:
  - 教程
tags:
  - Elasticsearch
  - Docker
  - Kibana
  - CRUD
  - Java
description: 使用 Docker Compose 启动 Elasticsearch 8.x 与 Kibana，完成健康检查、认证配置、Dev Tools 和 curl 调试，并围绕 blog_articles 演示索引、文档与 Bulk CRUD。
keywords:
  - Elasticsearch Docker
  - Kibana Dev Tools
  - Elasticsearch CRUD
  - Elasticsearch Bulk
  - Elasticsearch 8.x
lang: zh-CN
---
> **适合人群**：已经理解 Index、Document 与 Mapping，准备在本机启动 ES 8.x、从 HTTP 请求开始调试的 Java 开发者。
> 本文是隔离的开发环境方案。单节点、关闭安全或弱密码都不能直接带到共享环境和生产集群。
上一篇建立了基本模型：{% post_link articles/Elasticsearch/01-elasticsearch-introduction '第 01 篇：全文检索与核心概念' %}。本篇用 Docker Compose 启动 ES 与 Kibana，并围绕 `blog_articles` 跑通建索引、写文档、查询、更新、删除与批量写入。
## 一、开发拓扑与边界
浏览器、curl、IDEA HTTP Client 或 Java 程序通过 `9200` 调用 ES REST API；Kibana 的 `5601` 提供 Dev Tools。数据目录要挂载 Docker volume，否则删除容器会丢掉索引。
![图1：开发环境中客户端、Elasticsearch 与 Kibana 的连接关系](docker-topology.svg)
单节点没有真正副本高可用。若索引副本数为 1，集群可能显示 yellow，因为没有第二个节点安放副本；主分片正常时，开发环境可接受。`red` 则表示至少有主分片不可用，必须排查。
ES 8.x 默认启用用户名、密码和 TLS。为使第一次练习聚焦 API，下面关闭安全；它只应监听 `127.0.0.1`。需要接近生产的本地环境时，应保留安全、使用 `elastic` 密码和 CA 证书，而不是把端口公开后再补救。
## 二、Docker Compose 启动 ES + Kibana
在博客仓库外的练习目录创建 `docker-compose.yml`，固定 ES 与 Kibana 为相同版本：
```yaml
services:
  es:
    image: docker.elastic.co/elasticsearch/elasticsearch:8.15.3
    container_name: es-dev
    environment:
      - discovery.type=single-node
      - xpack.security.enabled=false
      - ES_JAVA_OPTS=-Xms1g -Xmx1g
    ports:
      - "127.0.0.1:9200:9200"
    volumes:
      - es-data:/usr/share/elasticsearch/data
    healthcheck:
      test: ["CMD-SHELL", "curl -fs http://localhost:9200/_cluster/health || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 20
  kibana:
    image: docker.elastic.co/kibana/kibana:8.15.3
    container_name: kibana-dev
    environment:
      - ELASTICSEARCH_HOSTS=http://es:9200
    ports:
      - "127.0.0.1:5601:5601"
    depends_on:
      es:
        condition: service_healthy
volumes:
  es-data:
```
`discovery.type=single-node` 避免 ES 等待其他节点加入；`ES_JAVA_OPTS` 给 JVM 固定最小和最大堆；`es-data` 让重启保留数据。Docker Desktop 也要有足够内存，1 GB 只是轻量练习的起点，不是生产建议。
启动并观察：
```bash
docker compose up -d
docker compose ps
docker compose logs -f es
docker compose logs -f kibana
```
停止用 `docker compose stop`，再次使用数据时执行 `start`。`down` 删除容器和网络；确认练习数据可丢弃后才删除卷。排障时不要先删卷，它会抹去最有价值的日志和复现现场。
## 三、健康检查、密码与端口
ES 就绪后验证版本和健康度：
```bash
curl -s http://127.0.0.1:9200
curl -s http://127.0.0.1:9200/_cluster/health?pretty
curl -fsS 'http://127.0.0.1:9200/_cluster/health?wait_for_status=yellow'
```
检查 `status`、`number_of_nodes`、`active_primary_shards` 与 `unassigned_shards`。本例将练习索引副本设为 0，可避免单节点副本导致的 yellow；生产集群不能因此关闭副本。
若保留默认安全配置，curl 必须同时使用凭据和 CA：
```bash
curl -u elastic:你的密码 https://127.0.0.1:9200 \
  --cacert http_ca.crt
```
不要在脚本、Git、终端历史或文章中写入真实密码。不要长期使用 `-k` 跳过证书校验。Kibana 在安全模式下也需要 enrollment token 或正确的连接配置；容器内访问 ES 应使用 `http://es:9200` 或对应 HTTPS 服务名，不是宿主机 `127.0.0.1`。
## 四、Dev Tools 与 curl 如何配合
访问 <http://127.0.0.1:5601>，进入 **Management → Dev Tools**。Console 可以直接写 `GET /_cat/indices?v`，自动格式化 JSON、保存历史并补全 API；初学时适合逐条观察 Mapping 和响应。
curl 更适合启动探针、脚本化复现和确认 HTTP 层问题：
```bash
curl -s http://127.0.0.1:9200/_cat/indices?v
curl -s -X GET http://127.0.0.1:9200/blog_articles/_mapping?pretty
```
两者调用的是同一 API。推荐流程是：先在 Dev Tools 得到可复现请求，再放入 Java 集成测试或客户端代码。遇到错误时记录 HTTP 状态、ES `type`、`reason`、索引名和完整脱敏请求体。
## 五、先创建明确的 `blog_articles`
本地反复练习时可先删除旧索引；这条命令会删除数据，只能对明确的练习索引执行：
```http
DELETE /blog_articles
PUT /blog_articles
{
  "settings": {
    "number_of_shards": 1,
    "number_of_replicas": 0
  },
  "mappings": {
    "properties": {
      "id": { "type": "long" },
      "title": { "type": "text" },
      "content": { "type": "text" },
      "category": { "type": "keyword" },
      "tags": { "type": "keyword" },
      "publishedAt": { "type": "date" },
      "viewCount": { "type": "integer" },
      "author": { "properties": { "id": { "type": "long" }, "name": { "type": "keyword" } } }
    }
  }
}
GET /blog_articles/_mapping
GET /_cat/indices/blog_articles?v
```
显式 Mapping 比让第一条数据动态推断更稳。比如 `viewCount` 先写成字符串，之后写数值就会冲突；分类若不是 keyword，就不适合精确过滤和聚合。Mapping 设计会在下一篇深入讲解。
## 六、文档 CRUD
### 6.1 Create：新增或完整覆盖
显式 `_id` 常用于 MySQL 到 ES 的同步，方便幂等写入和定位：
```http
PUT /blog_articles/_doc/101
{
  "id": 101,
  "title": "Spring Boot 事务失效的常见原因",
  "content": "事务代理、调用方式和异常类型都会影响回滚行为。",
  "category": "Spring Boot",
  "tags": ["事务", "AOP"],
  "publishedAt": "2026-08-24T10:00:00Z",
  "viewCount": 120,
  "author": { "id": 7, "name": "Frank" }
}
PUT /blog_articles/_doc/102?refresh=wait_for
{
  "id": 102,
  "title": "Java 并发控制与线程池实践",
  "content": "从线程池参数、队列和拒绝策略理解并发任务的执行过程。",
  "category": "Java",
  "tags": ["并发", "线程池"],
  "publishedAt": "2026-08-23T10:00:00Z",
  "viewCount": 86
}
```
同一 `_id` 再次 `PUT` 会用新 `_source` 完整替换旧文档，漏传字段可能消失。响应中 `result` 为 `created` 或 `updated`；业务同步应记录版本与失败原因，不能把任意 200 都当成正确数据。
### 6.2 Read：按 ID 与搜索读取
```http
GET /blog_articles/_doc/101
HEAD /blog_articles/_doc/101
GET /blog_articles/_source/101
GET /blog_articles/_search
{
  "query": { "match": { "content": "事务" } },
  "_source": ["id", "title", "category", "publishedAt"],
  "size": 10
}
```
`_doc` 是按 ID 定位，返回元数据和 `_source`；`_source` API 只取业务字段；HEAD 只判断存在。搜索走倒排索引，可做全文条件、过滤和排序，不能把两者混为一谈。
### 6.3 Update：局部字段与计数脚本
```http
POST /blog_articles/_update/101
{
  "doc": {
    "viewCount": 121,
    "tags": ["事务", "AOP", "Spring"]
  }
}
POST /blog_articles/_update/101
{
  "script": {
    "lang": "painless",
    "source": "ctx._source.viewCount = (ctx._source.viewCount ?: 0) + params.step",
    "params": { "step": 1 }
  }
}
```
更新在 Lucene 层并非原地改一小块 JSON，而是写入新版本并等待后台段合并。高频计数不一定适合每次都更新 ES；可在业务库或消息流聚合后批量同步。脚本应考虑字段缺失、并发和幂等。
### 6.4 Delete：文档和索引是两种操作
```http
DELETE /blog_articles/_doc/102
DELETE /blog_articles
```
前者只删除一篇文章，Mapping 仍在；后者删除所有文档、Mapping 与设置。自动化脚本必须限制允许删除的索引名，避免变量拼错造成事故。
![图2：从创建索引到验证搜索结果的最小调试循环](crud-debug-flow.svg)
## 七、Bulk：合并小写入但逐项检查结果
Bulk 的 body 是 NDJSON：每个动作一行元数据，`index` 和 `update` 后紧跟数据行，末尾必须换行：
```http
POST /_bulk
{ "index": { "_index": "blog_articles", "_id": "103" } }
{ "id": 103, "title": "Elasticsearch Bulk 写入实践", "content": "批量请求要关注失败项。", "category": "Elasticsearch", "tags": ["Bulk"], "publishedAt": "2026-08-22T10:00:00Z", "viewCount": 45 }
{ "update": { "_index": "blog_articles", "_id": "101" } }
{ "doc": { "viewCount": 130 } }
{ "delete": { "_index": "blog_articles", "_id": "102" } }
```
HTTP 200 不代表全部成功。应用必须检查 `errors` 和每个 `items[*]` 的 `error`，对可重试错误做退避，对 Mapping 错误修复数据后再投递。批次大小要基于文档体积、分片和压测选择，过大只会增加堆压力和单次失败成本。
## 八、refresh 与近实时搜索
写入确认表示主分片接受了请求，但文档通常要等 refresh 后才能被 `_search` 看见。可以在测试中选择：
```http
PUT /blog_articles/_doc/104?refresh=true
{ "id": 104, "title": "立即可见的测试文档" }
PUT /blog_articles/_doc/105?refresh=wait_for
{ "id": 105, "title": "等待下一次 refresh" }
POST /blog_articles/_refresh
```
`refresh=true` 立即刷新，写入吞吐最差；`wait_for` 等待下一次刷新，适合少量测试；批量导入后手工 refresh 也常见。不要为掩盖设计问题而让每一条生产写入都强制 refresh。
## 九、常见启动与认证错误
| 现象 | 优先检查 | 常见处理 |
| --- | --- | --- |
| 容器退出 | `docker compose logs --tail=200 es` | 内存、端口、数据目录权限、镜像与旧卷版本 |
| `Connection refused` | `docker compose ps`、端口映射 | 等待 ES 就绪，确认宿主机地址和服务名 |
| `401 Unauthorized` | 是否启用安全、密码与协议 | 使用正确用户、密码、CA；不要长期 `-k` |
| yellow | 副本是否无节点可放 | 单节点练习设副本 0；生产扩容或修复分配 |
| `mapper_parsing_exception` | `_mapping` 与写入 JSON | 新建正确索引、重建数据，不要原地改类型 |
主分片未分配或状态 red 时执行：
```http
GET /_cluster/allocation/explain
```
结合日志、磁盘和 JVM 信息判断。不要只凭健康颜色删除索引或重置卷。
## 十、Java 调试与总结
Java 可使用官方 Java API Client、Spring Data Elasticsearch 或直接 HTTP 客户端，但底层契约仍是这里的 REST 请求。建议将 Dev Tools 已验证的请求存成集成测试，记录索引、版本、请求、响应码、耗时和脱敏错误；不要输出 Authorization 头或完整隐私文档。
本篇跑通了 Docker Compose、端口与持久卷、健康检查、Dev Tools/curl、`blog_articles` CRUD、Bulk 以及 refresh。关键边界是：单节点不等于高可用，关闭安全只适合隔离环境，写入成功不等于搜索立即可见，Bulk 必须逐项检查。
下一篇：{% post_link articles/Elasticsearch/03-elasticsearch-mapping-analysis-chinese '第 03 篇：Mapping、分词与中文搜索设计' %}。
> **思考与练习**
>
> 1. 保留 ES 8.x 安全配置启动容器，记录 Kibana 和 curl 所需的密码、协议和 CA。
> 2. 为 `blog_articles` 增加 `status`、`coverUrl`、`location`，选择类型后写入两条数据。
> 3. 用一次 Bulk 新增、更新、删除，并故意写入一个错误类型，检查 `items` 中的失败项。
> 4. 比较默认 refresh、`wait_for`、`true` 与手工 `_refresh` 的搜索可见性。
