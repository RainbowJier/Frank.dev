---
title: Java 并发进阶（05）：线程池
date: 2026-08-24 10:00:00
categories:
  - 教程
tags:
  - Java
  - 多线程
  - 并发编程
description: 从 ThreadPoolExecutor 的执行决策出发，讲清核心线程、工作队列、最大线程数和拒绝策略如何协作，并给出生产环境的创建、调优、关闭与排错方法。
lang: zh-CN
---

> 本文是《Java 并发进阶》系列第 05 篇。上一章我们拆了 `ConcurrentHashMap` 如何用 CAS、`synchronized` 和 `volatile` 把并发控制细到一个桶；这一章把视角拉回应用开发：当请求、消息、批处理任务同时涌来时，怎样让有限的线程有秩序地把活干完。
>
> 建议先读 {% post_link articles/Java/04-java-concurrent-hashmap 'Java 并发进阶（04）：ConcurrentHashMap 为什么又快又安全' %}。它解释了本章会频繁遇到的 CAS、队列和并发竞争问题。

---

## 一、为什么不能到处 `new Thread()`

刚接触异步时，最直观的写法是：来一个任务就新建一个线程。

```java
package com.frank.concurrent.ch05;

public class NewThreadDemo {

    public static void main(String[] args) {
        for (int i = 0; i < 10_000; i++) {
            int taskId = i;
            new Thread(() -> {
                // 模拟一次远程调用
                System.out.println("处理任务：" + taskId);
            }).start();
        }
    }
}
```

这段程序任务少时能运行，在线上却很危险：

- **创建和销毁线程有成本**。线程要申请栈内存、注册到操作系统调度器；线程越多，上下文切换越频繁，真正干活的时间反而越少。
- **数量没有上限**。高峰期一万个请求就可能创建一万个线程，内存和 CPU 很快被拖垮，最后连正常请求也处理不了。
- **没有排队和降级手段**。系统忙不过来时，任务是等待、快速失败，还是由调用方自己执行？裸线程没有答案。
- **没有统一治理入口**。线程名、异常、监控指标、优雅关闭都散落在业务代码里，问题发生后很难定位。

线程池的本质不是「让代码异步」，而是把线程当成一组**可复用、可限流、可观测的工人**：先规定最多雇多少人，再规定活多时放哪儿，最后规定实在接不下时怎么办。

---


日常开发最常用的是 `ThreadPoolExecutor`。它可以看成一个任务调度中心：调用方提交 `Runnable` 或 `Callable`，线程池决定是立即找工人执行、放进队列等待，还是拒绝这项工作。

![图 1：ThreadPoolExecutor 的核心组成与职责](java-thread-pool-component-map.svg)

它最常见的完整构造器有七个参数：

```java
new ThreadPoolExecutor(
        corePoolSize,
        maximumPoolSize,
        keepAliveTime,
        unit,
        workQueue,
        threadFactory,
        handler
);
```

| 参数 | 大白话解释 | 常见注意点 |
|---|---|---|
| `corePoolSize` | 常驻工人数 | 即使暂时没活，也通常保留这些线程 |
| `maximumPoolSize` | 最多能扩到多少人 | 只有队列满了才有机会扩容 |
| `keepAliveTime` | 非核心工人的空闲回收时间 | 默认只回收超过核心数的线程 |
| `unit` | 时间单位 | 一般写 `TimeUnit.SECONDS` |
| `workQueue` | 等待区 | 队列类型决定了最大线程数是否真正生效 |
| `threadFactory` | 招聘规则 | 至少要给线程起可检索的名字 |
| `handler` | 满载时的处理规则 | 不能只用默认策略而不理解后果 |

一个容易误解的点是：`maximumPoolSize` 并不是「线程池一启动就创建这么多线程」。线程池的扩容要经过工作队列这个关口，下一节的执行流程才是理解参数关系的钥匙。

---

## 三、`execute()` 到底怎么做决定

假设调用方执行：

```java
executor.execute(() -> doBusiness());
```

`ThreadPoolExecutor` 的源码很长，但决策顺序可以压缩为四步：

![图 2：ThreadPoolExecutor 的 execute 决策流程](java-thread-pool-execute-flow.svg)

1. **当前线程数小于核心线程数**：直接新建核心线程执行任务，即使有空闲线程也优先保证核心人数。
2. **核心线程已满**：尝试把任务放入工作队列。放进去就等待已有工人领取。
3. **队列也满了**：如果当前线程数还小于最大线程数，就新建非核心线程来救场。
4. **线程数已经到顶**：调用拒绝策略，绝不能再无限创建线程。

