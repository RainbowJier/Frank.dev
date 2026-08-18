---
title: Java 并发进阶（04）：ConcurrentHashMap 为什么又快又安全
date: 2026-08-17 18:00:00
categories:
  - 教程
tags:
  - Java
  - 多线程
  - 并发编程
description: 初级篇收官时留的问题在这里解答：用大白话拆解 ConcurrentHashMap 的桶级锁、CAS 快路径、volatile 无锁读、多线程协助扩容，附实战用法和五个常见坑。
lang: zh-CN
---

> 本文是《Java 并发进阶》系列第 04 篇，衔接初级篇（01–03）。初级篇我们学了三块积木：`synchronized`、`volatile` 和 CAS。这一篇看 JDK 的作者怎么把这三块积木组装成并发世界里最常用的容器——**又快又安全的 `ConcurrentHashMap`**。

---

## 一、为什么需要 ConcurrentHashMap

### 1.1 HashMap 在并发下会出什么 Bug

初级篇反复强调：**HashMap 不是线程安全的**。它在多线程下具体会怎么坏？两个版本两种症状：

- **JDK 7：扩容死循环**。旧版扩容用"头插法"迁移节点，两个线程同时扩容时，链表可能被接成**环形**。之后任何 `get()` 落到这个桶上都会无限循环，CPU 直接飙到 100%——线上最恐怖的故障之一。
- **JDK 8：数据覆盖丢失**。改成了尾插法，环没了，但多个线程同时判断"桶是空的"然后各自 CAS 式地写入，**后写的会把先写的覆盖掉**，元素悄悄丢失。

写个程序感受一下（JDK 8+）：

```java
package com.frank.concurrent.ch04;

import java.util.HashMap;
import java.util.Map;

public class HashMapConcurrencyBug {

    public static void main(String[] args) throws InterruptedException {
        for (int round = 0; round < 10; round++) {
            Map<String, Integer> map = new HashMap<>();
            Thread[] threads = new Thread[10];
            for (int i = 0; i < 10; i++) {
                final int tid = i;
                threads[i] = new Thread(() -> {
                    for (int j = 0; j < 1000; j++) {
                        map.put("key-" + tid + "-" + j, j);   // 每个 key 都不一样
                    }
                });
                threads[i].start();
            }
            for (Thread t : threads) t.join();
            System.out.println("第 " + round + " 轮，期望 10000，实际 " + map.size());
        }
    }
}
```

运行输出（多次运行结果不一样，丢多丢少看运气）：

```
第 0 轮，期望 10000，实际 10000
第 1 轮，期望 10000，实际 9987
第 2 轮，期望 10000，实际 9921
```

key 全不相同也会丢——因为扩容和插入交错时，整条链都可能被弄丢。**没有报错、没有异常，数据无声无息地没了**，这种 Bug 在线上排查起来最折磨人。

### 1.2 老办法为什么不行

JDK 早期确实给过"线程安全的 Map"：

- **`Hashtable`**：每个方法都加 `synchronized`，连 `get()` 都锁。
- **`Collections.synchronizedMap(new HashMap<>())`**：包装一层，效果差不多。

它们的问题可以用一个比喻说清楚：**整栋楼只有一个大门，一把锁**。任何人进出——哪怕去的是完全不同的房间——都得先在大门口排队。100 个桶的表，两个线程明明操作的是第 3 个桶和第 97 个桶，毫不相干，却必须串行。

### 1.3 锁粒度的三代演进

`ConcurrentHashMap` 的进化史，就是一部**把锁越拆越细**的历史：

![图9：从全表锁到桶级锁——线程安全 Map 的锁粒度演进](/images/svg/java-chm-lock-evolution.svg)

| 版本 | 方案 | 锁粒度 | 并发度 |
|------|------|--------|--------|
| JDK 1.0 | `Hashtable` | 整张表 | 1 |
| JDK 1.5 | 分段锁 `Segment` | 一个段（默认含 n/16 个桶） | 16 |
| JDK 1.8 | CAS + `synchronized` | 单个桶 | ≈ 桶数 |

