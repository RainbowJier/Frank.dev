---
title: MySQL 从零到一（06）：索引基础与 EXPLAIN
date: 2026-08-17 10:25:00
categories:
  - 教程
tags:
  - MySQL
  - 索引
  - EXPLAIN
description: 用图书馆的例子搞懂索引原理，掌握 B+Tree、聚簇索引、覆盖索引和 EXPLAIN 分析。
lang: zh-CN
---

## 一、为什么需要索引？

没有索引时，查询一条数据就像在一本没有目录的字典里找一个字——只能从第一页翻到最后。数据量小还好，百万行的表全表扫描可能需要几秒甚至几十秒。

**索引就是数据库版的"目录"**：先查目录找到页码，再翻到那一页，速度快得多。

代价是：目录本身占空间，每次新增/修改/删除数据时，目录也要更新。所以索引不是越多越好。

## 二、B+Tree：MySQL 索引用的数据结构

MySQL InnoDB 的索引用的是 **B+Tree**（B+树），不是二叉树，也不是普通 B-Tree。

为什么选 B+Tree？可以用一个对比来理解：

| | 二叉树 | B+Tree |
|---|---|---|
| 树的高度 | 高（百万条数据可能几十层）| 低（百万条数据通常只有 3～4 层）|
| 每次磁盘读取 | 一次只读一个节点 | 每页 16KB，能放很多节点 |
| 范围查询 | 需要中序遍历，麻烦 | 叶子节点用链表连着，顺序读很快 |

**B+Tree 的关键特点**：
- 所有实际数据（或主键）都存在**叶子节点**，中间节点只存"路标"
- 叶子节点之间用**双向链表**连接，范围查询时不需要回到根节点重新找

![图4：B+Tree 聚簇索引与二级索引回表路径](mysql-bplus-tree-index.svg)

## 三、聚簇索引和二级索引

### 聚簇索引（主键索引）

InnoDB 的表必须有主键。主键索引叫**聚簇索引**，特点是：**叶子节点直接存整行数据**，找到索引就找到了数据本身。

```
主键 B+Tree 叶子节点（部分示意）：
[order_id=1] → {user_id=1, total_amount=668, created_at=..., ...完整一行}
[order_id=2] → {user_id=1, total_amount=199, ...}
[order_id=3] → {user_id=2, total_amount=399, ...}
```

### 二级索引（普通索引）

非主键索引叫**二级索引**（也叫辅助索引）。叶子节点**不存整行数据**，只存"索引列的值 + 对应的主键"：

```
user_id 索引叶子节点（部分示意）：
[user_id=1] → order_id=1
[user_id=1] → order_id=2
[user_id=2] → order_id=3
```

### 什么是回表？

用二级索引查到主键后，如果还需要其他列（比如 `total_amount`），就要**再去聚簇索引查一次**，这个过程叫**回表**。

```text
查询：SELECT total_amount FROM orders WHERE user_id = 1

步骤：
1. 查 user_id 的二级索引 → 找到 order_id=1, order_id=2
2. 用 order_id 回到聚簇索引 → 读出完整行，取 total_amount
```

回表有额外 I/O，数据量大时影响性能。

### 什么是覆盖索引？

如果查询需要的所有列都在二级索引里，就不需要回表——这叫**覆盖索引**。

```sql
-- 创建包含 user_id, order_status, order_id 的联合索引
ALTER TABLE orders
  ADD INDEX idx_orders_user_status_id (user_id, order_status, order_id);

-- 这个查询只需要 user_id 和 order_id，都在索引里，不用回表
EXPLAIN
SELECT order_id FROM orders WHERE user_id = 1 AND order_status = '已支付';
-- Extra 列出现 "Using index" 就是覆盖索引
```

## 四、联合索引和最左匹配原则

联合索引 `(user_id, order_status, created_at)` 的排序规则：先按 `user_id` 排，`user_id` 相同的再按 `order_status` 排，以此类推。

**最左匹配原则**：查询条件必须从最左列开始，中间不能跳过。

```sql
-- ✅ 能用到索引：从最左列 user_id 开始
SELECT * FROM orders WHERE user_id = 1;
SELECT * FROM orders WHERE user_id = 1 AND order_status = '已支付';

-- ❌ 用不到联合索引：跳过了 user_id 直接查 order_status
SELECT * FROM orders WHERE order_status = '已支付';

-- ❌ 遇到范围条件后，右边的列不能再用于精确匹配
SELECT * FROM orders WHERE user_id > 1 AND order_status = '已支付';
-- user_id > 1 是范围，order_status 就无法用索引定位了
```

## 五、索引失效的常见场景

```sql
-- ❌ 对索引列用函数，索引失效
SELECT * FROM orders WHERE DATE(created_at) = '2026-08-17';
-- ✅ 改用范围查询，索引生效
SELECT * FROM orders
WHERE created_at >= '2026-08-17 00:00:00'
  AND created_at <  '2026-08-18 00:00:00';

-- ❌ 前置通配符，无法用索引
SELECT * FROM users WHERE username LIKE '%ali%';
-- ✅ 前缀匹配，可以用索引
SELECT * FROM users WHERE username LIKE 'ali%';

-- ❌ 隐式类型转换：user_id 是 BIGINT，但传了字符串
SELECT * FROM users WHERE user_id = '1';
-- ✅ 类型一致
SELECT * FROM users WHERE user_id = 1;
```

## 六、用 EXPLAIN 分析查询

`EXPLAIN` 是诊断慢查询最重要的工具，能看到优化器的执行计划：

```sql
-- 分析这条查询的执行计划
EXPLAIN
SELECT order_id, total_amount FROM orders
WHERE user_id = 1 AND order_status = '已支付'
ORDER BY created_at DESC;
```

重点看这几列：

| 列名 | 含义 | 好的信号 | 警惕信号 |
| --- | --- | --- | --- |
| `type` | 访问方式 | `ref`、`range`、`const` | `ALL`（全表扫描）|
| `key` | 实际使用的索引 | 显示索引名 | `NULL`（没用索引）|
| `rows` | 预估扫描行数 | 数字越小越好 | 接近总行数 |
| `Extra` | 额外信息 | `Using index`（覆盖）| `Using filesort`、`Using temporary` |

```sql
-- 清理实验用的索引
ALTER TABLE orders DROP INDEX idx_orders_user_status_id;
```

---

### 常见误区提醒

1. **索引越多越好**：每个索引都要占空间、写入时都要维护。表上超过 5～6 个索引就要仔细评估了。
2. **`EXPLAIN` 里 rows 很小就一定快**：rows 是估算值，不是精确值；还要结合 `type` 和 `Extra` 综合判断。
3. **加了索引就万事大吉**：索引需要与查询模式匹配；查询写法不对（函数、隐式转换），索引也白加。

### 本章核心总结

- B+Tree 低树高 + 叶子链表，磁盘 I/O 少，范围查询快
- 聚簇索引叶子存整行；二级索引叶子存主键，需要回表
- 覆盖索引避免回表，`EXPLAIN` 的 `Extra: Using index` 是好信号
- 联合索引遵循最左匹配；函数、前置通配符、类型不匹配会导致索引失效

### 下一步学习建议

索引原理打牢之后，下一篇进入实战：面对百万条数据，如何用批量插入、分页优化、慢查询日志和分区表来提升性能。
