---
title: RabbitMQ 从零到一（03）：消息可靠性投递
date: 2026-08-17 18:40:00
categories:
  - 教程
tags:
  - RabbitMQ
  - 消息队列
  - 可靠性
  - 死信队列
description: 消息在哪三个环节会丢？生产者 confirm、三重持久化、手动 ack、幂等消费、死信与延迟队列，一篇讲透消息不丢不重。
keywords:
  - RabbitMQ 消息丢失
  - 生产者确认机制
  - 死信队列
  - 延迟队列
lang: zh-CN
---

> **前置阅读**：[02 消息模型篇](/articles/RabbitMQ/02-rabbitmq-message-patterns/)——本文的代码基于工作队列和 direct 交换机扩展。

上一篇文章留了个尾巴：`basicConsume` 的自动 ack 会丢消息。这篇把**消息丢失**这个问题彻底讲透——它是 MQ 面试和生产的头号问题。

## 一、消息会在哪丢？

把链路摊开看，消息丢失只发生在**三个环节**：

```
生产者 --①网络/路由失败--> Broker --②宕机内存丢--> 队列 --③消费失败--> 消费者
```

1. **生产者 → Broker**：网络抖动发送失败；或消息路由不到任何队列（交换机没绑定），被 Broker 默默丢弃
2. **Broker 内部**：RabbitMQ 的消息默认在**内存**里，Broker 重启就没了
3. **Broker → 消费者**：消费者刚拿到消息还没处理完就崩了，但用的是自动 ack——Broker 认为已消费，消息丢了

每个环节都有对应的解法，全链路示意：

![图1：消息可靠性投递全链路](rabbitmq-reliable-delivery-flow.svg)

## 二、环节一：生产者确认（Publisher Confirm）

### confirm 确认到达

开启 confirm 后，Broker 收到消息会**异步回执**一个 ack（或路由失败/异常时 nack）：

```java
Channel channel = conn.createChannel();
channel.confirmSelect();   // 开启 confirm 模式

channel.basicPublish("pay.direct", "pay.success", null, body.getBytes());

if (channel.waitForConfirmsOrDie(5_000)) {
    System.out.println("Broker 已确认收到");
}
// 同步等待方式简单但吞吐低；生产推荐 addConfirmListener 异步回调
```

### return 回退不可路由

confirm 只保证"消息到了交换机"，**不保证路由到了队列**。如果 routing key 没有匹配的绑定，消息照样丢（01 篇讲过的头号新手坑）。`mandatory + ReturnListener` 专门兜这个底：

```java
channel.addReturnListener(reply -> {
    // 走到这里说明消息路由失败，reply 里有完整的消息内容
    System.out.println("消息不可路由，被退回: " + new String(reply.getBody()));
    // 落库告警、重发、写入补偿表……
});

// 第二个参数 mandatory=true：路由不到队列时退回给生产者，而不是丢弃
channel.basicPublish("pay.direct", "pay.unknown", true, null, body.getBytes());
```

## 三、环节二：三重持久化

Broker 侧的持久化要**三层全部声明，缺一不可**：

```java
// 1. 交换机持久化：Broker 重启后交换机还在
channel.exchangeDeclare("pay.direct", BuiltinExchangeType.DIRECT, true);

// 2. 队列持久化：重启后队列还在
channel.queueDeclare("pay.queue", true, false, false, null);

// 3. 消息持久化：MessageProperties.PERSISTENT_TEXT_PLAIN 即 deliveryMode=2
channel.basicPublish("pay.direct", "pay.success",
        MessageProperties.PERSISTENT_TEXT_PLAIN, body.getBytes());
```

只做队列持久化、消息没持久化 → 重启后队列还在但消息没了；只做消息持久化、队列没持久化 → 队列都没了消息无处安放。三者是**与**的关系。

注意：已存在的队列**不能**修改持久化属性（会报 `PRECONDITION_FAILED`），要改只能删了重建——所以建队列前就想好。

另外一个诚实的提醒：持久化消息也是先写进缓存再刷盘的，**极端情况（刷盘前宕机）仍可能丢极少量消息**，要绝对不丢需要配合官方的 quorum 队列 + 磁盘刷盘策略，见第 04 篇。

## 四、环节三：消费者手动 ack

自动 ack 的语义是"消息一递出去就算消费成功"。改成手动 ack，处理完业务再确认，崩了消息还能回来：

```java
channel.basicQos(1);

channel.basicConsume("pay.queue", false, (tag, delivery) -> {
    try {
        handlePaySuccess(new String(delivery.getBody()));   // 业务处理
        channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
    } catch (Exception e) {
        // 业务异常：拒绝消息且不重回队列 —— 进死信队列人工/延迟处理
        channel.basicNack(delivery.getEnvelope().getDeliveryTag(), false, false);
    }
}, tag -> {});
```

三种应答：

| 方法 | 含义 | 消息去向 |
|------|------|---------|
| `basicAck` | 处理成功 | 从队列删除 |
| `basicNack(requeue=true)` | 暂时处理不了 | **重回队首**，稍后再投（慎用：异常会死循环） |
| `basicNack(requeue=false)` | 处理失败且放弃 | 进死信队列（配了 DLX 的话） |

requeue=true 配合 `basicQos(1)` 要特别小心：如果消息本身是"毒消息"（每次处理都抛异常），它会被无限投递，消费者 CPU 直接打满。正确姿势是**有限次重试 + 超次进死信**。

