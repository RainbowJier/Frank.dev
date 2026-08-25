---
title: RuoYi 框架从零到一 11 - 缓存与性能优化
date: 2026-08-25 11:00:00
categories:
  - 教程
tags:
  - RuoYi
  - Redis
  - 缓存
  - 性能优化
description: 从 RuoYi 的 Token、字典和参数缓存出发，讲清 Redis 封装、缓存穿透、击穿、雪崩、一致性、热点 Key 以及从 SQL 到 JVM 的性能诊断方法。
lang: zh-CN
---

> **适合人群**：已经使用过 RuoYi Redis 功能，希望正确设计缓存并建立性能排查方法的同学。
> 本文是《RuoYi 框架从零到一》系列第 11 篇。缓存示例以 RuoYi 常见的 Redis 封装为基础，业务缓存策略需要结合实际数据一致性要求设计。
>
> 建议先读 {% post_link articles/RuoYi/10-ruoyi-api-validation '10 - 接口文档与参数校验' %}。

## 一、Redis 在 RuoYi 中承担什么角色

RuoYi 的 Redis 并不是“把所有查询都缓存起来”，而是承担几类清晰的职责：

1. **登录态**：保存 `LoginUser`，配合 Token 完成认证和续期；
2. **系统字典**：字典数据变更频率低、读取频率高；
3. **系统参数**：配置项集中管理，避免每次都查数据库；
4. **业务缓存**：按需缓存热点对象、统计结果或权限计算结果。

![图1：RuoYi Redis 缓存分层](ruoyi-redis-cache-layers.svg)

缓存的核心原则是：**Redis 加速读取，数据库保存事实**。只要业务还需要持久化、审计或事务，不能把 Redis 当成唯一数据源。

## 二、RedisCache 封装

### 2.1 为什么要封装 RedisTemplate

直接在业务代码中到处写序列化、过期时间和 Key 拼接，会造成：

- Key 命名不统一；
- 序列化策略不一致；
- 过期时间散落在各处；
- 测试和替换成本高。

RuoYi 通常通过 `RedisCache` 统一封装：

```java
@Component
public class RedisCache {

    @Resource
    private RedisTemplate<Object, Object> redisTemplate;

    public <T> void setCacheObject(final String key, final T value) {
        redisTemplate.opsForValue().set(key, value);
    }

    public <T> void setCacheObject(final String key, final T value,
                                   final long timeout, final TimeUnit timeUnit) {
        redisTemplate.opsForValue().set(key, value, timeout, timeUnit);
    }

    public <T> T getCacheObject(final String key) {
        ValueOperations<Object, T> operation = redisTemplate.opsForValue();
        return operation.get(key);
    }

    public boolean deleteObject(final String key) {
        return Boolean.TRUE.equals(redisTemplate.delete(key));
    }
}
```

### 2.2 Key 命名要有边界

推荐使用“业务域:对象:标识”的结构：

```text
login_tokens:{uuid}
sys_dict:{dictType}
sys_config:{configKey}
product:detail:{productId}
report:daily:{yyyy-MM-dd}
```

不要直接把用户输入拼成 Key；需要清理时也不要在线上对全库执行无边界的 `KEYS *`。大规模实例应使用 `SCAN`，并限定业务前缀。

### 2.3 序列化和过期时间

- Token 对象要能被不同实例稳定反序列化；
- 业务对象变更字段时，要考虑旧缓存反序列化兼容；
- 每个缓存都应有明确 TTL，永久缓存需要配套主动失效机制；
- 不要把完整大对象、文件内容和无界集合直接放进 Redis。

## 三、缓存穿透、击穿与雪崩

![图2：三类缓存故障与防护](cache-penetration-breakdown-avalanche.svg)

### 3.1 缓存穿透

**现象**：请求大量不存在的 ID，缓存没有值，查询每次都落到数据库。

**防护**：

1. 参数格式校验，例如 ID 必须是正数；
2. 对确认不存在的结果缓存短 TTL 空值；
3. 热点 ID 使用布隆过滤器做第一层拦截。

```java
public Product getProduct(Long id) {
    if (id == null || id <= 0) {
        return null;
    }

    String key = "product:detail:" + id;
    Product cached = redisCache.getCacheObject(key);
    if (cached != null) {
        return cached;
    }

    Product product = productMapper.selectById(id);
    if (product == null) {
        // 空值也缓存，但 TTL 要短
        redisCache.setCacheObject(key, NullValue.INSTANCE, 60, TimeUnit.SECONDS);
        return null;
    }

    redisCache.setCacheObject(key, product, 10, TimeUnit.MINUTES);
    return product;
}
```

### 3.2 缓存击穿

**现象**：某个热点 Key 在同一时刻过期，大量请求同时回源数据库。

**防护**：

- 互斥锁：只有一个线程回源，其余线程等待；
- 逻辑过期：缓存数据本身不立即删除，由后台线程异步刷新；
- 热点 Key 预热和主动续期。

```java
public Product getHotProduct(Long id) {
    String key = "product:detail:" + id;
    Product product = redisCache.getCacheObject(key);
    if (product != null) {
        return product;
    }

    String lockKey = "lock:product:" + id;
    boolean locked = tryLock(lockKey, 3, TimeUnit.SECONDS);
    if (locked) {
        try {
            product = productMapper.selectById(id);
            redisCache.setCacheObject(key, product, 10, TimeUnit.MINUTES);
            return product;
        } finally {
            unlock(lockKey);
        }
    }

    // 没抢到锁时短暂等待后重试，生产环境需设置最大次数
    return retryAfterShortWait(id);
}
```

