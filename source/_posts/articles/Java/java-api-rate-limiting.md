---
title: 接口限流从 0 到 1：大白话讲透四种算法与 Java 实战
date: 2026-08-17 15:00:00
categories:
  - 教程
tags:
  - Java
  - 接口限流
  - 高并发
description: 用景区检票、投币闸机这些生活中的例子，讲透固定窗口、滑动窗口、漏桶、令牌桶四种限流算法，并给出 Guava RateLimiter、注解 + AOP、Redis + Lua 的可运行代码。
lang: zh-CN
---

> 写给每个担心"流量一上来接口就挂"的 Java 开发者。这篇不堆公式，先用大白话把限流的思想讲明白，再落地到可以直接抄走用的代码。

## 一、为什么你的接口需要限流

### 1.1 从景区限流说起

九寨沟每天只卖四万张票，不是为了难为游客，而是因为景区的承载力是有限的——步道就那么宽，索道运力就那么大。人再多也得控制在承受范围内，否则体验崩坏，甚至出安全事故。

服务器就是景区：

- CPU、内存、线程池、数据库连接池，就是步道和索道；
- 每个接口的承载力都有上限，比如单机实测只能扛 500 QPS；
- 流量一旦超过上限，响应变慢 → 请求堆积 → 彻底崩溃。

**限流（Rate Limiting）就是门口的检票员：单位时间内只放固定数量的请求进来，多出来的礼貌拒绝。**

![图 1：限流的核心思想](/images/svg/rate-limit-core-principle.svg)

### 1.2 不限流会发生什么：雪崩

来看一条真实的事故链路，每一步都在拖垮下一步：

1. 秒杀开始，瞬时 10 万请求涌入；
2. Tomcat 线程池 200 个线程全部打满，后续请求只能排队；
3. 排队的请求占着数据库连接不放，连接池也被耗尽；
4. 接口响应从 50ms 恶化到 30s；
5. 上游调用方等不及，超时重试，流量翻倍——火上浇油；
6. 整个服务雪崩，连带依赖它的服务一起挂。

限流的意义一句话：**牺牲一部分请求，保住整个系统。** 宁可让一部分用户看到"稍后再试"，也不能让所有用户看到 502。

### 1.3 限流、熔断、降级，一句话分清

面试和设计时经常把这三个词混在一起，其实各管一摊：

| 概念 | 类比 | 干什么 |
| --- | --- | --- |
| 限流 | 门口检票 | 人多了不放进来，**保护自己** |
| 熔断 | 保险丝 | 发现下游已经挂了，暂时不调用，**保护自己不被下游拖死** |
| 降级 | 保底方案 | 忙不过来时返回个兜底结果，**牺牲体验保可用** |

三者常常配合使用，本文专注限流。

## 二、动手之前，先想清楚三个问题

### 2.1 在哪里限？

Java 项目的限流通常分三层，各司其职、层层设防：

![图 2：Java 三层限流体系](/images/svg/rate-limit-java-architecture.svg)

| 层级 | 常用工具 | 特点 |
| --- | --- | --- |
| 接入层 | Nginx、网关 | 全局第一道闸门，粗粒度，先挡一层洪峰 |
| 应用层 | Guava RateLimiter、Sentinel | 单机精细控制，能精确到某个方法，无需中间件 |
| 分布式层 | Redis + Lua | 多实例共享同一个阈值，集群统一计数 |

小项目用应用层就够了；集群部署、阈值要全局统一时，就必须上分布式层。后文第四、五、六节分别展开。

### 2.2 限多少？

阈值不是拍脑袋定的：先压测出单机极限（比如 800 QPS），乘以安全系数（比如 70%）得到单机阈值，再结合机器数量得出全局阈值。限流阈值是运维指标，要跟着容量变化调整，不是写完就一劳永逸。

### 2.3 超限的请求怎么办？

三种态度：**直接拒绝**（返回 429）、**排队等待**（削峰填谷）、**降级兜底**（返回缓存或默认值）。第七节展开。

## 三、四种经典限流算法

老规矩，先看全景图，再逐个拆解：

![图 3：四种限流算法对比](/images/svg/rate-limit-four-algorithms.svg)

### 3.1 固定窗口计数：最简单的"按分钟数数"

