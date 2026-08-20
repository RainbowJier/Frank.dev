---
title: Redis 从零到一（01）：内存数据库与核心数据结构
date: 2026-08-17 19:30:00
categories:
  - 教程
tags:
  - Redis
  - 缓存
  - 中间件
description: 用大白话讲清楚 Redis 是什么、为什么单线程还这么快、五大核心数据结构各自适合什么场景，附带真实可跑的命令。
keywords:
  - Redis 入门
  - Redis 数据结构
  - 缓存
lang: zh-CN
---

> **适合人群**：写过 Java Web 项目、用过或听说过 Redis，但一直停留在 SET/GET 的同学。
> 本系列基于 Redis 7.x，所有命令和配置都能直接复制运行。

## 一、Redis 是个啥？和 MySQL 有啥区别？

先看一个每个后端都会遇到的场景：首页的商品分类，一年改不了几次，但每次用户打开首页都要去 MySQL 查一遍：

```sql
SELECT * FROM category;  -- 3ms
```

一次 3ms 不算慢，可如果一秒钟有一万个用户打开首页，就是一万次一模一样的查询。MySQL 被这种"答案明明没变"的查询活活拖垮。

Redis 就是为解决这类问题而生的：**把热数据放进内存**。内存随机读写的延迟是纳秒级，SSD 是几十微秒级，机械盘是毫秒级——差着好几个数量级。

| 对比项 | MySQL | Redis |
|--------|-------|-------|
| 存储介质 | 磁盘为主 | 内存为主 |
| 数据模型 | 表 + 行 + SQL | key-value + 数据结构 |
| 单机性能 | 几千 QPS | 10 万 QPS 很常见 |
| 事务 | 强 ACID | 弱事务，无回滚 |
| 典型用途 | 持久存储、复杂查询 | 缓存、计数、排行、分布式协调 |

一句话总结：**MySQL 管存得久，Redis 管拿得快**。生产环境几乎都是两个一起用：写请求落库，读请求优先打 Redis。

## 二、Redis 为什么这么快？

面试高频题，答案就四条：

1. **纯内存操作**——这是根本，磁盘数据库优化到头也追不上内存
2. **高效的数据结构**——SDS、跳表、listpack，都是为内存和 CPU 缓存精心设计的
3. **单线程执行命令**——没有锁竞争、没有线程上下文切换
4. **IO 多路复用（epoll）**——一个线程同时监听成千上万个连接

最反直觉的是第三条：单线程为什么反而快？注意，**"单线程"指的是命令执行那一段**。网络事件的监听交给了操作系统的 epoll：内核替你盯着所有连接，谁的 数据 就绪了才通知 Redis 处理。线程永远不会阻塞在"干等数据"上，每一滴 CPU 都花在执行命令本身。

![图1：Redis 单线程模型与 IO 多路复用](redis-thread-model.svg)

补充两个容易被追问的点：

- **Redis 6.0 引入了多线程 IO**——但只用于网络数据的读取和回写，命令执行依然是单线程。属于锦上添花，核心思想没变。
- **单线程的代价**：一条慢命令会卡住所有人。百万 key 上跑 `KEYS *`、对百万元素的 Set 做 `SUNION`，整个 Redis 都会卡住。所以 Redis 的第一条军规就是**别用 O(N) 的大命令**。

## 三、安装与第一次连接

### 方式一：Docker（推荐学习用）

```bash
docker run --name redis7-lab -p 6379:6379 -d redis:7.2 \
  redis-server --requirepass Test_123!

# 进入容器里的交互客户端
docker exec -it redis7-lab redis-cli -a Test_123!
```

### 方式二：Linux（Ubuntu）

```bash
sudo apt update
sudo apt install -y redis-server
sudo systemctl enable --now redis-server

redis-cli ping   # 返回 PONG 即成功
```

### 第一次操作

```bash
127.0.0.1:6379> SET user:1:name "frank"
OK
127.0.0.1:6379> GET user:1:name
"frank"
127.0.0.1:6379> TTL user:1:name        # -1 表示永不过期
(integer) -1
127.0.0.1:6379> EXPIRE user:1:name 60  # 60 秒后自动删除
(integer) 1
```

## 四、五大数据结构：选对结构，性能差十倍

Redis 的 value 不只是字符串，而是五种核心数据结构。日常很多性能问题，根源就是**"只会用 String"**——把对象序列化成 JSON 塞进 String，改一个字段也要整体读写。

![图2：五大核心数据结构、底层编码与典型场景](redis-data-structures.svg)

### 1. String：缓存、计数器、分布式锁

底层是 SDS（简单动态字符串），比 C 字符串多了长度字段（取长度 O(1)）、预分配（减少内存拷贝）、二进制安全（可以存图片字节）。

```bash
# 缓存对象（序列化成 JSON）
SET user:1001 '{"name":"frank","city":"杭州"}'

# 计数器：原子自增，天然防并发
INCR article:8001:views          # 阅读量 +1
INCRBY article:8001:views 100

# 简易分布式锁（下一篇细讲）
SET lock:order "uuid-1" NX EX 30
```

**适用**：缓存整对象、计数器（阅读量/点赞数/限流）、分布式锁。

