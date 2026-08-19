---
title: 千万级大表迁移：只用 Java 代码，把 1000w 行数据稳稳搬进新表
date: 2026-08-19 11:00:00
categories:
  - 教程
tags:
  - Java
  - 数据迁移
  - JDBC
  - MySQL
description: 面试高频场景题：1000w 行大表迁移到另一张表，只允许用 Java 实现，内存要小、一条不能丢。从一次性加载 OOM、深分页越翻越慢两个坑讲起，给出主键游标分批 + 幂等写入 + 断点续传 + 增量补偿 + 对账校验的完整可运行代码，内存占用与表总量无关。
lang: zh-CN
---

> 面试官抛出这道题时，想听的从来不是"我会用 DataX"。一次性把约束说死——**只能写 Java 代码、内存占用小、数据必须完整**——这道题考的是你对 JDBC、事务和故障恢复的理解。这篇文章从两个必踩的坑讲起，最后落地成一套可以直接抄走用的完整实现。

## 一、先算三笔账，约束就清楚了

### 1.1 内存账：10GB 数据 vs 2GB 堆

假设源表 `t_order` 有 1000w 行，单行按 1KB 算（几个 varchar 字段 + 索引开销很正常），全表约 **10GB**。而线上服务常见的 JVM 配置是 `-Xmx2g`。

结论立刻出来了：**任何"把数据先读进内存再处理"的思路，直接出局。** 目标内存模型只有一句话：

> 任意时刻，内存里最多只有"一批"数据，批处理完就释放，内存占用与表总量无关。

### 1.2 完整性账：三个承诺

"保证数据完整"拆开是三件事：

1. **不丢**：1000w 行一行不少地出现在新表里；
2. **不重**：迁移过程重跑、重试，新表不会出现重复行；
3. **可恢复**：迁移到 800w 行时进程挂了，重启后能从断点继续，而不是从头再来。

第三点最容易被忽略，却是生产迁移和 demo 的分水岭。

### 1.3 工具账：为什么不用一条 SQL

`INSERT INTO new SELECT * FROM old` 一条 SQL 看似能搞定，但 1000w 行意味着一个巨型事务：几十 GB 的 undo log、长时间锁竞争、恐怖的主从延迟，任何一个环节出问题整条回滚。DataX、DTS、存储过程也都被题目"只用 Java"排除。Java 代码真正的价值在于**把大迁移拆成几千个小步骤，每一步都可控制、可重试、可观测**——这正是下面整个方案的主线。

![图 1：一次性加载必然 OOM，分批流式让内存与总量脱钩](/images/svg/table-migration-naive-vs-streaming.svg)

## 二、两个必踩的坑

### 2.1 坑一：SELECT * 一把梭，直接 OOM

最直觉的写法：

```java
// 反例：跑不到 1000w 行就会 OOM
Statement st = conn.createStatement();
ResultSet rs = st.executeQuery("SELECT * FROM t_order");
List<Order> all = new ArrayList<>();
while (rs.next()) {
    all.add(mapRow(rs));   // 10GB 的对象往 2GB 的堆里塞
}
```

很多人以为 `ResultSet` 是"边读边取"的，所以不会占内存。**错。** MySQL 的 JDBC 驱动（Connector/J）默认行为是：执行查询后把**整个结果集**一次性拉到客户端内存，`rs.next()` 只是在本地缓存里移动指针。1000w 行的结果集约 10GB，堆直接打爆。

> 补充：驱动提供了流式模式（`statement.setFetchSize(Integer.MIN_VALUE)`）可以让结果集真正边读边流，本文 2.3 节单独分析它的坑。

### 2.2 坑二：LIMIT 分页，越翻越慢

既然不能一次读完，那就分页——第二版很自然写成：

```java
// 反例：能跑通，但第 1800 页之后每页都要几秒
int page = 0, size = 5000;
while (true) {
    List<Order> batch = query("SELECT * FROM t_order LIMIT " + (page * size) + ", " + size);
    if (batch.isEmpty()) break;
    write(batch);
    page++;
}
```