## 五、防重：幂等消费

做到"不丢"之后要面对它的副作用——**重试必然带来重复**：ack 回执丢了、消费者处理完但没来得及 ack 就崩了，Broker 都会把消息再投一次。所以消费端必须**幂等**（同一条消息处理一次和处理多次结果一样）。

常用三招：

```java
// 招式一：数据库唯一约束——消息带全局业务号，重复插入直接被数据库拦下
// INSERT INTO consumed_message (message_id) VALUES (?);  主键冲突 = 已处理过

// 招式二：Redis setnx 打标（适合非严格场景）
Boolean first = redis.opsForValue().setIfAbsent("mq:consumed:" + messageId, "1", 24, TimeUnit.HOURS);
if (Boolean.FALSE.equals(first)) {
    return;   // 已处理过，直接 ack
}

// 招式三：状态机——业务本身有状态流转时天然幂等
// UPDATE orders SET status='PAID' WHERE order_no=? AND status='UNPAID';
// 更新行数 = 0 说明已经处理过（或状态不对），跳过
```

一句话总结：**可靠性 = 生产端 confirm/return + 存储端三重持久化 + 消费端手动 ack + 幂等兜底**。

## 六、死信队列（DLX）：消息的"收容所"

死信（Dead Letter）是三种"走投无路"的消息：

1. 被消费者 `basicNack/reject` 且 `requeue=false`
2. 消息 TTL 过期
3. 队列超过 `x-max-length` 长度限制，**最老的消息被挤出**

死信队列不是一种新队列，而是**给普通队列配一个"死后去处"**：声明队列时通过参数绑定一个死信交换机，死信会被自动转投到它上面。

```java
// 死信交换机 + 死信队列（就是个普通 direct 交换机）
channel.exchangeDeclare("pay.dlx", BuiltinExchangeType.DIRECT);
channel.queueDeclare("pay.dlx.queue", true, false, false, null);
channel.queueBind("pay.dlx.queue", "pay.dlx", "dead");

// 业务队列声明时带上 x-dead-letter-exchange 参数
Map<String, Object> args = new HashMap<>();
args.put("x-dead-letter-exchange", "pay.dlx");
args.put("x-dead-letter-routing-key", "dead");
channel.queueDeclare("pay.queue", true, false, false, args);
```

之后 `basicNack(tag, false, false)` 的消息、过期消息、挤出的消息，都会带着原始内容自动流进 `pay.dlx.queue`，由专门的消费者做人工处理或告警。**线上没有死信队列的业务队列等于裸奔**。

## 七、延迟队列：TTL + 死信的经典组合

场景：订单下单 30 分钟未支付自动取消。不能起定时任务每秒扫表，用"TTL + DLX"组合出延迟队列：

原理是给队列设置消息存活时间（`x-message-ttl`），消息过期就成了死信，正好被死信交换机转投到真正的消费队列——**过期的那一刻才被消费，天然就是延迟执行**。

```java
// 1. 延迟队列：消息进来 30 秒后过期，死信转投 pay.dlx
Map<String, Object> args = new HashMap<>();
args.put("x-message-ttl", 30_000);                      // 30 秒
args.put("x-dead-letter-exchange", "pay.dlx");
args.put("x-dead-letter-routing-key", "cancel.check");
channel.queueDeclare("order.delay.queue", true, false, false, args);
channel.queueBind("order.delay.queue", "pay.direct", "order.created");

// 2. 真正的消费队列：死信路由到这里
channel.queueDeclare("order.cancel.queue", true, false, false, null);
channel.queueBind("order.cancel.queue", "pay.dlx", "cancel.check");

// 3. 生产者：下单时发一条消息进延迟队列
channel.basicPublish("pay.direct", "order.created",
        MessageProperties.PERSISTENT_TEXT_PLAIN, "订单1001".getBytes());
// 30 秒后 order.cancel.queue 出现这条消息，消费者检查支付状态，未支付则取消
```

![图2：TTL + 死信交换机实现延迟队列](rabbitmq-dead-letter-delay.svg)

### 队头阻塞：这个方案的坑

RabbitMQ 判断消息过期**只看队头**。发一条 TTL=10 分钟的消息，再发一条 TTL=10 秒的消息，第二条必须等第一条过期出队后才有机会被检查——**短延迟消息被长延迟消息堵死**。

解法：

- **按 TTL 分档建队列**：TTL 30s / 5min / 30min 各一个延迟队列，同档内不会互相堵
- **官方延迟插件**：`rabbitmq_delayed_message_exchange`，交换机层面实现任意毫秒级延迟，没有队头阻塞问题，但插件消息存磁盘（RabbitMQ 3.13 起部分场景内存化），超大量使用前要压测

## 小结

- 消息丢失的三个环节：**生产→Broker（confirm/return）、Broker 存储（三重持久化）、Broker→消费（手动 ack）**
- 重试必然带来重复，消费端**幂等**是可靠性的另一半
- 死信三来源：被拒绝、过期、超长；死信队列是线上必备的"收容所"
- 延迟队列 = TTL + DLX，注意**队头阻塞**，分档或延迟插件解决

最后一篇：Spring Boot 怎么优雅整合这一切，以及 Broker 自己挂了怎么办——集群与仲裁队列。
