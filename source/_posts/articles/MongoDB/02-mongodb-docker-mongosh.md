---
title: MongoDB 从零到一（02）：Docker 部署、mongosh 与 Compass 上手
date: 2026-08-27 11:00:00
categories:
  - 教程
tags:
  - MongoDB
  - Docker
  - 数据库
  - Java
description: 用 Docker Compose 部署 MongoDB 7.x，拆解连接 URI 的结构，通过 mongosh 完成库、集合、文档的第一组操作，并用 Compass 建立可视化的数据直觉。
keywords:
  - MongoDB Docker 安装
  - mongosh 教程
  - MongoDB Compass
  - MongoDB 连接字符串
  - MongoDB 入门
lang: zh-CN
---

> **适合人群**：读过上一篇，机器上装有 Docker（Desktop 或 Linux 引擎），准备把 MongoDB 真正跑起来的开发者。
> 本文基于 **MongoDB 7.0** 镜像与 Docker Compose v2 语法。所有命令在 Windows / macOS / Linux 的终端里均可用；Windows 下推荐 Git Bash 或 PowerShell。

## 一、为什么选择 Docker 而不是安装包

MongoDB 官方当然提供各平台的安装包，但对学习场景来说，Docker 有三个无法拒绝的理由：

1. **版本切换零成本**：`mongo:7.0` 换成 `mongo:8.0` 只是改一个标签；
2. **环境即代码**：一个 `docker-compose.yml` 提交进仓库，同事拉下来就是同一套数据库；
3. **为高可用实验铺路**：第 09 篇的副本集要在单机上跑三个 MongoDB 进程，届时你会感谢今天练熟的 Compose 写法。

生产部署通常不用容器裸跑单实例，而是副本集或云托管服务；学习阶段的目标是**用最低成本获得一个随时可丢弃、随时可重建的实例**。

![图1：Docker 部署拓扑——客户端经端口映射连接容器，数据落在具名卷](mongodb-docker-deployment.svg)

## 二、启动第一个实例

### 2.1 一条 `docker run` 跑通

先看最小可用版本，理解每个参数的职责：

```bash
docker run -d --name mongo-dev \
  -p 27017:27017 \
  -v mongo-data:/data/db \
  -e MONGO_INITDB_ROOT_USERNAME=admin \
  -e MONGO_INITDB_ROOT_PASSWORD=secret123 \
  mongo:7.0
```

| 参数 | 含义 | 不写的后果 |
| --- | --- | --- |
| `-d` | 后台运行 | 终端被日志占满 |
| `--name mongo-dev | 给容器起名，便于后续 `docker exec` | 只能用随机 ID 操作 |
| `-p 27017:27017` | 把容器的 27017 映射到宿主机 | 本机客户端连不上 |
| `-v mongo-data:/data/db` | 数据写入具名卷 `mongo-data` | 删容器 = 数据全没 |
| `-e MONGO_INITDB_ROOT_*` | 注入 root 账号密码 | 任何能连上端口的人都是管理员 |

验证它活着：

```bash
docker ps                                  # STATUS 应为 Up
docker logs mongo-dev --tail 20            # 看到 "Waiting for connections" 即就绪
```

### 2.2 换成 Compose：系列标准姿势

实际开发更推荐把配置固化成文件。新建目录 `mongodb-lab`，写入 `docker-compose.yml`：

```yaml
services:
  mongodb:
    image: mongo:7.0
    container_name: mongo-dev
    ports:
      - "27017:27017"
    volumes:
      - mongo-data:/data/db
    environment:
      MONGO_INITDB_ROOT_USERNAME: admin
      MONGO_INITDB_ROOT_PASSWORD: secret123

volumes:
  mongo-data:
