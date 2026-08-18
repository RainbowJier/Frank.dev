---
title: Java 多线程从零到一（01）：基础与核心概念
date: 2026-08-17 14:00:00
categories:
  - 教程
tags:
  - Java
  - 多线程
  - 并发编程
description: 用大白话讲清楚线程是什么、从哪来、怎么创建、怎么安全地停止——专为对多线程感到头疼的同学准备。
lang: zh-CN
---

> 本文是《Java 多线程从零到一》系列第 01 篇。全系列目标是**让你彻底搞懂 Java 并发**，不堆术语，先讲"为什么"再讲"怎么做"。
>
> 系列目录：1. 基础与核心概念（本篇）→ 2. 线程安全与互斥 → 3. 线程间通信与协作

## 工程准备

本系列所有代码放在同一个 Maven 工程，后面两篇直接往里加文件。

```
java-concurrency-lab/
├── pom.xml
└── src/main/java/com/frank/concurrent/
    ├── ch01/   ← 本篇代码
    ├── ch02/
    └── ch03/
```

`pom.xml`（Java 17，其他版本 8+ 均可运行本篇代码）：

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 http://maven.apache.org/xsd/maven-4.0.0.xsd">
    <modelVersion>4.0.0</modelVersion>
    <groupId>com.frank</groupId>
    <artifactId>java-concurrency-lab</artifactId>
    <version>1.0.0</version>
    <properties>
        <maven.compiler.release>17</maven.compiler.release>
        <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
    </properties>
