---
title: Elasticsearch 从零到一（09）：集群高可用、快照恢复与安全运维
date: 2026-08-26 10:20:00
categories:
  - 教程
tags:
  - Elasticsearch
  - 集群高可用
  - 快照恢复
  - 安全运维
  - Java
description: 面向 Java 开发者讲解 Elasticsearch 8.x 的节点角色、分片高可用、故障恢复、快照、TLS、认证授权、监控与上线检查。
keywords:
  - Elasticsearch 集群
  - Elasticsearch 高可用
  - Elasticsearch Snapshot
  - Elasticsearch TLS
  - Elasticsearch RBAC
lang: zh-CN
---

> **适合人群**：准备把 Elasticsearch 从本地单节点推进到测试或生产集群，需要理解故障、恢复和访问控制的 Java 开发者。
> 高可用不是“启动三个容器”这么简单，而是让选主、分片分配、数据恢复、备份、安全和监控都能在压力与故障下工作。

## 一、先设计节点角色

Elasticsearch 8.x 使用节点角色控制一个实例承担的职责。生产集群要根据数据量、查询/写入压力和故障域决定是否拆分角色；角色越多并不自动代表越可靠。

![图1：Master、Data、Ingest 与 Coordinating 节点的分工及分片副本分布](cluster-shard-distribution.svg)

### 1.1 Master 节点

Master 节点负责集群状态：创建索引、Mapping 变更、分片分配、节点加入/离开和选主。它不应该被大量搜索请求和大批量聚合拖垮。生产集群通常配置三个专用 master-eligible 节点，让任意一个故障后仍有多数票完成选主；不要让三个节点共用同一台物理机或同一故障域。

```yaml
node.roles: [ master ]
cluster.name: shop-search
network.host: 0.0.0.0
```
`cluster.initial_master_nodes` 只用于首次引导新集群，不能在已经形成集群后随意保留或修改。新环境要配置正确的节点发现地址、集群名和 bootstrap 节点，避免误把两个环境合并。

### 1.2 Data 节点

Data 节点保存主分片和副本，执行索引、搜索、聚合与 segment merge。可以按负载拆分 `data_content`、`data_hot`、`data_warm` 等数据层，也可以先用通用 data 节点保持简单。规划重点是内存、SSD、磁盘容量、I/O 和恢复速度，而不只是 CPU 核数。

```yaml
node.roles: [ data_content, data_hot ]
path.data: /var/lib/elasticsearch
```
不要把数据目录放在普通网络文件系统上；Lucene 对 fsync、文件锁和随机读取有明确要求。节点磁盘要预留合并、恢复和水位阈值空间，不能把容量预算做到 100%。

### 1.3 Ingest 与 Coordinating

Ingest 节点在文档写入前执行 pipeline，如日期解析、字段清洗和 GeoIP。复杂 pipeline 会消耗 CPU，批量导入时可使用独立 ingest 节点；轻量 pipeline 也可以由 data 节点承担。

Coordinating 节点接收请求、把查询分发到相关分片、合并结果并返回。它适合承接大量客户端连接和协调工作，但不是“免费缓存层”。大聚合会在协调节点积累候选结果，可能造成堆压力；只有在确认瓶颈后才单独扩展协调节点。

```yaml
node.roles: [ ingest ]

# 仅协调：空角色数组
node.roles: [ ]
```
客户端应连接负载均衡器或多个节点地址，不要把流量永久固定到一个节点。Java 客户端可配置节点轮询、连接池、超时和故障节点退避。

## 二、Primary、Replica 与分片分配

创建索引时，`number_of_shards` 决定主分片数量，`number_of_replicas` 决定每个主分片的副本数量。主分片负责接收写入，副本既能在搜索时分担读取，也能在节点故障后提升为主分片。

```http
PUT /orders-2026
{
  "settings": {
    "number_of_shards": 3,
    "number_of_replicas": 1
  },
  "mappings": {
    "properties": {
      "orderId": {"type":"keyword"},
      "createdAt": {"type":"date"},
      "status": {"type":"keyword"}
    }
  }
}
```
ES 不会把同一个主分片和它的副本放到同一个节点上；启用 awareness 后，还能尽量跨可用区分布。注意：副本数为 1 的三主分片索引，至少需要两个合适的数据节点才可能变绿；单节点开发环境通常是 yellow，因为副本没有地方分配。