**规则**：把时间切成固定窗口（比如每 1 分钟一个），窗口内计数，超过阈值就拒绝；窗口一切换，计数归零。就像景区"每小时最多放 5000 人进园，整点重新计数"。

用 Redis 实现只需要两条命令：`INCR` 计数 + `EXPIRE` 设置过期，简单到不行。

**致命缺陷——临界问题**：假设阈值是每分钟 100 次。

- 第 1 分钟的第 59 秒，涌进来 100 个请求——没超，放行；
- 第 2 分钟的第 1 秒，又涌进来 100 个请求——新窗口计数，也没超，放行。

两个窗口各自都合规，但从 59 秒到 61 秒这短短两秒里，实际放过了 **200 个请求**——瞬时压力是阈值的两倍。流量恰恰喜欢卡着边界冲（秒杀整点开抢就是典型），这就是图 3 面板 A 里标红的"边界突刺"。

### 3.2 滑动窗口：把"数数"变准

**思路**：不再以自然分钟为边界，而是"任意时刻，只统计最近 60 秒"。窗口像一条随时间连续右移的传送带，老的请求滚出去，新的滚进来，边界突刺自然消失。

实现上通常把 60 秒切成 6 个 10 秒的小格子，每个格子独立计数，统计时只累加还没过期的格子（Sentinel 内部就是这么做的）。代价是要记住每个小格子的计数，内存和计算都比固定窗口多一点。

### 3.3 漏桶：流出速率绝对恒定

想象一个漏水的桶：请求像水一样以**任意速度**倒进来，桶以**恒定速率**往外漏。无论进得多猛，出去的永远是匀速的——下游得到完美平滑的流量。

- 优点：绝对平滑，下游压力曲线像尺子画的一样直；
- 缺点一：桶容量有限，倒得太猛桶满了就溢出（拒绝）；
- 缺点二：太"死板"——就算系统有富余，也无法利用突发，秒杀开始的瞬间本来允许冲一下，它也给你压平了。

Nginx 的 `limit_req` 指令就是漏桶思想。

### 3.4 令牌桶：最常用的"投币闸机"

地铁站的投币闸机：后台**匀速生成令牌**（硬币）扔进桶里，桶有容量上限，装满就不再投；每个请求必须先从桶里**取走一个令牌**才能通过，取不到就拒绝或排队。

![图 4：令牌桶工作流程](/images/svg/token-bucket-flow.svg)

两个关键参数，务必记牢：

- **速率 r**：每秒生成多少个令牌——决定长期平均速率；
- **容量 b**：桶最多攒多少个令牌——决定允许的突发量。

为什么它最常用？因为它**既保住了漏桶的平滑（平均速率受控），又允许突发**：闲时攒下的令牌，可以在忙时一次性消耗掉。Guava 的 `RateLimiter`、Nginx 的 `burst` 参数、Redisson 的 `RRateLimiter`，背后都是令牌桶。

### 3.5 四种算法对比总结

| 算法 | 平滑性 | 允许突发 | 实现难度 | 典型实现 |
| --- | --- | --- | --- | --- |
| 固定窗口 | 差（边界突刺 2 倍） | 否 | ★ | Redis INCR + EXPIRE |
| 滑动窗口 | 好 | 否 | ★★ | Sentinel、Redis ZSET |
| 漏桶 | 最好（绝对恒定） | 否 | ★★ | Nginx limit_req |
| 令牌桶 | 好（平均恒定） | **是** | ★★ | Guava、Redisson |

拿不准就选令牌桶，它在绝大多数场景都不出错。

## 四、单机实战：Guava RateLimiter + 注解封装

### 4.1 引入依赖

```xml
<dependency>
    <groupId>com.google.guava</groupId>
    <artifactId>guava</artifactId>
    <version>33.0.0-jre</version>
</dependency>
```

### 4.2 最小可用示例

```java
// 每秒生成 10 个令牌的令牌桶
RateLimiter limiter = RateLimiter.create(10);

// 方式一：acquire() —— 拿不到就原地等，适合后台批处理任务
limiter.acquire();

// 方式二：tryAcquire() —— 拿不到立刻返回 false，适合 Web 接口
if (!limiter.tryAcquire()) {
    // 直接拒绝，返回 429
}
```

注意：**Web 接口一定要用 `tryAcquire`**。`acquire` 会让请求线程原地阻塞排队，流量大时 Tomcat 线程池会被排队请求占满，限流反而成了压垮自己的最后一根稻草。

