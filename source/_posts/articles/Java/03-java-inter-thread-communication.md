---
title: Java 多线程从零到一（03）：线程间通信与协作
date: 2026-08-17 14:20:00
categories:
  - 教程
tags:
  - Java
  - 多线程
  - 并发编程
description: 用大白话讲清楚 wait/notify 的"等待-唤醒"机制、join 的"等兄弟干完活"、ThreadLocal 的"每人一个抽屉"，含生产者-消费者完整实战。
lang: zh-CN
---

> 本文是《Java 多线程从零到一》系列第 03 篇，初级篇收官。前两篇讲了"怎么创建线程"和"怎么保证线程安全"，这一篇讲**多个线程怎么互相配合干活**。

---

## 一、wait() / notify() / notifyAll() 机制

### 1.1 为什么需要"等待-唤醒"？

想象一个场景：

- **厨师**（生产者）做好菜放到传菜台上
- **服务员**（消费者）从传菜台上取菜送出去

传菜台容量有限（比如只能放 3 盘菜）：

- 台子满了，厨师不能再放 → 厨师**等待**
- 台子空了，服务员不能取 → 服务员**等待**
- 厨师放了一盘菜 → **通知**服务员"有菜了"
- 服务员取走一盘菜 → **通知**厨师"有空位了"

这种"条件不满足就等，条件满足了就叫醒对方"的机制，就是 `wait() / notify()` 要解决的问题。

### 1.2 基本用法和铁律

```java
synchronized (lock) {           // 铁律①：必须在 synchronized 里面
    while (条件不满足) {         // 铁律②：必须用 while 判断，不能用 if
        lock.wait();            // 释放锁，进入等待；被唤醒后从这里继续
    }
    // ... 干活 ...
    lock.notifyAll();           // 唤醒所有等待的线程，让它们重新检查条件
}
```

**为什么要加 `synchronized`？** `wait()` 的语义是"释放锁、去等待"——你都没拿锁，谈何释放？没锁直接调 `wait()` 会抛 `IllegalMonitorStateException`。

**为什么用 `while` 不用 `if`？** 被唤醒后，条件可能又被别的线程改了（唤醒到你重新抢到锁之间有时间差）。`while` 会重新检查条件，不满足就继续等；`if` 只检查一次，醒来就往下走，容易出错。

**为什么用 `notifyAll()` 不用 `notify()`？** `notify()` 只随机叫醒一个，可能叫醒的是"不需要醒"的那个（比如叫醒的还是厨师，但台上已经满了）。`notifyAll()` 叫醒所有人各自检查，保证不漏。多花一点 CPU，换安全，值。

### 1.3 底层原理：两个"等候区"

每个对象的锁背后有两个等候区：

![图7：对象监视器——EntrySet 与 WaitSet 的协作](/images/svg/java-monitor-wait-notify.svg)

- **EntrySet（锁池）**：想抢锁但没抢到的线程，在这里排队（BLOCKED 状态）
- **WaitSet（等待池）**：调了 `wait()` 的线程在这里睡觉（WAITING 状态）

流程：

1. 线程调 `wait()` → 释放锁，从"持锁"进入 WaitSet 睡觉
2. 另一个线程调 `notifyAll()` → 把 WaitSet 里所有人都叫醒，挪到 EntrySet 排队抢锁
3. 抢到锁的那个，从 `wait()` 调用处继续往下执行

### 1.4 实战：生产者-消费者模型

用 `wait/notifyAll` 实现一个"有界消息队列"——满了生产者等，空了消费者等：

```java
package com.frank.concurrent.ch03;

import java.util.ArrayDeque;
import java.util.Queue;

public class MessageQueue<T> {

    private final Queue<T> queue = new ArrayDeque<>();
    private final int capacity;   // 队列容量上限

    public MessageQueue(int capacity) {
        this.capacity = capacity;
    }

    /** 生产者调用：往队列里放数据，满了就等 */
    public synchronized void put(T item) throws InterruptedException {
        while (queue.size() == capacity) {
            wait();   // 满了：释放锁，等消费者取走后再叫醒我
        }
        queue.add(item);
        System.out.println("[" + Thread.currentThread().getName() + "] 放入 " + item
                + "，长度=" + queue.size());
        notifyAll();  // 通知消费者：有数据了
    }

    /** 消费者调用：从队列里取数据，空了就等 */
    public synchronized T take() throws InterruptedException {
        while (queue.isEmpty()) {
            wait();   // 空了：释放锁，等生产者放入后再叫醒我
        }
        T item = queue.poll();
        System.out.println("[" + Thread.currentThread().getName() + "] 取出 " + item
                + "，剩余=" + queue.size());
        notifyAll();  // 通知生产者：有空位了
        return item;
    }
}
```

