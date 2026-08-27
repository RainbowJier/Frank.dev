# MongoDB 从零到一 · 学习大纲

> 本文件是学习/写作规划文档，不在 Hexo source 内，不会被发布。
> 规划创建于 2026-08-27，**2026-08-27 已完成 01–03 三篇**（各配 3 张 SVG，构建与产物引用校验通过）。风格沿用已完结的《Elasticsearch 从零到一》（10 篇）与《RuoYi 从零到一》（12 篇），预计共 **12 篇**。
>
> **续写备忘**：① 图号沿用 ES 惯例——每篇独立从图 1 编号；② 每篇结尾的「下一篇」预告是纯文字，当该篇实际写出后，要回头把上一批末尾的预告升级成 `{% post_link %}`（目标不存在会 FATAL 构建失败）；③ `shop.products` 四条异构文档是全系列教学数据集，后续篇目示例继续基于它。

## 系列定位

面向**有 Java/Spring 后端经验、熟悉 MySQL** 的读者（也就是 Frank 自己的学习路径）。三条主线贯穿全系列：

1. **与 MySQL 对照**：凡有对应概念就列表对照（库/表/行 → 库/集合/文档，JOIN → `$lookup`/嵌入），并明确指出「不该用 MongoDB 的地方」；
2. **与 Elasticsearch 分工**：2026-08 刚写完 ES 十篇，开篇就厘清 MongoDB（业务主存储）vs ES（搜索/分析读模型）的边界，文内互链；
3. **落地 Java**：最后以 Spring Data MongoDB 收官实战，呼应 Spring Boot 事务、IoC/AOP 等既有文章。

## 规范速查（与既有系列一致）

- 目录：`source/_posts/articles/MongoDB/`，文件名 `NN-kebab-case.md`（编号两位）
- front-matter：`categories: [教程]`，tags 含 `MongoDB`、`数据库`，description 一段话 + keywords 列表 + `lang: zh-CN`
- 配图：research-svg skill（NPG 学术配色、自包含 SVG），存各文章同名 post asset folder，正文相对文件名引用，每篇 3 张左右
- 结构：blockquote 引言（适合人群 + 与前后篇衔接）→ 三~七个 `## 一、二、三` 大节 → 常见坑清单 → 总结 + 下篇预告；篇幅对标 240–430 行
- `{% raw %}` 坑、post_link 相对 `_posts` 路径坑照旧注意
- 环境：MongoDB 7.x（Docker Desktop 已有，ES 系列同款姿势）

## 学习路线总览

| 阶段 | 篇目 | 目标 |
|---|---|---|
| 一、入门基础 | 01–02 | 建立文档模型心智，能跑起来、能用 shell |
| 二、CRUD 与建模 | 03–04 | 熟练增删改查，会设计合理的文档结构 |
| 三、进阶查询 | 05–06 | 掌握聚合管道这一 MongoDB 的灵魂 |
| 四、索引与事务 | 07–08 | 会调优慢查询，理解一致性等级 |
| 五、高可用架构 | 09–10 | 玩转副本集与分片（面试高频区） |
| 六、工程实战 | 11–12 | 生产运维能力 + Spring Boot 落地收官 |

## 文章清单与要点

### 01 初识 MongoDB：文档数据库与选型定位

要点：关系库的痛点与 NoSQL 四大家族（KV/文档/列存/图）中 MongoDB 的位置；BSON 文档模型（JSON 的类型扩展：嵌套文档、数组、Date、Decimal128）；概念对照表 database→database、table→collection、row→document、column→field、JOIN→嵌入或 `$lookup`；MongoDB 的能力边界（4.0+ 支持多文档事务但仍非强事务首选）；**与 MySQL / ES 的三方分工**（互链数据库对比文与 ES 01）；适合什么（schema 多变、高写入、层级数据、快速迭代），不适合什么（跨多实体重事务、复杂多维 JOIN）。

配图构想：①数据库技术版图定位 ②MySQL vs MongoDB vs ES 三栏对照 ③BSON 文档结构标注。

### 02 Docker 环境搭建与 mongosh 快速上手

要点：Docker Compose 部署单机 MongoDB（端口、数据卷、初启认证）；mongosh 连接与常用帮助命令；库/集合/文档三级概念实操（`show dbs`、`use`、隐式创建集合）；JSON vs BSON 与类型系统；**ObjectId 的 12 字节构成**（时间戳+机器+进程+计数器，天然趋势递增所以 _id 排序≈时间排序）；Compass GUI；导入样例数据集供后续篇章练习。

配图构想：①ObjectId 构成拆解 ②Docker 部署与连接拓扑 ③Shell/Compass 操作地图。

### 03 CRUD 全解：find、操作符与更新表达式

