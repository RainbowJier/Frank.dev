---
title: Redis 从零到一（05）：分布式锁从 SETNX 到 Redisson
date: 2026-08-17 20:50:00
categories:
  - 教程
tags:
  - Redis
  - 分布式锁
  - Redisson
description: 用大白话讲清楚分布式锁的三次进化：SETNX 加 EXPIRE 的原子性问题、误删别人锁的坑、Redisson 看门狗自动续期，附 Spring Boot 实战代码。
keywords:
  - 分布式锁
  - SETNX
  - Redisson
  - 看门狗
lang: zh-CN
---

> **适合人群**：知道 `synchronized`，但一上集群就发现锁不住的同学。
> 本篇的路线图：**SETNX 两条命令 → 一条原子命令 → 唯一标识 + Lua → Redisson 看门狗**，每一步都在修上一步的坑。

## 一、为什么单机的锁失效了

经典场景：库存扣减。

```java
synchronized void deduct() {          // 单机没问题
    int stock = getStock();
    if (stock > 0) setStock(stock - 1);
}
```

服务一上集群（2 个实例做负载均衡），`synchronized` 只锁**自己进程内的线程**——实例 A 和实例 B 各锁各的，两边同时读到 `stock=1`，超卖。

锁需要放在一个**所有实例都看得见的地方**。Redis 天然合适：`SETNX`（SET if Not eXists）只有一个进程能成功。

![图1：分布式锁的四次进化](redis-lock-evolution.svg)

## 二、第一次进化：两条命令的坑

最直觉的写法：

```java
jedis.setnx("lock:stock", "1");   // 抢锁
jedis.expire("lock:stock", 30);   // 设置过期，防止持有者宕机后锁永远不释放
```

致命问题在两步之间：**SETNX 成功后进程崩了，EXPIRE 没执行**——锁成了永动机，后面所有人都进不来。

哪怕包上 try/finally 也防不住 kill -9 和断电。结论：**加锁和设置过期必须是一条原子命令**（Redis 单线程执行命令，单条命令不会被打断）。

```java
// 从 Redis 2.6.12 起，SET 支持 NX + EX 原子组合
String result = jedis.set("lock:stock", "1", "NX", "EX", 30);
if ("OK".equals(result)) { /* 抢锁成功 */ }
```

## 三、第二次进化：别删错别人的锁

新问题：业务比想象中慢。

1. 线程 A 抢到锁，TTL 30 秒
2. A 的业务卡了 40 秒（Full GC、慢 SQL），第 30 秒锁自动过期
3. 线程 B 抢到同一把锁，开始干活
4. 第 40 秒 A 缓过神来，执行 `DEL lock:stock`——**删掉的是 B 的锁**
5. 线程 C 又进来了……锁形同虚设

解法：**锁的 value 存持有者唯一标识（UUID），删锁前先比对是不是自己的**。而"比对 + 删除"是两步，又要原子——请出 **Lua 脚本**：

```lua
-- unlock.lua：值匹配才删除
if redis.call("GET", KEYS[1]) == ARGV[1] then
    return redis.call("DEL", KEYS[1])
else
    return 0
end
```

```java
String token = UUID.randomUUID().toString();     // 每次加锁的唯一标识
jedis.set("lock:stock", token, "NX", "EX", 30);
// ... 业务 ...
Object r = jedis.eval(unlockLua,
        List.of("lock:stock"), List.of(token));  // 原子地"验证 + 删除"
```

到这里，一把"能用的"分布式锁有了。但它还有个尴尬：TTL 设多短都不对——设短了业务没跑完锁先没了，设长了持有者崩了别人干等。这个矛盾的正确解法是**别让锁"死等过期"，让它自动续期**。

## 四、第三次进化：Redisson 看门狗