### 4.3 注解 + AOP：一行注解限流任意接口

每个业务方法手写 `tryAcquire` 太啰嗦，仿照 `@Transactional` 的思路封装成注解。

第一步，定义注解：

```java
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {

    /** 每秒生成的令牌数 */
    double qps() default 10;

    /** 等待令牌的超时时间（毫秒），0 表示不等待直接拒绝 */
    long timeout() default 0;
}
```

第二步，编写切面：

```java
@Aspect
@Component
public class RateLimitAspect {

    /** 每个方法一个独立的限流器，方法签名作为 key */
    private final Map<String, RateLimiter> limiterCache = new ConcurrentHashMap<>();

    @Around("@annotation(rateLimit)")
    public Object around(ProceedingJoinPoint pjp, RateLimit rateLimit) throws Throwable {
        String key = pjp.getSignature().toLongString();
        RateLimiter limiter = limiterCache.computeIfAbsent(
                key, k -> RateLimiter.create(rateLimit.qps()));

        if (!limiter.tryAcquire(rateLimit.timeout(), TimeUnit.MILLISECONDS)) {
            throw new BusinessException("访问过于频繁，请稍后再试");
        }
        return pjp.proceed();
    }
}
```

第三步，业务代码里一行搞定：

```java
@RestController
public class HotDataController {

    @RateLimit(qps = 5)   // 该接口每秒最多放行 5 个请求
    @GetMapping("/hot-data")
    public Result hotData() {
        return Result.ok(service.getHotData());
    }
}
```

实际项目里把 `BusinessException` 接到全局异常处理器上，统一转成 HTTP 429 返回即可。

**但要清醒地看到它的局限**：`RateLimiter` 只存在于当前 JVM 里。部署 3 台机器、每台限 100 QPS，集群整体就是 300 QPS——想全局限 100，就得靠下一节。

### 4.4 补充：用 Semaphore 限"并发数"

`RateLimiter` 限的是**速率**（每秒多少个），`Semaphore` 限的是**瞬时并发数**（同一时刻多少个在跑），两者互补：

```java
private final Semaphore semaphore = new Semaphore(20); // 最多 20 个并发

public Result slowQuery() {
    if (!semaphore.tryAcquire()) {
        return Result.busy(); // 并发已满
    }
    try {
        return doQuery();
    } finally {
        semaphore.release(); // 务必释放
    }
}
```

典型场景：某个接口单次要跑 2 秒，QPS 限 100 没意义（瞬时并发可能堆到 200），限并发 20 才保护得住。

## 五、分布式实战：Redis + Lua

### 5.1 为什么单机限流在集群下会失真

目标：全局限流 100 QPS，部署 3 台机器。每台限 100？总体 300，超了。每台限 34？加减机器就失效，某台宕机阈值也对不上。

正确姿势：把计数放到所有实例都看得到的地方——**Redis**。

### 5.2 固定窗口版：INCR + EXPIRE

```java
@Component
public class RedisRateLimiter {

    private final StringRedisTemplate redis;

    public RedisRateLimiter(StringRedisTemplate redis) {
        this.redis = redis;
    }

    public boolean tryAcquire(String key, int limit, int windowSeconds) {
        Long count = redis.opsForValue().increment(key);
        if (count != null && count == 1) {
            redis.expire(key, windowSeconds, TimeUnit.SECONDS);
        }
        return count != null && count <= limit;
    }
}
```

这段代码能用，但埋着两个问题：

1. `increment` 和 `expire` 是两条命令。第一条执行完后实例恰好宕机，这个 key 就永不过期，计数一路涨，所有请求永久被拒；
2. 固定窗口的临界问题（3.1 节）依然存在。

### 5.3 用 Lua 解决原子性

Redis 执行 Lua 脚本是**原子**的：脚本里的多条命令会被当成一个整体执行，中间不会被其他请求插队。

```java
private static final DefaultRedisScript<Long> RATE_LIMIT_SCRIPT = new DefaultRedisScript<>(
        "local c = redis.call('INCR', KEYS[1]) " +
        "if c == 1 then redis.call('EXPIRE', KEYS[1], ARGV[2]) end " +
        "return c",
        Long.class);

public boolean tryAcquire(String key, int limit, int windowSeconds) {
    Long count = redis.execute(RATE_LIMIT_SCRIPT,
            Collections.singletonList(key),
            String.valueOf(limit), String.valueOf(windowSeconds));
    return count != null && count <= limit;
}
```