可以用接近源码的伪代码记住这个顺序：

```java
if (workerCount < corePoolSize) {
    addWorker(task, true);               // 先补核心线程
} else if (workQueue.offer(task)) {
    // 队列能放下，等待已有 worker 领取
} else if (workerCount < maximumPoolSize) {
    addWorker(task, false);              // 队列满了才扩非核心线程
} else {
    reject(task);                        // 线程和队列都满了
}
```

**一句话：先核心线程，再队列，再最大线程，最后拒绝。**

很多配置错误都来自把顺序记反。例如“我把最大线程数设成 200，应该能抗住 200 个并发吧？”未必。如果前面放了一个几乎无限大的队列，任务永远能入队，流程就永远停在第二步，线程数可能一直只有核心线程数。

### 3.1 提交成功，不代表任务已经成功

`execute()` 没抛异常，最多说明线程池**接收了任务**：它可能正在运行，也可能还躺在队列里。真正业务异常发生在工作线程中时，`execute()` 的任务会交给线程的 `UncaughtExceptionHandler`；而 `submit()` 会把异常装进 `Future`，只有调用 `future.get()` 才能看到。

```java
executor.submit(() -> {
    throw new IllegalStateException("下游服务返回异常");
});

// 如果没有 get()，这个异常很容易被业务代码悄悄忽略
```

所以异步任务必须有自己的日志、告警和结果处理策略，不能把“提交成功”当作“业务成功”。

---

## 四、工作队列和拒绝策略：线程池的安全阀

### 4.1 三种常见工作队列

**`ArrayBlockingQueue`：固定容量的有界队列**

```java
BlockingQueue<Runnable> queue = new ArrayBlockingQueue<>(500);
```

容量在创建时确定，内存边界清晰。它很适合 Web 请求、消息消费这类必须控制积压量的任务；队列满后，线程池才会继续扩到 `maximumPoolSize`。

**`LinkedBlockingQueue`：链表队列，默认容量很大**

```java
BlockingQueue<Runnable> queue = new LinkedBlockingQueue<>();
```

无参构造的容量是 `Integer.MAX_VALUE`，业务高峰时任务会不断堆积，最终可能因为堆内存不足而崩溃。更隐蔽的是，队列通常不会满，最大线程数和拒绝策略几乎没有参与机会。若要使用它，必须显式给出容量：

```java
BlockingQueue<Runnable> queue = new LinkedBlockingQueue<>(500);
```

**`SynchronousQueue`：不存任务，只做直接交接**

它没有内部容量。提交一个任务必须立刻有线程接手，否则就尝试创建新线程；没有空闲线程且到达最大线程数时立即拒绝。`newCachedThreadPool()` 使用的就是它，因此流量失控时会疯狂扩线程，不适合直接用于无边界的线上请求。

![图 3：无界队列与有界队列的保护边界对比](java-thread-pool-queue-comparison.svg)

### 4.2 四种内置拒绝策略

| 策略 | 行为 | 适合什么场景 |
|---|---|---|
| `AbortPolicy` | 抛出 `RejectedExecutionException` | 必须让调用方感知过载，默认推荐 |
| `CallerRunsPolicy` | 提交任务的线程自己执行 | 可接受调用方变慢，形成天然背压 |
| `DiscardPolicy` | 静默丢弃新任务 | 允许丢失且有独立补偿机制的低价值任务 |
| `DiscardOldestPolicy` | 丢弃队列最老任务，再重试提交 | 极少直接使用，容易误丢关键任务 |

生产里常见的做法不是只选一种内置策略，而是包装一个带业务日志和指标的拒绝处理器：

```java
RejectedExecutionHandler handler = (task, executor) -> {
    System.err.printf(
            "任务被拒绝：pool=%s, active=%d, queue=%d%n",
            executor,
            executor.getActiveCount(),
            executor.getQueue().size()
    );
    throw new RejectedExecutionException("业务线程池已满");
};
```

拒绝不是线程池“坏了”，而是系统把过载信号明确地交给了上游。对于 HTTP 服务，可以映射为“系统繁忙，请稍后重试”；对于消息消费，可以触发延迟重试或转入死信队列。关键是：**必须让业务知道任务没有被执行。**

---

## 五、生产环境怎样创建线程池

