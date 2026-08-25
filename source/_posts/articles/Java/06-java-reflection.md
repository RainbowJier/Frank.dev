---
title: Java 反射：从 Class 对象到运行时调用
date: 2026-08-24 11:00:00
categories:
  - 教程
tags:
  - Java
  - 反射
  - JVM
description: 从 Class 对象、成员查找和动态调用讲透 Java 反射，说明 get 与 getDeclared 的区别、trySetAccessible 的边界、运行时注解的用法，以及在框架开发中如何安全地使用反射。
lang: zh-CN
---

> 反射经常被讲成“可以绕过 private 的黑魔法”，这很容易把重点带偏。它真正的价值是：**程序在运行时读取类的元数据，并在类型事先未知时完成创建、查询与调用。** Spring 的依赖注入、JSON 序列化、JUnit 测试发现、插件机制，背后都离不开这项能力。

## 一、反射到底解决什么问题

正常写 Java 时，类型、方法名和参数类型大多在编译前就确定：

```java
UserService userService = new UserService();
userService.save(user);
```

编译器会帮我们检查 `save` 是否存在、参数是否匹配；IDE 重命名方法时也能安全地改掉所有调用点。这叫**编译期绑定**，是绝大多数业务代码的首选。

但有些场景在编译时并不知道要操作谁：

- 配置文件写的是类名，应用启动后才决定加载哪个实现；
- 框架扫描到 `@Controller`、`@Test` 之类的注解，才知道哪些方法需要执行；
- 序列化框架拿到一段 JSON，必须根据字段名给对象赋值；
- 插件系统只约定接口或注解，具体实现由后来接入的模块提供。

这时，程序需要先问“这个类有哪些构造器、字段、方法和注解”，再决定怎么做。反射提供的就是这扇运行时观察窗口。

**反射不是为了替代面向对象调用，而是为了解决运行时类型未知的问题。** 如果类型在编译期就确定，直接调用通常更安全、更清晰，也更容易重构。

---

## 二、`Class<?>`：进入运行时元数据的入口

每个已经被加载的 Java 类型，JVM 都会用一个 `Class<?>` 对象描述它。构造器、字段、方法、注解、修饰符、父类与接口等元数据，都从这个对象开始查询。

![图 1：Class 对象提供类的运行时元数据入口](java-reflection-class-metadata.svg)

### 2.1 三种常见获取方式

```java
package com.frank.reflection;

public final class ClassEntryDemo {

    public static void main(String[] args) throws ClassNotFoundException {
        Class<User> byLiteral = User.class;

        User user = new User("Frank", 26);
        Class<? extends User> byObject = user.getClass();

        Class<?> byName = Class.forName("com.frank.reflection.ClassEntryDemo$User");

        System.out.println(byLiteral == byObject); // true
        System.out.println(byLiteral == byName);   // true
    }

    static final class User {
        private final String name;
        private int age;

        User(String name, int age) {
            this.name = name;
            this.age = age;
        }
    }
}
```

三者都能拿到同一个类型对应的 `Class` 对象，但语义不同：

| 写法 | 适用场景 | 初始化特点 |
| --- | --- | --- |
| `User.class` | 编译期已经知道类型 | 取得类字面量本身不会触发类初始化 |
| `user.getClass()` | 已经有对象实例 | 对象既已创建，所属类当然已经可用 |
| `Class.forName("全限定类名")` | 类名来自配置、扫描或插件 | 默认会加载并初始化类 |

需要“只加载、不初始化”时，可以使用三参数重载：

```java
ClassLoader loader = Thread.currentThread().getContextClassLoader();
Class<?> type = Class.forName("com.example.Plugin", false, loader);
```

第三个参数为 `false` 时，静态字段初始化和静态代码块暂不执行。框架做类型探测时常会这样避免副作用。

### 2.2 `get*` 与 `getDeclared*`，别记反

反射 API 最常见的坑，是没有搞清“可见成员”和“本类声明成员”的范围：

