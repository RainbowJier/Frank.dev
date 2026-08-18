---
title: 网关熔断从 0 到 1：大白话讲透三态状态机与 Spring Cloud Gateway 实战
date: 2026-08-18 15:00:00
categories:
  - 教程
tags:
  - Java
  - Spring Cloud Gateway
  - 熔断
  - 微服务
  - 高可用
description: 用家里保险丝的例子讲透熔断器的三态状态机、滑动窗口与慢调用比例，落地 Spring Cloud Gateway + Resilience4j 完整实战（含降级接口、Actuator 验证、TimeLimiter 1 秒大坑），再对比 Sentinel 与 Hystrix 的选型。
lang: zh-CN
---

> 写给每个见过"一个服务挂了、整站跟着 502"的 Java 开发者。上一篇限流讲的是门口检票，这一篇讲熔断——保险丝"啪"地跳闸的那一下。

## 一、为什么网关需要熔断

### 1.1 从家里的保险丝说起

夏天到了，空调、微波炉、热水器同时开，电路负载瞬间超标。这时候保险丝"啪"一声熔断，跳闸断电。

没人会觉得跳闸是家里"坏事了"——恰恰相反，这是保护：宁可暂时没电，也不能让电线持续过热，最后烧起来。

微服务里的熔断器（Circuit Breaker）干的就是这件事：

- 下游服务就是那条电线；
- 下游已经挂了或者慢了，你还疯狂调用，就等于让电流继续往过热的电线上冲；
- 熔断器跳闸：一段时间内**直接不调用了**，请求在网关这一层就被快速拒绝。

**熔断的本质：发现下游已经不行了，就暂时"分手"——给对方恢复的时间，也保住自己的线程资源。**

### 1.2 没有熔断会怎样：一场典型的雪崩

来看一条真实的事故链路：

1. 订单服务的数据库挂了，接口从 50ms 恶化到 30s 才返回超时；
2. 网关每个请求都要占用一个工作线程，**同步干等 30 秒**；
3. 网关线程池就 200 个线程，几秒钟内全部被订单接口占满；
4. 后续请求全部排队，**连商品、用户服务的请求也排不上队**；
5. 用户看到的：整站 502。

注意关键点：**挂掉的只是订单服务，死掉的却是整个网站。** 因为同步调用里，线程是最宝贵的资源，"等待"本身就是占用。而下游故障时，等来的只有超时，纯属白白陪葬。

![图 1：同一场故障的两种结局](/images/svg/gateway-cascade-vs-circuit-breaker.svg)

熔断器把这条链路拦腰斩断：发现订单接口失败率飙升，立刻跳闸，后续对订单服务的调用毫秒级失败、走降级返回兜底数据——网关线程几乎不被占用，商品、用户服务一切照常。**故障被隔离在单个接口内，这就是"故障隔离"。**

### 1.3 限流、熔断、降级，一张表分清

面试和设计时经常把这三个词搅在一起，其实各管一摊：

| 概念 | 类比 | 干什么 |
| --- | --- | --- |
| 限流 | 门口检票 | 人多了不放进来，**保护自己不被流量压垮** |
| 熔断 | 保险丝 | 发现下游已经挂了，暂时不调用，**保护自己不被下游拖死** |
| 降级 | 保底方案 | 忙不过来时返回兜底结果，**牺牲体验保可用** |

三者经常配合出场：熔断是决策（要不要继续调），降级是决策后的动作（不调了返回什么），限流是另一道独立的防线。上一篇讲完了限流，这篇专注网关层的熔断。

## 二、熔断的核心原理：三态状态机

### 2.1 三个状态

不管底层是 Resilience4j、Sentinel 还是 Hystrix，熔断器都绕不开同一个状态机：

![图 2：熔断器三态状态机](/images/svg/gateway-circuit-breaker-state-machine.svg)

| 状态 | 行为 |
| --- | --- |
| **Closed（关闭）** | 正常放行所有请求，同时在后台统计失败率。"保险丝完好"。 |
| **Open（打开）** | 失败率超过阈值，熔断跳闸。请求**根本不会发往下游**，直接快速失败走降级。持续一段冷却时间（比如 10s），给下游喘息。 |
| **Half-Open（半开）** | 冷却期结束，放行**少量探测请求**试试水。全成功 → 关闭熔断器恢复正常；有失败 → 重新打开，继续冷却。 |

两个容易忽略的细节：

