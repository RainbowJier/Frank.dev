---
title: Spring Boot 事务实战：把 @Transactional 用对，看懂它为什么失效
date: 2026-08-18 10:00:00
categories:
  - 教程
tags:
  - Spring Boot
  - Java
  - 事务
  - MySQL
description: 从转账案例和 ACID 讲到 AOP 代理原理，重点拆解 @Transactional 的八个失效场景、七种传播行为与四大隔离级别，附实战清单和面试速答。
lang: zh-CN
---

> 后端面试有个经典连环炮：`@Transactional` 的原理是什么？事务什么时候会失效？传播行为说几个？这篇文章一次讲透。上一篇《Spring Boot 双支柱》讲 AOP 时带过一眼自调用失效，这篇把事务专题彻底展开——不背概念，先把原理拆开看，你会发现所有"失效场景"其实都是同一件事：**调用没经过代理**。

---

## 一、事务解决什么问题

### 1.1 一个会丢钱的转账

经典的转账场景：A 给 B 转 100 块，数据库层面是两条 UPDATE：

```java
package com.frank.spring.tx;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

@Service
public class TransferService {

    private final JdbcTemplate jdbc;

    public TransferService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // 反例：两步更新之间没有任何保护
    public void transferWithoutTx(long from, long to, int amount) {
        jdbc.update("UPDATE account SET balance = balance - ? WHERE id = ?", amount, from);
        int broken = 1 / 0;   // 模拟第二步执行前出问题
        jdbc.update("UPDATE account SET balance = balance + ? WHERE id = ?", amount, to);
    }
}
```

执行结果是：**A 的钱扣了，B 的钱没到**。100 块在数据库里"人间蒸发"。没有报错提示你数据不一致——第一条 UPDATE 已经生效，第二条永远没执行。

事务要做的，就是把这两条 SQL 捆绑成一个"同生共死"的整体：要么都成功，要么都当没发生过。

### 1.2 ACID：事务的四个承诺

| 特性 | 一句话 | MySQL（InnoDB）靠什么保证 |
|------|--------|--------------------------|
| 原子性 Atomicity | 要么全做，要么全不做 | undo log，回滚时用它撤销已执行的改动 |
| 一致性 Consistency | 从一个合法状态到另一个合法状态 | 原子性 + 隔离性 + 应用层约束共同兜底 |
| 隔离性 Isolation | 并发事务互不干扰 | 锁 + MVCC |
| 持久性 Durability | 提交了就不会丢 | redo log + 刷盘策略 |

注意分工：**这些能力全是数据库提供的**。Spring 不管持久性，也不懂 undo log，它做的事情只有一件——把"开事务、提交、回滚"这套 JDBC 动作自动化，让你不用手写 `setAutoCommit(false)` 和满屏的 try-catch。

---

## 二、Spring Boot 里怎么用

### 2.1 一个注解解决问题

```java
@Service
public class TransferService {

    private final JdbcTemplate jdbc;

    public TransferService(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // 正解：两条 SQL 同生共死
    @Transactional(rollbackFor = Exception.class)
    public void transfer(long from, long to, int amount) {
        jdbc.update("UPDATE account SET balance = balance - ? WHERE id = ?", amount, from);
        int broken = 1 / 0;   // 抛异常 → 两条 SQL 一起回滚
        jdbc.update("UPDATE account SET balance = balance + ? WHERE id = ?", amount, to);
    }
}
```

再执行 `transfer`，数据库不会有任何变化——第一条 UPDATE 被回滚了。

### 2.2 三个使用要点

1. **加在方法上（优先），必要时才加在类上**。类上的注解对该类所有方法生效，方法上的注解可以覆盖类上的配置。粒度越小越可控。
2. **永远显式写 `rollbackFor = Exception.class`**。默认规则是：只回滚 `RuntimeException` 和 `Error`。如果你的代码抛的是受检异常（比如 `IOException`），**默认不回滚，直接提交**——这是新人最常踩的默认行为陷阱。
3. **不用自己配置事务管理器**。只要引入了 `spring-boot-starter-jdbc`、MyBatis 或 JPA，Spring Boot 会自动装配 `DataSourceTransactionManager`，`@Transactional` 开箱即用。

---

## 三、@Transactional 背后发生了什么

### 3.1 代理：一切的答案

`@Transactional` 不是"魔法标记"，它的生效完全依赖 **AOP 动态代理**（JDK 代理与 CGLIB 的选型细节上一篇已拆过）。Spring 容器启动时，发现这个 Bean 有 `@Transactional` 方法，就会给它生成一个代理对象，真正注入到调用方的是**代理**，不是原始对象。

