---
title: RabbitMQ 从零到一（01）：消息队列与核心概念
date: 2026-08-17 18:00:00
categories:
  - 教程
tags:
  - RabbitMQ
  - 消息队列
  - 中间件
description: 用大白话讲清楚为什么需要消息队列、AMQP 路由模型、四种交换机，再用 Java 客户端跑通第一条消息。
keywords:
  - RabbitMQ 入门
  - 消息队列
  - AMQP
  - Exchange
lang: zh-CN
---

> **适合人群**：写过 Java Web 项目、听过"消息队列"但没真正用过的同学。
> 本系列基于 RabbitMQ 3.13 + Java 客户端 `amqp-client` 5.x，所有代码可直接复制运行。

## 一、为什么需要消息队列？

先看一个熟悉的场景：用户注册。

注册接口要做三件事——写数据库、发激活邮件、发欢迎短信。如果全在接口里同步干完，就会遇到三个问题：

1. **慢**：数据库 50ms + 邮件服务 800ms + 短信服务 600ms，用户点个注册要等 1.5 秒
2. **脆**：短信服务挂了，注册直接失败——明明用户数据已经存进去了
3. **扛不住高峰**：搞活动瞬间 1 万人注册，短信服务被直接打崩

消息队列（Message Queue，简称 MQ）就是解决这三件事的：接口写完数据库后，把"发短信"这件事**写成一条消息扔进队列**就立刻返回；短信服务自己从队列里取消息慢慢发。

这就是 MQ 的三大经典价值：

| 价值 | 一句话解释 | 对应上面的痛点 |
|------|-----------|--------------|
| **异步** | 耗时操作改成"发个消息就走" | 慢 |
| **解耦** | 邮件/短信挂了不影响注册，恢复后接着消费 | 脆 |
| **削峰** | 1 万个请求先进队列排队，消费端按自己的节奏处理 | 扛不住高峰 |

当然代价也有：链路变长了、要保证消息不丢不重、排查问题多了一跳。所以不是所有场景都上 MQ，简单系统别硬塞。

### 主流 MQ 怎么选？

| 产品 | 强项 | 典型场景 |
|------|------|---------|
| **RabbitMQ** | 延迟低（微秒级）、路由灵活、管理界面好用 | 业务消息、订单/通知、延迟任务 |
| Kafka | 吞吐量百万级、天然分布式日志 | 日志采集、大数据流、埋点 |
| RocketMQ | 事务消息、阿里系生态 | 电商订单链路 |

RabbitMQ 是其中**最容易上手、业务系统用得最多**的一个，也是本系列的主角。

## 二、AMQP 模型：消息到底怎么流动的？

RabbitMQ 是 **AMQP 0-9-1 协议**的实现。它和 Kafka"生产者直接把消息写进 topic"不同，中间多了一个关键角色——**交换机（Exchange）**。

一条消息的生命周期：

```
生产者 ──routing key──▶ 交换机 ──binding key──▶ 队列 ──▶ 消费者
（Publisher）           （Exchange）           （Queue）  （Consumer）
```

1. **生产者**只把消息发给**交换机**，并携带一个 **routing key**（路由键）
2. 交换机根据**自己的类型**和**绑定关系（Binding）**决定把消息投给哪些队列
3. **队列**是真正存消息的缓冲区，先入先出
4. **消费者**从队列取消息处理

几个新手最容易懵的点：

- **生产者从不直接发消息到队列**，永远只发交换机
- **交换机不存消息**，它只是个"路由器"，消息路由失败且没有配置回退时，消息会被**直接丢弃**（这是新手消息丢失的头号原因）
- 交换机和队列是**多对多**关系：一个交换机可以绑多个队列，一个队列也可以被多个交换机绑定

![图1：AMQP 消息路由模型](/images/svg/rabbitmq-amqp-model.svg)

## 三、四种交换机类型

路由的全部逻辑都在交换机类型上，RabbitMQ 有四种：

| 类型 | 中文叫法 | 路由规则 |
|------|---------|---------|
| `fanout` | 广播 | 无视 routing key，**所有**绑定队列都收到一份 |
| `direct` | 精确匹配 | binding key 与 routing key **完全相等**才投递 |
| `topic` | 通配匹配 | binding key 支持通配符 `*`（恰好一个词）和 `#`（零个或多个词） |
| `headers` | 头匹配 | 按消息 header 属性匹配，性能差，基本不用 |

举个订单系统的例子，routing key 统一用 `订单类型.事件` 的格式（如 `order.paid`、`order.cancelled`）：

- 积分服务关心所有订单事件 → 用 `fanout` 或 `topic` 绑 `order.#`
- 只有短信服务要处理支付成功 → 用 `direct` 绑 `order.paid`
- 库存服务要处理支付和取消 → 用 `topic` 绑 `order.*`（一个词结尾的全部）