- **Open 状态下连尝试都不尝试**，这是它和"每次都调用然后降级"的本质区别——后者线程照样被超时占用，等于没保护；
- **Half-Open 的探测流量必须小**，否则下游刚缓过一口气，又被探测流量打死，永远恢复不了。

### 2.2 失败率是怎么算出来的：滑动窗口

"失败率超过阈值就跳闸"听起来简单，但窗口里只有 2 个请求、挂了 1 个，失败率 50%，也要跳闸吗？当然不行，样本太少没有统计意义。

所以真实的判断逻辑是：**滑动窗口 + 最小样本数 + 失败率阈值**三者配合。举例：

```
slidingWindowSize: 10          # 窗口大小：统计最近 10 次调用
minimumNumberOfCalls: 5        # 最少样本：窗口内满 5 次才开始计算
failureRateThreshold: 50       # 失败率阈值：≥ 50% 触发熔断
```

- 前 4 次调用：只记录，不计算（样本不足）；
- 第 5 次起：每来一次新调用，计算最近 10 次里的失败占比；
- 一旦最近 10 次里挂了 5 次（失败率 50%），熔断器打开。

窗口有两种口径：**COUNT_BASED** 按调用次数（最近 N 次），**TIME_BASED** 按时间片（最近 N 秒）。流量小的服务建议用次数口径 + 配合较小的最小样本数，否则一天攒不够样本，熔断器形同虚设。

### 2.3 慢调用比例：比"失败"更早的信号

很多服务在彻底挂掉之前，会先经历一个"变慢"的阶段：数据库连接池快满了、GC 频繁了、下游依赖慢了——此时请求还没失败，但响应从 200ms 涨到 3s，体验上已经不可用。

所以熔断器还有第二种触发方式：**慢调用比例**。

```
slowCallDurationThreshold: 2s    # 单次调用超过 2s 算"慢调用"
slowCallRateThreshold: 80        # 慢调用占比 ≥ 80% 触发熔断
```

失败率和慢调用比例是"或"的关系，任一个超标都会跳闸。慢调用比例往往触发得更早，是下游恶化的第一声警报。

## 三、实战一：Gateway + Resilience4j（官方主流）

Spring Cloud Gateway 内置了 `CircuitBreaker` 过滤器工厂，底层通过 Spring Cloud CircuitBreaker 抽象接入 Resilience4j——这是目前原生 Spring Cloud 体系的标准答案。

### 3.1 加依赖

```xml
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-gateway</artifactId>
</dependency>
<!-- 注意是 reactor 版本：网关基于 WebFlux，不是 servlet -->
<dependency>
    <groupId>org.springframework.cloud</groupId>
    <artifactId>spring-cloud-starter-circuitbreaker-reactor-resilience4j</artifactId>
</dependency>
```

