---
title: RuoYi 框架从零到一 12 - 微服务架构演进
date: 2026-08-25 12:00:00
categories:
  - 教程
tags:
  - RuoYi
  - RuoYi-Cloud
  - 微服务
  - Spring Cloud
description: 从 RuoYi-Vue 单体前后端分离架构出发，解析 RuoYi-Cloud 的服务拆分、Nacos、Gateway、Sentinel、Seata 及渐进式迁移策略。
lang: zh-CN
---

> **适合人群**：已经掌握 RuoYi-Vue，开始面对服务拆分、独立扩缩容和分布式治理问题的同学。
> 本文是《RuoYi 框架从零到一》系列第 12 篇。文中明确区分 RuoYi-Vue 与 RuoYi-Cloud：Cloud 专属组件不能直接当作单体版默认能力。
>
> 建议先读 {% post_link articles/RuoYi/11-ruoyi-cache-performance '11 - 缓存与性能优化' %}。

## 一、什么时候需要微服务

“项目用了 Spring Cloud”不是架构成熟的证明。微服务引入了注册发现、配置治理、网络调用、部署编排、链路追踪和分布式故障，只有收益大于成本时才值得做。

![图1：单体到微服务的演进判断](ruoyi-monolith-to-microservices.svg)

### 1.1 单体 RuoYi-Vue 的优势

- 一个应用、一个发布单元，部署和排障简单；
- 模块之间可以直接调用，事务边界清晰；
- 共享数据库，开发和测试成本低；
- 适合中小型后台系统以及业务还在快速变化的阶段。

### 1.2 拆分信号

出现以下信号时，才可以开始评估拆分：

1. 文件、报表、任务等模块明显消耗不同资源，需要独立扩容；
2. 不同团队发布节奏互相阻塞；
3. 某个模块故障会拖垮整个应用；
4. 业务边界和数据归属已经稳定；
5. 团队有持续运维分布式系统的能力。

**反例**：只是因为“微服务流行”就把每个 Controller 拆成一个服务，通常会得到大量网络调用和更复杂的部署，而不是更高的交付效率。

## 二、RuoYi-Cloud 服务划分

RuoYi-Cloud 是 RuoYi 生态中的微服务版本，具体模块和组件会随版本演进，但常见职责可以这样理解：

![图2：RuoYi-Cloud 核心架构](ruoyi-cloud-service-architecture.svg)

| 服务 | 职责 |
|---|---|
| **Gateway** | 统一入口、路由、跨域、前置鉴权和请求过滤 |
| **Auth** | 登录、Token、用户认证 |
| **System** | 用户、角色、菜单、部门、字典等系统业务 |
| **Gen** | 代码生成相关业务 |
| **Job** | 定时任务或任务管理 |
| **File** | 文件上传、下载和对象存储抽象 |
| **Monitor** | 监控、日志或链路治理（按分支配置） |

拆分的重点不是服务数量，而是三个边界：

- **代码边界**：服务可以独立构建和发布；
- **数据边界**：服务拥有自己的数据模型和访问规则；
- **故障边界**：一个服务异常时，其他服务仍可降级运行。

## 三、Nacos：注册中心与配置中心

### 3.1 服务注册发现

服务启动时向 Nacos 注册实例信息，包括服务名、IP、端口和健康状态。调用方不再写死某台机器的地址，而是根据服务名发现可用实例。

```yaml
spring:
  cloud:
    nacos:
      discovery:
        server-addr: ${NACOS_ADDR:127.0.0.1:8848}
        namespace: ${NACOS_NAMESPACE:public}
        username: ${NACOS_USERNAME:nacos}
        password: ${NACOS_PASSWORD:nacos}
```

示例中的默认值只用于本地学习；生产环境应通过环境变量或密钥管理系统提供凭据。

### 3.2 配置中心

数据库地址、Redis 地址、Token 有效期和灰度开关等配置可以集中管理：

```yaml
spring:
  config:
    import:
      - optional:nacos:ruoyi-system.yml?group=DEFAULT_GROUP
      - optional:nacos:ruoyi-common.yml?group=DEFAULT_GROUP
```

