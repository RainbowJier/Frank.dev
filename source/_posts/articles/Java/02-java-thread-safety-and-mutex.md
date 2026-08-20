---
title: Java 多线程从零到一（02）：线程安全与互斥
date: 2026-08-17 14:10:00
categories:
  - 教程
tags:
  - Java
  - 多线程
  - 并发编程
description: 从一个"10 个线程一起数数却算错了"的 Bug 出发，用大白话讲清楚竞态条件、synchronized、volatile、原子类和死锁。
lang: zh-CN
---

> 本文是《Java 多线程从零到一》系列第 02 篇。上一篇我们搞懂了"线程是什么"，这一篇来解决实战中最头疼的问题：**多个线程同时操作同一个变量，为什么会出 Bug？怎么防？**

---

## 一、线程安全问题的根源

### 1.1 一个"算错账"的 Bug

先看个简单场景：10 个线程一起数数，每个数 1000 次，最后结果应该是 10,000——但实际跑出来永远小于 10,000。

```java
package com.frank.concurrent.ch02;

public class UnsafeCounter {

    private static int count = 0;

    public static void main(String[] args) throws InterruptedException {
        // 开 10 个线程，每个线程给 count 加 1000 次
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 1000; j++) {
                    count++;   // 这里有问题！
                }
            });
            threads[i].start();
        }

        // 等所有线程干完
        for (Thread t : threads) t.join();

        System.out.println("期望：10000，实际：" + count);
    }
}
```

运行输出（多次运行结果都不一样）：
```
期望：10000，实际：9852
期望：10000，实际：9637
期望：10000，实际：9711
```

**为什么会丢数字？**因为 `count++` 看起来是一步，实际是三步：

1. 读取 `count` 的当前值（比如 100）
2. 加 1（100 + 1 = 101）
3. 写回去（`count = 101`）

如果两个线程同时执行，就可能出现这种情况：

![图4：i++ 竞态条件——读改写交错导致更新丢失](java-race-condition-increment.svg)

- **线程 A** 读到 100，加完得 101，还没来得及写回去
- **线程 B** 也读到了 100（因为 A 还没写回去），加完也是 101
- A 写回 101，B 也写回 101
- 结果：两次加法只涨了 1，丢了一次更新

这种"多个线程同时操作共享数据，结果不符合预期"的问题，叫**线程安全问题**。根源就三个字：**共享、可变、并发**。

### 1.2 三大经典症状

线程安全问题主要表现为三类：

#### ① 原子性问题

**定义**：一个操作要么全做完，要么全不做，不能被打断到一半。

上面的 `count++` 就是典型——看起来一行代码，实际是三步，中途可能被打断。

#### ② 可见性问题

**定义**：一个线程修改了共享变量，其他线程不一定能立刻看到。

CPU 为了提速会把数据缓存在自己的 L1/L2 缓存里。线程 A 在核心 1 上改了变量，写到了核心 1 的缓存；线程 B 在核心 2 上读，可能读到的还是核心 2 缓存里的旧值。

一个"死循环出不来"的经典案例：

```java
public class VisibilityDemo {
    private static boolean running = true;  // 没加 volatile

    public static void main(String[] args) throws InterruptedException {
        Thread worker = new Thread(() -> {
            while (running) {
                // 空转，等 running 变成 false
            }
            System.out.println("线程退出了");
        });
        worker.start();

        Thread.sleep(1000);
        running = false;  // 主线程改了
        System.out.println("主线程已设置 running = false");
    }
}
```

**现象**：主线程明明设了 `running = false`，但 worker 线程可能永远出不来——因为它缓存了 `running` 的值，看不到主线程的修改。

#### ③ 有序性问题

**定义**：编译器和 CPU 为了优化性能，可能会重排指令顺序。单线程里没问题，多线程就可能出诡异 Bug。

经典案例是**双重检查锁（DCL）单例模式**——不加 `volatile` 的话，另一个线程可能拿到"只分配了内存、还没初始化完"的对象，导致空指针或其他怪异错误。

### 1.3 一句话总结

**线程安全问题 = 多个线程操作共享的可变数据，但操作不是原子的 / 改完别人看不到 / 指令被重排了。**

解决办法无非两条路：

1. **加锁**：让一次只有一个人能动（`synchronized`、`Lock`）
2. **无锁**：用特殊的原子指令一步到位（原子类 `AtomicXxx`）

下面逐个讲。

> **常见误区提醒**
>
> - "单行代码就是原子的"：错误。`count++`、`i = i + 1` 都不是原子操作。
> - "加了 `volatile` 就线程安全了"：错误。`volatile` 只保证可见性和有序性，**不保证原子性**。`volatile int count; count++;` 照样会丢数据。

---

## 二、synchronized 同步机制

### 2.1 用"单人卫生间"理解 synchronized