[Redisson](https://redisson.org/) 是 Redis 的 Java 客户端里把分布式锁做成"开箱即用"的那个，它的核心机制叫**看门狗（Watchdog）**：

1. `lock()` 不传超时时间时，默认加锁 TTL = 30 秒（`lockWatchdogTimeout`）
2. 加锁成功的**同时**，起一个后台定时任务，每 **1/3 TTL（10 秒）**检查一次：**业务线程还持有这把锁吗？**
3. 还持有 → 自动把 TTL **续回 30 秒**；线程挂了或已 `unlock()` → 停止续期，锁到期自然释放

效果：**业务跑多久，锁就活多久；进程一崩，看门狗跟着死，锁最多 30 秒后自动放**——两头都安全。

![图2：Redisson 看门狗的加锁与续期流程](redisson-watchdog-flow.svg)

它的加锁/解锁内部就是上面手写的工业化版本：Lua 脚本 + Hash 结构（field 存 client_id，value 存重入次数），所以还免费获得**可重入**能力。

### Spring Boot 实战

```xml
<dependency>
    <groupId>org.redisson</groupId>
    <artifactId>redisson-spring-boot-starter</artifactId>
    <version>3.27.2</version>
</dependency>
```

```yaml
spring:
  redis:
    host: 127.0.0.1
    port: 6379
    password: Test_123!
```

```java
@Service
@RequiredArgsConstructor
public class StockService {
    private final RedissonClient redisson;

    public void deduct(Long skuId) {
        RLock lock = redisson.getLock("lock:stock:" + skuId);
        try {
            // 不传 leaseTime → 触发看门狗自动续期
            if (lock.tryLock(3, TimeUnit.SECONDS)) {   // 最多等 3 秒
                try {
                    doDeduct(skuId);                   // 真正的业务
                } finally {
                    lock.unlock();                     // 必须在 try 内解锁
                }
            } else {
                throw new BizException("操作太频繁，请稍后再试");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
```

三个使用要点：

- `tryLock()` **不传 leaseTime** 才有看门狗；显式传了 leaseTime，Redisson 认为你自己负责时长，到期就过期
- `unlock()` 必须放在 `if (tryLock)` 的 try-finally 里，没抢到锁就去 unlock 会抛 `IllegalMonitorStateException`
- 锁的粒度尽量细：`lock:stock:{skuId}` 而不是 `lock:stock`，不同商品不互相阻塞

## 五、主从切换会丢锁吗？RedLock 的争议

以上所有方案都是"单主 Redis"上的锁。如果上了主从：

1. 线程 A 在 master 上加锁成功
2. 还没来得及把锁同步给 replica，master 宕机
3. replica 升级为新 master——**锁没了**
4. 线程 B 在新 master 上加锁成功 → 两个线程同时持锁

**RedLock** 的思路是部署 N 个（通常 5 个）**完全独立**的 Redis master，加锁要"过半数节点成功且总耗时小于锁有效期"才算成功。但这个算法有著名的争议（Martin Kleppmann 与 Redis 作者 antirez 的论战）：它依赖各节点时钟大致同步，且在进程暂停（GC 停顿）场景下仍可能两个客户端同时认为自己持锁。

工程上的共识：**绝大多数业务用"单主 Redis + Redisson"就够了**——偶发双持锁的概率极低，且通常业务侧还有 DB 层的最终防线（唯一约束、乐观锁、`WHERE stock > 0`）。正确性要求真到了"锁绝对不能失效"（转账扣款），应该考虑 ZooKeeper/etcd 这类 CP 系统，或者直接用数据库层约束兜底。

## 六、生产建议清单

- 加锁：`SET key uuid NX EX` 或直接 `RLock`，绝不拆成两条命令
- 删锁：Lua 比对 value，绝不裸 `DEL`
- 时长：用看门狗自动续期，别拍脑袋设大 TTL
- 粒度：锁业务资源 ID，不锁整个方法
- 兜底：锁只是并发控制的第一道门，DB 约束才是最后防线
- 监控：关注 `unlock` 失败率和锁等待超时率，异常上涨说明业务变慢或锁竞争恶化

## 总结

- 分布式锁的存在感 = 所有实例都能看见同一把锁
- 三次进化每个都是修上一步的坑：原子加锁（防宕机死锁）→ 唯一 value + Lua（防误删）→ 看门狗（防业务超时锁先没）
- Redisson 是工业级答案：可重入、自动续期、开箱即用
- RedLock 知道即可；正确性要求极致的场景别指望 Redis 锁，上 CP 存储

最后一篇，把视角拉到架构层：单机 Redis 的可用性和容量都有天花板——主从复制、哨兵、Cluster 分别怎么解题。