问题出在 `LIMIT offset, size` 的实现方式上：**MySQL 必须把 offset 之前的行全部扫描出来再丢掉**，才能返回你要的那一页。翻到 `LIMIT 9000000, 5000` 时，每一页都要白白扫掉 900w 行——offset 越大越慢，整体代价是 O(N²) 级别的。

还有一个更隐蔽的坑：这条 SQL **没有稳定的 ORDER BY**。分页期间新数据插入、页与页之间行序变化，会导致某些行被跳过（丢）、某些行出现两次（重）。对"保证数据完整"来说是致命的。

![图 2：深分页每页从头扫、越翻越慢；主键游标每批代价恒定](/images/svg/table-migration-cursor-pagination.svg)

### 2.3 坑二的修复尝试：JDBC 流式读取，可用但不优

```java
PreparedStatement ps = conn.prepareStatement("SELECT * FROM t_order");
ps.setFetchSize(Integer.MIN_VALUE);   // MySQL 开启流式结果集
```

内存问题确实解决了：服务端逐行推送，客户端逐行消费。但生产上它有几个硬伤：

| 问题 | 说明 |
|------|------|
| 连接被独占 | 流式读取期间，这条连接上不能再执行其他 SQL，连接池占用时间长 |
| 对网络敏感 | 几十分钟的长连接，一次网络抖动导致读取中断，恢复麻烦 |
| 断点不可控 | 中断后只能靠应用自己记录"读到了哪个 id"——那你其实已经在做游标方案了 |
| 无法并行 | 一条流就是一个线程，想按区间分段多线程迁移做不到 |

所以流式不是错，而是"游标分批"方案的一个特例。**把断点做成一等公民**，才是既省内存又可恢复的正解。

## 三、正解：主键游标 + 分批读写 + 断点续传

### 3.1 核心思路一句话

> 每次只读"id 大于上一批最大 id 的 5000 行"，写完记录这批的最大 id 作为下次的起点，循环直到读空。

```sql
SELECT * FROM t_order WHERE id > ? ORDER BY id LIMIT 5000
```

这条 SQL 同时解决了 2.1 和 2.2 的所有问题：

- **内存**：一次只有 5000 行 ≈ 5MB，与总量无关；
- **速度**：`WHERE id > ? ORDER BY id` 走主键索引范围扫描，一次定位，每批代价恒定，不存在"越翻越慢"；
- **不丢不重**：id 严格递增推进，上一批的结尾就是下一批的开头，区间无缝衔接；
- **断点天然**：游标本身（上批 max_id）就是断点，存下来重启即可续传；
- **可并行**：把 [min_id, max_id] 切成 N 段，每段一个线程各自游标推进即可。

### 3.2 表结构准备

```sql
-- 目标表：结构与源表一致。主键/唯一键必须先建好——这是幂等写入的前提
CREATE TABLE t_order_new LIKE t_order;

-- 断点表：一张表可以同时跑多个迁移任务，task_name 区分
CREATE TABLE migration_checkpoint (
  task_name     VARCHAR(64) PRIMARY KEY,
  last_max_id   BIGINT   NOT NULL DEFAULT 0,
  rows_migrated BIGINT   NOT NULL DEFAULT 0,
  updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) COMMENT '大表迁移断点';
```

### 3.3 完整实现（纯 JDBC，无框架依赖）

