---
title: RabbitMQ 从零到一（02）：五种消息模型
date: 2026-08-17 18:20:00
categories:
  - 教程
tags:
  - RabbitMQ
  - 消息队列
  - 工作队列
  - 发布订阅
description: 简单队列、工作队列、发布订阅、路由模式、主题模式——五种消息模型逐一用 Java 代码实现，重点讲透轮询分发与能者多劳的区别。
keywords:
  - RabbitMQ 消息模型
  - 工作队列
  - 发布订阅
  - topic 交换机
lang: zh-CN
---

> **前置阅读**：[01 核心概念篇](/articles/RabbitMQ/01-rabbitmq-core-concepts/)——需要先知道交换机、队列、绑定是什么。

RabbitMQ 官方教程把常见用法归纳成五种消息模型，本质上就是**"几类交换机 × 几个消费者"的组合**：

| 模型 | 交换机 | 消费者数 | 一句话 |
|------|--------|---------|--------|
| 简单队列 | 默认 | 1 | 一对一发消息 |
| 工作队列 | 默认 | N | 一条消息只给一个消费者，分摊干活 |
| 发布订阅 | fanout | N | 广播，人人有份 |
| 路由模式 | direct | N | 按键精确投递 |
| 主题模式 | topic | N | 按通配符投递 |

## 一、简单队列

一对一，上一篇文章的 Hello World 就是它，不再重复。它的问题是**队列积压时没有横向扩容能力**——引出工作队列。

## 二、工作队列（Work Queue）：一条消息只给一个人

场景：注册消息堆积了 1 万条，一个消费者处理不过来。好消息是：发短信这件事**一条消息只需要做一次**，所以我们起 N 个消费者共同消费同一个队列。

```java
// 生产者：连发 20 条消息
try (Connection conn = ConnectionUtil.getConnection();
     Channel channel = conn.createChannel()) {

    channel.queueDeclare("work.queue", false, false, false, null);
    for (int i = 1; i <= 20; i++) {
        String message = "任务-" + i;
        // 模拟部分任务耗时不同：编号能被 3 整除的是"大任务"
        channel.basicPublish("", "work.queue", null, message.getBytes());
    }
}
```

```java
// 消费者 1 和消费者 2 跑同一份代码，改下名字即可
channel.basicConsume("work.queue", true, (tag, delivery) -> {
    String msg = new String(delivery.getBody());
    if (msg.endsWith("3") || msg.endsWith("6") || msg.endsWith("9")) {
        Thread.sleep(3000);          // 模拟大任务
    } else {
        Thread.sleep(200);           // 模拟小任务
    }
    System.out.println("消费者1 处理完: " + msg);
}, tag -> {});
```

### 轮询分发：默认的"平均主义"

跑一下会发现：消费者 1 分到任务 1、3、5、7…，消费者 2 分到 2、4、6、8…，**严格一人一半，谁也别想多拿**。

这就是 RabbitMQ 的默认分发策略——**轮询（Round-Robin）**。它不管消费者忙不忙：哪怕消费者 1 正在处理 3 秒的大任务，队列照样把下一条塞给它，而旁边的消费者 2 早就闲得发慌。结果就是**忙的更忙、闲的更闲**，整体吞吐被拖慢。

### 公平分发：能者多劳

解法是两行配置，缺一不可：

```java
// 每个消费者最多持有 1 条"未确认"的消息，处理完 ack 之前队列不再派新活
channel.basicQos(1);

// 第二个参数 autoAck 改为 false —— 手动确认
channel.basicConsume("work.queue", false, (tag, delivery) -> {
    String msg = new String(delivery.getBody());
    // ... 处理业务 ...
    channel.basicAck(delivery.getEnvelope().getDeliveryTag(), false);
}, tag -> {});
```

原理：`basicQos(1)` 告诉队列"没收到我的 ack 之前别派新消息"，而 ack 只有处理完才发。于是**谁先干完谁先领下一条**——处理快的消费者自然拿得多，这就是**能者多劳（Fair Dispatch）**。

![图1：轮询分发与公平分发的对比](rabbitmq-work-queues-dispatch.svg)

注意一个坑：**手动 ack 忘了调用 `basicAck`** 的话，消息会一直处于 unacked 状态，队列不会派新消息（`basicQos(1)` 时直接卡死），积压在管理界面上一眼就能看出来。忘了 ack 的排查方法：Queues 页签看 Unacked 数量。

## 三、发布订阅（fanout）：人人有份