不要把 `Executors.newFixedThreadPool()` 当作生产默认答案。它内部使用无界 `LinkedBlockingQueue`；`Executors.newCachedThreadPool()` 的最大线程数接近无上限。它们适合测试或容量已被外层严格约束的场景，却不适合作为公共服务的第一选择。

下面是一个可直接复用的业务线程池工厂：

```java
package com.frank.concurrent.ch05;

import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

public final class BizExecutor {

    private BizExecutor() {
    }

    public static ThreadPoolExecutor create() {
        AtomicInteger sequence = new AtomicInteger(1);
        ThreadFactory factory = runnable -> {
            Thread thread = new Thread(runnable);
            thread.setName("biz-worker-" + sequence.getAndIncrement());
            thread.setUncaughtExceptionHandler((t, error) ->
                    System.err.println(t.getName() + " 执行任务失败：" + error.getMessage())
            );
            return thread;
        };

        return new ThreadPoolExecutor(
                8,
                16,
                60,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(500),
                factory,
                (task, executor) -> {
                    System.err.printf(
                            "线程池满载：active=%d, poolSize=%d, queueSize=%d%n",
                            executor.getActiveCount(),
                            executor.getPoolSize(),
                            executor.getQueue().size()
                    );
                    throw new RejectedExecutionException("biz executor is overloaded");
                }
        );
    }
}
```

这段配置的每一项都对应一个明确的工程目标：

- `8` 个核心线程保证稳定吞吐；高峰时可临时扩到 `16`。
- 容量 `500` 的有界队列限制内存占用，也让扩容和拒绝策略真正有机会生效。
- 线程名 `biz-worker-*` 能让日志、线程栈和监控平台快速定位任务来源。
- 拒绝时记录活跃线程和队列长度，再把异常抛回调用方，避免任务无声消失。

### 5.1 用完要优雅关闭

服务停止时，线程池不能直接“断电”。先停止接收新任务，再等待已提交任务完成；超过最长等待时间才中断剩余任务。

```java
public static void shutdownGracefully(ThreadPoolExecutor executor) {
    executor.shutdown();
    try {
        if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
            executor.shutdownNow();
        }
    } catch (InterruptedException e) {
        executor.shutdownNow();
        Thread.currentThread().interrupt();
    }
}
```

`shutdown()` 不再接收新任务，但会执行队列中已有任务；`shutdownNow()` 会尝试中断正在运行的任务，并返回未开始的任务。任务内部如果执行阻塞 I/O 或长循环，也要正确响应中断，否则“优雅关闭”依然会拖很久。

---

## 六、参数怎么调：先分任务，再看数据

不存在适合所有服务的“万能线程数公式”。先判断任务主要消耗什么资源，再通过压测和监控校正。

### 6.1 CPU 密集型

例如图片计算、复杂 JSON 转换、加解密、规则匹配。这类任务长时间占用 CPU，线程数通常接近 CPU 核数：

```text
线程数 ≈ CPU 核数 + 1
```

线程远多于核心数只会增加上下文切换，吞吐反而可能下降。可先用 `Runtime.getRuntime().availableProcessors()` 作为起点，再用真实压测确定。

### 6.2 I/O 密集型

例如访问数据库、调用远程 HTTP、读写文件。线程大量时间在等待 I/O，可以比 CPU 核数多一些。常见估算是：

```text
线程数 ≈ CPU 核数 × (1 + 等待时间 / 计算时间)
```

它只是估算起点，不是固定答案。下游数据库连接池只有 20 条连接时，即使开 200 个线程，大量工作线程也只是在等待连接，反而放大超时和雪崩。

### 6.3 监控比公式更重要

给每个关键线程池至少观测这些指标：

- `poolSize`、`activeCount`：现有多少工人、多少正在干活。
- `queue.size()`、队列剩余容量：任务是否持续积压。
- `completedTaskCount`：单位时间完成量是否下降。
- 拒绝次数和任务执行耗时：是否已经发生过载或慢任务。

调优时一次只改少数参数，用相同流量压测比较延迟、吞吐、拒绝率和下游负载。只看 CPU 利用率，往往会错过已经在队列里排到超时的任务。

---

## 七、五个高频坑

### 7.1 无界队列让内存和延迟一起失控

无界队列看起来“从不拒绝”，实际上是把拒绝延后成更难处理的 OOM 或请求长时间排队。队列容量要依据可接受的积压时间、单个任务内存和峰值流量计算，并准备过载响应。