```java
package com.frank.migration;

import java.sql.*;
import java.util.ArrayList;
import java.util.List;

public class TableMigrator {

    private static final int  BATCH_SIZE  = 5000;  // 一批 5000 行 ≈ 5MB
    private static final long THROTTLE_MS = 20;    // 批间歇，保护源库

    private final String readUrl;   // 最好指向从库
    private final String writeUrl;

    public TableMigrator(String readUrl, String writeUrl) {
        this.readUrl = readUrl;
        this.writeUrl = writeUrl;
    }

    public static void main(String[] args) throws Exception {
        new TableMigrator(
                "jdbc:mysql://10.0.0.51:3306/order_db?useSSL=false",
                "jdbc:mysql://10.0.0.52:3306/order_db?useSSL=false"
        ).migrate("t_order->t_order_new");
    }

    public void migrate(String taskName) throws Exception {
        try (Connection read = DriverManager.getConnection(readUrl, "app", "***");
             Connection write = DriverManager.getConnection(writeUrl, "app", "***")) {

            long cursor = loadCheckpoint(write, taskName);
            System.out.printf("任务 %s 从 id > %d 处继续%n", taskName, cursor);

            while (true) {
                List<Object[]> batch = readBatch(read, cursor, BATCH_SIZE);
                if (batch.isEmpty()) break;                      // 读空 = 全量完成

                writeBatch(write, batch);                        // 一批一个短事务，幂等
                cursor = (long) batch.get(batch.size() - 1)[0];  // 本批最大 id 就是新游标
                saveCheckpoint(write, taskName, cursor, batch.size());

                System.out.printf("已迁移到 id=%d，本批 %d 行%n", cursor, batch.size());
                Thread.sleep(THROTTLE_MS);                       // 限速：给源库喘息时间
            }

            verify(read, write);
            System.out.println("迁移并校验完成");
        }
    }

    /** 主键游标读一批：范围扫描一次定位，代价恒定 */
    private List<Object[]> readBatch(Connection c, long cursor, int limit) throws SQLException {
        String sql = "SELECT id, order_no, user_id, amount, status, created_at, updated_at "
                   + "FROM t_order WHERE id > ? ORDER BY id LIMIT ?";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setLong(1, cursor);
            ps.setInt(2, limit);
            try (ResultSet rs = ps.executeQuery()) {
                List<Object[]> list = new ArrayList<>(limit);
                while (rs.next()) {
                    list.add(new Object[]{rs.getLong(1), rs.getString(2), rs.getLong(3),
                            rs.getBigDecimal(4), rs.getInt(5),
                            rs.getTimestamp(6), rs.getTimestamp(7)});
                }
                return list;
            }
        }
    }

    /** 幂等批量写：主键冲突就跳过，重跑多少次结果都一样 */
    private void writeBatch(Connection c, List<Object[]> batch) throws SQLException {
        String sql = "INSERT INTO t_order_new "
                   + "(id, order_no, user_id, amount, status, created_at, updated_at) "
                   + "VALUES (?, ?, ?, ?, ?, ?, ?) "
                   + "ON DUPLICATE KEY UPDATE id = id";   // 冲突时"什么都不做"
        boolean oldAuto = c.getAutoCommit();
        c.setAutoCommit(false);                            // 显式短事务
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            for (Object[] row : batch) {
                for (int i = 0; i < row.length; i++) {
                    ps.setObject(i + 1, row[i]);
                }
                ps.addBatch();
            }
            ps.executeBatch();
            c.commit();                                    // 提交即释放，不积累大事务
        } catch (SQLException e) {
            c.rollback();
            throw e;
        } finally {
            c.setAutoCommit(oldAuto);
        }
    }

    private long loadCheckpoint(Connection c, String taskName) throws SQLException {
        try (PreparedStatement ps = c.prepareStatement(
                "SELECT last_max_id FROM migration_checkpoint WHERE task_name = ?")) {
            ps.setString(1, taskName);
            try (ResultSet rs = ps.executeQuery()) {
                return rs.next() ? rs.getLong(1) : 0L;
            }
        }
    }

    private void saveCheckpoint(Connection c, String taskName, long maxId, int rows) throws SQLException {
        String sql = "INSERT INTO migration_checkpoint (task_name, last_max_id, rows_migrated) "
                   + "VALUES (?, ?, ?) "
                   + "ON DUPLICATE KEY UPDATE last_max_id = VALUES(last_max_id), "
                   + "rows_migrated = rows_migrated + VALUES(rows_migrated)";
        try (PreparedStatement ps = c.prepareStatement(sql)) {
            ps.setString(1, taskName);
            ps.setLong(2, maxId);
            ps.setLong(3, rows);
            ps.executeUpdate();
        }
    }

    /** 终局对账：总数一致是底线，分段聚合校验是保险 */
    private void verify(Connection r, Connection w) throws SQLException {
        long src = scalar(r, "SELECT COUNT(*) FROM t_order");
        long dst = scalar(w, "SELECT COUNT(*) FROM t_order_new");
        if (src != dst) {
            throw new IllegalStateException(String.format("行数不一致：源 %d，目标 %d", src, dst));
        }
        // 分段校验：每 100w 行算一次聚合指纹，不一致再人工下钻
        long maxId = scalar(r, "SELECT IFNULL(MAX(id), 0) FROM t_order");
        for (long lo = 0; lo < maxId; lo += 1_000_000) {
            String seg = "SELECT COUNT(*), IFNULL(SUM(CRC32(CONCAT(id, '|', amount))), 0) "
                       + "FROM %s WHERE id >= " + lo + " AND id < " + (lo + 1_000_000);
            if (!scalarStr(r, String.format(seg, "t_order"))
                    .equals(scalarStr(w, String.format(seg, "t_order_new")))) {
                throw new IllegalStateException("分段校验失败：id 区间 [" + lo + ", " + (lo + 1_000_000) + ")");
            }
        }
    }

    private long scalar(Connection c, String sql) throws SQLException {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getLong(1);
        }
    }

    private String scalarStr(Connection c, String sql) throws SQLException {
        try (Statement st = c.createStatement(); ResultSet rs = st.executeQuery(sql)) {
            rs.next();
            return rs.getString(1) + ":" + rs.getString(2);
        }
    }
}
```