打个比方：**Hashtable 是整栋楼一把大门锁；JDK 7 是每层楼一把门锁；JDK 8 是每个房间一把锁**——而且大部分时候（空桶插入、所有读操作）干脆不用锁。

---

## 二、JDK 7 分段锁：一次成功的中间态

先花两分钟了解 JDK 7 的设计，因为它解释了 JDK 8 为什么那样改。

JDK 7 的 `ConcurrentHashMap` 内部是一个 **`Segment` 数组**（默认 16 个），每个 `Segment` 本质是一个小 HashMap，并且**继承自 `ReentrantLock`**——自带一把锁。写入时：

1. 第一次 hash：定位 key 落在哪个 `Segment`
2. 锁住这个 `Segment`
3. 第二次 hash：在 `Segment` 内部的数组里定位桶，完成插入

这样，16 个线程可以同时写 16 个不同的段，互不干扰——这就是"并发度 16"的由来。

**那 JDK 8 为什么把它扔了？** 三个原因：

1. **粒度还是不够细**。段内所有桶共用一把锁，一个段里 6 个桶，两个线程写同一个段的不同桶也要排队。
2. **内存浪费**。`Segment` 继承 `ReentrantLock`，自带 AQS 队列等一堆字段，16 个段就是 16 份开销。
3. **`synchronized` 变快了**。初级篇讲过锁升级（偏向锁 → 轻量级锁 → 重量级锁）：无竞争时 `synchronized` 几乎零开销。既然 JVM 自带的锁已经够轻，就没必要再养一批 `ReentrantLock` 对象了。

于是 JDK 8 做了个漂亮的转身：**拆掉 Segment，直接锁"桶的头节点"**——锁粒度从 1/16 直接细化到 1/n（n 是桶数），而且锁对象就是已有的 Node，零额外内存。

---

## 三、JDK 8 的存储结构

### 3.1 数组 + 链表 + 红黑树

![图10：JDK 8 ConcurrentHashMap 存储结构——数组 + 链表 + 红黑树](/images/svg/java-chm-structure.svg)

结构和 `HashMap` 一脉相承：

- 主体是一个 `Node` 数组（源码里叫 `table`），**长度恒为 2 的幂**——这样 `hash & (n-1)` 等价于取模，一步位运算定位桶（回忆 MYSQL 索引篇：位运算比除法快得多）。
- 每个桶是一条**链表**，冲突的 key 挂在同一个桶上，尾插法。
- 链表太长查找会退化成 O(n)，所以**链表长度 ≥ 8 且数组长度 ≥ 64 时，转成红黑树**（查找 O(log n)）；扩容后节点数 ≤ 6 时退化回链表。
- 数组长度不足 64 时优先扩容而不是树化——小表扩一扩往往就分散了，不值得养树。

### 3.2 三处 volatile：无锁读的基石

回忆初级篇：`volatile` 保证**可见性**（写立刻对其他线程可见）。`ConcurrentHashMap` 把它精确地用在了三个地方：

```java
// ① 数组本身：保证线程能看到最新的表结构（包括扩容后的新表）
transient volatile Node<K,V>[] table;

// ② 和 ③：节点里的值和下一个节点
static class Node<K,V> {
    volatile V val;
    volatile Node<K,V> next;
}
```

这是 `get()` 不加锁的秘密：**读数组是 volatile 读，读值也是 volatile 读**，一路读到的都是最新数据。而 `hash`、`key` 是 final 的，创建后不变，天然线程安全。

> **注意对比**：`HashMap` 的 table 就是个普通数组，Node 里也没有 volatile——所以就算没有覆盖问题，读线程也可能读到旧值。

### 3.3 sizeCtl：一个字段的三种身份