测试：

```java
package com.frank.concurrent.ch03;

public class ProducerConsumerDemo {

    public static void main(String[] args) throws InterruptedException {
        MessageQueue<String> queue = new MessageQueue<>(3);   // 容量 3

        // 生产者：每 60ms 生产一条
        Thread producer = new Thread(() -> {
            try {
                for (int i = 1; i <= 5; i++) {
                    Thread.sleep(60);
                    queue.put("消息-" + i);
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "生产者");

        // 消费者：每 150ms 消费一条（比生产慢，队列会打满，生产者会等待）
        Thread consumer = new Thread(() -> {
            try {
                for (int i = 1; i <= 5; i++) {
                    Thread.sleep(150);
                    queue.take();
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }, "消费者");

        producer.start();
        consumer.start();
        producer.join();
        consumer.join();
        System.out.println("全部完成");
    }
}
```

某次输出：
```
[生产者] 放入 消息-1，长度=1
[生产者] 放入 消息-2，长度=2
[生产者] 放入 消息-3，长度=3
[消费者] 取出 消息-1，剩余=2
[生产者] 放入 消息-4，长度=3
[消费者] 取出 消息-2，剩余=2
...
全部完成
```

### 1.5 wait() vs sleep() 对比

| 维度 | `wait()` | `sleep()` |
|------|----------|-----------|
| 释放锁 | **释放**（让别人能干活） | **不释放**（抱着锁睡） |
| 唤醒条件 | `notify()/notifyAll()` 或中断或超时 | 时间到或中断 |
| 使用前提 | 必须在 `synchronized` 里 | 没有锁要求 |
| 典型用途 | 线程协作（等数据/等空位） | 单纯暂停一会儿 |

一句话：**`wait` 是"等通知"（把锁让出去），`sleep` 是"睡一觉"（锁不离手）**。

> **常见误区提醒**
>
> - 用 `if` 判断等待条件是最常见的错误——醒来后必须重新检查条件，**永远用 `while`**。
> - `notify()` 之后锁不会立刻移交——当前线程把同步块走完才释放，被叫醒的线程只是获得了"竞争资格"。

---

## 二、join() 与 yield()

### 2.1 join()：等子线程干完再继续

**场景**：主线程启动了 4 个子线程分头算数据，接下来要汇总——必须等它们全部完成。

`t.join()` 的意思就是："当前线程在这里等，直到 t 结束"。

```java
package com.frank.concurrent.ch03;

public class JoinDemo {

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            try {
                Thread.sleep(1000);   // 干 1 秒的活
                System.out.println("子线程干完了");
            } catch (InterruptedException ignored) { }
        }, "worker");

        worker.start();
        System.out.println("主线程等子线程...");
        worker.join();   // 阻塞，直到 worker 结束
        System.out.println("主线程继续");
    }
}
```

输出：
```
主线程等子线程...
子线程干完了
主线程继续
```

`join()` 还可以加超时参数：`join(1000)` 表示最多等 1 秒，超时就放弃（子线程可能还活着）。

**原理小知识**：`join()` 内部其实是调 `wait()`——在被等的线程对象上等待，线程结束时 JVM 会自动调 `notifyAll()` 唤醒等待者。所以 join 和 wait 一样响应中断。

### 2.2 实战：主线程等多个子线程后汇总

```java
package com.frank.concurrent.ch03;

import java.util.Arrays;

public class ParallelSum {

    public static void main(String[] args) throws InterruptedException {
        int n = 1_000_000;   // 算 1 到 100 万的和
        long expected = (long) n * (n + 1) / 2;   // 数学公式做校验

        // 分成 4 段，4 个线程各算一段，结果放到数组各自的槽位里
        long[] partial = new long[4];
        int step = n / 4;
        Thread[] workers = new Thread[4];

        for (int i = 0; i < 4; i++) {
            final int idx = i;
            final int from = idx * step + 1;
            final int to = (idx == 3) ? n : (idx + 1) * step;
            workers[i] = new Thread(() -> {
                long sum = 0;
                for (int k = from; k <= to; k++) {
                    sum += k;
                }
                partial[idx] = sum;   // 各写各的槽位，互不干扰
            });
            workers[i].start();
        }

        // 等全部干完再汇总
        for (Thread t : workers) t.join();
        long total = Arrays.stream(partial).sum();

        System.out.println("期望值：" + expected);
        System.out.println("并行结果：" + total);
    }
}
```

