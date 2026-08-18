---
title: MySQL 从零到一（04）：大小写规范与命名设计
date: 2026-08-17 10:15:00
categories:
  - 教程
tags:
  - MySQL
  - 数据建模
  - 命名规范
description: 大小写敏感为什么会踩坑？企业级命名规范是什么？这篇全说清楚。
lang: zh-CN
---

## 一、为什么大小写会踩坑？

很多同学在 Windows 开发，在 Linux 部署，结果上线就报错"表不存在"。

**根本原因**：MySQL 把库名和表名对应到操作系统的文件或目录，而：
- **Linux 文件系统**：区分大小写，`Orders` 和 `orders` 是两个不同的文件
- **Windows 文件系统**：默认不区分，`Orders` 和 `orders` 是同一个文件

所以同一套 SQL，在 Windows 上跑没问题，到 Linux 上就炸了。

### 关键参数：`lower_case_table_names`

```sql
-- 查看当前实例的大小写设置
SHOW VARIABLES LIKE 'lower_case_table_names';
```

| 值 | 含义 | 典型环境 |
| --- | --- | --- |
| 0 | 原样保存，区分大小写 | Linux 默认 |
| 1 | 转为小写保存，不区分 | Windows 默认 |
| 2 | 原样保存，但比较时不区分 | macOS 默认 |

> **重要**：这个参数只能在初始化数据库时设置，不能随便在线修改，改错了要重建实例。

### 字符串值的大小写：靠排序规则（Collation）

表名的大小写是参数控制的，但**字符串值**（比如用户输入的内容）是否区分大小写，由**排序规则（Collation）**决定：

```sql
-- 查看当前排序规则
SHOW VARIABLES LIKE 'collation_server';

-- 测试：在 utf8mb4_0900_ai_ci 下，字母大小写不影响比较
SELECT 'ABC' = 'abc';
-- 结果：1（相等）

-- 如果想区分大小写，改用 utf8mb4_0900_as_cs
```

Collation 名字里：
- `ci` = case insensitive（不区分大小写）
- `cs` = case sensitive（区分大小写）
- `ai` = accent insensitive（不区分重音）

## 二、各类对象的大小写行为总结

| 对象 | 是否区分大小写 | 建议 |
| --- | --- | --- |
| SQL 关键字（SELECT、FROM…）| 不区分 | 统一大写，可读性更好 |
| 库名、表名 | 受 `lower_case_table_names` 影响 | **统一用小写** |
| 列名 | 通常不区分 | 统一用 snake_case |
| 字符串值 | 受 Collation 影响 | 明确设置，别猜 |

## 三、企业级命名规范

命名规范的意义不是"看起来整洁"，而是**让代码、数据库和业务沟通无摩擦**——新同学一眼就能看懂每张表是干什么的，迁移和排查问题时不会因为名字搞错。

### 库名和表名

```sql
-- 推荐：小写 + 下划线（snake_case），语义清晰
CREATE DATABASE shop_db;

CREATE TABLE user_profiles (
  profile_id   BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL,
  display_name VARCHAR(80)  NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 不推荐：混合大小写、缩写不清晰
-- CREATE TABLE UserProfile  -- 驼峰命名，跨平台有隐患
-- CREATE TABLE usr_prf      -- 缩写看不懂
```

### 列名规范

| 规则 | 举例 | 说明 |
| --- | --- | --- |
| 主键 | `user_id`、`order_id` | 用 `实体名_id` |
| 外键 | 与被引用列名一致 | `orders.user_id` 对应 `users.user_id` |
| 时间 | `created_at`、`updated_at` | 固定这两个名字，全库统一 |
| 布尔/状态 | `is_deleted`、`is_active` | 布尔用 `is_` 前缀 |
| 金额 | `total_amount`、`unit_price` | 明确含义，配合 `DECIMAL` 类型 |

### 索引命名

```sql
-- 普通索引：idx_表名_列名
-- 唯一索引：uk_表名_列名
-- 外键约束：fk_表名_关联表名

CREATE TABLE order_status_history (
  history_id  BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_id    BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status   VARCHAR(20) NOT NULL,
  changed_by  BIGINT UNSIGNED NOT NULL,
  changed_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_status_history_order
    FOREIGN KEY (order_id) REFERENCES orders(order_id),
  KEY idx_status_history_order_time (order_id, changed_at)
) ENGINE=InnoDB;
```

把约束和索引的名字显式写出来，出了 bug 错误信息里会告诉你是哪个约束违反了，而不是一串 MySQL 内部编号。

---

### 常见误区提醒

1. **用反引号解决保留字冲突**：`` `order` ``、`` `desc` `` 虽然能跑，但这是"打补丁"，不是命名策略。换个不冲突的名字才是正解（比如 `shop_order`、`description`）。

2. **在 Windows 开发 Linux 部署**：哪怕你觉得大小写统一了，也要在 CI 里用 Linux MySQL 跑迁移脚本做验证。

3. **以为列名大写可以影响查询**：`WHERE UserName = 'Alice'` 和 `WHERE username = 'alice'` 在默认 ci Collation 下结果一样，列名大小写不影响字符串值的比对。

### 本章核心总结

- 大小写问题来自操作系统文件系统的差异，核心是 `lower_case_table_names`
- 统一用小写 snake_case 命名库名、表名、列名，彻底避坑
- 字符串值的大小写敏感由 Collation 控制，建库时就该确定好

### 下一步学习建议

接下来进入存储引擎——理解 InnoDB 和 MyISAM 的区别，才能搞懂为什么 MySQL 默认用 InnoDB，以及什么时候可以选其他引擎。
