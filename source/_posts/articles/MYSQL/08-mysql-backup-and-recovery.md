---
title: MySQL 从零到一（08）：备份与恢复
date: 2026-08-17 10:35:00
categories:
  - 教程
tags:
  - MySQL
  - 备份恢复
  - Binlog
description: 用大白话讲清 mysqldump、binlog 增量备份和时间点恢复，建立可验证的备份体系。
lang: zh-CN
---

## 一、备份为什么重要？

"我们数据库从来没出过问题，不需要备份。"

这句话有两种可能：要么是真的没出过问题，要么是出了问题之后公司就没了。

数据库故障可能来自：误删表、代码 bug 批量更新了错误数据、服务器硬盘损坏、勒索病毒……备份是这些情况下的最后一道防线。

### 备份的两个核心指标

- **RPO（Recovery Point Objective）**：最多允许丢多少数据？比如 RPO=1小时，意味着最坏情况下会丢 1 小时的数据。
- **RTO（Recovery Time Objective）**：最多允许停多久？比如 RTO=30分钟，意味着故障后 30 分钟内必须恢复。

这两个指标越小，备份方案越贵、越复杂。根据业务需求选合适的方案，不是越复杂越好。

## 二、逻辑备份：mysqldump

### 什么是逻辑备份？

逻辑备份把数据库导出成 SQL 语句（`CREATE TABLE`、`INSERT INTO`……），可以直接用文本编辑器打开，跨版本、跨平台都能用。缺点是大库导出慢，恢复也慢。

### 全量备份

```bash
# 备份整个数据库（-u 用户名，-p 会提示输入密码）
mysqldump -uroot -p \
  --single-transaction \    # 对 InnoDB 做一致性快照，不影响正常读写
  --routines \              # 包含存储过程和函数
  --events \                # 包含定时事件
  --triggers \              # 包含触发器
  --set-gtid-purged=OFF \   # 不包含 GTID 信息，恢复时更灵活
  mysql_zero_to_one > /backup/mysql_zero_to_one_20260817.sql

# 备份完查看文件大小，确认不是空文件
ls -lh /backup/mysql_zero_to_one_20260817.sql
```

> `--single-transaction` 只对 InnoDB 有效。如果库里有 MyISAM 表，需要加 `--lock-tables` 或在业务低峰期备份。

### 恢复备份

```bash
# 先创建目标库
mysql -uroot -p -e "CREATE DATABASE mysql_zero_to_one_restore CHARACTER SET utf8mb4;"

# 把备份文件导入新库
mysql -uroot -p mysql_zero_to_one_restore < /backup/mysql_zero_to_one_20260817.sql
```

恢复后验证：

```sql
-- 检查表是否都在，订单数量是否对得上
USE mysql_zero_to_one_restore;
SHOW TABLES;
SELECT COUNT(*) AS 订单数 FROM orders;
```

## 三、增量备份：binlog

### binlog 是什么？

binlog（Binary Log，二进制日志）会记录数据库里所有的数据变更操作。开启 binlog 后，每次 INSERT/UPDATE/DELETE 都会被记录。

有了 binlog，就能做到：
- **增量备份**：在全量备份基础上，只备份变更的部分
- **时间点恢复（PITR）**：精确恢复到某个时间点，比如"恢复到删表操作的前一秒"

```sql
-- 查看 binlog 是否开启（生产环境应该是 ON）
SHOW VARIABLES LIKE 'log_bin';

-- 查看当前有哪些 binlog 文件
SHOW BINARY LOGS;

-- 查看当前正在写的 binlog 位置
SHOW MASTER STATUS;
```

### 时间点恢复实战

场景：有人在 `2026-08-17 14:30:00` 误执行了 `DELETE FROM orders`，把订单全删了。你需要恢复到删除之前。

```bash
# 第一步：先恢复最近的全量备份
mysql -uroot -p mysql_zero_to_one < /backup/mysql_zero_to_one_20260817.sql

# 第二步：从 binlog 中提取全量备份之后、误操作之前的变更
mysqlbinlog \
  --start-datetime='2026-08-17 10:00:00' \
  --stop-datetime='2026-08-17 14:29:59' \   # 停在误操作之前一秒
  /var/lib/mysql/binlog.000001 > /tmp/increment.sql

# 第三步：在恢复库上重放增量
mysql -uroot -p mysql_zero_to_one < /tmp/increment.sql
```

