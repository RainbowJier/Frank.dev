---
title: MongoDB 从零到一（03）：CRUD 全解，find 操作符与更新表达式
date: 2026-08-27 12:00:00
categories:
  - 教程
tags:
  - MongoDB
  - 数据库
  - Java
description: 系统梳理 MongoDB 增删改查：find 的比较、逻辑、字段、数组四大类操作符，投影与排序分页，更新的操作符体系与整文档替换的风险，以及 bulkWrite 批量写与六条高频踩坑清单。
keywords:
  - MongoDB CRUD
  - MongoDB find 操作符
  - MongoDB updateOne
  - MongoDB bulkWrite
  - MongoDB 教程
lang: zh-CN
---

> **适合人群**：环境已经跑起来（第 02 篇），准备正式上手增删改查的开发者。
> 本文所有示例基于第 02 篇灌入的 `shop.products` 四条异构文档，命令可直接粘进 mongosh 执行。系列演示基于 MongoDB 7.x，其中绝大多数能力在 4.x 就已可用。

## 一、CRUD 的心智模型：条件和动作都是 JSON

MySQL 里增删改查靠四种子句表达；MongoDB 把它们统一成了四个动词方法，而条件和动作本身就是普通文档：

| 你想做的事 | MySQL | MongoDB 单条 | MongoDB 多条 |
| --- | --- | --- | --- |
| 插入 | `INSERT INTO … VALUES` | `insertOne(doc)` | `insertMany([docs])` |
| 查询 | `SELECT … WHERE` | `find(filter, projection)` | find 天然返回多条 |
| 更新 | `UPDATE … SET` | `updateOne(filter, update)` | `updateMany(filter, update)` |
| 删除 | `DELETE FROM …` | `deleteOne(filter)` | `deleteMany(filter)` |

![图1：SQL 子句与 MongoDB CRUD 方法的对应关系](sql-to-mongodb-crud-map.svg)

这张表里藏着一个刻意的设计：**凡是名字里没有 Many 的写操作，最多只影响一条文档**。初学阶段这其实是安全阀——手抖写出过宽的过滤条件时，updateOne 最坏只改坏一条；反过来，什么时候该升级成 Many 由你显式决定，而不是撞运气。

第二个要点：`update` 参数分两种形态——**操作符更新**和**整文档替换**。这是本文最重要的一条红线，第三节展开。

## 二、查：find 的操作符体系

### 2.1 精确匹配、投影与嵌套路径

最朴素的用法直接拿字段值当条件：

```javascript
db.products.find({ name: "手机 X" })
```

find 的第二个参数是投影，声明只要哪些字段（`_id` 默认总在，除非置 0）：

```javascript
db.products.find(
  { name: "手机 X" },
  { name: 1, price: 1 }        // 只返回名称与价格
)
```

嵌套结构与数组元素用点路径直达：

```javascript
db.products.find({ "spec.color": "黑" })          // 嵌套字段
db.products.find({ sizes: ["M", "L"] })            // ⚠️ 这是"整个数组恰好等于"，不是包含
```

最后一行的语义容易被误解：传入完整数组是**整体相等比较**且顺序敏感。想在数组中找"包含某个元素"，直接写元素本身即可（见 2.4）。

### 2.2 比较操作符：SQL WHERE 的直译

| 操作符 | 含义 | 示例 | 近似 SQL |
| --- | --- | --- | --- |
| `$eq` | 等于 | `{ stock: 120 }` | `stock = 120` |
| `$ne` | 不等于 | `{ stock: { $ne: 0 } }` | `stock <> 0` |
| `$gt` / `$gte` | 大于 / ≥ | `{ price: { $gte: NumberDecimal("100") } }` | `>= 100` |
| `$lt` / `$lte` | 小于 / ≤ | `{ stock: { $lt: 50 } }` | `< 50` |
| `$in` | 在集合内 | `{ tags: { $in: ["数码", "图书"] } }` | `IN (...)` |
| `$nin` | 不在集合内 | `{ tags: { $nin: ["图书"] } }` | `NOT IN (...)` |

```javascript
// 库存少于 50 或价格高于 2000 的商品名
db.products.find(
  { $or: [
      { stock: { $lt: 50 } },
      { price: { $gt: NumberDecimal("2000") } }
  ] },
  { name: 1 }
)
```

顺带一个贯穿全篇的原则再次登场：**值的类型必须严丝合缝**。`{ stock: "120" }` 查不到库存为数字 120 的文档——字符串和整数在 BSON 里是两种类型。排查"明明有数据却查不到"的问题时，第一反应就该看类型。

### 2.3 逻辑组合：$and、$or、$not

同一个字段写两个条件时你其实在用逻辑运算：

```javascript
db.products.find({ stock: { $gte: 30, $lte: 120 } })
// 隐式 AND：区间等价于 >= 30 AND <= 120
```