一次调用的完整旅程：

![图1：@Transactional 工作原理——AOP 代理接管事务边界](spring-tx-aop-proxy.svg)

1. 调用方调用的是**代理对象**的方法；
2. 代理里的 `TransactionInterceptor` 拦截这次调用，向事务管理器申请开启事务：拿到一个数据库连接、执行 `setAutoCommit(false)`；
3. 这个 Connection 被绑定到**当前线程**（`ThreadLocal`），然后才反射调用你的目标方法；
4. 方法体内的 MyBatis、JdbcTemplate 执行 SQL 时，从 `ThreadLocal` 里拿到的就是**同一个 Connection**——这就是"一个事务方法里的多条 SQL 天然在同一个事务里"的原因；
5. 方法正常返回 → 代理执行 `commit`；抛出异常 → 代理判断回滚规则后执行 `rollback`。

一句话总结：**事务的开启、提交、回滚全部发生在代理层，你的业务代码对这一切无感知**。这也顺带解释了初级篇讲过的 `ThreadLocal` 在 JDK 源码里的又一个真实用武之地——事务上下文就是靠线程绑定的，后面讲"多线程失效"时还会回到这一点。

### 3.2 记住这个模型

后面所有的失效场景、传播行为，都可以用这一张图推出来：

```
调用方 → [代理：开事务 → 执行目标方法 → 提交/回滚] → 数据库
```

判断事务是否生效，只需要问一个问题：**这次调用经过代理了吗？**

---

## 四、它为什么悄悄失效：八个高频场景

失效最坑的地方在于：**不报错、不告警，注解静静地不起作用**。下面八个场景覆盖了线上 99% 的"事务没回滚"事故。

### 4.1 头号杀手：同类自调用

```java
@Service
public class OrderService {

    public void createOrder(Order order) {
        // 前置校验、组装等逻辑……
        this.saveOrder(order);      // ← this 调用，注解失效！
    }

    @Transactional(rollbackFor = Exception.class)
    public void saveOrder(Order order) {
        orderMapper.insert(order);
        stockMapper.deduct(order.getSkuId(), order.getCount());
    }
}
```

`saveOrder` 明明标了注解，`deduct` 扣库存失败时 `insert` 却不会回滚。为什么？对照图 1 的模型：

![图2：自调用失效根源——this 调用直达目标对象，绕过了代理](spring-tx-self-invocation.svg)

外部调用 `createOrder` 时走了代理，但 `createOrder` 本身没有注解，代理只是放行；方法体内的 `this.saveOrder()` 是**原始对象自己调自己**——`this` 根本不是代理，这次调用完全绕开了代理层，`@Transactional` 自然形同虚设。

**三种解法**：

```java
// 解法一（推荐）：把 saveOrder 拆到另一个 Bean，结构上也更清晰
@Service
public class OrderRepository {
    @Transactional(rollbackFor = Exception.class)
    public void saveOrder(Order order) { ... }
}

// 解法二：注入自身代理——注意，注入的是代理，不是 this
@Service
public class OrderService {

    @Autowired
    @Lazy               // 打破循环依赖
    private OrderService self;

    public void createOrder(Order order) {
        self.saveOrder(order);     // 经代理，事务生效
    }

    @Transactional(rollbackFor = Exception.class)
    public void saveOrder(Order order) { ... }
}

// 解法三：AopContext 拿当前代理（需开启 exposeProxy = true，侵入性强，不常用）
((OrderService) AopContext.currentProxy()).saveOrder(order);
```

### 4.2 场景二：方法不是 public

Spring 文档明确说明：`@Transactional` 默认**只对 public 方法生效**。`protected`、`private`、包级私有方法上的注解会被静默忽略（CGLIB 场景下部分版本对 protected 有兼容，但别依赖它）。事务方法老老实实用 public。

### 4.3 场景三：异常被 try-catch 吞掉

```java
@Transactional(rollbackFor = Exception.class)
public void ship(long orderId) {
    try {
        orderMapper.updateStatus(orderId, "SHIPPED");
        logisticsClient.notify(orderId);      // 调第三方，抛了异常
    } catch (Exception e) {
        log.warn("物流通知失败，忽略", e);      // 异常被吞 → 状态照样提交！
    }
}
```

回滚的触发条件是**异常穿透到代理层**。你在方法内部把异常 catch 掉，代理看到的是"正常返回"，于是老老实实提交了。修复方式二选一：