`ConcurrentHashMap` 用一个 `int` 字段 `sizeCtl`（size control）管理整个表的生命周期，**一个字段，多种含义**：

| sizeCtl 的值 | 含义 |
|------|------|
| 0 | 表还没初始化 |
| -1 | 有线程正在初始化表 |
| 正数 | 下一次扩容的阈值（= 容量 × 0.75） |
| 其他负数 | 正在扩容，-(1 + 参与扩容的线程数) |

状态的切换全靠 **CAS** 完成——比如初始化就是"大家抢着把 sizeCtl 从 0 改成 -1，抢到的那个人干活，其他人自旋等"。这是初级篇 CAS 思想的直接应用：**用一个原子变量当"抢任务的号牌"**。

顺便说两个容易忽略的细节：

- **表是懒加载的**：`new ConcurrentHashMap<>()` 并不分配数组，第一次 `put` 才初始化。构造函数里的容量参数只用来预先算阈值。
- **`concurrencyLevel` 参数还在，但基本失效了**：JDK 7 它决定段数，JDK 8 只是拿来"暗示"初始容量，锁粒度已经是桶级了。

---

## 四、put 全流程：CAS 快路径 + synchronized 慢路径

### 4.1 流程总览

![图11：put 的加锁决策流程——CAS 快路径与 synchronized 慢路径](/images/svg/java-chm-put-flow.svg)

用文字把图串一遍（简化版）：

```java
final V putVal(K key, V value, boolean onlyIfAbsent) {
    if (key == null || value == null) throw new NullPointerException();  // ① 不允许 null
    int hash = spread(key.hashCode());        // ② 高 16 位异或低 16 位，减少碰撞

    for (Node<K,V>[] tab = table;;) {         // ③ 大循环：失败/协助扩容后重试
        if (tab == null) {
            tab = initTable();                // ④ CAS 抢 sizeCtl，抢到的线程建表
        } else if (目标桶是空的) {
            if (casTabAt(tab, i, null, new Node<>(...)))   // ⑤ CAS 快路径：无锁插入
                break;                        //    成功直接结束，失败说明有人抢先，重循环
        } else if (头节点.hash == MOVED) {
            tab = helpTransfer(tab, f);       // ⑥ 别人正在扩容：帮忙搬一段，再重试
        } else {
            synchronized (头节点 f) {         // ⑦ 慢路径：锁住这一个桶的头节点
                // 遍历链表尾插，或红黑树插入；key 相同则覆盖
            }
            if (链表长度 >= 8) treeifyBin(...);  // ⑧ 尝试树化（表太小则先扩容）
            break;
        }
    }
    addCount(1L, binCount);                   // ⑨ 计数 + 1，必要时触发扩容
}
```

注意两个特殊 hash 值：`MOVED(-1)` 表示这个桶已被迁移到新表（头节点是个 `ForwardingNode`）；`TREEBIN(-2)` 表示这个桶是红黑树。它们占用了负数 hash，这也是 `spread()` 要 `& 0x7fffffff`（强制非负）的原因。

### 4.2 两个高频面试问题

**问题一：为什么空桶用 CAS，非空桶却用 synchronized？**

CAS 只能做"**一个变量**的一次原子替换"。空桶插入恰好就是这个形状：把 `table[i]` 从 null 换成新节点，一步到位，天然适合 CAS。而非空桶要"遍历链表找到位置再挂节点"，多步操作没法用一个 CAS 表达，只能上锁——但锁的只是**头节点这一个对象**，不同桶互不影响。

**问题二：为什么用 synchronized 而不是 ReentrantLock？**

- 锁的粒度已经细到单个桶，竞争极小，`synchronized` 的轻量级锁（自旋 CAS）完全够用，还省去了 ReentrantLock 每个桶一份的内存开销（Node 本身就是锁对象）。
- JDK 6 之后 `synchronized` 有锁升级优化（初级篇图 5 讲过），低竞争下性能不输显式锁。