`*` 和 `#` 是按 **`.` 分隔的单词**匹配的：`order.*` 能匹配 `order.paid`，不能匹配 `a.b.order.paid`；`order.#` 两者都能匹配。

![图2：四种交换机类型的路由行为对比](/images/svg/rabbitmq-exchange-types.svg)

实际业务里 90% 的场景 `direct` 和 `topic` 就够用了：精确的用 direct，带层级的用 topic，全量广播才用 fanout。

## 四、安装 RabbitMQ（Docker 一条命令）

```bash
docker run -d \
  --name rabbitmq-lab \
  -p 5672:5672 \
  -p 15672:15672 \
  --restart unless-stopped \
  rabbitmq:3.13-management
```

- `5672`：AMQP 协议端口，程序连这个
- `15672`：管理界面端口，浏览器开 `http://localhost:15672`
- `-management` 标签自带管理插件，否则要手动 `rabbitmq-plugins enable rabbitmq_management`

打开管理界面，默认账号密码都是 `guest`（仅本机可用）。首页就能看到连接数、队列数、消息速率——生产排障全靠它。

## 五、Java 跑通第一条消息

建一个 Maven 项目，引入官方客户端：

```xml
<dependency>
    <groupId>com.rabbitmq</groupId>
    <artifactId>amqp-client</artifactId>
    <version>5.21.0</version>
</dependency>
```

先写一个连接工具类，后面整篇文章复用：

```java
import com.rabbitmq.client.Connection;
import com.rabbitmq.client.ConnectionFactory;

public class ConnectionUtil {

    public static Connection getConnection() throws Exception {
        ConnectionFactory factory = new ConnectionFactory();
        factory.setHost("localhost");
        factory.setPort(5672);
        factory.setVirtualHost("/");   // 默认虚拟主机
        factory.setUsername("guest");
        factory.setPassword("guest");
        return factory.newConnection();
    }
}
```

### 生产者：发消息

```java
import com.rabbitmq.client.Channel;

public class Producer {

    private static final String QUEUE_NAME = "hello.queue";

    public static void main(String[] args) throws Exception {
        try (Connection conn = ConnectionUtil.getConnection();
             Channel channel = conn.createChannel()) {

            // 声明队列： durable=false, exclusive=false, autoDelete=false
            channel.queueDeclare(QUEUE_NAME, false, false, false, null);

            String message = "hello rabbitmq";
            // 发到默认交换机（名字是空串），routing key 直接写队列名
            // 默认交换机会把消息路由到"与 routing key 同名"的队列
            channel.basicPublish("", QUEUE_NAME, null, message.getBytes());
            System.out.println("已发送: " + message);
        }
    }
}
```

这里偷了个懒：每个虚拟主机都自带一个**默认交换机**（名字为空字符串的 direct 交换机），它绑定着所有队列、binding key 就是队列名本身。所以 `basicPublish("", 队列名, ...)` 等价于"直接发到队列"，学习阶段常用。

### 消费者：收消息

```java
import com.rabbitmq.client.*;

public class Consumer {

    private static final String QUEUE_NAME = "hello.queue";

    public static void main(String[] args) throws Exception {
        Connection conn = ConnectionUtil.getConnection();
        Channel channel = conn.createChannel();

        channel.queueDeclare(QUEUE_NAME, false, false, false, null);

        DeliverCallback callback = (consumerTag, delivery) -> {
            String message = new String(delivery.getBody());
            System.out.println("收到: " + message);
        };
        channel.basicConsume(QUEUE_NAME, true, callback, consumerTag -> {});
    }
}
```

先启动消费者（它会一直挂着等消息），再启动生产者，控制台就能看到消息被打印出来。去管理界面 Queues 页签，还能看到这条消息的消费轨迹。

几个参数先混个脸熟，后面文章会展开：

- `basicConsume` 第二个参数 `true` 表示**自动 ack**——收到就算成功，处理失败消息也丢了，生产环境要用手动 ack（第 03 篇）
- `queueDeclare` 的三个布尔值分别是持久化、排他、自动删除（第 03 篇）

## 小结

- MQ 的三大价值：**异步、解耦、削峰**，代价是链路变长
- RabbitMQ 的消息模型：生产者 → 交换机 →（绑定规则）→ 队列 → 消费者，**生产者永远只发交换机**
- 四种交换机：fanout 广播、direct 精确、topic 通配、headers 基本不用
- 默认交换机可以让你"直接发到队列"，但它本质上仍是 direct 类型

下一篇我们把这个模型玩出花样——五种经典消息模型，从简单队列一路讲到 topic 主题模式。