场景：用户注册成功后，邮件服务和短信服务**都要**收到通知。一条消息要给多个队列各投一份——这就是 fanout 交换机的广播能力。

```java
// 生产者：声明交换机并发消息，不再声明队列
try (Connection conn = ConnectionUtil.getConnection();
     Channel channel = conn.createChannel()) {

    channel.exchangeDeclare("register.fanout", BuiltinExchangeType.FANOUT);
    channel.basicPublish("register.fanout", "", null, "用户 zhangsan 注册成功".getBytes());
}
```

```java
// 消费者（邮件服务）：自己声明队列，并绑定到交换机
channel.exchangeDeclare("register.fanout", BuiltinExchangeType.FANOUT);
channel.queueDeclare("email.queue", false, false, false, null);
channel.queueBind("email.queue", "register.fanout", "");   // fanout 的 key 无意义
channel.basicConsume("email.queue", true, callback, tag -> {});
```

短信服务的代码一模一样，只是队列名换成 `sms.queue`。每个消费者**声明自己的队列**再绑定到同一个交换机，fanout 会把消息复制到所有绑定的队列。

和"生产者发 20 条消息给 2 个消费者各 10 条"的工作队列对比：**工作队列是竞争关系（一条消息只给一个人），发布订阅是订阅关系（一条消息每人一份）**。

## 四、路由模式（direct）：按键精确投递

场景：支付结果消息有 `pay.success` 和 `pay.fail` 两种，退款服务只关心失败，发货服务只关心成功。fanout 做不到选择性投递，上 direct：

```java
// 生产者：routing key 区分消息类型
channel.exchangeDeclare("pay.direct", BuiltinExchangeType.DIRECT);
channel.basicPublish("pay.direct", "pay.success", null, "订单1001支付成功".getBytes());
channel.basicPublish("pay.direct", "pay.fail",    null, "订单1002支付失败".getBytes());
```

```java
// 发货服务：绑定 key 为 pay.success，只有成功的消息会进来
channel.queueDeclare("ship.queue", false, false, false, null);
channel.queueBind("ship.queue", "pay.direct", "pay.success");

// 退款服务：绑定 pay.fail
channel.queueDeclare("refund.queue", false, false, false, null);
channel.queueBind("refund.queue", "pay.direct", "pay.fail");
```

direct 的规则就一条：**binding key 和 routing key 完全相等才投递**。一个队列也可以绑多个 key（比如风控服务两个都绑，成功失败都要看）。

## 五、主题模式（topic）：通配符投递

场景：消息的 routing key 变成了多级结构 `商品.事件.地区`，比如 `order.paid.gz`、`order.cancelled.sh`、`user.created.gz`。需求开始花哨：

- 华南的日志服务要所有 `*.gz`
- 订单服务要所有 `order.#`
- 只关心订单取消：`order.cancelled.*`

这种"按层级通配"的需求用 topic：

```java
// 生产者
channel.exchangeDeclare("biz.topic", BuiltinExchangeType.TOPIC);
channel.basicPublish("biz.topic", "order.paid.gz", null, "广州订单支付".getBytes());
channel.basicPublish("biz.topic", "user.created.sh", null, "上海新用户".getBytes());
```

```java
// 订单服务：绑定 order.#，收所有订单相关消息
channel.queueDeclare("order.queue", false, false, false, null);
channel.queueBind("order.queue", "biz.topic", "order.#");
```

匹配规则（`.` 分隔的**单词**为最小单位）：

| binding key | 能匹配 | 不能匹配 |
|-------------|--------|---------|
| `order.*` | `order.paid` | `order.paid.gz`（`*` 只顶一个词） |
| `order.#` | `order.paid`、`order.paid.gz` | —— |
| `#.gz` | `order.paid.gz`、`gz` | `a.sh` |
| `#` | 任意 key（等价于 fanout） | —— |

两个特例值得记：`#` 单独使用等价于 fanout 广播；不含任何通配符的 topic 绑定（如 `order.paid`）等价于 direct 精确匹配。所以 topic 是 direct 和 fanout 的超集，**业务系统拿不准时直接用 topic 不亏**。

## 六、五种模型怎么选？

按需求倒着推：

1. **一条消息只处理一次、想横向扩容** → 工作队列（默认交换机 + 多消费者 + `basicQos`）
2. **一条消息多个系统都要一份** → fanout
3. **按类型精确分流** → direct
4. **按多级结构灵活订阅** → topic

下一篇解决更要命的问题：这些消息模型里，消息丢了怎么办？——生产者确认、持久化、手动 ack、死信队列，把可靠性一口气讲完。