隐式 AND 够用的场景居多，但有两种情况必须显式写 `$and`：同一个键出现多次（如 `{ $and: [{ price: {$gt: 1} }, { price: {$lt: 9} }] }`——其实 JSON 键重复非法，标准写法正是 `$and`），或者条件需要与其他逻辑运算符混排。它们的对照关系：

| 逻辑需求 | 写法 | 注意点 |
| --- | --- | --- |
| 都满足 | 隐式（逗号并列）或 `$and` | 同一字段多条件必须 `$and` |
| 任一满足 | `{ $or: [cond1, cond2] }` | 每个 cond 是独立文档 |
| 取反单个条件 | `{ price: { $not: { $gt: 100 } } }` | `$not` 套在操作符上而非字段上 |
| 全都不满足 | `{ $nor: [cond1, cond2] }` | OR 的否定 |

### 2.4 null、字段存在与类型

这三个判定是关系库玩家最容易翻车的地方：

```javascript
db.products.find({ author: null })
// ⚠️ 匹配两类文档：author 明确为 null 的，以及【根本没有 author 字段】的

db.products.find({ author: { $exists: true } })
// 只要"有这个字段"，无论值是什么

db.products.find({ author: { $exists: true, $ne: null } })
// 业务上想要的"有作者信息"

db.products.find({ stock: { $type: "int" } })
// 按 BSON 类型筛：int / long / decimal / string ...
```

记住这张三者关系就不再迷惑：**`null` 条件的语义 = 缺失 ∪ 为 null**；`$exists` 只管"有没有"；两者叠加才是严格的"有且有值"。

### 2.5 数组与嵌套：文档库的主场

数组在第 01 篇说过是"一等公民"，查询端的能力同样完整：

```javascript
// 包含某元素（整个数组任意位置命中即算）
db.products.find({ tags: "数码" })

// 同时包含一组元素（子集匹配，顺序无关）
db.products.find({ tags: { $all: ["数码", "旗舰"] } })

// 数组长度精确匹配
db.products.find({ tags: { $size: 2 } })

// 元素级的多条件AND：同一元素必须同时满足
db.orders.find({
  items: { $elemMatch: { sku: "PHONE-X", qty: { $gte: 2 } } }
})

// 按下标直达
db.products.find({ "sizes.0": "M" })
```

`$elemMatch` 与"拆开的两个条件"有本质区别：后者允许"某元素满足 A、另一个元素满足 B"也算命中。筛选订单明细这类场景里，它是正确性的关键。

![图2：find 查询条件的操作符地图](query-operator-map.svg)

## 三、排序、分页与计数

三个链式方法组成最常见的结果加工管线，而且**书写顺序无关**——`.find().limit().sort()` 和 `.find().sort().limit()` 语义相同，执行顺序固定为 sort → skip → limit：

```javascript
// 第二页，每页 20 条，价格从高到低
db.products.find()
  .sort({ price: -1 })
  .skip(20)
  .limit(20)

db.products.countDocuments({ tags: "数码" })       // 精确计数
db.products.estimatedDocumentCount()               // 读元数据的估算值，几乎免费
db.products.distinct("tags")                       // 标签去重列表
```

两个预警提前打好招呼：

1. **`skip` 深分页是性能黑洞**——`skip(100000)` 意味着真的遍历并丢弃十万条。大数据量分页的标准解法（范围游标）留到第 05、07 篇结合聚合与索引细讲；
2. `sort` 的内存上限约 32 MB 且不自动落盘，对无索引大字段乱排海量数据会直接报错——又是索引篇的伏笔。

## 四、改：替换与更新的生死线

### 4.1 先看最大的那个坑

update 方法的第二个参数如果**不含任何 `$` 操作符，就不是局部更新，而是整文档替换**：

```javascript
// 危险示范：意图是"把键盘改成 199 元"
db.products.updateOne(
  { name: "键盘 K870" },
  { price: NumberDecimal("199.00"), stock: 10 }     // ← 没有 $set！
)
// 结果：这份文档只剩 name/price/stock，颜色、轴体等字段全部蒸发
```

被覆盖的文档不会报错、不会有警告，一切悄无声息。规避方式只有纪律：**任何一次 update 都要默念"我的更新参数里有 `$` 吗？"**

![图3：整文档替换与操作符更新的差异](replace-vs-operator-update.svg)

### 4.2 更新操作符全家福

真正局部更新的记号库不长，按用途分组记忆：

| 分组 | 操作符 | 一句话 |
| --- | --- | --- |
| 字段赋值 | `$set` / `$unset` | 设置 / 移除字段 |
| 数值运算 | `$inc` / `$mul` | 原子加减 / 乘，负数即减 |
| 重命名 | `$rename` | 字段改名 |
| 数组追加 | `$push` / `$addToSet` | 尾部插入 / 去重插入 |
| 数组移除 | `$pull` / `$pop` | 按条件删 / 删首或尾 |
| 配合 `$push` | `$each` / `$slice` / `$sort` | 批量、截断、排序后再入组 |