### 7.2 在线程池任务里再等待同一个线程池

```java
// pool 只有一个线程时，这段代码会等待永远不会开始的子任务
Future<Integer> child = pool.submit(() -> 42);
Integer value = child.get();
```

当父任务占满线程池，又同步等待同一个池里的子任务时，就会形成线程池死锁。解决思路是合并任务、使用另一个有独立容量的线程池，或改成异步组合而非阻塞等待。

### 7.3 `ThreadLocal` 不清理，在线程复用下串数据

线程池线程会被反复使用。上一个请求留下的 `ThreadLocal` 值，可能被下一个请求读到，也可能长期占住内存。第三篇讲过这个问题，正确写法永远是 `finally` 清理：

```java
try {
    USER_CONTEXT.set(userId);
    doBusiness();
} finally {
    USER_CONTEXT.remove();
}
```

### 7.4 把异步异常悄悄吞掉

对 `submit()` 返回的 `Future` 不做 `get()`、不加回调，也没有统一的日志记录，就等于允许任务失败而业务毫无察觉。关键任务要定义结果、重试和告警路径。

### 7.5 所有任务共用一个大线程池

报表导出、第三方接口、短信发送和核心下单任务的耗时与优先级不同。共用一个池时，慢报表可能挤占所有线程，拖垮核心链路。应按业务隔离线程池，并让每个池都有独立的容量和监控指标。

> **思考与练习**
>
> 1. 把第五节的 `ArrayBlockingQueue<>(500)` 改成无参 `LinkedBlockingQueue`，连续提交大量慢任务，观察线程数、队列长度与拒绝策略是否还会触发。
> 2. 假设服务有 8 个 CPU 核、一次远程调用平均等待 80ms、业务计算 20ms。用第六节估算一个初始线程数，再说明为什么还需要受数据库连接池限制。
> 3. 你的系统中哪些任务允许调用方执行，哪些任务必须快速失败？为它们分别选择拒绝策略并说明原因。

---

## 八、面试速答（浓缩版）

**Q：线程池提交任务的执行顺序是什么？**  
A：当前线程数小于核心线程数时直接创建核心线程；否则任务入队；队列满且线程数小于最大线程数时创建非核心线程；线程和队列都满时执行拒绝策略。

**Q：为什么最大线程数经常不生效？**  
A：因为线程池先尝试入队。使用无界 `LinkedBlockingQueue` 时，任务几乎总能入队，永远到不了“队列满后扩容”的步骤，所以线程数通常只增长到核心线程数。

**Q：`execute()` 和 `submit()` 有什么区别？**  
A：`execute()` 只接收 `Runnable`，任务异常会交给线程的未捕获异常处理器；`submit()` 返回 `Future`，异常被封装，调用 `get()` 或设置回调后才能感知，还可以提交有返回值的 `Callable`。

**Q：为什么不建议直接使用 `Executors` 创建线程池？**  
A：固定线程池默认无界队列，缓存线程池最大线程数接近无上限，流量失控时分别可能造成 OOM 或线程爆炸。生产环境应显式构造 `ThreadPoolExecutor`，写清容量、线程工厂和拒绝策略。

**Q：线程池优雅关闭的正确步骤？**  
A：先调用 `shutdown()` 停止接收新任务并等待已提交任务；超过等待时间再调用 `shutdownNow()` 尝试中断，同时在捕获 `InterruptedException` 后恢复中断标记。

---

## 结语

线程池的价值不在于把 `new Thread()` 换成一个 API，而在于给系统划出一条资源边界：

```text
核心线程    → 稳定吞吐
有界队列    → 有限积压
最大线程数  → 峰值缓冲
拒绝策略    → 明确过载信号
监控与关闭  → 可观测、可恢复
```

真正可靠的配置从来不是一组神秘数字，而是围绕业务目标做出的取舍：任务能等多久、系统最多能积压多少、下游能承受多大并发、过载时谁来感知并处理失败。

系列阅读：

1. {% post_link articles/Java/01-java-multithreading-fundamentals '基础与核心概念' %}
2. {% post_link articles/Java/02-java-thread-safety-and-mutex '线程安全与互斥' %}
3. {% post_link articles/Java/03-java-inter-thread-communication '线程间通信与协作' %}
4. {% post_link articles/Java/04-java-concurrent-hashmap 'ConcurrentHashMap 为什么又快又安全' %}
5. 本篇：线程池