</project>
```

编译 + 运行：`mvn -q compile && java -cp target/classes com.frank.concurrent.ch01.类名`

---

## 一、并发与并行的历史演进

### 1.1 单核时代：一个 CPU 怎么"同时"干好几件事？

想象一家小饭馆只有一个服务员，他要同时照顾三桌客人。他当然不能真的分身站在三桌，但他可以**来回快速切换**：给 A 桌倒水 → 跑去 B 桌记菜 → 给 C 桌上菜 → 再回 A 桌……只要切换够快，客人就会觉得他"同时"在服务大家。

这就是单核 CPU 的工作方式，术语叫**时间片轮转**：每个程序轮流用一小段 CPU 时间，切换很快，看起来像"同时运行"，但本质上还是一个个来。

```
单核 CPU 时间轴：
|-- 程序A --|-- 程序B --|-- 程序A --|-- 程序C --|--> 时间
```

### 1.2 多核时代：真的能同时干活了

饭馆生意好了，老板雇了 4 个服务员，每人专门盯一桌。现在 4 桌客人是**真的同时**被服务的，不需要谁来回跑。这就是多核 CPU——多个核心真的能在同一时刻分别执行不同的任务。

这里要分清两个总被搞混的词：

- **并发（Concurrency）**：一段时间内处理多件事，但不一定是同时发生（一个服务员跑多桌）。
- **并行（Parallelism）**：同一时刻真的在同时做多件事（多个服务员各守一桌）。

记住一句话：**单核只能"并发"，多核才能"并行"**。8 核 CPU 最多同时真正跑 8 个任务，多出来的还是要排队轮转。

### 1.3 为什么会有"线程"？进程哪里不够用

最早操作系统里只有**进程（Process）**：每个运行中的程序就是一个进程，各自拥有独立的内存空间，谁也不挨着谁——就像一栋一栋的独立别墅，家家户户互不干扰。

但独立别墅有个问题：**盖房子太慢、太费资源**。放到进程上就是：

- **创建慢**：要单独分配一整块内存空间，开销大；
- **切换慢**：从一个进程切到另一个，相当于"搬家"，要把状态整个换一遍；
- **通信麻烦**：两个进程之间不能直接说话，交换数据得走专门的通道（管道、消息队列等），费劲。

而很多场景需要**大量、轻量的并发单元**——比如一个网站服务器同时处理几千个用户请求，要是每个请求都开一个进程，机器早就扛不住了。

于是**线程（Thread）**出现了：它是进程内部的一个"执行流"。同一个进程里的多个线程**共享这个进程的所有资源**（可以理解成一栋别墅里住的一家人，共享客厅厨房），但每个线程有自己独立的一小块"卧室"（私有栈）。

好处很明显：

- 创建线程只需要分配一个小卧室，比盖一栋别墅快得多；
- 线程切换不用大搬家，只换一下"当前执行到哪了"的记录，很轻量；
- 线程间通信 = 直接读写共享的东西，零成本。

但天下没有免费的午餐——"一家人共享客厅"也意味着：**如果大家同时抢着用同一个东西，就会打起来**。这正是下一篇要讲的线程安全问题的根源。

### 1.4 Java 线程小历史：从"假线程"到"真线程"

Java 从第一个版本就自带多线程能力，但一开始的实现有点像"障眼法"：

- **JDK 1.0 的绿色线程**：这些线程完全由 Java 自己模拟调度，操作系统根本不知道它们存在。问题是：不管开多少个绿色线程，它们全部只能用**同一个** CPU 核心，多核机器上根本用不上剩下的核；而且一旦某个线程去等磁盘或网络（阻塞），其他所有线程会一起被拖住。
- **JDK 1.2 起换成真正的操作系统线程**：每个 Java 线程直接对应一个操作系统线程，由系统调度器统一安排。从这时起，Java 多线程才算真的能用上多核，一个线程阻塞也不会连累其他线程。

### 1.5 Java 并发的发展简史

一张图看懂 Java 并发 API 是怎么一步步长成现在这样的：

![图1：Java 并发 API 演进时间线](/images/svg/java-concurrency-evolution-timeline.svg)

| 版本 | 年份 | 大事件 |
|------|------|--------|
| JDK 1.0 | 1996 | `Thread`、`synchronized`、`wait/notify` 诞生（绿色线程） |
| JDK 1.2 | 1998 | 换成操作系统原生线程，真正能用多核 |
| JDK 1.5 | 2004 | JUC 并发工具包上线：线程池、锁、原子类、并发容器 |
| JDK 1.8 | 2014 | 并行流、`CompletableFuture`，写并发代码更像"搭积木" |
| JDK 21 | 2023 | 虚拟线程登场，一台机器轻松扛住百万级并发 |

从这条时间线能看出一个规律：**Java 并发的进化方向，一直是"让程序员少操心底层细节"**——从最开始手写 `Thread` + 锁，到用线程池自动管理，到用声明式的 `CompletableFuture` 编排任务，越往后越省心。这也是为什么本系列会先带你搞懂"手动挡"（本篇到第 03 篇），再在进阶篇学"自动挡"。

> **常见误区提醒**
>
> - **并发不等于并行**：8 核机器上开 800 个线程，任何瞬间最多 8 个真的在跑，剩下的都在排队。线程越多不代表越快，切换本身也要花时间。
> - **多线程不是万能加速器**：CPU 密集型任务（纯计算）线程数超过核数没有意义，只会增加切换开销；多线程真正的强项是"I/O 密集型"任务——等网络、等磁盘的时候，把 CPU 让给别人用。

---

## 二、进程与线程的本质区别（Java 视角）

### 2.1 一个好用的比喻

- **进程** = 一家公司，有自己独立的办公室（内存空间）、资产（文件、网络连接）、账号（权限）。
- **线程** = 公司里的员工，共享公司的资源（会议室、打印机、代码仓库），各自有自己的工位（私有栈）。

员工之间交流很方便，直接开口说话就行（共享内存，读写速度极快）。但也正因为大家共享资源，如果两个员工同时修改同一份文件，就可能写出乱码——这就是"线程安全"问题的根源，第 02 篇重点解决这个。

### 2.2 进程 vs 线程对比

| 维度 | 进程 | 线程 |
|------|------|------|
| 内存空间 | 独立，互相隔离 | 共享所在进程的内存 |
| 创建开销 | 大（要分配一整块地址空间） | 小（只需分配私有栈） |
| 切换开销 | 大（要整体换状态，刷 CPU 缓存） | 小（只换寄存器和栈指针） |
| 通信方式 | 需要专门 IPC 机制（管道/消息队列等） | 直接读写共享变量（快但要小心） |
| 健壮性 | 一个进程崩溃不影响其他进程 | 一个线程崩溃可能让整个进程挂掉 |

### 2.3 Java 进程里的内存是怎么分布的

一个 JVM 进程的内存主要分成这几块（JDK 8 起的视角）：

- **堆（Heap）**：存放你 `new` 出来的对象——**所有线程共享**。这是并发问题的"战场"。
- **方法区 / 元空间**：存放类的定义、常量——**所有线程共享**。
- **虚拟机栈**：每个线程单独一份，存放方法调用和局部变量——**线程私有，天然安全**。
- **程序计数器**：每个线程单独一份，记录"我当前执行到哪一行了"——**线程私有**。

一句话记住：**局部变量 = 藏在栈里 = 只有自己能动 = 不用担心；对象的字段和静态变量 = 放在堆里 = 大家都能动 = 要当心**。

![图2：JVM 内存布局——共享区与线程私有区](/images/svg/java-jvm-memory-and-threads.svg)

动手验证一下"栈私有、堆共享"：

```java
package com.frank.concurrent.ch01;