```javascript
// 下单扣减库存：原子自减（配合后续事务章节会更严谨）
db.products.updateOne(
  { name: "手机 X", stock: { $gte: 1 } },   // 条件带上库存校验，防超卖
  { $inc: { stock: -1 } }
)

// 给商品追加标签，重复标签不会被塞两次
db.products.updateOne(
  { name: "显示器 U27" },
  { $addToSet: { tags: "电竞" } }
)

// 一次性批量进入购物车明细，超过 50 条丢掉最早的
db.carts.updateOne(
  { userId: 1001 },
  {
    $push: {
      items: { $each: [{ sku: "U27", at: new Date() }],
               $slice: -50, $sort: { at: 1 } }
    }
  }
)
```

这几个例子共同揭示了一个设计取向：**并发安全往往就藏在操作符原子里**。`$inc` 由数据库保证读改写一体，不需要应用层"查出再算再存回"；而那种三步写法放在并发下就是经典的库存超卖来源。

### 4.3 upsert：查不到就新建

第四个参数（或选项对象）里的 `upsert: true` 让 update 变成"存在则更新，不存在则按条件+更新指令合成新文档"：

```javascript
db.views.updateOne(
  { articleId: 42 },                // 过滤条件会并入新文档
  { $set: { pv: 1 } },
  { upsert: true }
)
// 第一次执行：创建 { _id, articleId: 42, pv: 1 }
// 第二次执行：matchedCount 0→1 的切换，pv 自增路径改用 $inc 即为计数器套路
```

浏览量计数、用户偏好项这类"首次访问才建档"的数据天然适合它。

## 五、删与批量写

删除的操作面很窄，重点全是纪律：

```javascript
db.products.deleteOne({ name: "试错商品" })
db.products.deleteMany({ stock: 0 })      // 小心：清库式条件的典型就是它
```

先 `find` 同样的条件、肉眼确认数量，再把 find 换成 deleteMany——这三秒钟的复制粘贴能救回很多个周末。另外 `deleteMany({})` 只清空文档，集合本身还在；彻底移除结构要用 `drop()`，别混用。

真正的生产写入常常是一批混合操作，交给 `bulkWrite`：

```javascript
db.products.bulkWrite([
  { insertOne: { document: { name: "测试盘", price: NumberDecimal("59.00") } } },
  { updateOne: {
      filter: { name: "纯棉 T 恤" },
      update: { $set: { onSale: true } }
  } },
  { deleteOne: { filter: { name: "下架品" } } }
], { ordered: false })
```

`ordered: true`（默认）遇到中间某条失败即停止，前面的照常生效；`ordered: false` 则并发打满、跳过失败继续，吞吐更高但语义不同。数据迁移、初始化脚本爱用后者，强依赖先后关系的编排只能选前者。

## 六、常见坑清单

1. **更新忘写 `$` 操作符**：静默整文档替换，本章第一大坑；
2. **`{ field: null }` 的双重语义**：连"字段不存在"一起命中，精确判空要 `$exists` + `$ne: null`;
3. **类型不匹配查不到数据**：`"120"` ≠ `120`，shell 里肉眼难辨，Compass 的类型徽标是好帮手；
4. **把 updateOne 当 updateMany 用**：名字没 Many 就是只改一条，改动"看起来没生效"多半是这个原因；
5. **整数组当条件**：`find({ sizes: ["M", "L"] })` 是顺序敏感的整体相等，找包含请直接给元素或用 `$all`；
6. **`$regex` 前导通配绕过索引**：`{ name: { $regex: /手机$/ } }` 在没有对应索引支撑时会退化成全扫，模糊查询规模化前先想起第 07 篇。

## 七、总结与下一步

- CRUD 四动词的条件与动作都是普通文档；**One 与 Many 命名即边界**，命名之外的区分不存在；
- find 的操作符按"比较 / 逻辑 / 字段判断 / 数组"四象限记忆；`null` 条件 = 缺失 ∪ 为 null，`$exists` 只问有没有；
- 排序分页的链式书写顺序无所谓，执行恒为 sort → skip → limit；skip 深分页是性能伏笔；
- **更新参数没有 `$` 就是整文档替换**——把它变成肌肉记忆再谈别的；`$inc`、`$addToSet` 这类原子操作符同时兼任并发安全的实现手段；
- 删除前三秒 find 核对；批量写按是否容忍部分失败来选 ordered 模式。

**下一篇**：《MongoDB 从零到一（04）：数据建模》——回答这个系列最重要的问题：关联数据到底该嵌入还是引用？带着第 02 篇那四份异构商品文档一起进阶。

> **思考与练习**
>
> 1. 用一条 find 查出"含'数码'或'Java'标签、库存不少于 30"的商品，只返回名称与 tags 字段，并按价格降序。
> 2. 故意演示一次"忘写 $set"的整文档替换（对着自己的测试集合），再用 `$set` 把误删的字段补回来，体会两类代价的差异。
> 3. 给 `views` 集合设计一套 upsert 计数方案：同一篇文章的 PV 计数如何保证并发下不丢数？（提示：不用 find 出来再加一。）