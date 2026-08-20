---
title: MySQL 从零到一（03）：事务与隔离级别
date: 2026-08-17 10:10:00
categories:
  - 教程
tags:
  - MySQL
  - 事务
  - InnoDB
description: 用银行转账讲清楚事务是什么、ACID 是啥、隔离级别有哪些坑，附双会话实验。
lang: zh-CN
---

> 本文有并发实验，需要**打开两个 MySQL 客户端窗口**，分别标记"会话 A"和"会话 B"来模拟两个用户同时操作。

## 一、事务是什么？用转账来理解

假设你要给朋友转账 200 元，后台实际上需要执行两步：
1. 你的账户 **减少** 200 元
2. 朋友的账户 **增加** 200 元

如果执行完第 1 步，服务器突然断电，第 2 步没执行——钱从你账户扣了，但朋友没收到。

**事务**就是解决这个问题的：把这两步打包成一个"要么全成功、要么全撤销"的操作单元。这就是事务的设计动机。

### 先准备账户数据

```sql
-- 创建账户表，CHECK 约束保证余额不能为负
USE mysql_zero_to_one;
DROP TABLE IF EXISTS accounts;
CREATE TABLE accounts (
  account_id INT PRIMARY KEY,
  owner      VARCHAR(50) NOT NULL,
  balance    DECIMAL(12,2) NOT NULL,
  CHECK (balance >= 0)
) ENGINE=InnoDB;

INSERT INTO accounts VALUES
  (1, 'Alice', 1000.00),
  (2, 'Bob',    500.00);

SELECT * FROM accounts;
-- Alice: 1000, Bob: 500，总和 1500
```

## 二、ACID——事务的四个保证

| 字母 | 中文 | 大白话解释 |
| --- | --- | --- |
| A（Atomicity）| 原子性 | 一组操作要么全部成功，要么全部撤销，不存在"做了一半" |
| C（Consistency）| 一致性 | 操作前后数据满足约束，比如转账后两账户总和不变 |
| I（Isolation）| 隔离性 | 多个事务同时运行，互不干扰，像是"各自独立" |
| D（Durability）| 持久性 | 提交后就算服务器重启，数据也不会丢 |

**InnoDB 怎么实现这四点？**

- **原子性 + 持久性**：靠 Undo Log（撤销日志）和 Redo Log（重做日志）
  - Undo Log 记录"改之前是什么"，撤销时用来还原
  - Redo Log 记录"要做什么操作"，崩溃重启后重放，保证已提交的不丢
- **隔离性**：靠 MVCC（多版本并发控制）+ 锁

![图3：InnoDB 事务提交与 Undo、Redo、Binlog 协作流程](mysql-transaction-wal-flow.svg)

## 三、一次完整的转账事务

```sql
-- Alice 转给 Bob 200 元
START TRANSACTION;                              -- 开始事务

-- 先锁定两个账户，防止其他事务同时修改（FOR UPDATE = 当前读 + 加锁）
SELECT account_id, balance FROM accounts
WHERE account_id IN (1, 2)
ORDER BY account_id
FOR UPDATE;

UPDATE accounts SET balance = balance - 200 WHERE account_id = 1;  -- Alice 扣款
UPDATE accounts SET balance = balance + 200 WHERE account_id = 2;  -- Bob 收款

COMMIT;                                         -- 提交，两步同时生效

SELECT * FROM accounts;
-- 预期：Alice 800, Bob 700，总和仍是 1500
```

如果中途出了问题，执行 `ROLLBACK` 就会把两步操作全部撤销，Alice 的钱不会丢。

## 四、隔离级别：多个事务同时跑会遇到什么问题？

当很多用户同时操作数据库时，如果隔离不够，会出现三种"并发问题"：

| 问题 | 解释 | 举例 |
| --- | --- | --- |
| 脏读 | 读到了别人**还没提交**的数据 | A 看到 B 修改了余额，但 B 还没提交，随后 B 回滚了 |
| 不可重复读 | 同一事务里两次读取同一行，结果不一样 | A 查了余额是 1000，B 提交扣款后 A 再查变成 800 |
| 幻读 | 同一事务里两次查询，第二次多了/少了几行 | A 查订单共 5 条，B 新增一条提交后，A 再查变成 6 条 |

SQL 标准定义了四种隔离级别来控制这些问题：

