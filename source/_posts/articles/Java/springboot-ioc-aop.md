---
title: Spring Boot 双支柱：把 IoC 和 AOP 一次讲透
date: 2026-08-18 20:00:00
categories:
  - 教程
tags:
  - Java
  - Spring Boot
  - Spring
  - IoC
  - AOP
description: 用大白话拆解 Spring Boot 的两大核心：IoC 容器到底"反转"了什么、Bean 生命周期与三级缓存如何解循环依赖、AOP 切面结构与五种通知、JDK 与 CGLIB 动态代理选型，最后汇总 @Transactional 自调用失效等常见坑。
lang: zh-CN
---

> 并发系列聊的是 Java 语言层的功力，从这篇开始进入框架层。Spring Boot 再花哨，底座其实就两根柱子：**IoC 容器**管所有对象的生老病死，**AOP 代理**在不改一行业务代码的前提下给对象"加戏"。Bean 生命周期、循环依赖、事务失效这些高频面试题，全部长在这两根柱子上。这篇把它们一次讲透。

---

## 一、IoC：把"造对象"的权力交出去

### 1.1 没有 IoC 的世界：new 出来的泥潭

先看一段"手工作坊"式代码：

```java
public class OrderService {
    // 自己 new，自己负责装配
    private final UserService userService = new UserService();
    private final RiskService riskService =
            new RiskService(new RedisClient("localhost", 6379));
}
```

看起来没毛病，麻烦在后头：

- `RedisClient` 换个地址、换个实现类，`OrderService` 得跟着改；
- `UserService` 构造器加个参数，所有 new 过它的地方**全部重写**；
- 想单独测 `OrderService`？对不起，先连上 Redis、连上数据库，否则连对象都造不出来。

这就是**强耦合**：每个类都要认识自己的全部下游，还要认识下游的下游。依赖链条越拉越长，改一处，崩一片。

![图1：对象从哪来——自己 new 的耦合链（A）与容器统一装配（B）](/images/svg/spring-ioc-new-vs-container.svg)

### 1.2 控制反转，到底反转了什么

答案是：**对象创建的控制权**。

- 传统写法：我要用 `UserService`，所以**我**去 new——主动权在我手里；
- IoC 写法：我只声明"我需要一个 `UserService`"，容器负责创建、装配、递到我手上——主动权交出去了。

打个比方：以前你想吃饭，得自己买菜、做饭、洗碗；现在你只管下单，平台把成品送上门。**菜从哪来、谁做的，你不用管，也管不着。**

```java
@Service
public class OrderService {
    private final UserService userService;   // 只声明"我要什么"

    public OrderService(UserService userService) {   // 容器把成品递进来
        this.userService = userService;
    }
}
```

两个常被混用的词在这就算分清了：**IoC 是思想**（创建权反转），**DI（依赖注入）是实现手段**（容器把依赖塞进你的字段/构造器）。顺带一提，"别打电话给我们，我们会打给你"（Don't call us, we'll call you）说的就是它——框架调你，而不是你调框架。

### 1.3 容器怎么知道要造谁

两条路，殊途同归——都是往容器里注册 Bean 定义：

```java
// 路线一：组件扫描 + 类上注解（业务代码最常用）
@Component        // 通用组件
@Service          // 业务层
@Repository       // 数据层
@Controller       // 控制层（后面三个本质上都是 @Component 的"马甲"）
public class UserService { ... }

// 路线二：@Configuration 类里手动 @Bean（引第三方库时常用，因为人家源码加不了注解）
@Configuration
public class RedisConfig {
    @Bean
    public RedisClient redisClient() {
        return new RedisClient("redis.frank.dev", 6379);
    }
}
```

`@SpringBootApplication` 默认从主类所在包开始向下扫描，扫到注解就注册，启动时统一实例化。这也是为什么**主类要放在根包**——放偏了，扫不到，容器里就是空的。

### 1.4 三种注入方式：为什么官方推荐构造器

```java
// ① 字段注入：最省事，也最被嫌弃
@Service
public class OrderService {
    @Autowired
    private UserService userService;
}

// ② Setter 注入：适合可选依赖（没有也能跑）
@Autowired
public void setUserService(UserService userService) {
    this.userService = userService;
}

// ③ 构造器注入：官方推荐（Spring 4.3 起唯一构造器可省 @Autowired）
@Service
public class OrderService {
    private final UserService userService;

    public OrderService(UserService userService) {
        this.userService = userService;
    }
}
```

构造器注入好在哪：