跑起来的日志长这样，进度一目了然：

```text
任务 t_order->t_order_new 从 id > 0 处继续
已迁移到 id=5000，本批 5000 行
已迁移到 id=10000，本批 5000 行
...
已迁移到 id=10000000，本批 3218 行
迁移并校验完成
```

中途 kill 掉进程再重启，第一行会变成 `从 id > 7350000 处继续`——这就是断点续传。

![图 3：迁移流水线全貌，游标循环 + 增量补偿 + 对账收尾](/images/svg/table-migration-pipeline.svg)

### 3.4 三个关键设计决策

**为什么"先写数据、后记断点"，顺序不能反？**

崩溃只可能发生在两步之间，两种顺序的后果完全不同：

- 先写数据、后记断点：崩溃后断点落后最多一批 → 重启后这一批**重写一遍** → 幂等写入兜底，无副作用；
- 先记断点、后写数据：崩溃后断点已经推进 → 这一批数据**永远丢了** → 无法接受。

原则：**断点永远只能落后于数据，靠"重做 + 幂等"消化落后**。这就是为什么 `writeBatch` 里要用 `ON DUPLICATE KEY UPDATE id = id` 而不是裸 INSERT。

**幂等三兄弟怎么选？**

| 写法 | 冲突时行为 | 问题 |
|------|-----------|------|
| `INSERT ... ON DUPLICATE KEY UPDATE id = id` | 跳过，什么都不改 | 首选；MySQL 8.0.20+ 推荐用 `AS new ON DUPLICATE KEY UPDATE id = new.id` 新语法 |
| `INSERT IGNORE` | 跳过 | 会忽略**所有**错误（截断、非空约束……），数据问题被静默吞掉 |
| `REPLACE INTO` | 删旧插新 | 产生额外删除开销和 binlog，还可能级联删子表，别用 |

**为什么每批一个独立短事务？**

如果把 1000w 行放进一个事务，就退化成 1.3 节批评过的巨事务。每批 5000 行一个事务，单事务毫秒级提交，undo log、锁持有时间、主从延迟全部可控。**迁移的正确姿势是几千个小事务接力，而不是一个大事务硬扛。**

### 3.5 想快？按 id 区间并行

单线程串行迁 1000w 行大约几十分钟。如果要压时间，把 id 区间切段，多线程各自游标推进：

