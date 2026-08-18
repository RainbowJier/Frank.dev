---
title: MySQL 从零到一（01）：数据库与 SQL 语言基础
date: 2026-08-17 10:00:00
categories:
  - 教程
tags:
  - MySQL
  - SQL
  - 数据库基础
description: 用大白话讲清楚数据库是什么、MySQL 怎么安装、SQL 怎么写，附带真实可跑的代码。
keywords:
  - MySQL 入门
  - SQL 基础
  - 数据库安装
lang: zh-CN
---

> **适合人群**：完全没学过数据库的同学，或者只会 Excel 想入门 SQL 的朋友。
> 本系列以 MySQL 8.0 为准，所有代码都能直接复制运行。

## 一、数据库是个啥？为啥不用 Excel？

想象你开了一家网店，订单越来越多。刚开始用 Excel 记录还行，但：

- 同时有 100 个客服查同一张表，Excel 会卡死
- 两个人同时修改同一条记录，谁的改动算数？
- 突然停电，文件损坏，所有数据没了怎么办？

数据库就是为解决这些问题诞生的。它不只是"存数据的地方"，还保证**多人同时读写不出错**、**断电重启数据还在**、**查几百万条记录也很快**。

### 关系型数据库：用"表"来组织数据

MySQL 就是一种**关系型数据库**，数据存在一张张"表"里，就像 Excel 的 Sheet：

```
用户表（users）
+----+----------+---------------------+
| id | username | email               |
+----+----------+---------------------+
|  1 | alice    | alice@example.com   |
|  2 | bob      | bob@example.com     |
+----+----------+---------------------+
```

多张表之间可以通过"外键"关联，比如订单表里记录 `user_id=1`，就知道这是 alice 的订单。

### MySQL 的来历（超简短版）

- 1990 年代：几个瑞典程序员开发了 MySQL，主打**快、免费、好上手**
- 2000 年代：网站爆发，"Linux + Apache + MySQL + PHP" 的 LAMP 组合横扫 Web 开发
- 2010 年：Oracle 收购，MySQL 持续维护，同时衍生出 MariaDB 等开源分支
- 现在：MySQL 8.0 加入了窗口函数、JSON、更强的安全机制，企业主流版本

![图1：数据库模型与 MySQL 生态演进时间线](/images/svg/mysql-history-evolution.svg)

## 二、安装 MySQL（三种方式）

### 方式一：Linux（Ubuntu）

```bash
# 安装 MySQL 8.0
sudo apt update
sudo apt install -y mysql-server

# 启动并设置开机自启
sudo systemctl enable --now mysql

# 初始化安全设置（按提示设密码、删测试库）
sudo mysql_secure_installation

# 验证安装成功
mysql --version
# 输出类似：mysql  Ver 8.0.x ...
```

### 方式二：Docker（推荐学习用，不影响本机环境）

```bash
# 一条命令启动 MySQL 8.0，密码设为 Test_123!
docker run --name mysql8-lab \
  -e MYSQL_ROOT_PASSWORD='Test_123!' \
  -e MYSQL_DATABASE=mysql_zero_to_one \
  -p 3306:3306 \
  -v mysql8-lab-data:/var/lib/mysql \
  -d mysql:8.0

# 等日志出现 ready for connections 就可以连了
docker logs -f mysql8-lab
```

> **为什么推荐 Docker**：删了容器就彻底干净，不会把本机环境搞乱；学习、测试都很方便。

### 方式三：Windows

去 MySQL 官网下载 MSI 安装包，一路下一步即可。安装完在命令行验证：

```bash
# 检查版本和字符集
mysql -uroot -p -e "SELECT VERSION(), @@character_set_server;"
# 字符集应该是 utf8mb4，才能存中文和 Emoji
```

## 三、SQL 是什么？四类命令一次搞清楚

SQL 全称"结构化查询语言"，你对数据库说的每句话都是 SQL。按用途分四类：

