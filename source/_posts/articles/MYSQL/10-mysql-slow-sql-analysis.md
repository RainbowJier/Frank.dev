---
title: MySQL 从零到一（10）：慢 SQL 诊断与优化实战
date: 2026-08-24 10:00:00
categories:
  - 教程
tags:
  - MySQL
  - 慢查询
  - EXPLAIN
  - 性能优化
description: 用真实案例讲透慢 SQL 的定位、分析和优化全流程：EXPLAIN 深度解读、索引失效排查、JOIN 优化和工具链。
lang: zh-CN
---

> 适合人群：已学完第 07 篇《百万数据优化实战》，需要掌握系统化慢 SQL 排查方法论的开发者。

## 一、为什么 SQL 变慢了？

上线初期系统跑得很流畅，但随着用户增长，生产环境开始出现这些警报：

- **用户列表翻到第 50 页**，页面转圈 5 秒才加载出来
- **订单统计报表**凌晨跑了 10 分钟还没结束，把数据库 CPU 打到 90%
- **商品搜索加了筛选条件**反而更慢，用户投诉体验差
- **多表 JOIN 查询**经常超时，接口频繁报错

这些都是典型的慢 SQL 问题。第 07 篇我们学了如何开启慢查询日志和 EXPLAIN 的基础用法，这一篇深入实战诊断：从日志定位问题 SQL，到执行计划深度分析，再到针对性优化和效果验证——一套完整的方法论。

**完整诊断流程**：

```
日志定位 → 执行计划分析 → 针对性优化 → 验证效果
```

## 二、第一步：用慢查询日志找到"元凶"

### 快速回顾：开启慢查询日志

第 07 篇已经讲过如何开启，这里快速回顾：

```sql
-- 查看当前配置
SHOW VARIABLES LIKE 'slow_query%';
SHOW VARIABLES LIKE 'long_query_time';

-- 临时开启（重启后失效；生产环境要写入 my.cnf）
SET GLOBAL slow_query_log = ON;
SET GLOBAL long_query_time = 1;   -- 超过 1 秒的 SQL 都记录
```

### 重点工具：pt-query-digest 分析慢日志

手工看慢查询日志很低效，`pt-query-digest` 是 Percona Toolkit 里的利器，能把日志解析成可读性强的报告：

```bash
# CentOS/RHEL 安装
yum install percona-toolkit

# Ubuntu/Debian 安装
apt-get install percona-toolkit

# 分析慢日志，生成报告
pt-query-digest /var/log/mysql/slow.log > slow_report.txt
```

**报告解读三大关键指标**：

```
# Query 1: 0.45 QPS, 2.13s avg, 3.2s max
# Time range: 2026-08-23 10:00:00 to 18:00:00
# Attribute    total     min     max     avg
# ============ ===== ======= ======= =======
# Exec time    12960s   0.8s   3.2s   2.13s
# Rows sent    45000      1     100      50

SELECT order_id, user_id, total_amount FROM orders WHERE order_status = '已支付' ORDER BY created_at DESC LIMIT 20;
```

关键指标含义：

- **QPS（每秒查询次数）**：0.45 表示平均每秒执行 0.45 次
- **avg（平均耗时）**：单次查询平均 2.13 秒
- **total（总耗时）**：8 小时内这条 SQL 累计耗时 12960 秒（3.6 小时）

**优化策略**：优先优化 `total` 大的 SQL（累计影响最大），其次关注 `avg` 高的（单次慢）。

## 三、第二步：EXPLAIN 深度解读

找到慢 SQL 后，用 `EXPLAIN` 查看执行计划，重点看 4 个字段：`type`、`key`、`rows`、`Extra`。

### EXPLAIN 核心字段详解

```sql
EXPLAIN
SELECT order_id, user_id, total_amount
FROM orders
WHERE order_status = '已支付'
ORDER BY created_at DESC;
```

**字段含义速查表**：