**一句话总结 put 的哲学：能用 CAS 绝不加锁，必须加锁只锁一个桶，加锁时间尽量短。**

---

## 五、get 为什么不加锁

`get` 的逻辑简单到可以背下来：

```java
public V get(Object key) {
    Node<K,V> e;
    return (e = getNode(key)) == null ? null : e.val;
}

// getNode 内部：
// ① tab = table        —— volatile 读数组
// ② 找到桶，从头节点开始比对 —— volatile 读 next
// ③ hash 和 key 都相等，返回 —— volatile 读 val
```

全程**一次锁都没加、一次 CAS 都没做**，靠的就是 3.2 节那三处 volatile。读到的一定是"某一时刻的完整真相"——要么是旧值，要么是新值，绝不会是半成品。

代价是**弱一致性**：扩容进行中，`get` 可能查旧表，也可能查新表（后面讲扩容时会看到，旧表查不到会自动转发到新表）——但无论哪张表，数据都是完整的。

顺带回答一个经典问题——**为什么不允许 null key 和 null value？**

因为在并发环境里，`get(key)` 返回 null 有**歧义**：可能是"key 不存在"，也可能是"key 存在，值恰好是 null"。单线程的 HashMap 可以再用 `containsKey(key)` 消歧义；但并发下这两步调用之间 map 可能被别的线程改了，**消歧义本身就不是原子操作**。Doug Lea 干脆禁止 null，让歧义从根上消失。

---

## 六、扩容：多线程"搬家"

扩容是 `ConcurrentHashMap` 最精巧的部分。普通 HashMap 扩容是"一个人搬完整张表"，搬完之前读不了写不了；`ConcurrentHashMap` 的扩容是**大家一起来搬，边搬边营业**。

![图12：多线程协助扩容——ForwardingNode 与迁移区间认领](/images/svg/java-chm-transfer.svg)

### 6.1 整体过程

1. **谁触发**：`put` 结束后 `addCount` 发现元素数超过阈值（容量 × 0.75），某个线程"抢到"发起权，创建一个 **2 倍大小的新表**。
2. **怎么分工**：用一个游标 `transferIndex` 从旧表**右端往左**分配迁移区间，每段至少 16 个桶（`MIN_TRANSFER_STRIDE`）。写线程发现正在扩容，不干等——先去 `helpTransfer()` 领一段搬。
3. **怎么搬家**：每搬完一个桶，就在旧表的这个位置放一个 `ForwardingNode`（hash = MOVED），它内部保存指向新表的引用，相当于门口贴了张条：**"本户已搬走，请到新表找"**。
4. **什么时候结束**：所有区间搬完（`transferIndex` 归零且没有线程在干活），`table` 指向新表，`sizeCtl` 设为新阈值，搬家结束。

### 6.2 搬一个桶的细节：一条链拆两条

迁移单个桶时，会把链表按 `hash & oldCap`（注意是 `&` 旧容量本身，不是容量-1）拆成两条：

- **结果为 0 的节点（低位链）**：放到新表的 **i** 位置（和旧表同下标）
- **结果非 0 的节点（高位链）**：放到新表的 **i + n** 位置（n 是旧容量）

为什么不用重新计算 hash？因为容量翻倍只是二进制多了一位，`hash & oldCap` 恰好就是在检查"多出来的这一位是 0 还是 1"——0 就原地不动，1 就往后挪 n 格。一次与运算完成重新分流，非常优雅。

### 6.3 ForwardingNode：三方联络人

这个特殊节点让扩容期间"读写不阻塞"成为可能：

- **读线程**（`get`）碰到它：顺着它内部的引用**去新表继续找**；
- **写线程**（`put`）碰到它：调用 `helpTransfer` **帮忙搬一段**，搬完再回来写自己的数据；
- 这就是图 11 里那个 `MOVED` 判断框存在的意义。

