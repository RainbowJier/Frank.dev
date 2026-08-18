---
title: MySQL 从零到一（07）：百万数据优化实战
date: 2026-08-17 10:30:00
categories:
  - 教程
tags:
  - MySQL
  - 性能优化
  - 分区表
description: 数据量大了查询变慢？批量写入、深翻页、慢查询日志、EXPLAIN 实战全搞定。
lang: zh-CN
---

## 一、数据多了会发生什么？

表里只有几千条数据时，怎么写 SQL 都很快。但当数据增长到百万、千万行，很多以前没问题的写法就开始报警：

- 翻到第 100 页，页面转几秒加载不出来
- 一个简单的统计查询跑了 30 秒
- 批量导入 10 万条数据要等半个小时
- 报表接口凌晨定时任务把数据库 CPU 打满

这一篇就来解决这些真实问题。

## 二、批量插入：别一条一条地 INSERT

### 问题：逐行插入很慢

如果用循环一条一条地 INSERT，每条都要经过网络往返、日志写入、索引更新——10 万条可能要几分钟。

### 方案一：合并成一条多值 INSERT

```sql
-- 一次提交多行，减少网络往返次数
START TRANSACTION;
INSERT INTO products (product_name, price, stock) VALUES
  ('商品A', 99.00, 100),
  ('商品B', 199.00, 50),
  ('商品C', 299.00, 30),
  ('商品D', 399.00, 80);
COMMIT;

-- 确认插入成功
SELECT COUNT(*) AS 商品总数 FROM products;
```

实际项目里，一次 INSERT 建议在 500～1000 行左右，太多了会让事务过大，反而影响其他操作。

### 方案二：LOAD DATA INFILE（大文件导入神器）

```sql
-- 查看 MySQL 允许从哪个目录加载文件
SHOW VARIABLES LIKE 'secure_file_priv';
```

```bash
# 准备一个 CSV 文件，放到 MySQL 允许读取的目录
# /var/lib/mysql-files/products.csv 内容示例：
# 蓝牙耳机,299.00,200
# 充电宝,129.00,500

# 导入命令（在 MySQL 客户端里执行）
LOAD DATA INFILE '/var/lib/mysql-files/products.csv'
INTO TABLE products
FIELDS TERMINATED BY ','
LINES TERMINATED BY '\n'
(product_name, price, stock);
```

`LOAD DATA INFILE` 比逐条 INSERT 快 10～100 倍，适合初始化数据或大批量导入。使用前注意：
- 检查 `secure_file_priv` 指定的目录，文件要放在那里
- 确认 CSV 的列顺序和表的列对应
- 有重复主键时，用 `IGNORE` 关键字跳过，或 `REPLACE` 覆盖

## 三、分页查询优化：深翻页为什么慢？

### 问题：LIMIT 偏移量越大越慢

`LIMIT 100000, 20` 的意思不是"直接跳到第 10 万行"，而是"先扫描 10 万零 20 行，然后丢掉前 10 万行，只返回最后 20 行"。

越翻到后面，丢掉的行越多，越慢。

```sql
-- ❌ 深分页，翻到后面会很慢
SELECT order_id, user_id, total_amount
FROM orders
ORDER BY order_id
LIMIT 100000, 20;
```

### 方案一：延迟关联（先用索引定位主键，再取数据）

```sql
-- ✅ 延迟关联：先用覆盖索引找主键，再回表取数据
SELECT o.order_id, o.user_id, o.total_amount
FROM orders AS o
JOIN (
  SELECT order_id          -- 这一步只查主键，走覆盖索引，很快
  FROM orders
  ORDER BY order_id
  LIMIT 100000, 20
) AS page_ids ON page_ids.order_id = o.order_id
ORDER BY o.order_id;
```

### 方案二：书签分页（推荐，性能最好）

记住上一页最后一行的主键，下次从那里继续查，不用跳过前面的行：

```sql
-- ✅ 书签分页：用上一页最后的 order_id 作为起点
-- 假设上一页最后一条是 order_id = 99980
SELECT order_id, user_id, total_amount
FROM orders
WHERE order_id > 99980    -- 从上次的位置继续
ORDER BY order_id
LIMIT 20;
```

书签分页速度始终如一，不管翻到第几页都很快。缺点是不能随意跳页（比如直接跳到第 500 页），适合"下一页"这种连续翻页的场景。

## 四、慢查询日志：找出"坏 SQL"

### 开启慢查询日志