| 字段 | 含义 | 重点关注 |
|------|------|----------|
| **id** | 执行顺序号 | id 越大越先执行；相同 id 从上往下执行 |
| **select_type** | 查询类型 | SIMPLE（简单查询）/ SUBQUERY（子查询）/ DERIVED（派生表） |
| **type** | 访问类型（性能关键） | 见下方详解 ⭐ |
| **possible_keys** | 可能用到的索引 | 优化器候选项 |
| **key** | 实际使用的索引 | NULL 表示索引失效 ⭐ |
| **key_len** | 索引使用的字节数 | 越小越好，表示索引覆盖范围 |
| **ref** | 索引关联的列 | const（常量）/ func（函数）/ 字段名 |
| **rows** | 预估扫描行数 | 不是精确值，但反映查询开销 ⭐ |
| **filtered** | 过滤后的行数百分比 | 越高越好，表示WHERE条件有效 |
| **Extra** | 额外信息（性能关键） | 见下方详解 ⭐ |

### type 字段：性能等级（最重要）

`type` 字段从优到劣排序：

![图1：EXPLAIN type 字段性能对比](mysql-explain-type-performance.svg)

**性能等级详解**：

1. **system**：系统表，只有一行记录（极少见）
2. **const**：主键或唯一索引等值查询，最多返回一行，最快 ✅
   ```sql
   SELECT * FROM orders WHERE order_id = 123456;
   ```

3. **eq_ref**：唯一索引关联，JOIN 时每次只匹配一行 ✅
   ```sql
   SELECT * FROM orders o JOIN users u ON o.user_id = u.user_id;
   -- 前提：user_id 是 users 表的主键或唯一索引
   ```

4. **ref**：非唯一索引等值查询，可能匹配多行 ✅
   ```sql
   SELECT * FROM orders WHERE order_status = '已支付';
   -- 前提：order_status 有普通索引
   ```

5. **range**：索引范围查询（BETWEEN / IN / > / <） ⚠️
   ```sql
   SELECT * FROM orders WHERE created_at BETWEEN '2026-08-01' AND '2026-08-31';
   ```

6. **index**：全索引扫描，读取整棵索引树 ❌
   - 比全表扫描快（索引文件小），但仍然很慢

7. **ALL**：全表扫描，最慢，必须优化 ❌❌
   ```sql
   SELECT * FROM orders WHERE YEAR(created_at) = 2026;
   -- 在 created_at 上使用了函数，索引失效
   ```

**优化目标**：让 `type` 至少达到 `ref` 或 `range` 级别。

### Extra 字段：性能警示灯

`Extra` 字段常见值：

- ✅ **Using index**：覆盖索引，查询列全在索引里，不需要回表，最优
- ⚠️ **Using where**：需要在引擎层过滤数据，可能需要回表
- ❌ **Using filesort**：MySQL 在内存或磁盘里对结果排序，性能杀手
  - 原因：ORDER BY 的列没有索引，或索引顺序与查询不匹配
- ❌ **Using temporary**：使用了临时表，GROUP BY / DISTINCT 可能出现
- ⚠️ **Using index condition**：索引下推优化，在索引层过滤部分条件

**案例：找出性能问题**

```sql
-- ❌ 问题查询
EXPLAIN
SELECT * FROM orders
WHERE order_status = '已支付'
ORDER BY created_at DESC;

-- 执行计划：
-- type: ALL              (全表扫描)
-- key: NULL              (未使用索引)
-- rows: 1000000          (扫描 100 万行)
-- Extra: Using filesort  (内存排序)
```

**4 个红色警报**同时出现：全表扫描 + 未用索引 + 扫描百万行 + 内存排序，必须立即优化。

## 四、第三步：索引失效的 8 大场景

EXPLAIN 显示 `key = NULL` 时，说明索引失效了。复习第 06 篇的 B+Tree 索引原理，然后看看索引失效的 8 大常见场景：

### 场景 1：列上使用函数或表达式

```sql
-- ❌ 索引失效：在 created_at 列上使用了 YEAR() 函数
SELECT * FROM orders
WHERE YEAR(created_at) = 2026;

-- ✅ 正确写法：改写为范围查询
SELECT * FROM orders
WHERE created_at >= '2026-01-01' AND created_at < '2027-01-01';
```

**原理**：索引存储的是原始列值，使用函数后 MySQL 无法直接在索引树上定位。

### 场景 2：隐式类型转换

```sql
-- 假设 order_no 是 VARCHAR(32) 类型
-- ❌ 索引失效：传入数字导致类型转换
SELECT * FROM orders WHERE order_no = 123456;

-- ✅ 正确写法：用字符串
SELECT * FROM orders WHERE order_no = '123456';
```