输出：
```
期望值：5000000500000
并行结果：5000000500000
```

每个线程写 `partial` 数组的不同位置，天然没有竞争；`join()` 之后汇总——这是并行计算最基础的"分治"骨架。

### 2.3 yield()：让出 CPU 时间片

`Thread.yield()` 是个"提示"：告诉调度器"我愿意让出当前时间片"。但仅仅是提示——调度器可以完全无视。

关键点：

- **不释放锁**（和 `wait` 的本质区别）
- **效果不确定**：让出后可能立刻又被调度上来了
- **实际开发几乎不用**，需要确定性协作请用 `join` / `wait` / 锁

> **思考与练习**
>
> 1. 把 `ParallelSum` 里的 `partial` 数组换成一个普通的 `long total` 变量，每个线程直接 `total += k`，不加任何同步——跑几次看结果对不对，为什么？
> 2. 把 `worker.join()` 移到 `worker.start()` 后紧邻的位置（启动一个等一个），输出会变成什么？还有并行效果吗？

---

## 三、ThreadLocal：线程局部变量

### 3.1 ThreadLocal 是干什么的？

**场景**：Web 应用里，Controller 拿到当前登录用户信息后，深层的业务代码也需要用户 ID——难道要一层层传参数？太麻烦了。

`ThreadLocal` 给每个线程一个**独立的副本**：同一个 `ThreadLocal` 变量，每个线程看到自己的那份值，互不干扰。

打个比方：`ThreadLocal` 就像给每个员工发一个**私人抽屉**——大家都在同一个办公室（同一个类、同一个静态变量），但各自往自己抽屉里放东西、取东西，永远不会拿错。

### 3.2 基本用法

```java
// 定义：通常做成 static final
private static final ThreadLocal<String> USER = new ThreadLocal<>();

// 存值（只对当前线程可见）
USER.set("张三");

// 取值（拿到的是当前线程自己存的那份）
String user = USER.get();

// 用完清理（在线程池场景必须做！）
USER.remove();
```

### 3.3 原理简述

`ThreadLocal` 的实现思路是**反过来存**：

- 每个 `Thread` 对象内部有一个 `ThreadLocalMap`（可以理解为线程私有的一个小哈希表）
- 你调 `USER.set("张三")` 时，实际是往**当前线程的** Map 里存了一条记录，键是 `USER` 这个对象，值是 "张三"
- 你调 `USER.get()` 时，是从**当前线程的** Map 里取

因为 Map 是线程私有的，所以各线程互不干扰——这就是"线程隔离"的全部秘密。

![图8：ThreadLocalMap 的弱引用 key 与强引用 value 的泄漏路径](/images/svg/java-threadlocal-structure.svg)

### 3.4 内存泄漏问题：为什么要 remove()？

上图的 Entry 里，**key 是弱引用**（GC 会回收），**value 是强引用**（GC 不会回收）。

当外部不再使用某个 `ThreadLocal` 对象时：

1. key 被 GC 回收，变成 null
2. 但 value 还被 `Thread → Map → Entry → value` 这条强引用链拽着，无法回收
3. 如果线程活得很久（**线程池里的线程几乎永生**），这些"僵尸 value"会越积越多

**解决办法很简单：用完必须在 `finally` 里调 `remove()`**：

```java
try {
    USER.set(currentUser);
    // ... 业务逻辑 ...
} finally {
    USER.remove();   // 线程池场景的保命操作
}
```

不 remove 的另一个坑：**下一个复用这个线程的任务会读到上一个任务残留的值**——"用户 A 的请求看到了用户 B 的数据"就是这么来的。

### 3.5 InheritableThreadLocal：父传子

普通 `ThreadLocal` 父子线程互不相通。想让**创建子线程时**把父线程的值传过去，用 `InheritableThreadLocal`：

