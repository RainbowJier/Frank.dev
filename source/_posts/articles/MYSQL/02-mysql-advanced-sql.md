---
title: MySQL 从零到一（02）：高级 SQL 功能
date: 2026-08-17 10:05:00
categories:
  - 教程
tags:
  - MySQL
  - 高级 SQL
  - 报表查询
description: 用生活例子讲透聚合统计、多表连接、子查询和窗口函数，配完整可运行代码。
lang: zh-CN
---

> 本文依赖第 01 篇的 `mysql_zero_to_one` 数据库，请先跑完建表和插入数据的脚本。

## 一、聚合函数：对一堆数据做统计

### 什么是聚合？

普通的 `SELECT` 是"一行一行地返回数据"。聚合函数是"把很多行压成一行，得出统计结果"。

比如你想知道：**总共有多少订单？总销售额是多少？**——这就要用聚合。

```sql
-- 统计已支付订单的数量、总额、均值、最大最小订单
USE mysql_zero_to_one;

SELECT
  COUNT(*)             AS 订单总数,     -- 数行数
  SUM(total_amount)    AS 总销售额,     -- 求和
  AVG(total_amount)    AS 平均订单额,   -- 平均值
  MAX(total_amount)    AS 最大订单,     -- 最大值
  MIN(total_amount)    AS 最小订单      -- 最小值
FROM orders
WHERE order_status = '已支付';
```

预期结果：一行数据，包含所有已支付订单的统计信息。

> **注意**：`COUNT(*)` 统计所有行；`COUNT(列名)` 会跳过 NULL 值，两者有区别。

### 分组统计：GROUP BY

"每个用户分别买了多少？"——需要按用户分组后再统计：

```sql
-- 按用户分组统计，且只看至少下了 1 笔已支付订单的用户
SELECT
  user_id,
  COUNT(*)          AS 已支付订单数,
  SUM(total_amount) AS 累计消费额
FROM orders
WHERE order_status = '已支付'
GROUP BY user_id
HAVING COUNT(*) >= 1        -- HAVING 是对分组结果再过滤
ORDER BY 累计消费额 DESC;
```

预期结果：每个有已支付订单的用户各占一行。

**WHERE vs HAVING 傻傻分不清？**

- `WHERE`：分组**之前**过滤，过滤的是原始行
- `HAVING`：分组**之后**过滤，过滤的是每组的汇总结果

口诀：**WHERE 管原始数据，HAVING 管统计结果**。

## 二、多表连接：把多张表拼在一起

### 为什么需要多表连接？

我们的订单表里只存了 `user_id`，并没有直接存用户名。想在订单结果里看到用户名，就需要把 `orders` 和 `users` 两张表"拼"在一起——这就是 JOIN。

![图2：一条 SQL 从连接到存储引擎的执行流程](mysql-sql-execution-flow.svg)

### INNER JOIN：只要两边都有的

```sql
-- 查询已支付订单，同时显示用户名
SELECT
  o.order_id,
  u.username   AS 用户名,
  o.total_amount AS 订单金额
FROM orders AS o
INNER JOIN users AS u ON u.user_id = o.user_id
WHERE o.order_status = '已支付';
```

`INNER JOIN` 的逻辑：只返回两张表里都能匹配上的行。如果订单表有一个 `user_id` 在用户表里不存在，这行订单就不会出现在结果里。

### LEFT JOIN：左表全部保留

```sql
-- 查询所有用户，以及他们的订单数（没下过单的用户也要显示）
SELECT
  u.user_id,
  u.username,
  COUNT(o.order_id) AS 订单数
FROM users AS u
LEFT JOIN orders AS o ON o.user_id = u.user_id
GROUP BY u.user_id, u.username;
```

预期结果：所有用户都显示出来，carol 没有订单，她的"订单数"为 0。

**LEFT JOIN 的关键**：左边的表（`users`）每行都会保留；右边的表（`orders`）找不到匹配时用 NULL 填充。

> **常见 bug**：在 LEFT JOIN 之后的 WHERE 里过滤右表的列，就会把 NULL 的行过滤掉，LEFT JOIN 变成了 INNER JOIN。正确做法是在 `ON` 里写右表条件，或者在 HAVING 里过滤。

### SELF JOIN：自己连接自己

当一张表里有"上下级关系"时用到，比如员工和上级都在同一张表里：

```sql
-- 建一个员工表，manager_id 指向同表的 employee_id
CREATE TABLE IF NOT EXISTS employees (
  employee_id   INT PRIMARY KEY,
  employee_name VARCHAR(50) NOT NULL,
  manager_id    INT NULL,
  FOREIGN KEY (manager_id) REFERENCES employees(employee_id)
) ENGINE=InnoDB;

INSERT INTO employees VALUES
  (1, '周经理', NULL),    -- 最高层，没有上级
  (2, '李工程师', 1),
  (3, '王工程师', 1);

-- 查询每个员工和他的上级
SELECT
  e.employee_name AS 员工,
  m.employee_name AS 直属上级
FROM employees AS e
LEFT JOIN employees AS m ON e.manager_id = m.employee_id;
```