### 2. Hash：购物车、对象的字段级读写

一个 key 管一组 field-value，可以只读只改其中一个字段，不用整体序列化：

```bash
HSET user:1001 name frank city hangzhou age 26
HGET user:1001 name          # 只取一个字段
HINCRBY user:1001 age 1      # 字段级原子自增

# 购物车：field=商品ID，value=数量
HSET cart:1001 sku:2001 2
HINCRBY cart:1001 sku:2001 1
```

**适用**：购物车、需要字段级更新的对象缓存。小 Hash 底层用 listpack 存储，非常省内存。

### 3. List：最新列表、简单队列

双端操作的头尾都是 O(1)，底层是 quicklist（双向链表串起一节节 listpack）：

```bash
# 最新动态：永远取最新的 10 条
LPUSH feed:latest "用户A 发布了文章"
LPUSH feed:latest "用户B 点赞了回答"
LRANGE feed:latest 0 9

# 简单队列：生产者 LPUSH，消费者阻塞式弹出
LPUSH task:queue "send-email:1001"
BRPOP task:queue 0     # 0 = 没有任务就一直等
```

**适用**：最新列表（朋友圈、微博时间线）、简单任务队列。注意它没有 ACK 机制，弹出即删除，可靠性要求高请用 RabbitMQ 或 Stream。

### 4. Set：去重、共同好友、抽奖

无序、自动去重，还支持集合运算：

```bash
SADD user:1001:follow java redis mysql
SADD user:1002:follow redis kafka java

SINTER user:1001:follow user:1002:follow   # 共同关注：java redis
SCARD user:1001:follow                      # 数量
SRANDMEMBER user:1001:follow 3              # 随机抽 3 个（抽奖）
```

**适用**：标签、抽奖、共同好友/共同关注、UV 去重的粗略统计。

### 5. ZSet：排行榜、延迟队列

每个 member 带一个 score，自动按 score 排序，底层是**跳表 + 字典**（跳表负责范围查询 O(logN)，字典负责点查 O(1)）：

```bash
# 游戏积分排行榜
ZINCRBY rank:game 50 "player:1001"
ZINCRBY rank:game 80 "player:1002"
ZREVRANGE rank:game 0 2 WITHSCORES    # 前三名（从高到低）
ZREVRANK rank:game player:1001        # 我的排名

# 延迟队列：score 存"应该执行的时间戳"
ZADD delay:tasks 1732128000 "order:9001:cancel"
# 定时任务每秒扫到期的任务
ZRANGEBYSCORE delay:tasks 0 1732128000 LIMIT 0 10
```

**适用**：各种排行榜、权重队列、延迟任务。**面试必问：为什么用跳表不用红黑树？**——跳表实现简单、范围遍历更自然（底层就是有序链表），且性能同一量级。

## 五、四个加分项：BitMap / HyperLogLog / GEO / Stream

这四个类型出现频率低，但一用就是"妙手"：

| 类型 | 一句话 | 经典场景 | 关键命令 |
|------|--------|----------|----------|
| BitMap | 按位存 0/1，一年签到只占 46 字节 | 签到、日活 | `SETBIT sign:1001:202608 16 1` |
| HyperLogLog | 12KB 估算基数，误差 0.81% | 亿级 UV 统计 | `PFADD uv:20260817 user1 user2` / `PFCOUNT` |
| GEO | 存经纬度、算距离（基于 ZSet） | 附近的人 | `GEOADD pubs 120.15 30.28 "shop:1"` / `GEORADIUS` |
| Stream | 带消费组和 ACK 的消息队列 | 可靠事件流 | `XADD` / `XGROUP` / `XACK` |

```bash
# 签到：8 月第 17 天签到
SETBIT sign:1001:202608 16 1
BITCOUNT sign:1001:202608       # 本月签到天数
```

## 六、KEYS 危险，请用 SCAN

线上大忌：

```bash
KEYS user:*     # O(N) 遍历全库，百万 key 直接卡死 Redis（单线程！）
```

正确姿势是 `SCAN`：**每次只捞一小把，用游标分批走完**，每一步都是 O(1) 级别，不会阻塞：

```bash
SCAN 0 MATCH user:* COUNT 100    # 返回一批 key + 下一个游标
SCAN <下一个游标> MATCH user:* COUNT 100   # 游标回到 0 表示遍历完
```

Java 里对应 `Jedis` 的 `scan(String cursor, ScanParams params)`，或者直接用 Spring Data Redis 的 `scan`。同样的道理，删 key 用 `UNLINK`（异步删除）代替 `DEL`（同步删除）。

## 总结

- Redis 快的四大支柱：内存、数据结构、单线程、IO 多路复用
- 单线程 = 无锁竞争，但也怕慢命令，KEYS 一响，爹妈白养
- 五大结构各有专属场景：String 缓存计数、Hash 字段级读写、List 最新列表、Set 去重交并、ZSet 排行延迟
- 遍历用 SCAN，删除用 UNLINK

下一篇我们聊一个更硬核的话题：数据明明在内存里，断电就没了，Redis 是怎么把它"救"回来的——RDB 与 AOF 持久化。
