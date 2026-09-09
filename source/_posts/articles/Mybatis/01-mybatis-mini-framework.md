---
title: 手写 MyBatis 01：从 JDBC 到 Mapper 代理，搭建迷你持久层框架
date: 2026-09-09 10:00:00
categories:
  - Mybatis
tags:
  - Java
  - MyBatis
  - JDBC
  - 动态代理
description: 用 Java 17 与 H2 从零实现一个可运行的 Mini-MyBatis，逐层拆解配置注册、Mapper 动态代理、SQL 模板解析、参数绑定、结果集映射、会话事务和异常传播，并通过 CRUD 与边界测试对照真实 MyBatis 的设计。
lang: zh-CN
---

> `UserMapper` 明明只是一个接口，为什么调用 `findById(1L)` 就能访问数据库？这个问题的答案不是一句“用了动态代理”，而是一整条协作链：**方法元数据从哪里来、参数如何对应 SQL、谁持有连接、谁处理结果、异常又由谁负责。** 这篇文章把这些零件逐个实现，并给出可以拼接运行的完整代码，而不只停留在架构示意图。

## 一、先明确目标：手写的是执行链，不是另一个生产框架

### 1.1 我们最终要得到什么

业务代码最终只需要这样调用：

```text
打开 SqlSession
  获取 UserMapper 代理
  mapper.insert(1L, "Frank", 25)
  mapper.findById(1L)
  session.commit()
关闭 SqlSession
```

调用者不再手动创建 `PreparedStatement`，不再记住参数下标，也不必对每个查询重复遍历 `ResultSet`。但是 SQL 仍由开发者显式编写：**我们封装 JDBC 的机械工作，不把 SQL 的控制权收走。**

初版实现最容易做到“能查出一行”，却留下许多漏洞：缺失参数被当成 null、单对象查询悄悄丢掉第二行、`getInt` 把 SQL NULL 变成 0、共享代理把请求串到另一个连接、关闭异常覆盖原始异常。本篇会把这些边界一起处理。

### 1.2 功能范围与刻意取舍

| 范围 | 本文实现 |
| --- | --- |
| 环境 | Java 17、Maven、H2 内存数据库；不依赖 MyBatis 或 Spring |
| SQL | `@Select` / `@Insert` / `@Update` / `@Delete`，固定 SQL |
| 参数 | `@Param` 或 `arg0`、`arg1`，支持重复引用与 null |
| 返回值 | 查询具体 POJO 或精确的 `List<POJO>`；更新返回 `int` |
| 映射 | 无参构造器、当前类可写字段、列标签归一化、有限类型转换 |
| 生命周期 | 工厂共享配置，会话持有连接，代理只在当前会话内缓存 |
| 事务 | 显式提交、显式回滚、关闭时回滚未提交工作 |
| 不支持 | XML、Mapper 继承/default 方法、动态 SQL、嵌套映射、缓存和插件 |

这里的“具体 POJO”以 `User` 为例，也可换成符合相同规则的类。不是只能识别 `User.class`，但也不承诺支持任意 Java 类型：字段限定为 `String`、`Long`、`Integer`、`LocalDateTime`，数值字段允许对应基本类型。

**代码不是为了压进两三百行。** 为了可运行与错误可解释，多写一些校验比省略关键方法更有价值。本文同名类型是自己的实现，不是导入 `org.apache.ibatis.*`。

## 二、建立可复现实验：先让 JDBC 跑通

### 2.1 最小项目结构

新建独立练习项目，不需要改博客本身的 pnpm 配置：

```text
mini-mybatis-lab/
├── pom.xml
└── src/main/java/lab/
    ├── MiniMybatis.java
    └── Demo.java
```

`pom.xml` 完整内容如下。H2 的作用是提供真实 JDBC 连接、SQL 执行和事务，而不是模拟数据库返回值；每次运行使用隔离的内存库，不需要真实账号。

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>lab</groupId>
  <artifactId>mini-mybatis-lab</artifactId>
  <version>1.0-SNAPSHOT</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <version>2.3.232</version>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId>
        <artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
      <plugin>
        <groupId>org.codehaus.mojo</groupId>
        <artifactId>exec-maven-plugin</artifactId>
        <version>3.5.0</version>
      </plugin>
    </plugins>
  </build>
</project>
```

### 2.2 数据表和 JDBC 基线

实验表只有三个字段：

```sql
create table t_user (
    id bigint primary key,
    user_name varchar(100) not null,
    age integer
);
```

`age` 故意允许为空，后面用于验证 NULL 映射。`id` 由调用者提供，暂不处理生成主键；这和“不支持回填主键”是明确的一致设计。

原生 JDBC 的单次查询一般分五步：拿连接、准备 SQL、设置参数、执行、映射结果。关闭顺序与创建顺序相反：先结果集，再语句，最后连接。更新则用 `executeUpdate()` 读取影响行数，不会返回业务对象。

例如 `where id = ?` 中的 `?` 是数据槽位，不是“替换成任意 SQL 片段”的插槽。`order by ?` 不能把绑定的字符串自动变成列标识符。动态列名必须使用固定白名单映射，这与是否使用 MyBatis 无关。

![图 1：从 JDBC 的手工步骤到 MyBatis 的组件分工](jdbc-to-mybatis-evolution.svg)

第十二节的 `Demo.jdbcBaseline` 会真正执行一次原生 INSERT 和 SELECT，再回滚。这样先验证驱动、建表、数据类型与事务，再调试框架，不会把环境问题误认为代理问题。

## 三、设计对象模型：把配置和请求状态分开

### 3.1 各组件的输入与输出

| 组件 | 输入 | 输出 / 职责 |
| --- | --- | --- |
| `Configuration` | Mapper 接口 | 注册并冻结方法元数据 |
| `MappedStatement` | 注解、Method | 命令类型、预编译 SQL、结果形状 |
| `SqlTemplateParser` | 固定 SQL 模板 | `?` SQL 与有序参数名 |
| `ParameterHandler` | 方法参数与模板 | 按 SQL 顺序给 Statement 绑定值 |
| `MapperProxy` | 接口方法调用 | 转交当前 Session |
| `SqlSessionFactory` | DataSource、配置 | 为每次会话获取独立连接 |
| `DefaultSqlSession` | 方法、参数 | 执行、提交、回滚、关闭 |
| `SimpleExecutor` | 连接、MappedStatement | JDBC 查询或影响行数 |
| `ResultSetHandler` | ResultSet、结果元数据 | POJO、列表或明确异常 |

启动期可以反复共享的东西：SQL 模板、反射字段、返回类型。不能跨请求随便共享的东西：当前连接、未提交事务、Mapper 代理绑定的会话、查询结果集。

![图 2：迷你 MyBatis 的配置、会话、代理和执行分层](mini-mybatis-architecture.svg)

### 3.2 完整代码的拼接规则

为了避免十几个 Java 文件把阅读切得太碎，框架使用一个 `MiniMybatis` 外壳，把组件作为静态嵌套类型。**从本节开始，标记为“框架代码”的 Java 块按出现顺序拼到 `MiniMybatis.java`，第十一节末尾补上外壳右括号。** 第十二节的 `Demo.java` 是另一个完整文件。

代码块没有省略 getter、import、接口声明或辅助方法。真实项目可以把这些类型按职责拆成独立文件，依赖关系不变。

框架代码 1：文件头与外壳。

<!-- framework-part -->
```java
package lab;

