---
title: MongoDB 从零到一（06）：聚合管道（下），$lookup、$facet 与复杂报表
date: 2026-08-27 15:00:00
categories:
  - 教程
tags:
  - MongoDB
  - 聚合管道
  - Java
description: 跨集合聚合全景：$lookup 联表五参数与数组语义、$unwind 拆解、$facet 一趟拿全分页页脚、$cond/$switch 条件加工、$graphLookup 递归组织架构树，以及 $merge 物化报表与六条优化清单。
keywords:
  - MongoDB lookup
  - MongoDB facet 分页
  - graphLookup 递归
  - MongoDB 报表
  - 聚合优化
lang: zh-CN
---

> **适合人群**：读完上篇（05）建立了管道心智，准备处理"跨集合"与"一次请求出多份统计"场景的开发者。
> 本文沿用 `shop` 库：`orders`（05 篇的订单）、`products`（02 篇的商品），另加一个 `employees` 样例集合演示递归查询。

## 一、$lookup：MongoDB 的 JOIN

第 01 篇概念对照表的最后一格现在揭晓——关系库的 JOIN 在管道里长这样：

```javascript
db.orders.aggregate([
  {
    $lookup: {
      from:         "products",   // 被联的集合
      localField:   "productId",  // 本集合的键
      foreignField: "_id",        // 对方集合的键
      as:           "product"     // 结果写进这个新字段
    }
  },
  { $limit: 2 }
])
```

理解 `$lookup` 最重要的一点是 **`as` 字段永远是数组**——哪怕业务上一个订单只对应一个商品。结果形如 `"product": [ { … } ]`，想拿到"平铺的单个对象"，跟上一步 `$unwind`：

```javascript
{ $unwind: "$product" },      // 数组有且仅有一个元素时安全；空/多值另有讲究
{ $project: { "product.name": 1, amount: 1, paidAt: 1, _id: 0 } }
```

![图1：$lookup 的关联方向与数组结果语义](lookup-pipeline-anatomy.svg)

### 1.1 多级联表

真实报表经常穿两层以上：明细 → 商品 → 品类。做法就是把 `$lookup` 链起来，每一级的输出继续当输入：

```javascript
db.order_items.aggregate([
  { $lookup: { from: "products",  localField: "sku",
               foreignField: "name", as: "product" } },
  { $unwind: "$product" },
  { $lookup: { from: "categories", localField: "product.categoryId",
               foreignField: "_id", as: "category" } },
  { $unwind: "$category" },
  { $group: { _id: "$category.name", gmv: { $sum: "$amount" } } }
])
```

链条越长越要警惕两件事：**两侧关联字段都必须有索引**（否则每次 lookup 都是对方的集扫），以及——回到第 04 篇的立场——如果某条链路天天在跑，真正该做的是建模改造或冗余扩展引用，而不是把三层 JOIN 当日常。

## 二、$unwind：拆解是门手艺

`$unwind` 把数组字段拆成"每个元素一份文档"。它不只是 `$lookup` 的跟班，本身就能解题（还记得 05 篇练习里那句预告吗）：

```javascript
// 统计每个标签下的商品数与均价 —— tags 数组先摊开再分组
db.products.aggregate([
  { $unwind: "$tags" },
  { $group: { _id: "$tags",
              cnt:  { $count: {} },
              avgP: { $avg: { $toDouble: "$price" } } } },
  { $sort: { cnt: -1 } }
])
```

参数 `{ preserveNullAndEmptyArrays: true }` 让没有该数组字段的文档也保留输出（其余字段照常、数组位置为空），避免安静地丢数据。不带它时，**缺失或空数组直接消失**——对账时数字突然变少，八成栽在这里。

## 三、$facet：一趟往返，页脚配齐

管理后台列表页的经典需求：一屏之内同时要三样东西——**当前页数据、符合条件的总数、按状态/分类的分布统计**。朴素的写法是发三次请求。

```javascript
db.products.aggregate([
  { $match: { /* 本页共享的前置筛选，如 price 区间 */ } },
  { $facet: {
      pageItems: [
        { $sort: { createdAt: -1 } },
        { $skip: 20 }, { $limit: 10 }
      ],
      totalCount: [ { $count: "total" } ],
      byTag: [ { $unwind: "$tags" },
               { $sortByCount: "$tags" },
               { $limit: 5 } ]
  } }
])
```

![图2：$facet 共享上游，三条支流并行加工](facet-branches.svg)

三条支流（`pageItems / totalCount / byTag`）各自是一小段独立管道，共享同一个上游 `$match`——数据库只扫一遍，响应合并在一个文档里返回。这让前端请求从 3 次降到 1 次，也让"列表 + 页脚永远出自同一时刻的快照"这一强诉求有了优雅答案。

## 四、条件加工：$addFields、$cond 与 $switch

报表列很少是原始数据的直接搬运，中途往往要派生：

```javascript
db.orders.aggregate([
  { $addFields: {
      level: {                                  // 金额档位标签
        $switch: {
          branches: [
            { case: { $gte: [{ $toDouble: "$amount" }, 4000] }, then: "A" },
            { case: { $gte: [{ $toDouble: "$amount" }, 1000] }, then: "B" }
          ],
          default: "C"
        }
      },
      isDigital: { $in: ["数码", { $ifNull: ["$tags", []] }] }
  } }
])
```