`synchronized` 就像一把**只有一把钥匙的单人卫生间**：

- 第一个人进去，把门锁上（拿到锁）
- 后来的人推门发现锁着，只能在外面排队等（BLOCKED 状态）
- 里面的人出来了（释放锁），外面排队的人抢这把钥匙，抢到的进去，抢不到的继续等

Java 里**每个对象都自带一把锁**（叫 monitor，监视器），`synchronized` 就是抢这把锁。

### 2.2 三种用法

#### ① 修饰实例方法：锁的是 `this`

```java
public class Counter {
    private int count = 0;

    public synchronized void increment() {  // 锁的是当前对象（this）
        count++;
    }
}
```

同一个 `Counter` 对象，两个线程同时调 `increment()`，一次只有一个能进去。

#### ② 修饰静态方法：锁的是 `类对象`

```java
public class Counter {
    private static int count = 0;

    public static synchronized void increment() {  // 锁的是 Counter.class
        count++;
    }
}
```

#### ③ 代码块：自己指定锁对象

```java
public class Counter {
    private int count = 0;
    private final Object lock = new Object();

    public void increment() {
        synchronized (lock) {  // 锁这个 lock 对象
            count++;
        }
    }
}
```

代码块更灵活，可以缩小锁的范围——只锁住关键的几行，其他地方不用等。

### 2.3 修复开头那个 Bug

用 `synchronized` 把 `count++` 包起来：

```java
package com.frank.concurrent.ch02;

public class SafeCounter {

    private static int count = 0;
    private static final Object lock = new Object();

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 1000; j++) {
                    synchronized (lock) {  // 加锁
                        count++;
                    }
                }
            });
            threads[i].start();
        }

        for (Thread t : threads) t.join();
        System.out.println("期望：10000，实际：" + count);
    }
}
```

输出：
```
期望：10000，实际：10000
```

完美！加锁后，`count++` 的三步操作变成了"原子操作"——一个线程没干完之前，其他线程进不来。

### 2.4 synchronized 的可重入性

**可重入**是指：同一个线程可以多次拿到同一把锁，不会把自己锁死。

```java
public class ReentrantDemo {
    public synchronized void outer() {
        System.out.println("进入 outer");
        inner();  // outer 和 inner 锁的都是 this，同一把锁
    }

    public synchronized void inner() {
        System.out.println("进入 inner");
    }

    public static void main(String[] args) {
        new ReentrantDemo().outer();
    }
}
```

输出：
```
进入 outer
进入 inner
```

如果不可重入，线程在 `outer` 里调 `inner` 会发现"门被自己锁着"，就死锁了。好在 Java 的锁是可重入的。

### 2.5 synchronized 的演进：锁升级

早期 JDK 的 `synchronized` 很慢，因为每次都要找操作系统帮忙（"重量级锁"）。JDK 6 开始做了优化，锁会根据竞争情况"升级"：

![图5：synchronized 锁升级路径](java-lock-upgrade-path.svg)

- **无锁**：对象刚创建，没人用
- **偏向锁**：只有一个线程在用，记住这个线程 ID，它下次进来不用加锁
- **轻量级锁**：有第二个线程来竞争，用 CAS 自旋（在 CPU 上忙等一小会儿）
- **重量级锁**：竞争激烈，自旋也抢不到，只好找操作系统把线程挂起

这套机制让 `synchronized` 在低竞争场景下几乎零开销，高竞争时才变"重"。**所以现在不用刻意回避 `synchronized`，日常场景它够用。**

> **常见误区提醒**
>
> - **锁的不是代码，是对象**。`synchronized(this)` 锁的是当前对象，`synchronized(obj)` 锁的是 `obj`。不同对象 = 不同锁 = 不互斥。
> - **不要锁 String 常量、Integer 缓存**：`synchronized("abc")` 很危险，因为所有写 `"abc"` 的地方用的是同一个对象，会导致本不该互斥的代码也被锁住。

---

## 三、volatile 关键字：轻量版同步

### 3.1 volatile 是用来干什么的？

有时候你只需要一个轻量的保证：**某个变量被改了，所有线程立刻能看到**——不需要互斥，只要可见。`volatile` 就是为这种场景设计的。

它的两层作用：

1. **保证可见性**：每次写 `volatile` 变量，立刻刷回主内存；每次读，强制从主内存读最新值，不走 CPU 缓存。
2. **禁止指令重排**：编译器和 CPU 不能把对这个变量的读写随意调换顺序。

把前面"死循环"的例子加上 `volatile`：

```java
private static volatile boolean running = true;  // 加了 volatile
```

这样主线程改了 `running`，工作线程立刻看到，正常退出。

### 3.2 volatile 的局限性：不保证原子性

`volatile` 解决了可见性，**但解决不了原子性**。把之前的计数器改成 `volatile`，还是会算错：

