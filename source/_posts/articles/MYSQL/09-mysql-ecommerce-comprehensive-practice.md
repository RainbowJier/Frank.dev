---
title: MySQL 从零到一（09）：电商订单系统综合实战
date: 2026-08-17 10:40:00
categories:
  - 教程
tags:
  - MySQL
  - 电商系统
  - 主从复制
description: 用电商订单系统综合运用前八篇的知识，最后给出完整 MySQL 学习路线图。
lang: zh-CN
---

> 本篇是系列收尾，把前面学的表设计、索引、事务、备份、主从复制全部串起来，搭建一个贴近真实业务的电商订单系统核心结构。

## 一、设计电商核心表

### 设计思路

下单的完整链路是：**用户选商品 → 下单 → 库存扣减 → 支付 → 发货**。

每个环节都可能出问题，所以表设计要考虑：
- 金额用 `DECIMAL`，不用 `float`
- 库存扣减要防超卖（并发扣减）
- 支付要幂等（同一笔钱不能被扣两次）
- 状态变更要留审计记录

![图6：电商订单核心表关系与访问路径](/images/svg/mysql-ecommerce-schema.svg)

### 核心表结构

```sql
USE mysql_zero_to_one;

-- 库存表：和商品表分开，方便并发控制
CREATE TABLE inventory (
  product_id      BIGINT UNSIGNED PRIMARY KEY,
  available_stock INT UNSIGNED NOT NULL,       -- 可售数量
  reserved_stock  INT UNSIGNED NOT NULL DEFAULT 0, -- 已下单未付款的锁定数量
  updated_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
                  ON UPDATE CURRENT_TIMESTAMP, -- 每次更新自动刷新时间
  CONSTRAINT fk_inventory_product
    FOREIGN KEY (product_id) REFERENCES products(product_id)
) ENGINE=InnoDB;

-- 支付表：记录每次支付，payment_no 保证幂等
CREATE TABLE payments (
  payment_id     BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id       BIGINT UNSIGNED NOT NULL,
  payment_no     VARCHAR(64) NOT NULL UNIQUE,  -- 支付流水号，唯一，防重复支付
  payment_status VARCHAR(20) NOT NULL,
  paid_amount    DECIMAL(12,2) NOT NULL,
  paid_at        DATETIME NULL,                -- 支付成功时间，未支付为 NULL
  CONSTRAINT fk_payments_order
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
  KEY idx_payments_order_status (order_id, payment_status)
) ENGINE=InnoDB;

-- 初始化库存
INSERT INTO inventory (product_id, available_stock) VALUES
  (1, 80), (2, 120), (3, 50);
```

## 二、下单事务：防止超卖

### 问题场景

商品只剩 1 件，但同时有 100 个人点击"购买"。如果不加锁，所有人都看到库存=1，都下单成功，库存就变成了 -99。

### 解决方案：条件更新 + 检查影响行数

```sql
-- 完整的下单事务（应用层需要检查 ROW_COUNT()）
START TRANSACTION;

-- 用条件更新扣库存：只有库存 >= 购买数量时才成功
-- 这条语句是原子的，不会有并发问题
UPDATE inventory
SET available_stock = available_stock - 1,
    reserved_stock  = reserved_stock  + 1
WHERE product_id = 1
  AND available_stock >= 1;  -- 关键条件：库存不够就不更新

-- 检查是否真的更新成功了（ROW_COUNT() = 0 说明库存不足）
SELECT ROW_COUNT() AS 扣库存结果;
-- 如果结果是 0，应用层要 ROLLBACK 并提示"库存不足"

-- 库存扣成功，继续创建订单
INSERT INTO orders (user_id, order_status, total_amount)
VALUES (1, '待支付', 399.00);

COMMIT;
```

> **这里的关键**：`UPDATE ... WHERE available_stock >= 1` 是原子操作，数据库级别的保证，不会有两个事务同时扣成功，这比先 SELECT 再 UPDATE 要安全得多。

## 三、从开发到上线：如何修改线上表结构？

### 问题：直接 ALTER TABLE 可能锁表

给线上的大表加一列或加索引，直接执行 `ALTER TABLE` 在 MySQL 某些情况下会锁表，期间所有写操作都要等待，可能影响几分钟甚至几十分钟。

### MySQL 8.0 的 INSTANT 变更

很多简单操作在 MySQL 8.0 里支持 `ALGORITHM=INSTANT`，几乎瞬间完成：