public class SharedVsLocal {

    // 静态变量在堆里，所有线程共享
    static int shared = 0;

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            // 局部变量在 worker 线程自己的栈里，只有它自己能用
            int local = 0;
            for (int i = 0; i < 1000; i++) {
                local++;    // 只动自己的局部变量，绝对安全
                shared++;   // 动共享变量（这里只有一个线程所以暂时没问题）
            }
            System.out.println("子线程 local=" + local);
        });
        worker.start();
        worker.join();  // 等子线程干完，join() 保证接下来能看到它的修改
        System.out.println("主线程 shared=" + shared);
    }
}
```

输出：
```
子线程 local=1000
主线程 shared=1000
```

`local` 是局部变量，无论怎么改都是那个线程自己的，完全不受外界影响。`shared` 放在堆里，子线程改了，主线程 join 之后能看到——但如果换成两个线程同时改 `shared`，结果就会出问题，这正是下一篇要演示的。

> **常见误区提醒**
>
> - "线程有自己独立的内存"：错误。线程私有的只是**栈**，堆永远是共享的。你 new 出来的对象只要被多个线程拿到引用，就一定是共享的。
> - 静态变量 `static` 不是"类私有的"，而是**全局共享**的，是线程安全问题的高发区。

---

## 三、Java 线程的生命周期与状态转换（重点）

### 3.1 把线程的一生想象成"上班"

Java 用 `Thread.State` 定义了六种状态，对应到上班场景就很好记：

| 状态 | 上班场景类比 | 实际含义 |
|------|-------------|---------|
| `NEW` | 已入职，还没到岗 | 线程对象已创建，但没调 `start()` |
| `RUNNABLE` | 在工位干活，或者排队等分配任务 | 可以运行——正在跑，或者在等 CPU |
| `BLOCKED` | 想进会议室开会，但门被锁着，在门口等 | 在等一把 `synchronized` 锁 |
| `WAITING` | 在休息室等同事电话，没人打电话就一直等 | 调了 `wait()` / `join()`，没设时限 |
| `TIMED_WAITING` | 定了闹钟，时间到了自动醒 | 调了 `sleep(ms)` / `wait(ms)` 等，有时限 |
| `TERMINATED` | 下班了 | `run()` 方法执行完毕 |

常见的状态切换，对应哪个方法：

| 从哪 → 到哪 | 靠什么方法 |
|------------|-----------|
| NEW → RUNNABLE | `start()` |
| RUNNABLE → TIMED_WAITING | `Thread.sleep(ms)` |
| RUNNABLE → WAITING | `obj.wait()`、`t.join()` |
| RUNNABLE → BLOCKED | 抢 `synchronized` 锁没抢到 |
| 任意 → TERMINATED | `run()` 跑完了 |

![图3：Thread.State 六种状态及转换路径](/images/svg/java-thread-state-transitions.svg)

### 3.2 实战：亲眼看看状态是怎么变的

```java
package com.frank.concurrent.ch01;

public class ThreadStateDemo {