**原理**：MySQL 会把 `order_no` 转成数字再比较，相当于 `CAST(order_no AS UNSIGNED) = 123456`，触发了场景 1 的函数失效。

### 场景 3：前导模糊查询

```sql
-- ❌ 索引失效：前导通配符无法利用索引
SELECT * FROM products WHERE product_name LIKE '%手机%';

-- ✅ 可以用索引：前缀匹配
SELECT * FROM products WHERE product_name LIKE '华为%';

-- 💡 真的需要全文搜索？用全文索引或 Elasticsearch
ALTER TABLE products ADD FULLTEXT INDEX idx_fulltext (product_name);
SELECT * FROM products WHERE MATCH(product_name) AGAINST('手机' IN NATURAL LANGUAGE MODE);
```

**原理**：B+Tree 索引按字典序排列，前缀匹配可以快速定位范围，但前导通配符无法确定起始位置。

### 场景 4：联合索引未遵守最左前缀原则

```sql
-- 假设有联合索引：INDEX idx_abc (a, b, c)

-- ❌ 索引失效：跳过了最左列 a
SELECT * FROM table WHERE b = 10 AND c = 20;

-- ✅ 可以用索引：从 a 开始
SELECT * FROM table WHERE a = 5 AND b = 10;

-- ✅ 部分用索引：只用到 a
SELECT * FROM table WHERE a = 5 AND c = 20;  -- c 失效，但 a 有效

-- ✅ 完全用索引：a、b、c 都生效
SELECT * FROM table WHERE a = 5 AND b = 10 AND c = 20;
```

**原理**：联合索引 `(a, b, c)` 的排序规则是"先按 a 排序，a 相同时按 b 排序，b 相同时按 c 排序"。跳过 a 就无法定位。

### 场景 5：OR 连接的列未全部有索引

```sql
-- 假设 a 有索引，b 无索引
-- ❌ 整个查询索引失效
SELECT * FROM table WHERE a = 1 OR b = 2;

-- ✅ 方案1：给 b 也加索引
ALTER TABLE table ADD INDEX idx_b (b);

-- ✅ 方案2：改写为 UNION（适合两个条件互斥的场景）
SELECT * FROM table WHERE a = 1
UNION
SELECT * FROM table WHERE b = 2;
```

**原理**：OR 条件需要扫描两个分支的结果再合并，如果任一分支无索引，MySQL 倾向于直接全表扫描。

### 场景 6：IS NULL / IS NOT NULL

```sql
-- 视表数据分布而定
SELECT * FROM orders WHERE deleted_at IS NULL;
```

**结论**：

- NULL 值占比**小**（< 20%）：可能用索引
- NULL 值占比**大**（> 80%）：优化器认为全表扫描更快，索引失效

**最佳实践**：设计表时避免 NULL，用 `NOT NULL` + 默认值：

```sql
CREATE TABLE orders (
  deleted_at DATETIME NOT NULL DEFAULT '1970-01-01 00:00:00'  -- 用特殊值表示"未删除"
);
```

### 场景 7：范围查询后的列索引失效

```sql
-- 联合索引：INDEX idx_abc (a, b, c)

-- ✅ 等值查询：a、b、c 都生效
SELECT * FROM table WHERE a = 1 AND b = 2 AND c = 3;

-- ⚠️ 范围查询：只用到 a 和 b，c 失效
SELECT * FROM table WHERE a = 1 AND b > 10 AND c = 20;
```

**原理**：范围查询 `b > 10` 后，b 的值已经不确定，无法继续在索引树上定位 c。

**优化策略**：把范围查询的列放在联合索引的最后。

### 场景 8：优化器误判（统计信息过期）

```sql
-- 查看索引统计信息
SHOW INDEX FROM orders;

-- 更新统计信息
ANALYZE TABLE orders;

-- 强制使用索引（不推荐，治标不治本）
SELECT * FROM orders FORCE INDEX (idx_status) WHERE order_status = 'paid';
```

**原因**：MySQL 优化器基于表的统计信息（索引基数、数据分布）选择执行计划。大量增删改后统计信息过期，可能做出错误判断。

**最佳实践**：定期执行 `ANALYZE TABLE`，让优化器保持"清醒"。