```http
GET /_cluster/health?level=indices
GET /_cat/shards/orders-2026?v
GET /_cluster/allocation/explain
```
### 2.1 Green、Yellow、Red

- **Green**：所有主分片和副本都已分配，集群满足当前副本配置。
- **Yellow**：主分片都可用，但一个或多个副本未分配；查询通常能工作，但没有完整冗余。
- **Red**：至少一个主分片未分配，部分索引数据不可用；必须立即定位原因并限制写入风险。

健康状态是结果，不是原因。看到 yellow 要继续查 `_cat/shards` 与 allocation explain；看到 red 要区分是磁盘、节点掉线、分片损坏、过滤规则还是恢复资源限制。

## 三、常见故障与定位路径

### 3.1 Unassigned shards

未分配分片可能来自节点离线、磁盘水位、分配过滤、恢复并发限制、版本不兼容或没有满足 awareness 的故障域。先获取解释：

```http
GET /_cluster/allocation/explain
{
  "index": "orders-2026",
  "shard": 1,
  "primary": false
}
```
响应中的 `allocate_explanation` 与各 allocation decider 会告诉你是 `disk_threshold`、`filter`、`same_shard` 还是 `throttling`。不要直接执行 `allocate_stale_primary` 或强制分配来“变绿”；这类操作可能丢失尚未同步的数据，只有在明确接受数据损失并完成记录后才使用。

### 3.2 Disk watermark

ES 使用磁盘水位保护分片：低水位限制新分片分配，高水位会迁移分片，洪水水位可能把只读块写到索引上。具体默认值随版本与配置而定，应该查看实际设置：

```http
GET /_cluster/settings?include_defaults=true&flat_settings=true
GET /_nodes/stats/fs
```
处理顺序通常是删除无用索引、缩短保留期、扩容磁盘或节点、迁移冷热数据；不要只提高水位阈值继续写满磁盘。确认磁盘空间释放后，清理错误只读块并观察分片恢复：

```http
PUT /orders-2026/_settings
{"index.blocks.read_only_allow_delete":null}
```
### 3.3 JVM、GC 与线程池

堆压力来自查询结果、聚合桶、segment metadata、Bulk 缓冲和字段数据。使用 `_nodes/stats/jvm,process,thread_pool,indices` 查看 Old GC、heap_used_percent、线程池队列和拒绝计数。不要通过盲目增大堆解决所有问题；ES 堆通常不应超过机器内存的一半，并需给文件系统缓存留下空间。

长 GC 会让节点暂时离开集群，触发选主或分片恢复。发现 GC 抖动时，先缩小请求、限制聚合桶、减少 Bulk 并发、检查字段类型与脚本，再评估堆大小和节点规格。

### 3.4 节点故障

节点突然掉电时，master 会从可用副本提升主分片，新的副本再在其他节点恢复。恢复期间搜索和写入可能变慢；如果没有副本，主分片也会变成 unassigned，除非从快照恢复。

```http
GET /_cat/recovery?v&active_only=true
GET /_cluster/health?wait_for_no_relocating_shards=true&timeout=60s
```
故障演练要验证三件事：客户端是否能重连、业务是否能接受短暂延迟、恢复后的文档数量和关键查询结果是否正确。只观察“节点重新上线”不等于恢复成功。

![图2：节点故障后从发现、提升副本到恢复和校验的闭环](failure-recovery.svg)

## 四、恢复与滚动维护

### 4.1 恢复资源与安全余量

分片恢复会消耗网络、磁盘和 CPU。可以查看并谨慎调整恢复并发和带宽，但要留出线上查询资源。恢复大索引前，先核对目标节点磁盘、版本、插件、路径和权限。

```http
GET /_cluster/settings?include_defaults=true&flat_settings=true
GET /_cat/allocation?v
```
不要在高峰期同时重启多个 master-eligible 节点或同一索引的多个副本所在节点。每次只维护一个故障域，等待集群状态稳定，再进入下一台。

### 4.2 滚动升级步骤

