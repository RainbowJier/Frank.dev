---
title: MongoDB 从零到一（05）：聚合管道（上），从 GROUP BY 到 Pipeline
date: 2026-08-27 14:00:00
categories:
  - 教程
tags:
  - MongoDB
  - 聚合管道
  - Java
description: 用流水线心智模型掌握 MongoDB 聚合框架：SQL 子句到聚合阶段的完整映射、$match/$group/$project/$sort 核心阶段、accumulator 一览、日期分组报表，以及内存限制与 $match 前置两条性能铁律。
keywords:
  - MongoDB 聚合管道
  - aggregation pipeline
  - $group accumulator
  - MongoDB 分组统计
  - allowDiskUse
lang: zh-CN
---

> **适合人群**：会写 SQL 的 `GROUP BY` 报表（第 03 篇 CRUD 已过关），想让 MongoDB 承担统计分析工作的开发者。
> 本文是聚合两连击的上半场：单集合内的管道思维与核心阶段；`$lookup` 联表、`$facet` 多面统计在下半场（第 06 篇）。

## 一、Pipeline 心智模型：数据在流水线上旅行

如果用一句话概括聚合管道（Aggregation Pipeline）：**文档从一端进入，依次流过一个个加工阶段，每个阶段的输出就是下一个阶段的输入**。

对 Java 开发者来说这几乎是母语——它就是数据库版的 Stream API：

```java
orders.stream()
      .filter(o -> o.getStatus().equals("PAID"))          // ≈ $match
      .collect(groupingBy(o -> month(o.getPaidAt()), ...)) // ≈ $group
```

```javascript
db.orders.aggregate([
  { $match: { status: "PAID" } },
  { $group: { _id: { $month: "$paidAt" }, gmv: { $sum: "$amount" } } }
])
```

两段代码读起来几乎是逐行互译。区别在于管道的每个阶段都是**独立的文档加工器**，可以自由组合、重复出现——`$match` 可以出现两次（先粗筛后细筛），这正是后面优化技巧的基础。

![图1：聚合管道：文档依次流过各阶段，输出即输入](aggregation-pipeline-flow.svg)

## 二、SQL ↔ Aggregation 阶段映射表

把你脑中的 SQL 知识直接翻译过来：

| SQL 子句 | Aggregation 阶段 | 说明 |
| --- | --- | --- |
| `WHERE` | `$match` | 尽量放在管道最前面（原因见第四节） |
| `GROUP BY` | `$group` | `_id` 指定分组键（可以是表达式） |
| `SUM() / AVG() / COUNT()` | accumulator | `$sum / $avg / $count…`，写在 `$group` 里 |
| `HAVING` | `$match`（第二处） | 同一个操作符放 `$group` 之后复用 |
| `ORDER BY` | `$sort` | 复合排序写对象键序 `{ a: 1, b: -1 }` |
| `LIMIT / OFFSET` | `$limit / $skip` | 分页三件套 |
| `SELECT 列` | `$project`（或早期 `$unset`） | 裁剪 + 重命名 + 计算列 |
| `SELECT DISTINCT` | `$groupBy` + `$first` 或 `$sortByCount` | 有便捷糖可用 |

![图2：SQL 子句与聚合阶段映射速查](sql-to-aggregation-map.svg)

需要反转直觉的一点：SQL 是"声明式的一句话"，而管道是"指令式的一段话"。好处是每一步的中间形态完全可见——排查一条复杂报表时，把管道拆开逐段 `aggregate()`，看每一站吐出什么，比 EXPLAIN 一整条 SQL 更直观。

## 三、核心阶段逐个击破

### 3.1 `$group` 与 accumulator

`$group` 的 `_id` 字段是分组键，其余字段全部通过 accumulator 定义。常用的记账员名单：