import javax.sql.DataSource;
import java.lang.annotation.*;
import java.lang.reflect.*;
import java.math.BigDecimal;
import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;
import java.util.regex.*;

public final class MiniMybatis {
    private MiniMybatis() {}
```

## 四、定义注解和元数据：方法先变成说明书

### 4.1 注解只描述意图，不负责执行

`@Retention(RUNTIME)` 让注解可被运行时反射读取；`@Target(METHOD)` 避免误放在类或字段上。`@Param` 标记 Java 实参的逻辑名称。

框架代码 2：注解、命令类型、异常和数据模型。

<!-- framework-part -->
```java
    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Select { String value(); }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Insert { String value(); }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Update { String value(); }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.METHOD)
    public @interface Delete { String value(); }

    @Retention(RetentionPolicy.RUNTIME)
    @Target(ElementType.PARAMETER)
    public @interface Param { String value(); }

    public enum SqlCommandType { SELECT, INSERT, UPDATE, DELETE }

    public static final class PersistenceException extends RuntimeException {
        public PersistenceException(String message) { super(message); }
        public PersistenceException(String message, Throwable cause) {
            super(message, cause);
        }
    }

    public record PreparedSql(String sql, List<String> parameterNames) {
        public PreparedSql {
            parameterNames = List.copyOf(parameterNames);
        }
    }

    public record ResultShape(Class<?> elementType, boolean collection) {
        static ResultShape from(Method method, SqlCommandType command) {
            if (command != SqlCommandType.SELECT) {
                if (method.getReturnType() != int.class) {
                    throw new PersistenceException("更新方法必须返回 int: " + method);
                }
                return new ResultShape(void.class, false);
            }
            Type generic = method.getGenericReturnType();
            if (method.getReturnType() == List.class) {
                if (!(generic instanceof ParameterizedType p)
                        || !(p.getActualTypeArguments()[0] instanceof Class<?> row)) {
                    throw new PersistenceException("查询列表必须是 List<具体POJO>: " + method);
                }
                return new ResultShape(row, true);
            }
            if (!(generic instanceof Class<?> row) || row.isPrimitive()
                    || row.isArray() || row.isInterface() || row == Object.class
                    || row.getName().startsWith("java.")) {
                throw new PersistenceException("查询必须返回具体POJO或List<POJO>: " + method);
            }
            return new ResultShape(row, false);
        }
    }

    public record MappedStatement(Method method, SqlCommandType commandType,
                                  PreparedSql preparedSql, ResultShape resultShape,
                                  List<String> argumentNames, RowMapping rowMapping) {
        public MappedStatement {
            argumentNames = List.copyOf(argumentNames);
        }
    }
```

### 4.2 为什么不能只调用 `getReturnType()`

`List<User>` 的原始返回类型是 `List.class`，泛型签名中才有 `User`。泛型擦除不意味着所有声明信息都消失：反射仍可从方法签名读取 `ParameterizedType`。

因此必须分别处理：

- `User`：一行映射成一个对象；
- `List<User>`：多行映射成列表；
- 裸 `List`、`List<T>`、`List<? extends User>`：无法按本教程的规则确定具体构造类型，注册时拒绝；
- `ArrayList<User>`：不承诺具体容器类型，因此拒绝，而不是返回一个无法赋值的对象；
- `int` 更新结果：走影响行数分支，不尝试构造 `int`。

`RowMapping` 在第十节实现。Java 允许嵌套类型在文本上晚于使用处声明。

## 五、注册 Configuration：把错误尽量留在启动期

### 5.1 为什么要拒绝“悄悄成功”

如果一个方法同时写 `@Select` 和 `@Delete`，框架不能用 `if/else` 的先后顺序替开发者做决定。同理，拼错 `#{userNmae}` 不应该等到调用时以 null 进入数据库。

本文采用三项策略：

1. 显式注册、重复注册报错，不隐式包扫描；
2. 先在临时 Map 中完成整个接口校验，再统一加入配置，避免半注册状态；
3. 创建工厂时冻结配置，之后不再允许增加 Mapper。

框架代码 3：配置注册。

<!-- framework-part -->
```java
    public static final class Configuration {
        private final Map<Method, MappedStatement> statements = new HashMap<>();
        private final Set<Class<?>> mappers = new HashSet<>();
        private final Map<Class<?>, RowMapping> rowMappings = new HashMap<>();
        private boolean frozen;

        public void addMapper(Class<?> mapper) {
            if (frozen) throw new PersistenceException("配置已经冻结");
            if (!mapper.isInterface() || !Modifier.isPublic(mapper.getModifiers())
                    || mapper.getInterfaces().length != 0
                    || mapper.getTypeParameters().length != 0) {
                throw new PersistenceException("Mapper必须是无继承、无泛型参数的public接口");
            }
            if (mappers.contains(mapper)) {
                throw new PersistenceException("Mapper重复注册: " + mapper.getName());
            }
            Map<Method, MappedStatement> pending = new HashMap<>();
            for (Method method : mapper.getDeclaredMethods()) {
                if (method.isDefault() || Modifier.isStatic(method.getModifiers())
                        || method.isSynthetic() || method.getTypeParameters().length != 0) {
                    throw new PersistenceException("不支持default/static/泛型方法: " + method);
                }
                if (isObjectMethod(method)) {
                    throw new PersistenceException("Mapper不能重声明Object方法: " + method);
                }
                pending.put(method, parse(method));
            }
            if (pending.isEmpty()) throw new PersistenceException("Mapper没有SQL方法");
            statements.putAll(pending);
            mappers.add(mapper);
        }

        private MappedStatement parse(Method method) {
            List<SqlCommandType> commands = new ArrayList<>();
            List<String> sqls = new ArrayList<>();
            Select select = method.getAnnotation(Select.class);
            Insert insert = method.getAnnotation(Insert.class);
            Update update = method.getAnnotation(Update.class);
            Delete delete = method.getAnnotation(Delete.class);
            if (select != null) { commands.add(SqlCommandType.SELECT); sqls.add(select.value()); }
            if (insert != null) { commands.add(SqlCommandType.INSERT); sqls.add(insert.value()); }
            if (update != null) { commands.add(SqlCommandType.UPDATE); sqls.add(update.value()); }
            if (delete != null) { commands.add(SqlCommandType.DELETE); sqls.add(delete.value()); }
            if (commands.size() != 1) {
                throw new PersistenceException("每个方法必须且只能有一个SQL注解: " + method);
            }
            SqlCommandType command = commands.get(0);
            PreparedSql sql = SqlTemplateParser.parse(sqls.get(0));
            List<String> names = ParameterHandler.argumentNames(method);
            for (String name : sql.parameterNames()) {
                if (!names.contains(name)) {
                    throw new PersistenceException("SQL引用未声明参数 " + name + ": " + method);
                }
            }
            ResultShape shape = ResultShape.from(method, command);
            RowMapping row = command == SqlCommandType.SELECT
                    ? rowMappings.computeIfAbsent(shape.elementType(), RowMapping::new) : null;
            return new MappedStatement(method, command, sql, shape, names, row);
        }

        private static boolean isObjectMethod(Method method) {
            try {
                Object.class.getMethod(method.getName(), method.getParameterTypes());
                return true;
            } catch (NoSuchMethodException ignored) {
                return false;
            }
        }

        void freeze() { frozen = true; }

        void requireMapper(Class<?> mapper) {
            if (!mappers.contains(mapper)) {
                throw new PersistenceException("Mapper未注册: " + mapper.getName());
            }
        }

        MappedStatement statement(Method method) {
            MappedStatement statement = statements.get(method);
            if (statement == null) throw new PersistenceException("方法未注册: " + method);
            return statement;
        }
    }
```