```java
@Transactional(rollbackFor = Exception.class)
public void ship(long orderId) {
    try {
        orderMapper.updateStatus(orderId, "SHIPPED");
        logisticsClient.notify(orderId);
    } catch (Exception e) {
        // 方式一：标记回滚后重新抛出（推荐，调用方能感知失败）
        TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
        throw new OrderShipException("发货失败", e);
        // 方式二：只标记回滚不再抛出——事务最终回滚，方法"看似成功"
        // TransactionAspectSupport.currentTransactionStatus().setRollbackOnly();
    }
}
```

### 4.4 场景四：抛的是受检异常，且没写 rollbackFor

```java
@Transactional   // 没写 rollbackFor
public void upload(InputStream in) throws IOException {
    fileMapper.insert(...);
    storage.put(in);              // 抛 IOException（受检异常）
}
```

`IOException` 不是 `RuntimeException` 的子类，默认规则下**不回滚**。所以 2.2 节那句"永远显式写 `rollbackFor = Exception.class`"值得贴在显示器上。

### 4.5 场景五：数据库引擎不支持

事务是 InnoDB 的能力。如果表引擎是 **MyISAM**（不支持事务），注解写得再标准也白搭——`commit` 和 `rollback` 对它来说都是空操作。老项目接手时先 `SHOW TABLE STATUS` 检查一遍。

### 4.6 场景六：传播行为配置不当

把内层方法配成 `NOT_SUPPORTED`（以非事务方式运行）或 `NEVER`，内层自然没有事务保护；配成 `SUPPORTS` 时若外层没有事务，内层也不会开事务。传播行为是"我要不要事务"的声明，配错了等于主动放弃（下一节详解）。

### 4.7 场景七：多线程调用

```java
@Transactional(rollbackFor = Exception.class)
public void batchProcess(List<Task> tasks) {
    executor.submit(() -> taskMapper.insert(task));   // 子线程
    taskMapper.insertAll(tasks);                       // 主线程
}
```

回忆图 1：Connection 绑定在 **ThreadLocal** 上，只能当前线程看见。子线程从线程池里拿的是**另一个连接、另一个事务**，主线程回滚时管不到它；而且 `submit` 是异步的，主线程事务提交时子线程可能还没执行。事务不跨线程——多线程里要么把数据库操作收拢回同一线程，要么每个线程各自管理事务。

### 4.8 场景八：final 方法 / 对象不受 Spring 管理

- `final` 方法无法被 CGLIB 子类覆写，代理拦截不到它；
- `new OrderService()` 手动创建的对象不是 Spring 管理的 Bean，压根没有代理，注解必然失效。

### 4.9 失效场景速查表

| # | 场景 | 根因 | 解法 |
|---|------|------|------|
| 1 | 同类自调用 | `this` 调用绕过代理 | 拆 Bean / 注入自身代理 / AopContext |
| 2 | 非 public 方法 | 代理不拦截 | 改成 public |
| 3 | 异常被 catch 吞掉 | 异常没到达代理层 | 重抛 / `setRollbackOnly()` |
| 4 | 受检异常默认不回滚 | 默认只回滚运行时异常 | `rollbackFor = Exception.class` |
| 5 | MyISAM 表 | 引擎不支持事务 | 换 InnoDB |
| 6 | 传播行为配错 | 主动声明了不要事务 | 检查 propagation 配置 |
| 7 | 多线程调用 | 事务绑定 ThreadLocal | 收拢到同一线程 / 各自管理 |
| 8 | final 方法 / new 出来的对象 | 无法或没有代理 | 去 final / 交给 Spring 管理 |

八个场景，根因其实只有两类：**调用没经过代理**（1、2、8），**异常没到达代理**（3、4）；剩下的（5、6、7）是环境和配置问题。记住图 1 的模型，这张表就不用背。

---

## 五、传播行为：七种，重点记三个

### 5.1 什么是传播行为

当方法 A（有事务）调用方法 B（也声明了事务）时，B 怎么处理"当前已经有事务"这件事？这就是传播行为（propagation）。七种全列出来：

| 传播行为 | 当前有事务 | 当前无事务 | 一句话 |
|----------|-----------|-----------|--------|
| **REQUIRED**（默认） | 加入当前事务 | 新建事务 | 有则加入，无则新建 |
| **REQUIRES_NEW** | 挂起当前事务，另起新事务 | 新建事务 | 另起炉灶，互不干涉 |
| **NESTED** | 在当前事务内设保存点嵌套执行 | 新建事务 | 可部分回滚的嵌套 |
| SUPPORTS | 加入当前事务 | 非事务运行 | 随缘，有就有 |
| NOT_SUPPORTED | 挂起当前事务，非事务运行 | 非事务运行 | 明确不要事务 |
| MANDATORY | 加入当前事务 | 抛异常 | 必须有事务，否则报错 |
| NEVER | 抛异常 | 非事务运行 | 必须没事务，否则报错 |