配置中心的价值不只是“改配置不用重启”，还包括：

- 多环境隔离；
- 配置版本和回滚；
- 灰度发布；
- 统一审计。

但配置中心本身也是基础设施，必须考虑权限、备份、变更审批和不可用时的本地兜底。

## 四、Gateway：统一入口

![图3：注册、配置与统一鉴权链路](nacos-gateway-auth-flow.svg)

### 4.1 路由配置

```yaml
spring:
  cloud:
    gateway:
      routes:
        - id: ruoyi-auth
          uri: lb://ruoyi-auth
          predicates:
            - Path=/auth/**
        - id: ruoyi-system
          uri: lb://ruoyi-system
          predicates:
            - Path=/system/**
          filters:
            - StripPrefix=0
```

`lb://ruoyi-system` 表示通过注册中心按服务名负载均衡，而不是固定访问某台主机。

### 4.2 网关应该做什么

适合放在网关的逻辑：

- 路由和负载均衡；
- CORS；
- 请求大小和基础限流；
- TraceId 注入；
- 统一 Token 前置检查；
- 黑白名单和基础审计。

不适合塞进网关的逻辑：

- 复杂业务权限；
- 需要访问业务数据库的判断；
- 长时间运行的任务；
- 业务事务。

网关是交通枢纽，不是“超级业务服务”。

### 4.3 认证链路

```text
客户端 → Gateway → Auth 校验 Token → Gateway 携带身份上下文 → System 服务
```

服务端仍然应该做自己的权限校验，不能因为请求经过网关就完全信任内部网络。内部服务之间应使用可信身份、服务账号或 mTLS 等方式保护通信。

## 五、Sentinel：限流、熔断和降级

### 5.1 三种能力

- **流量控制**：限制 QPS 或并发线程数；
- **熔断降级**：依赖服务持续异常时快速失败；
- **系统保护**：在 CPU、负载或入口流量过高时保护系统。

```java
@SentinelResource(
    value = "system:user:list",
    blockHandler = "blockHandler",
    fallback = "fallback")
public TableDataInfo list(UserQuery query) {
    return userService.query(query);
}

public TableDataInfo blockHandler(UserQuery query, BlockException ex) {
    throw new ServiceException("当前访问人数较多，请稍后再试");
}

public TableDataInfo fallback(UserQuery query, Throwable ex) {
    log.warn("用户列表依赖异常", ex);
    return TableDataInfo.empty();
}
```

### 5.2 限流不是越严越好

设计限流时要结合：

1. 单实例吞吐量；
2. 数据库连接池上限；
3. 下游服务容量；
4. 业务是否允许排队；
5. 被限流后的用户提示和重试策略。

错误的限流配置会把正常流量也挡掉，或把压力转移到另一个依赖上。

![图4：微服务韧性与一致性边界](microservices-resilience.svg)

## 六、Seata 与分布式事务

### 6.1 先问是否真的需要

如果一个业务可以通过状态机、最终一致消息或本地事务完成，不要为了“跨服务调用”立刻引入分布式事务。

Seata 适合需要协调多个服务数据库操作的场景，但它会增加锁、网络和回滚成本。

### 6.2 事务边界示意

```java
@GlobalTransactional(name = "create-order", rollbackFor = Exception.class)
public void createOrder(OrderRequest request) {
    orderService.create(request);
    inventoryClient.deduct(request.getItems());
    accountClient.freeze(request.getAccountId(), request.getAmount());
}
```

使用时必须确认：

- 每个服务的数据源和事务代理正确配置；
- 远程调用有超时，不能无限等待；
- 业务操作可补偿，避免长事务锁住大量数据；
- 回滚失败有告警和人工处理路径。

### 6.3 替代方案

| 方案 | 适用场景 |
|---|---|
| 本地事务 | 单服务、单数据库 |
| 可靠消息 | 最终一致、异步流程 |
| Saga / 状态机 | 长流程、可补偿业务 |
| Seata AT/TCC | 需要协调多个服务的短事务 |
| 人工对账 | 金融、库存等最终兜底 |

## 七、服务间调用与可观测性

### 7.1 调用要有超时

