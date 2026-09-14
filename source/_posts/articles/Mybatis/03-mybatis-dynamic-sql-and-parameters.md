---
title: '手写 MyBatis 03：动态 SQL 与参数绑定，逐文件增量实现'
date: 2026-09-11 10:00:00
categories: [Mybatis]
tags:
  - Java
  - MyBatis
  - 动态SQL
  - 参数处理
description: 承接第 02 篇的 XML 与 MappedStatement，在既有 com.frank.mybatis 项目中逐文件加入 SqlNode、SqlSource、BoundSql、TypeHandler 与安全参数绑定。
lang: zh-CN
---

> 本篇只在第 02 篇已经完成的 `com.frank.mybatis` 工程上增量开发。不会新建 `lab` 示例工程、不会提供独立 `pom.xml`、不会把几十个类塞进嵌套外壳类。每段代码都对应一个真实文件；请按给出的顺序写入已有项目，再执行章末的 `MiniMybatisChapter03Test`。

## 一、从第 02 篇继续：这次只替换 SQL 生成与绑定边界

**为什么需要这一步：** 第 02 篇的 SQL 在注册时就固定死了，而真实业务的查询条件几乎每次调用都不同——条件命中几条、IN 列表多长，都随参数变。这不是加个字符串拼接就能解决的事：SQL 结构与参数顺序必须同步变化，而且必须仍然全程预编译。

![图 1：动态 SQL——同一语句、两个形状](fixed-vs-dynamic-sql.svg)

第 02 篇已经有如下主链路：Mapper 代理根据 `namespace + methodName` 定位 `MappedStatement`，`SqlSession` 把方法参数交给 `SimpleExecutor`，执行器创建 `PreparedStatement` 并执行 SQL。那一版 `MappedStatement` 只保存一个固定 `String sql`，执行器用正则直接替换 `#{name}` 并调用 `setObject`。

这在 `select ... where id = #{id}` 时足够，但一旦有条件或循环，SQL 文本和参数位置会在**每次调用**中变化：

```text
name = null, ids = [1, 3]
SQL      = select ... WHERE id in (?, ?)
参数顺序  = [1, 3]

name = "Frank", ids = [1, 3]
SQL      = select ... WHERE name = ? AND id in (?, ?)
参数顺序  = ["Frank", 1, 3]
```

因此本篇建立四个边界。

| 边界 | 职责 | 不能做什么 |
| --- | --- | --- |
| `SqlNode` | 根据当前上下文输出 SQL 片段 | 不创建 JDBC 对象 |
| `SqlSource` | 为一次调用产出 `BoundSql` | 不缓存某次实参 |
| `BoundSql` | 保存最终 SQL、参数元数据、循环局部变量 | 不执行 SQL |
| `ParameterHandler` | 按问号位置调用 `TypeHandler` | 不再拼接 SQL |

最终调用链变为：

```text
MapperProxy
  -> MappedStatement.getSqlSource()
  -> SqlSource.getBoundSql(parameterObject)
  -> SimpleExecutor.prepareStatement(boundSql.sql())
  -> ParameterHandler.setParameters(statement, boundSql)
  -> JDBC executeQuery / executeUpdate
```

本篇目标是教学框架的可测试安全子集：`<if>`、`<where>`、`<trim>`、`<foreach>`，以及 Bean、Map、集合、数组和标量参数。没有 `choose`、`bind`、`include`、任意 OGNL 或任意 SQL 字符串插值；不支持时立即失败。

## 二、开始前检查既有工程与本篇文件清单

**为什么需要这一步：** 本篇动的是执行链的核心契约（`MappedStatement`、Executor、SqlSession），牵一发动全身。先确认第 02 篇基线全绿、列清每个新增与修改的文件，后面每一步编译失败时才能立刻定位是哪一层在过渡。

### 2.1 前置条件，不新建独立工程

继续使用第 02 篇的 Java 17、Maven、H2 与 JUnit 5 依赖。若第 02 篇已经执行过测试，先在**既有项目根目录**执行：

**验收命令（路径：项目根目录；包：不适用；前置依赖：Java 17、Maven、02 篇测试）**

```bash
mvn -q test
```

开始本篇前，确认至少已有这些类型：

```text
src/main/java/com/frank/mybatis/session/Configuration.java
src/main/java/com/frank/mybatis/session/SqlSession.java
src/main/java/com/frank/mybatis/session/DefaultSqlSession.java
src/main/java/com/frank/mybatis/mapping/MappedStatement.java
src/main/java/com/frank/mybatis/executor/Executor.java
src/main/java/com/frank/mybatis/executor/SimpleExecutor.java
src/main/java/com/frank/mybatis/binding/MapperMethod.java
src/main/java/com/frank/mybatis/builder/XMLMapperBuilder.java
src/main/java/com/frank/mybatis/annotations/Param.java
```

第 02 篇若仍使用其他包名，请先在自己的项目中统一为 `com.frank.mybatis`；本篇不再兼容旧包名，也不复制第 02 篇的 Maven 配置。

### 2.2 本篇新增和修改的文件

下面的树是本篇完成后的增量，不是要创建额外项目外壳。

```text
src/main/java/com/frank/mybatis/
├── builder/
│   ├── XMLScriptBuilder.java                         新增
│   ├── XMLMapperBuilder.java                         修改
│   └── MapperAnnotationBuilder.java                  修改
├── executor/
│   ├── ParamNameResolver.java                        新增
│   ├── ParameterHandler.java                         修改
│   ├── Executor.java                                 修改
│   └── SimpleExecutor.java                           修改
├── binding/
│   └── MapperMethod.java                             修改
├── session/
│   ├── Configuration.java                            修改
│   ├── SqlSession.java                               修改
│   └── DefaultSqlSession.java                        修改
├── mapping/
│   ├── BoundSql.java                                 新增
│   ├── DynamicSqlSource.java                         新增
│   ├── ParameterMapping.java                         新增
│   ├── SqlSource.java                                新增
│   ├── StaticSqlSource.java                          新增
│   └── MappedStatement.java                          修改
├── scripting/
│   ├── DynamicContext.java                           新增
│   ├── ForEachSqlNode.java                           新增
│   ├── IfSqlNode.java                                新增
│   ├── SqlNode.java                                  新增
│   ├── TextSqlNode.java                              新增
│   ├── TrimSqlNode.java                              新增
│   └── WhereSqlNode.java                             新增
└── type/
    ├── BaseTypeHandler.java                          新增
    ├── BooleanTypeHandler.java                       新增
    ├── ByteArrayTypeHandler.java                     新增
    ├── EnumTypeHandler.java                          新增
    ├── IntegerTypeHandler.java                       新增
    ├── LocalDateTimeTypeHandler.java                 新增
    ├── LocalDateTypeHandler.java                     新增
    ├── LongTypeHandler.java                          新增
    ├── StringTypeHandler.java                        新增
    ├── TypeHandler.java                              新增
    └── TypeHandlerRegistry.java                      新增
src/test/resources/mapper/UserMapper.xml             修改
src/test/resources/chapter03/schema.sql              新增
src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java    新增
```

后文每个代码块都标明文件路径、包名和已依赖的前置文件。所有 Java 文件均为顶级类：不要添加 `DynamicSql`、`Demo` 一类嵌套外壳。

### 章节测试约定与版本边界

下面各节的测试方法追加到第十一节的 `src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java`，复用 `source`、`flat`、`connection` 和 JUnit 导入；额外类型使用全限定名。纯节点测试可以单独运行，H2 绑定测试用于确认 JDBC 行为。包名与第 01、02 篇保持一致：`Configuration` 在 `session`、`Param` 在 `annotations`、Mapper 解析在 `builder`；本篇不引入新的顶层包。

标为“契约回归”的测试表达本节对最终实现的验收要求；按本篇顺序施工后它们必须全部通过，不要把失败断言改成接受错误结果。

## 三、第一步：让 MappedStatement 持有 SqlSource

**为什么需要这一步：** 固定 SQL 存「最终文本」就够了，动态 SQL 存不了——最终文本要到调用那一刻才存在。`MappedStatement` 作为注册期元数据，只能持有「如何生成 SQL」的策略（SqlSource），把「生成」本身推迟到调用期。

![图 2：SqlSource 把生成推迟到调用期](sqlsource-deferred-generation.svg)

第 02 篇的 `MappedStatement` 是一个 record，保存 `rawSql` 和启动期解析好的 `preparedSql`——SQL 文本在注册时就固定了。现在 SQL 不再永远固定，所以把 `PreparedSql` 字段换成 `SqlSource`：`StaticSqlSource` 仍可承接纯文本 SQL，`DynamicSqlSource` 会在每次调用时渲染节点树。同时保留第 02 篇 `fromMapperMethod` 工厂模式：XML Builder 与注解 Builder 继续走同一个入口，返回类型规则就不会分叉。

**文件：`src/main/java/com/frank/mybatis/mapping/SqlSource.java`  
包：`com.frank.mybatis.mapping`  
前置依赖：无**

```java
package com.frank.mybatis.mapping;

public interface SqlSource {
    BoundSql getBoundSql(Object parameterObject);
}
```

**文件：`src/main/java/com/frank/mybatis/mapping/ParameterMapping.java`  
包：`com.frank.mybatis.mapping`  
前置依赖：JDK `JDBCType`**

```java
package com.frank.mybatis.mapping;

import java.sql.JDBCType;
import java.util.Objects;

public final class ParameterMapping {

    private final String property;
    private final Class<?> javaType;
    private final JDBCType jdbcType;

    public ParameterMapping(
        String property,
        Class<?> javaType,
        JDBCType jdbcType
    ) {
        if (property == null || property.isBlank()) {
            throw new IllegalArgumentException("parameter property is blank");
        }
        this.property = property;
        this.javaType = javaType == null ? Object.class : javaType;
        this.jdbcType = jdbcType;
    }

    public String getProperty() {
        return property;
    }

    public Class<?> getJavaType() {
        return javaType;
    }

    public JDBCType getJdbcType() {
        return jdbcType;
    }
}
```

`ParameterMapping` 保存的是“第几个问号对应哪个属性”的元数据，而不是某次调用的值。值仍位于本次 `BoundSql` 的参数根对象或附加参数中，避免共享模板把第一次调用的值带到第二次调用。

**文件：`src/main/java/com/frank/mybatis/mapping/BoundSql.java`  
包：`com.frank.mybatis.mapping`  
前置依赖：`ParameterMapping`、JDK 集合**

```java
package com.frank.mybatis.mapping;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

public final class BoundSql {

    private final String sql;
    private final List<ParameterMapping> parameterMappings;
    private final Object parameterObject;
    private final Map<String, Object> additionalParameters =
        new LinkedHashMap<>();

    public BoundSql(
        String sql,
        List<ParameterMapping> parameterMappings,
        Object parameterObject
    ) {
        if (sql == null || sql.isBlank()) {
            throw new IllegalArgumentException("bound SQL is blank");
        }
        this.sql = sql;
        this.parameterMappings = List.copyOf(parameterMappings);
        this.parameterObject = parameterObject;
    }

    public String getSql() {
        return sql;
    }

    public List<ParameterMapping> getParameterMappings() {
        return parameterMappings;
    }

    public Object getParameterObject() {
        return parameterObject;
    }

    public void setAdditionalParameter(String name, Object value) {
        additionalParameters.put(Objects.requireNonNull(name), value);
    }

    public boolean hasAdditionalParameter(String name) {
        return additionalParameters.containsKey(rootName(name));
    }

    public Object getAdditionalParameter(String name) {
        return additionalParameters.get(rootName(name));
    }

    private static String rootName(String property) {
        int dot = property.indexOf('.');
        return dot < 0 ? property : property.substring(0, dot);
    }
}
```

`additionalParameters` 的唯一用途是保存动态上下文中的循环变量，例如 `__frch_id_0`。每个 `BoundSql` 都有自己的 Map，因此并发渲染同一模板不会共享局部变量。

**文件：`src/main/java/com/frank/mybatis/mapping/StaticSqlSource.java`  
包：`com.frank.mybatis.mapping`  
前置依赖：`BoundSql`、`ParameterMapping`**

```java
package com.frank.mybatis.mapping;

import java.util.List;

public final class StaticSqlSource implements SqlSource {

    private final String sql;
    private final List<ParameterMapping> parameterMappings;

    public StaticSqlSource(
        String sql,
        List<ParameterMapping> parameterMappings
    ) {
        this.sql = sql;
        this.parameterMappings = List.copyOf(parameterMappings);
    }

    @Override
    public BoundSql getBoundSql(Object parameterObject) {
        return new BoundSql(sql, parameterMappings, parameterObject);
    }
}
```

静态来源可以安全复用最终 SQL 与参数**描述**，但仍必须为每次调用创建新 `BoundSql`，因为参数根对象不同。

**文件：`src/main/java/com/frank/mybatis/mapping/MappedStatement.java`  
包：`com.frank.mybatis.mapping`  
前置依赖：既有 `SqlCommandType`、本篇 `SqlSource`**