- 字段能标 `final`，注入后不可变，线程安全白拿（呼应并发系列讲的"共享可变状态是万恶之源"）；
- **依赖不齐根本造不出对象**，问题在启动期就爆，而不是拖到线上某个深夜 NPE；
- 单元测试直接 `new OrderService(mockUserService)`，不需要反射工具硬塞字段；
- 循环依赖当场暴露——两个类构造器互相要对方，启动直接报错，逼你把设计掰正。

### 1.5 Bean 生命周期：从容器的视角看一个对象

面试高频题。与其背八股，不如跑一遍代码：

```java
@Component
public class LifecycleDemo {

    public LifecycleDemo() {
        System.out.println("1. 构造器：对象造出来了，字段还都是 null");
    }

    @Autowired
    public void setDependency(UserService userService) {
        System.out.println("2. 属性填充：依赖被容器塞了进来");
    }

    @PostConstruct
    public void init() {
        System.out.println("3. @PostConstruct：初始化完成，可以干活了");
    }

    @PreDestroy
    public void shutdown() {
        System.out.println("4. @PreDestroy：容器关闭，临终遗言");
    }
}
```

启动后输出：

```
1. 构造器：对象造出来了，字段还都是 null
2. 属性填充：依赖被容器塞了进来
3. @PostConstruct：初始化完成，可以干活了
（容器关闭时）
4. @PreDestroy：容器关闭，临终遗言
```

（Spring Boot 3 起注意 `@PostConstruct`/`@PreDestroy` 的包从 `javax.annotation` 搬到了 `jakarta.annotation`。）

把这套流程展开，就是完整的八步生命周期：

![图2：Bean 生命周期——从构造到销毁的八个阶段，⑥ 是 AOP 的入口](/images/svg/spring-bean-lifecycle.svg)

**盯住第 ⑥ 步**：初始化后的"后置处理"（`BeanPostProcessor`）会在 Bean 就绪前做一次"最后一道加工"——如果这个 Bean 命中了任何切面，**容器放进单例池的就不是原始对象，而是它的代理**。AOP 就是从这里偷偷进来的，第三节细说。

### 1.6 循环依赖与三级缓存

A 要 B，B 要 A，谁也没法先造完自己：

```java
@Service
public class A {
    private final B b;
    public A(B b) { this.b = b; }
}

@Service
public class B {
    private final A a;
    public B(A a) { this.a = a; }
}
```

Spring Boot 2.6 起启动直接报错：

```
The dependencies of some of the beans in the application context form a cycle:

┌─────┐
|  a
└─────┘
   ↑     ↓
|  b
└─────┘
```

但setter/字段注入的循环依赖，老版本 Spring 其实能自动解——靠的就是著名的**三级缓存**：

![图3：三级缓存如何拆解 A、B 互相依赖的死结](/images/svg/spring-circular-three-caches.svg)

精髓在第三级的"对象工厂"：它像一个承诺书——"A 现在还是半成品，但如果有人急着要，我能现场提前生成一个带代理的早期引用给你"。**只有真的发生循环依赖，这个工厂才会兑现**；一切顺利的话，代理照旧等到初始化之后再生成，设计语义不被破坏。只用两级缓存做不到"按需提前"，这就是第三级存在的理由。

两个必须知道的边界：

- **构造器注入的循环依赖无解**：实例化阶段就需要对方，而三级缓存在实例化**之后**才介入。Spring 只能报错（建议的解法永远是重构，比如把互相调用的部分抽成第三个类）；
- **Spring Boot 2.6+ 默认禁止循环依赖**，除非显式配置 `spring.main.allow-circular-reference=true`——官方态度很明确：能跑不代表设计对。

### 1.7 顺带说作用域

容器里的 Bean 默认都是**单例**（singleton）：整个容器一个实例，所有人共用。改成 `@Scope("prototype")` 则每次获取都造新的，另有 request/session 等 Web 作用域。

默认单例 + 有状态字段 = 并发事故预定。**单例 Bean 里不要放可变的成员变量**，这个坑在第四节还会点名。

---

## 二、AOP：把重复的"边角活"抽出去

### 2.1 横切关注点：每个方法都要裹一层壳？

看一段熟悉得不能再熟悉的代码：

```java
public Order create(OrderRequest req) {
    long start = System.currentTimeMillis();
    log.info("create 入参: {}", req);
    try {
        // ……20 行真正的业务逻辑
        log.info("create 耗时: {}ms", System.currentTimeMillis() - start);
        return order;
    } catch (Exception e) {
        log.error("create 异常", e);
        throw e;
    }
}
// refund()、cancel()、query()……每个方法把这套壳复制一遍
```