| API | 查询范围 | 是否包含继承成员 | 是否能拿到 private 成员 |
| --- | --- | --- | --- |
| `getFields()` | public 字段 | 是 | 否 |
| `getDeclaredFields()` | 当前类声明的全部字段 | 否 | 是 |
| `getMethods()` | public 方法 | 是 | 否 |
| `getDeclaredMethods()` | 当前类声明的全部方法 | 否 | 是 |
| `getConstructor(...)` | public 构造器 | 不适用 | 否 |
| `getDeclaredConstructor(...)` | 当前类声明的构造器 | 不适用 | 是 |

一句话记忆：**`get` 看对外公开能力，`getDeclared` 看这个类自己写了什么。**

例如，扫描一个实体自身的私有字段要使用 `getDeclaredFields()`；而一个框架若只需要调用对象暴露给外界的公共方法，`getMethods()` 往往更符合语义。它们返回的数组顺序不应该被当成业务规则依赖。

### 2.3 运行时注解也是元数据

反射只能读取保留到运行时的注解。没有写 `RetentionPolicy.RUNTIME` 的注解，编译后不会以反射可读的形式保留：

```java
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
@interface Command {
    String value();
}
```

`getAnnotations()` 会返回当前元素可见的运行时注解；`getDeclaredAnnotations()` 则只看当前元素自己声明的注解。对于类注解，“继承”还受注解类型是否标记 `@Inherited` 影响；方法注解并不会因为覆写而自动继承。

---

## 三、从查找成员到动态调用

反射的完整过程可以概括成四步：获取 `Class`、按名称和参数类型定位成员、确认访问权限、执行操作并处理异常。

![图 2：Java 反射的成员定位、访问检查与调用流程](java-reflection-invocation-flow.svg)

下面的例子把构造对象、读写字段、调用实例方法和静态方法放在一起：

```java
package com.frank.reflection;

import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;

public final class ReflectionInvokeDemo {

    public static void main(String[] args) throws ReflectiveOperationException {
        Class<User> type = User.class;

        Constructor<User> constructor = type.getDeclaredConstructor(String.class, int.class);
        if (!constructor.trySetAccessible()) {
            throw new IllegalAccessException("不能访问 User 构造器");
        }
        User user = constructor.newInstance("Frank", 26);

        Field age = type.getDeclaredField("age");
        if (!age.trySetAccessible()) {
            throw new IllegalAccessException("不能访问 age 字段");
        }
        age.setInt(user, 27);

        Method greet = type.getDeclaredMethod("greet", String.class);
        if (!greet.trySetAccessible()) {
            throw new IllegalAccessException("不能访问 greet 方法");
        }
        String message = (String) greet.invoke(user, "你好");
        System.out.println(message);

        Method category = type.getDeclaredMethod("category");
        String kind = (String) category.invoke(null);
        System.out.println(kind);
    }

    static final class User {
        private final String name;
        private int age;

        private User(String name, int age) {
            this.name = name;
            this.age = age;
        }

        private String greet(String prefix) {
            return prefix + "，我是 " + name + "，今年 " + age + " 岁";
        }

        static String category() {
            return "member";
        }
    }
}
```

几个关键点：

1. **构造对象请用 `getDeclaredConstructor().newInstance()`**。旧的 `Class#newInstance()` 已废弃，它会丢失构造器异常信息，也无法表达带参数构造器。
2. **重载方法的参数类型必须精确匹配**。`getDeclaredMethod("setAge", Integer.class)` 找不到 `setAge(int)`；基本类型和包装类型不是一回事。
3. **实例成员的 `invoke`、`get`、`set` 第一个参数是目标对象**；静态成员没有目标对象，传 `null` 即可。
4. **`trySetAccessible()` 不是万能钥匙**。它只是在 JVM 允许时关闭 Java 语言层面的访问检查；JDK 9 之后，命名模块没有导出或开放对应包时，它仍可能返回 `false`，或在使用 `setAccessible(true)` 时抛出异常。

### 3.1 异常别一把抓

反射调用可能抛出许多受检异常，它们正好告诉我们失败发生在哪一层：

| 异常 | 表示什么 | 应对方式 |
| --- | --- | --- |
| `ClassNotFoundException` | 类名不存在或类加载器找不到 | 校验配置、检查类加载器边界 |
| `NoSuchFieldException` / `NoSuchMethodException` | 成员名或参数签名不匹配 | 显式校验名称与参数类型 |
| `IllegalAccessException` | 无权访问该成员 | 优先调整设计或模块开放范围 |
| `InstantiationException` | 不能实例化抽象类、接口等类型 | 先校验类型是否可构造 |
| `InvocationTargetException` | 被调用的方法本身抛了异常 | 通过 `getCause()` 获取真实业务异常 |