```

```bash
docker compose up -d      # 启动
docker compose down       # 停止并删容器（卷保留）
docker compose down -v    # 连数据卷一起清空，回到白纸
```

> **一个容易翻车的细节**：`MONGO_INITDB_ROOT_*` 只在**数据卷首次初始化**时生效。如果你启动过一次之后再改密码环境变量，不会产生任何效果——要么 `down -v` 清卷重来，要么进 shell 用 `db.changeUserPassword()` 改。

## 三、mongosh：官方 Shell 入门

mongosh（MongoDB Shell）是与 MongoDB 交互的官方 JavaScript 环境，语法就是 JS：方法调用、变量、循环都成立。本系列的演示一律以它为准。

### 3.1 连接与 URI 结构

容器里已经内置了 mongosh，先从里面连：

```bash
docker exec -it mongo-dev mongosh -u admin -p secret123
```

更常用的方式是在宿主机直接连（客户端工具单独安装，见 [mongodb.com/try/download/shell](https://www.mongodb.com/try/download/shell)）：

```bash
mongosh "mongodb://admin:secret123@localhost:27017"
```

这条 URI 值得停下来拆解，后面每一篇都会和它打交道：

```text
mongodb://admin:secret123@localhost:27017/shop?authSource=admin
└──┬───┘ └─┬─┘ └──┬──┘ └───┬────┘ └┬┘ └─────────┬───────┘
 协议     用户   密码    主机     端口   目标库    认证信息所在的库
```

两个初学者必问的问题顺带回答：认证用户建在哪个库里？root 账号属于 `admin` 库，所以 URI 上要带 `authSource=admin`（mongosh 交互登录时默认如此，写程序时容易漏）；URI 结尾不带库名时连上的是默认测试上下文，不影响认证。

### 3.2 库、集合、文档三级实操

进入 shell 之后，上一篇文章的概念表就可以逐行验证了：

```javascript
show dbs              // 列出所有数据库（至少有 admin、config、local）
use shop              // 切换到 shop；不存在也没关系——MongoDB 允许"悬空引用"
db                    // 查看当前所在库 → shop
show collections      // 此时输出为空：shop 还没有任何集合
```

`use shop` 一个实际不存在的库，命令却不报错——因为 MongoDB 里**库和集合都是惰性创建的**：直到第一条数据落进来，它们才真正出现。亲手触发一次：

```javascript
db.products.insertOne({ name: "键盘 K870", price: NumberDecimal("299.00") })
// 返回 { acknowledged: true, insertedId: ObjectId('67c4a1e23f8b9104d701a2f3') }

show dbs        // shop 出现在列表里了
show collections // products 出现了
```

顺便端详一下刚到手的这个 `insertedId`：上一篇说过 ObjectId 由"秒级时间戳 + 进程随机值 + 自增计数器"拼成，现在它是你环境里的实物了——把它交给任何支持解析的工具，都能直接读出创建时间。

![图2：ObjectId 的 12 字节构成](objectid-anatomy.svg)

对比 MySQL 的世界：你得先 `CREATE DATABASE`、再 `CREATE TABLE`、然后才能 `INSERT`；而这里是**插入动作顺带完成了全部结构创建**。库 → 集合 → 文档三级的全景如下：

![图3：库、集合、文档三级结构与惰性创建](namespace-hierarchy.svg)

自由是自由了，误拼写也不会有人拦你——`use shpo` 再插一条数据，你就多了个垃圾库。这正是上一篇说的"动态 Schema 的纪律问题"，第一课就从命名谨慎开始。

### 3.3 用 Compass 看见数据

命令行之外，装一个 [Compass](https://www.mongodb.com/products/tools/compass)（官方免费 GUI）。连接方式与 mongosh 完全相同，把 URI 整串贴进去即可。

Compass 里最有价值的三个区域：

- **左侧数据库树**：直观呈现"库 → 集合"两级结构；
- **Documents 标签页**：像看 JSON 文件一样浏览文档，还能看到每个字段的类型徽标（这比想象中重要——字段错位靠肉眼在这里最容易发现）；
- **Schema / Indexes 标签页**：自动采样画出字段类型分布与已有索引，第 04、07 篇会回头用它做建模和调优的辅助工具。

本文不做 Compass 截图流水账，建议边读边点开自己刚插入的那条文档对照。

### 3.4 准备贯穿全系列的练习数据集

后续篇章的查询都基于一个小小的商品库，现在一次性灌进去（故意让四份文档结构不同，呼应上一篇的主题）：

```javascript
use shop
db.products.insertMany([
  { name: "手机 X", price: NumberDecimal("4999.00"), stock: 120,
    spec: { color: "黑", memoryGB: 12 }, tags: ["数码", "旗舰"] },
  { name: "深入理解 Java 虚拟机", price: NumberDecimal("129.00"), stock: 30,
    author: "周志明", isbn: "978-7-111-64127-2", tags: ["图书", "Java"] },
  { name: "纯棉 T 恤", price: NumberDecimal("79.90"), stock: 500,
    sizes: ["M", "L", "XL"] },
  { name: "显示器 U27", price: NumberDecimal("2499.00"), stock: 45,
    tags: ["数码"], spec: { inch: 27, rateHz: 144 } }
])
// { acknowledged: true, insertedCount: 4 }
```

记住这个 `shop.products` 集合：第 03 篇的操作符、05 和 06 篇的聚合管道、07 篇的索引实验，都以它为样本。

## 四、顺手体验一组最小 CRUD

系统学习增删改查是下一篇的任务，这里只放一张"尝鲜清单"，让你确认环境完全可用——每一条都能直接在 mongosh 里跑：

```javascript
// 查：filter 条件写成嵌套 JSON
db.products.find({ stock: { $gt: 100 } })        // 库存大于 100 的商品