日志、计时、事务、权限校验——这些**横切关注点**（cross-cutting concerns）跟业务逻辑半毛钱关系没有，却散落在每个方法里。AOP（面向切面编程）的思路：把"壳"收拢到一处，业务方法只写业务。

### 2.2 五个概念，用地铁安检对号入座

| 术语 | 地铁安检里对应 | 在代码里是 |
|------|----------------|-----------|
| 连接点 JoinPoint | 每一个进站的人 | 程序里所有可以被拦截的点（Spring 里就是方法执行） |
| 切点 Pointcut | "只查背包大的"筛选规则 | 表达式：从连接点里挑出真正要管的那批方法 |
| 通知 Advice | 安检的具体动作 | 在选中位置执行的代码（方法前？方法后？环绕？） |
| 切面 Aspect | 一整套安检规程 | 切点 + 通知的组合，一个类 |
| 织入 Weaving | 把安检门装到入口处 | 把切面应用到目标对象、生成代理的过程 |

![图4：切点从连接点中筛选目标（A），五种通知切入方法执行轴（B）](/images/svg/spring-aop-pointcut-advice.svg)

### 2.3 实战：一个接口耗时统计切面

先加依赖（Spring Boot 里 AOP 已经自动配好，只差这一个小吐槽：很多老项目就是漏了这个 starter，切面死活不生效）：

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-aop</artifactId>
</dependency>
```

然后写切面：

```java
@Aspect
@Component
public class ApiTimingAspect {

    private static final Logger log = LoggerFactory.getLogger(ApiTimingAspect.class);

    // 切点：com.frank.shop 包及子包下，所有 *Service 类的 public 方法
    @Pointcut("execution(public * com.frank.shop..*Service.*(..))")
    public void serviceMethods() {}

    @Around("serviceMethods()")
    public Object around(ProceedingJoinPoint pjp) throws Throwable {
        String method = pjp.getSignature().toShortString();
        long start = System.currentTimeMillis();
        try {
            Object result = pjp.proceed();          // 放行目标方法
            log.info("{} 耗时 {}ms", method, System.currentTimeMillis() - start);
            return result;
        } catch (Throwable e) {
            log.error("{} 异常", method, e);
            throw e;                                 // 别吞异常，原样抛出
        }
    }
}
```

调用任意 Service 方法，日志里多了一行：

```
INFO  OrderService.create(..) 耗时 42ms
```

业务代码一行没动，所有方法自动有了耗时统计。五种通知全家福：

```java
@Before("serviceMethods()")                                  // 方法前
@AfterReturning(value = "serviceMethods()", returning = "ret") // 正常返回后，能拿到返回值
@AfterThrowing(value = "serviceMethods()", throwing = "e")     // 抛异常后，能拿到异常
@After("serviceMethods()")                                   // 相当于 finally，正常异常都走
@Around("serviceMethods()")                                  // 包全场：前、后、异常全管
```

同一切面内的执行顺序（Spring 5.2.7+）：**@Around 前半段 → @Before → 目标方法 → @After → @AfterReturning**；抛异常时尾部变成 @After → @AfterThrowing。5.2.7 之前 @After 排在 @AfterReturning 之后，老项目升级时留意。

### 2.4 代理是怎么生成的：JDK vs CGLIB

Spring AOP 的本质是**运行时动态代理**：容器发现 `OrderService` 命中切面，就不把原始对象给你，而是给一个"包装过"的代理对象——方法调用先经过增强逻辑，再转发给原始对象。Java 里造代理有两条路：

![图5：JDK 动态代理与 CGLIB 的构造方式及默认选型](/images/svg/spring-proxy-jdk-vs-cglib.svg)

验证一下你拿到的到底是什么：

```java
@SpringBootApplication
public class DemoApplication {
    public static void main(String[] args) {
        ApplicationContext ctx =
                new SpringApplicationBuilder(DemoApplication.class).run(args);
        System.out.println(ctx.getBean(OrderService.class).getClass());
    }
}
```

输出：

```
class com.frank.shop.OrderService$$SpringCGLIB$$0
```

`$$SpringCGLIB$$0`——你的"OrderService"其实是个运行时生成的 CGLIB 子类。**Spring Boot 2.x 起默认 `proxy-target-class=true`，不管有没有接口一律走 CGLIB**；纯 Spring（非 Boot）才默认"有接口用 JDK 代理，没接口用 CGLIB"。

### 2.5 最大的坑：自调用失效

代理再神，也有个命门。看代码：

```java
@Service
public class OrderService {