![图2：慢 SQL 完整诊断流程](mysql-slow-query-diagnosis-flow.svg)

## 五、第四步：JOIN 查询优化

多表 JOIN 是生产环境慢查询的重灾区，优化遵循三原则：

### 原则 1：小表驱动大表

```sql
-- ❌ 大表驱动小表：orders 100 万行，users 1 万行
SELECT o.order_id, u.username
FROM orders o
LEFT JOIN users u ON o.user_id = u.user_id
WHERE o.order_status = 'paid';

-- ✅ 小表驱动大表：先过滤 orders，再 JOIN
SELECT o.order_id, u.username
FROM (
  SELECT order_id, user_id
  FROM orders
  WHERE order_status = 'paid'  -- 假设过滤后只剩 5000 行
) o
JOIN users u ON o.user_id = u.user_id;
```

**原理**：MySQL JOIN 的执行方式是"嵌套循环"，驱动表的每一行都要去被驱动表里找匹配行。小表驱动大表可以减少循环次数。

### 原则 2：JOIN 字段必须有索引

```sql
-- 查看被驱动表的索引
SHOW INDEX FROM users;

-- 如果 user_id 没有索引，必须加上
ALTER TABLE users ADD INDEX idx_user_id (user_id);
```

**验证方法**：EXPLAIN 查看被驱动表的 `type` 字段，应该是 `eq_ref` 或 `ref`，不能是 `ALL`。

### 原则 3：避免 SELECT *，只查需要的列

```sql
-- ❌ 查询了大量不需要的字段
SELECT *
FROM orders o
JOIN users u ON o.user_id = u.user_id
JOIN products p ON o.product_id = p.product_id;

-- ✅ 只查必要字段
SELECT o.order_id, u.username, p.product_name
FROM orders o
JOIN users u ON o.user_id = u.user_id
JOIN products p ON o.product_id = p.product_id;
```

**好处**：

- 减少网络传输数据量
- 提高覆盖索引命中率
- 降低内存消耗

### 案例：三表 JOIN 优化

```sql
-- ❌ 优化前
SELECT *
FROM orders o
LEFT JOIN users u ON o.user_id = u.user_id
LEFT JOIN products p ON o.product_id = p.product_id
WHERE o.order_status = 'paid'
ORDER BY o.created_at DESC
LIMIT 20;

-- EXPLAIN 结果：
-- orders: type=ALL, rows=1000000
-- users: type=ALL, rows=10000
-- products: type=ALL, rows=5000

-- ✅ 优化后
-- 1. 给关联字段加索引
ALTER TABLE orders ADD INDEX idx_status_time (order_status, created_at);
ALTER TABLE users ADD INDEX idx_user_id (user_id);
ALTER TABLE products ADD INDEX idx_product_id (product_id);

-- 2. 只查必要字段
SELECT o.order_id, u.username, p.product_name, o.total_amount
FROM orders o
JOIN users u ON o.user_id = u.user_id
JOIN products p ON o.product_id = p.product_id
WHERE o.order_status = 'paid'
ORDER BY o.created_at DESC
LIMIT 20;

-- EXPLAIN 结果：
-- orders: type=ref, key=idx_status_time, rows=5000
-- users: type=eq_ref, key=idx_user_id, rows=1
-- products: type=eq_ref, key=idx_product_id, rows=1
```

**优化效果**：从全表扫描（100 万行）降低到索引扫描（5000 行），性能提升 200 倍。

## 六、第五步：覆盖索引的威力

覆盖索引是性能优化的终极目标：查询的列全部在索引里，不需要回表。

### 什么是回表？

```sql
-- 假设有索引：INDEX idx_status (order_status)
SELECT order_id, user_id, total_amount
FROM orders
WHERE order_status = 'paid';
```

**执行过程**：

1. 在 `idx_status` 索引树上找到所有 `order_status = 'paid'` 的记录
2. 拿到主键 `order_id`
3. **回表**：根据主键去聚簇索引（主表）里找 `user_id` 和 `total_amount`

回表操作是**随机 I/O**，很慢。

### 覆盖索引避免回表