### 5.2 为什么用 Method，而不是接口名加方法名

`Method` 的相等性包括声明类、名称、参数类型与返回类型等信息。本例禁止接口继承，注册与代理拦截都面对同一个 Mapper 接口，查找规则很直接，也能区分重载方法。

真实 MyBatis 的 statement id 通常是 `接口全限定名.方法名`。因此**不能把本文支持区分重载的行为推导成真实 MyBatis 也支持用同名重载绑定不同语句**。真实实现还需要处理父接口方法、Mapper XML 命名空间、注解构建器等情况。

配置注册只应在单线程启动阶段完成；冻结后可由多个会话只读共享，并按通常的 Java 规则安全发布，例如启动完成后再创建工作线程。本文没有实现并发热注册。

## 六、SQL 模板解析：顺序比名字更重要

### 6.1 一条 SQL 会产出两份数据

```text
输入：where age >= #{minAge} or age = #{minAge} and id = #{id}
SQL ：where age >= ? or age = ? and id = ?
顺序：[minAge, minAge, id]
```

重复参数必须保留两次，因为 JDBC 有两个独立槽位。不能用 Set 去重，也不能按 Java 参数声明顺序绑定。

### 6.2 为什么这不是一个 SQL 解析器

正则不能可靠识别所有数据库的字符串、注释、转义和方言。本例采用保守语法：**SQL 必须是开发者写死的单条简单模板；拒绝引号、注释、裸 `?`、分号与 `${}`。** 字符串值和日期值全部作为参数传入。它牺牲了 SQL 表达范围，但不会把字符串常量中的 `#{name}` 误认为参数。

框架代码 4：受限模板解析。