尤其是最后一个：`Method.invoke()` 成功进入目标方法后，目标方法抛出的异常会被包进 `InvocationTargetException`。日志里只打印外层异常，很容易把业务错误误判为“反射失败”。

```java
try {
    method.invoke(target, arguments);
} catch (java.lang.reflect.InvocationTargetException e) {
    Throwable businessError = e.getCause();
    throw new IllegalStateException("目标方法执行失败", businessError);
}
```

---

## 四、实战：一个最小的注解命令执行器

反射最自然的用途，是让框架根据约定发现能力，而不是把任意方法暴露给外部。下面约定只有标注 `@Command` 的方法可以被调用，且只接收 `String` 参数：

```java
package com.frank.reflection;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.Arrays;

public final class CommandRunner {

    @Target(ElementType.METHOD)
    @Retention(RetentionPolicy.RUNTIME)
    @interface Command {
        String value();
    }

    static final class AdminCommands {

        @Command("reindex")
        public void rebuildIndex(String indexName) {
            System.out.println("开始重建索引：" + indexName);
        }

        @Command("clear-cache")
        public void clearCache(String region) {
            System.out.println("清理缓存区域：" + region);
        }
    }

    public static void run(Object target, String command, String argument)
            throws ReflectiveOperationException {
        Method method = Arrays.stream(target.getClass().getDeclaredMethods())
                .filter(candidate -> candidate.isAnnotationPresent(Command.class))
                .filter(candidate -> candidate.getAnnotation(Command.class).value().equals(command))
                .findFirst()
                .orElseThrow(() -> new NoSuchMethodException("未注册命令：" + command));

        if (method.getParameterCount() != 1 || method.getParameterTypes()[0] != String.class) {
            throw new IllegalArgumentException("命令签名必须是 (String)");
        }
        if (!method.trySetAccessible()) {
            throw new IllegalAccessException("命令方法不可访问：" + method.getName());
        }

        try {
            method.invoke(target, argument);
        } catch (InvocationTargetException e) {
            throw new IllegalStateException("命令执行失败：" + command, e.getCause());
        }
    }

    public static void main(String[] args) throws ReflectiveOperationException {
        run(new AdminCommands(), "reindex", "products");
    }
}
```

这里有两个刻意保留的安全边界：

- 命令从**已有对象的已标注方法**中查找，而不是接受外部传来的任意“类名 + 方法名”；
- 执行前检查参数数量和类型，真实项目还应对命令名、参数内容、调用者身份和审计日志做白名单控制。

Spring 的依赖注入会扫描注解并注入字段或构造器；JSON 框架会根据字段和访问器映射数据；测试框架会发现测试方法；RuoYi 的 Quartz 任务也会按配置定位目标 Bean 和方法。这些场景的共同点不是“反射很酷”，而是**框架先制定边界，再在边界内动态发现和调用**。

---

## 五、直接调用还是反射调用

![图 3：编译期直接调用与运行时反射的适用边界](java-reflection-direct-vs-runtime.svg)

直接调用和反射并不是谁更高级，而是解决的问题不同：

| 维度 | 直接调用 | 反射调用 |
| --- | --- | --- |
| 类型检查 | 编译期完成 | 运行时才发现问题 |
| 重构支持 | IDE 能安全重命名与查找引用 | 字符串名称容易漏改 |
| 可读性 | 调用关系直观 | 需要追踪元数据和约定 |
| 灵活性 | 类型必须预先确定 | 可处理运行时发现的类型与成员 |
| 典型场景 | 绝大多数业务服务 | 框架、插件、序列化、注解驱动扩展 |

性能也应放在正确的位置理解：反射确实多了成员查找、访问检查、可变参数组装与动态分派等成本，但真正容易出问题的通常不是单次 `invoke`，而是把反射查找放在高频循环里，或用它掩盖了本应明确的接口设计。

在稳定的热路径上，优先直接调用；如果反射确实是框架边界不可缺少的一环，至少应缓存 `Method`、`Field`、`Constructor` 等已解析成员，避免每次请求重复按字符串查找。