滚动维护的通用顺序是：确认快照和监控正常；暂停不必要的重建/大聚合；临时设置分配延迟或关闭自动 rebalance（只在官方升级窗口与明确方案中）；一次排空一台节点；停止、升级、启动；确认节点版本和分片恢复；再恢复下一台。

```http
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.enable": "primaries"
  }
}
```
这类临时设置必须有对应的恢复命令，并在维护后检查 persistent/transient settings。不同 ES 版本的升级路径、JDK 要求和插件兼容性不同，应以官方版本矩阵为准，不能跳过不支持的主版本。

### 4.3 节点下线与迁移

计划下线节点前，使用 allocation filtering 或 exclude 让分片迁出，然后监控磁盘、恢复和健康状态。直接关机虽然也能触发恢复，但会把计划维护变成故障演练，并延长业务抖动。

```http
PUT /_cluster/settings
{
  "persistent": {
    "cluster.routing.allocation.exclude._name": "es-data-02"
  }
}
```
迁移完成后清除 exclude；否则新节点可能长期收不到分片，未来扩容会出现意外分布。

## 五、快照仓库与恢复演练

副本不是备份。副本只能覆盖部分节点故障，无法替代误删、逻辑错误、全站故障和跨区域灾备。Snapshot 是 ES 官方的备份机制，仓库可以是共享文件系统、S3 等受支持的存储。

![图3：Snapshot Repository、快照生命周期与恢复校验流程](snapshot-restore.svg)

### 5.1 注册与验证仓库

先在 `elasticsearch.yml` 配置允许的仓库路径或安装云存储仓库插件，再注册仓库。仓库名称和权限应由运维管理，应用账号不应拥有删除快照权限。

```http
PUT /_snapshot/shop-repository
{
  "type": "fs",
  "settings": {
    "location": "/mnt/es-snapshots",
    "compress": true
  }
}

POST /_snapshot/shop-repository/_verify
```
如果是共享文件系统，每个相关节点都必须能以 ES 进程用户访问路径。验证通过后创建快照：

```http
PUT /_snapshot/shop-repository/shop-2026-08-24?wait_for_completion=false
{
  "indices": "products-*,orders-*",
  "include_global_state": false,
  "feature_states": []
}
```
生产环境要定义快照保留、命名、加密、跨区域复制和删除保护。快照是增量的，但恢复时间仍取决于数据量、网络和目标节点能力。

### 5.2 恢复索引与校验

恢复到同名索引前先关闭、删除或恢复到新名字；更安全的演练通常恢复到隔离集群或 `products-restore`，并在 Alias 切换前验证 Mapping、文档数量和抽样查询。

```http
POST /_snapshot/shop-repository/shop-2026-08-24/_restore
{
  "indices": "products-2026",
  "rename_pattern": "products-(.+)",
  "rename_replacement": "products-restore-$1",
  "include_global_state": false
}
```
恢复后检查 `_cluster/health`、`_cat/indices`、关键聚合、最新业务时间戳、Alias 和权限。演练要记录从发现故障到可读服务的 RTO、可接受的数据时间点 RPO，以及缺失数据如何从 MySQL 或消息日志补偿。

## 六、安全：TLS、认证与 RBAC

### 6.1 传输层与 HTTP TLS

生产请求不能裸奔在公网或不可信网络中。启用节点间 transport TLS 保护选主、分片复制和恢复；启用 HTTP TLS 保护 Java 应用、Kibana 和运维客户端的凭据与数据。证书要有轮换计划、正确 SAN、私钥权限和过期告警。

```yaml
xpack.security.enabled: true
xpack.security.transport.ssl.enabled: true
xpack.security.http.ssl.enabled: true
xpack.security.http.ssl.certificate: certs/http.crt
xpack.security.http.ssl.key: certs/http.key
xpack.security.http.ssl.certificate_authorities: [ "certs/ca.crt" ]
```
不要在代码里关闭证书校验来“解决连接问题”。Java 客户端应信任正确 CA，使用密钥库或受管凭据；测试环境自签名证书也应明确导入信任链。

### 6.2 认证、角色与最小权限

认证回答“你是谁”，授权回答“你能对哪些索引做什么”。内置用户适合初始配置，不适合让所有应用共享 `elastic` 超级账号。为商品搜索应用创建只读角色，为同步任务创建仅能写指定 Alias/索引的角色，为快照任务创建单独的仓库权限。