    public static void main(String[] args) throws InterruptedException {
        final Object lock = new Object();

        Thread t = new Thread(() -> {
            try {
                Thread.sleep(200);           // 这段时间状态是 TIMED_WAITING
                synchronized (lock) {
                    lock.wait();              // 进来之后是 WAITING
                }
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        });

        System.out.println("刚 new 出来：       " + t.getState());  // NEW
        t.start();

        Thread.sleep(100);
        System.out.println("在 sleep 中：       " + t.getState());  // TIMED_WAITING

        Thread.sleep(250);
        System.out.println("在 wait 中：        " + t.getState());  // WAITING

        synchronized (lock) {
            lock.notifyAll();                 // 叫它起来
        }
        t.join();
        System.out.println("执行完毕：         " + t.getState());   // TERMINATED
    }
}
```

运行输出：
```
刚 new 出来：       NEW
在 sleep 中：       TIMED_WAITING
在 wait 中：        WAITING
执行完毕：         TERMINATED
```

线程从出生到死亡的每一步都被我们"抓拍"到了。生产环境排查"线程卡死"问题时，`jstack` 命令打出来的每个线程都会标注它当前是哪个状态——先看状态、再看卡在哪一行，是最常用的排查思路。

> **思考与练习**
>
> 1. 把代码里的 `lock.wait()` 换成不带锁直接调用会发生什么？（提示：会报错，猜猜是什么异常。）
> 2. 自己写一段代码，让两个线程抢同一把 `synchronized` 锁，观察抢不到的那个线程状态是不是 `BLOCKED`。

---

## 四、创建线程的三种方式

Java 创建线程有三种写法，各有适用场景。

### 4.1 方式一：继承 Thread 类

```java
package com.frank.concurrent.ch01;

public class HelloThread extends Thread {
    @Override
    public void run() {
        System.out.println("Hello，我是 " + getName());
    }

    public static void main(String[] args) {
        new HelloThread().start();
    }
}
```

**缺点**：Java 单继承，继承了 Thread 就不能继承别的类了。而且"任务"和"线程"耦合在一起，复用性差。

### 4.2 方式二：实现 Runnable 接口（**日常推荐**）

把"做什么事"（`Runnable`）和"谁来做"（`Thread`）分开：

```java
package com.frank.concurrent.ch01;

public class HelloRunnable implements Runnable {
    @Override
    public void run() {
        System.out.println("Hello，我是 " + Thread.currentThread().getName());
    }

    public static void main(String[] args) {
        Runnable task = new HelloRunnable();
        new Thread(task, "线程-A").start();
        new Thread(task, "线程-B").start();  // 同一个任务，两个线程跑
    }
}
```

用 Lambda 更简洁（Java 8+）：

```java
new Thread(() -> System.out.println("Hello，Lambda!"), "线程-C").start();
```

### 4.3 方式三：Callable + FutureTask（需要返回值时用）

前两种方式的 `run()` 没有返回值，也不能声明抛异常。如果你的任务要**拿到计算结果**，用 `Callable`：

```java
package com.frank.concurrent.ch01;

import java.util.concurrent.*;

public class HelloCallable {
    public static void main(String[] args) throws Exception {
        // Callable 包装成 FutureTask，FutureTask 实现了 Runnable
        FutureTask<Integer> task = new FutureTask<>(() -> {
            Thread.sleep(500);   // 模拟耗时计算
            return 6 * 7;        // 返回结果
        });

        new Thread(task).start();
        System.out.println("主线程可以先干别的...");
        System.out.println("计算结果是：" + task.get());  // 阻塞等结果
    }
}
```

输出：
```
主线程可以先干别的...
计算结果是：42
```

### 4.4 三种方式对比

| 方式 | 能返回结果？ | 能抛异常？ | 推荐场景 |
|------|------------|-----------|---------|
| 继承 Thread | ✗ | ✗ | 简单演示 |
| 实现 Runnable | ✗ | ✗ | **日常业务首选** |
| Callable + FutureTask | ✓ | ✓ | 需要拿到异步结果 |

> **常见误区提醒**
>
> - **真正创建线程的只有 `new Thread().start()`**。前面写的 Runnable / Callable 只是在定义"任务"，不会产生新线程。
> - 实现 Runnable 的对象如果有状态字段，多个线程跑同一个实例就会共享那个状态——又回到线程安全问题。

---

## 五、线程启动与终止的正确方式

### 5.1 start() vs run()——面试必问，一眼辨真假

**结论先行：`start()` 才会创建新线程；`run()` 只是普通方法调用，在当前线程里同步执行。**

动手验证：

```java
package com.frank.concurrent.ch01;

public class StartVsRun {
    public static void main(String[] args) throws InterruptedException {
        Thread t = new Thread(() ->
            System.out.println("我运行在：" + Thread.currentThread().getName()));

        t.run();    // 直接调方法，没有新线程
        t.start();  // 创建新线程，由新线程去调 run
    }
}
```

输出：
```
我运行在：main
我运行在：Thread-0
```

同一段代码，调用方式不同，结果完全不同。**一定要调 `start()`，不要调 `run()`。**

另外，`start()` 只能调一次。重复调会抛 `IllegalThreadStateException`；已经结束（TERMINATED）的线程也不能重新启动。

### 5.2 线程中断：三个方法的区别

Java 没有"强行停止"线程的安全方式——因为强行停止可能让数据写到一半，就像超市收银到一半直接拖走收银员，账目会乱掉。

Java 的做法是**发信号、自己决定什么时候停**。三个相关方法：

| 方法 | 做什么 | 特别注意 |
|------|--------|---------|
| `t.interrupt()` | 给线程 t 发"中断请求"信号；若 t 正在 sleep / wait，会让它立刻抛出 `InterruptedException` | 这是"请求"，不是强制 |
| `t.isInterrupted()` | 查询 t 是否有中断信号 | 不清除标志位 |
| `Thread.interrupted()` | 查询**当前线程**是否有中断信号 | **读完会清除标志位** |

特别注意：**`sleep` / `wait` 被中断时，标志位会被自动清掉**。所以 `catch(InterruptedException)` 之后 `isInterrupted()` 是 `false`。正确做法是在 catch 里要么重新设置（`Thread.currentThread().interrupt()`），要么直接退出。

### 5.3 实战：优雅地停止一个线程

```java
package com.frank.concurrent.ch01;

public class GracefulStop {