预期：周经理的"直属上级"为 NULL，李和王的上级都是周经理。

## 三、子查询：查询里套查询

子查询就是把一个 SELECT 结果作为另一个 SELECT 的条件或数据源。

```sql
-- 找出金额高于平均订单金额的订单
SELECT order_id, total_amount
FROM orders
WHERE total_amount > (
  SELECT AVG(total_amount) FROM orders  -- 先算平均值，再拿来比较
);
```

括号里的查询先执行，得出平均值，外层再用这个值过滤。

### EXISTS：判断"有没有"，不在乎具体值

```sql
-- 找出至少下过一笔已支付订单的用户
SELECT u.user_id, u.username
FROM users AS u
WHERE EXISTS (
  SELECT 1 FROM orders AS o
  WHERE o.user_id = u.user_id
    AND o.order_status = '已支付'
);
```

`EXISTS` 只关心括号里的查询**有没有结果**，`SELECT 1` 里的 1 只是占位，写什么都行。

```sql
-- 找出从来没下过已支付订单的用户
SELECT u.user_id, u.username
FROM users AS u
WHERE NOT EXISTS (
  SELECT 1 FROM orders AS o
  WHERE o.user_id = u.user_id
    AND o.order_status = '已支付'
);
```

**EXISTS vs IN 怎么选？**

- `IN` 适合子查询返回**少量**固定值，写起来直观
- `EXISTS` 适合子查询和外层有关联、数据量大的场景
- 现代 MySQL 优化器已经很智能，实际性能差异要用 `EXPLAIN` 看，不能凭感觉

## 四、窗口函数：既要统计，又要保留明细

### 普通 GROUP BY 的局限

GROUP BY 统计之后，原始行就消失了，每组只剩一行汇总。但有时候我们想要：**每个用户的订单按金额排名，同时还要保留每条订单的详情**——这就是窗口函数解决的问题。

```sql
-- 为每个用户的订单按金额从高到低排名
SELECT
  user_id,
  order_id,
  total_amount,
  ROW_NUMBER() OVER (
    PARTITION BY user_id         -- 按用户分"窗口"
    ORDER BY total_amount DESC   -- 每个窗口内按金额排名
  ) AS 排名_无并列,
  RANK() OVER (
    PARTITION BY user_id
    ORDER BY total_amount DESC
  ) AS 排名_有并列空档
FROM orders;
```

**ROW_NUMBER vs RANK 的区别**：
- `ROW_NUMBER`：1、2、3、4——即使金额相同也给不同排名
- `RANK`：1、2、2、4——相同金额并列，下一个跳过数字

### LAG / LEAD：看上一行和下一行

```sql
-- 对比同一用户相邻两笔订单的金额变化
SELECT
  user_id,
  order_id,
  created_at,
  total_amount,
  LAG(total_amount)  OVER (PARTITION BY user_id ORDER BY created_at) AS 上一笔金额,
  LEAD(total_amount) OVER (PARTITION BY user_id ORDER BY created_at) AS 下一笔金额,
  total_amount - LAG(total_amount) OVER (PARTITION BY user_id ORDER BY created_at) AS 比上笔涨跌
FROM orders;
```

预期：第一笔订单的"上一笔金额"为 NULL（没有上一笔），最后一笔的"下一笔金额"也是 NULL。

---

### 常见误区提醒

1. **HAVING 写成 WHERE**：`WHERE COUNT(*) > 1` 会报错，聚合条件只能写 HAVING。
2. **LEFT JOIN 之后在 WHERE 里过滤右表**：`WHERE o.order_id IS NOT NULL` 会让 LEFT JOIN 失效，变成 INNER JOIN。
3. **以为窗口函数的 ORDER BY 就是最终排序**：窗口函数里的 ORDER BY 只是定义窗口内的顺序，结果集不一定按这个顺序展示，最外层要另加 ORDER BY。

### 本章核心总结

- **聚合**：把多行压成一行做统计；`WHERE` 在前、`HAVING` 在后
- **JOIN**：拼接多张表；`LEFT JOIN` 保留左表所有行；ON 里写关联条件
- **子查询**：查询中嵌套查询；`EXISTS` 用来判断"有没有"
- **窗口函数**：在保留明细的同时做分组统计，MySQL 8.0 才完整支持

### 下一步学习建议

下一篇进入事务，学习"如何保证多条 SQL 要么全部成功、要么全部撤销"——这是做任何业务系统必须掌握的核心能力。