日常真正用得上的是加粗的前三个：

![图3：REQUIRED / REQUIRES_NEW / NESTED 的事务边界对比](spring-tx-propagation.svg)

### 5.2 REQUIRED：同生共死（默认）

B 加入 A 的事务，**物理上是同一个事务**。B 里抛异常，整个事务标记回滚——即使 A 把 B 的异常 catch 住了，提交时也会报 `UnexpectedRollbackException`（事务已被标记 rollback-only）。绝大多数业务用默认值就对了。

### 5.3 REQUIRES_NEW：另起炉灶

A 挂起，B 拿**新的连接**开一个完全独立的事务。典型场景——操作日志必须落库，哪怕业务回滚了：

```java
@Service
public class AuditService {

    @Transactional(propagation = Propagation.REQUIRES_NEW,
                   rollbackFor = Exception.class)
    public void log(String action, String detail) {
        auditMapper.insert(action, detail, LocalDateTime.now());
    }
}
```

业务方法里调用 `auditService.log(...)`：业务成功 → 两个事务都提交；业务回滚 → 日志事务已独立提交，不受影响。审计、告警通知这类"旁观者"操作用它。

**注意它的代价**：B 会占用第二个数据库连接。如果连接池只剩一个连接，A 拿着连接等 B、B 又拿不到连接，就会互相等死——高并发下 REQUIRES_NEW 用多了要小心连接池耗尽。

### 5.4 NESTED：保存点回滚

B 在 A 的事务内部执行，入口处打一个 **Savepoint（保存点）**。B 失败可以只回滚到保存点，A 决定继续（用别的方案重试）还是整体回滚。和 REQUIRES_NEW 的区别：NESTED 是"同一个事务里的局部回滚"，依赖 JDBC 保存点，只能基于 DataSource 事务管理器使用。

---

## 六、隔离级别：并发事务互相能看到什么

### 6.1 三类读异常

并发事务之间如果没有隔离，会出现三种经典的"看不该看的东西"：

- **脏读**：事务 2 读到了事务 1 **尚未提交**的数据。事务 1 随后回滚，事务 2 拿着这个"从未存在过"的值去做了业务决策——比如根据未提交的余额放了贷款。
- **不可重复读**：事务 1 内两次读**同一行**，值不一样——中间事务 2 改了这行并提交。事务 1 前后两次读数对不上。
- **幻读**：事务 1 内两次执行**同一范围查询**，行数不一样——中间事务 2 插入/删除了符合条件的数据并提交。多出来的行像"幻影"。

### 6.2 四个级别一张图

隔离级别就是"你愿意用多大开销挡住这几类异常"：

![图4：四大隔离级别与三类读异常对照](spring-tx-isolation.svg)

MySQL InnoDB 默认 REPEATABLE READ，并且靠 MVCC + 间隙锁把幻读也基本挡住了，所以实际项目里很少需要动隔离级别。真有需要时用注解指定：

```java
@Transactional(isolation = Isolation.REPEATABLE_READ,
               rollbackFor = Exception.class)
public BigDecimal balance(long userId) {
    return accountMapper.selectBalance(userId);
}
```

要清楚：**隔离是数据库实现的能力，Spring 只是把枚举值透传给 Connection**。同一个 `Isolation.READ_COMMITTED`，在 MySQL 和 Oracle 上的实际行为细节并不相同，深挖可以去看我的 MySQL 系列。

---

## 七、实战清单

把上面的内容收敛成六条可执行的习惯：

1. **永远写 `rollbackFor = Exception.class`**——默认不回滚受检异常，这是性价比最高的一条防御。
2. **事务方法尽量短，只包数据库操作**。大事务三宗罪：长时间占用连接、锁持有时间变长（阻塞别人）、undo log 膨胀。
3. **RPC 调用、发 HTTP、写文件、发 MQ 挪出事务**。这些慢操作放在事务外面，或者放在事务提交之后（`TransactionSynchronization` 的 `afterCommit`）。
4. **纯查询方法加 `readOnly = true`**：驱动会向数据库传播只读提示，还能让 ORM 跳过脏检查提速。
5. **批量大任务分批提交**，一批一个独立事务，失败只重跑失败批次：

```java
@Service
public class ImportService {

    @Autowired
    @Lazy
    private ImportService self;   // 4.1 讲过：注入的是代理，不是 this

    public void importAll(List<Row> rows) {
        for (List<Row> batch : Lists.partition(rows, 500)) {
            self.importBatch(batch);   // 每批一个小事务
        }
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW,
                   rollbackFor = Exception.class)
    public void importBatch(List<Row> batch) {
        rowMapper.insertBatch(batch);
    }
}
```