| accumulator | 作用 | 备注 |
| --- | --- | --- |
| `$sum` / `$avg` | 求和 / 均值 | 数值与日期均支持（平均日期合法！） |
| `$min` / `$max` | 极值 | 对字符串按字典序 |
| `$count` | 计数 | 5.0+ 的简写，等价 `{ $sum: 1 }` |
| `$push` / `$addToSet` | 收集成数组 / 去重数组 | 把分组内成员"打包带走" |
| `$first` / `$last` | 组内首个 / 末个 | 配合前面的 `$sort` 做"每组最新一条" |

```javascript
db.orders.aggregate([
  { $group: {
      _id: "$channel",                          // 按渠道分组
      total:   { $sum: "$amount" },
      orders:  { $count: {} },
      buyerSet:{ $addToSet: "$buyerId" },       // 去重买家清单
      lastPaid:{ $last: "$paidAt" }
  } }
])
```

想全局统计不分组？分组键给常量即可：`_id: null` 会把整个输入并成一组。

### 3.2 `$project`：裁剪、重命名与计算列

```javascript
{ $project: {
    _id: 0,
    channel: 1,                        // 包含模式
    月报标签: "2026",                   // 常量列也能塞
    含税额: { $multiply: ["$amount", 1.06] },
    首字母: { $substrCP: ["$channel", 0, 1] }
} }
```

规则只有一条别记混：包含（写 1/true）与排除（写 0/false）不能混用，唯一例外是 `_id` 默认返回所以可以单独置 0。计算字段的表达式能力极强（算术、字符串、条件），但复杂逻辑会让管道可读性骤降——超过三五行的表达式就该考虑搬回应用层。

### 3.3 `$sort` / `$skip` / `$limit` 与那份内存合同

和第 03 篇的 find 不同，聚合阶段的默认内存上限是 **100 MB/阶段**，超限直接报错。临时把表格变大可以用 `allowDiskUse: true` 让溢出数据落盘：

```javascript
db.orders.aggregate(pipeline, { allowDiskUse: true })
```

但要端正态度：allowDiskUse 是兜底安全阀而不是设计手段——每次落盘都是实打实的 I/O 惩罚。长期超限的正确姿势是前移 `$match` 缩水、补建索引（有索引时 `$sort` 在第 07 篇可以看到是不耗这个内存预算的）。

### 3.4 按时间分组做报表

日报周报月报是聚合最高频的应用场景，两种写法先记住新的：

```javascript
// 推荐：5.0+ 的截断操作符，保持日期类型还能接着算时间范围
{ $group: { _id: { $dateTrunc: { date: "$paidAt", unit: "month",
                                 timezone: "+08:00" } }, gmv: { $sum: "$amount" } } }

// 经典：转成字符串当键（注意 _id 变 string，且默认按 UTC 切月！）
{ $group: { _id: { $dateToString: { format: "%Y-%m", date: "$paidAt",
                                    timezone: "Asia/Shanghai" } }, gmv: { $sum: "$amount" } } }
```

那个 `timezone` 参数值得划重点：`Date` 底层存 UTC 毫秒（第 01 篇讲过），不指定时区的话，北京时间每晚八点后的订单会被归进"第二天"。做过跨境报表的人看见 UTC 四个字都会自动背脊发凉。

## 四、实战：订单月度经营报表

给 `shop` 补几笔订单（金额用 Decimal128 延续第 01 篇的纪律），然后拼一条完整的业务管道：