要点：insertOne/insertMany 与插入有序性；find 全家桶——比较操作符（`$eq/$gt/$in/$nin`）、逻辑（`$and/$or/$not`）、null 判断与字段存在（`$exists`）、**数组操作符**（`$all/$elemMatch/$size`，文档库特色）；投影与嵌套路径 `"a.b"`；sort/skip/limit 与深分页坑；updateOne/updateMany 的更新操作符体系（`$set/$inc/$unset/$push/$pull/$addToSet/$pop`）、替换整文档 vs 局部更新、upsert；deleteOne/Many；bulkWrite 有序/无序批量。每小节给 SQL 对照行。

配图构想：①CRUD API 全景树 ②常用操作符分类速查 ③$push/$pull 数组更新示意。

### 04 数据建模：嵌入还是引用（本系列灵魂篇之一）

要点：关系范式思维 → 文档思维的转变；决策三问（一起读写吗？更新频繁吗？会无限增长吗？）；一对一嵌入、一对少嵌数组、一对多父引用+`$lookup`、海量 `array of ancestors` 扩展引用；反范式冗余与一致性代价；大数组导致文档膨胀与搬迁代价；16MB 上限与 GridFS 一句话；官方常见模式：子集模式、桶模式（IoT 时序）、极值模式；schema 版本化字段。全程用「博客文章 + 评论」贯穿案例。

配图构想：①嵌入 vs 引用决策树 ②一对 N 三种建模对比 ③冗余带来的读放大/写一致性权衡。

### 05 聚合管道（上）：从 SQL GROUP BY 到 Pipeline

要点：pipeline 心智模型（上游输出 = 下游输入，类比 Linux 管道/流式 Stream API）；SQL ↔ Aggregation 阶段映射表（WHERE→`$match`、GROUP BY→`$group`、HAVING→先 `$group` 再 `$match`、ORDER BY/LIMIT→`$sort/$limit`）；accumulator（`$sum/$avg/$max/min/$push/$addToSet`）；`$match` 尽量前置；`$project` 裁剪与计算字段；100MB 内存限制与 allowDiskUse；日期分组（`$dateToString/$dateTrunc`）做日报周报；典型实战：订单按月统计。

配图构想：①流水线多阶段数据流 ②SQL→Aggregation 映射表 ③订单统计案例全过程。

### 06 聚合管道（下）：$lookup 联表与复杂报表

要点：`$lookup` 五参数与结果为数组的语义；`$lookup`+`$unwind` 得到平铺 JOIN 视角；多级联表；`$facet` 一次往返拿「列表+总数+分组统计」（分页页脚场景利器）；`$addFields/$set`、条件 `$cond/$switch`；`$graphLookup` 递归查组织架构树；聚合优化清单（match/project 前置减数据量、利用索引、避免大 `$unwind`）；`$merge/$out` 物化结果表。

配图构想：①$lookup 两集合关联管线 ②$facet 并行分支 ③$graphLookup 递归展开。

### 07 索引详解：ESR 原则与 explain 调优

要点：无索引 = COLLSCAN（类比全表扫描）；B-Tree 与 MySQL InnoDB 同源不同细节；索引类型：单字段/复合（方向敏感）/多键（数组自动索引）/TTL（过期会话等场景，与业务结合讲）/部分/稀疏/文本/通配符；**ESR 原则**（Equality-Sort-Range 决定复合索引字段顺序）；explain 三种模式与关键字段解读（IXSCAN/COLLSCAN、totalDocsExamined:nReturned 比率、rejectedPlans）；覆盖查询；Profiler 定位慢查询；索引不是越多越好（写放大）。

配图构想：①B-Tree 索引查找路径 ②ESR 字段顺序推导 ③explain 输出标注解读。

### 08 事务与一致性：Write Concern 到多文档事务

要点：**单文档天然原子性**——很多“要事务”的需求其实在建模篇就该用文档内嵌解决；真正需要多文档事务的场景；Session + startTransaction/commitTransaction；使用红线（默认 60s、oplog 空间约束、别拿来跑批）；Write Concern 梯度 `w:1 / majority / j:true`（确认级别与持久性换延迟）；Read Concern `local/majority/snapshot`（快照读是事务基础）；Read Preference 读写分离的陈旧读风险；选型心法：MySQL 强事务为主、Mongo 事务兜底。

配图构想：①Write Concern 确认级别阶梯 ②一次事务的生命周期时序 ③Read Preference 在副本集上的路由。

### 09 副本集：oplog、选举与故障转移