### 3.2 给一条路由接上保险丝

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: order-route
          uri: lb://order-service
          predicates:
            - Path=/api/order/**
          filters:
            - name: CircuitBreaker
              args:
                name: orderCircuitBreaker   # 熔断器实例名，下一节配置它
                fallbackUri: forward:/fallback/order
```

这行配置的含义：所有 `/api/order/**` 的请求，先过 `orderCircuitBreaker` 这只保险丝；熔断器打开时，请求不再发往订单服务，而是在网关内部**转发（forward）到降级接口** `/fallback/order`。

![图 3：网关熔断请求流转](/images/svg/gateway-resilience4j-request-flow.svg)

### 3.3 调保险丝的参数

过滤器只是"接线"，保险丝的灵敏度在 Resilience4j 这边调：

```yaml
resilience4j:
  circuitbreaker:
    instances:
      orderCircuitBreaker:
        slidingWindowType: COUNT_BASED             # 按次数统计
        slidingWindowSize: 10                      # 统计最近 10 次调用
        minimumNumberOfCalls: 5                    # 满 5 次才开始算失败率
        failureRateThreshold: 50                   # 失败率 ≥ 50% 跳闸
        slowCallDurationThreshold: 2s              # 超过 2s 算慢调用
        slowCallRateThreshold: 80                  # 慢调用占比 ≥ 80% 跳闸
        waitDurationInOpenState: 10s               # 打开后冷却 10s
        permittedNumberOfCallsInHalfOpenState: 3   # 半开状态放 3 个探测请求
  timelimiter:
    configs:
      default:
        timeoutDuration: 5s    # 不调这个必踩坑，见 3.6
```

参数看着多，记住三个就够：**窗口多大**（slidingWindowSize）、**多敏感**（两个阈值）、**跳闸多久**（waitDurationInOpenState）。阈值设太敏感（比如窗口 5 次、阈值 10%），服务抖两下就熔断，属于自己吓自己；设太迟钝，熔断永远轮不上，等于没装。

### 3.4 写降级接口

降级接口就写在网关工程里，一个普通的 Controller：

```java
@RestController
public class FallbackController {

    @GetMapping("/fallback/order")
    public Map<String, Object> orderFallback() {
        return Map.of(
            "code", 503,
            "message", "订单服务开小差了，请稍后再试",
            "data", Collections.emptyList()
        );
    }
}
```

降级返回什么，是设计问题而不是技术问题，常见三种姿势：

| 姿势 | 适用场景 | 例子 |
| --- | --- | --- |
| **缓存快照** | 数据不要求实时 | 商品列表返回 5 分钟前的 Redis 快照 |
| **默认值** | 有合理兜底逻辑 | 库存查询返回"库存紧张，请咨询客服" |
| **友好提示** | 没法兜底的操作 | 下单失败提示"稍后重试"，而不是 502 白屏 |

原则只有一条：**降级响应必须快、必须轻**。如果降级逻辑本身还要去查数据库，那熔断就白做了。

### 3.5 怎么确认熔断真的发生了

别靠猜，让网关自己报告。开启 Actuator 端点：

```yaml
management:
  endpoints:
    web:
      exposure:
        include: circuitbreakers
```

然后请求：

```bash
curl http://gateway:8080/actuator/circuitbreakers
```

返回里能看到每个熔断器的名字和当前状态（CLOSED / OPEN / HALF_OPEN / DISABLED）。配合日志里的 `CallNotPermittedException`（Open 状态下请求被拒绝时抛出），就能确凿地判断"熔断了"还是"只是下游慢"。

手工验证的土办法：把订单服务停掉，用 `ab` 或循环 curl 打个十几发请求（凑够最小样本数），再查状态——应该已经变成 OPEN。

### 3.6 一个高频翻车点：TimeLimiter 默认 1 秒

Spring Cloud CircuitBreaker 在熔断器外还默认包了一层 **TimeLimiter**，超时时间默认 **1 秒**。于是经典惨案来了：

> 接口本身要跑 2 秒（正常业务耗时），上线网关熔断后，所有请求 1 秒整被掐断，全部走降级——明明下游活得好好的。

如果日志里大面积 `TimeoutException` 而下游其实没挂，八成就是它。解决：

```yaml
resilience4j:
  timelimiter:
    configs:
      default:
        timeoutDuration: 5s   # 比下游接口最慢正常耗时再放宽一些
```

**超时、慢调用阈值、TimeLimiter 三者的关系要理顺**：TimeLimiter 决定"单次调用最多等多久"，slowCallDurationThreshold 决定"等多久算慢"。前者应该不小于后者，否则调用还没来得及被统计成"慢调用"，就先被 TimeLimiter 掐死了。

## 四、实战二：Sentinel

### 4.1 什么时候选它

如果你的技术栈是 Spring Cloud Alibaba，或者你需要在**控制台上动态调整规则、实时看监控**，Sentinel 通常是更好的选择。它把限流、熔断、热点参数限流、系统自适应保护打包成一套，且有现成的 Dashboard。

### 4.2 接入

```xml
<dependency>
    <groupId>com.alibaba.cloud</groupId>
    <artifactId>spring-cloud-alibaba-sentinel-gateway</artifactId>
</dependency>
```

```yaml
spring:
  cloud:
    sentinel:
      transport:
        dashboard: sentinel-dashboard:8080   # 控制台地址
      eager: true                            # 启动即注册，不用等第一次请求
```

部署一个 Dashboard 服务（官方提供 jar，一个 `java -jar` 的事），打开网页就能看到所有网关路由的实时流量。规则默认存内存、重启丢失，生产环境接 Nacos/Apollo 做持久化——这是 Sentinel 的标准玩法。

### 4.3 熔断策略与网关流控

Sentinel 的熔断（它叫"熔断策略"）有三种触发方式，覆盖了 Resilience4j 的两种并多了异常维度：

| 策略 | 触发条件 |
| --- | --- |
| 慢调用比例 | RT 超过阈值的调用占比超标 |
| 异常比例 | 抛异常的调用占比超标 |
| 异常数 | 窗口内异常次数超标 |

除了熔断，它还有网关独有的 **GatewayFlowRule**，按路由维度做限流（QPS、热点参数等）：

```java
@PostConstruct
public void initGatewayRules() {
    Set<GatewayFlowRule> rules = new HashSet<>();
    // order-route 路由：单机 QPS 超 100 就拒绝
    rules.add(new GatewayFlowRule("order-route")
            .setCount(100)
            .setIntervalSec(1));
    GatewayRuleManager.loadRules(rules);
}
```

这些规则在 Dashboard 上点点鼠标就能配，代码方式适合放进配置中心统一管理。熔断后的行为也支持自定义：返回固定的 JSON 提示，或转发到降级接口，思路和第三节一致。

## 五、实战三：Hystrix，认识即可

老项目里还会见到 Gateway 的 `Hystrix` 过滤器工厂，这里只讲清楚来龙去脉：

- Netflix 2018 年宣布 Hystrix 进入维护模式，不再开发新功能；
- 它的默认隔离手段是**线程池隔离**——每次调用丢进独立线程池，隔离彻底但线程切换开销大；
- Spring Cloud 2020.0 起彻底移除了对它的集成，Gateway 的 `Hystrix` 过滤器也随之消失。

新项目没有理由再选它。你在维护存量系统时看到 `Hystrix` filter，知道它是"上一代保险丝"、迁移方向是 Resilience4j 或 Sentinel，就够了。

## 六、三种方案怎么选

| 维度 | Resilience4j | Sentinel | Hystrix |
| --- | --- | --- | --- |
| 定位 | 轻量函数式熔断库 | 流量治理全家桶 | 上一代熔断 |
| 熔断触发 | 失败率、慢调用比例 | 慢调用、异常比例、异常数 | 失败率 |
| 规则配置 | 配置文件为主，改配置需重启 | 控制台动态下发 + 配置中心持久化 | 配置文件 |
| 监控 | Actuator 端点 | Dashboard 实时监控 | Dashboard（停更） |
| 生态 | 原生 Spring Cloud 官方推荐 | Spring Cloud Alibaba 系 | 已出清 |
| 现状 | 活跃维护 | 活跃维护 | 维护模式 |

一句话选型：**原生 Spring Cloud 用 Resilience4j；Alibaba 体系、或需要控制台动态调规则和实时监控，用 Sentinel；Hystrix 只存在于老项目里，遇上了就规划迁移。**

## 七、生产环境的三条心得

**1. 先调超时，再谈熔断。** 熔断的统计口径里，"慢"和"挂"都来自超时判定。下游正常耗时 3s、你超时设 1s，那所有正常请求都会被记成失败，熔断器天天误跳。正确顺序：搞清接口的真实耗时分布 → 定超时 → 定慢调用阈值 → 再定熔断敏感度（别忘了 3.6 的 TimeLimiter）。

**2. 熔断粒度按路由拆，不要全站共用一只保险丝。** 一个熔断器实例管所有路由，等于任何一个服务的故障都可能触发跳闸、殃及全部流量。正确做法是每条关键路由（甚至每个下游接口）独立实例，各自统计、各自熔断——这就是第一节"故障隔离"的完整含义。

**3. 降级内容是产品问题，提前设计。** 熔断技术上线只要半天，但"兜底数据从哪来"往往没有答案：缓存快照需要额外链路去维护，默认值需要产品拍板。没提前想好这些，上线当天降级就只能返回"系统繁忙"，业务方第一个投诉的就是你。

## 写在最后

回顾一下这条主线：

- 下游故障时，同步等待会耗尽网关线程，把单点故障放大成全站雪崩；
- 熔断器用 **Closed → Open → Half-Open** 三态状态机，在失败率/慢调用比例超标时快速失败，冷却后小流量探测恢复；
- Spring Cloud Gateway 用 `CircuitBreaker` 过滤器 + Resilience4j 落地，`fallbackUri` 收敛降级逻辑，注意 TimeLimiter 默认 1 秒的坑；
- Sentinel 提供控制台化的动态规则，Hystrix 已经谢幕。

限流、熔断、降级，三件套讲完了两件。它们不解决"服务为什么挂"，只承诺一件事：**挂的时候，挂得小一点、久一点的恢复快一点。** 至于怎么让服务少挂——那是另一个故事了。