// 改：$set 只动指定字段，其余原样保留
db.products.updateOne(
  { name: "纯棉 T 恤" },
  { $set: { stock: 480 } }
)

// 增：再来一份订单数据（结构又不一样了）
db.orders.insertOne({
  product: "手机 X", qty: 1, paidAt: new Date(), amount: NumberDecimal("4999.00")
})

// 删：按条件删除一条
db.products.deleteOne({ name: "不存在的商品" })   // deletedCount: 0，删除也不报错
```

注意观察返回值：MongoDB 的写操作结果自带 `acknowledged` 与计数信息，这是后续做幂等与对账的基础素材。操作符 `$gt` 这一套记法现在眼熟即可，第 03 篇会把整张操作符地图铺开。

## 五、常见坑清单

1. **没挂数据卷就正式开测**：容器一删数据蒸发。养成先写 `-v` 的肌肉记忆；
2. **改了初始化账号以为生效**：如前所述，root 账号只在卷首次初始化时创建，改动后务必 `docker compose down -v` 重来或走 `changeUserPassword`；
3. **27017 端口被占**：宿主机若装过本地 MongoDB，`-p` 会绑定失败，`docker logs` 里能看到 Address already in use；
4. **URI 忘带 `authSource`**：程序连接时报 "Authentication failed"，八成是拿普通库当认证库去验 root 账号；
5. **shell 手滑拼错库名/集合名**：没有报错、没有拦截，只有静默的新库新集合。定期 `show dbs` 巡检，发现可疑库尽快 `db.dropDatabase()`；
6. **金额写了浮点**：`price: 79.9` 存成 Double 有精度尾巴，永远写 `NumberDecimal("79.90")`。

## 六、总结与下一步

- Docker 是学习 MongoDB 的最低成本路径：一条 `run` 或一小段 Compose 就能拥有可重建的实例；
- `-v mongo-data:/data/db` 保住数据，`MONGO_INITDB_ROOT_*` 只在首次初始化生效——这两点是新手事故 Top 2；
- 连接 URI 的六段结构（协议 / 用户 / 密码 / 主机端口 / 目标库 / `authSource`）值得背下来，之后 Spring Boot 配置还要用；
- 库与集合惰性创建：第一个文档落地时结构才诞生，代价是拼写错误无人拦；
- `shop.products` 四条异构文档已就位，它是整个系列的教学数据集。

**下一篇**：《MongoDB 从零到一（03）：CRUD 全解》——系统展开 find 的操作符体系、更新的六种姿势与 bulkWrite 批量写，把今天"尝鲜清单"里的每条命令讲透。

> **思考与练习**
>
> 1. 故意执行一次 `use typo-db` 并插入一条数据，再用 `show dbs` 找到它并删除，体会"惰性创建"的两面性。
> 2. 把 Compose 里的映射改成 `27018:27017`，分别从 mongosh 与 Compass 用新端口连接成功。
> 3. 不查资料，口述一遍 `mongodb://user:pass@host:27017/mydb?authSource=admin` 中 `mydb` 与 `authSource=admin` 各自的作用——这是新手报 Authentication failed 的头号原因。