| 分类 | 中文叫法 | 干什么 | 常用语句 |
| --- | --- | --- | --- |
| DDL | 数据定义语言 | 建库、建表、改结构 | `CREATE` `ALTER` `DROP` |
| DML | 数据操作语言 | 增删改数据 | `INSERT` `UPDATE` `DELETE` |
| DQL | 数据查询语言 | 查数据 | `SELECT` |
| DCL | 数据控制语言 | 管权限 | `GRANT` `REVOKE` |

下面用这四类命令搭建贯穿全系列的演示数据库：

### DDL：建库建表

```sql
-- 第一步：创建演示库，指定字符集（utf8mb4 支持中文和 Emoji）
DROP DATABASE IF EXISTS mysql_zero_to_one;
CREATE DATABASE mysql_zero_to_one
  CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- 切换到这个库
USE mysql_zero_to_one;

-- 建用户表
CREATE TABLE users (
  user_id    BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT, -- 主键，自动递增
  username   VARCHAR(50)  NOT NULL UNIQUE,               -- 用户名，不能重复
  email      VARCHAR(120) NOT NULL UNIQUE,               -- 邮箱，不能重复
  status     TINYINT      NOT NULL DEFAULT 1,            -- 状态：1正常 0禁用
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
```

执行后数据库和表就建好了。`AUTO_INCREMENT` 会自动生成 1、2、3… 的主键，不用手动填。

### DML：插入数据

```sql
-- 插入三个用户
INSERT INTO users (username, email) VALUES
  ('alice', 'alice@example.com'),
  ('bob',   'bob@example.com'),
  ('carol', 'carol@example.com');
```

三行数据插进去了，`user_id` 会自动变成 1、2、3。

### DQL：查询数据

```sql
-- 查刚才插入的用户，按 user_id 排序
SELECT user_id, username, email, created_at
FROM users
ORDER BY user_id;
```

预期结果：返回 3 行，alice/bob/carol 各一行。

### DCL：管理权限

```sql
-- 创建一个只能查询的账号（给报表工具用）
CREATE USER IF NOT EXISTS 'reporter'@'localhost' IDENTIFIED BY 'Report_123!';
GRANT SELECT ON mysql_zero_to_one.* TO 'reporter'@'localhost';

-- 验证：只有 SELECT 权限
SHOW GRANTS FOR 'reporter'@'localhost';
```

预期只看到 `GRANT SELECT ON mysql_zero_to_one.*`，没有增删改权限。

## 四、数据类型怎么选？

选错类型是新手最常见的坑，下面列几个关键原则：

### 数值类型

| 类型 | 占用空间 | 范围（有符号） | 什么时候用 |
| --- | --- | --- | --- |
| `TINYINT` | 1 字节 | -128 ~ 127 | 状态、标志位 |
| `INT` | 4 字节 | -21亿 ~ 21亿 | 普通 ID、数量 |
| `BIGINT` | 8 字节 | 极大 | 主键（高并发系统） |
| `DECIMAL(12,2)` | 变长 | 精确小数 | **金额必用**，不能用 float |

> **为什么金额不能用 float**：`0.1 + 0.2` 在浮点数里等于 `0.30000000000000004`，钱算错了麻烦大了。

### 字符串类型

- `VARCHAR(n)`：长度可变，存用户名、标题、描述——**大多数情况用这个**
- `CHAR(n)`：长度固定，存身份证号、手机号这类固定长度的编码
- `TEXT`：存长文章，但不能建普通索引，尽量少用

### 时间类型

- `DATETIME`：存什么时区就是什么，**不自动转换**，推荐存 UTC 时间
- `TIMESTAMP`：会随时区设置转换，范围只到 2038 年（有 Y2K38 问题）

### 建完整的业务表