```java
static final InheritableThreadLocal<String> CTX = new InheritableThreadLocal<>();

public static void main(String[] args) throws InterruptedException {
    CTX.set("主线程的值");
    Thread child = new Thread(() -> {
        System.out.println("子线程读到：" + CTX.get());   // 能拿到
    });
    child.start();
    child.join();
}
```

输出：
```
子线程读到：主线程的值
```

注意：值是在**创建子线程那一刻**复制过去的，之后父线程再改，子线程看不到。线程池场景（线程提前创建、反复复用）下这个机制基本失效，生产要用阿里的 TransmittableThreadLocal（TTL）。

### 3.6 实战：Web 应用传递用户上下文

模拟一个 Web 请求的处理流程：Filter 设置用户 → 业务层读取 → finally 清理：

```java
package com.frank.concurrent.ch03;

public class UserContextDemo {

    static final ThreadLocal<String> CURRENT_USER = new ThreadLocal<>();

    // 模拟 Filter：请求进来设置用户，结束必须清理
    static void handleRequest(String user, Runnable business) {
        try {
            CURRENT_USER.set(user);
            business.run();
        } finally {
            CURRENT_USER.remove();   // ★ 保命操作：清理干净，防止串号
        }
    }

    // 业务代码：不用传参，直接读上下文
    static void createOrder() {
        System.out.printf("[%s] 创建订单，操作人：%s%n",
                Thread.currentThread().getName(), CURRENT_USER.get());
    }

    public static void main(String[] args) throws InterruptedException {
        // 3 个"请求"，2 个处理线程（模拟线程池复用）
        Runnable[] requests = {
            () -> handleRequest("张三", UserContextDemo::createOrder),
            () -> handleRequest("李四", UserContextDemo::createOrder),
            () -> handleRequest("王五", UserContextDemo::createOrder),
        };

        Thread t1 = new Thread(requests[0], "http-1");
        Thread t2 = new Thread(requests[1], "http-2");
        t1.start(); t1.join();
        t2.start(); t2.join();

        // 第三个请求复用 t1 的身份（重新起线程模拟）
        Thread t3 = new Thread(requests[2], "http-1");
        t3.start(); t3.join();
    }
}
```

输出：
```
[http-1] 创建订单，操作人：张三
[http-2] 创建订单，操作人：李四
[http-1] 创建订单，操作人：王五
```

`http-1` 处理了两个不同用户的请求，没有串号——`finally` 里的 `remove()` 功不可没。把 `remove()` 注释掉再跑，第三个请求大概率打出"张三"的残留值——亲手复现一次"串号事故"。

> **常见误区提醒**
>
> - **ThreadLocal 不是用来解决线程安全的**——它是把"共享"变成"不共享"。该加锁的还得加锁。
> - 大对象放进 ThreadLocal 不 remove，在线程池里等于"永久租用"，内存慢慢泄漏。
> - `InheritableThreadLocal` 遇到线程池就失效（只在创建时复制一次），别在池化环境依赖它。

> **思考与练习**
>
> 1. 写代码验证：两个线程对同一个 `ThreadLocal` set 不同值、各自 get，互相看不到。
> 2. 把实战代码里的 `remove()` 注释掉，第三个请求会打出谁的名字？为什么？
> 3. 面试题：ThreadLocal 的 key 为什么设计成弱引用？（提示：如果 key 是强引用，ThreadLocal 对象本身也会被永久拽住，连"顺路清理"的判断条件都没了。）

---

## 初级篇收官

三篇初级篇串成一条线：

```
第 01 篇  线程是什么 ──> 创建、启动、停止
第 02 篇  共享的代价 ──> 竞态条件 + 三大解药（锁、volatile、原子类）
第 03 篇  协作的艺术 ──> 等待/唤醒 + join + ThreadLocal
```

你已经具备了阅读并发代码、排查常见问题的地基：

- 能看懂 jstack 里的线程状态
- 能解释 `count++` 为什么会丢数据
- 能写出不会假死的生产者-消费者
- 知道线程池里为什么必须 `remove()`

真实项目里你很少裸写这些——大家都站在 JUC（`java.util.concurrent`）的肩膀上：线程池怎么配参数？`ConcurrentHashMap` 为什么又快又安全？`CompletableFuture` 怎么编排异步任务？这些是"进阶篇"的内容。地基已打好，欢迎继续。