计数 + 过期一步到位，竞态问题消失。key 的设计决定了限流的维度：

- `rate_limit:order:create:{userId}` —— 按用户限流，防单用户刷接口；
- `rate_limit:ip:{clientIp}` —— 按 IP 限流，防爬虫；
- `rate_limit:api:order-create` —— 按接口全局限流。

### 5.4 更进一步

- **滑动窗口版**：用 ZSET 记录窗口内每个请求的时间戳，每次先 `ZREMRANGEBYSCORE` 清掉过期成员，再 `ZCARD` 计数判断——彻底消除临界问题；
- **令牌桶版**：把"上次取令牌时间、剩余令牌数"存进 Redis，每次请求按流逝的时间补发令牌再判断，Redisson 的 `RRateLimiter` 内部就是这个思路。

生产环境不想手写脚本，直接用 Redisson：

```java
RRateLimiter limiter = redissonClient.getRateLimiter("order:create");
limiter.trySetRate(RateType.OVERALL, 100, 1, RateIntervalUnit.SECONDS);

if (!limiter.tryAcquire()) {
    throw new BusinessException("访问过于频繁，请稍后再试");
}
```

## 六、接入层：Nginx 配置挡住第一波洪峰

应用层限流再好，请求也已经打到了 Tomcat。流量洪峰最好在 Nginx 就挡掉一部分：

```nginx
# http 块：定义限流区——按客户端 IP，速率 10 请求/秒（漏桶）
limit_req_zone $binary_remote_addr zone=api_limit:10m rate=10r/s;

server {
    location /api/ {
        # burst=20：桶容量 20，允许瞬时排队 20 个
        # nodelay：排队的请求不延迟、立即放行
        limit_req zone=api_limit burst=20 nodelay;
        proxy_pass http://backend;
    }
}
```

注意 `burst + nodelay` 这个组合：桶里有余额（burst）时请求直接通过、不等待——这正是把漏桶升级成了**令牌桶**。你看，思想是相通的。

## 七、被限流的请求，何去何从

拒绝不是终点，善后体验才是产品力：

1. **返回 429 而不是 500**，并带上 `Retry-After` 响应头，明确告知客户端多久后再试；
2. **调用方指数退避重试**（1s、2s、4s……），切忌立即重试——那等于自己给自己发起重试风暴；
3. **能降级就降级**：推荐接口限流后返回默认榜单，搜索接口限流后返回热搜词，别让用户看白屏；
4. **限流日志 + 告警**：限流比率突然升高，往往是上游异常、正在被攻击、或即将开始大促的信号。

## 八、选型速查与面试要点

### 8.1 场景速查

| 场景 | 推荐方案 |
| --- | --- |
| 单机小服务 | Guava RateLimiter + 注解 AOP |
| 集群统一阈值 | Redis + Lua（或直接 Redisson） |
| 网关统一防护 | Nginx / Spring Cloud Gateway 限流 |
| 限流 + 熔断 + 降级全家桶 | Sentinel |
| 保护慢接口 | Semaphore 限并发数 |

### 8.2 面试高频四连

1. **四种算法的区别？** 固定窗口简单但有边界突刺；滑动窗口消除突刺；漏桶绝对平滑但不允许突发；令牌桶平滑且允许突发，最常用。
2. **固定窗口的临界问题怎么解决？** 换滑动窗口——任意时刻只统计最近 N 秒。
3. **令牌桶为什么允许突发？** 闲时攒令牌（容量 b），忙时可一次性消耗。
4. **分布式限流为什么用 Lua？** 把"读计数、判断、写回、设过期"合并成原子操作，避免多实例并发下的竞态。

## 总结

- 限流 = 景区检票：**牺牲一部分请求，保住整个系统**；
- 算法拿不准就选**令牌桶**：平均速率受控 + 允许突发，Guava、Redisson 都有现成实现；
- 集群限流把计数放 **Redis**，用 **Lua 保证原子性**；
- 拒绝请求时返回 **429 + Retry-After**，有降级方案就别让用户看报错页。

下一篇打算聊聊熔断与降级的实战（Sentinel 规则配置），和这篇凑成高可用三件套。