> **常见误区提醒**
>
> - "扩容时会锁整张表"——错。任何时刻锁的最多只是**正在迁移的那个桶的头节点**。
> - "扩容期间数据会丢"——错。每个桶要么在旧表（未迁移），要么在新表（已迁移），由 ForwardingNode 保证找得到，不存在两边都没有的窗口。

---

## 七、size() 怎么算：LongAdder 思想

一个有趣的问题：元素个数没有单独的"计数器锁"，多个线程并发 put，`size()` 怎么保证准确？

如果只用一个 `AtomicLong` 计数，高并发下所有线程都挤在一个变量上 CAS，互相冲突疯狂重试（初级篇讲 CAS 缺点时提过）。`ConcurrentHashMap` 借用了 **`LongAdder` 的分散计数**思路：

- 先尝试 CAS 一个基础计数 `baseCount`；
- 失败了（说明有竞争）就往 `CounterCell[]` 数组里随机挑一格，CAS 累加**自己那一格**；
- `size()` = `baseCount + 所有格子求和`。

竞争被分散到多个格子上，各加各的，最后求和——**空间换时间**。代价是 `size()` 不是精确瞬时值（求和过程中可能有线程正在改格子），对于"看个大概数量"的场景（监控、限流统计）完全够用。

> **常见误区提醒**
>
> - `map.size() == 0` 这种判断在并发下不可靠，两次调用之间 map 可能已经变了。需要"精确的空判断 + 复合动作"时，想想是不是该用 `ConcurrentHashMap` 的原子方法（下一节）。

---

## 八、实战用法与五个常见的坑

### 8.1 经典用法一：本地缓存（computeIfAbsent）

```java
package com.frank.concurrent.ch04;

import java.util.concurrent.ConcurrentHashMap;

public class LocalCacheDemo {

    private final ConcurrentHashMap<String, String> cache = new ConcurrentHashMap<>();

    public String getUserProfile(String userId) {
        // key 不存在才加载，存在直接返回——整个"检查 + 加载 + 放入"是原子的
        return cache.computeIfAbsent(userId, this::loadFromDb);
    }

    private String loadFromDb(String userId) {
        // 模拟一次昂贵的数据库查询
        return "profile-of-" + userId;
    }
}
```

`computeIfAbsent` 是"不存在则计算并放入"的**原子操作**。如果自己写 `if (cache.get(k) == null) { cache.put(k, load()); }`，两个线程可能同时通过检查、各自查一次库——缓存的的意义就打折了。

### 8.2 经典用法二：词频统计（merge）

```java
String[] words = {"apple", "banana", "apple", "cherry", "apple"};

ConcurrentHashMap<String, Integer> counter = new ConcurrentHashMap<>();

for (String w : words) {
    // key 存在：旧值 + 1；不存在：放入 1 —— 原子完成
    counter.merge(w, 1, Integer::sum);
}

System.out.println(counter);   // {apple=3, banana=1, cherry=1}
```

`merge`、`compute`、`putIfAbsent`、`replace` 这一族方法都是原子的——**它们就是为"读-改-写"复合操作而生的**。

### 8.3 五个常见的坑

**坑 1：先 get 判断再 put，复合操作不原子**

```java
// 反例：两个线程可能同时进入 if，重复初始化
if (!map.containsKey(k)) {
    map.put(k, createValue());
}

// 正解：用原子的 putIfAbsent / computeIfAbsent
map.putIfAbsent(k, createValue());
```

**坑 2：computeIfAbsent 的加载函数里递归修改同一个 map**

```java
map.computeIfAbsent("a", k -> {
    map.put("b", "x");          // JDK 9+ 直接抛 IllegalStateException
    return "1";
});
```

加载函数执行时**桶头节点被锁着**，在里面再动同一个桶（甚至同一张表）极易死锁或异常。JDK 9 起会检测递归更新并抛 `IllegalStateException`，JDK 8 里则是不可预测的行为。**规矩：映射函数里只做计算，不要改 map。**

**坑 3：computeIfAbsent 里做耗时操作**