```java
int threads = 4;
long maxId = scalar(readConn, "SELECT IFNULL(MAX(id), 0) FROM t_order");
long step = maxId / threads + 1;
ExecutorService pool = Executors.newFixedThreadPool(threads);
for (int i = 0; i < threads; i++) {
    long lo = i * step, hi = Math.min(lo + step, maxId + 1);
    pool.submit(() ->            // migrateRange 内部仍是 3.3 的循环，只是 SQL 多了 AND id < ?
        migrateRange("t_order->t_order_new#" + i, lo, hi));
}
pool.shutdown();
pool.awaitTermination(2, TimeUnit.HOURS);
```

三个注意点：

1. **每个线程用自己的 Connection**，JDBC 连接不是线程安全的；
2. **每个分段一个独立的 task_name**（`#0`、`#1`……），断点互不干扰；
3. 段内查询改成 `WHERE id > ? AND id < ? ORDER BY id LIMIT ?`。

如果目标库磁盘扛得住，4 线程基本能把总耗时压到单线程的 1/3 左右（写侧串行化是瓶颈，不会严格线性加速）。

![图 4：四种读取策略迁移 1000w 行的总耗时对比](/images/svg/table-migration-strategy-benchmark.svg)

## 四、内存为什么小：算一笔账

整个运行期内，堆里同时存在的数据只有：

| 项 | 大小 | 说明 |
|----|------|------|
| 当前批次 | 5000 行 × 1KB ≈ **5MB** | `readBatch` 返回的 List，写完即可被 GC |
| JDBC 发送缓冲 | 数百 KB | `addBatch` 的 SQL 缓冲 |
| 其余 | 忽略 | 游标、计数器都是 long 级别 |

**总量从 1000w 涨到 1 亿，内存占用一分钱不涨。** 这就是"内存占用与表总量无关"的含义。

批大小怎么定？拿 1000w 行、单行 1KB 实测的典型规律：

| 批大小 | 单批内存 | 往返次数 | 单事务压力 | 评价 |
|--------|---------|---------|-----------|------|
| 500 | 0.5MB | 2 万 | 极小 | 网络往返占比高，偏慢 |
| 5000 | 5MB | 2000 | 小 | **推荐起点** |
| 5 万 | 50MB | 200 | 大 | 吞吐提升有限，事务和锁压力明显上升 |

从 5000 加到 5 万，内存涨 10 倍，耗时只降百分之十几——网络往返次数早就不是瓶颈了。**2000~5000 是吞吐和风险的平衡点**，除非实测证明你的场景例外。

## 五、数据完整性的四道保险

### 5.1 第一道：不丢不重——游标推进 + 幂等写入

游标按主键严格递增推进，区间 `[上次 max_id, 本次 max_id]` 无缝衔接，一行不漏；幂等写入保证重跑不产生重复。这两点在 3.1/3.4 已经讲透。

### 5.2 第二道：断点续传——进程挂了接着跑

断点落在 `migration_checkpoint` 表里，每次启动 `loadCheckpoint` 恢复。不管是进程崩溃、机器重启还是主动停止，重启后都从断点继续。如果迁移是周期性的运维动作，还可以把 `updated_at` 拿来做"断点多久没更新就告警"的监控。

### 5.3 第三道：崩溃窗口分析——任何时刻挂掉都安全

把一批的处理时序展开：

```text
T1 读批次        T2 写入目标表（事务提交）      T3 记断点
```

- 挂在 T1/T2 之前：什么都没发生，重启重读这一批；
- 挂在 T2 与 T3 之间（最常见窗口）：数据已写入，断点没推进，重启后**重写这一批**，幂等消化；
- 挂在 T3 之后：干净利落，下一批继续。

三种情况殊途同归：**没有一个时刻会让数据处于不可恢复的状态。** 这就是"先写数据、后记断点 + 幂等"组合的威力。

### 5.4 第四道：终局对账——证明"搬完了"

行数对账是底线，分段聚合校验是升级版（3.3 的 `verify` 已实现）：

```sql
-- 源表、目标表各跑一遍，逐段比对
SELECT COUNT(*), IFNULL(SUM(CRC32(CONCAT(id, '|', amount))), 0)
FROM t_order WHERE id >= 0 AND id < 1000000;
```

