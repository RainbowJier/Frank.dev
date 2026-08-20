---
title: RabbitMQ 从零到一（04）：Spring Boot 整合与集群高可用
date: 2026-08-17 19:00:00
categories:
  - 教程
tags:
  - RabbitMQ
  - Spring Boot
  - 仲裁队列
  - 高可用
description: Spring Boot 生产级整合（声明式配置、手动 ack、重试与死信），再讲清楚镜像队列为什么被弃用、仲裁队列怎么用，最后是消息积压的排查套路。
keywords:
  - Spring Boot RabbitMQ
  - 仲裁队列
  - RabbitMQ 集群
  - 消息积压
lang: zh-CN
---

> **前置阅读**：[03 可靠性篇](/articles/RabbitMQ/03-rabbitmq-reliable-delivery/)——本文直接使用 confirm、手动 ack、死信队列的概念。

前三篇用的是原生 `amqp-client`，概念看得清楚但样板代码多。实际项目里用 Spring Boot 的 `spring-boot-starter-amqp`（底层是 Spring AMQP），声明和收发都是声明式的。

## 一、Spring Boot 整合

### 依赖与配置

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-amqp</artifactId>
</dependency>
```

```yaml
spring:
  rabbitmq:
    host: localhost
    port: 5672
    username: frank
    password: Frank_123!
    virtual-host: /
    publisher-confirm-type: correlated   # 开启生产者确认（异步回调模式）
    publisher-returns: true              # 开启不可路由退回
    template:
      mandatory: true                    # 路由不到队列时触发 ReturnsCallback
    listener:
      simple:
        acknowledge-mode: manual         # 手动 ack（自动模式丢消息，见第 03 篇）
        prefetch: 1                      # 等价 basicQos(1)，能者多劳
        retry:
          enabled: true                  # 消费异常本地重试
          max-attempts: 3                # 最多试 3 次
          initial-interval: 2000         # 重试间隔 2 秒
        default-requeue-rejected: false  # 重试耗尽后不重回队列 → 进死信
```

一段配置把 03 篇讲的生产者确认、手动 ack、能者多劳、有限重试、死信兜底全部就位了。

### 声明交换机、队列、绑定

```java
@Configuration
public class RabbitConfig {

    public static final String EXCHANGE   = "pay.topic";
    public static final String QUEUE      = "pay.queue";
    public static final String DLX_QUEUE  = "pay.dlx.queue";

    @Bean
    public TopicExchange payExchange() {          // 持久化
        return ExchangeBuilder.topicExchange(EXCHANGE).durable(true).build();
    }

    @Bean
    public Queue payQueue() {
        return QueueBuilder.durable(QUEUE)                 // 持久化队列
                .withArgument("x-dead-letter-exchange", "pay.dlx")
                .withArgument("x-dead-letter-routing-key", "dead")
                .build();
    }

    @Bean
    public Queue dlxQueue() {
        return QueueBuilder.durable(DLX_QUEUE).build();
    }

    @Bean
    public Binding payBinding() {
        return BindingBuilder.bind(payQueue()).to(payExchange()).with("order.#");
    }
}
```

Spring AMQP 启动时自动把这些声明发给 Broker（幂等，重复声明无害），再也不用手写 `queueDeclare`。

### 发消息：RabbitTemplate + 确认回调

```java
@Service
@RequiredArgsConstructor
public class PayProducer {

    private final RabbitTemplate rabbitTemplate;

    @PostConstruct
    public void init() {
        // Broker 确认收到（对应 03 篇的 confirm）
        rabbitTemplate.setConfirmCallback((correlationData, ack, cause) -> {
            if (!ack) {
                log.error("消息未被 Broker 确认: {}", cause);
                // 落补偿表、告警、重发
            }
        });
        // 路由不到队列被退回（对应 03 篇的 return）
        rabbitTemplate.setReturnsCallback(returned ->
                log.error("消息不可路由: routingKey={}, message={}",
                        returned.getRoutingKey(), new String(returned.getMessage().getBody())));
    }

    public void sendPaySuccess(String orderNo) {
        Message message = MessageBuilder
                .withBody(("订单" + orderNo + "支付成功").getBytes())
                .setDeliveryMode(MessageDeliveryMode.PERSISTENT)  // 消息持久化
                .build();
        rabbitTemplate.convertAndSend(RabbitConfig.EXCHANGE, "order.paid", message);
    }
}
```

### 收消息：@RabbitListener + 手动 ack

```java
@Component
@Slf4j
public class PayConsumer {

    @RabbitListener(queues = RabbitConfig.QUEUE)
    public void onMessage(Message message, Channel channel) throws IOException {
        long tag = message.getMessageProperties().getDeliveryTag();
        try {
            String body = new String(message.getBody());
            log.info("处理支付成功: {}", body);
            // 业务处理……
            channel.basicAck(tag, false);
        } catch (Exception e) {
            // 本地重试已由 yml 的 retry 配置兜过 3 次，到这里还不行就进死信
            channel.basicNack(tag, false, false);
        }
    }