### 3.3 缓存雪崩

**现象**：大量 Key 设置了相同 TTL，在同一时刻集体过期，数据库承受突发流量。

**防护**：

```java
long ttl = 30 + ThreadLocalRandom.current().nextLong(30);
redisCache.setCacheObject(key, value, ttl, TimeUnit.MINUTES);
```

还可以配合限流、服务降级、热点预热和多级缓存。随机 TTL 不是万能方案，必须配合数据库连接池和慢 SQL 监控。

## 四、缓存一致性

### 4.1 Cache-Aside 模式

最常见的流程是：读时先查缓存，未命中查数据库再回填；写时先提交数据库，成功后删除缓存。

![图3：Cache-Aside 一致性时序](cache-consistency-flow.svg)

```java
@Transactional(rollbackFor = Exception.class)
public void updateProduct(Product product) {
    productMapper.update(product);       // 1. 数据库事务
    redisCache.deleteObject(cacheKey(product.getId())); // 2. 提交后失效缓存
}

public Product getProduct(Long id) {
    Product cached = redisCache.getCacheObject(cacheKey(id));
    if (cached != null) {
        return cached;
    }

    Product product = productMapper.selectById(id);
    if (product != null) {
        redisCache.setCacheObject(cacheKey(id), product, 10, TimeUnit.MINUTES);
    }
    return product;
}
```

严格来说，删除缓存应该发生在数据库事务提交成功之后。若要处理更复杂的并发窗口，可以使用事务消息、延迟双删或 CDC，但复杂度也会随之增加。

### 4.2 哪些数据不适合缓存

- 强一致要求极高、变化频繁的数据；
- 每次访问都不同、命中率极低的数据；
- 大对象或敏感数据；
- 没有明确失效策略的数据。

## 五、性能诊断：先取证，再优化

![图4：RuoYi 性能诊断路径](ruoyi-performance-diagnosis.svg)

### 5.1 先看接口指标

至少记录：

- 吞吐量（QPS）；
- P50/P95/P99 延迟；
- 错误率和超时率；
- 依赖调用耗时。

一次接口慢，不代表数据库一定慢。要把总耗时拆成网关、Controller、Service、Redis、数据库和序列化几个阶段。

### 5.2 Redis 排查

```bash
# 只用于开发或低流量维护窗口，线上大实例不要无边界 KEYS
redis-cli --scan --pattern 'product:detail:*' | head

# 查看实例概况
redis-cli INFO memory
redis-cli INFO stats
```

重点观察：

- 命中率是否下降；
- 是否出现大 Key、热 Key；
- 内存碎片和淘汰策略；
- 慢命令和连接数；
- TTL 是否合理。

### 5.3 SQL 与线程池

结合上一篇的 `EXPLAIN`、Druid 慢 SQL 和线程池指标，排查：

- 全表扫描、深分页、N+1；
- 连接池耗尽；
- 线程池队列堆积；
- GC 停顿和堆内存压力。

不要为了一个慢接口盲目“加大线程池”。如果瓶颈在数据库，线程越多只会制造更多排队和连接竞争。

## 六、防重复提交、限流与热点 Key

### 6.1 防重复提交

RuoYi 的 `@RepeatSubmit` 适合挡住短时间连续点击，但支付、订单等场景还要使用业务幂等号和唯一索引。

### 6.2 限流

简单接口可以在网关或 Redis 层做令牌桶/滑动窗口限流；微服务版则可使用 Sentinel 等治理组件。限流响应要让客户端知道何时重试，不能静默丢请求。

### 6.3 热点 Key

热点 Key 需要：

1. 识别：通过命令统计、访问日志或指标发现；
2. 分散：按业务维度拆分或本地缓存只读数据；
3. 续期：避免集中失效；
4. 保护：热点回源加互斥锁。

## 七、优化闭环

一个可复用的性能优化闭环如下：

```text
建立基线 → 定位瓶颈 → 设计最小改动 → 压测验证 → 观察线上指标 → 复盘
```

每次优化都要保留：

- 优化前后的 P95；
- 数据规模和并发量；
- SQL 执行计划；
- Redis 命中率；
- JVM、线程池和连接池指标。

## 八、总结

- Redis 在 RuoYi 中主要服务于 Token、字典、参数和热点业务数据。
- 缓存 Key、序列化、TTL 和失效策略应统一治理。
- 穿透、击穿、雪崩是三类不同问题，需要分别使用空值、互斥锁、随机 TTL、限流等手段。
- Cache-Aside 以数据库为事实来源，写成功后删除缓存，读请求负责回填。
- 性能优化必须从指标和执行计划开始，覆盖 Redis、SQL、线程池和 JVM 全链路。

**下一篇预告**：当单体应用出现独立扩缩容、发布节奏冲突和故障隔离需求时，才值得考虑 RuoYi-Cloud。下一篇从拆分边界、Nacos、Gateway、Sentinel 和 Seata 讲清微服务演进。

> **思考与练习**
>
> 1. 为商品详情实现 Cache-Aside，并设计缓存空值和随机 TTL。
> 2. 使用 Redis 指标找出一个热点 Key，说明它的保护和失效策略。
> 3. 对比开启缓存前后的接口 P95、数据库 QPS 和 Redis 命中率。