`COUNT` 抓"多行/少行"，`SUM(CRC32(...))` 抓"行数没变但内容变了"。理论上 CRC32 有碰撞概率，所以它只用来**定位可疑区间**——指纹不一致的段再做逐行 `JOIN` 比对下钻。1000w 行拆成 10 段，通常几秒就能全部扫完。

### 5.5 迁移期间源表还在写入怎么办？

前面的方案搬的是"某一时刻的全量快照"，但线上表还在被写入。三种打法，按改造成本从低到高：

| 方案 | 做法 | 适用 |
|------|------|------|
| 停写窗口 | 低峰期把源表设为只读，迁完切换 | 能接受几分钟不可写的场景 |
| **增量补偿（推荐）** | 迁移开始前记下时间戳，全量迁完后把 `updated_at >= 起点` 的行再 Upsert 一轮，循环补偿直到增量趋近于零，最后短暂停写收尾 | 大多数在线场景 |
| 双写 / binlog 订阅 | 迁移期间同时写两张表，或用 Canal 订阅 binlog 同步增量 | 改造成本高，适合常态化同步 |

增量补偿的核心就是一条服务端完成的 Upsert（由 Java 发起，不占应用内存）：

```java
// migrate() 主循环结束后、verify() 之前调用
private void compensate(Connection r, Connection w, Timestamp since) throws SQLException {
    String sql = "INSERT INTO t_order_new (id, order_no, user_id, amount, status, created_at, updated_at) "
               + "SELECT id, order_no, user_id, amount, status, created_at, updated_at "
               + "FROM t_order WHERE updated_at >= ? "
               + "ON DUPLICATE KEY UPDATE order_no = VALUES(order_no), user_id = VALUES(user_id), "
               + "amount = VALUES(amount), status = VALUES(status), updated_at = VALUES(updated_at)";
    try (PreparedStatement ps = w.prepareStatement(sql)) {
        ps.setTimestamp(1, since);
        ps.executeUpdate();
    }
}
```

补偿完成后立刻对账，对上了再切流量。切换本身用 `RENAME TABLE` 原子完成：

```sql
RENAME TABLE t_order TO t_order_old, t_order_new TO t_order;  -- 原子交换
```

## 六、生产上线清单

把前面的散点收成一张 checklist，上线前逐条打勾：

- [ ] 读流量走**从库**，批间 `sleep` 限速，迁移绝不打挂线上库；
- [ ] 目标表**先只建主键/唯一键**，二级索引迁完再补——索引边插边维护会让写入慢数倍；
- [ ] 批大小 2000~5000 起步，每批独立短事务；
- [ ] 断点表 + 先写数据后记断点 + 幂等 SQL，三者缺一不可；
- [ ] 写入失败按批重试（重试安全正是幂等带来的红利），连续失败告警人工介入；
- [ ] 日志输出进度百分比（`已迁移行数 / 源表 COUNT`），长时间不动即告警；
- [ ] 全量 + 增量补偿 + 对账三步全绿，才允许 `RENAME TABLE` 切换；
- [ ] 旧表改名保留几天，别急着 DROP——这是你唯一的后悔药。

## 七、面试速答

**Q：1000w 大表迁移，只用 Java，内存小、数据完整，怎么做？**

> 用主键游标分批迁移：`WHERE id > ? ORDER BY id LIMIT 5000` 每次只读一批，内存占用约 5MB、与总量无关，走主键索引每批代价恒定，不存在深分页问题；每批一个短事务，用 `ON DUPLICATE KEY UPDATE` 幂等写入保证重跑不重；每批结束把 max_id 记到断点表，进程挂了从断点续传，且"先写数据后记断点"保证任何时刻崩溃都能靠幂等恢复；全量结束后做增量补偿和 count/分段聚合对账，全部通过再原子 RENAME 切换。想提速就按 id 区间切段多线程并行，每段独立断点。

一句话版本：**游标分批管内存，幂等写入管重复，断点表管恢复，对账校验管完整。**