    @RabbitListener(queues = RabbitConfig.DLX_QUEUE)   // 死信也要有人管
    public void onDeadLetter(Message message, Channel channel) throws IOException {
        log.error("收到死信，请人工介入: {}", new String(message.getBody()));
        channel.basicAck(message.getMessageProperties().getDeliveryTag(), false);
    }
}
```

到此，生产级的最小可用闭环就完成了：**确认回调 + 持久化 + 手动 ack + 重试 + 死信监听**。

## 二、Broker 自己挂了怎么办：集群与仲裁队列

前面所有可靠性手段都假设 Broker 活着。单机 Broker 仍是单点——上集群。

### 普通集群：只同步元数据，不同步消息

普通集群（cluster）只在各节点间同步**元数据**（交换机/队列的定义），**消息默认只存在队列所在的那个节点**上：

- 好处：客户端连任意节点都能找到队列（找不到的会被路由到队列所在节点）
- 坏处：**队列所在节点宕机，队列和消息直接不可用**——高可用等于没有

### 仲裁队列：Raft 多数派复制

老方案是镜像队列（mirrored queue，主从复制），但 3.9 起已被官方标记弃用，替代品是**仲裁队列（Quorum Queue）**：

- 每个队列在**多个节点上有副本**，基于 Raft 协议写入：过半数副本确认才算成功
- 3 节点集群**容忍 1 台宕机**、5 节点容忍 2 台——少数派宕机不影响服务
- 天然持久化（消息写多数派才算写入成功），配合 03 篇的持久化语义更严

```java
// Spring AMQP 声明仲裁队列：只需把 x-queue-type 设为 quorum
@Bean
public Queue payQueue() {
    return QueueBuilder.durable(QUEUE)
            .quorum()                                    // 队列类型 = quorum
            .withArgument("x-dead-letter-exchange", "pay.dlx")
            .build();
}
```

```bash
# 三台机器组成集群（各节点的 cookie 必须一致）：
rabbitmqctl stop_app
rabbitmqctl reset
rabbitmqctl join_cluster rabbit@node1
rabbitmqctl start_app
rabbitmqctl cluster_status    # 看到 3 个 running 节点即成功
```

![图1：普通集群与仲裁队列的高可用对比](rabbitmq-cluster-architecture.svg)

选型结论一句话：**3.9+ 版本直接用仲裁队列**，只有老系统迁移和极端低延迟场景才需要考虑经典队列 + 网络分区策略。

## 三、消息积压了怎么办？

最后讲一个实战必备的应急套路。某天管理界面突然报警：队列消息数 50 万且持续上涨。

按顺序排查：

1. **消费挂了吗？** 看 Consumers 数量是否为 0（消费者崩了/连不上），Unacked 是否暴涨（处理卡住——大概率在等一个超时的下游接口）
2. **消费太慢还是生产太快？** 看消息速率图（管理界面 Queue 页签），区分是消费能力不足还是流量异常
3. **扩消费端**：加消费者实例最直接；`@RabbitListener(concurrency = "5-10")` 单实例拉线程
4. **上惰性队列**：积压到百万级时，默认队列消息全在内存，Broker 有内存告警后直接**拒绝收消息**。惰性队列（lazy）消息尽量落盘，用吞吐换内存，积压千万级也不怕：

```java
@Bean
public Queue bigQueue() {
    return QueueBuilder.durable("huge.queue")
            .lazy()            // 惰性队列：消息直接写磁盘，省内存
            .build();
}
```

5. **流量异常就关掉源头**：积压本质是生产 > 消费，紧急时刻降级生产方（限流/关闭非核心消息）比疯狂扩容更有效

还有一个日常坑提前记：默认内存水位是 40%（`vm_memory_high_watermark`），触线后 Broker 拒收新消息、生产端大量阻塞——不要盲目调大，先解决积压。

## 四、系列总结

四篇走完，把 RabbitMQ 的知识地图串一遍：

| 篇 | 核心内容 | 一句话记忆 |
|----|---------|-----------|
| 01 | AMQP 模型、四种交换机 | 生产者只发交换机，交换机不存消息 |
| 02 | 五种消息模型 | 竞争用工作队列，订阅用 fanout/topic |
| 03 | 可靠性 | confirm + 三重持久化 + 手动 ack + 幂等 |
| 04 | Spring Boot 与集群 | 声明式配置一把梭，仲裁队列上 Raft |

面试高频问题的答案也都在里面了：消息丢失（03 篇三环节）、重复消费（幂等三招）、消息积压（04 篇排查五步）、延迟队列（TTL+DLX 与队头阻塞）、镜像队列 vs 仲裁队列（04 篇）。

接下来的练手方向：把 02 篇的五种模型在 Spring Boot 里全部实现一遍，再用 04 篇的积压套路故意制造一次积压并恢复它——中间件这个东西，踩过一遍坑才算真的会。