```sql
-- 给订单表加备注列，INSTANT 方式，不锁表
ALTER TABLE orders
  ADD COLUMN customer_note VARCHAR(255) NULL,
  ALGORITHM=INSTANT;

-- 验证字段已添加
SHOW COLUMNS FROM orders LIKE 'customer_note';
```

不支持 INSTANT 的操作（比如修改列类型、重建索引），才需要用在线工具。

```bash
# pt-osc 是 Percona Toolkit 里的在线变更工具
# 原理：创建影子表 → 把数据迁移到影子表 → 用触发器同步增量 → 瞬间重命名
# 适合大表的结构变更，生产使用前要先在测试环境验证

# 格式示例（需要先安装 Percona Toolkit）
pt-online-schema-change \
  --alter "ADD INDEX idx_orders_status_time (order_status, created_at)" \
  D=mysql_zero_to_one,t=orders \
  --execute --ask-pass
```

## 四、读写分离：让读不影响写

### 什么是主从复制？

主库（Master）负责写，从库（Replica）负责读。主库把所有变更写到 binlog，从库的 I/O 线程把 binlog 复制过来，SQL 线程重放，保持数据同步。

![图5：主从复制与备份恢复数据流](/images/svg/mysql-replication-and-recovery.svg)

```sql
-- 查看主库的 binlog 状态（主库上执行）
SHOW MASTER STATUS;

-- 查看从库的复制状态（从库上执行）
-- MySQL 8.0.22 之后推荐用 SHOW REPLICA STATUS
SHOW SLAVE STATUS\G
-- 关注：Seconds_Behind_Master（复制延迟秒数）
--       Slave_SQL_Running 应该是 Yes
--       Slave_IO_Running 应该是 Yes
```

### 读写分离的路由策略

| 请求类型 | 走哪里 | 原因 |
|---|---|---|
| 所有写操作（INSERT/UPDATE/DELETE）| 主库 | 从库只读 |
| 刚写完马上读（比如下单后查订单）| 主库 | 复制有延迟，从库可能还没同步 |
| 允许延迟的读（列表页、统计）| 从库 | 减轻主库压力 |

> 最常见的 bug：下单成功 → 跳转到订单详情页 → 查的是从库 → 从库还没同步 → 页面显示"订单不存在"。解决方法：刚写完的数据，强制查主库。

## 五、MySQL 学习路线图

恭喜你看完了这个系列的全部九篇！从零开始，你已经覆盖了：

```
数据库基础 → SQL 四类语句 → 聚合/连接/子查询/窗口函数
     → 事务与 ACID → 大小写与命名 → 存储引擎
     → B+Tree 索引原理 → 慢查询优化 → 备份恢复 → 综合实战
```

### 下一步可以深入的方向

| 方向 | 推荐学什么 |
|---|---|
| 🔒 锁机制 | 行锁/间隙锁/表锁、死锁分析、`SHOW ENGINE INNODB STATUS` |
| ⚡ 优化进阶 | 优化器成本模型、统计信息直方图、`EXPLAIN ANALYZE` |
| 🔄 高可用 | GTID 复制、半同步复制、InnoDB Cluster / Group Replication |
| 📊 监控 | Buffer Pool 命中率、复制延迟、连接数、慢查询趋势 |
| ☁️ 云数据库 | RDS/PolarDB 自动扩缩容、快照备份、只读实例 |
| 🛠️ 运维工具 | pt-query-digest、gh-ost、Percona Monitoring and Management |

---

### 常见误区提醒

1. **读写分离就能解决所有性能问题**：读写分离只解决"读多写少"的场景，如果写本身就很慢，从库再多也没用。

2. **DDL 变更不需要评审**：线上大表的结构变更可能导致长时间锁表，必须评估影响、选对工具、安排好时间窗口。

3. **主从同步就等于备份**：从库只同步数据变更，你在主库误删了数据，从库也会同步这个误删操作。备份和复制是两回事，都要有。

### 本章核心总结

- 库存扣减用条件更新，让数据库保证原子性，而不是先查再改
- 在线 DDL 变更：能用 INSTANT 就用；大表结构变更用 pt-osc/gh-ost
- 读写分离要注意复制延迟，刚写完的数据要读主库
- MySQL 是个深不见底的领域——索引、锁、复制、优化器……每一块都值得深挖

### 下一步学习建议

- 搭一个完整的本地测试环境，把本系列的 SQL 都跑一遍
- 找一个真实项目，从 `EXPLAIN` 开始做一次完整的慢查询优化
- 阅读《高性能 MySQL》（第 4 版）或官方文档的 InnoDB 章节，从深度理解原理开始进阶