    static class Worker extends Thread {

        // volatile 保证：主线程改了 running，工作线程立刻看得见
        private volatile boolean running = true;

        void shutdown() {
            running = false;   // ① 设标志位
            interrupt();       // ② 中断兜底：如果线程卡在 sleep，立刻把它叫醒
        }

        @Override
        public void run() {
            while (running) {
                try {
                    System.out.println(getName() + " 工作中...");
                    Thread.sleep(500);
                } catch (InterruptedException e) {
                    System.out.println(getName() + " 被中断，准备退出");
                    break;   // 收到中断就退出循环
                }
            }
            System.out.println(getName() + " 已停止");
        }
    }

    public static void main(String[] args) throws InterruptedException {
        Worker w = new Worker();
        w.start();
        Thread.sleep(1600);   // 让它干两三轮
        w.shutdown();
        w.join();
        System.out.println("主线程结束");
    }
}
```

输出：
```
Thread-0 工作中...
Thread-0 工作中...
Thread-0 工作中...
Thread-0 被中断，准备退出
Thread-0 已停止
主线程结束
```

这套"volatile 标志位 + interrupt() 兜底"就是生产代码里最常见的优雅停止方案。单独用标志位，线程卡在 sleep 里出不来；单独用 interrupt，线程不检查就没用——两个配合才万无一失。

> **思考与练习**
>
> 1. 把 `running` 的 `volatile` 去掉，多跑几次，看看会不会出现"已经 shutdown 但线程还在跑"的情况（可见性问题演示）。
> 2. 如果 `shutdown()` 里只保留 `running = false`，去掉 `interrupt()`，会发生什么？（提示：线程卡在 `sleep(500)` 里出不来，要等下一次循环才能检测到 `running`。）

---

## 结语

本篇把"线程是什么、怎么来、怎么走"梳理清楚了。核心记住两点：

1. 线程共享进程的堆内存——方便但危险，多个线程同时改同一个变量就会出问题；
2. 创建用 `Runnable`，启动用 `start()`，停止用"volatile 标志位 + interrupt()"。

下一篇《线程安全与互斥》从一个具体的 Bug 出发——10 个线程一起数数，结果怎么会算错？用实验带你感受并发的"诡异"，然后一步步教你怎么修。