> 时间点恢复的关键：**全量备份是基础**，没有全量备份，binlog 什么都做不了。全量 + binlog 才能拼出任意时间点的状态。

## 四、物理备份：XtraBackup 热备

### 为什么需要物理备份？

`mysqldump` 导出大库（比如 100GB）可能需要几个小时，期间应用仍然可以读写，但恢复起来也要几个小时。物理备份直接复制数据文件，速度快得多。

Percona XtraBackup 是最流行的开源 MySQL 物理热备工具，备份期间**不需要停库**，应用可以正常读写。

```bash
# 安装（版本要和 MySQL 大版本匹配，MySQL 8.0 对应 xtrabackup 8.0）
# Ubuntu: apt install percona-xtrabackup-80

# 全量热备（需要有备份权限的账号）
xtrabackup --backup \
  --target-dir=/backup/mysql/full-20260817 \
  --user=backup_user \
  --password='REDACTED'             # 实际使用时通过配置文件传密码，不要写在命令行

# 备份完成后，先做 prepare（应用 redo log，使备份数据一致）
xtrabackup --prepare \
  --target-dir=/backup/mysql/full-20260817

# 恢复（确保 MySQL 已停止，datadir 目录已清空）
xtrabackup --copy-back \
  --target-dir=/backup/mysql/full-20260817

# 修复文件权限
chown -R mysql:mysql /var/lib/mysql
```

> **注意**：`--copy-back` 之前必须确认：① MySQL 服务已停止，② 数据目录已清空或备份。这是不可逆操作，执行前一定要确认。

### 逻辑备份 vs 物理备份

| | mysqldump（逻辑）| XtraBackup（物理）|
|---|---|---|
| 速度 | 慢（大库要小时级）| 快（接近文件复制速度）|
| 恢复速度 | 慢 | 快 |
| 跨版本 | 支持 | 需同主版本 |
| 文件可读 | 是（SQL 文本）| 否（二进制文件）|
| 适合 | 小中型库、结构迁移 | 大库、生产热备 |

## 五、备份不等于可恢复——恢复演练

**备份文件存在 ≠ 可以恢复数据。**

很多团队有备份，但从来不测试恢复，直到真的出问题才发现备份文件损坏、恢复脚本有 bug 或者权限不够……

**建议每月做一次恢复演练**：

1. 在隔离环境（不是生产！）启动一个临时 MySQL 实例
2. 用备份文件恢复数据
3. 执行关键业务查询，验证数据是否正确
4. 记录恢复花了多长时间（这就是你的真实 RTO）
5. 记录数据丢了多少（这就是你的真实 RPO）

```sql
-- 恢复验证清单
SHOW TABLES;                          -- 表是否都在
SELECT COUNT(*) FROM orders;          -- 核心表行数是否正确
SELECT MAX(created_at) FROM orders;   -- 最新数据的时间点，看丢了多少
```

---

### 常见误区提醒

1. **只备份不恢复测试**：这是最危险的错觉，发现问题时往往已经太晚。
2. **备份和数据库放同一台服务器**：服务器挂了，备份也没了。备份必须存到**异地**或**另一台机器**。
3. **用 root 账号备份**：应该创建一个只有备份权限的专用账号，最小权限原则。
4. **备份文件不加密**：备份文件里有所有用户数据，传输和存储时必须加密。

### 本章核心总结

- `mysqldump` 逻辑备份，跨版本灵活；大库速度慢，适合中小型库
- binlog 提供增量和时间点恢复能力；全量 + binlog 才能完整恢复
- XtraBackup 物理热备，速度快，适合大库生产环境
- 备份体系必须包含：定期全量 + binlog 增量 + 异地存储 + 定期恢复演练

### 下一步学习建议

最后一篇是综合实战：把表设计、索引、事务、在线变更、读写分离都串起来，搭一个电商订单系统，并给出完整的 MySQL 学习路线图。