```yaml
spring:
  cloud:
    openfeign:
      client:
        config:
          default:
            connectTimeout: 2000
            readTimeout: 5000
```

重试必须谨慎：查询通常可重试，扣款、创建订单等写操作必须带幂等号，否则重试可能造成重复业务。

### 7.2 TraceId 贯穿请求

建议在网关生成或透传 TraceId：

```java
String traceId = Optional.ofNullable(request.getHeader("X-Trace-Id"))
        .orElseGet(() -> UUID.randomUUID().toString());
response.getHeaders().add("X-Trace-Id", traceId);
MDC.put("traceId", traceId);
```

日志格式包含 TraceId 后，可以把一次请求跨 Gateway、Auth 和 System 的日志串起来。

### 7.3 必备指标

- Gateway：QPS、P95、状态码分布；
- Nacos：实例健康、配置变更；
- Sentinel：通过量、拒绝量、熔断次数；
- Feign：调用耗时、超时、重试；
- 数据库：连接池、慢 SQL、复制延迟；
- Seata：事务成功率、回滚和锁等待。

## 八、从单体迁移的渐进式路线

### 阶段 1：先模块化，不急着拆进程

在 RuoYi-Vue 单体中先整理包边界、服务接口和数据访问边界，消除跨模块直接修改内部对象的习惯。

### 阶段 2：优先抽离低耦合模块

文件服务、定时任务、报表计算往往比权限和核心交易更容易独立，因为它们的边界更清楚、流量特征更独立。

### 阶段 3：引入网关和注册配置

保留旧单体作为一个服务，让新服务通过 Gateway 接入，逐步迁移路由，不要一次性切换全部流量。

### 阶段 4：数据边界和故障演练

每个服务明确谁拥有哪张表，禁止跨服务直接访问对方数据库；上线前演练注册中心不可用、Redis 故障、下游超时和消息重复。

## 九、微服务反模式

1. **共享数据库却声称服务自治**：表结构修改会跨服务爆炸。
2. **同步调用链过长**：一个页面串行调用六个服务，任何一个超时都会拖慢用户请求。
3. **重试没有幂等**：网络抖动变成重复扣款或重复创建。
4. **没有降级只会扩容**：故障时所有服务一起重试，形成雪崩。
5. **把配置中心当密码库**：敏感凭据应使用专门的密钥管理能力。
6. **只拆服务不建监控**：没有 TraceId、指标和告警，分布式问题几乎无法定位。

## 十、上线检查清单

- [ ] 每个服务有独立健康检查和版本信息；
- [ ] Gateway 路由、超时、限流和跨域配置已审核；
- [ ] Nacos 命名空间、权限、备份和回滚已验证；
- [ ] 所有跨服务写接口都有幂等策略；
- [ ] Sentinel 降级响应不会泄露内部异常；
- [ ] 分布式事务有超时、回滚告警和人工补偿；
- [ ] 日志包含 TraceId，指标和告警已接入；
- [ ] 数据库连接池、Redis 和消息组件容量经过压测；
- [ ] 已完成注册中心、网关、Redis、数据库故障演练。

## 十一、总结

- RuoYi-Vue 单体前后端分离版适合多数中型后台系统，不必为了架构名词提前拆分。
- RuoYi-Cloud 的核心价值是服务独立部署和治理能力，代价是网络、部署、数据一致性和排障复杂度。
- Nacos 解决注册和配置，Gateway 解决统一接入，Sentinel 解决流量与降级，Seata 处理部分跨服务事务。
- 微服务迁移应从稳定边界开始，采用渐进式路由切换，最终建立独立数据边界和可观测性。

**至此，RuoYi 系列第四部分“进阶扩展”（09–12）已完成。下一阶段可以进入第五部分实战项目：从需求分析、表设计、代码生成到部署上线，完整做一个基于 RuoYi 的业务系统。**

> **思考与练习**
>
> 1. 选择 RuoYi 中一个低耦合模块，写出它的代码边界、数据边界和故障边界。
> 2. 设计一个 Gateway → Auth → System 的请求链路，标出超时、重试和降级点。
> 3. 为一个跨服务创建流程比较本地事务、可靠消息和 Seata 的取舍。