```sql
-- ✅ 建立覆盖索引：把查询用到的列都加进索引
ALTER TABLE orders
ADD INDEX idx_cover (order_status, created_at, order_id, user_id, total_amount);

-- 再次查询
SELECT order_id, user_id, total_amount
FROM orders
WHERE order_status = 'paid'
ORDER BY created_at DESC
LIMIT 20;

-- EXPLAIN 结果：
-- Extra: Using index  ✅（覆盖索引）
```

**好处**：

- 不需要回表，只在索引树上扫描，速度快
- 索引文件比数据文件小，I/O 更少

**注意事项**：

- 覆盖索引会增大索引文件，权衡空间和性能
- 不是所有查询都值得建覆盖索引，重点优化高频查询
- 索引列顺序要符合最左前缀原则：WHERE 条件列 → ORDER BY 列 → SELECT 列

## 七、优化后的验证（闭环）

优化完成后，必须验证效果，形成闭环：

### 步骤 1：再次 EXPLAIN 查看执行计划

```sql
EXPLAIN
SELECT order_id, user_id, total_amount
FROM orders
WHERE order_status = 'paid'
ORDER BY created_at DESC
LIMIT 20;
```

**对比优化前后**：

| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| type | ALL | ref |
| key | NULL | idx_cover |
| rows | 1000000 | 5000 |
| Extra | Using filesort | Using index |

### 步骤 2：用 SHOW PROFILES 对比耗时（可选）

```sql
-- 开启性能分析
SET profiling = 1;

-- 执行优化后的 SQL
SELECT order_id, user_id, total_amount
FROM orders
WHERE order_status = 'paid'
ORDER BY created_at DESC
LIMIT 20;

-- 查看耗时详情
SHOW PROFILES;
SHOW PROFILE FOR QUERY 1;
```

### 步骤 3：生产环境灰度验证

1. 部署优化后的代码到灰度环境
2. 观察慢查询日志：该 SQL 应该从 Top 榜消失
3. 监控数据库 CPU、磁盘 I/O：应该有明显下降
4. 全量上线后持续观察 1-2 天

**验证通过标准**：

- 慢查询日志里该 SQL 不再出现
- 接口响应时间从秒级降到毫秒级
- 数据库负载下降

## 八、工具链总结

| 工具 | 用途 | 使用时机 |
|------|------|----------|
| **慢查询日志** | 记录超过阈值的 SQL | 定位问题 SQL |
| **pt-query-digest** | 分析慢日志，生成可读报告 | 找出 Top N 慢查询 |
| **EXPLAIN** | 查看执行计划 | 分析索引使用情况 |
| **SHOW PROFILES** | 查看 SQL 详细耗时分布 | 深度分析单条 SQL（可选）|
| **ANALYZE TABLE** | 更新表统计信息 | 优化器误判时 |

---

### 常见误区提醒

1. **加了索引就一定快**：索引列有区分度要求，重复值过多的列（如性别字段只有"男/女"）建索引效果不大。索引的选择性（cardinality / total rows）最好 > 0.1。

2. **EXPLAIN 的 rows 是精确值**：`rows` 是优化器的估算值，基于统计信息计算，实际扫描行数可能不同。但它能反映查询的数量级。

3. **所有 SQL 都要覆盖索引**：索引也占磁盘空间和内存，过多索引会影响 INSERT / UPDATE / DELETE 性能（每次写入要更新所有索引）。权衡考虑，重点优化高频查询。

### 本章核心总结

- 慢查询日志 + pt-query-digest 定位问题 SQL，优先优化 total 时间最长的查询
- EXPLAIN 重点看 type、key、rows、Extra 四个字段，目标是 type 至少达到 ref，Extra 出现 Using index
- 索引失效 8 大场景：函数、类型转换、前导 LIKE、OR、最左前缀、NULL 值、范围后列失效、统计信息过期
- JOIN 优化：小表驱动大表、关联字段建索引、只查必要列
- 覆盖索引避免回表，是性能优化的终极目标，但要权衡空间成本

### 下一步学习建议

第 07 篇讲了"如何让数据库跑得更快"，这一篇讲了"如何排查为什么慢"，形成了完整的性能优化方法论。下一步建议学习 MySQL 的备份与恢复（第 08 篇），或者进阶到主从复制、读写分离、分库分表等架构层优化。单机优化到极限后，就该考虑分布式方案了。