6. **跨服务、跨库的一致性别硬上本地事务**。单个 `@Transactional` 管不了一次 HTTP 调用，分布式场景用 MQ 事务消息、本地消息表、TCC 这类最终一致性方案——这是另一个话题了。

> **思考与练习**
>
> 1. 把 4.1 的自调用例子跑起来，在 `saveOrder` 里抛异常，观察 `insert` 是否回滚；再分别用"拆 Bean"和"注入自身代理"两种解法验证事务恢复生效。
> 2. 在 REQUIRED 传播下，A 调 B、B 抛异常但 A catch 住了——预测最终结果，再用代码验证（提示：`UnexpectedRollbackException`）。
> 3. 面试题：为什么 `@Transactional` 的信息存在 ThreadLocal 里，就注定了事务不能跨线程？

---

## 八、面试速答（浓缩版）

**Q：@Transactional 的原理？**
A：基于 AOP 动态代理。容器为含事务注解的 Bean 生成代理，调用进入代理后由 `TransactionInterceptor` 拦截：事务管理器开启事务（拿连接、`setAutoCommit(false)`、绑定 ThreadLocal）→ 执行目标方法 → 正常返回则 commit，按回滚规则抛异常则 rollback。

**Q：事务失效有哪些场景？**
A：核心两类——调用没经过代理：同类自调用（this 调用）、非 public 方法、final 方法、对象没交给 Spring 管理；异常没到达代理：异常被 catch 吞掉、受检异常且未配 rollbackFor。另有：MyISAM 不支持事务、传播行为配成 NOT_SUPPORTED/NEVER、多线程拿不到 ThreadLocal 里的连接。

**Q：默认回滚哪些异常？**
A：RuntimeException 和 Error。受检异常默认提交不回滚，所以要显式写 `rollbackFor = Exception.class`。

**Q：REQUIRED、REQUIRES_NEW、NESTED 的区别？**
A：REQUIRED 加入当前事务，同一物理事务，共进退；REQUIRES_NEW 挂起当前事务、拿新连接开独立事务，互不影响，适合审计日志；NESTED 在当前事务内打 Savepoint，支持局部回滚，依赖 JDBC 保存点。前两个是两个物理事务（挂起场景），NESTED 是一个物理事务内的逻辑嵌套。

**Q：大事务有什么危害，怎么优化？**
A：危害——长占用连接拖垮连接池、锁持有时间长引发阻塞、undo log 膨胀、主从延迟加大。优化——事务只包数据库操作，RPC/MQ/文件 IO 挪出事务或放到 afterCommit；大批量拆小批独立提交；查询用 readOnly。

**Q：隔离级别 Spring 能控制吗？**
A：只能"透传"。`@Transactional(isolation=…)` 最终调用 Connection 的隔离级别设置，真正的隔离能力由数据库实现；MySQL 默认 REPEATABLE READ，靠 MVCC + 间隙锁基本消除幻读。

---

## 结语

把 `@Transactional` 想明白之后，它其实特别朴素：

```
它是什么   → 代理替你执行的开事务 / 提交 / 回滚三步 JDBC 动作
为什么会失效 → 调用没经过代理，或异常没活着到达代理
怎么用好它 → rollbackFor 写全、事务切小、传播行为想清楚再配
```

不用背八条失效场景，记住图 1 那条链路——**调用方 → 代理 → 目标方法 → 提交/回滚**——任何"事务为什么不回滚"的问题，沿着这条链路检查一遍，答案自然浮出来。

Spring 的话题往后还会写：编程式事务、`@Transactional` 与 MQ 的最终一致性配合、多数据源下的事务管理。这篇先把单库事务的地基打牢。

---

**系列阅读**：

- {% post_link articles/Springboot/springboot-ioc-aop 'Spring Boot 双支柱：把 IoC 和 AOP 一次讲透' %}
- {% post_link articles/Java/01-java-multithreading-fundamentals 'Java 并发入门（01）：多线程基础' %}
- {% post_link articles/Java/02-java-thread-safety-and-mutex 'Java 并发入门（02）：线程安全与互斥' %}
- {% post_link articles/Java/03-java-inter-thread-communication 'Java 并发入门（03）：线程间通信' %}
- {% post_link articles/Java/04-java-concurrent-hashmap 'Java 并发进阶（04）：ConcurrentHashMap 为什么又快又安全' %}
- {% post_link articles/Java/java-api-rate-limiting '接口限流：从计数器到令牌桶的四种方案' %}