```java
private static volatile int count = 0;

// 10 个线程各加 1000 次，结果还是小于 10000！
```

原因：虽然每次读写都是最新的，但"读-加-写"这三步之间，别的线程还是可以插进来。

**选型原则**：

| 场景 | 用什么 |
|------|--------|
| 只是标志位（true/false 的开关） | `volatile` 够了 |
| 需要加减乘除等复合操作 | `synchronized` 或原子类 |

### 3.3 volatile 实战：正确的 DCL 单例

双重检查锁（Double-Checked Locking）单例，必须加 `volatile`，否则可能拿到"初始化到一半的对象"：

```java
package com.frank.concurrent.ch02;

public class Singleton {

    // 必须加 volatile，防止指令重排导致拿到半成品对象
    private static volatile Singleton instance;

    private Singleton() { }

    public static Singleton getInstance() {
        if (instance == null) {                      // 第一次检查：已经初始化就直接返回（快路径）
            synchronized (Singleton.class) {
                if (instance == null) {              // 第二次检查：防止多个线程都过了第一次检查后重复创建
                    instance = new Singleton();
                }
            }
        }
        return instance;
    }
}
```

> **常见误区提醒**
>
> - `volatile` 不等于 `synchronized`。前者只保证可见性和有序性，后者三个都保证（原子性 + 可见性 + 有序性）。
> - 看到 `volatile` 就以为线程安全了：**`volatile int i; i++;` 照样会丢数据**。

---

## 四、原子类：不加锁也能线程安全

### 4.1 什么是原子类？

`synchronized` 是"排队进厕所"——一次只让一个人进，其他人等。但对于简单的 +1 操作，这样太"重"了。有没有既安全、又不用排队的方案？

有，就是**原子类（`java.util.concurrent.atomic` 包）**。它们底层靠 CPU 指令（CAS，Compare And Swap）一步完成"读-改-写"，不需要加锁，线程不会被挂起。

常用的：

| 类名 | 用途 |
|------|------|
| `AtomicInteger` / `AtomicLong` | 原子整数，最常用 |
| `AtomicBoolean` | 原子布尔，适合"只触发一次"的开关 |
| `AtomicReference<V>` | 原子引用，保护对象引用的替换 |
| `LongAdder` | 高并发计数器，比 `AtomicLong` 更快 |

### 4.2 用 AtomicInteger 修复计数器

```java
package com.frank.concurrent.ch02;

import java.util.concurrent.atomic.AtomicInteger;

public class AtomicCounter {

    private static AtomicInteger count = new AtomicInteger(0);

    public static void main(String[] args) throws InterruptedException {
        Thread[] threads = new Thread[10];
        for (int i = 0; i < 10; i++) {
            threads[i] = new Thread(() -> {
                for (int j = 0; j < 1000; j++) {
                    count.incrementAndGet();  // 原子自增，内部一步完成，不用加锁
                }
            });
            threads[i].start();
        }

        for (Thread t : threads) t.join();
        System.out.println("期望：10000，实际：" + count.get());
    }
}
```

输出：
```
期望：10000，实际：10000
```

### 4.3 CAS 的原理（了解即可）

CAS 的逻辑是：**只有当内存里的当前值等于我读到的旧值时，才把它改成新值；否则不改，让我重试**。

想象一群人抢着在白板上把数字 +1：每个人先抄下当前数字，算好 +1 的结果，然后举手说"如果白板还是 X，我来改成 X+1"——只有白板确实还是 X 的那个人能成功，其他人重新看板再来。没有人排队，没有人睡觉，失败了就重试。

### 4.4 原子类的局限：ABA 问题

CAS 只检查"值有没有变"，不关心"值变过几次"。如果一个值从 A → B → A，CAS 会认为什么都没发生。

多数场景下这无所谓。但如果你的业务逻辑要求"感知到变化过"，可以用 `AtomicStampedReference`（带版本号的原子引用）。

### 4.5 三种方案性能对比

| 方案 | 原子性 | 性能（低竞争） | 性能（高竞争） |
|------|--------|--------------|--------------|
| `synchronized` | ✓ | 中（JDK 6 后优化了） | 较低 |
| `AtomicLong` | ✓ | 高 | 中（大量自旋） |
| `LongAdder` | ✓ | 高 | **最高**（分段累加） |

高并发计数场景（统计 QPS、请求数等）优先用 `LongAdder`，读取时用 `sum()`。

> **常见误区提醒**
>
> - 原子类只保证**单个变量**的原子操作。如果你需要"先更新 A，再更新 B，两步要一起成功"，还是要用锁。
> - CAS 在竞争极激烈时，大量线程不断重试，CPU 会空转——这时反而不如加锁（锁住了就休眠，不耗 CPU）。

---