```javascript
db.orders.insertMany([
  { channel: "APP",    amount: NumberDecimal("4999.00"), status: "PAID",   paidAt: ISODate("2026-06-10T12:00:00Z") },
  { channel: "APP",    amount: NumberDecimal("129.00"),  status: "PAID",   paidAt: ISODate("2026-06-15T09:30:00Z") },
  { channel: "H5",     amount: NumberDecimal("2499.00"), status: "PAID",   paidAt: ISODate("2026-07-02T03:00:00Z") },
  { channel: "APP",    amount: NumberDecimal("79.90"),   status: "VOID",   paidAt: ISODate("2026-07-08T01:00:00Z") },
  { channel: "H5",     amount: NumberDecimal("4599.00"), status: "PAID",   paidAt: ISODate("2026-07-20T16:00:00Z") }
])

db.orders.aggregate([
  { $match: { status: "PAID" } },                                   // WHERE（前置！）
  { $group: {                                                       // GROUP BY 渠道+月份
      _id: { channel: "$channel",
             month: { $dateToString: { format: "%Y-%m", date: "$paidAt",
                                       timezone: "Asia/Shanghai" } } },
      gmv:     { $sum: "$amount" },
      orderNo: { $count: {} }
  } },
  { $match: { gmv: { $gte: NumberDecimal("1000") } } },             // HAVING：过滤小碎月
  { $sort:  { "_id.month": -1, gmv: -1 } },                         // ORDER BY
  { $project: { _id: 0, channel: "$_id.channel", month: "$_id.month",
                gmv: 1, orderNo: 1 } }                              // SELECT 整形输出
])
```

![图3：月度经营报表管道全景](monthly-report-pipeline.svg)

这条管道正好把第二节映射表的每一行都用上了。建议亲手跑一遍，再故意做两个实验：把第一个 `$match` 移到最后看行为差异；删掉 HAVING 行对比结果集。

## 五、常见坑清单

1. **`$match` 放在管道末尾**：全量文档白白流经前面所有阶段，性能差一个数量级。原则一句话——能过滤越早越好；
2. **时区缺省**：`$dateToString`/`$dateTrunc` 不带 timezone 就是 UTC 切割，日报总在早八点翻页就是这个病；
3. **分组键类型敏感**：`"42"` 和 `42`、`ObjectId("...")` 和它的字符串是不同组，键来自用户输入或多个来源时先统一类型；
4. **全量统计不看基数**：`$group` 一个百万级基数的 `_id`，中间 map 得到自己扛——先想想能不能提前 `$match` 到可管理的规模；
5. **内存超限才想起索引**：管道不是索引绝缘体，`$match`/`$sort` 吃不吃索引差别巨大，埋个钩子第 07 篇收；
6. **`$project` 一屏装不下**：层层嵌套表达式的管道没人敢改，复杂转换拆应用层或拆多段 `$merge` 中间集合更健康。

## 六、总结与下一步

- 聚合 = 文档流水线：阶段有序组合、上一站输出即下一站输入，大脑可以直接复用 Stream API 的模型；
- SQL 八大子句都有对应阶段，`$match` 身兼 WHERE 与 HAVING 两职；
- accumulator 表格记牢 `$sum/$avg/$count/$push/$addToSet/$first/$last`；`_id: null` 即全表一组；
- 单阶段内存上限 100 MB，`allowDiskUse` 只是安全阀；时间分组必须显式 timezone；
- 性能第一铁律已经出现两次：**`$match` 能多早就多早**。

**下一篇**：《MongoDB 从零到一（06）：聚合管道（下）》——走出单集合：`$lookup` 联表、`$facet` 一趟拿全分页页脚、`$graphLookup` 递归组织架构树，以及把报表物化进落地的集合。详见 {% post_link articles/MongoDB/06-mongodb-aggregation-lookup-facet 'MongoDB 从零到一（06）：聚合管道（下）' %}。

> **思考与练习**
>
> 1. 把本文月报改成「季度 × 渠道」双维度，并为每一季附加客单价 `gmv/orderNo`（提示：`$divide` 出现在 `$group` 内还是外？为什么）。
> 2. 故意触发一次 100 MB 内存限制（可以拷贝大批测试数据后不带 sort 索引地排序），观察报错信息里提到的阶段名。
> 3. `shop.products` 的 tags 想统计"每个标签的商品数与均价"，写出这条管道并思考：文档数会变成多少？（`$unwind` 预告，下一章登场。）