映射函数在**锁内**执行。如果 `loadFromDb` 要跑 3 秒，映射到同一个桶的其他 key 的写入全部陪等 3 秒。慢操作应该挪出去（比如先查布隆过滤器/二级缓存，或用异步加载框架 Caffeine）。

**坑 4：迭代器不抛异常，但也不保证"最新"**

`ConcurrentHashMap` 的迭代器是**弱一致**（weakly consistent）的：遍历开始后创建的元素，可能遍历到也可能遍历不到；遍历期间修改不会抛 `ConcurrentModificationException`。不要依赖"遍历时看到所有最新数据"。

**坑 5：null 一律禁止**

`put(null, v)`、`put(k, null)` 直接 `NullPointerException`，原因见第五节。需要"允许 null 值"的并发 Map，得换思路（比如值用 `Optional` 包装，或改用 `Collections.synchronizedMap(HashMap)` 并自己保证复合操作安全）。

> **思考与练习**
>
> 1. 把 1.1 的丢数据程序分别换成 `Hashtable`、`Collections.synchronizedMap`、`ConcurrentHashMap`，用 `System.nanoTime()` 粗测 10 线程写入 10 万个 key 的耗时，体会锁粒度的差距。
> 2. `map.computeIfAbsent(k, this::slowLoad)` 里 `slowLoad` 耗时 2 秒，期间其他线程调用 `map.get(k)` 会被阻塞吗？（提示：get 不加锁，能读到"正在加载"吗？）
> 3. 面试题：为什么 `ConcurrentHashMap` 的读操作不需要加锁？请从 `volatile` 的三个落点回答。

---

## 九、面试速答（浓缩版）

**Q：ConcurrentHashMap JDK 7 和 JDK 8 实现有什么区别？**
A：JDK 7 是分段锁——Segment 数组，每段继承 ReentrantLock，并发度默认 16；JDK 8 取消分段，改为 Node 数组 + CAS（空桶插入）+ synchronized（锁桶头节点），并发度约等于桶数，并用红黑树优化长链表。

**Q：get 为什么不用加锁？**
A：table 数组、Node.val、Node.next 三处 volatile，读操作天然可见最新值；hash/key 是 final 不可变。整个读路径是无锁的 volatile 读。

**Q：put 什么时候用 CAS，什么时候用 synchronized？**
A：空桶插入是单变量替换，用 CAS 无锁完成；桶非空时需要多步操作（遍历/覆盖/树化），synchronized 锁住该桶头节点；遇到 ForwardingNode（MOVED）先协助扩容再重试。

**Q：扩容怎么做到多线程协助？**
A：达到阈值后某线程创建两倍新表，transferIndex 从右往左按段（≥16 桶）分配迁移任务；写线程碰到 ForwardingNode 就 helpTransfer 领一段搬；迁移桶时按 hash & oldCap 把链表拆成低/高两条分别放到 i 和 i+n；全程读写不阻塞。

**Q：size() 怎么实现的？**
A：baseCount + CounterCell[] 分散计数（LongAdder 思想），求和返回，高并发下准确但非严格瞬时一致。

---

## 结语

初级篇的三块积木，在这一个类里全部各就各位：

```
CAS        → 抢初始化权、空桶无锁插入、计数、扩容认领
synchronized → 锁单个桶的头节点（细粒度 + 锁升级加持）
volatile    → 数组、val、next 三处落点，撑起全程无锁读
```

`ConcurrentHashMap` 给我们最大的启发不是背面试题，而是一套**并发设计的通用方法论：先想能不能无锁（CAS/volatile），再想锁多细（锁桶不锁表），最后想怎么等（帮忙干活而不是干等）**。

下一篇《Java 并发进阶（05）：线程池》——为什么裸写 `new Thread()` 是大忌？核心线程数、队列、拒绝策略怎么配？我们将拆解 `ThreadPoolExecutor` 的执行流程与调优思路。敬请期待。