慢查询日志会记录所有超过指定时间的 SQL，是定位性能问题的第一步：

```sql
-- 查看当前慢查询配置
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';

-- 临时开启（重启后失效；生产要写入 my.cnf 持久化）
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;   -- 超过 1 秒的 SQL 都记录
SET GLOBAL slow_query_log_file = '/var/log/mysql/slow.log';
```

实际项目里，可以用 `pt-query-digest` 工具分析慢日志，它会帮你统计出最慢、执行次数最多的 SQL，有优先级地去优化。

### 用 EXPLAIN 定位问题

找到慢 SQL 之后，用 `EXPLAIN` 看执行计划：

```sql
-- 分析一条可能有问题的查询
EXPLAIN
SELECT * FROM orders
WHERE order_status = '已支付'
ORDER BY created_at DESC;
```

如果 `type` 列显示 `ALL`，说明在全表扫描；如果 `Extra` 里有 `Using filesort`，说明 MySQL 在内存或磁盘里对结果排序，都是性能警告信号。

对症下药——加索引：

```sql
-- 给 order_status 和 created_at 建联合索引，同时覆盖过滤和排序
ALTER TABLE orders
  ADD INDEX idx_orders_status_time (order_status, created_at);

-- 再看执行计划，type 应该变成 ref 或 range
EXPLAIN
SELECT order_id, total_amount FROM orders
WHERE order_status = '已支付'
ORDER BY created_at DESC
LIMIT 20;
```

## 五、分区表：让 MySQL 自动"分堆管理"数据

### 什么是分区表？

分区表是把一张逻辑上的大表，按照规则分成多个物理上的"小堆"。查询时 MySQL 只扫描相关的分区，不用看全部数据。

最常见的是按时间分区：

```sql
-- 按年份分区的审计日志表
CREATE TABLE audit_events (
  event_id   BIGINT NOT NULL,
  event_time DATETIME NOT NULL,
  event_type VARCHAR(40) NOT NULL,
  PRIMARY KEY (event_id, event_time)   -- 分区键必须在主键里
) ENGINE=InnoDB
PARTITION BY RANGE (YEAR(event_time)) (
  PARTITION p2024 VALUES LESS THAN (2025),
  PARTITION p2025 VALUES LESS THAN (2026),
  PARTITION p2026 VALUES LESS THAN (2027),
  PARTITION pmax  VALUES LESS THAN MAXVALUE  -- 兜底分区
);

-- 插入测试数据
INSERT INTO audit_events VALUES
  (1, '2026-08-17 10:00:00', 'user_login'),
  (2, '2025-03-01 08:00:00', 'order_create');

-- 查询 2026 年的数据，MySQL 只会扫描 p2026 分区
SELECT * FROM audit_events
WHERE event_time >= '2026-01-01' AND event_time < '2027-01-01';
```

分区的好处：
- **分区裁剪**：查询条件包含分区键时，自动跳过不相关分区
- **快速清理历史数据**：`ALTER TABLE audit_events DROP PARTITION p2024`，秒删，比 `DELETE` 快得多

### 分区 vs 分库分表

分区表是在同一个数据库里拆分，应用代码不用变，但数量、容量有上限（最多 1024 个分区）。

分库分表是真正拆到多个数据库或表，能突破单机限制，但引入了**跨分片事务、全局 ID、路由规则**等复杂性，一般是单库优化手段都用尽之后才考虑。

---

### 常见误区提醒

1. **加了索引还是慢**：检查 SQL 写法，函数、隐式类型转换会让索引失效；或者表数据量很小，优化器直接选全表扫描反而更快。

2. **分区表可以解决所有性能问题**：查询里没有分区键作为条件，MySQL 会扫描所有分区，不但没有优化，反而更慢。

3. **慢查询阈值设成 0**：会把所有 SQL 都记录下来，日志文件暴增，反而影响性能。生产建议 0.5～2 秒。

### 本章核心总结

- 批量写入：合并多值 INSERT 或 `LOAD DATA INFILE`，减少往返次数
- 深分页：用延迟关联或书签分页替代 `LIMIT 大偏移量`
- 慢日志定位问题，`EXPLAIN` 验证索引效果
- 分区表适合时序、按范围查询的大表；分库分表是最后的手段

### 下一步学习建议

数据安全和备份恢复同样重要——下一篇学如何备份 MySQL、如何做时间点恢复，以及 XtraBackup 热备的使用方法。