```sql
-- 商品表、订单表、订单明细表
CREATE TABLE products (
  product_id   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  product_name VARCHAR(120) NOT NULL,
  price        DECIMAL(12,2) NOT NULL,           -- 金额用 DECIMAL
  stock        INT UNSIGNED NOT NULL DEFAULT 0,  -- 库存不能为负
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (price >= 0)                             -- 价格不能是负数
) ENGINE=InnoDB;

CREATE TABLE orders (
  order_id     BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  order_status VARCHAR(20) NOT NULL DEFAULT '待支付',
  total_amount DECIMAL(12,2) NOT NULL,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(user_id),
  INDEX idx_orders_user_time (user_id, created_at)  -- 按用户查订单很常见，建索引
) ENGINE=InnoDB;

CREATE TABLE order_items (
  order_item_id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id      BIGINT UNSIGNED NOT NULL,
  product_id    BIGINT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED NOT NULL,
  unit_price    DECIMAL(12,2) NOT NULL,
  CONSTRAINT fk_items_order   FOREIGN KEY (order_id)   REFERENCES orders(order_id),
  CONSTRAINT fk_items_product FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE=InnoDB;

-- 插入测试数据
INSERT INTO products (product_name, price, stock) VALUES
  ('机械键盘', 399.00, 80),
  ('USB-C 扩展坞', 269.00, 120),
  ('显示器支架', 199.00, 50);

INSERT INTO orders (user_id, order_status, total_amount) VALUES
  (1, '已支付', 668.00),
  (1, '待支付', 199.00),
  (2, '已支付', 399.00);

INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES
  (1, 1, 1, 399.00),
  (1, 2, 1, 269.00),
  (2, 3, 1, 199.00),
  (3, 1, 1, 399.00);
```

## 五、基础查询：SELECT 怎么写

### 最简单的查询结构

```
SELECT  要查哪些列
FROM    从哪张表
WHERE   过滤条件（可以没有）
ORDER BY 排序（可以没有）
LIMIT   只要前 N 条（可以没有）
```

### 实战：查询用户订单

```sql
-- 查用户 1 的所有订单，按时间倒序，最新的在最前面
SELECT order_id, order_status, total_amount, created_at
FROM orders
WHERE user_id = 1
  AND order_status <> '已取消'
ORDER BY created_at DESC
LIMIT 10;
```

预期：返回用户 1 的订单，最新的排在第一行。

```sql
-- 查询已支付订单的完整明细（关联四张表）
SELECT
  o.order_id,
  u.username       AS 购买人,
  p.product_name   AS 商品名,
  oi.quantity      AS 数量,
  oi.unit_price    AS 单价,
  oi.quantity * oi.unit_price AS 小计
FROM orders AS o
JOIN users       AS u  ON u.user_id   = o.user_id
JOIN order_items AS oi ON oi.order_id = o.order_id
JOIN products    AS p  ON p.product_id = oi.product_id
WHERE o.order_status = '已支付'
ORDER BY o.order_id, oi.order_item_id;
```

预期：返回订单 1 和 3 的商品明细，并计算每行小计。

> **小技巧**：ORDER BY 里加主键（`order_id`），保证相同时间戳下的排序稳定，翻页不会乱。

---

### 思考与练习

1. 试着查询库存不足 60 件、价格在 200～400 元之间的商品。
2. `DELETE FROM users WHERE user_id = 1` 和 `TRUNCATE TABLE users` 有什么区别？试试看。
3. 给 `products` 表加一个 `category` 列（商品分类），用什么类型合适？

### 本章核心总结

- 数据库解决多人并发、断电恢复、大数据量查询三大问题
- SQL 四类命令各司其职：DDL 管结构、DML 改数据、DQL 查数据、DCL 管权限
- 金额用 `DECIMAL`，不用 `float`；字符串优先 `VARCHAR`；时间推荐 `DATETIME` 存 UTC

### 下一步学习建议

保存好这个初始化脚本，后续每篇文章都在这个库里做实验。下一篇学习更强大的查询：聚合统计、多表连接、子查询和窗口函数。