## 五、死锁与活锁（面试必问）

### 5.1 死锁：两个人互相等对方松手

**死锁**就是：线程 A 拿着锁 1，等锁 2；线程 B 拿着锁 2，等锁 1。谁也不撒手，谁也等不到，永远卡死。

经典的转账场景：

![图6：转账死锁——环形等待](java-deadlock-transfer.svg)

```java
package com.frank.concurrent.ch02;

public class TransferDeadlock {

    static class Account {
        String name;
        long balance;
        Account(String name, long balance) { this.name = name; this.balance = balance; }
    }

    // 转账：先锁"转出账户"，再锁"转入账户"
    static void transfer(Account from, Account to, long amount) {
        synchronized (from) {          // 拿到第一把锁
            try { Thread.sleep(100); } catch (InterruptedException ignored) { }
            // ↑ 放大时间窗口，让两个线程都拿到第一把锁（生产中窗口极小，更难发现）
            synchronized (to) {        // 再拿第二把锁 → 可能永远等不到
                from.balance -= amount;
                to.balance += amount;
            }
        }
    }

    public static void main(String[] args) {
        Account a = new Account("A", 1000);
        Account b = new Account("B", 1000);

        // 线程1：A 转 B（先锁 a，再锁 b）
        new Thread(() -> transfer(a, b, 100)).start();
        // 线程2：B 转 A（先锁 b，再锁 a）→ 死锁！
        new Thread(() -> transfer(b, a, 50)).start();
    }
}
```

程序永远不结束：线程 1 拿着 a 的锁等 b，线程 2 拿着 b 的锁等 a。

### 5.2 怎么排查死锁

JDK 自带工具 `jstack`：

```bash
jps              # 先找到 Java 进程号
jstack <pid>     # 打印所有线程的状态
```

输出里会直接告诉你：

```
Found one Java-level deadlock:
=============================
"Thread-1":
    waiting to lock ... which is held by "Thread-0"
"Thread-0":
    waiting to lock ... which is held by "Thread-1"
```

两个线程互相"waiting to lock"对方持有的锁，死锁实锤。图形化工具还有 jconsole、VisualVM，点一下"检测死锁"按钮即可。

### 5.3 怎么预防死锁

死锁要同时满足四个条件才会发生：**互斥、请求与保持、不可抢占、循环等待**——破坏任何一个都能预防。最实用的两招：

**方法一：按固定顺序加锁（破坏循环等待，最推荐）**

所有人在拿多把锁时，都按同一个顺序拿。比如转账时规定"永远先锁 ID 小的账户"：

```java
static void transferFixed(Account from, Account to, long amount) {
    // 按账户名排序，永远先锁"排在前面"的那个
    Account first  = from.name.compareTo(to.name) <= 0 ? from : to;
    Account second = (first == from) ? to : from;

    synchronized (first) {
        synchronized (second) {
            from.balance -= amount;
            to.balance += amount;
        }
    }
}
```

不管哪个方向转账，加锁顺序都一样，循环等待就不存在了。

**方法二：tryLock 超时（拿不到就放手）**

用 `ReentrantLock.tryLock(超时时间)` 代替 `synchronized`：一段时间拿不到锁就放弃，还主动释放已持有的锁，退避后重试。像两个人抢门，抢不到的先退一步，避免卡死。

### 5.4 活锁与饥饿

- **活锁**：线程没卡死，一直在动，但做的都是无用功。像两个人在走廊迎面相遇，同时往左让、又同时往右让，永远错不开。解决办法：引入随机等待时间，打破同步节奏。
- **饥饿**：线程一直抢不到资源，长期得不到执行。比如锁总被"抢手"的线程先拿到，其他线程排队排到天荒地老。解决办法：用公平锁（先来后到）。

> **思考与练习**
>
> 1. 把上面死锁代码的两个线程改成同方向转账（都是 a 转 b），还会死锁吗？为什么？
> 2. 写一个程序：两个线程互相"谦让"资源（发现对方要用就让出来），观察活锁现象。
> 3. 面试题：死锁的四个必要条件是什么？为什么"破坏任意一个"就能预防死锁？

---

## 结语

本篇从一个"算错账"的 Bug 出发，搞清楚了线程安全的三大根源（原子性、可见性、有序性），以及三副解药：

1. **`synchronized`**——万能但相对重，用"排队上厕所"的思维理解
2. **`volatile`**——轻量，只保证可见性和有序性，**不保证原子性**
3. **原子类**——利用 CPU 的 CAS 指令，不加锁也能原子更新

最后还学了死锁的成因（循环等待）、排查（jstack）和预防（按序加锁）。

下一篇《线程间通信与协作》：多个线程不只是"互相竞争"，还需要"互相配合"——生产者喊消费者取货、主线程等子线程干完再汇总。敬请期待。