<!-- framework-part -->
```java
    public static final class SqlTemplateParser {
        private static final Pattern TOKEN =
                Pattern.compile("#\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*}");

        public static PreparedSql parse(String raw) {
            if (raw == null || raw.isBlank()) throw new PersistenceException("SQL不能为空");
            for (String forbidden : List.of("${", "?", "'", "\"", "`", "--", "/*", ";")) {
                if (raw.contains(forbidden)) {
                    throw new PersistenceException("教学版SQL模板不支持: " + forbidden);
                }
            }
            Matcher matcher = TOKEN.matcher(raw);
            StringBuffer sql = new StringBuffer();
            List<String> names = new ArrayList<>();
            while (matcher.find()) {
                names.add(matcher.group(1));
                matcher.appendReplacement(sql, "?");
            }
            matcher.appendTail(sql);
            if (sql.indexOf("#") >= 0 || sql.indexOf("{") >= 0 || sql.indexOf("}") >= 0) {
                throw new PersistenceException("非法占位符，仅支持#{name}");
            }
            return new PreparedSql(sql.toString(), names);
        }
    }
```

比如 `#{user.id}`、`#{id,jdbcType=BIGINT}`、未闭合的 `#{id` 都会失败，而不是部分解析后继续执行。SQL 是否符合数据库语法仍交由数据库验证；解析器不会凭注解保证 `@Select` 的文本一定是 SELECT。

真实 MyBatis 中固定 SQL 与动态 SQL 会分别构建相应的 `SqlSource`，运行时得到 `BoundSql`，其中包含 SQL 和参数映射。本例的 `PreparedSql` 类似一个受限、可预先确定的执行计划，但不是 `BoundSql` 的完整等价物。

## 七、参数处理：把“没有”和“空值”区分开

### 7.1 参数名称只保留一套确定规则

本文规则如下：

- 有 `@Param("id")`：名称就是 `id`；
- 无 `@Param`：名称是从 0 开始的 `arg0`、`arg1`；
- 单参数也沿用同样规则，不隐式展开 JavaBean；
- 不同时注册 `param1` 等别名，避免注解名与自动别名覆盖；
- 不依赖 `-parameters`，编译器是否保留源码参数名都不改变行为。

真实 MyBatis 的 `ParamNameResolver` 规则更丰富，还涉及单参数直接使用、集合包装等行为。这里不假装完全兼容，只保证本教程的规则可预测。

框架代码 5：参数命名、值收集和 JDBC 绑定。

<!-- framework-part -->
```java
    public static final class ParameterHandler {
        static List<String> argumentNames(Method method) {
            List<String> names = new ArrayList<>();
            Parameter[] parameters = method.getParameters();
            for (int i = 0; i < parameters.length; i++) {
                Param annotation = parameters[i].getAnnotation(Param.class);
                String name = annotation == null ? "arg" + i : annotation.value();
                if (!name.matches("[A-Za-z_][A-Za-z0-9_]*") || names.contains(name)) {
                    throw new PersistenceException("非法或重复参数名: " + name);
                }
                if (!supported(parameters[i].getType())) {
                    throw new PersistenceException("不支持的参数类型: " + parameters[i].getType());
                }
                names.add(name);
            }
            return List.copyOf(names);
        }

        static boolean supported(Class<?> type) {
            return type == String.class || type == Long.class || type == long.class
                    || type == Integer.class || type == int.class
                    || type == LocalDateTime.class;
        }

        static void bind(PreparedStatement ps, MappedStatement ms, Object[] args)
                throws SQLException {
            if (args.length != ms.argumentNames().size()) {
                throw new PersistenceException("实参数量不匹配: " + ms.method());
            }
            Map<String, Object> values = new HashMap<>();
            Map<String, Class<?>> types = new HashMap<>();
            for (int i = 0; i < args.length; i++) {
                String name = ms.argumentNames().get(i);
                values.put(name, args[i]);
                types.put(name, ms.method().getParameterTypes()[i]);
            }
            List<String> order = ms.preparedSql().parameterNames();
            for (int i = 0; i < order.size(); i++) {
                String name = order.get(i);
                if (!values.containsKey(name)) {
                    throw new PersistenceException("缺少SQL参数: " + name);
                }
                Object value = values.get(name);
                Class<?> type = types.get(name);
                int index = i + 1;
                if (value == null) {
                    ps.setNull(index, jdbcType(type));
                } else if (type == String.class) {
                    ps.setString(index, (String) value);
                } else if (type == Long.class || type == long.class) {
                    ps.setLong(index, ((Number) value).longValue());
                } else if (type == Integer.class || type == int.class) {
                    ps.setInt(index, ((Number) value).intValue());
                } else {
                    ps.setTimestamp(index, Timestamp.valueOf((LocalDateTime) value));
                }
            }
        }

        private static int jdbcType(Class<?> type) {
            if (type == String.class) return Types.VARCHAR;
            if (type == Long.class || type == long.class) return Types.BIGINT;
            if (type == Integer.class || type == int.class) return Types.INTEGER;
            return Types.TIMESTAMP;
        }
    }
```

### 7.2 为什么不直接 `setObject(values.get(name))`

Map 中不存在 `id` 与 Map 中存在 `id -> null` 是不同情况：前者是代码错误，后者可能是合法业务输入。只有 `get` 无法区分二者，所以先做 `containsKey` 校验。

`setNull` 同样需要 JDBC 类型。本例从方法声明类型推导，真实框架通常还会使用参数映射里配置的 `jdbcType` 和 `TypeHandler`。不同驱动对“无类型 null”的兼容性不同，不能把在 H2 上工作当成全部数据库的保证。

`LocalDateTime` 在这里绑定为 TIMESTAMP，**不携带时区语义**。如果业务需要绝对时间点或时区偏移，应另行实现 `Instant` / `OffsetDateTime` 的处理器，并验证数据库字段类型。

## 八、Mapper 动态代理：接口只是入口，不是执行器

### 8.1 代理究竟收到了什么

调用 `mapper.update(1L, "Frank")` 时，JDK 会把这次调用转换成三个输入：代理对象、代表 update 的 `Method`、`Object[]` 实参。代理无需知道 SQL 内容，只需要知道它绑定的 Session。

框架代码 6：会话接口与调用处理器。

<!-- framework-part -->
```java
    public interface SqlSession extends AutoCloseable {
        <T> T getMapper(Class<T> mapperType);
        Object execute(Method method, Object[] args);
        void commit();
        void rollback();
        @Override void close();
    }

    public static final class MapperProxy implements InvocationHandler {
        private final SqlSession session;
        private final Class<?> mapperType;

        MapperProxy(SqlSession session, Class<?> mapperType) {
            this.session = session;
            this.mapperType = mapperType;
        }

        @Override
        public Object invoke(Object proxy, Method method, Object[] args) {
            if (method.getDeclaringClass() == Object.class) {
                return switch (method.getName()) {
                    case "toString" -> "MapperProxy(" + mapperType.getName() + ")";
                    case "hashCode" -> System.identityHashCode(proxy);
                    case "equals" -> proxy == args[0];
                    default -> throw new PersistenceException("不支持的Object方法: " + method);
                };
            }
            return session.execute(method, args == null ? new Object[0] : args);
        }
    }
```

### 8.2 Object 方法与 default 方法不能混为一谈

如果调试器打印 Mapper 时把 `toString()` 当成 SQL 方法查配置，会报“没有注册语句”。因此 Object 的身份操作独立处理：`equals` 比对象身份，`hashCode` 使用身份哈希，`toString` 返回代理描述。

这里不能写 `method.invoke(proxy, args)`，否则调用又进入同一个代理，递归到栈溢出。

接口的 default 方法是另一回事：它带有默认方法体，真实 MyBatis 会专门处理。这篇选择在注册阶段拒绝，而不是在调用阶段随机失败。之后要扩展，可以研究 Java 17 的 `InvocationHandler.invokeDefault`，但仍要决定 default 方法是否允许调用其他 SQL 方法。

![图 3：Mapper 动态代理到数据库执行与结果返回的时序](mapper-proxy-invocation-sequence.svg)

## 九、SqlSession 与事务：连接只能有一个明确的主人

### 9.1 工厂与会话不是同一种生命周期

工厂可以长时间存在；Session 是短生命周期、不可并发共享的工作单元。代理捕获 Session，因此代理缓存必须放在 Session 里面，不能放进全局 Configuration。

本例固定 `autoCommit=false`：没有提交的工作在关闭时回滚。工厂创建会话失败时，也必须归还刚获取的连接。外部传入的 `DataSource` 由应用管理，工厂不会关闭数据源或连接池。

框架代码 7：工厂和事务会话。

<!-- framework-part -->
```java
    public static final class SqlSessionFactory {
        private final Configuration configuration;
        private final DataSource dataSource;

        public SqlSessionFactory(Configuration configuration, DataSource dataSource) {
            this.configuration = Objects.requireNonNull(configuration);
            this.dataSource = Objects.requireNonNull(dataSource);
            configuration.freeze();
        }

        public SqlSession openSession() {
            Connection connection = null;
            try {
                connection = dataSource.getConnection();
                connection.setAutoCommit(false);
                return new DefaultSqlSession(configuration, connection);
            } catch (SQLException | RuntimeException failure) {
                if (connection != null) {
                    try { connection.close(); }
                    catch (SQLException closeFailure) { failure.addSuppressed(closeFailure); }
                }
                throw new PersistenceException("打开SqlSession失败", failure);
            }
        }
    }

    public static final class DefaultSqlSession implements SqlSession {
        private final Configuration configuration;
        private final Connection connection;
        private final SimpleExecutor executor;
        private final Map<Class<?>, Object> proxies = new HashMap<>();
        private boolean closed;

        DefaultSqlSession(Configuration configuration, Connection connection) {
            this.configuration = configuration;
            this.connection = connection;
            this.executor = new SimpleExecutor(connection);
        }

        private void requireOpen() {
            if (closed) throw new PersistenceException("SqlSession已经关闭");
        }

        @Override
        public <T> T getMapper(Class<T> mapperType) {
            requireOpen();
            configuration.requireMapper(mapperType);
            Object proxy = proxies.computeIfAbsent(mapperType, type ->
                    Proxy.newProxyInstance(type.getClassLoader(), new Class<?>[]{type},
                            new MapperProxy(this, type)));
            return mapperType.cast(proxy);
        }

        @Override
        public Object execute(Method method, Object[] args) {
            requireOpen();
            MappedStatement ms = configuration.statement(method);
            return executor.execute(ms, args);
        }

        @Override
        public void commit() {
            requireOpen();
            try { connection.commit(); }
            catch (SQLException e) { throw new PersistenceException("提交事务失败", e); }
        }

        @Override
        public void rollback() {
            requireOpen();
            try { connection.rollback(); }
            catch (SQLException e) { throw new PersistenceException("回滚事务失败", e); }
        }

        @Override
        public void close() {
            if (closed) return;
            closed = true;
            proxies.clear();
            SQLException failure = null;
            try {
                connection.rollback();
            } catch (SQLException e) {
                failure = e;
            } finally {
                try { connection.close(); }
                catch (SQLException e) {
                    if (failure == null) failure = e;
                    else failure.addSuppressed(e);
                }
            }
            if (failure != null) throw new PersistenceException("关闭SqlSession失败", failure);
        }
    }
```

### 9.2 提交之后，为什么 close 仍调用 rollback

本例没有实现 dirty 标记，关闭时统一尝试 rollback。之前已提交的数据不会因此消失；这一步回滚的是最后一次提交之后尚未提交的工作。如果没有新工作，则结束一个空事务或成为无实际变更的操作，具体由驱动处理。

相较于“只在最后一次操作是写入时回滚”，这更容易解释，也减少了教学代码里的状态分支。代价是可能多一次事务结束调用，生产实现可以进一步优化。

DDL 的事务特征因数据库而异。本文建表独立于 Session 事务，不声称所有建表操作都能回滚；事务测试针对 INSERT、UPDATE、DELETE。

### 9.3 不要让资源清理吞掉真正的错误

`close()` 中回滚失败后仍要尝试关闭连接；若关闭也失败，第二个异常加入 suppressed 列表。

外层使用 try-with-resources 时，如果业务执行先抛异常，`close()` 的异常会自动被添加到原异常的 suppressed 列表，而不是替代它。完整演示代码不再用“业务 catch 中直接 rollback，finally 中再 close”的重复所有权模式。

需要在会话未关闭前主动放弃当前事务时可以显式 `rollback()`，第十二节会展示。对于超时、断网导致的提交结果不确定，不能简单把“commit 抛错”解释为“数据库一定没有提交”，应按业务幂等和对账策略处理。

## 十、ResultSetHandler：映射不仅是反射赋值

### 10.1 先缓存结构，后处理每次查询的数据

一个实体的无参构造器和字段集合在运行中不会变化，可以在注册时缓存。查询返回了哪些列却依赖 SQL，应该每次查询根据 `ResultSetMetaData` 生成列到字段的有序列表，而不是跨不同 SQL 共用。

我们使用 `getColumnLabel`，让 `select user_name as userName` 的别名生效。标签与属性名均去掉下划线后转小写，所以 H2 的 `USER_NAME`、普通 SQL 的 `user_name`、Java 的 `userName` 都可以对齐。

这不是通用命名算法：`a_b` 和 `ab` 会发生归一化冲突。因此对于字段冲突、重复列、未知列统一报错，不静默跳过。

框架代码 8：实体元数据与单行转换。

<!-- framework-part -->
```java
    public static final class RowMapping {
        private final Constructor<?> constructor;
        private final Map<String, Field> fields;

        RowMapping(Class<?> type) {
            if (type.isInterface() || type.isArray() || type.isPrimitive()
                    || Modifier.isAbstract(type.getModifiers())
                    || type.getName().startsWith("java.")) {
                throw new PersistenceException("不是可构造POJO: " + type);
            }
            try {
                constructor = type.getConstructor();
                if (!constructor.trySetAccessible()) {
                    throw new PersistenceException("构造器不可访问: " + type);
                }
            } catch (NoSuchMethodException e) {
                throw new PersistenceException("POJO需要public无参构造器: " + type, e);
            }
            Map<String, Field> writable = new HashMap<>();
            for (Field field : type.getDeclaredFields()) {
                if (Modifier.isStatic(field.getModifiers()) || field.isSynthetic()) continue;
                if (Modifier.isFinal(field.getModifiers())
                        || !ParameterHandler.supported(field.getType())
                        || !field.trySetAccessible()) {
                    throw new PersistenceException("字段不可映射: " + field);
                }
                if (writable.putIfAbsent(normalize(field.getName()), field) != null) {
                    throw new PersistenceException("字段名称归一化后冲突: " + field);
                }
            }
            if (writable.isEmpty()) throw new PersistenceException("POJO没有可映射字段");
            fields = Map.copyOf(writable);
        }

        private static String normalize(String name) {
            return name.replace("_", "").toLowerCase(Locale.ROOT);
        }

        List<Field> columns(ResultSetMetaData metadata) throws SQLException {
            List<Field> columns = new ArrayList<>();
            Set<String> seen = new HashSet<>();
            for (int i = 1; i <= metadata.getColumnCount(); i++) {
                String label = metadata.getColumnLabel(i);
                String key = normalize(label);
                Field field = fields.get(key);
                if (!seen.add(key)) throw new PersistenceException("重复结果列: " + label);
                if (field == null) throw new PersistenceException("结果列没有对应字段: " + label);
                columns.add(field);
            }
            return columns;
        }

        Object read(ResultSet rs, List<Field> columns) throws SQLException {
            try {
                Object target = constructor.newInstance();
                for (int i = 0; i < columns.size(); i++) {
                    Field field = columns.get(i);
                    Object value = convert(rs.getObject(i + 1), field.getType());
                    field.set(target, value);
                }
                return target;
            } catch (ReflectiveOperationException e) {
                throw new PersistenceException("构造或赋值失败: " + constructor.getDeclaringClass(), e);
            }
        }

        private static Object convert(Object value, Class<?> type) {
            if (value == null) {
                if (type.isPrimitive()) throw new PersistenceException("SQL NULL不能赋给基本类型");
                return null;
            }
            if (type == String.class && value instanceof String) return value;
            if (type == LocalDateTime.class) {
                if (value instanceof LocalDateTime) return value;
                if (value instanceof Timestamp ts) return ts.toLocalDateTime();
            }
            if (value instanceof Number number) {
                try {
                    BigDecimal decimal = new BigDecimal(number.toString());
                    if (type == Long.class || type == long.class) return decimal.longValueExact();
                    if (type == Integer.class || type == int.class) return decimal.intValueExact();
                } catch (ArithmeticException | NumberFormatException e) {
                    throw new PersistenceException("数值无法无损映射到 " + type.getName(), e);
                }
            }
            throw new PersistenceException("不支持的结果类型转换: "
                    + value.getClass().getName() + " -> " + type.getName());
        }
    }

    public static final class ResultSetHandler {
        static Object handle(ResultSet rs, MappedStatement ms) throws SQLException {
            List<Field> columns = ms.rowMapping().columns(rs.getMetaData());
            if (ms.resultShape().collection()) {
                List<Object> rows = new ArrayList<>();
                while (rs.next()) rows.add(ms.rowMapping().read(rs, columns));
                return rows;
            }
            if (!rs.next()) return null;
            Object row = ms.rowMapping().read(rs, columns);
            if (rs.next()) throw new PersistenceException("单对象查询返回了多行: " + ms.method());
            return row;
        }
    }
```

### 10.2 为什么不用 `getInt()` 后直接赋值

当数据库值为 NULL 时，`getInt` 返回 0，必须再用 `wasNull()` 才能识别原值。本例统一从 `getObject` 获得 null，然后区分包装类型和基本类型，避免把“未知年龄”变成“0 岁”。

JDBC 驱动返回的 `Number` 不一定与字段类型完全一致。直接 `field.set(target, value)` 可能因 Long/Integer 不匹配失败；直接 `intValue()` 又可能截断越界值。这里通过 `BigDecimal.intValueExact()` / `longValueExact()` 拒绝溢出和带小数的有损转换。

字符串也不自动调用 `toString`，否则数据库类型错误会被掩盖。真实 `TypeHandler` 通常会按具体字段与 JDBC 类型选择更细的读取方式。

### 10.3 查询结果的契约必须明确

- 单对象查询零行：返回 null；多行：报错，不偷偷取第一行；
- 列表查询零行：空列表，不返回 null；
- 未查询到的实体字段：保留 Java 默认值；因此部分字段投影建议使用独立 DTO；
- 未知列和重复列：报错，避免联表查询时同名 `id` 覆盖；
- 继承字段、record 构造器、嵌套对象：未实现，不能靠此映射器完整还原。

列表分支把所有数据载入内存，不适合无界大查询。分页、游标、fetchSize 与驱动的流式读取约束应该作为后续独立能力，不要把“while(rs.next())”误认为自然就具备流式 API。

## 十一、Executor：把一切收敛到一次 JDBC 执行

### 11.1 执行器不决定事务边界

执行器使用 Session 提供的连接，但不会在每次 SQL 后提交或关闭连接。如果在这里 `commit()`，业务层两次更新就再也不能构成一个原子事务。

框架代码 9：执行器，以及整个框架文件的闭合括号。

<!-- framework-part -->
```java
    public static final class SimpleExecutor {
        private static final System.Logger LOG =
                System.getLogger(SimpleExecutor.class.getName());
        private final Connection connection;

        SimpleExecutor(Connection connection) {
            this.connection = connection;
        }

        Object execute(MappedStatement ms, Object[] args) {
            LOG.log(System.Logger.Level.DEBUG, "执行 {0}, SQL={1}",
                    ms.method().getName(), ms.preparedSql().sql());
            try (PreparedStatement ps = connection.prepareStatement(ms.preparedSql().sql())) {
                ParameterHandler.bind(ps, ms, args);
                if (ms.commandType() == SqlCommandType.SELECT) {
                    try (ResultSet rs = ps.executeQuery()) {
                        return ResultSetHandler.handle(rs, ms);
                    }
                }
                return ps.executeUpdate();
            } catch (SQLException e) {
                throw new PersistenceException("SQL执行失败: " + ms.method()
                        + ", SQL=" + ms.preparedSql().sql(), e);
            }
        }
    }
}
```

到这里 `MiniMybatis.java` 已经完整结束。它只引用 JDK 的 JDBC / DataSource 接口，不依赖 H2 专属类；H2 只出现在演示启动代码中。

### 11.2 统一异常与日志策略

SQL 异常包装为 `PersistenceException`，保留 cause。否则 Mapper 没声明 `SQLException`，动态代理可能抛出让调用者难以理解的 `UndeclaredThrowableException`。

教学日志只记录方法名和带 `?` 的 SQL 模板，**不打印用户名等参数值，也不把替换后的 SQL 拼进异常消息**。但驱动自己的异常 cause 可能包含数据或数据库细节，因此服务端还需要统一日志脱敏，不能直接把堆栈返回客户端。

Statement 创建失败、参数绑定失败、查询失败、映射失败都能沿 try-with-resources 清理资源。关闭异常保留为 suppressed，事务是否继续由上层决定；演示遇错直接退出会话，让 close 回滚。

## 十二、完整串联：原生 JDBC、CRUD、提交和回滚一起跑

### 12.1 Demo 文件与验证逻辑

下面是完整的 `src/main/java/lab/Demo.java`，不用再补建表或工具函数。为便于阅读，实体使用公开字段；框架通过反射也可访问满足模块访问条件的私有可写字段，但这里不引入 getter/setter 噪声。

<!-- demo-file -->
```java
package lab;

import lab.MiniMybatis.*;
import org.h2.jdbcx.JdbcDataSource;
import java.sql.*;
import java.util.List;

public final class Demo {
    public static final class User {
        public Long id;
        public String userName;
        public Integer age;
        public User() {}
        @Override public String toString() {
            return "User{id=" + id + ", userName=" + userName + ", age=" + age + "}";
        }
    }

    public interface UserMapper {
        @Select("select id, user_name, age from t_user where id = #{id}")
        User findById(@Param("id") Long id);

        @Select("select id, user_name, age from t_user where age >= #{minAge} order by id")
        List<User> adults(@Param("minAge") Integer minAge);

        @Insert("insert into t_user(id, user_name, age) values(#{id}, #{name}, #{age})")
        int insert(@Param("id") Long id, @Param("name") String name, @Param("age") Integer age);

        @Update("update t_user set user_name = #{name} where id = #{id}")
        int update(@Param("id") Long id, @Param("name") String name);

        @Delete("delete from t_user where id = #{arg0}")
        int delete(Long id);

        @Select("select id, user_name, age from t_user where id = #{id} or id = #{id}")
        User repeated(@Param("id") Long id);

        @Select("select id, user_name, age from t_user order by id")
        User tooMany();
    }

    public interface BadMapper {
        @Select("select id from t_user where id = #{typo}")
        User find(@Param("id") Long id);
    }

    private static void check(boolean condition, String message) {
        if (!condition) throw new AssertionError(message);
    }

    private static void expectFailure(Runnable action, String label) {
        try {
            action.run();
        } catch (PersistenceException expected) {
            System.out.println("PASS: " + label);
            return;
        }
        throw new AssertionError("应当失败: " + label);
    }

    private static void jdbcBaseline(JdbcDataSource ds) throws SQLException {
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try (PreparedStatement ps = c.prepareStatement(
                    "insert into t_user(id, user_name, age) values (?, ?, ?)")) {
                ps.setLong(1, 99L);
                ps.setString(2, "JDBC");
                ps.setNull(3, Types.INTEGER);
                check(ps.executeUpdate() == 1, "JDBC插入影响行数");
            }
            try (PreparedStatement ps = c.prepareStatement(
                    "select id, user_name, age from t_user where id = ?")) {
                ps.setLong(1, 99L);
                try (ResultSet rs = ps.executeQuery()) {
                    check(rs.next(), "JDBC查询缺失");
                    check(rs.getObject("age") == null, "JDBC NULL语义");
                }
            }
            c.rollback();
        }
    }

    public static void main(String[] args) throws Exception {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:mem:mini;DB_CLOSE_DELAY=-1");
        ds.setUser("sa");
        ds.setPassword("");
        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            s.execute("create table t_user(id bigint primary key, user_name varchar(100) not null, age integer)");
        }
        jdbcBaseline(ds);
        Configuration configuration = new Configuration();
        configuration.addMapper(UserMapper.class);
        expectFailure(() -> configuration.addMapper(UserMapper.class), "重复Mapper注册");
        expectFailure(() -> new Configuration().addMapper(BadMapper.class), "占位符名称拼写错误");
        SqlSessionFactory factory = new SqlSessionFactory(configuration, ds);
        expectFailure(() -> configuration.addMapper(BadMapper.class), "配置冻结");

        UserMapper closedMapper;
        try (SqlSession session = factory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            closedMapper = mapper;
            check(mapper == session.getMapper(UserMapper.class), "会话内代理缓存");
            check(mapper.equals(mapper), "代理equals");
            check(mapper.toString().contains("UserMapper"), "代理toString");
            check(mapper.insert(1L, "Frank", 25) == 1, "INSERT影响行数");
            check(mapper.insert(2L, "Alice", null) == 1, "null参数");
            check(mapper.update(1L, "Frank Updated") == 1, "参数绑定顺序");
            check(mapper.findById(1L).userName.equals("Frank Updated"), "更新查询");
            check(mapper.findById(2L).age == null, "NULL没有变成0");
            check(mapper.findById(999L) == null, "单查无结果");
            check(mapper.adults(100).isEmpty(), "列表无结果");
            check(mapper.repeated(1L).id == 1L, "重复占位符");
            check(mapper.adults(18).size() == 1, "列表映射");
            expectFailure(mapper::tooMany, "单对象查询多行");
            session.commit();
            System.out.println(mapper.findById(1L));
        }
        expectFailure(() -> closedMapper.findById(1L), "关闭会话后调用代理");

        try (SqlSession session = factory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            check(mapper.findById(1L) != null, "新会话可见已提交数据");
            check(mapper.findById(99L) == null, "JDBC基线已回滚");
            check(mapper.delete(1L) == 1, "DELETE影响行数");
            session.rollback();
            check(mapper.findById(1L) != null, "显式回滚恢复删除");
            mapper.insert(3L, "Uncommitted", 20);
        }
        try (SqlSession session = factory.openSession()) {
            check(session.getMapper(UserMapper.class).findById(3L) == null, "关闭时回滚");
        }
        expectFailure(() -> {
            try (SqlSession session = factory.openSession()) {
                UserMapper mapper = session.getMapper(UserMapper.class);
                mapper.insert(4L, "Before Failure", 30);
                mapper.insert(1L, "Duplicate", 30);
                session.commit();
            }
        }, "SQL异常自动回滚");
        try (SqlSession session = factory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            check(mapper.findById(4L) == null, "异常前插入也已回滚");
            check(mapper.delete(2L) == 1, "删除提交");
            session.commit();
        }
        try (SqlSession session = factory.openSession()) {
            check(session.getMapper(UserMapper.class).findById(2L) == null, "删除已持久化");
        }
        System.out.println("ALL CHECKS PASSED");
    }
}
```

### 12.2 运行命令与输出

在练习项目根目录运行：

```bash
mvn -q compile exec:java -Dexec.mainClass=lab.Demo
```

关键输出如下。检查函数使用显式 `AssertionError`，不依赖 JVM 的 `-ea` 开关。

```text
PASS: 重复Mapper注册
PASS: 占位符名称拼写错误
PASS: 配置冻结
PASS: 单对象查询多行
User{id=1, userName=Frank Updated, age=25}
PASS: 关闭会话后调用代理
PASS: SQL异常自动回滚
ALL CHECKS PASSED
```

`DB_CLOSE_DELAY=-1` 保证 H2 内存数据库在 JVM 存活期间不会因某一个连接关闭而消失。它不是持久化配置：进程退出，数据仍然丢失。重复在同一个 JVM 内调用此 main 会遇到表已存在；演示命令每次启动新 JVM。

### 12.3 跟踪一次乱序绑定

`update(@Param("id") Long id, @Param("name") String name)` 的实参数组是 `[1L, "Frank Updated"]`，而 SQL 中 name 在 id 前面：

```text
方法名表：[id, name]
方法值表：id -> 1，name -> Frank Updated
SQL顺序：[name, id]
JDBC调用：setString(1, ...)，setLong(2, ...)
```

先建立名字到值的对应，再按 SQL 顺序取值，这就是不直接把 `args[i]` 绑定到 `i+1` 的原因。

## 十三、测试与调试：不要只测试能成功的那一条路

### 13.1 当前 Demo 已覆盖的行为

完整演示不只是打印查询结果，还检查：

- 原生 JDBC 插入与回滚，确保实验环境工作；
- INSERT / UPDATE / SELECT / DELETE 与影响行数；
- SQL 参数顺序与方法参数顺序不同；
- 相同参数在 SQL 中重复出现；
- 包装类型 null 的写入和读取；
- 零行单查返回 null，零行列表返回空集合；
- 单对象查询多行报错；
- 同一会话代理复用、代理的 Object 方法、关闭后 SQL 调用失败；
- 提交后跨会话可见、显式回滚、关闭时回滚；
- 第二条 SQL 主键冲突时，前一条未提交 INSERT 一并回滚；
- 重复注册、参数拼写错误、冻结后注册被拒绝。

### 13.2 进一步练习的失败用例

这些适合补成 JUnit 测试，不应和“当前 Demo 已覆盖”混为一谈：

| 输入或场景 | 应有行为 |
| --- | --- |
| 同一方法两个 SQL 注解 | 注册失败 |
| 裸 List、List 泛型变量或通配符 | 注册失败 |
| default 方法、继承接口 | 注册失败 |
| `#{x.y}`、`${x}`、引号内占位符 | 模板解析失败 |
| `@Param("id")` 重复 | 注册失败 |
| 数据库大数映射到 Integer | 溢出时报错而非截断 |
| NULL 映射到 int 字段 | 报错而非写入 0 |
| 两个列别名归一化后相同 | 映射失败 |
| rollback 和 close 同时抛错 | 保留主异常与 suppressed |
| 工厂拿到连接后 setAutoCommit 失败 | 仍尝试关闭连接 |

后两类异常最好用受控的 JDBC 测试替身注入故障，不需要真的制造数据库断网。正常 H2 流程通过不等于已经验证所有连接池、驱动和网络异常。

### 13.3 推荐断点顺序

先在 `Configuration.parse` 看注册得到的模板和返回形状，再在 `MapperProxy.invoke` 看 Method 与 args，之后看 `ParameterHandler.bind` 的槽位顺序，最后看 `RowMapping.read` 中的列标签与 Java 字段。

遇到“看起来执行成功但读不到数据”，优先确认：是否调用 commit、查询是不是另一条连接、是否在 Session 关闭时回滚，而不是先怀疑动态代理失效。

## 十四、对照真实 MyBatis：名字相似，边界不完全相同

![图 4：教学版 MyBatis 与真实 MyBatis 的能力边界](mini-vs-real-mybatis.svg)

### 14.1 沿调用链定位源码

```text
MapperProxy.invoke
  MapperMethod.execute
    DefaultSqlSession.selectOne / selectList / update
      Executor.query / update
        StatementHandler.prepare / parameterize / query / update
          ParameterHandler.setParameters
          ResultSetHandler.handleResultSets
```

这是便于阅读的逻辑路径，不代表所有操作都逐字经过相同方法。插件可能包裹某些组件，缓存命中时可能根本不访问数据库，批处理与游标查询也有自己的分支。

| 本文类型 | 真实 MyBatis 中可对照的位置 |
| --- | --- |
| Configuration 的注册 Map | Configuration、MapperRegistry、MapperAnnotationBuilder |
| MapperProxy 直接转交方法 | MapperProxy、MapperMethod 的方法签名与命令解析 |
| PreparedSql | SqlSource、BoundSql、ParameterMapping 的部分职责 |
| ParameterHandler 的类型分支 | DefaultParameterHandler、TypeHandlerRegistry |
| SimpleExecutor 创建语句 | Executor 与 StatementHandler 分工 |
| RowMapping / ResultSetHandler | ResultMap、MetaObject、DefaultResultSetHandler |
| Session 自己管理连接 | SqlSession、Transaction、DataSource 的协作 |

### 14.2 为什么真实实现还要多一层 StatementHandler

本例执行器直接 `prepareStatement`，足以表达最小链路。真实 MyBatis 需要区分普通 Statement、PreparedStatement、CallableStatement，并承载超时、fetchSize、参数化、生成主键等逻辑。因此“如何调度一次执行”和“如何配置某类 JDBC Statement”值得拆开。

同理，`ResultMap` 不只是一个 `Map<列名, Field>`：它还要表达 constructor、association、collection、discriminator、嵌套查询和多个结果集。反射字段赋值是起点，不是对象关系映射的全部。

### 14.3 教学版不会自动获得生产版的行为

本例没有一级缓存，所以在同一 Session 中重复 `findById` 会再次访问数据库；没有二级缓存，所以不能讨论缓存 namespace 的失效传播；没有生成主键处理，所以 insert 返回的是影响行数而不是主键。

实际阅读某个 MyBatis 版本时，应以该版本源码和文档为准。本文的实现不是源码逐行移植，也没有声称兼容其全部注解语义。

## 十五、下一步怎么扩展：先建正确边界，再叠功能

### 15.1 第一阶段：把类型与 SQL 抽象稳住

先把 `ParameterHandler` 和 `RowMapping.convert` 中的分支抽成可注册的类型处理器。处理器不仅要负责 set，还要负责 get，并对 null、jdbcType、日期时区给出一致规则。

随后引入 `SqlSource#getBoundSql(parameterObject)`。固定 SQL 可以返回预解析结果，动态 SQL 才在调用时产生不同的 SQL 和参数映射。这样不会为了 `foreach` 强行修改全局 MappedStatement。

### 15.2 第二阶段：XML 与动态 SQL

XML 首先是一种配置来源，应与注解最终归并到同一个元数据模型，而不是另起一条互不兼容的执行器。

`if`、`choose`、`trim`、`foreach` 可以用节点树表达，节点执行时累积 SQL 与变量绑定。表达式求值必须控制能力范围，不能把外部不可信文本当任意 Java 代码执行。批量参数也必须继续保留参数映射，而不是直接拼接用户值。

### 15.3 第三阶段：事务抽象与连接池

把 Connection 的获取、commit、rollback、close 提取到 Transaction 接口，再通过不同实现接入 JDBC 本地事务或外部事务管理器。连接池只是 DataSource 的一种实现，`Connection.close()` 在连接池场景通常意味着归还，而不一定是物理断连。

接入 Spring 时，事务由外部管理器绑定和协调，不能继续照搬本例每次 close 都主动 rollback 的策略。`SqlSessionTemplate` 的线程安全使用模式也不同于这里的 DefaultSqlSession，不能混用生命周期结论。

### 15.4 第四阶段：缓存、插件和批处理

一级缓存需要设计缓存键：statement id、SQL、参数、分页等都会影响结果；更新、提交和回滚如何清理，也属于正确性的一部分。二级缓存还涉及 namespace、事务可见性和可变对象隔离，不是往静态 Map 放结果就完成了。

插件应围绕稳定接口做拦截，明确顺序、异常传播和是否允许重试。BatchExecutor 还需要 flush 与批处理结果的独立契约；本例每次返回 `int` 的约定不能原封不动套到延迟执行批处理。

## 十六、总结与参考资料

这次手写的重点不是“代理能执行 SQL”这一个技巧，而是把四条边界建立起来：

1. **配置边界**：启动期解析且冻结，调用期只读；
2. **执行边界**：代理路由、会话管理、执行器调用 JDBC 各负其责；
3. **数据边界**：占位符只绑定值，结果映射对 null、类型与行数做明确判断；
4. **资源边界**：一次执行关闭语句和结果集，一次会话结束事务并释放连接。

先跑通完整 Demo，再故意改错一个参数名、制造单查多行、去掉 commit，观察错误在哪一层发生。能够解释这些行为，再去阅读 MyBatis 的缓存、插件和动态 SQL，会比从包目录第一页开始翻轻松得多。

参考资料：

- [MyBatis 官方入门文档](https://mybatis.org/mybatis-3/getting-started.html)
- [MyBatis Java API：SqlSession 与 Mapper](https://mybatis.org/mybatis-3/java-api.html)
- [MyBatis 动态 SQL](https://mybatis.org/mybatis-3/dynamic-sql.html)
- [MyBatis GitHub 源码](https://github.com/mybatis/mybatis-3)
- [Java 17 InvocationHandler API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/reflect/InvocationHandler.html)
- [H2 数据库文档](https://h2database.com/html/main.html)