| 隔离级别 | 脏读 | 不可重复读 | 幻读 | MySQL 并发性能 |
| --- | --- | --- | --- | --- |
| READ UNCOMMITTED（读未提交）| 有 | 有 | 有 | 最高（但最危险）|
| READ COMMITTED（读已提交）| 无 | 有 | 有 | 较高 |
| REPEATABLE READ（可重复读）| 无 | 无 | InnoDB 大幅减少 | **MySQL 默认** |
| SERIALIZABLE（串行化）| 无 | 无 | 无 | 最低 |

## 五、双会话实验：亲眼见证并发问题

### 实验 1：脏读（用 READ UNCOMMITTED 复现）

**会话 A**（先执行）：
```sql
-- 会话 A：切换到最低隔离级别，开始事务
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
START TRANSACTION;
SELECT balance FROM accounts WHERE account_id = 1;
-- 结果：1000
```

**会话 B**（同时执行，不要提交）：
```sql
-- 会话 B：修改余额，但不提交
START TRANSACTION;
UPDATE accounts SET balance = balance - 300 WHERE account_id = 1;
-- 此时 Alice 余额在内存中变成了 700，但还没提交
```

**会话 A**（再次查询）：
```sql
-- 会话 A 再次查询，在 READ UNCOMMITTED 下会看到 B 未提交的 700
SELECT balance FROM accounts WHERE account_id = 1;
-- 脏读！如果 B 随后 ROLLBACK，这个 700 就是错的
```

**会话 B**（回滚）：
```sql
ROLLBACK;
-- B 回滚，数据恢复 1000，但 A 已经读到了错误的 700
```

---

### 实验 2：不可重复读（用 READ COMMITTED 复现）

**会话 A**：
```sql
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
START TRANSACTION;
SELECT balance FROM accounts WHERE account_id = 1;
-- 结果：1000
```

**会话 B**：
```sql
-- B 修改并提交
START TRANSACTION;
UPDATE accounts SET balance = balance - 100 WHERE account_id = 1;
COMMIT;
```

**会话 A**（同一事务内再查一次）：
```sql
SELECT balance FROM accounts WHERE account_id = 1;
-- READ COMMITTED 下读到了 B 提交后的 900，跟第一次查的 1000 不一样
-- 这就是"不可重复读"
ROLLBACK;
```

切换到 `REPEATABLE READ`（MySQL 默认）重复实验，会话 A 第二次读仍然是 1000——同一事务内的快照保持一致。

---

## 六、保存点：撤销"一部分"操作

有时候不想把整个事务全撤销，只想回到某个中间状态，可以用 `SAVEPOINT`：

```sql
-- 先恢复测试数据
UPDATE accounts SET balance = 1000 WHERE account_id = 1;

START TRANSACTION;
UPDATE accounts SET balance = balance + 100 WHERE account_id = 1;  -- +100

SAVEPOINT after_bonus;   -- 在这里打个存档点

UPDATE accounts SET balance = balance - 9999 WHERE account_id = 1; -- 模拟操作失误

-- 发现不对，只撤销到存档点，保留 +100 的操作
ROLLBACK TO SAVEPOINT after_bonus;

COMMIT;
SELECT balance FROM accounts WHERE account_id = 1;
-- 预期：1100（只保留了 +100，-9999 被撤销了）
```

---

### 常见误区提醒

1. **"可重复读"能防所有幻读**：不完全对。MySQL InnoDB 的 MVCC 可以防止普通 `SELECT` 的幻读，但 `SELECT ... FOR UPDATE`（当前读）在某些情况下仍会看到新插入的行。

2. **事务越长越安全**：错！长事务会长时间持有锁，导致其他事务等待；还会让 Undo Log 积压，影响整体性能。尽量让事务短而精准。

3. **忘记提交或回滚**：应用连接池里的连接归还时，如果忘记提交/回滚，事务状态会"污染"下一个使用这个连接的请求，产生诡异 bug。

4. **`ROLLBACK` 能撤销 DDL**：`ALTER TABLE`、`CREATE TABLE` 这类 DDL 语句在 MySQL 中会隐式提交，不能被事务回滚。

### 本章核心总结

- 事务把多步操作变成"原子"操作，要么全成功，要么全撤销
- ACID 分别对应原子性、一致性、隔离性、持久性
- MySQL 默认隔离级别是 `REPEATABLE READ`，日常业务够用
- 用 `SAVEPOINT` 可以在事务中间打存档，只撤销到某个点

### 下一步学习建议

了解事务之后，可以进一步学习锁（行锁、间隙锁、表锁）和死锁的排查方法。接下来我们先看一个容易忽略的坑：大小写规范。