```java
package com.frank.mybatis.mapping;

import java.lang.reflect.Method;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.List;
import java.util.Objects;

public final class MappedStatement {

    private final String id;
    private final String namespace;
    private final SqlSource sqlSource;
    private final SqlCommandType commandType;
    private final Class<?> parameterType;
    private final Class<?> resultType;
    private final boolean returnsMany;
    private final Method method;

    public MappedStatement(
        String id,
        String namespace,
        SqlSource sqlSource,
        SqlCommandType commandType,
        Class<?> parameterType,
        Class<?> resultType,
        boolean returnsMany,
        Method method
    ) {
        this.id = requireText(id, "id");
        this.namespace = requireText(namespace, "namespace");
        this.sqlSource = Objects.requireNonNull(sqlSource, "sqlSource");
        this.commandType = Objects.requireNonNull(commandType, "commandType");
        this.parameterType =
            parameterType == null ? Object.class : parameterType;
        this.resultType = resultType == null ? Object.class : resultType;
        this.returnsMany = returnsMany;
        this.method = method;
    }

    public static MappedStatement fromMapperMethod(
        String id,
        String namespace,
        SqlSource sqlSource,
        SqlCommandType commandType,
        Method method
    ) {
        Objects.requireNonNull(method, "mapper method");
        String expectedId = method.getDeclaringClass().getName()
            + "." + method.getName();
        if (!expectedId.equals(id)) {
            throw new IllegalArgumentException(
                "statement id does not match mapper method: " + id);
        }
        Class<?> parameterType = method.getParameterCount() == 1
            ? method.getParameterTypes()[0]
            : Object.class;
        ResultShape shape = resultShapeOf(method, commandType);
        return new MappedStatement(
            id,
            namespace,
            sqlSource,
            commandType,
            parameterType,
            shape.resultType(),
            shape.returnsMany(),
            method
        );
    }

    private static ResultShape resultShapeOf(
        Method method,
        SqlCommandType commandType
    ) {
        if (commandType != SqlCommandType.SELECT) {
            if (method.getReturnType() != int.class) {
                throw new IllegalArgumentException(
                    "DML mapper method must return int: " + method);
            }
            return new ResultShape(Void.class, false);
        }
        if (method.getReturnType() == List.class) {
            Type genericType = method.getGenericReturnType();
            if (genericType instanceof ParameterizedType parameterizedType
                && parameterizedType.getActualTypeArguments()[0] instanceof Class<?> type) {
                return new ResultShape(type, true);
            }
            throw new IllegalArgumentException(
                "List query must declare a concrete element type: " + method);
        }
        Class<?> type = method.getReturnType();
        if (type.isPrimitive() || type.isInterface() || type == Object.class) {
            throw new IllegalArgumentException(
                "SELECT mapper method must return a concrete POJO: " + method);
        }
        return new ResultShape(type, false);
    }

    public String getId() {
        return id;
    }

    public String getNamespace() {
        return namespace;
    }

    public SqlSource getSqlSource() {
        return sqlSource;
    }

    public SqlCommandType getCommandType() {
        return commandType;
    }

    public Class<?> getParameterType() {
        return parameterType;
    }

    public Class<?> getResultType() {
        return resultType;
    }

    public boolean returnsMany() {
        return returnsMany;
    }

    public Method getMethod() {
        return method;
    }

    private static String requireText(String value, String name) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " is blank");
        }
        return value;
    }

    private record ResultShape(Class<?> resultType, boolean returnsMany) {}
}
```

与第 02 篇相比有三处刻意变化：record 换成带 getter 的不可变类，因为元数据从 6 个字段增长到 8 个且工厂校验逻辑变长；新增 `namespace` 与 `returnsMany`，二级缓存（第 04 篇）按 namespace 失效，`MapperMethod` 按 `returnsMany` 路由单查还是列表；`preparedSql` 换成 `sqlSource`，SQL 推迟到调用期生成。返回形状校验逻辑从第 02 篇原样保留——DML 必须 `int`，查询必须具体 POJO 或 `List<具体 POJO>`。

改完本文件后，`XMLMapperBuilder` 和 `MapperAnnotationBuilder` 里 `fromMapperMethod` 的旧调用点会编译失败，这是预期的：第八节会把两处统一切到 `SqlSource`。中间想保持可编译，可以临时用 `new StaticSqlSource(sql, List.of())` 占位。

### 本节单元测试：静态模板复用时隔离实参

```java
@Test void staticSourceCreatesIndependentBoundSql() {
    var mappings = new java.util.ArrayList<com.frank.mybatis.mapping.ParameterMapping>();
    mappings.add(new com.frank.mybatis.mapping.ParameterMapping("id", Long.class, null));
    var template = new com.frank.mybatis.mapping.StaticSqlSource("select ?", mappings);
    mappings.clear();
    BoundSql first = template.getBoundSql(Map.of("id", 1L));
    BoundSql second = template.getBoundSql(Map.of("id", 2L));
    assertNotSame(first, second);
    assertEquals(Map.of("id", 1L), first.getParameterObject());
    assertEquals(Map.of("id", 2L), second.getParameterObject());
    assertEquals(1, second.getParameterMappings().size());
    first.setAdditionalParameter("local", 9L);
    assertFalse(second.hasAdditionalParameter("local"));
    assertThrows(UnsupportedOperationException.class, () -> first.getParameterMappings().clear());
}
```

## 四、第二步：建立每次调用独有的 DynamicContext

**为什么需要这一步：** SQL 文本、参数映射、循环局部变量都在渲染过程中逐步产生，需要暂存位置——但绝不能放在共享的模板对象上，否则两次并发调用互相污染。每次 `getBoundSql` 新建一个上下文，是「共享规则、隔离状态」这条主线上的第一个落地。

![图 3：共享规则、隔离状态](shared-template-isolated-context.svg)

动态节点需要同时积累 SQL、参数映射、参数根对象和局部变量。`DynamicContext` 不是全局单例；每次 `getBoundSql` 都新建它。

**文件：`src/main/java/com/frank/mybatis/scripting/SqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：`DynamicContext`**

```java
package com.frank.mybatis.scripting;

public interface SqlNode {
    boolean apply(DynamicContext context);
}
```

返回值表示该节点是否实际输出了 SQL。`foreach` 用它判断一次迭代是否需要拼接 `separator`；这比根据文本是否包含空白判断可靠。

**文件：`src/main/java/com/frank/mybatis/scripting/DynamicContext.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：`BoundSql`、`ParameterMapping`、JDK 反射与集合**

```java
package com.frank.mybatis.scripting;

import com.frank.mybatis.mapping.BoundSql;
import com.frank.mybatis.mapping.ParameterMapping;
import java.beans.Introspector;
import java.lang.reflect.Array;
import java.lang.reflect.Method;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Deque;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

public final class DynamicContext {

    private final Object parameterObject;
    private final StringBuilder sql = new StringBuilder();
    private final Map<String, Object> bindings = new LinkedHashMap<>();
    private final Deque<Map<String, String>> aliases = new ArrayDeque<>();
    private final List<ParameterMapping> parameterMappings = new ArrayList<>();
    private int uniqueNumber;

    public DynamicContext(Object parameterObject) {
        this.parameterObject = parameterObject;
        bindings.put("_parameter", parameterObject);
        if (parameterObject instanceof Collection<?> collection) {
            bindings.put("collection", collection);
            if (parameterObject instanceof java.util.List<?>) {
                bindings.put("list", collection);
            }
        }
        if (parameterObject != null && parameterObject.getClass().isArray()) {
            bindings.put("array", parameterObject);
        }
    }

    public Object getParameterObject() {
        return parameterObject;
    }

    public void appendSql(String fragment) {
        sql.append(fragment);
    }

    public String getSql() {
        return sql.toString();
    }

    public void bind(String name, Object value) {
        bindings.put(name, value);
    }

    public void addParameterMapping(ParameterMapping mapping) {
        parameterMappings.add(mapping);
    }

    public List<ParameterMapping> getParameterMappings() {
        return List.copyOf(parameterMappings);
    }

    public int nextUniqueNumber() {
        return uniqueNumber++;
    }

    public void pushAlias(String source, String target) {
        aliases.push(Map.of(source, target));
    }

    public void popAlias() {
        aliases.pop();
    }

    public String uniqueProperty(String property) {
        int dot = property.indexOf('.');
        String first = dot < 0 ? property : property.substring(0, dot);
        for (Map<String, String> scope : aliases) {
            String replacement = scope.get(first);
            if (replacement != null) {
                return dot < 0
                    ? replacement
                    : replacement + property.substring(dot);
            }
        }
        return property;
    }

    public Object getValue(String property) {
        String[] parts = property.split("\\.");
        Object value;
        if (bindings.containsKey(parts[0])) {
            value = bindings.get(parts[0]);
        } else {
            value = readProperty(parameterObject, parts[0]);
        }
        for (int i = 1; i < parts.length; i++) {
            value = readProperty(value, parts[i]);
        }
        return value;
    }

    public BoundSql buildBoundSql() {
        BoundSql boundSql = new BoundSql(
            sql.toString().trim(),
            parameterMappings,
            parameterObject
        );
        bindings.forEach(boundSql::setAdditionalParameter);
        return boundSql;
    }

    public static Object readProperty(Object target, String property) {
        if ("class".equals(property)) {
            throw new IllegalArgumentException("property class is forbidden");
        }
        if (target == null) {
            return null;
        }
        if (target instanceof Map<?, ?> map) {
            if (!map.containsKey(property)) {
                throw new IllegalArgumentException(
                    "missing map key: " + property
                );
            }
            return map.get(property);
        }
        if (
            "size".equals(property) &&
            target instanceof Collection<?> collection
        ) {
            return collection.size();
        }
        if ("size".equals(property) && target.getClass().isArray()) {
            return Array.getLength(target);
        }
        try {
            for (var descriptor : Introspector.getBeanInfo(
                target.getClass(),
                Object.class
            ).getPropertyDescriptors()) {
                if (descriptor.getName().equals(property)) {
                    Method getter = descriptor.getReadMethod();
                    if (
                        getter == null ||
                        !java.lang.reflect.Modifier.isPublic(
                            getter.getModifiers()
                        )
                    ) {
                        throw new IllegalArgumentException(
                            "property is not publicly readable: " + property
                        );
                    }
                    return getter.invoke(target);
                }
            }
            if (target.getClass().isRecord()) {
                for (var component : target.getClass().getRecordComponents()) {
                    if (component.getName().equals(property)) {
                        return component.getAccessor().invoke(target);
                    }
                }
            }
        } catch (ReflectiveOperationException exception) {
            throw new IllegalArgumentException(
                "cannot read property: " + property,
                exception
            );
        }
        throw new IllegalArgumentException(
            "unknown readable property: " +
                target.getClass().getName() +
                "." +
                property
        );
    }
}
```

这里的参数规则是明确的：单个 Bean 通过 public getter 或 record accessor 读取；单个 Map 用 key 读取且“缺 key”与“key 的值为 null”不同；单个 `Collection` 有 `collection` 和 `list` 别名；数组有 `array` 别名；任意根对象可写 `_parameter`。

多 Mapper 参数不是动态层猜测出来的。保留第 02 篇 `@Param` 规则，由执行器先组装 `Map<String,Object>`，这样 XML 中的 `name`、`ids` 与 `sort` 都是稳定 key。不要使用 `Map.of` 保存可能为 null 的方法参数。

### 本节单元测试：缺 key、null 与上下文隔离

```java
@Test void contextDistinguishesNullFromMissingAndSeparatesBindings() {
    Map<String,Object> values = new HashMap<>();
    values.put("name", null);
    DynamicContext first = new DynamicContext(values);
    DynamicContext second = new DynamicContext(values);
    assertNull(first.getValue("name"));
    assertThrows(IllegalArgumentException.class, () -> first.getValue("missing"));
    first.bind("local", 7L);
    assertEquals(7L, first.getValue("local"));
    assertThrows(IllegalArgumentException.class, () -> second.getValue("local"));
    assertEquals(3, new DynamicContext(new int[]{1, 2, 3}).getValue("array.size"));
    assertThrows(IllegalArgumentException.class,
            () -> DynamicContext.readProperty(values, "class"));
}
```

## 五、第三步：文本节点、#{} 与受限 ${}

**为什么需要这一步：** 文本节点是动态 SQL 最小的积木，也是安全边界所在：`#{}` 必须变成问号走预编译，`${}` 是 SQL 结构替换、只能白名单放行。先把这两个 token 的语义钉死，后面的 if/where/foreach 才只是在组合它们。