要点：单机的单点问题与副本集三大角色（Primary/Secondary/Arbiter）；**oplog** 固定集合与幂等重放（类比 MySQL binlog）；心跳检测与选举（Raft 变体：多数派、term、priority）；异步复制与数据回滚（rollback）；成员进阶配置（hidden/delayed/priority:0 的用途）；Docker Compose 手搭三节点副本集（keyFile 认证）作为实验环境；`rs.status()` 状态速读；连接串 `replicaSet=rs0` 自动故障切换实测（kill 主节点看流量切走）。⚠️ 从这篇起，事务等特性都需要副本集环境——02 的单机环境在此升级。

配图构想：①副本集拓扑 + oplog 同步流向 ②选举时序图 ③实验环境三容器拓扑。

### 10 分片集群：shard key 设计与水平扩展

要点：什么时候才真的需要分片（容量/写入量阈值判断——不要过早分片）；组件协作 mongos / config server / shards（每个 shard 本身就是副本集）；chunk 与迁移；range 分区 vs hash 分区的分布特征；**shard key 选择铁律**：高基数、低频访问、避开单调递增（自增 id 导致所有写入打到最后一个 chunk 的热点问题）；hashed shard key 救场；balancer 与 jumbo chunk 处理；zone 分片（多地域合规）；scatter-gather 查询的代价。继续三容器实验环境扩成分片集群（dev 模式即可）。

配图构想：①分片集群组件全景 ②range vs hash 数据分布对比 ③单调 key 写入热点示意图。

### 11 运维必备：安全、备份恢复与监控

要点：安全三板斧——启用认证、RBAC 内置角色与最小权限（readWrite/dbAdmin/root）、网络白名单与 TLS；备份恢复——mongodump/mongorestore 逻辑备份的适用与局限、文件系统快照、**基于 oplog 的时间点恢复 PITR**、云托管托管一句话（Atlas）；监控——db.serverStatus 关键项、Profiler 收慢查询、mongostat/mongotop、Prometheus exporter 与告警指标清单（连接数、复制延迟、缓存命中率、锁队列）；版本升级策略。

配图构想：①备份手段分级金字塔 ②PITR 恢复时间线 ③监控指标分区看板。

### 12 Spring Data MongoDB 实战（系列收官）

要点：starter 依赖与自动配置；连接串与连接池参数（maxConnectionPoolSize 等）；两种姿势——MongoRepository 方法名派生查询 vs MongoTemplate 动态 Query/Criteria 组合，各自适用边界；实体注解 `@Document/@Id/@Field/@Indexed/@CompoundIndex`、_id 与 ObjectId/String 映射；**@Transactional 生效前提是副本集**（02/09 铺垫回收，最常见的翻车点）；乐观锁 `@Version`；分页 Pageable 与 `PageableExecutionUtils`；收官实战：以「文章 + 评论 + 标签统计」为需求（呼应 Frank.dev 博客域本身），从建模决策 → Repository/Template 混合实现 → 事务与索引校验完整走一遍；性能自查清单 + 全系列导航收尾。

配图构想：①应用层两种访问方式与驱动的分层 ②需求 ER → 文档模型落位 ③核心请求链路时序。

## 与既有内容的联动

- 开篇（01）互链《MySQL、PostgreSQL 与 Oracle 对比》与《ES 从零到一（01）》；
- 03 的 SQL 对照可链 MySQL 系列对应篇；07 索引可与 MySQL 的 B+ 树篇互相跳转；
- 08 与《Spring Boot 事务》一文互为补充（那里讲失效场景，这里讲另一套引擎的事务语义）；
- 12 收官可回挂「关于页 - 系列文章」区块（现挂 Vue 8 + Java 多线程 5 + LangChain4j 3 + ES 10 等，MongoDB 12 篇完成后统一补一行）。

## 进度追踪

| # | 标题 | 状态 |
|---|---|---|
| 01 | 初识 MongoDB | ✅ 已写完（2026-08-27，`01-mongodb-introduction.md` + 3 SVG） |
| 02 | Docker 环境搭建与 mongosh | ✅ 已写完（2026-08-27，`02-mongodb-docker-mongosh.md` + 3 SVG） |
| 03 | CRUD 全解 | ✅ 已写完（2026-08-27，`03-mongodb-crud-operators.md` + 3 SVG） |
| 04 | 数据建模 | 未开始（下一批首篇；写完时把 03 结尾预告升级为 post_link） |
| 05 | 聚合管道（上） | 未开始 |
| 06 | 聚合管道（下） | 未开始 |
| 07 | 索引与 explain 调优 | 未开始 |
| 08 | 事务与一致性 | 未开始 |
| 09 | 副本集 | 未开始 |
| 10 | 分片集群 | 未开始 |
| 11 | 安全备份监控 | 未开始 |
| 12 | Spring Data MongoDB 实战 | 未开始 |