```http
POST /_security/role/product_search_reader
{
  "cluster": [],
  "indices": [
    {"names":["products-read"],"privileges":["read","view_index_metadata"]}
  ],
  "applications": [],
  "run_as": [],
  "metadata": {"owner":"product-service"}
}
```
角色定义要避免通配符索引名和过大的 `manage` 权限。应用账号不需要创建用户、修改集群设置或删除索引；迁移账号也不应拥有无关业务索引的写权限。权限测试应包含“允许的请求”和“必须拒绝的请求”。

审计日志、API Key 生命周期、密码轮换、Kibana 空间权限和 Secret 管理要纳入组织安全流程。API Key 过期和泄露撤销必须有操作手册，不要把凭据提交到 Git、日志或异常响应。

## 七、监控与告警

监控不能只看 CPU。建议同时收集：

- 集群健康、未分配主/副分片、选主次数和节点数；
- JVM heap、Old GC、线程池队列/拒绝、进程打开文件数；
- 磁盘使用、水位、磁盘吞吐、segment merge 与 translog；
- 搜索/写入吞吐、P95/P99、429、5xx、Bulk 失败和慢日志；
- 快照最近成功时间、快照耗时、仓库容量与恢复进度；
- TLS 证书到期、登录失败、权限拒绝和审计异常。

告警要能联系到动作。例如 red 集群触发电话告警并执行分配解释；磁盘高水位触发扩容/清理 runbook；快照超过 RPO 未成功触发恢复演练负责人。只发一条“ES 异常”而没有上下文，值班人员很难快速处理。

## 八、上线检查清单

1. **容量**：分片大小、增长率、磁盘水位、堆与文件缓存预算有数据依据。
2. **高可用**：master 跨故障域，主副本不共节点，客户端有多个地址，已演练节点故障。
3. **恢复**：快照仓库验证成功，保留策略明确，恢复到隔离环境并测出 RTO/RPO。
4. **安全**：transport/HTTP TLS 开启，应用使用专用账号或 API Key，角色遵守最小权限。
5. **查询**：真实请求完成压测，深分页、聚合、脚本和 wildcard 有替代方案。
6. **写入**：Bulk 有界、可重试、幂等、死信可追踪，Mapping 错误不会无限重试。
7. **观测**：日志、指标、慢查询、审计、证书和快照告警都有负责人。
8. **变更**：Alias 切换、回滚、扩容、下线、升级和误删恢复命令经过演练。

## 九、总结与练习

本章把“集群能启动”提升为“系统可以持续服务”。Master 维护集群状态，Data 承载分片，Ingest 负责预处理，Coordinating 负责请求聚合；Primary/Replica 提供扩展与冗余，但只有跨节点、跨故障域分布才真正有意义。Green、Yellow、Red 要结合 allocation explain 解读，磁盘水位、GC、线程池和恢复速度是故障定位的关键证据。

快照提供独立于副本的恢复能力，必须通过恢复演练证明 RPO/RTO。TLS 保护链路，认证识别身份，RBAC 把权限缩小到应用实际需要的索引与操作。最终以监控、告警、runbook 和上线门禁形成可操作的安全运维闭环。

**思考与练习**

1. 在三节点测试集群中关闭一个 data 节点，观察 primary/replica、health、recovery 的变化并记录恢复时间。
2. 制造一个磁盘水位或分配过滤条件导致的 unassigned replica，使用 allocation explain 给出修复步骤。
3. 注册本地快照仓库，创建快照，删除测试索引，恢复到新名字并完成文档数、聚合和查询抽样校验。
4. 为搜索服务、同步任务和运维人员分别设计角色，列出每个账号明确不应拥有的权限。

## 十、系列导航

- 上一篇：{% post_link articles/Elasticsearch/08-elasticsearch-bulk-reindex-performance 'Elasticsearch 从零到一（08）：Bulk 写入、Reindex 与查询性能优化' %}
- 本篇：集群高可用、快照恢复与安全运维
- 下一篇：{% post_link articles/Elasticsearch/10-elasticsearch-comprehensive-practice 'Elasticsearch 从零到一（10）：商品搜索综合实战' %}