![图 4：#{} 换值不换形，${} 换形必过白名单](hash-vs-dollar.svg)

### 5.1 `#{}` 始终是 JDBC 数据槽位

`#{name}` 必须只生成 `?` 和一个 `ParameterMapping`。用户输入 `x' OR 1=1 --` 仍是绑定值，绝不能进入 SQL 文本。

`null` 没有可靠的 JDBC 类型推断，因此模板中 null 可能出现的位置必须写 `jdbcType`，例如 `#{deletedAt,jdbcType=TIMESTAMP}`。后文的 `ParameterHandler` 会据此调用 `setNull`。

### 5.2 `${}` 是 SQL 结构，默认拒绝

`${}` 不能安全地绑定为问号，典型场景只有可信的排序列或排序方向。这里的实现不接受请求原文，而是把逻辑 key 映射到服务端常量：`name -> user_name`、`created -> created_at`。未经登记的 `${}` 立即报错。

**文件：`src/main/java/com/frank/mybatis/scripting/TextSqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：`SqlNode`、`DynamicContext`、`ParameterMapping`、JDK `JDBCType`**

```java
package com.frank.mybatis.scripting;

import com.frank.mybatis.mapping.ParameterMapping;
import java.sql.JDBCType;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class TextSqlNode implements SqlNode {

    private static final Pattern TOKEN = Pattern.compile("([#$])\\{([^}]+)}");
    private static final Pattern PATH = Pattern.compile(
        "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*"
    );
    private final String text;
    private final Map<String, Map<String, String>> sqlWhitelist;

    public TextSqlNode(
        String text,
        Map<String, Map<String, String>> sqlWhitelist
    ) {
        this.text = text;
        this.sqlWhitelist = sqlWhitelist;
    }

    public boolean isDynamic() {
        return text.contains("${");
    }

    @Override
    public boolean apply(DynamicContext context) {
        Matcher matcher = TOKEN.matcher(text);
        int cursor = 0;
        boolean wrote = false;
        while (matcher.find()) {
            String literal = text.substring(cursor, matcher.start());
            rejectUnsafeLiteral(literal);
            context.appendSql(literal);
            wrote |= !literal.isBlank();
            String raw = matcher.group(2).trim();
            if ("#".equals(matcher.group(1))) {
                String property = parseParameterProperty(raw);
                String uniqueProperty = context.uniqueProperty(property);
                Object value = context.getValue(property);
                context.appendSql("?");
                context.addParameterMapping(
                    new ParameterMapping(
                        uniqueProperty,
                        value == null ? Object.class : value.getClass(),
                        parseJdbcType(raw)
                    )
                );
                wrote = true;
            } else {
                String property = parsePlainProperty(raw);
                Object value = context.getValue(property);
                context.appendSql(expandWhitelistedSql(property, value));
                wrote = true;
            }
            cursor = matcher.end();
        }
        String tail = text.substring(cursor);
        rejectUnsafeLiteral(tail);
        context.appendSql(tail);
        return wrote || !tail.isBlank();
    }

    private static String parseParameterProperty(String raw) {
        String property = raw.split(",", -1)[0].trim();
        return parsePlainProperty(property);
    }

    private static String parsePlainProperty(String property) {
        if (!PATH.matcher(property).matches()) {
            throw new IllegalArgumentException(
                "invalid parameter property: " + property
            );
        }
        return property;
    }

    private static JDBCType parseJdbcType(String raw) {
        String[] parts = raw.split(",", -1);
        if (parts.length == 1) {
            return null;
        }
        if (parts.length != 2 || !parts[1].trim().startsWith("jdbcType=")) {
            throw new IllegalArgumentException(
                "only jdbcType is supported: " + raw
            );
        }
        return JDBCType.valueOf(
            parts[1].trim().substring("jdbcType=".length())
        );
    }

    private String expandWhitelistedSql(String property, Object value) {
        if (!(value instanceof String key)) {
            throw new IllegalArgumentException(
                "${" + property + "} must resolve to a String key"
            );
        }
        Map<String, String> choices = sqlWhitelist.get(property);
        if (choices == null || !choices.containsKey(key)) {
            throw new IllegalArgumentException(
                "SQL fragment is not whitelisted: " + property
            );
        }
        return choices.get(key);
    }

    private static void rejectUnsafeLiteral(String literal) {
        if (
            literal.contains("?") ||
            literal.contains("--") ||
            literal.contains("/*")
        ) {
            throw new IllegalArgumentException(
                "use #{}; raw ? and SQL comments are forbidden"
            );
        }
    }
}
```

这个简化词法规则特意拒绝裸 `?` 和 SQL 注释，避免模板作者绕过映射数量检查。它也不支持在引号中写占位符，例如 `name = '#{name}'`；那会得到一个引号内问号，而不是 JDBC 参数。生产框架若支持更多 SQL 方言，必须先扩展词法测试，而不是用更宽松正则“放开”。

`${}` 的白名单必须在 Java 配置中由可信代码提供，且值是固定 SQL 片段：

**文件：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量片段）  
包：`com.frank.mybatis.session`  
前置依赖：既有 `Configuration`、JDK `Map`**

```java
private final Map<String, Map<String, String>> sqlWhitelist =
    new HashMap<>();

public void addSqlWhitelist(String property, Map<String, String> choices) {
    if (choices.isEmpty()) {
        throw new IllegalArgumentException(
            "empty SQL whitelist: " + property
        );
    }
    sqlWhitelist.put(property, Map.copyOf(choices));
}

public Map<String, Map<String, String>> getSqlWhitelist() {
    return Map.copyOf(sqlWhitelist);
}
```

启动代码只登记固定片段，不能把 HTTP 参数直接放进这里：

```java
configuration.addSqlWhitelist(
    "sort",
    Map.of("name", "user_name", "created", "created_at", "id", "id")
);
configuration.addSqlWhitelist(
    "direction",
    Map.of("asc", "ASC", "desc", "DESC")
);
```

### 本节单元测试：模板结构与输入值分离

```java
@Test void textNodeBindsValuesAndRejectsUnregisteredSqlFragments() throws Exception {
    String attack = "x' OR 1=1 --";
    BoundSql bound = source("<select>select #{name,jdbcType=VARCHAR}</select>", Map.of())
            .getBoundSql(Map.of("name", attack));
    assertEquals("select ?", flat(bound));
    assertFalse(bound.getSql().contains(attack));
    assertThrows(IllegalArgumentException.class,
            () -> source("<select>select ?</select>", Map.of()));
    assertThrows(IllegalArgumentException.class,
            () -> source("<select>select ${sort}</select>", Map.of())
                    .getBoundSql(Map.of("sort", "id")));
    assertEquals("select user_name", flat(source("<select>select ${sort}</select>", whitelist())
            .getBoundSql(Map.of("sort", "name"))));
}
```

本测试只验证结构隔离；真实恶意字符串作为值往返的验证放在第十节绑定测试中。

## 六、第四步：安全表达式与 <if>

**为什么需要这一步：** `<if>` 的 test 表达式若直接上 OGNL，等于允许模板调用任意 Java 方法——「支持动态条件」会退化成「模板即代码」。先实现一个只含比较与 and/or 的子集：语法启动期校验，求值渲染期短路，能力之外明确报错而不是静默降级。

![图 5：受限表达式子集 vs 完整 OGNL](safe-expression-subset.svg)

真实 MyBatis 使用 OGNL。为避免把“支持动态条件”误做成“允许模板调用任意 Java 方法”，本篇只支持下列表达式子集：

```text
条件       := 比较 ("or" 比较)*
比较       := 项 ("and" 项)*
项         := 属性 比较符 字面量
比较符     := == | != | > | >= | < | <=
字面量     := null | true | false | 十进制数字 | 属性
示例       := name != null
示例       := ids != null and ids.size > 0
示例       := age >= 18 or enabled == true
```

不支持括号、方法调用、字符串字面量、索引、算术、构造对象、类访问和静态成员访问。XML 属性中的 `<` 必须写为 `&lt;`。`and` 优先于 `or`，并且短路求值：`ids != null and ids.size > 0` 在 ids 为 null 时不会继续读取 size。

**文件：`src/main/java/com/frank/mybatis/scripting/IfSqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：`SqlNode`、`DynamicContext`、JDK `BigDecimal` 与正则**

```java
package com.frank.mybatis.scripting;

import java.math.BigDecimal;
import java.util.Objects;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class IfSqlNode implements SqlNode {

    private static final String PATH =
        "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";
    private static final String OPERAND =
        "(?:null|true|false|-?\\d+(?:\\.\\d+)?|" + PATH + ")";
    private static final Pattern COMPARISON = Pattern.compile(
        "(" + OPERAND + ")\\s*(==|!=|>=|<=|>|<)\\s*(" + OPERAND + ")"
    );
    private final String test;
    private final SqlNode contents;

    public IfSqlNode(String test, SqlNode contents) {
        this.test = Objects.requireNonNull(test).trim();
        this.contents = Objects.requireNonNull(contents);
        validate(this.test);
    }

    @Override
    public boolean apply(DynamicContext context) {
        return evaluate(test, context) && contents.apply(context);
    }

    private static void validate(String expression) {
        for (String orPart : expression.split("\\s+or\\s+", -1)) {
            for (String andPart : orPart.split("\\s+and\\s+", -1)) {
                if (!COMPARISON.matcher(andPart.trim()).matches()) {
                    throw new IllegalArgumentException(
                        "unsupported if expression: " + expression
                    );
                }
            }
        }
    }

    private static boolean evaluate(String expression, DynamicContext context) {
        for (String orPart : expression.split("\\s+or\\s+")) {
            boolean all = true;
            for (String andPart : orPart.split("\\s+and\\s+")) {
                if (!evaluateComparison(andPart.trim(), context)) {
                    all = false;
                    break;
                }
            }
            if (all) {
                return true;
            }
        }
        return false;
    }

    private static boolean evaluateComparison(
        String input,
        DynamicContext context
    ) {
        Matcher matcher = COMPARISON.matcher(input);
        if (!matcher.matches()) {
            throw new IllegalArgumentException(
                "unsupported if expression: " + input
            );
        }
        Object left = operand(matcher.group(1), context);
        Object right = operand(matcher.group(3), context);
        return compare(left, matcher.group(2), right);
    }

    private static Object operand(String token, DynamicContext context) {
        return switch (token) {
            case "null" -> null;
            case "true" -> true;
            case "false" -> false;
            default -> token.matches("-?\\d+(?:\\.\\d+)?")
                ? new BigDecimal(token)
                : context.getValue(token);
        };
    }

    private static boolean compare(Object left, String operator, Object right) {
        boolean numeric = left instanceof Number && right instanceof Number;
        int order = numeric
            ? new BigDecimal(left.toString()).compareTo(
                  new BigDecimal(right.toString())
              )
            : 0;
        return switch (operator) {
            case "==" -> numeric ? order == 0 : Objects.equals(left, right);
            case "!=" -> numeric ? order != 0 : !Objects.equals(left, right);
            case ">" -> numeric && order > 0;
            case ">=" -> numeric && order >= 0;
            case "<" -> numeric && order < 0;
            case "<=" -> numeric && order <= 0;
            default -> throw new IllegalArgumentException(
                "unknown operator: " + operator
            );
        };
    }
}
```

表达式是一个受限选择器，不是进程沙箱。Bean getter 本身仍是应用代码，因此 Mapper XML、Bean 类型和白名单必须来自可信发布物。外部请求只能作为值进入参数对象。

### 本节单元测试：优先级与短路求值

直接构造 `IfSqlNode`，让子节点输出标志文本，避免 XML 解析错误干扰表达式诊断。

```java
@Test void ifNodeHonorsPrecedenceAndShortCircuit() {
    com.frank.mybatis.scripting.SqlNode body = context -> {
        context.appendSql("matched");
        return true;
    };
    var node = new com.frank.mybatis.scripting.IfSqlNode(
            "enabled == true or age >= 18 and allowed == true", body);
    var denied = new DynamicContext(Map.of("enabled", false, "age", 20, "allowed", false));
    assertFalse(node.apply(denied));
    assertEquals("", denied.getSql());
    // 缺少 age、allowed 仍能通过，证明 or 后半段没有被读取。
    var enabled = new DynamicContext(Map.of("enabled", true));
    assertTrue(node.apply(enabled));
    assertEquals("matched", enabled.getSql());
    var guarded = new com.frank.mybatis.scripting.IfSqlNode(
            "enabled == true and missing > 0", body);
    assertFalse(guarded.apply(new DynamicContext(Map.of("enabled", false))));
    assertThrows(IllegalArgumentException.class,
            () -> new com.frank.mybatis.scripting.IfSqlNode("name.toString() != null", body));
}
```

## 七、第五步：<trim>、<where> 与 <foreach>

**为什么需要这一步：** 这三个标签解决的都是「结构拼接」问题：where 不能输出空 WHERE、不能留下开头的 AND；foreach 展开循环还要保证每轮参数互不串扰。它们都必须先在子上下文里缓冲、再决定最终输出，不能边拼边改。

![图 6：where/trim 先缓冲再裁剪](trim-where-buffer.svg)

### 7.1 Trim：先缓冲，再裁剪边界

`<trim>` 不能在主 SQL 中边输出边删除，因为子节点可能一个都不命中。它应先将内容写入临时上下文；只有有内容时，才输出 prefix、主体和 suffix。`<where>` 是固定规则的 trim：前缀为 `WHERE`，移除开头独立的 `AND` 或 `OR`。

**文件：`src/main/java/com/frank/mybatis/scripting/TrimSqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：带 `newChild`/`appendChild` 的 `DynamicContext`、`SqlNode`**

`TrimSqlNode` 必须先在子上下文渲染，再按单词边界移除前后 override，最后把子 SQL、映射和附加参数一次性合并回父上下文。完整实现见下面的最终文件块；本节不保留会先写入主上下文的过渡实现。

**文件：`src/main/java/com/frank/mybatis/scripting/DynamicContext.java`（在上一版本基础上的必要增量）  
包：`com.frank.mybatis.scripting`  
前置依赖：本节 `TrimSqlNode`、前文 `DynamicContext`**

```java
public DynamicContext newChild() {
    DynamicContext child = new DynamicContext(parameterObject);
    child.bindings.putAll(this.bindings);
    child.parameterMappings.addAll(this.parameterMappings);
    child.uniqueNumber = this.uniqueNumber;
    return child;
}

public void appendChild(DynamicContext child, String fragment) {
    this.uniqueNumber = child.uniqueNumber;
    child.bindings.forEach(this.bindings::put);
    this.parameterMappings.clear();
    this.parameterMappings.addAll(child.parameterMappings);
    appendSql(fragment);
}
```

将这两个方法添加到 `DynamicContext` 类的末尾、最后一个右花括号之前。它们共享的是本次调用的参数根对象，复制的是当前局部绑定与已收集的 `ParameterMapping`；合并时把 foreach 产生的附加参数和循环映射一并带回父上下文。`appendChild` 用“清空再复制”而不是逐条追加，是为了让嵌套 `foreach` 的多次合并始终以子上下文的最终状态为准。

**文件：`src/main/java/com/frank/mybatis/scripting/TrimSqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：带 `newChild`/`appendChild` 的 `DynamicContext`、`SqlNode`**

```java
package com.frank.mybatis.scripting;

import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class TrimSqlNode implements SqlNode {

    private final String prefix;
    private final String suffix;
    private final List<String> prefixesToOverride;
    private final List<String> suffixesToOverride;
    private final SqlNode contents;

    public TrimSqlNode(
        String prefix,
        String suffix,
        List<String> prefixesToOverride,
        List<String> suffixesToOverride,
        SqlNode contents
    ) {
        this.prefix = prefix == null ? "" : prefix;
        this.suffix = suffix == null ? "" : suffix;
        this.prefixesToOverride = List.copyOf(prefixesToOverride);
        this.suffixesToOverride = List.copyOf(suffixesToOverride);
        this.contents = contents;
    }

    @Override
    public boolean apply(DynamicContext context) {
        DynamicContext child = context.newChild();
        if (!contents.apply(child)) {
            return false;
        }
        String sql = removeSuffix(removePrefix(child.getSql().trim()));
        if (sql.isBlank()) {
            return false;
        }
        String result = join(prefix, sql, suffix);
        context.appendChild(child, result);
        return true;
    }

    protected String removePrefix(String sql) {
        for (String token : prefixesToOverride) {
            Pattern pattern = Pattern.compile(
                "^(?i:" + Pattern.quote(token.trim()) + ")(?![A-Za-z0-9_])\\s*"
            );
            Matcher matcher = pattern.matcher(sql);
            if (matcher.find()) {
                return sql.substring(matcher.end()).trim();
            }
        }
        return sql;
    }

    protected String removeSuffix(String sql) {
        for (String token : suffixesToOverride) {
            Pattern pattern = Pattern.compile(
                "\\s*(?i:" + Pattern.quote(token.trim()) + ")$"
            );
            Matcher matcher = pattern.matcher(sql);
            if (matcher.find()) {
                return sql.substring(0, matcher.start()).trim();
            }
        }
        return sql;
    }

    private static String join(String prefix, String sql, String suffix) {
        StringBuilder result = new StringBuilder();
        if (!prefix.isBlank()) result.append(' ').append(prefix.trim());
        result.append(' ').append(sql);
        if (!suffix.isBlank()) result.append(' ').append(suffix.trim());
        return result.append(' ').toString();
    }
}
```

**文件：`src/main/java/com/frank/mybatis/scripting/WhereSqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：`TrimSqlNode`、`SqlNode`、JDK `List`**

```java
package com.frank.mybatis.scripting;

import java.util.List;

public final class WhereSqlNode extends TrimSqlNode {

    public WhereSqlNode(SqlNode contents) {
        super("WHERE", "", List.of("AND", "OR"), List.of(), contents);
    }
}
```

模板文本仍必须自行保留词间空白。`where` 只去掉开头的独立 AND/OR，`order_no` 不会被误裁成 `der_no`。`trim suffixOverrides=","` 则解决动态 `SET` 子句的最后一个逗号。

### 7.2 Foreach：每次循环创建稳定的唯一名称

`#{item}` 若在循环结束后再按名字读取，会只看到最后一个 item。正确做法是在每次迭代把元素绑定为唯一变量，例如 `__frch_id_0`、`__frch_id_1`，并在当轮把 `#{id}` 重写到该唯一名。`BoundSql` 取得这些附加变量后，参数顺序永久稳定。

**文件：`src/main/java/com/frank/mybatis/scripting/ForEachSqlNode.java`  
包：`com.frank.mybatis.scripting`  
前置依赖：`SqlNode`、`DynamicContext`、JDK `Array`、`Collection`**

```java
package com.frank.mybatis.scripting;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;

public final class ForEachSqlNode implements SqlNode {

    private final String collectionExpression;
    private final String item;
    private final String index;
    private final String open;
    private final String close;
    private final String separator;
    private final SqlNode contents;

    public ForEachSqlNode(
        String collectionExpression,
        String item,
        String index,
        String open,
        String close,
        String separator,
        SqlNode contents
    ) {
        this.collectionExpression = collectionExpression;
        this.item = item;
        this.index = index;
        this.open = open == null ? "" : open;
        this.close = close == null ? "" : close;
        this.separator = separator == null ? "" : separator;
        this.contents = contents;
    }

    @Override
    public boolean apply(DynamicContext context) {
        List<Object> values = elements(context.getValue(collectionExpression));
        if (values.isEmpty()) {
            throw new IllegalArgumentException(
                "foreach collection must not be empty: " + collectionExpression
            );
        }
        if (values.size() > 1000) {
            throw new IllegalArgumentException(
                "foreach collection exceeds 1000 elements"
            );
        }
        DynamicContext joined = context.newChild();
        int emitted = 0;
        for (int i = 0; i < values.size(); i++) {
            int unique = joined.nextUniqueNumber();
            String itemName = "__frch_" + item + "_" + unique;
            String indexName = "__frch_" + index + "_" + unique;
            DynamicContext iteration = joined.newChild();
            iteration.bind(itemName, values.get(i));
            iteration.bind(indexName, i);
            iteration.pushAlias(item, itemName);
            iteration.pushAlias(index, indexName);
            boolean applied = contents.apply(iteration);
            iteration.popAlias();
            iteration.popAlias();
            if (applied && !iteration.getSql().isBlank()) {
                if (emitted++ > 0) {
                    joined.appendSql(separator);
                }
                joined.appendChild(iteration, iteration.getSql());
            }
        }
        if (emitted == 0) {
            throw new IllegalArgumentException("foreach produced no SQL");
        }
        context.appendChild(joined, open + joined.getSql() + close);
        return true;
    }

    private static List<Object> elements(Object source) {
        if (source instanceof Collection<?> collection) {
            return new ArrayList<>(collection);
        }
        if (source != null && source.getClass().isArray()) {
            List<Object> values = new ArrayList<>();
            for (int i = 0; i < Array.getLength(source); i++) {
                values.add(Array.get(source, i));
            }
            return values;
        }
        throw new IllegalArgumentException(
            "foreach requires a non-null Collection or array"
        );
    }
}
```

`byte[]` 有两种不同语义：作为 `foreach` 输入会拆成多个数值；作为单个 `#{payload}` 则由 `ByteArrayTypeHandler` 写为 VARBINARY。SQL ARRAY 也不是 foreach：它是一个问号绑定一个数据库数组，留到确有方言需求时再专门实现。

空权限 ID 集合不能被静默跳过，否则 `<where>` 可能丢失权限条件。本篇默认空集合报错；业务层可以在调用 Mapper 前直接返回空结果。1000 是示例上限，生产系统还应限制总参数数、SQL 长度、分页和超时。

### 本节契约回归：循环快照可绑定，重复渲染不串值

```java
@Test void foreachSnapshotsSurviveRenderingAndBinding() throws Exception {
    SqlSource template = source("""
            <select>select <foreach collection="ids" item="id" separator=",">#{id}</foreach></select>
            """, Map.of());
    BoundSql first = template.getBoundSql(Map.of("ids", List.of(3L, 1L)));
    BoundSql second = template.getBoundSql(Map.of("ids", List.of(9L)));
    assertEquals("select ?,?", flat(first));
    assertEquals("select ?", flat(second));
    assertEquals(2, first.getParameterMappings().size());
    assertEquals(1, second.getParameterMappings().size());
    for (var mapping : first.getParameterMappings()) {
        assertTrue(first.hasAdditionalParameter(mapping.getProperty()));
    }
    try (Connection c = connection(); PreparedStatement ps = c.prepareStatement(first.getSql())) {
        new ParameterHandler(new TypeHandlerRegistry()).setParameters(ps, first);
        try (ResultSet rs = ps.executeQuery()) {
            assertTrue(rs.next());
            assertEquals(3L, rs.getLong(1));
            assertEquals(1L, rs.getLong(2));
        }
    }
}
```

若提示 `missing map key: id`，检查 `getValue` 是否先解析循环别名；若找不到 `__frch_...`，检查 `buildBoundSql` 是否把 bindings 复制进最终 `BoundSql` 的附加参数。`where` 的空条件、`order_no` 单词边界及 `trim` 尾逗号继续由第 11.3 节测试覆盖。

## 八、第六步：将 XML 元素编译成节点树与 SqlSource

**为什么需要这一步：** `getTextContent()` 会把 `<if>`、`<foreach>` 连同条件一起拍平成纯文本，动态语义全部丢失。要让 DOM 变成可反复求值的结构，就得把它编译成一棵 `SqlNode` 树：结构启动期定型，求值调用期进行。

![图 7：DOM 编译成 SqlNode 节点树](dom-to-node-tree.svg)

第 02 篇 `XMLMapperBuilder` 用 `element.getTextContent()` 取整段 SQL，会抹平动态标签。现在改为把 statement 元素交给 `XMLScriptBuilder`，由它把子节点编译成一棵 `SqlNode` 树。该构建器只认 `<if>`、`<where>`、`<trim>`、`<foreach>` 与文本/CDATA；未知标签或未知属性启动即失败。注解 SQL 没有标签结构，但文本规则完全相同，因此走同一个入口的 `parseText`。

**文件：`src/main/java/com/frank/mybatis/builder/XMLScriptBuilder.java`  
包：`com.frank.mybatis.builder`  
前置依赖：本篇全部 `scripting`、`mapping` 的 `SqlSource`/`StaticSqlSource`/`DynamicSqlSource`、JDK DOM**

```java
package com.frank.mybatis.builder;

import com.frank.mybatis.mapping.DynamicSqlSource;
import com.frank.mybatis.mapping.SqlSource;
import com.frank.mybatis.mapping.StaticSqlSource;
import com.frank.mybatis.scripting.DynamicContext;
import com.frank.mybatis.scripting.ForEachSqlNode;
import com.frank.mybatis.scripting.IfSqlNode;
import com.frank.mybatis.scripting.SqlNode;
import com.frank.mybatis.scripting.TextSqlNode;
import com.frank.mybatis.scripting.TrimSqlNode;
import com.frank.mybatis.scripting.WhereSqlNode;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.w3c.dom.Element;
import org.w3c.dom.Node;

public final class XMLScriptBuilder {

    private final Element statement;
    private final Map<String, Map<String, String>> sqlWhitelist;
    private boolean dynamic;

    public XMLScriptBuilder(
        Element statement,
        Map<String, Map<String, String>> sqlWhitelist
    ) {
        this.statement = statement;
        this.sqlWhitelist = sqlWhitelist;
    }

    public SqlSource parseScriptNode() {
        return toSqlSource(parseChildren(statement), dynamic);
    }

    // 注解 SQL 没有标签结构，整段文本就是一个文本节点。
    public static SqlSource parseText(
        String text,
        Map<String, Map<String, String>> sqlWhitelist
    ) {
        TextSqlNode node = new TextSqlNode(text, sqlWhitelist);
        return toSqlSource(node, node.isDynamic());
    }

    private static SqlSource toSqlSource(SqlNode root, boolean dynamic) {
        if (dynamic) {
            return new DynamicSqlSource(root);
        }
        DynamicContext context = new DynamicContext(null);
        root.apply(context);
        return new StaticSqlSource(
            context.getSql().trim(),
            context.getParameterMappings()
        );
    }

    private SqlNode parseChildren(Element parent) {
        List<SqlNode> children = new ArrayList<>();
        for (
            Node node = parent.getFirstChild();
            node != null;
            node = node.getNextSibling()
        ) {
            if (
                node.getNodeType() == Node.TEXT_NODE ||
                node.getNodeType() == Node.CDATA_SECTION_NODE
            ) {
                TextSqlNode text = new TextSqlNode(
                    node.getNodeValue(),
                    sqlWhitelist
                );
                dynamic |= text.isDynamic();
                children.add(text);
            } else if (node.getNodeType() == Node.ELEMENT_NODE) {
                dynamic = true;
                children.add(parseElement((Element) node));
            }
        }
        return context -> {
            boolean applied = false;
            for (SqlNode child : children) {
                applied |= child.apply(context);
            }
            return applied;
        };
    }

    private SqlNode parseElement(Element element) {
        return switch (element.getTagName()) {
            case "if" -> {
                requireOnly(element, "test");
                yield new IfSqlNode(
                    required(element, "test"),
                    parseChildren(element)
                );
            }
            case "where" -> {
                requireOnly(element);
                yield new WhereSqlNode(parseChildren(element));
            }
            case "trim" -> {
                requireOnly(
                    element,
                    "prefix",
                    "suffix",
                    "prefixOverrides",
                    "suffixOverrides"
                );
                yield new TrimSqlNode(
                    element.getAttribute("prefix"),
                    element.getAttribute("suffix"),
                    splitOverrides(element.getAttribute("prefixOverrides")),
                    splitOverrides(element.getAttribute("suffixOverrides")),
                    parseChildren(element)
                );
            }
            case "foreach" -> {
                requireOnly(
                    element,
                    "collection",
                    "item",
                    "index",
                    "open",
                    "close",
                    "separator"
                );
                String item = required(element, "item");
                String index = element.hasAttribute("index")
                    ? element.getAttribute("index")
                    : "index";
                validateVariable(item);
                validateVariable(index);
                yield new ForEachSqlNode(
                    required(element, "collection"),
                    item,
                    index,
                    element.getAttribute("open"),
                    element.getAttribute("close"),
                    element.getAttribute("separator"),
                    parseChildren(element)
                );
            }
            default -> throw new IllegalArgumentException(
                "unsupported dynamic SQL tag: " + element.getTagName()
            );
        };
    }

    private static List<String> splitOverrides(String input) {
        return input == null || input.isBlank()
            ? List.of()
            : Arrays.stream(input.split("\\|"))
                  .map(String::trim)
                  .filter(s -> !s.isBlank())
                  .toList();
    }

    private static String required(Element element, String name) {
        String value = element.getAttribute(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(
                "missing attribute " + name + " on " + element.getTagName()
            );
        }
        return value.trim();
    }

    private static void requireOnly(Element element, String... allowed) {
        List<String> names = List.of(allowed);
        for (int i = 0; i < element.getAttributes().getLength(); i++) {
            String actual = element.getAttributes().item(i).getNodeName();
            if (!names.contains(actual)) {
                throw new IllegalArgumentException(
                    "unknown attribute " +
                        actual +
                        " on " +
                        element.getTagName()
                );
            }
        }
    }

    private static void validateVariable(String name) {
        if (
            !name.matches("[A-Za-z_][A-Za-z0-9_]*") || "_parameter".equals(name)
        ) {
            throw new IllegalArgumentException(
                "invalid foreach variable: " + name
            );
        }
    }
}
```

静态与动态的分界在启动期决定：整棵树里只要出现一个动态标签或一段含 `${}` 的文本，就用 `DynamicSqlSource`；否则在启动期对着空参数渲染一次，把最终 SQL 和 `ParameterMapping` 列表冻结成 `StaticSqlSource`。注意静态路径的映射收集也来自 `DynamicContext`——模板树是共享规则，参数映射是每次渲染的状态，两者绝不能混在同一份可变字段里。

**文件：`src/main/java/com/frank/mybatis/mapping/DynamicSqlSource.java`  
包：`com.frank.mybatis.mapping`  
前置依赖：`SqlSource`、`BoundSql`、`SqlNode`、`DynamicContext`**

```java
package com.frank.mybatis.mapping;

import com.frank.mybatis.scripting.DynamicContext;
import com.frank.mybatis.scripting.SqlNode;

public final class DynamicSqlSource implements SqlSource {

    private final SqlNode rootSqlNode;

    public DynamicSqlSource(SqlNode rootSqlNode) {
        this.rootSqlNode = rootSqlNode;
    }

    @Override
    public BoundSql getBoundSql(Object parameterObject) {
        DynamicContext context = new DynamicContext(parameterObject);
        rootSqlNode.apply(context);
        return context.buildBoundSql();
    }
}
```

`DynamicSqlSource` 只做两件事：为本次调用创建全新 `DynamicContext`，让节点树在上下文里积累 SQL 与映射，最后封口成 `BoundSql`。它自己不保存任何调用期状态，因此同一个 statement 的 `SqlSource` 可以被并发调用。

接下来把两个入口接上。先改第 02 篇 `XMLMapperBuilder` 中构造 statement 的那三行（原来取 `getTextContent().trim()` 后交给 `SqlTemplateParser`）：

**文件：`src/main/java/com/frank/mybatis/builder/XMLMapperBuilder.java`（替换 statement 构建片段）  
包：`com.frank.mybatis.builder`  
前置依赖：`XMLScriptBuilder`、`Configuration.getSqlWhitelist()`、本篇 `MappedStatement`**

```java
String id = mapperType.getName() + "." + localId;
SqlSource sqlSource = new XMLScriptBuilder(
        statementElement, configuration.getSqlWhitelist())
        .parseScriptNode();
MappedStatement statement = MappedStatement.fromMapperMethod(
        id, mapperType.getName(), sqlSource, commandType(tag), method);
```

再改第 02 篇 `MapperAnnotationBuilder.parse` 里构造 statement 的两行，注解文本走 `parseText`：

**文件：`src/main/java/com/frank/mybatis/builder/MapperAnnotationBuilder.java`（替换 statement 构建片段）  
包：`com.frank.mybatis.builder`  
前置依赖：`XMLScriptBuilder.parseText`、本篇 `MappedStatement`**

```java
SqlDefinition definition = definitionOf(method);
SqlSource sqlSource = XMLScriptBuilder.parseText(
        definition.sql(), configuration.getSqlWhitelist());
parsed.put(id, MappedStatement.fromMapperMethod(
        id, mapperType.getName(), sqlSource, definition.commandType(), method));
```

两处都继续经过 `MappedStatement.fromMapperMethod`，所以 id 一致性校验和返回形状规则与第 02 篇完全相同；Executor 依旧不知道 SQL 来自 XML 还是注解。第 01 篇的 `SqlTemplateParser` 和 `PreparedSql` 从此退出主链路——文件可以保留（第 01 篇的单元测试仍在验证它），但不要再在新代码里引用。

XML 解析器继续保留第 02 篇禁用 DOCTYPE 与外部实体的配置。动态 SQL 构建器不负责 XML 安全，二者不可互相替代。

### 本节契约回归：静态 mapping 与未知动态标签

```java
@Test void scriptBuilderKeepsStaticMappingsAndRejectsUnknownNodes() throws Exception {
    BoundSql bound = source("<select>select #{id}, #{id}</select>", Map.of())
            .getBoundSql(Map.of("id", 7L));
    assertEquals("select ?, ?", flat(bound));
    assertEquals(List.of("id", "id"), bound.getParameterMappings().stream()
            .map(com.frank.mybatis.mapping.ParameterMapping::getProperty).toList());
    assertThrows(IllegalArgumentException.class,
            () -> source("<select><choose/></select>", Map.of()));
    assertThrows(IllegalArgumentException.class,
            () -> source("<select><if test='id != null' typo='x'>x</if></select>", Map.of()));
}
```

静态路径的 mapping 数量必须与问号数量一致；`<choose>` 这类未实现标签和 `<if>` 上的未知属性都在启动期失败，不会等到某次调用才暴露。

## 九、第七步：TypeHandler 及默认处理器

**为什么需要这一步：** `setObject` 把类型决策交给驱动，而 null、枚举、时间在不同数据库上的行为并不一致。TypeHandler 把「Java 类型 × JDBC 类型 → 具体 set/get 调用」变成显式注册表，找不到处理器就失败，不把猜测留给驱动。

![图 8：TypeHandler 四级查找顺序](typehandler-lookup-order.svg)

`ParameterMapping` 决定 JDBC 下标与属性路径，`TypeHandler` 决定 Java 值如何编码。所有绑定都经由注册表，执行器不再散落 `setObject`。

处理器查找规则：优先精确 `(Java 类型, JDBCType)`，其次 `(Java 类型, null)`，最后枚举按 `name()` 写入 VARCHAR。找不到处理器时失败，不把任意对象交给驱动猜测。

**文件：`src/main/java/com/frank/mybatis/type/TypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：JDK JDBC**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public interface TypeHandler<T> {
    void setParameter(PreparedStatement statement, int index, T parameter)
        throws SQLException;
    T getResult(ResultSet resultSet, String column) throws SQLException;
}
```

**文件：`src/main/java/com/frank/mybatis/type/BaseTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`TypeHandler`、JDK JDBC**

```java
package com.frank.mybatis.type;

import java.sql.ResultSet;
import java.sql.SQLException;

public abstract class BaseTypeHandler<T> implements TypeHandler<T> {

    @Override
    public T getResult(ResultSet resultSet, String column) throws SQLException {
        T value = getNullableResult(resultSet, column);
        return resultSet.wasNull() ? null : value;
    }

    protected abstract T getNullableResult(ResultSet resultSet, String column)
        throws SQLException;
}
```

**文件：`src/main/java/com/frank/mybatis/type/StringTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class StringTypeHandler extends BaseTypeHandler<String> {

    public void setParameter(
        PreparedStatement statement,
        int index,
        String value
    ) throws SQLException {
        statement.setString(index, value);
    }

    protected String getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        return resultSet.getString(column);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/IntegerTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class IntegerTypeHandler extends BaseTypeHandler<Integer> {

    public void setParameter(
        PreparedStatement statement,
        int index,
        Integer value
    ) throws SQLException {
        statement.setInt(index, value);
    }

    protected Integer getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        return resultSet.getInt(column);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/LongTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class LongTypeHandler extends BaseTypeHandler<Long> {

    public void setParameter(PreparedStatement statement, int index, Long value)
        throws SQLException {
        statement.setLong(index, value);
    }

    protected Long getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        return resultSet.getLong(column);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/BooleanTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class BooleanTypeHandler extends BaseTypeHandler<Boolean> {

    public void setParameter(
        PreparedStatement statement,
        int index,
        Boolean value
    ) throws SQLException {
        statement.setBoolean(index, value);
    }

    protected Boolean getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        return resultSet.getBoolean(column);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/LocalDateTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`、JDK `LocalDate`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDate;

public final class LocalDateTypeHandler extends BaseTypeHandler<LocalDate> {

    public void setParameter(
        PreparedStatement statement,
        int index,
        LocalDate value
    ) throws SQLException {
        statement.setObject(index, value, java.sql.Types.DATE);
    }

    protected LocalDate getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        return resultSet.getObject(column, LocalDate.class);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/LocalDateTimeTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`、JDK `LocalDateTime`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.LocalDateTime;

public final class LocalDateTimeTypeHandler
    extends BaseTypeHandler<LocalDateTime>
{

    public void setParameter(
        PreparedStatement statement,
        int index,
        LocalDateTime value
    ) throws SQLException {
        statement.setObject(index, value, java.sql.Types.TIMESTAMP);
    }

    protected LocalDateTime getNullableResult(
        ResultSet resultSet,
        String column
    ) throws SQLException {
        return resultSet.getObject(column, LocalDateTime.class);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/ByteArrayTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class ByteArrayTypeHandler extends BaseTypeHandler<byte[]> {

    public void setParameter(
        PreparedStatement statement,
        int index,
        byte[] value
    ) throws SQLException {
        statement.setBytes(index, value);
    }

    protected byte[] getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        return resultSet.getBytes(column);
    }
}
```

**文件：`src/main/java/com/frank/mybatis/type/EnumTypeHandler.java`  
包：`com.frank.mybatis.type`  
前置依赖：`BaseTypeHandler`、JDK 泛型**

```java
package com.frank.mybatis.type;

import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;

public final class EnumTypeHandler<E extends Enum<E>> extends BaseTypeHandler<E> {

    private final Class<E> type;

    public EnumTypeHandler(Class<E> type) {
        this.type = type;
    }

    public void setParameter(PreparedStatement statement, int index, E value)
        throws SQLException {
        statement.setString(index, value.name());
    }

    protected E getNullableResult(ResultSet resultSet, String column)
        throws SQLException {
        String name = resultSet.getString(column);
        return name == null ? null : Enum.valueOf(type, name);
    }
}
```

枚举默认保存 `name()` 而非 ordinal；重排 enum 常量不会改变历史数据库含义。若表存业务码，如 `A/D`，为该枚举注册专用 `TypeHandler`，并同时实现读写两端转换。

**文件：`src/main/java/com/frank/mybatis/type/TypeHandlerRegistry.java`  
包：`com.frank.mybatis.type`  
前置依赖：本节全部处理器、JDK `JDBCType` 与集合**

```java
package com.frank.mybatis.type;

import java.sql.JDBCType;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public final class TypeHandlerRegistry {

    private record Key(Class<?> javaType, JDBCType jdbcType) {}

    private final Map<Key, TypeHandler<?>> handlers = new HashMap<>();

    public TypeHandlerRegistry() {
        register(String.class, null, new StringTypeHandler());
        register(Integer.class, null, new IntegerTypeHandler());
        register(int.class, null, new IntegerTypeHandler());
        register(Long.class, null, new LongTypeHandler());
        register(long.class, null, new LongTypeHandler());
        register(Boolean.class, null, new BooleanTypeHandler());
        register(boolean.class, null, new BooleanTypeHandler());
        register(java.time.LocalDate.class, null, new LocalDateTypeHandler());
        register(
            java.time.LocalDateTime.class,
            null,
            new LocalDateTimeTypeHandler()
        );
        register(byte[].class, null, new ByteArrayTypeHandler());
    }

    public <T> void register(
        Class<T> javaType,
        JDBCType jdbcType,
        TypeHandler<? super T> handler
    ) {
        handlers.put(
            new Key(Objects.requireNonNull(javaType), jdbcType),
            Objects.requireNonNull(handler)
        );
    }

    @SuppressWarnings("unchecked")
    public <T> TypeHandler<T> getTypeHandler(
        Class<T> javaType,
        JDBCType jdbcType
    ) {
        TypeHandler<?> handler = handlers.get(new Key(javaType, jdbcType));
        if (handler == null) {
            handler = handlers.get(new Key(javaType, null));
        }
        if (handler == null && javaType.isEnum()) {
            return (TypeHandler<T>) new EnumTypeHandler<>(
                (Class<? extends Enum>) javaType
            );
        }
        if (handler == null) {
            throw new IllegalArgumentException(
                "no TypeHandler for " +
                    javaType.getName() +
                    " and JDBC type " +
                    jdbcType
            );
        }
        return (TypeHandler<T>) handler;
    }
}
```

`null` 不会进入注册表查找：它没有运行时 Java 类型。`ParameterHandler` 必须要求 `jdbcType`，然后调用 `PreparedStatement.setNull(index, jdbcType.getVendorTypeNumber())`。这避免不同 JDBC 驱动对 `setObject(index, null)` 的差异。

### 本节单元测试：精确匹配、默认处理器和未知类型

```java
@Test void typeRegistryUsesExactMatchBeforeDefault() {
    TypeHandlerRegistry registry = new TypeHandlerRegistry();
    var exact = new com.frank.mybatis.type.StringTypeHandler();
    registry.register(String.class, java.sql.JDBCType.CHAR, exact);
    assertSame(exact, registry.getTypeHandler(String.class, java.sql.JDBCType.CHAR));
    assertNotSame(exact, registry.getTypeHandler(String.class, java.sql.JDBCType.VARCHAR));
    assertNotNull(registry.getTypeHandler(long.class, null));
    assertNotNull(registry.getTypeHandler(Long.class, null));
    assertNotNull(registry.getTypeHandler(State.class, null));
    assertThrows(IllegalArgumentException.class, () -> registry.getTypeHandler(Object.class, null));
}
```

## 十、第八步：参数根对象、ParameterHandler 与执行链契约

**为什么需要这一步：** 动态 SQL 把参数从「一组命名值」变成了「一个根对象」——单个 Bean、集合、数组、标量都可能是根，旧执行链的 Map 载体和正则绑定再也接不住。执行边界必须整体换型且一次换完，不能新旧两条路径并存。

![图 9：参数根对象的四种形态](parameter-root-object.svg)

这一步动的是执行边界。第 01 篇的执行链以 `Map<String, Object>` 为参数载体，绑定靠正则替换；本篇的参数是"根对象"（Bean、Map、集合、数组或标量），绑定靠 `ParameterMapping` + `TypeHandler`。涉及的文件有五个新增（`ParamNameResolver`、`type` 包）和五个修改（`ParameterHandler`、`Executor`、`SimpleExecutor`、`SqlSession`、`DefaultSqlSession`、`MapperMethod`），按下面的顺序逐个落地。

### 10.1 ParamNameResolver：方法实参如何成为根对象

`ParamNameResolver` 只做命名，不做读取：单个参数且没有 `@Param` 时原样透传（Bean、Map、集合、标量都合法）；多参数或标注了 `@Param` 时组装成 `LinkedHashMap`。

**文件：`src/main/java/com/frank/mybatis/executor/ParamNameResolver.java`  
包：`com.frank.mybatis.executor`  
前置依赖：既有 `Param` 注解、JDK 反射与 Map**

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.annotations.Param;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;

public final class ParamNameResolver {

    private ParamNameResolver() {}

    public static Object getNamedParams(Method method, Object[] args) {
        if (args == null || args.length == 0) {
            return null;
        }
        if (args.length == 1
                && !method.getParameters()[0].isAnnotationPresent(Param.class)) {
            return args[0];
        }
        Map<String, Object> named = new LinkedHashMap<>();
        for (int i = 0; i < args.length; i++) {
            named.put("arg" + i, args[i]);
            named.put("param" + (i + 1), args[i]);
            Param annotation = method.getParameters()[i].getAnnotation(Param.class);
            if (annotation != null && !annotation.value().isBlank()) {
                named.put(annotation.value(), args[i]);
            }
        }
        return named;
    }
}
```

用 `LinkedHashMap` 而不是 `Map.of` 有两个原因：方法参数的值可能是 null，而 `Map.of` 不允许 null 值；键的顺序稳定，出错时按参数顺序排查更容易。命名错是根对象问题，属性错是 `DynamicContext` 问题，结构值错是白名单问题——职责分开后错误信息才清晰。参数根对象的完整合法矩阵见第 11.5 节。

### 10.2 ParameterHandler：按 mapping 顺序绑定 JDBC 参数

`ParameterHandler` 是本篇唯一直接遍历 `ParameterMapping` 的位置。它优先从 `BoundSql.additionalParameters` 读取 foreach 唯一变量，否则从根参数读取属性；随后按顺序选择 TypeHandler。第 01 篇的静态 `resolve`/`bind` 方法全部删除；取值函数 `valueOf` 保持 public，第 04 篇的 CacheKey 会复用同一份取值逻辑。

**文件：`src/main/java/com/frank/mybatis/executor/ParameterHandler.java`  
包：`com.frank.mybatis.executor`  
前置依赖：`BoundSql`、`ParameterMapping`、`DynamicContext`、`TypeHandlerRegistry`**

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.BoundSql;
import com.frank.mybatis.mapping.ParameterMapping;
import com.frank.mybatis.scripting.DynamicContext;
import com.frank.mybatis.type.TypeHandler;
import com.frank.mybatis.type.TypeHandlerRegistry;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public final class ParameterHandler {

    private final TypeHandlerRegistry typeHandlerRegistry;

    public ParameterHandler(TypeHandlerRegistry typeHandlerRegistry) {
        this.typeHandlerRegistry = typeHandlerRegistry;
    }

    public void setParameters(PreparedStatement statement, BoundSql boundSql)
        throws SQLException {
        for (int i = 0; i < boundSql.getParameterMappings().size(); i++) {
            ParameterMapping mapping = boundSql.getParameterMappings().get(i);
            Object value = valueOf(boundSql, mapping.getProperty());
            int index = i + 1;
            if (value == null) {
                if (mapping.getJdbcType() == null) {
                    throw new IllegalArgumentException(
                        "null requires jdbcType: " + mapping.getProperty()
                    );
                }
                statement.setNull(
                    index,
                    mapping.getJdbcType().getVendorTypeNumber()
                );
                continue;
            }
            @SuppressWarnings("unchecked")
            TypeHandler<Object> handler =
                (TypeHandler<Object>) typeHandlerRegistry.getTypeHandler(
                    value.getClass(),
                    mapping.getJdbcType()
                );
            handler.setParameter(statement, index, value);
        }
    }

    public static Object valueOf(BoundSql boundSql, String property) {
        Object root;
        String remaining;
        int dot = property.indexOf('.');
        String first = dot < 0 ? property : property.substring(0, dot);
        if (boundSql.hasAdditionalParameter(first)) {
            root = boundSql.getAdditionalParameter(first);
            remaining = dot < 0 ? "" : property.substring(dot + 1);
        } else {
            root = boundSql.getParameterObject();
            remaining = property;
        }
        if (remaining.isBlank()) {
            return root;
        }
        Object value = root;
        for (String part : remaining.split("\\.")) {
            value = DynamicContext.readProperty(value, part);
        }
        return value;
    }
}
```

### 10.3 SimpleExecutor 与 Executor：一个 execute 入口

现在修改第 01 篇的 `SimpleExecutor`。三个方法各管一段 SQL 的结构收敛为一个 `execute` 入口：先取得本次 `BoundSql`，交给 `ParameterHandler` 绑定参数；SELECT 查询后按 `returnsMany` 决定返回单行还是列表，DML 直接返回影响行数。删除旧的正则 `bind` 逻辑和循环 `ps.setObject(...)` 的代码。

**文件：`src/main/java/com/frank/mybatis/executor/SimpleExecutor.java`（整体替换）  
包：`com.frank.mybatis.executor`  
前置依赖：本篇 `MappedStatement`、`BoundSql`、`ParameterHandler`、`TypeHandlerRegistry`、第 01 篇 `ResultSetHandler`**

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.BoundSql;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.mapping.SqlCommandType;
import com.frank.mybatis.type.TypeHandlerRegistry;
import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.List;

public final class SimpleExecutor implements Executor {

    private final Connection connection;
    private final TypeHandlerRegistry typeHandlerRegistry;
    private final ResultSetHandler resultHandler = new ResultSetHandler();

    public SimpleExecutor(
        Connection connection,
        TypeHandlerRegistry typeHandlerRegistry
    ) {
        this.connection = connection;
        this.typeHandlerRegistry = typeHandlerRegistry;
    }

    @Override
    public Object execute(MappedStatement statement, Object parameterObject)
        throws SQLException {
        BoundSql boundSql = statement.getSqlSource().getBoundSql(parameterObject);
        try (
            PreparedStatement preparedStatement = connection.prepareStatement(
                boundSql.getSql()
            )
        ) {
            new ParameterHandler(typeHandlerRegistry).setParameters(
                preparedStatement,
                boundSql
            );
            if (statement.getCommandType() != SqlCommandType.SELECT) {
                return preparedStatement.executeUpdate();
            }
            try (ResultSet resultSet = preparedStatement.executeQuery()) {
                return mapResult(statement, resultSet);
            }
        }
    }

    private Object mapResult(MappedStatement statement, ResultSet resultSet)
        throws SQLException {
        List<?> rows = resultHandler.handle(resultSet, statement.getResultType());
        if (statement.returnsMany()) {
            return rows;
        }
        if (rows.isEmpty()) {
            return null;
        }
        if (rows.size() > 1) {
            throw new IllegalStateException(
                "selectOne returned multiple rows: " + statement.getId()
            );
        }
        return rows.get(0);
    }
}
```

第 01 篇的 `ResultSetHandler` 原样复用，本篇不重写结果映射；"单查返回多行即失败"的边界从原来的 `queryOne` 挪进了 `mapResult`。Executor 接口随之收敛为一个方法：

**文件：`src/main/java/com/frank/mybatis/executor/Executor.java`（整体替换）  
包：`com.frank.mybatis.executor`  
前置依赖：`MappedStatement`**

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.MappedStatement;
import java.sql.SQLException;

public interface Executor {
    Object execute(MappedStatement statement, Object parameterObject)
        throws SQLException;
}
```

### 10.4 Configuration、SqlSession 与 DefaultSqlSession：类型放宽为根对象

`SimpleExecutor` 的构造器需要 `TypeHandlerRegistry`，它由 `Configuration` 集中持有。注册表在工厂初始化时配好，运行中不要改写共享 `HashMap`：

**文件：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量片段）  
包：`com.frank.mybatis.session`  
前置依赖：`TypeHandlerRegistry`**

```java
private final TypeHandlerRegistry typeHandlerRegistry =
    new TypeHandlerRegistry();

public TypeHandlerRegistry getTypeHandlerRegistry() {
    return typeHandlerRegistry;
}
```

`SqlSession` 五个 CRUD 方法的参数从 `Map<String, Object>` 放宽为 `Object`——动态层需要的是参数根对象，可能是 Bean、Map、集合或标量；方法签名其余不变：

**文件：`src/main/java/com/frank/mybatis/session/SqlSession.java`（修改参数类型）  
包：`com.frank.mybatis.session`  
前置依赖：无**

```java
public interface SqlSession extends AutoCloseable {
    <T> T selectOne(String id, Object parameter, Class<T> type);
    <T> List<T> selectList(String id, Object parameter, Class<T> type);
    int insert(String id, Object parameter);
    int update(String id, Object parameter);
    int delete(String id, Object parameter);
    <T> T getMapper(Class<T> type);
    void commit();
    void rollback();
    void close();
}
```

`DefaultSqlSession` 把命令类型校验、单查/列表形状校验和 `SQLException` 包装集中到一起；`getMapper`、`commit`、`rollback`、`close`、`statement`、`requireOpen` 与第 01 篇相同，不重复贴出：

**文件：`src/main/java/com/frank/mybatis/session/DefaultSqlSession.java`（替换 CRUD 方法）  
包：`com.frank.mybatis.session`  
前置依赖：本篇 `Executor`、`SimpleExecutor`、`MappedStatement`、`Configuration.getTypeHandlerRegistry()`**

```java
public <T> T selectOne(String id, Object parameter, Class<T> type) {
    MappedStatement statement = statement(id, SqlCommandType.SELECT);
    if (statement.returnsMany()) {
        throw new IllegalArgumentException("selectOne on a list statement: " + id);
    }
    return type.cast(execute(statement, parameter));
}

@Override
@SuppressWarnings("unchecked")
public <T> List<T> selectList(String id, Object parameter, Class<T> type) {
    MappedStatement statement = statement(id, SqlCommandType.SELECT);
    if (!statement.returnsMany()) {
        throw new IllegalArgumentException("selectList on a single-row statement: " + id);
    }
    return (List<T>) execute(statement, parameter);
}

@Override
public int insert(String id, Object parameter) {
    return updateResult(execute(statement(id, SqlCommandType.INSERT), parameter));
}

@Override
public int update(String id, Object parameter) {
    return updateResult(execute(statement(id, SqlCommandType.UPDATE), parameter));
}

@Override
public int delete(String id, Object parameter) {
    return updateResult(execute(statement(id, SqlCommandType.DELETE), parameter));
}

private Object execute(MappedStatement statement, Object parameter) {
    try {
        return executor.execute(statement, parameter);
    } catch (java.sql.SQLException exception) {
        throw new IllegalStateException(
            "statement failed: " + statement.getId(), exception);
    }
}

private static int updateResult(Object result) {
    return (Integer) result;
}
```

构造器同步改成由 Session 自己装配执行器，`DefaultSqlSessionFactory` 不需要改动：

```java
public DefaultSqlSession(Configuration configuration, Transaction transaction) {
    this.configuration = configuration;
    this.transaction = transaction;
    this.executor = new SimpleExecutor(
        transaction.getConnection(),
        configuration.getTypeHandlerRegistry()
    );
}
```

### 10.5 MapperMethod：改用 ParamNameResolver

第 02 篇的 `MapperMethod` 通过 `ParameterHandler.resolve` 把实参变成 Map；`resolve` 已删除，改用 `ParamNameResolver`，`MappedStatement` 的访问器同步换成 getter。只替换 `execute` 方法与相关 import（`executor.ParameterHandler` → `executor.ParamNameResolver`）：

**文件：`src/main/java/com/frank/mybatis/binding/MapperMethod.java`（替换 execute）  
包：`com.frank.mybatis.binding`  
前置依赖：`ParamNameResolver`、本篇 `MappedStatement`**

```java
public Object execute(SqlSession session, Object[] arguments) {
    Object parameterObject = ParamNameResolver.getNamedParams(method, arguments);
    return switch (statement.getCommandType()) {
        case SELECT -> statement.returnsMany()
            ? session.selectList(statementId, parameterObject, statement.getResultType())
            : session.selectOne(statementId, parameterObject, statement.getResultType());
        case INSERT -> session.insert(statementId, parameterObject);
        case UPDATE -> session.update(statementId, parameterObject);
        case DELETE -> session.delete(statementId, parameterObject);
    };
}
```

到这里，从 Mapper 方法到 JDBC 的整条链路都换成根对象 + `BoundSql` + `TypeHandler` 模型；第 01、02 篇的 CRUD 测试不需要修改测试逻辑，只要跟着新契约重编译即可通过。

### 本节组件测试：附加参数优先、恶意值往返与 null 类型

手动构造 BoundSql 隔离动态渲染问题；这里验证的是 ParameterHandler 自身。

```java
@Test void parameterHandlerPrefersAdditionalValuesAndRequiresNullType() throws Exception {
    String attack = "x' OR 1=1 --";
    var mapping = new com.frank.mybatis.mapping.ParameterMapping(
            "name", String.class, java.sql.JDBCType.VARCHAR);
    BoundSql bound = new BoundSql("select ?", List.of(mapping), Map.of("name", "root"));
    bound.setAdditionalParameter("name", attack);
    try (Connection c = connection(); PreparedStatement ps = c.prepareStatement(bound.getSql())) {
        var handler = new ParameterHandler(new TypeHandlerRegistry());
        handler.setParameters(ps, bound);
        try (ResultSet rs = ps.executeQuery()) {
            assertTrue(rs.next());
            assertEquals(attack, rs.getString(1));
        }
        bound.setAdditionalParameter("name", null);
        handler.setParameters(ps, bound);
        try (ResultSet rs = ps.executeQuery()) {
            assertTrue(rs.next());
            assertNull(rs.getString(1));
        }
        Map<String,Object> values = new HashMap<>();
        values.put("name", null);
        var untyped = new BoundSql("select ?", List.of(
                new com.frank.mybatis.mapping.ParameterMapping("name", Object.class, null)), values);
        assertThrows(IllegalArgumentException.class, () -> handler.setParameters(ps, untyped));
    }
}
```

## 十一、第九步：Mapper XML 与完整章内测试

**为什么需要这一步：** 前面九步的能力只有落进真实的 Mapper XML 并跑通测试矩阵，才算交付。这一节把 `<if>/<where>/<foreach>/<trim>` 与 `${}` 白名单写进一份可注册的 mapper，用纯渲染测试（不碰数据库）和真实 H2 绑定测试分别验证结构与值。

### 11.1 修改 Mapper 资源

以下两条语句一次覆盖 `<if>`、`<where>`、`<foreach>`、`<trim>` 与 `${}` 白名单。`sort` 与 `direction` 是逻辑 key，不是 SQL 原文。沿用第 02 篇的规则：XML 不写 `resultType`/`parameterType`，类型由接口方法签名唯一决定。

**文件：`src/test/java/com/frank/mybatis/chapter03/UserMapper.java`（新增）  
包：`com.frank.mybatis.chapter03`  
前置依赖：第 02 篇 `fixture.User`、`@Param`、本篇动态链路**

```java
package com.frank.mybatis.chapter03;

import com.frank.mybatis.annotations.Param;
import com.frank.mybatis.fixture.User;
import java.util.List;

public interface UserMapper {

    List<User> findByCondition(UserQuery query);

    int patchUser(@Param("id") Long id, @Param("patch") UserPatch patch);

    record UserQuery(String name, Integer minAge, List<Long> ids,
                     String sort, String direction) {}

    record UserPatch(String name, Integer age) {}
}
```

**文件：`src/test/resources/mapper/UserMapper03.xml`（新增）  
包：不适用（资源文件）  
前置依赖：`XMLScriptBuilder`、启动期 `sort`/`direction` 白名单**

```xml
<mapper namespace="com.frank.mybatis.chapter03.UserMapper">
  <select id="findByCondition">
    select id, user_name, age
    from t_user
    <where>
      <if test="name != null">
        AND user_name = #{name}
      </if>
      <if test="minAge != null">
        AND age >= #{minAge}
      </if>
      <if test="ids != null and ids.size > 0">
        AND id in
        <foreach collection="ids" item="id" open="(" close=")" separator=",">
          #{id}
        </foreach>
      </if>
    </where>
    order by ${sort} ${direction}
  </select>

  <update id="patchUser">
    update t_user
    <trim prefix="SET" suffixOverrides=",">
      <if test="patch.name != null">user_name = #{patch.name},</if>
      <if test="patch.age != null">age = #{patch.age},</if>
    </trim>
    where id = #{id}
  </update>
</mapper>
```

把它注册进第 02 篇的 `mybatis-config.xml`：`<mapper resource="mapper/UserMapper03.xml"/>`。注意 `AND` 前面有空格，`<where>` 才能裁剪首个连接词；`foreach` 使用 item `id`，空 ID 集合会在渲染期失败——这两种行为都是刻意的。

`patchUser` 的业务层必须先拒绝“所有可更新字段都是 null”的请求。`trim` 会正确地不输出 SET，但随后 SQL 会是非法 `update t_user where ...`；不应借机让更新退化为无条件语句。如果想练习“为 null 显式写 `jdbcType`”，在第 11.6 节的 `t_parameter_types` 测试表上加一列 `deleted_at timestamp` 做实验，不要为了示例改动主表 `t_user` 的结构。

### 11.2 章内测试

本测试直接验证 `BoundSql` 形状与真实 H2 执行，不以 mock 替代数据库语义。测试用 XML 字符串构造语句、按需打开内存库，聚焦动态 SQL 本身；端到端的 CRUD 回归由第 01、02 篇已有测试与上面的 `chapter03.UserMapper` 共同覆盖。

**文件：`src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java`  
包：`com.frank.mybatis.chapter03`  
前置依赖：本篇所有代码、第 02 篇 `User`/会话夹具、H2、JUnit 5**

```java
package com.frank.mybatis.chapter03;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.frank.mybatis.builder.XMLScriptBuilder;
import com.frank.mybatis.executor.ParameterHandler;
import com.frank.mybatis.mapping.BoundSql;
import com.frank.mybatis.mapping.SqlSource;
import com.frank.mybatis.scripting.DynamicContext;
import com.frank.mybatis.type.TypeHandlerRegistry;
import java.io.StringReader;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.xml.parsers.DocumentBuilderFactory;
import org.junit.jupiter.api.Test;
import org.w3c.dom.Element;
import org.xml.sax.InputSource;

class MiniMybatisChapter03Test {

    enum State { ACTIVE, DISABLED }

    record Filter(String name, Integer minAge, List<Long> ids, String sort, String direction) {}

    private static SqlSource source(String xml, Map<String, Map<String, String>> whitelist)
            throws Exception {
        Element root = DocumentBuilderFactory.newInstance().newDocumentBuilder()
                .parse(new InputSource(new StringReader(xml))).getDocumentElement();
        return new XMLScriptBuilder(root, whitelist).parseScriptNode();
    }

    private static String flat(BoundSql boundSql) {
        return boundSql.getSql().replaceAll("\\s+", " ").trim();
    }

    private static Connection connection() throws Exception {
        return DriverManager.getConnection("jdbc:h2:mem:c03_" + UUID.randomUUID());
    }

    private static Map<String, Map<String, String>> whitelist() {
        return Map.of(
                "sort", Map.of("name", "user_name", "id", "id"),
                "direction", Map.of("asc", "ASC", "desc", "DESC"));
    }

    @Test
    void beanMapCollectionArrayAndScalarAreResolved() throws Exception {
        assertEquals("select ?",
                flat(source("<select>select #{name}</select>", Map.of())
                        .getBoundSql(new Filter("Frank", null, List.of(), "name", "asc"))));
        assertEquals("select ?",
                flat(source("<select>select #{name}</select>", Map.of())
                        .getBoundSql(Map.of("name", "Ada"))));
        assertEquals("select ?, ?",
                flat(source("<select>select #{_parameter}, #{_parameter}</select>", Map.of())
                        .getBoundSql(7L)));
        assertEquals("select ?",
                flat(source("<select>select #{array.size}</select>", Map.of())
                        .getBoundSql(new int[] {1, 2, 3})));
        assertEquals("select ?",
                flat(source("<select>select #{collection.size}</select>", Map.of())
                        .getBoundSql(List.of(1, 2))));
    }

    @Test
    void ifWhereAndTrimProduceExpectedShape() throws Exception {
        String xml = """
                <select>select id from t_user
                <where>
                  <if test="name != null">AND user_name = #{name}</if>
                  <if test="minAge != null">AND age &gt;= #{minAge}</if>
                </where></select>""";
        assertEquals("select id from t_user",
                flat(source(xml, Map.of())
                        .getBoundSql(new Filter(null, null, List.of(), "name", "asc"))));
        assertEquals("select id from t_user WHERE user_name = ? AND age >= ?",
                flat(source(xml, Map.of())
                        .getBoundSql(new Filter("Frank", 18, List.of(), "name", "asc"))));
        assertEquals("WHERE order_no = 1",
                flat(source("<select><where>order_no = 1</where></select>", Map.of())
                        .getBoundSql(Map.of())));
    }

    @Test
    void foreachUsesOrderedSnapshotsForListAndPrimitiveArray() throws Exception {
        String xml = """
                <select>select id from t_user where id in
                <foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>
                </select>""";
        BoundSql listSql = source(xml, Map.of()).getBoundSql(Map.of("ids", List.of(3L, 1L)));
        assertEquals("select id from t_user where id in (?,?)", flat(listSql));
        assertEquals(2, listSql.getParameterMappings().size());
        assertTrue(listSql.getParameterMappings().get(0).getProperty().startsWith("__frch_id_"));
        String arrayXml = xml.replace("collection=\"ids\"", "collection=\"array\"");
        assertEquals("select id from t_user where id in (?,?)",
                flat(source(arrayXml, Map.of()).getBoundSql(new long[] {3L, 1L})));
        assertThrows(IllegalArgumentException.class,
                () -> source(xml, Map.of()).getBoundSql(Map.of("ids", List.of())));
    }

    @Test
    void safeExpressionAndWhitelistRejectUnsafeInput() throws Exception {
        assertThrows(IllegalArgumentException.class, () -> source(
                "<select><if test=\"name.toString() != null\">x</if></select>", Map.of()));
        assertThrows(IllegalArgumentException.class, () -> source(
                "<select><if test=\"(age > 1)\">x</if></select>", Map.of()));
        SqlSource safe = source(
                "<select>select * from t_user order by ${sort} ${direction}</select>", whitelist());
        assertEquals("select * from t_user order by user_name ASC",
                flat(safe.getBoundSql(Map.of("sort", "name", "direction", "asc"))));
        assertThrows(IllegalArgumentException.class, () -> safe.getBoundSql(
                Map.of("sort", "name desc; drop table t_user", "direction", "asc")));
        assertThrows(IllegalArgumentException.class,
                () -> source("<select>select '#{name}'</select>", Map.of()));
    }

    @Test
    void parameterHandlerBindsNullDateEnumAndBinary() throws Exception {
        TypeHandlerRegistry registry = new TypeHandlerRegistry();
        String xml = "<select>select #{n,jdbcType=VARCHAR}, #{day}, #{time}, #{state}, #{payload}</select>";
        Map<String, Object> values = new HashMap<>();
        values.put("n", null);
        values.put("day", LocalDate.of(2026, 9, 9));
        values.put("time", LocalDateTime.of(2026, 9, 9, 12, 30));
        values.put("state", State.ACTIVE);
        values.put("payload", new byte[] {1, 2});
        BoundSql boundSql = source(xml, Map.of()).getBoundSql(values);
        try (Connection connection = connection();
             PreparedStatement statement = connection.prepareStatement(boundSql.getSql())) {
            new ParameterHandler(registry).setParameters(statement, boundSql);
            try (ResultSet resultSet = statement.executeQuery()) {
                assertTrue(resultSet.next());
                assertNull(resultSet.getString(1));
                assertEquals(LocalDate.of(2026, 9, 9), resultSet.getObject(2, LocalDate.class));
                assertEquals("ACTIVE", resultSet.getString(4));
                assertArrayEquals(new byte[] {1, 2}, resultSet.getBytes(5));
            }
        }
    }

    @Test
    void preparedValueIsNotSqlInjection() throws Exception {
        String xml = "<select>select id from t_user where user_name = #{name}</select>";
        BoundSql boundSql = source(xml, Map.of()).getBoundSql(Map.of("name", "x' OR 1=1 --"));
        assertEquals("select id from t_user where user_name = ?", flat(boundSql));
        assertFalse(boundSql.getSql().contains("OR 1=1"));
    }
}
```

这组测试覆盖了：

| 场景 | 关键断言 |
| --- | --- |
| Bean / Map / 标量 | getter、Map key、`_parameter` 都可解析 |
| Collection / 数组 | `collection`/`array` 别名及原始类型数组可循环 |
| if / where | 条件为空时没有空 WHERE；`order_no` 不被误裁 |
| foreach | SQL 问号数与唯一循环属性顺序一致；空集合拒绝 |
| 表达式 | 方法调用、括号等超出安全子集的写法拒绝 |
| `${}` | 只接受配置白名单的逻辑 key |
| `#{}` | 恶意字符串不进入最终 SQL |
| null / date / enum / byte[] | null 有 JDBCType，默认处理器通过 H2 绑定 |

### 11.3 先做纯渲染测试，再做 JDBC 测试

动态 SQL 的测试不要一上来就打开数据库。先把 XML 变成 `SqlSource`，再用不同参数取得 `BoundSql`，这样失败时能立即知道是 XML 节点、表达式、属性解析还是 JDBC 绑定问题。纯渲染测试至少检查四项：最终 SQL、问号数量、`ParameterMapping` 顺序、每个 mapping 的属性名。

**文件：`src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java`（追加测试方法）  
包：`com.frank.mybatis.chapter03`  
前置依赖：文件中已有 `source`、`flat` 辅助方法与 JUnit 5**

```java
@Test
void parameterOrderChangesWithIfButTemplateIsReusable() throws Exception {
    String xml = "<select>select * from t_user <where>"
            + "<if test=\"name != null\">AND user_name = #{name}</if>"
            + "<if test=\"age != null\">AND age &gt;= #{age}</if>"
            + "</where></select>";
    SqlSource source = source(xml, Map.of());
    Map<String, Object> first = new HashMap<>();
    first.put("name", null);
    first.put("age", 20);
    BoundSql firstSql = source.getBoundSql(first);
    assertEquals("select * from t_user WHERE age >= ?", flat(firstSql));
    assertEquals("age", firstSql.getParameterMappings().get(0).getProperty());

    Map<String, Object> second = new HashMap<>();
    second.put("name", "Frank");
    second.put("age", 30);
    BoundSql secondSql = source.getBoundSql(second);
    assertEquals("select * from t_user WHERE user_name = ? AND age >= ?", flat(secondSql));
    assertEquals(List.of("name", "age"), secondSql.getParameterMappings().stream()
            .map(mapping -> mapping.getProperty()).toList());
}

@Test
void trimRemovesOnlyBoundaryTokens() throws Exception {
    String xml = "<select><trim prefix=\"WHERE\" prefixOverrides=\"AND|OR\">"
            + "  order_no = #{orderNo} OR status = #{status} </trim></select>";
    Map<String, Object> parameters = Map.of("orderNo", "O-001", "status", "ACTIVE");
    BoundSql boundSql = source(xml, Map.of()).getBoundSql(parameters);
    assertEquals("WHERE order_no = ? OR status = ?", flat(boundSql));
}
```

`where` 和 `trim` 的边界测试很重要。不能只断言 SQL 能执行，因为 `WHERE AND` 在某些测试数据库方言中可能被宽容处理；应该直接断言规整后的 SQL。`order_no` 这个回归样例保证实现检查单词边界，不能用简单 `replace("OR", "")`。

### 11.4 foreach 的四个参数维度

`foreach` 同时改变 SQL 结构、参数作用域、参数顺序和空输入行为。测试应分别覆盖 `List`、基本类型数组、对象数组以及嵌套 record。数组不能通过强制转换为 `Object[]`，因为 `long[]`、`int[]` 等基本类型数组不是 `Object[]`；实现必须使用 `java.lang.reflect.Array`。

**文件：`src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java`（追加测试方法）  
包：`com.frank.mybatis.chapter03`  
前置依赖：`source`、JUnit 5、`java.util.List`**

```java
@Test
void foreachPreservesIndexAndNestedProperty() throws Exception {
    record UserId(long id) {}
    String xml = "<select><foreach collection=\"users\" item=\"user\" "
            + "index=\"position\" open=\"(\" close=\")\" separator=\",\">"
            + "#{position}:#{user.id}</foreach></select>";
    BoundSql boundSql = source(xml, Map.of()).getBoundSql(
            Map.of("users", List.of(new UserId(10), new UserId(20))));
    assertEquals("(?, ?, ? ,?)".replace(" ", ""),
            flat(boundSql).replace(" ", ""));
    assertEquals(List.of("__frch_position_", "__frch_user_"),
            List.of(boundSql.getParameterMappings().get(0).getProperty().substring(0, 16),
                   boundSql.getParameterMappings().get(1).getProperty().substring(0, 13)));
}

@Test
void nullCollectionAndNonCollectionFailEarly() throws Exception {
    String xml = "<select><foreach collection=\"ids\" item=\"id\">#{id}</foreach></select>";
    Map<String, Object> nullValue = new HashMap<>();
    nullValue.put("ids", null);
    assertThrows(IllegalArgumentException.class, () -> source(xml, Map.of()).getBoundSql(nullValue));
    assertThrows(IllegalArgumentException.class, () -> source(xml, Map.of())
            .getBoundSql(Map.of("ids", "not-a-collection")));
}
```

实际项目中，测试断言唯一变量名的前缀即可，不要断言具体数字一定从零开始。唯一编号是实现细节；稳定不变的是 mapping 的数量、顺序和每个循环元素的值。若测试希望直接断言值，可以在 `BoundSql` 增加只读的 debug snapshot；不要把值写进全局模板。

### 11.5 参数根对象矩阵

本篇只实现一套明确规则，不模仿各种版本中容易混淆的隐式别名。单个 Bean 的属性来自 public getter；record 直接使用 accessor；Map 必须有 key；集合和数组只通过约定别名进入循环；标量通过 `_parameter`。下面的表可以作为代码审查和测试设计的基线。

| 根对象 | 合法示例 | 不应支持 |
| --- | --- | --- |
| Java Bean | `#{name}`、`name != null` | 直接访问私有 field |
| record | `#{id}`、`user.id` | 调用任意方法 |
| Map | `#{name}`、`filter.name` | 缺 key 自动当 null |
| List/Set | `collection`、`collection.size` | 把字符串当字符集合 |
| Java 数组 | `array`、`array.size` | 强转 `Object[]` 处理基本数组 |
| 标量 | `#{_parameter}` | 猜测任意参数名字 |
| 多参数 | `@Param("ids")` 后的 `ids` | 依赖未开启 `-parameters` 的真实形参名 |

多参数组装由第 10.1 节的 `ParamNameResolver` 完成：单个参数且无 `@Param` 时原样透传，多参数或带 `@Param` 时组装成允许 null 值的 `LinkedHashMap`（`@Param` 名、`arg0`、`param1` 同时可用）。动态节点只读取这个已经命名的根对象，不需要知道 Java 方法有几个参数。`ParamNameResolver` 只负责命名，不负责读取嵌套属性，也不负责解析 `${}`——这几个职责分开后，错误信息才会清晰：命名错是参数根问题，属性错是 `DynamicContext` 问题，结构值错是白名单问题。

### 11.6 null、日期、枚举、数组的绑定矩阵

JDBC 绑定测试必须包括真实表，而不是只验证 mock 的 `setObject` 被调用。建议在 H2 中创建如下列，逐列验证写入后的读取值。

**文件：`src/test/resources/chapter03/schema.sql`（新增资源）  
包：不适用（SQL 资源）  
前置依赖：H2 2.3.x；测试使用 `ClassLoader.getResourceAsStream` 读取**

```sql
create table if not exists t_parameter_types(
  id bigint primary key,
  nullable_text varchar(80),
  local_day date,
  local_time timestamp,
  state varchar(20),
  payload varbinary(32)
);
```

**文件：`src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java`（追加测试方法）  
包：`com.frank.mybatis.chapter03`  
前置依赖：`TypeHandlerRegistry`、`ParameterHandler`、H2 schema 资源**

```java
@Test
void jdbcTypeIsRequiredOnlyForNull() throws Exception {
    String xml = "<select>select #{known}, #{unknown,jdbcType=VARCHAR}</select>";
    Map<String, Object> parameters = new HashMap<>();
    parameters.put("known", "ok");
    parameters.put("unknown", null);
    BoundSql boundSql = source(xml, Map.of()).getBoundSql(parameters);
    assertDoesNotThrow(() -> bindForTest(boundSql));
    assertThrows(IllegalArgumentException.class, () -> source(
            "<select>select #{unknown}</select>", Map.of())
            .getBoundSql(parameters));
}

private static void bindForTest(BoundSql boundSql) throws Exception {
    try (Connection connection = connection();
         PreparedStatement statement = connection.prepareStatement(boundSql.getSql())) {
        new ParameterHandler(new TypeHandlerRegistry()).setParameters(statement, boundSql);
    }
}
```

- `null`：必须声明 `jdbcType`，并调用 `setNull`。
- `LocalDate`：默认使用 DATE，不要偷偷变成系统时区的 Timestamp。
- `LocalDateTime`：默认使用 TIMESTAMP；它不是带时区的时间线瞬间。
- `java.util.Date`：如果项目允许，应显式注册 Timestamp 处理器，并测试时区策略。
- `Enum`：默认保存 `name()`，业务编码则注册专用处理器。
- `byte[]`：作为一个参数使用 `setBytes`，不能误当 SQL ARRAY。
- SQL ARRAY：一个问号对应一个数据库数组，创建的 `java.sql.Array` 必须在 Statement 使用结束后 `free()`；本篇默认不把 Java 集合自动当 SQL ARRAY。

### 11.7 安全边界回归测试

安全测试不是测试“看起来没问题”，而是测试错误输入明确失败。`${}` 的测试必须同时覆盖未配置、配置后合法、合法 key 对应的片段以及带分号/注释/引号的恶意值。`#{}` 则相反：恶意字符串应该成功作为普通值绑定，最终 SQL 中只能出现一个问号。

**文件：`src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java`（追加测试方法）  
包：`com.frank.mybatis.chapter03`  
前置依赖：`source`、JUnit 5**

```java
@Test
void interpolationIsAllowListOnly() throws Exception {
    Map<String, Map<String, String>> choices = Map.of(
            "sort", Map.of("name", "user_name", "id", "id"));
    SqlSource source = source("<select>select * from t_user order by ${sort}</select>", choices);
    assertEquals("select * from t_user order by user_name",
            flat(source.getBoundSql(Map.of("sort", "name"))));
    for (String attack : List.of("name desc", "name;drop table t_user", "name --", "'name'")) {
        assertThrows(IllegalArgumentException.class,
                () -> source.getBoundSql(Map.of("sort", attack)));
    }
}

@Test
void preparedValuesNeverChangeSqlShape() throws Exception {
    SqlSource source = source("<select>select * from t_user where user_name = #{name}</select>", Map.of());
    BoundSql boundSql = source.getBoundSql(Map.of("name", "' OR 1=1 --"));
    assertEquals("select * from t_user where user_name = ?", flat(boundSql));
    assertEquals(1, boundSql.getParameterMappings().size());
}
```

XML 也要测试 DOCTYPE、未知标签、未知属性、未闭合占位符和引号中的占位符。XML 解析器继续禁用外部实体，不能因为本篇只讲动态节点就取消第 02 篇已经做好的安全配置。

### 11.8 启动期与调用期的责任表

把校验放错生命周期会导致线上请求才发现模板错误，或把请求值错误地缓存进共享对象。按照下面的责任表实现：

| 时机 | 可以做 | 不可以做 |
| --- | --- | --- |
| 启动解析 XML | 校验标签、属性、表达式语法、白名单结构 | 读取请求参数 |
| 启动注册处理器 | 注册 Java/JDBC 类型处理器并冻结配置 | 使用某次 BoundSql |
| Mapper 调用 | 创建参数根对象和 DynamicContext | 改写共享 SqlNode |
| 动态渲染 | 选择 if 分支、展开 foreach、生成 mapping | 创建 Connection |
| prepare 前 | 取得最终 SQL 并校验 mapping 数 | 再次拼接 SQL |
| execute 前 | 按顺序调用 TypeHandler | 遍历 Map 顺序猜参数 |
| execute 后 | 交给既有结果映射与事务 | 修改已完成的 BoundSql |

这个表也是重构检查点。如果 `SimpleExecutor` 里仍然出现 `Pattern.compile("#\\{")`，说明旧的参数绑定逻辑没有删除；如果 `MappedStatement` 保存 `BoundSql`，说明把调用状态错误地放进了启动配置。

### 11.9 增量提交顺序与回滚点

推荐按以下九个小提交或本地检查点推进。每一步都先编译，再进入下一步，避免一次性面对几十个错误。

1. 新增 `SqlSource`、`BoundSql`、`ParameterMapping`，让固定 SQL 能取得空参数列表。
2. 修改 `MappedStatement` 持有 `SqlSource`，修复第 02 篇构造调用点。
3. 新增 `SqlNode`、`DynamicContext`、`TextSqlNode`，先只支持文本和 `#{}`。
4. 新增 `StaticSqlSource`/`DynamicSqlSource`，确认同一模板两次调用没有旧值。
5. 新增 `IfSqlNode`，先测 `null`、数值比较和短路。
6. 新增 `TrimSqlNode`/`WhereSqlNode`，再测首个 AND/OR 和尾逗号。
7. 新增 `ForEachSqlNode`，先测 List，再测基本类型数组和嵌套作用域。
8. 新增 `ParamNameResolver`、type 包与新 `ParameterHandler`；更新 `Executor`、`SqlSession`、`DefaultSqlSession`、`MapperMethod` 的契约，删除 `SimpleExecutor` 中的 `setObject` 正则绑定。
9. 把 `XMLMapperBuilder` 与 `MapperAnnotationBuilder` 接到 `XMLScriptBuilder`/`parseText`，执行完整章内测试和全量回归。

每个检查点都可以回到上一阶段：若 foreach 出错，先用只有文本和 `#{}` 的静态 SQL 验证 mapping；若 TypeHandler 出错，先断言 BoundSql 的 SQL 与顺序，再单独验证 JDBC。不要为了让全量测试暂时通过而保留两套执行路径。

## 十二、按顺序验收与排错

**为什么需要这一步：** 本篇改动横跨九个小步，一次性跑全量测试失败时无从下手。按检查点推进、每步先编译再增量测试，是把「几十个错误」拆成「每次一个」的唯一办法；排错清单把最常见故障按症状归类。

每次完成一个阶段都在已有项目根目录执行以下命令，不需要、也不应创建本篇专用 pom。

**验收命令（路径：项目根目录；包：不适用；前置依赖：已完成第 02 篇和本篇代码）**

```bash
mvn -q -Dtest=MiniMybatisChapter03Test test
mvn -q test
```

预期：`MiniMybatisChapter03Test` 全部通过，完整测试集也没有回归。若命令提示找不到测试，确认文件位于 `src/test/java/com/frank/mybatis/chapter03/MiniMybatisChapter03Test.java` 且类名没有改动。

可临时在测试中输出以下内容定位绑定顺序，但不要在生产日志输出敏感参数：

```java
System.out.println(boundSql.getSql());
System.out.println(boundSql.getParameterMappings().stream()
        .map(ParameterMapping::getProperty).toList());
```

常见失败按下面顺序排查。

1. **`missing map key`**：执行器组装多参数 Map 时没有使用 `@Param` 名称，或 XML 拼错属性。缺 key 不等于值为 null，不能统一吞掉。
2. **`null requires jdbcType`**：为可能 null 的占位符写 `#{value,jdbcType=VARCHAR}`、`DATE`、`TIMESTAMP` 等正确类型；不要用 `setObject(null)` 掩盖。
3. **foreach 只绑定最后一个值**：检查生成的属性是否为不同的 `__frch_item_N`，而不是循环结束后仍写 `item`。
4. **`WHERE AND ...`**：条件文本应以 `AND`/`OR` 开始且没有拼错，`WhereSqlNode` 才会裁剪首个连接词。
5. **`${}` 被拒绝**：这是预期安全行为。把逻辑 key 映射到 `Configuration` 白名单，绝不把客户端 SQL 字符串加入 Map。
6. **找不到 TypeHandler**：注册明确处理器；不要将 DTO、集合或未知对象当作一个 JDBC 标量。
7. **XML 解析异常**：确认 `<` 位于属性时写成 `&lt;`，并保留第 02 篇禁用 DTD/外部实体的工厂设置。

## 十三、边界复盘与第 04 篇衔接

**为什么需要这一步：** 明确「本篇刻意不做什么」与「哪些概念容易混淆」，既防止把教学子集误当完整实现，也交代哪些债留给第 04 篇——复盘本身就是最后一道验收。

本篇刻意没有实现完整 OGNL、任意 `${}`、`choose`、`bind`、SQL ARRAY、批量执行、结果集反向 TypeHandler 或缓存。每项都需要更多方言、生命周期与安全测试；与其留下会在生产中静默错误的“简化支持”，不如明确拒绝。

还要区分以下容易混淆的概念：

- `IN (?, ?)` 是 foreach 展开的多个标量参数；它不等于数据库 SQL ARRAY。
- `byte[]` 是一个二进制值；只有明确放进 foreach 才会逐字节展开。
- `null` 与缺失属性不同；前者需要 `jdbcType`，后者通常是调用或模板错误。
- `LocalDate`、`LocalDateTime` 不携带时区；若业务表示时间线上的瞬间，应另加 `Instant`/`OffsetDateTime` 处理器并针对目标驱动集成测试。
- 动态渲染上下文可并发独立创建，但 `SqlSession`、`Connection`、`PreparedStatement` 与 `ResultSet` 仍不能跨线程共享。

第 04 篇会在本篇最终 SQL 和有序参数的基础上继续处理结果映射、缓存或插件边界。它不应把 `if/where/foreach` 的字符串拼接重新塞回执行器：共享的是 `SqlNode`/`SqlSource` 规则，调用专属的是 `DynamicContext`、`BoundSql` 与 JDBC 资源。

至此，框架从“正则替换 SQL 字符串”升级为一条可验证的链路：**模板节点负责结构，安全表达式负责选择，白名单负责授权，`BoundSql` 负责位置，`TypeHandler` 负责 JDBC 编码。**

> 系列导航：上一篇：[手写 MyBatis 02：XML、注解与 Statement ID](/2026/09/10/articles/Mybatis/02-mybatis-xml-and-statement-id/) ｜ 本篇是第 3 篇 ｜ 下一篇：[手写 MyBatis 04：缓存、插件与嵌套映射](/2026/09/12/articles/Mybatis/04-mybatis-cache-plugin-and-nested-mapping/)