`$addFields`（别名 `$set`）在不声明的字段原样通过——比 `$project` 温和，适合"补几列"；`$ifNull` 提供默认值防空；`$filter/$map` 还能在数组内部逐元素加工。原则与上篇一致：表达式复杂度超过阅读预算就回应用层做。

## 五、$graphLookup：递归关系一锅端

组织架构、物料清单、评论楼中楼——这类自引用的层级关系用 SQL 的 CTE 才能表达，MongoDB 里对应 `$graphLookup`：

```javascript
// employees: { name, reportsTo }  reportsTo 指向上级的 name
db.employees.aggregate([
  { $match: { name: "小花" } },
  { $graphLookup: {
      from:            "employees",
      startWith:       "$reportsTo",       // 从谁的上级开始
      connectFromField:"reportsTo",        // 上溯途中持续展开的字段
      connectToField:  "name",             // 与对方哪个字段对接
      as:              "managers",
      maxDepth:        10,                 // 兜底防爆
      depthField:      "level"
  } },
  { $project: { name: 1,
                chain: { $map: { input: "$managers",
                                 in: { n: "$$this.name", lv: "$$this.level" } } } }
  }
])
```

输出是小花的直属上级、上级的上级……直到顶（`maxDepth` 是重要的保险丝，环引用的数据会让无限制的遍历吃光内存）。

![图3：$graphLookup 自底向上展开汇报线](graphlookup-recursion.svg)

## 六、物化与优化：让报表可落地

### 6.1 $out 与 $merge

跑得慢的大报表不该每次在线重算，把管道终点换成落地指令即可写进目标集合：

- `$out: "report_monthly"` —— 目标集合被**整体替换**；
- `{ $merge: { into: "report_daily", on: "_id", whenMatched: "replace", whenNotMatched: "insert" } }` —— **按 _id 增量 upsert**。

定时任务每天凌晨跑增量管道写入 `$merge`、页面直接查落地的报告集合，是轻量 BI 场景的标准姿势。注意物化的是"过去某个瞬间的数字"，实时性靠调度频率换。

### 6.2 六条优化清单

1. `$match`/`$sort` 尽量前置并配套索引——管道前段能有效利用索引，进不了前段等于没用；
2. `$project` 早裁剪：下一站少背一堆无用字段；
3. 能不 `$unwind` 大数组就不拆，尤其拆完又 `$match` 极少数的场景（改用 `$elemMatch` 前置过滤）;
4. `$lookup` 双方关联字段必须有索引，用 explain 验证；
5. `$facet` 各分支自然共享上游开销，但分支内的 `$sort/$limit` 依然各自计入内存账；
6. 大基数 `$graphLookup` 必设 `maxDepth`，宁缺毋爆。

## 七、常见坑清单

1. **忘了 `as` 是数组**：拿它当对象使，前端渲染奇怪形状；一对一场景记得 `$unwind` 或取下标；
2. **关联字段类型不一致**：一边 `ObjectId` 一边字符串，lookup 结果静默为空数组——和第 04 篇的引用纪律首尾呼应；
3. **`$unwind` 后数据"变少"**：空数组/缺字段被丢弃，需开 `preserveNullAndEmptyArrays` 时别犹豫；
4. **分页用 skip 硬翻深度历史**：折返第 03 篇的深分页话题，大数据量请改范围游标（记录上一页末尾的排序键）；
5. **把 `$merge` 当实时同步**：落地集合只是快照，读它的接口必须接受"落后一个调度周期"；
6. **过滤器放分支内以为省事**：所有分支都要的条件务必提到 `$facet` 上游，提在下游 = 每个分支重复执行。

## 八、总结与下一步

- `$lookup` 就是带索引要求的 JOIN，输出恒为数组、必要时 `$unwind` 摊平；多层联表可行但优先怀疑建模；
- `$facet` 用一趟扫描同时喂饱列表、总数与分布——后台页面的标准配置；
- `$addFields/$switch/$ifNull` 组合承担行内派生逻辑，复杂度红线依旧在人脑；
- `$graphLookup` 处理自引用层级，`maxDepth` 不是选项是必需品；
- 报表产物用 `$out/$merge` 物化落地，实时性由调度频率明码标价。

**下一篇**：《MongoDB 从零到一（07）：索引详解》——前面埋了几十篇的伏笔一次性结清：ESR 怎么排、explain 怎么读、覆盖查询怎么白嫖性能。

> **思考与练习**
>
> 1. 把 06 的三层联表演一遍：给 `order_items` 补 5 条测试数据后逐段执行，确认每个阶段输出的形状。
> 2. 为商品列表页写一条 `$facet` 管道：第一页 10 条 + 总数 + 价格区间分布（提示：区间可用 `$switch` 先打标签）。
> 3. 给 employees 插入一条"A 是 B 上级、B 又是 A 上级"的脏数据，观察无 maxDepth 时会发生什么。