    @Transactional
    public void updateOrder() { ... }      // 外部调用：走代理，事务生效

    public void batchUpdate() {
        // this 是原始对象，不是代理！
        this.updateOrder();                // 事务、切面全部失效
    }
}
```

为什么？容器里注入给别人的是**代理对象**，但对象内部 `this` 永远指向**原始对象自己**。外部调用先过代理（增强生效）；方法内部的 `this.xxx()` 压根不经过代理——抄了近路，也躲掉了所有增强。

![图6：自调用为什么失效——this 拿到的是原始对象](/images/svg/spring-aop-self-invocation.svg)

这就是面试常问的 **@Transactional 失效场景之一**。三种解法：

```java
// 解法一：注入"自己"（拿到的其实是代理）
@Service
public class OrderService {
    @Resource
    private OrderService self;

    public void batchUpdate() {
        self.updateOrder();                // 走代理，事务生效
    }
}

// 解法二：AopContext 拿当前代理（需 @EnableAspectJAutoProxy(exposeProxy = true)）
((OrderService) AopContext.currentProxy()).updateOrder();

// 解法三（最推荐）：把 updateOrder 拆到另一个 Bean，职责顺便理清
```

---

## 三、合体时刻：AOP 长在 IoC 的哪一环

把两根柱子接起来，整个故事就闭环了：

1. **IoC 负责"造"**：扫描、实例化、属性填充、初始化，产出一个个 Bean（1.5 节的八步）；
2. **第 ⑥ 步"初始化后处理"是 AOP 的加工车间**：`BeanPostProcessor` 检查这个 Bean 是否命中任何切面，命中就生成代理，**把代理放回容器**；
3. 之后所有人 `@Autowired` 拿到的、`getBean()` 拿到的，都是代理。

所以那句绕口的总结可以这么记：**IoC 造好 Bean，AOP 在出库前把 Bean 换成"加强版"，你拿到的从来不是裸对象。** 事务、缓存注解（`@Transactional`、`@Cacheable`）、异步注解（`@Async`）全是同一套机制——没有代理，这些注解全是摆设。

---

## 四、常见坑清单

1. **循环依赖默认报错**（Boot 2.6+）。别急着开 `allow-circular-reference=true`，先想想设计是不是该改。
2. **@Transactional 失效全家桶**：自调用（见 2.5）；方法不是 `public`；异常被 try-catch 吃掉没抛出；默认只回滚 `RuntimeException` 和 `Error`——受检异常要 `@Transactional(rollbackFor = Exception.class)`。
3. **private / final / static 方法无法被增强**：CGLIB 靠生成子类覆写方法实现，覆写不了这三个。切面"不生效"，先看方法签名。
4. **new 出来的对象没有增强**：`new OrderService()` 是你自己造的，跟容器、代理都没关系。
5. **切点切太宽**：`execution(* com..*.*(..))` 这种表达式会让全站方法进拦截链，性能和排障成本都翻倍。切点收紧，多切面用 `@Order` 控制顺序（值越小优先级越高）。
6. **单例 Bean 放可变状态**：默认 singleton 意味着并发共享，成员变量当缓存用就是数据竞争。复习可翻并发系列第 04 篇。

---

## 五、总结

一张图记住两根柱子：

- **IoC 回答"对象从哪来"**——别自己 new，声明依赖，容器装配。代价是你要懂它的生命周期：构造 → 填充 → 初始化 →（必要时）换成代理 → 销毁；
- **AOP 回答"对象怎么被增强"**——切点挑方法，通知定时机，容器在出库前把原始对象换成代理。代价是你要懂代理的边界：this、final、private 都绕得开它。

下一篇回到并发系列，补上欠下的《线程池》——正好也回答一个问题：Spring 里 `@Async` 的线程池，到底该怎么配才不翻车。

---

**系列阅读**：

- {% post_link articles/Java/01-java-multithreading-fundamentals 'Java 并发入门（01）：多线程基础' %}
- {% post_link articles/Java/02-java-thread-safety-and-mutex 'Java 并发入门（02）：线程安全与互斥' %}
- {% post_link articles/Java/03-java-inter-thread-communication 'Java 并发入门（03）：线程间通信' %}
- {% post_link articles/Java/04-java-concurrent-hashmap 'Java 并发进阶（04）：ConcurrentHashMap 为什么又快又安全' %}