---

## 六、生产使用反射的六条原则

### 6.1 先定义边界，再执行动态调用

不要让 HTTP 参数直接决定 `Class.forName()` 的类名和 `Method.invoke()` 的方法名。攻击者可以借此探测内部类型，甚至触发不该暴露的行为。应从受信任的注册表、注解扫描结果或白名单中选择目标。

### 6.2 优先公共 API，少碰私有成员

调用 public 构造器、方法和访问器，更符合封装，也更不容易在 JDK 升级、模块化或业务重构后失效。只有做框架适配、兼容旧模型等明确场景，才审慎使用 `trySetAccessible()`。

### 6.3 缓存元数据，但不要缓存业务对象

`Class`、`Method`、`Field`、`Constructor` 通常可以按类型和签名缓存；缓存具体业务对象则可能带来线程安全、生命周期和内存泄漏问题。框架还要留意自定义类加载器：缓存不当会阻止旧类加载器被回收。

### 6.4 把参数转换做成显式规则

反射不会自动把字符串正确变成所有目标类型。数字、枚举、日期、集合、`null` 与基本类型都有自己的转换规则。生产代码应使用成熟绑定器，或为支持的参数类型建立明确、可测试的转换表。

### 6.5 还原目标方法的异常语义

捕获 `InvocationTargetException` 后，保留其 `cause` 和原始堆栈；不要把所有异常都转换成模糊的“调用失败”。这样日志和监控才能准确区分配置错误、权限问题与业务错误。

### 6.6 模块限制是设计信号，不是障碍物

JDK 9+ 的模块系统禁止随意深度反射 JDK 或未开放模块的内部包。遇到访问受阻，优先寻找公开 API、调整模块 `opens`/`exports` 设计，或减少对内部实现的耦合，而不是把启动参数当作默认解决方案。

---

## 七、高频坑与面试速答

**Q：`getMethod` 和 `getDeclaredMethod` 有什么区别？**  
A：`getMethod` 只查 public 方法，并包含继承而来的 public 方法；`getDeclaredMethod` 查当前类自己声明的方法，包含 private，但不包含父类声明的方法。

**Q：为什么 `getDeclaredMethod("save", Integer.class)` 找不到 `save(int)`？**  
A：反射按精确参数签名匹配，`int.class` 与 `Integer.class` 不相同。重载方法也必须传入完整、准确的参数类型数组。

**Q：为什么不建议再用 `Class#newInstance()`？**  
A：它已废弃，对构造器异常的处理不完整，也不能指定参数。应使用 `getDeclaredConstructor(...).newInstance(...)`。

**Q：`setAccessible(true)` 能访问所有 private 成员吗？**  
A：不能。它受 Java 安全与模块封装约束；JDK 9+ 中，目标包未开放时深度反射仍可能失败。更重要的是，它不应该被用来破坏不属于你的模块边界。

**Q：调用方法时为什么会见到 `InvocationTargetException`？**  
A：目标方法内部抛出的异常会被它包装。通过 `getCause()` 才能拿到真正的业务异常。

**Q：反射一定很慢吗？**  
A：相对直接调用有额外开销，但是否成为瓶颈取决于调用频率和业务耗时。先用清晰接口解决问题；只有在高频路径确有测量证据时，再缓存元数据或评估 `MethodHandle` 等更专门的工具。

---

## 结语

反射把 Java 的能力从“编译期写死调用关系”扩展到了“运行时按元数据组装行为”。这也是它强大且需要克制的原因：

```text
Class<?>        → 找到类型的运行时描述
成员查询         → 读取构造器、字段、方法与注解
访问检查         → 尊重封装与模块边界
动态调用         → 在受控约定中完成扩展
明确异常与白名单  → 保持系统可诊断、可维护、可防护
```

把反射放在框架边界与扩展点，让普通业务代码继续使用清晰的接口和直接调用，才能同时获得运行时灵活性与长期可维护性。

相关阅读：

- {% post_link articles/Java/05-java-thread-pool 'Java 并发进阶（05）：线程池' %}
- {% post_link articles/RuoYi/06-ruoyi-quartz-scheduler 'RuoYi 实战（06）：Quartz 定时任务调度' %}
