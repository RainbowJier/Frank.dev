---
title: "手写 MyBatis 05：类型、批处理、事务与 Spring 生态增量"
date: 2026-09-13 10:00:00
categories: [Mybatis]
tags: [Java, MyBatis, JDBC, 事务, Spring]
description: 承接第 04 篇，在现有 com.frank.mybatis 项目中逐文件加入类型处理、批处理、事务工厂、主键回填与可选 Spring 外部事务适配。
lang: zh-CN
---
> 本篇承接第 04 篇的 `Configuration`、`MappedStatement`、`SqlSession`、缓存、插件和 `ResultMap`。这次只在既有 Maven 项目中增量修改，所有 Java 包均为真实的 `com.frank.mybatis`；不创建 `lab`、不创建独立 POM，也不提供未声明 Spring 依赖就不能编译的片段。
## 一、目标、前提与路径清单
**为什么需要这一步：** 第 04 篇解决了查询结果、缓存和插件的组织问题，但 JDBC 值转换、生成键、批处理、连接所有权和外部事务仍不能散落在执行器中。本篇完成下列链路。

![图 1：本篇的所有权地图](ownership-map.svg)
```text
MapperProxy -> DefaultSqlSession -> Executor
  -> ParameterHandler -> TypeHandlerRegistry -> TypeHandler
  -> Transaction -> DataSource/连接池/Spring 线程绑定连接
  -> PreparedStatement -> ResultSet -> TypeHandler
```
固定前提：Java 17、已有 Maven 项目、H2 与 JUnit 5 测试依赖。核心包仅依赖 JDK；HikariCP、Jackson、Spring JDBC 是后文明确标为“可选且先加依赖”的适配。项目中已有的第 04 篇缓存、插件、动态 SQL 与嵌套映射保留，本篇不重写它们。
|动作|路径|说明|
|---|---|---|
|修改|`src/main/java/com/frank/mybatis/type/TypeHandler.java` 等既有处理器|签名扩展：jdbcType 参数与三类读取|
|新增|`src/main/java/com/frank/mybatis/reflection/MetaObject.java`|统一的反射读写入口|
|新增|`src/main/java/com/frank/mybatis/type/TypeHandlerRegistry.java`|精确注册、null 和枚举兜底|
|新增|`src/main/java/com/frank/mybatis/type/EnumTypeHandler.java`|安全保存/读取枚举 `name()`|
|新增|`src/main/java/com/frank/mybatis/type/LocalDateTimeTypeHandler.java`|`LocalDateTime` 与 `TIMESTAMP`|
|新增|`src/main/java/com/frank/mybatis/executor/BatchExecutor.java`|批处理、flush、批量键回填|
|新增|`src/main/java/com/frank/mybatis/transaction/TransactionFactory.java`|事务创建策略|
|新增|`src/main/java/com/frank/mybatis/transaction/JdbcTransactionFactory.java`|默认 JDBC 事务策略|
|修改|`src/main/java/com/frank/mybatis/session/Configuration.java`|注册表、事务工厂、执行器类型|
|修改|`src/main/java/com/frank/mybatis/session/DefaultSqlSessionFactory.java`|经 TransactionFactory 装配 SIMPLE/BATCH|
|修改|`executor/Executor.java`、`executor/BaseExecutor.java`、`executor/SimpleExecutor.java`|flush 协议、键回填、异常清理|
|修改|`mapping/MappedStatement.java`、`session/DefaultSqlSession.java`|生成键元数据、提交/关闭边界|
|可选新增|`spring/*`、`type/JacksonJsonTypeHandler.java`|先增加对应依赖后才复制|
|新增|`src/test/java/com/frank/mybatis/chapter05/TypesAndTransactionTest.java`|真实 H2 集成测试|
开始前确认第 04 篇已有：`MappedStatement.getId()`、`getCommandType()`、`getSqlSource().getBoundSql(parameter)`；`BoundSql.getSql()` 与按问号顺序排列的 `ParameterMapping`；以及由 `SqlSession` 驱动的 `Executor`。`MetaObject` 由本篇第二节新增；下文的“修改片段”嵌入这些既有文件，不应删除缓存、插件或结果映射代码。
### 章节测试约定

第二至九节新增方法追加到第十二节 `src/test/java/com/frank/mybatis/chapter05/TypesAndTransactionTest.java`，复用 JUnit、JDBC 和 `com.frank.mybatis.type.*` 导入；额外类型使用全限定名。包名与命名沿用前四篇：`session.Configuration`、getter 访问器、JDK `java.sql.JDBCType`。第一节的前置条件通过旧测试回归验收；第十、十一节可选适配使用单独测试文件，并在加入相应依赖后运行。

## 二、先扩展参数与结果元数据

**为什么需要这一步：** 类型选择不能依赖 Map 迭代顺序，也不能仅靠参数运行时类。尤其值为 null 时，必须有声明的 Java 类型或显式 JDBC 类型。第 03 篇的 `ParameterMapping` 已经携带 `property/javaType/jdbcType` 三元组（JDK `java.sql.JDBCType`），本篇不改它；要改的是两侧的使用方式：参数绑定让声明类型参与处理器查找，结果映射允许逐列声明 `jdbcType`。

### 2.1 MetaObject：统一的反射读写入口

第 03 篇用 `DynamicContext.readProperty` 读属性，第 04 篇的 `ResultSetHandler` 又写了一套 getter/setter 反射。本篇把读写收敛为一个小组件，参数绑定、生成键回填和结果赋值都用它：

**新增文件**：`src/main/java/com/frank/mybatis/reflection/MetaObject.java`<br>
**package**：`com.frank.mybatis.reflection`<br>
**依赖**：JDK 17、第 03 篇 `DynamicContext.readProperty`<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.reflection;

import com.frank.mybatis.scripting.DynamicContext;
import java.beans.Introspector;
import java.lang.reflect.Method;

public final class MetaObject {

    private final Object target;

    private MetaObject(Object target) {
        this.target = target;
    }

    public static MetaObject forObject(Object target) {
        return new MetaObject(target);
    }

    public Object getValue(String property) {
        return DynamicContext.readProperty(target, property);
    }

    public void setValue(String property, Object value) {
        try {
            for (var descriptor : Introspector.getBeanInfo(
                    target.getClass(), Object.class).getPropertyDescriptors()) {
                if (descriptor.getName().equals(property)) {
                    Method setter = descriptor.getWriteMethod();
                    if (setter == null) {
                        throw new IllegalStateException("no setter for " + property
                                + " on " + target.getClass().getName());
                    }
                    setter.invoke(target, convert(value, setter.getParameterTypes()[0]));
                    return;
                }
            }
            throw new IllegalStateException("unknown property " + property
                    + " on " + target.getClass().getName());
        } catch (ReflectiveOperationException | java.beans.IntrospectionException failure) {
            throw new IllegalStateException("cannot set " + property, failure);
        }
    }

    private static Object convert(Object value, Class<?> targetType) {
        if (value == null || targetType.isInstance(value) || targetType == Object.class) {
            return value;
        }
        if (value instanceof Number number) {
            if (targetType == Integer.class || targetType == int.class) return number.intValue();
            if (targetType == Long.class || targetType == long.class) return number.longValue();
            if (targetType == Double.class || targetType == double.class) return number.doubleValue();
        }
        return value;
    }
}
```

读取复用 `DynamicContext.readProperty` 的 Bean/record/Map 规则；写入通过 Introspector 找 setter 并做基本数值转换——H2 的 identity 键返回 `Long`，实体字段可能是 `Integer` 或基本型。未知属性抛带属性名的异常，而不是返回 null：Map 参数用 `containsKey` 区分缺失与 null，Bean 参数在未知属性时立即失败并带上 statement id。

### 2.2 ResultMapping 增量：可空的 jdbcType

**修改文件**：`src/main/java/com/frank/mybatis/mapping/ResultMapping.java`<br>
**package**：`com.frank.mybatis.mapping`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.mapping;

import java.sql.JDBCType;
import java.util.Objects;

public record ResultMapping(String property, String column, Class<?> javaType,
                            JDBCType jdbcType, boolean id) {

    public ResultMapping {
        if (property == null || property.isBlank()) {
            throw new IllegalArgumentException("result property is blank");
        }
        if (column == null || column.isBlank()) {
            throw new IllegalArgumentException("result column is blank");
        }
        javaType = Objects.requireNonNull(javaType, "javaType");
    }

    public ResultMapping(String property, String column, Class<?> javaType, boolean id) {
        this(property, column, javaType, null, id);
    }
}
```

第 04 篇 `NestedMaps` 的 4 参构造调用经重载继续可用。`jdbcType` 未声明时，注册表按目标属性 Java 类型寻找默认处理器；不要在结果映射里重新写 `resultSet.getObject()`，否则 SQL NULL、枚举和时间规则会与参数侧分叉。

### 本节单元测试：缺省 Java 类型与显式 JDBC 类型

```java
@Test void metaObjectAndResultMappingDefaults() {
    var mapping = new com.frank.mybatis.mapping.ResultMapping("id", "order_id", Long.class, true);
    assertNull(mapping.jdbcType());
    var user = new com.frank.mybatis.fixture.User();
    var meta = com.frank.mybatis.reflection.MetaObject.forObject(user);
    meta.setValue("id", 7);
    assertEquals(7L, meta.getValue("id"));
    assertThrows(IllegalStateException.class,
            () -> meta.setValue("missing", 1));
}
```

## 三、新增 type/JDBCType 与 TypeHandler

**为什么需要这一步：** 第 03 篇的处理器只覆盖写入一侧，null、枚举、时间的正确行为散在各调用点。类型体系要成为两侧对称的契约：写入带 `JDBCType`，读取有列名/下标/存储过程三个入口，NULL 与数值零严格区分——先定契约（本节），再定查找规则（第四节）。

![图 2：类型契约两侧对称](typehandler-symmetric-contract.svg)
### 3.1 JDBCType：沿用 JDK 枚举，不自建映射

第 03 篇已经统一使用 JDK `java.sql.JDBCType`：`TextSqlNode` 解析 `#{...,jdbcType=TIMESTAMP}` 时用 `JDBCType.valueOf`，`setNull` 用 `getVendorTypeNumber()` 取整数类型码。本篇不自建枚举重复这份映射，避免自定义类型与 JDK 类型之间出现第二次转换——真实 MyBatis 的 `org.apache.ibatis.type.JdbcType` 是为兼容老驱动与方言常量而存在，教学框架没有这个负担。null 参数的默认类型由第五节的 `jdbcTypeForNull`（默认 `OTHER`）兜底；时间列应显式 `TIMESTAMP`，JSON 字符串列显式 `VARCHAR`。

本节真正的修改对象是第 03 篇的 `TypeHandler` 接口：签名扩展为"写入带 `JDBCType`、三类读取"，既有处理器（String/Integer/Long/Boolean/LocalDate/LocalDateTime/ByteArray/Enum）按新签名逐一改造，结构见下一小节的模板。

### 3.2 TypeHandler：写入和三类读取必须对称
**新增文件**：`src/main/java/com/frank/mybatis/type/TypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要
```java
package com.frank.mybatis.type;
import java.sql.*;
public interface TypeHandler<T> {
    void setParameter(PreparedStatement ps, int index, T value, JDBCType jdbcType) throws SQLException;
    T getResult(ResultSet rs, String column) throws SQLException;
    T getResult(ResultSet rs, int index) throws SQLException;
    T getResult(CallableStatement cs, int index) throws SQLException;
}
```
注册表在调用处理器前统一处理 null：它调用 `PreparedStatement.setNull`，因此具体处理器只接受非 null 值。不要允许未知复杂对象悄悄落到 `setObject`；缺少处理器应立即失败，异常必须包含 Java 类型、JDBC 类型、参数位置和 statement id。
**新增文件**：`src/main/java/com/frank/mybatis/type/BaseTypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要
```java
package com.frank.mybatis.type;
import java.sql.*;
public abstract class BaseTypeHandler<T> implements TypeHandler<T> {
    @Override public final void setParameter(PreparedStatement ps, int i, T v, JDBCType t) throws SQLException {
        if (v == null) throw new SQLException("TypeHandler received null at " + i);
        setNonNullParameter(ps, i, v, t);
    }
    @Override public final T getResult(ResultSet rs, String c) throws SQLException {
        T v = getNullableResult(rs, c); return rs.wasNull() ? null : v;
    }
    @Override public final T getResult(ResultSet rs, int i) throws SQLException {
        T v = getNullableResult(rs, i); return rs.wasNull() ? null : v;
    }
    @Override public final T getResult(CallableStatement cs, int i) throws SQLException {
        T v = getNullableResult(cs, i); return cs.wasNull() ? null : v;
    }
    protected abstract void setNonNullParameter(PreparedStatement ps, int i, T v, JDBCType t) throws SQLException;
    protected abstract T getNullableResult(ResultSet rs, String c) throws SQLException;
    protected abstract T getNullableResult(ResultSet rs, int i) throws SQLException;
    protected abstract T getNullableResult(CallableStatement cs, int i) throws SQLException;
}
```
数值和布尔 JDBC getter 返回原始值：`getLong()` 的 0、`getBoolean()` 的 false 都可能来自 SQL NULL。父类的 `wasNull()` 让这类处理器不会把 NULL 错映射成 Java 默认值。
### 3.3 两个基础处理器与注册原则
以下类展示基础处理器的完整结构。`Integer`、`Boolean`、`BigDecimal` 和 `byte[]` 可按同样模式扩展，分别使用 `setInt/getInt`、`setBoolean/getBoolean`、`setBigDecimal/getBigDecimal`、`setBytes/getBytes`；数值/布尔类均继承 `BaseTypeHandler`。
**新增文件**：`src/main/java/com/frank/mybatis/type/StringTypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要
```java
package com.frank.mybatis.type;
import java.sql.*;
public final class StringTypeHandler extends BaseTypeHandler<String> {
    @Override protected void setNonNullParameter(PreparedStatement ps, int i, String v, JDBCType t) throws SQLException { ps.setString(i, v); }
    @Override protected String getNullableResult(ResultSet rs, String c) throws SQLException { return rs.getString(c); }
    @Override protected String getNullableResult(ResultSet rs, int i) throws SQLException { return rs.getString(i); }
    @Override protected String getNullableResult(CallableStatement cs, int i) throws SQLException { return cs.getString(i); }
}
```
**新增文件**：`src/main/java/com/frank/mybatis/type/LongTypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要
```java
package com.frank.mybatis.type;

import java.sql.*;

public final class LongTypeHandler extends BaseTypeHandler<Long> {
    @Override protected void setNonNullParameter(PreparedStatement ps, int i, Long v, JDBCType t) throws SQLException { ps.setLong(i, v); }
    @Override protected Long getNullableResult(ResultSet rs, String c) throws SQLException { return rs.getLong(c); }
    @Override protected Long getNullableResult(ResultSet rs, int i) throws SQLException { return rs.getLong(i); }
    @Override protected Long getNullableResult(CallableStatement cs, int i) throws SQLException { return cs.getLong(i); }
}
```

原始类型与包装类型都要注册：反射声明可能是 `long.class`，运行时参数却一定装箱为 `Long.class`。只注册其中一个会得到看似偶发的 “no TypeHandler”。

### 3.4 EnumTypeHandler：默认保存 name()，绝不保存 ordinal

**新增文件**：`src/main/java/com/frank/mybatis/type/EnumTypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.type;

import java.sql.*;
import java.util.Objects;

public final class EnumTypeHandler<E extends Enum<E>> extends BaseTypeHandler<E> {
    private final Class<E> type;
    public EnumTypeHandler(Class<E> type) {
        this.type = Objects.requireNonNull(type, "enumType");
        if (!type.isEnum()) throw new IllegalArgumentException(type.getName() + " is not enum");
    }
    @Override protected void setNonNullParameter(PreparedStatement ps, int i, E v, JDBCType t) throws SQLException { ps.setString(i, v.name()); }
    @Override protected E getNullableResult(ResultSet rs, String c) throws SQLException { return read(rs.getString(c), c); }
    @Override protected E getNullableResult(ResultSet rs, int i) throws SQLException { return read(rs.getString(i), "#" + i); }
    @Override protected E getNullableResult(CallableStatement cs, int i) throws SQLException { return read(cs.getString(i), "#" + i); }
    private E read(String value, String location) throws SQLException {
        if (value == null) return null;
        try { return Enum.valueOf(type, value); }
        catch (IllegalArgumentException ex) {
            throw new SQLException("unknown enum '" + value + "' for " + type.getName() + " at " + location, ex);
        }
    }
}
```

ordinal 会因新增或重排枚举常量而改变历史数据含义，不能作为默认策略。表中保存业务码（如 `A`、`D`）时，为该枚举写专用处理器并定义双向映射；未知码仍应抛错，除非业务契约明确指定 UNKNOWN 分支。

### 3.5 LocalDateTimeTypeHandler：TIMESTAMP 不是 Instant

**新增文件**：`src/main/java/com/frank/mybatis/type/LocalDateTimeTypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.type;

import java.sql.*;
import java.time.LocalDateTime;

public final class LocalDateTimeTypeHandler extends BaseTypeHandler<LocalDateTime> {
    @Override protected void setNonNullParameter(PreparedStatement ps, int i, LocalDateTime v, JDBCType t) throws SQLException {
        ps.setTimestamp(i, Timestamp.valueOf(v));
    }
    @Override protected LocalDateTime getNullableResult(ResultSet rs, String c) throws SQLException {
        Timestamp v = rs.getTimestamp(c); return v == null ? null : v.toLocalDateTime();
    }
    @Override protected LocalDateTime getNullableResult(ResultSet rs, int i) throws SQLException {
        Timestamp v = rs.getTimestamp(i); return v == null ? null : v.toLocalDateTime();
    }
    @Override protected LocalDateTime getNullableResult(CallableStatement cs, int i) throws SQLException {
        Timestamp v = cs.getTimestamp(i); return v == null ? null : v.toLocalDateTime();
    }
}
```

`LocalDateTime` 不带时区，推荐列为 `TIMESTAMP`；它不是时间线上的唯一瞬间。`Instant`、`OffsetDateTime` 必须由应用明确 UTC/偏移与目标方言的策略后另写处理器，不能依赖 JVM 默认时区。JDBC 4.2 的 `getObject(..., LocalDateTime.class)` 可以使用，但上线前仍要针对目标驱动验证纳秒精度。

|Java 类型|建议列|边界|
|---|---|---|
|`LocalDate`|`DATE`|不代表某时区的零点|
|`LocalTime`|`TIME`|列精度决定小数秒|
|`LocalDateTime`|`TIMESTAMP`|本文处理器不保存时区|
|`Instant`|确认方言后的时间线列|显式 UTC，不猜默认时区|
|`byte[]`|`VARBINARY`|不是 SQL ARRAY|

### 3.6 处理器测试：NULL 与数值零分别读取

下标和列名两条读取路径都要断言。枚举未知值与时间往返由第十二节已有测试覆盖。

```java
@Test void longHandlerReadsNullAndZeroSeparately() throws Exception {
    var handler = new LongTypeHandler();
    try (Connection c = open(); Statement s = c.createStatement();
         ResultSet rs = s.executeQuery("select cast(null as bigint) as n, cast(0 as bigint) as z")) {
        assertTrue(rs.next());
        assertNull(handler.getResult(rs, "n"));
        assertNull(handler.getResult(rs, 1));
        assertEquals(Long.valueOf(0), handler.getResult(rs, "z"));
        assertEquals(Long.valueOf(0), handler.getResult(rs, 2));
    }
}
```

## 四、新增 TypeHandlerRegistry，并接入参数与结果

**为什么需要这一步：** 处理器再多，没有集中且无歧义的查找规则等于没有体系。注册表把匹配顺序固化成约定，并把 null 的 `setNull` 决策收到一处——参数侧与结果侧从此共用同一套规则。这是第 03 篇注册表的升级版：处理器签名随 `TypeHandler` 接口扩展，`setParameter`/`getResult` 的 null 判定集中到注册表与 `BaseTypeHandler`。匹配顺序固定为：语句/结果映射指定处理器；精确 `(javaType,jdbcType)`；同 Java 类型默认处理器；枚举声明类懒创建 `EnumTypeHandler`；仍不存在则失败。本篇不做父类/接口的模糊查找，避免两个接口处理器产生歧义。`Integer`、`Boolean`、`LocalDate`、`byte[]` 的注册沿用第 03 篇同名处理器（按新签名改造），保证第 01～04 篇的 CRUD 回归不被类型系统重写打断。

**修改文件**：`src/main/java/com/frank/mybatis/type/TypeHandlerRegistry.java`（整体替换第 03 篇版本）<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.type;

import java.sql.*;
import java.time.LocalDateTime;
import java.util.*;

public final class TypeHandlerRegistry {
    private record Key(Class<?> javaType, JDBCType jdbcType) {}
    private final Map<Key, TypeHandler<?>> handlers = new HashMap<>();

    public TypeHandlerRegistry() {
        register(String.class, new StringTypeHandler());
        register(Long.class, new LongTypeHandler());
        register(long.class, new LongTypeHandler());
        register(Integer.class, new IntegerTypeHandler());
        register(int.class, new IntegerTypeHandler());
        register(Boolean.class, new BooleanTypeHandler());
        register(boolean.class, new BooleanTypeHandler());
        register(java.time.LocalDate.class, new LocalDateTypeHandler());
        register(LocalDateTime.class, new LocalDateTimeTypeHandler());
        register(LocalDateTime.class, JDBCType.TIMESTAMP, new LocalDateTimeTypeHandler());
        register(byte[].class, new ByteArrayTypeHandler());
    }
    public <T> void register(Class<T> type, TypeHandler<? super T> handler) { register(type, null, handler); }
    public <T> void register(Class<T> type, JDBCType jdbc, TypeHandler<? super T> handler) {
        handlers.put(new Key(Objects.requireNonNull(type), jdbc), Objects.requireNonNull(handler));
    }
    @SuppressWarnings("unchecked") public <T> TypeHandler<T> getTypeHandler(Class<T> type, JDBCType jdbc) {
        TypeHandler<?> handler = find(type, jdbc);
        if (handler == null) throw new IllegalArgumentException("no TypeHandler: javaType=" + type.getName() + ", jdbcType=" + jdbc);
        return (TypeHandler<T>) handler;
    }
    public void setParameter(PreparedStatement ps, int i, Object value, Class<?> declaredType, JDBCType jdbc, JDBCType nullType) throws SQLException {
        if (value == null) {
            JDBCType actual = jdbc != null ? jdbc : nullType;
            if (actual == null) throw new SQLException("null parameter " + i + " has no jdbcType");
            ps.setNull(i, actual.getVendorTypeNumber()); return;
        }
        @SuppressWarnings("unchecked") TypeHandler<Object> handler = (TypeHandler<Object>) getTypeHandler(value.getClass(), jdbc);
        handler.setParameter(ps, i, value, jdbc);
    }
    public <T> T getResult(ResultSet rs, String col, Class<T> type, JDBCType jdbc) throws SQLException {
        return getTypeHandler(type, jdbc).getResult(rs, col);
    }
    private TypeHandler<?> find(Class<?> type, JDBCType jdbc) {
        TypeHandler<?> exact = handlers.get(new Key(type, jdbc));
        if (exact != null) return exact;
        TypeHandler<?> normal = handlers.get(new Key(type, null));
        if (normal != null) return normal;
        if (type.isEnum()) {
            @SuppressWarnings({"rawtypes", "unchecked"}) TypeHandler<?> created = new EnumTypeHandler((Class) type);
            handlers.put(new Key(type, null), created); return created;
        }
        return null;
    }
}
```

注册在 `SqlSessionFactory` 发布前完成；运行中不要热改共享 `HashMap`。业务自定义类型必须精确注册，例如 `registry.register(Money.class, JDBCType.DECIMAL, new MoneyTypeHandler())`，而不是注册 `Object.class` 的万能处理器。

**修改文件**：`src/main/java/com/frank/mybatis/executor/ParameterHandler.java`（整体替换）<br>
**package**：`com.frank.mybatis.executor`<br>
**依赖**：第 03 篇 `BoundSql`/`ParameterMapping`、本篇 `MetaObject`、`TypeHandlerRegistry`<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.BoundSql;
import com.frank.mybatis.mapping.ParameterMapping;
import com.frank.mybatis.reflection.MetaObject;
import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.type.TypeHandlerRegistry;
import java.sql.JDBCType;
import java.sql.PreparedStatement;
import java.sql.SQLException;

public final class ParameterHandler {

    private final TypeHandlerRegistry registry;
    private final JDBCType nullType;

    public ParameterHandler(Configuration configuration) {
        this.registry = configuration.getTypeHandlerRegistry();
        this.nullType = configuration.getJdbcTypeForNull();
    }

    public void setParameters(PreparedStatement ps, BoundSql boundSql, Object parameterObject)
            throws SQLException {
        MetaObject meta = parameterObject == null ? null : MetaObject.forObject(parameterObject);
        int index = 1;
        for (ParameterMapping mapping : boundSql.getParameterMappings()) {
            Object value = boundSql.hasAdditionalParameter(mapping.getProperty())
                    ? boundSql.getAdditionalParameter(mapping.getProperty())
                    : meta == null ? null : meta.getValue(mapping.getProperty());
            Class<?> type = mapping.getJavaType() == Object.class && value != null
                    ? value.getClass() : mapping.getJavaType();
            registry.setParameter(ps, index++, value, type, mapping.getJdbcType(), nullType);
        }
    }

    public static Object valueOf(BoundSql boundSql, String property) {
        // 第 04 篇 CacheKey 复用的取值函数，实现保持第 03 篇不变。
        // ……（原样保留 valueOf 方法体）
    }
}
```

与第 03 篇版本相比有三处刻意变化：构造器从"只拿注册表"改为拿整个 `Configuration`（null 兜底类型来自全局配置）；取值从 `DynamicContext.readProperty` 链改为 `MetaObject`；第 03 篇"null 必须显式 jdbcType"的硬失败放宽为 `jdbcTypeForNull` 兜底（默认 `OTHER`）——跨库关键语句仍应在语句上显式标注。`valueOf` 保持 registry 无关的静态实现，`SimpleExecutor`、`BatchExecutor` 的调用点同步改为 `new ParameterHandler(configuration).setParameters(ps, boundSql, parameter)`。参数解析失败要带 statement id、property、index；不要因为值是 null 就跳过一个问号。

### 本节单元测试：注册优先级和 null 必须有类型

```java
@Test void registryPrefersExactHandlerAndRejectsUnknownObjects() throws Exception {
    var registry = new TypeHandlerRegistry();
    var exact = new StringTypeHandler();
    registry.register(String.class, JDBCType.CHAR, exact);
    assertSame(exact, registry.getTypeHandler(String.class, JDBCType.CHAR));
    assertNotSame(exact, registry.getTypeHandler(String.class, JDBCType.VARCHAR));
    assertNotNull(registry.getTypeHandler(long.class, null));
    assertNotNull(registry.getTypeHandler(Long.class, null));
    assertThrows(IllegalArgumentException.class,
            () -> registry.getTypeHandler(Object.class, JDBCType.OTHER));
    try (Connection c = open(); PreparedStatement ps = c.prepareStatement("select ?")) {
        assertThrows(SQLException.class,
                () -> registry.setParameter(ps, 1, null, String.class, null, null));
        registry.setParameter(ps, 1, null, String.class, JDBCType.VARCHAR, null);
        try (ResultSet rs = ps.executeQuery()) {
            assertTrue(rs.next());
            assertNull(rs.getString(1));
        }
    }
}
```

## 五、修改 Configuration：启动期集中配置

**为什么需要这一步：** jdbcTypeForNull、执行器类型、事务工厂这三件事若散在调用点，行为就取决于「谁最后设置」。集中到 Configuration 启动期配置：默认值明确、非法值启动即拒、全局只此一份。

**修改文件**：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量）<br>
**package**：`com.frank.mybatis.session`<br>
**依赖**：本篇 `TransactionFactory`/`JdbcTransactionFactory`、JDK `java.sql.JDBCType`<br>
**pom 增量**：不需要

```java
public enum ExecutorType { SIMPLE, BATCH }

private TransactionFactory transactionFactory = new JdbcTransactionFactory();
private JDBCType jdbcTypeForNull = JDBCType.OTHER;
private ExecutorType defaultExecutorType = ExecutorType.SIMPLE;

public TransactionFactory getTransactionFactory() { return transactionFactory; }
public void setTransactionFactory(TransactionFactory value) {
    transactionFactory = Objects.requireNonNull(value);
}
public JDBCType getJdbcTypeForNull() { return jdbcTypeForNull; }
public void setJdbcTypeForNull(JDBCType value) { jdbcTypeForNull = Objects.requireNonNull(value); }
public ExecutorType getDefaultExecutorType() { return defaultExecutorType; }
public void setDefaultExecutorType(ExecutorType value) { defaultExecutorType = Objects.requireNonNull(value); }
```

`ExecutorType` 枚举与三个策略字段放进既有 `Configuration`——第 03 篇的 `getTypeHandlerRegistry()`、第 04 篇的缓存/插件/resultMaps 字段原样保留，import 补 `JdbcTransactionFactory`、`TransactionFactory` 与 `java.sql.JDBCType`。`Configuration` 只保存共享规则，不保存 `Connection`、请求对象、某次 `BoundSql` 或 batch statement。`jdbcTypeForNull=OTHER` 只做兜底；跨库关键语句仍须为 null 声明精确 JDBC 类型。

### 本节单元测试：默认配置与非法策略

```java
@Test void configurationDefaultsAndRejectsNullStrategies() {
    var c = new com.frank.mybatis.session.Configuration(new org.h2.jdbcx.JdbcDataSource());
    assertEquals(JDBCType.OTHER, c.getJdbcTypeForNull());
    assertEquals(com.frank.mybatis.session.Configuration.ExecutorType.SIMPLE, c.getDefaultExecutorType());
    assertInstanceOf(com.frank.mybatis.transaction.JdbcTransactionFactory.class, c.getTransactionFactory());
    assertSame(c.getTypeHandlerRegistry(), c.getTypeHandlerRegistry());
    c.setJdbcTypeForNull(JDBCType.VARCHAR);
    assertEquals(JDBCType.VARCHAR, c.getJdbcTypeForNull());
    assertThrows(NullPointerException.class, () -> c.setTransactionFactory(null));
    assertThrows(NullPointerException.class, () -> c.setDefaultExecutorType(null));
    assertThrows(NullPointerException.class, () -> c.setJdbcTypeForNull(null));
}
```

## 六、新增事务工厂与 JDBC 事务

**为什么需要这一步：** 第 04 篇工厂里写死的 `new JdbcTransaction(dataSource)` 把「连接从哪来、归谁管」焊死了。引入 TransactionFactory 后，裸 JDBC、连接池、Spring 托管只是三种工厂实现，Executor 与 Session 对此无感知。

![图 3：事务工厂的三种策略](transaction-factory-strategies.svg)

### 6.1 Transaction：Executor 不直接管理连接

**修改文件**：`src/main/java/com/frank/mybatis/transaction/Transaction.java`<br>
**package**：`com.frank.mybatis.transaction`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.transaction;

import java.sql.Connection;
import java.sql.SQLException;

public interface Transaction extends AutoCloseable {
    Connection getConnection() throws SQLException;
    void commit() throws SQLException;
    void rollback() throws SQLException;
    @Override void close() throws SQLException;
}
```

`close()` 的真实含义取决于连接来源：裸 JDBC 是关闭物理连接；连接池代理是归还连接；Spring 绑定连接只能交由 Spring 工具类释放。执行器只依赖这个接口，不能自行 `connection.commit()`。

### 6.2 TransactionFactory 与 JdbcTransactionFactory

**新增文件**：`src/main/java/com/frank/mybatis/transaction/TransactionFactory.java`<br>
**package**：`com.frank.mybatis.transaction`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.transaction;

import java.sql.*;
import javax.sql.DataSource;

public interface TransactionFactory {
    Transaction newTransaction(DataSource dataSource, Integer isolationLevel, boolean autoCommit) throws SQLException;
    Transaction newTransaction(Connection connection);
}
```

**新增文件**：`src/main/java/com/frank/mybatis/transaction/JdbcTransactionFactory.java`<br>
**package**：`com.frank.mybatis.transaction`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.transaction;

import java.sql.*;
import java.util.Objects;
import javax.sql.DataSource;

public final class JdbcTransactionFactory implements TransactionFactory {
    @Override public Transaction newTransaction(DataSource ds, Integer level, boolean autoCommit) throws SQLException {
        Connection c = Objects.requireNonNull(ds, "dataSource").getConnection();
        try {
            if (level != null) c.setTransactionIsolation(level);
            c.setAutoCommit(autoCommit);
            return new JdbcTransaction(c, true);
        } catch (SQLException ex) {
            try { c.close(); } catch (SQLException close) { ex.addSuppressed(close); }
            throw ex;
        }
    }
    @Override public Transaction newTransaction(Connection c) {
        return new JdbcTransaction(Objects.requireNonNull(c), false);
    }
}
```

**修改文件**：`src/main/java/com/frank/mybatis/transaction/JdbcTransaction.java`<br>
**package**：`com.frank.mybatis.transaction`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.transaction;

import java.sql.*;
import java.util.Objects;

public final class JdbcTransaction implements Transaction {
    private final Connection connection;
    private final boolean ownsConnection;
    private boolean closed;
    public JdbcTransaction(Connection connection, boolean ownsConnection) {
        this.connection = Objects.requireNonNull(connection); this.ownsConnection = ownsConnection;
    }
    @Override public Connection getConnection() throws SQLException { ensureOpen(); return connection; }
    @Override public void commit() throws SQLException { ensureOpen(); if (!connection.getAutoCommit()) connection.commit(); }
    @Override public void rollback() throws SQLException { ensureOpen(); if (!connection.getAutoCommit()) connection.rollback(); }
    @Override public void close() throws SQLException { if (!closed) { closed = true; if (ownsConnection) connection.close(); } }
    private void ensureOpen() throws SQLException { if (closed) throw new SQLException("transaction is closed"); }
}
```

`newTransaction(Connection)` 用于测试或明确由调用方拥有连接的受控场景，因此 `ownsConnection=false` 不关闭它；不要把这个入口当作 Spring 集成。`JdbcTransactionFactory` 借出连接后配置 isolation/autoCommit 失败时立即关闭，并把关闭失败作为 suppressed 异常保留。

### 6.3 主异常优先，清理异常 suppressed

`try-with-resources` 会自动保存 suppressed；session 需要“执行失败 -> rollback -> close”的顺序时也要手动保持该语义。

**新增文件**：`src/main/java/com/frank/mybatis/transaction/Exceptions.java`<br>
**package**：`com.frank.mybatis.transaction`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.transaction;

public final class Exceptions {
    private Exceptions() {}
    public static <T extends Throwable> T suppress(T primary, Throwable cleanup) {
        if (primary == null) {
            @SuppressWarnings("unchecked") T first = (T) cleanup;
            return first;
        }
        if (cleanup != null && cleanup != primary) primary.addSuppressed(cleanup);
        return primary;
    }
}
```

禁止 `catch (SQLException e) { rollback(); throw e; } finally { close(); }` 却让 rollback 或 close 覆盖 e。最初的 SQL/绑定错误是首要诊断，清理错误只能出现在 `getSuppressed()`。

### 6.4 单元与组件测试：连接所有权和异常保留

```java
@Test void transactionClosesOnlyOwnedConnections() throws Exception {
    var factory = new com.frank.mybatis.transaction.JdbcTransactionFactory();
    try (Connection borrowed = open()) {
        var tx = factory.newTransaction(borrowed);
        assertSame(borrowed, tx.getConnection());
        tx.close();
        assertFalse(borrowed.isClosed());
        assertDoesNotThrow(tx::close);
        assertThrows(SQLException.class, tx::getConnection);
    }
    var ds = new org.h2.jdbcx.JdbcDataSource();
    ds.setURL("jdbc:h2:mem:owned_" + java.util.UUID.randomUUID());
    var owned = factory.newTransaction(ds, Connection.TRANSACTION_READ_COMMITTED, false);
    Connection connection = owned.getConnection();
    assertFalse(connection.getAutoCommit());
    assertEquals(Connection.TRANSACTION_READ_COMMITTED, connection.getTransactionIsolation());
    owned.close();
    assertTrue(connection.isClosed());
}

@Test void cleanupFailuresStaySuppressedUnderOriginalFailure() {
    var primary = new SQLException("execute failed");
    var cleanup = new SQLException("close failed");
    assertSame(primary, com.frank.mybatis.transaction.Exceptions.suppress(primary, cleanup));
    assertArrayEquals(new Throwable[]{cleanup}, primary.getSuppressed());
    assertSame(primary, com.frank.mybatis.transaction.Exceptions.suppress(primary, primary));
    assertEquals(1, primary.getSuppressed().length);
}
```

## 七、主键回填：先声明，再读取 generated keys

**为什么需要这一步：** 自增主键 insert 后实体 id 仍是 null，是最容易困惑的点。回填必须显式声明（哪个语句、写回哪个属性）——把「所有 insert 的第一列」猜成 id，在复合主键与 sequence 面前全是错的。只对明确开启的 insert 请求 `Statement.RETURN_GENERATED_KEYS`。不能把“所有 insert 的第一列”猜成 id；复合主键、sequence、selectKey 和多列返回键需要另行设计。

![图 4：生成键回填的两个边界](generated-key-two-boundaries.svg)

**修改文件**：`src/main/java/com/frank/mybatis/mapping/MappedStatement.java`（增量）<br>
**package**：`com.frank.mybatis.mapping`<br>
**依赖**：JDK 17、第 04 篇 10 参构造器<br>
**pom 增量**：不需要

```java
private final boolean useGeneratedKeys;
private final String keyProperty;

public MappedStatement(String id, String namespace, SqlSource sqlSource,
                       SqlCommandType commandType, Class<?> parameterType,
                       Class<?> resultType, boolean returnsMany, Method method,
                       ResultMap resultMap, boolean useCache,
                       boolean useGeneratedKeys, String keyProperty) {
    // 既有 10 参构造器的全部校验与赋值保持不变，追加：
    if (useGeneratedKeys && (keyProperty == null || keyProperty.isBlank())) {
        throw new IllegalArgumentException("keyProperty required when useGeneratedKeys=true");
    }
    if (!useGeneratedKeys && keyProperty != null) {
        throw new IllegalArgumentException("keyProperty requires useGeneratedKeys=true");
    }
    this.useGeneratedKeys = useGeneratedKeys;
    this.keyProperty = keyProperty;
}

public boolean useGeneratedKeys() { return useGeneratedKeys; }
public String getKeyProperty() { return keyProperty; }
```

旧的 10 参构造器委托新构造器并传 `(false, null)`。XML 路径在第 02 篇 `XMLMapperBuilder` 解析 `<insert>` 时把 `useGeneratedKeys`/`keyProperty` 加入属性白名单并传入新构造器；注解路径本篇不新增元数据注解，生成键实验用 XML 语句完成。`keyProperty` 是可信 mapper 定义，不得来自 HTTP 请求。

**修改文件**：`src/main/java/com/frank/mybatis/executor/SimpleExecutor.java`（doUpdate 增量）<br>
**package**：`com.frank.mybatis.executor`<br>
**依赖**：本篇 `ParameterHandler` 新签名、`MetaObject`、MappedStatement 键元数据<br>
**pom 增量**：不需要

```java
private PreparedStatement prepare(MappedStatement ms, BoundSql boundSql) throws SQLException {
    return ms.useGeneratedKeys()
            ? transaction.getConnection().prepareStatement(
                    boundSql.getSql(), Statement.RETURN_GENERATED_KEYS)
            : transaction.getConnection().prepareStatement(boundSql.getSql());
}

@Override
protected int doUpdate(MappedStatement ms, Object parameter) throws SQLException {
    BoundSql boundSql = ms.getSqlSource().getBoundSql(parameter);
    try (PreparedStatement ps = prepare(ms, boundSql)) {
        new ParameterHandler(configuration).setParameters(ps, boundSql, parameter);
        int count = ps.executeUpdate();
        if (ms.useGeneratedKeys()) {
            writeGeneratedKey(ms, parameter, ps);
        }
        return count;
    }
}

private void writeGeneratedKey(MappedStatement ms, Object parameter, PreparedStatement ps)
        throws SQLException {
    try (ResultSet keys = ps.getGeneratedKeys()) {
        if (!keys.next()) throw new SQLException("no generated key for " + ms.getId());
        MetaObject.forObject(parameter).setValue(ms.getKeyProperty(), keys.getObject(1));
        if (keys.next()) throw new SQLException("multiple keys for single update " + ms.getId());
    }
}
```

这是第 04 篇 `SimpleExecutor.doUpdate` 的方法级增量，缓存清理、查询与插件逻辑不动。`MetaObject.setValue` 的数值转换负责 `Long`/`Integer` 装箱差异；不能假设 JDBC 返回对象恰好等于实体字段包装类型。无生成键、键数多余或不足都必须失败。

### 本节 JDBC 基线测试：生成键与提交是两个边界

此测试确认 H2 能返回生成键，以及拿到键后仍可回滚；它不替代通过 Mapper 插入后断言实体 `id` 的框架回填测试。真实项目的 MappedStatement 构建器尚需接入本节新增字段，不能用手动设置实体 id 来假装验证了 Executor 回填。

```java
@Test void generatedKeyDoesNotImplyCommit() throws Exception {
    String url = "jdbc:h2:mem:keys_" + java.util.UUID.randomUUID();
    try (Connection writer = DriverManager.getConnection(url);
         Connection observer = DriverManager.getConnection(url);
         Statement schema = writer.createStatement()) {
        schema.execute("create table generated_user(id bigint generated by default as identity primary key, name varchar(30))");
        writer.setAutoCommit(false);
        try (PreparedStatement ps = writer.prepareStatement(
                "insert into generated_user(name) values(?)", Statement.RETURN_GENERATED_KEYS)) {
            ps.setString(1, "Frank");
            assertEquals(1, ps.executeUpdate());
            try (ResultSet keys = ps.getGeneratedKeys()) {
                assertTrue(keys.next());
                assertTrue(keys.getLong(1) > 0);
                assertFalse(keys.next());
            }
        }
        writer.rollback();
        try (Statement s = observer.createStatement();
             ResultSet rs = s.executeQuery("select count(*) from generated_user")) {
            assertTrue(rs.next());
            assertEquals(0, rs.getInt(1));
        }
    }
}
```

## 八、新增 BatchExecutor 与 flush 协议

**为什么需要这一步：** 逐条 `executeUpdate` 的网络往返在大批量写入时是主要开销，JDBC batch 是标准解法；但 `addBatch()` 没有真实影响行数，「何时算执行完」必须成为显式协议——flush 边界、哨兵返回值、键回填顺序都要说清楚。

![图 5：批处理 flush 协议](batch-flush-protocol.svg)

### 8.1 Executor 增量

`addBatch()` 时没有真实影响行数，批处理必须以显式 flush 为边界。在第 04 篇接口上只增加一个方法，其余签名（含 `close(boolean forceRollback)` 与带 `RowBounds`/`ResultHandler` 的 `query`）保持不变：

**修改文件**：`src/main/java/com/frank/mybatis/executor/Executor.java`（增量）<br>
**package**：`com.frank.mybatis.executor`<br>
**依赖**：第 04 篇 `Executor`、本节 `BatchResult`<br>
**pom 增量**：不需要

```java
List<BatchResult> flushStatements() throws SQLException;
```

`BaseExecutor` 提供默认实现——普通执行器没有待 flush 的语句：

**修改文件**：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（增量）<br>
**package**：`com.frank.mybatis.executor`<br>
**依赖**：`BatchResult`<br>
**pom 增量**：不需要

```java
@Override
public List<BatchResult> flushStatements() {
    return List.of();
}
```

**新增文件**：`src/main/java/com/frank/mybatis/executor/BatchResult.java`<br>
**package**：`com.frank.mybatis.executor`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.MappedStatement;
import java.util.List;

public record BatchResult(MappedStatement statement, String sql, List<Object> parameters, int[] updateCounts) {
    public BatchResult { parameters = List.copyOf(parameters); updateCounts = updateCounts.clone(); }
    @Override public int[] updateCounts() { return updateCounts.clone(); }
}
```

### 8.2 BatchExecutor：仅复用相同最终 SQL

动态 SQL 可能令同一个 statement id 产生不同占位符结构，所以复用条件是“同一个 `MappedStatement` 且最终 SQL 相同”。`BatchExecutor` 继承第 04 篇 `BaseExecutor`：`update` 覆写为批量入队（同时清一级缓存），`query` 先 flush 再走父类缓存链，commit/rollback/close 都先处理待执行语句。批次只属于一个 executor/session，flush 后必须关闭并清空 statement。

**新增文件**：`src/main/java/com/frank/mybatis/executor/BatchExecutor.java`<br>
**package**：`com.frank.mybatis.executor`<br>
**依赖**：JDK 17<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.exceptions.PersistenceException;
import com.frank.mybatis.mapping.*;
import com.frank.mybatis.reflection.MetaObject;
import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.ResultHandler;
import com.frank.mybatis.session.RowBounds;
import com.frank.mybatis.transaction.Transaction;
import java.sql.*;
import java.util.*;

public final class BatchExecutor extends BaseExecutor {

    public static final int BATCH_UPDATE_RETURN_VALUE = Integer.MIN_VALUE + 1002;
    private final List<Entry> entries = new ArrayList<>();
    private boolean closed;

    public BatchExecutor(Configuration configuration, Transaction transaction) {
        super(configuration, transaction);
    }

    @Override
    public int update(MappedStatement ms, Object parameter) throws SQLException {
        ensureOpen();
        clearLocalCache();
        BoundSql sql = ms.getSqlSource().getBoundSql(parameter);
        Entry entry = current(ms, sql.getSql());
        if (entry == null) {
            entry = new Entry(ms, sql.getSql(), prepare(ms, sql.getSql()));
            entries.add(entry);
        }
        new ParameterHandler(configuration).setParameters(entry.ps, sql, parameter);
        entry.ps.addBatch();
        entry.parameters.add(parameter);
        return BATCH_UPDATE_RETURN_VALUE;
    }

    @Override
    public <E> List<E> query(MappedStatement ms, Object parameter,
                             RowBounds bounds, ResultHandler<E> handler) throws SQLException {
        flushStatements();
        return super.query(ms, parameter, bounds, handler);
    }

    @Override
    public List<BatchResult> flushStatements() throws SQLException {
        ensureOpen();
        List<BatchResult> out = new ArrayList<>();
        SQLException primary = null;
        try {
            for (Entry e : entries) {
                int[] counts = e.ps.executeBatch();
                if (e.ms.useGeneratedKeys()) writeKeys(e);
                out.add(new BatchResult(e.ms, e.sql, e.parameters, counts));
            }
            return List.copyOf(out);
        } catch (BatchUpdateException ex) {
            primary = new SQLException("batch failed, counts="
                    + Arrays.toString(ex.getUpdateCounts()), ex);
            throw primary;
        } finally {
            SQLException close = closeEntries();
            if (primary != null && close != null) primary.addSuppressed(close);
            else if (primary == null && close != null) throw close;
        }
    }

    @Override
    public void commit(boolean required) throws SQLException {
        flushStatements();
        super.commit(required);
    }

    @Override
    public void rollback(boolean required) throws SQLException {
        closeEntries();
        super.rollback(required);
    }

    @Override
    public void close(boolean forceRollback) {
        SQLException entriesFailure = closeEntries();
        try {
            super.close(forceRollback);
        } catch (PersistenceException failure) {
            if (entriesFailure != null) failure.addSuppressed(entriesFailure);
            throw failure;
        }
        if (entriesFailure != null) {
            throw new PersistenceException("close batch statements failed", entriesFailure);
        }
    }

    private PreparedStatement prepare(MappedStatement ms, String sql) throws SQLException {
        return ms.useGeneratedKeys()
                ? transaction.getConnection().prepareStatement(sql, Statement.RETURN_GENERATED_KEYS)
                : transaction.getConnection().prepareStatement(sql);
    }

    private Entry current(MappedStatement ms, String sql) {
        if (entries.isEmpty()) return null;
        Entry last = entries.get(entries.size() - 1);
        return last.ms == ms && last.sql.equals(sql) ? last : null;
    }

    private void writeKeys(Entry e) throws SQLException {
        try (ResultSet keys = e.ps.getGeneratedKeys()) {
            for (Object parameter : e.parameters) {
                if (!keys.next()) throw new SQLException(
                        "missing generated key for " + e.ms.getId());
                MetaObject.forObject(parameter).setValue(e.ms.getKeyProperty(), keys.getObject(1));
            }
            if (keys.next()) throw new SQLException("extra generated key for " + e.ms.getId());
        }
    }

    private SQLException closeEntries() {
        SQLException failure = null;
        for (Entry e : entries) {
            try {
                e.ps.close();
            } catch (SQLException ex) {
                if (failure == null) failure = ex;
                else failure.addSuppressed(ex);
            }
        }
        entries.clear();
        return failure;
    }

    private void ensureOpen() throws SQLException {
        if (closed) throw new SQLException("executor is closed");
    }

    private static final class Entry {
        final MappedStatement ms;
        final String sql;
        final PreparedStatement ps;
        final List<Object> parameters = new ArrayList<>();

        Entry(MappedStatement ms, String sql, PreparedStatement ps) {
            this.ms = ms;
            this.sql = sql;
            this.ps = ps;
        }
    }
}
```

`Statement.SUCCESS_NO_INFO` 与 `Statement.EXECUTE_FAILED` 是合法 batch count 值；业务不能把 `update()` 的哨兵值当影响行数，而要在 flush 后检查 `BatchResult.updateCounts()`。flush 失败时绝不 commit；调用方应 rollback，原始 `BatchUpdateException` 的 update counts 与 close 失败都应保留。

|场景|顺序|
|---|---|
|batch 后查询|先 `flushStatements()`，再查询|
|`SqlSession.commit()`|先 flush，再 transaction commit|
|`SqlSession.rollback()`|关闭/丢弃待执行 statement，再 rollback|
|`SqlSession.close()`|非外部事务下 rollback 未提交工作，再 close executor/transaction|
|分段提交|业务层明确切分事务；BatchExecutor 不自动每 N 条 commit|

### 8.3 单元测试：空批次、关闭状态与 counts 防御性复制

```java
@Test void emptyBatchLifecycleAndClosedExecutor() throws Exception {
    var configuration = new com.frank.mybatis.session.Configuration(
            new org.h2.jdbcx.JdbcDataSource());
    try (Connection c = open()) {
        c.setAutoCommit(false);
        var tx = new com.frank.mybatis.transaction.JdbcTransaction(c, false);
        var executor = new com.frank.mybatis.executor.BatchExecutor(configuration, tx);
        assertTrue(executor.flushStatements().isEmpty());
        executor.rollback(true);
        assertTrue(executor.flushStatements().isEmpty());
        executor.close(true);
        assertThrows(SQLException.class, executor::flushStatements);
        assertFalse(c.isClosed());
    }
}

@Test void batchResultProtectsCountsAndParameterList() {
    int[] counts = {1, Statement.SUCCESS_NO_INFO};
    var parameters = new java.util.ArrayList<Object>(java.util.List.of("first", "second"));
    // 本测试只测结果容器；statement 不参与被测方法，故使用 null。
    var result = new com.frank.mybatis.executor.BatchResult(null, "insert ...", parameters, counts);
    counts[0] = 99;
    parameters.clear();
    assertArrayEquals(new int[]{1, Statement.SUCCESS_NO_INFO}, result.updateCounts());
    result.updateCounts()[0] = 88;
    assertEquals(1, result.updateCounts()[0]);
    assertEquals(2, result.parameters().size());
    assertThrows(UnsupportedOperationException.class, () -> result.parameters().clear());
}
```

非空批次还要通过真实 statement 构建器验证 SQL 分组、flush 前后行数、逐实体回填和约束冲突后的整体回滚。上面的单元测试不宣称覆盖这些集成行为。当前 `flushStatements` 仅捕获 `BatchUpdateException`，普通 SQLException 与关闭异常同时发生时仍可能丢失主异常，验收时应按第六节异常契约补全该路径。

## 九、修改 SessionFactory 与 SqlSession

**为什么需要这一步：** 装配层要把前八节的零件接成完整链路：工厂经 TransactionFactory 借事务、按 ExecutorType 选执行器、再套第 04 篇插件链；Session 的关闭语义则要区分「自己管事务」与「外部托管」两种模式。

![图 6：close 的两种语义](externally-managed-close.svg)

### 9.1 DefaultSqlSessionFactory 通过 TransactionFactory 装配

连接的来源不再写死为 `new JdbcTransaction(dataSource)`：工厂一律经 `Configuration` 持有的 `TransactionFactory` 借出事务，并按 `defaultExecutorType` 选择 SIMPLE 或 BATCH 执行器；第 04 篇的 `pluginAll` 包装与 `newExecutor` 扩展点保持不变。

**修改文件**：`src/main/java/com/frank/mybatis/session/DefaultSqlSessionFactory.java`<br>
**package**：`com.frank.mybatis.session`<br>
**依赖**：本篇 `TransactionFactory`、`BatchExecutor`、第 04 篇 `pluginAll`<br>
**pom 增量**：不需要

```java
package com.frank.mybatis.session;

import com.frank.mybatis.exceptions.PersistenceException;
import com.frank.mybatis.executor.BatchExecutor;
import com.frank.mybatis.executor.Executor;
import com.frank.mybatis.executor.SimpleExecutor;
import com.frank.mybatis.transaction.Transaction;
import java.sql.Connection;
import java.sql.SQLException;

public class DefaultSqlSessionFactory implements SqlSessionFactory {

    private final Configuration configuration;

    public DefaultSqlSessionFactory(Configuration configuration) {
        this.configuration = configuration;
    }

    @Override
    public SqlSession openSession() {
        return openSession(configuration.getDefaultExecutorType());
    }

    public SqlSession openSession(Configuration.ExecutorType type) {
        Transaction transaction;
        try {
            transaction = configuration.getTransactionFactory().newTransaction(
                    configuration.getDataSource(), Connection.TRANSACTION_READ_COMMITTED, false);
        } catch (SQLException failure) {
            throw new PersistenceException("open transaction failed", failure);
        }
        try {
            Executor executor = type == Configuration.ExecutorType.BATCH
                    ? new BatchExecutor(configuration, transaction)
                    : newExecutor(transaction);
            return new DefaultSqlSession(configuration,
                    (Executor) configuration.pluginAll(executor), false);
        } catch (RuntimeException failure) {
            try {
                transaction.close();
            } catch (SQLException closeFailure) {
                failure.addSuppressed(closeFailure);
            }
            throw failure;
        }
    }

    protected Executor newExecutor(Transaction transaction) {
        return new SimpleExecutor(configuration, transaction);
    }

    protected Configuration getConfiguration() {
        return configuration;
    }
}
```

`openSession()` 默认手动提交（`autoCommit=false`），由业务显式 commit。需要 `autoCommit=true` 的短查询路径直接用 `TransactionFactory` 组装（见 6.4 测试），不往 Session 接口上加参数。事务创建失败时不再泄漏连接：装配执行器或 Session 抛出异常，都先关闭借出的事务并把关闭失败挂到 suppressed。

### 9.2 DefaultSqlSession 的提交、回滚、关闭

**修改文件**：`src/main/java/com/frank/mybatis/session/DefaultSqlSession.java`<br>
**package**：`com.frank.mybatis.session`<br>
**依赖**：第 04 篇 `Executor` 生命周期；Spring 模式另见第十一节<br>
**pom 增量**：不需要（核心）

```java
private final boolean externallyManagedTransaction;

public DefaultSqlSession(Configuration configuration, Executor executor) {
    this(configuration, executor, false);
}

public DefaultSqlSession(Configuration configuration, Executor executor,
                         boolean externallyManagedTransaction) {
    this.configuration = configuration;
    this.executor = executor;
    this.externallyManagedTransaction = externallyManagedTransaction;
}
```

`commit()`/`rollback()` 仍是第 04 篇的 `executor.commit(true)`/`executor.rollback(true)`——`BatchExecutor` 已在 commit 前自行 flush。`close()` 只改一行语义：

```java
@Override
public void close() {
    if (closed) {
        return;
    }
    closed = true;
    executor.close(!externallyManagedTransaction);
}
```

`externallyManagedTransaction` 由 Spring 装配路径传 `true` 创建，不使用 Spring 时固定 `false`。差别仅在于：外部事务下 close 不执行默认回滚（`forceRollback=false`），最终提交或回滚由 Spring 事务管理器决定；无论哪种模式，close 都会释放未 flush 的 batch statement、清理第 04 篇本地缓存并归还连接。

### 9.3 可选连接池：只在应用装配层增加 HikariCP

连接池提供连接复用，绝不决定业务提交。池连接的 `close()` 通常表示归还；池会恢复 autoCommit、readOnly、isolation 等状态，因此框架不应重复编写“手工复位连接”的逻辑。

**修改文件**：项目根 `pom.xml`<br>
**package**：不适用<br>
**依赖**：HikariCP<br>
**pom 增量**：需要，仅应用使用 HikariCP 时加入现有 `<dependencies>`

```xml
<dependency>
  <groupId>com.zaxxer</groupId>
  <artifactId>HikariCP</artifactId>
  <version>${hikari.version}</version>
</dependency>
```

**新增文件**：`src/main/java/com/frank/mybatis/app/DataSourceFactory.java`<br>
**package**：`com.frank.mybatis.app`<br>
**依赖**：HikariCP<br>
**pom 增量**：需要，上面的 HikariCP 依赖

```java
package com.frank.mybatis.app;

import com.zaxxer.hikari.*;
import javax.sql.DataSource;

public final class DataSourceFactory {
    private DataSourceFactory() {}
    public static DataSource create(String url, String user, String password) {
        HikariConfig c = new HikariConfig();
        c.setJdbcUrl(url); c.setUsername(user); c.setPassword(password);
        c.setMaximumPoolSize(10); c.setMinimumIdle(2); c.setConnectionTimeout(3_000);
        c.setPoolName("frank-mybatis-pool"); return new HikariDataSource(c);
    }
}
```

全局 `HikariDataSource.close()` 由应用容器/启动类在停机时调用；`SqlSession.close()` 只归还一条连接。连接数和超时必须按数据库容量、部署副本数与流量设置，示例数字不是生产推荐值。

### 9.4 单元测试：Session 关闭委托与外部事务标志

用 JDK 动态代理记录 `Executor` 生命周期调用，验证 close 把 `forceRollback` 正确传给执行器：本地事务传 `true`（未提交即回滚），外部管理事务传 `false`（提交权在 Spring）。

```java
@Test void sessionCloseDelegatesForceRollbackFlag() {
    var calls = new java.util.ArrayList<String>();
    var executor = (com.frank.mybatis.executor.Executor) java.lang.reflect.Proxy.newProxyInstance(
            com.frank.mybatis.executor.Executor.class.getClassLoader(),
            new Class<?>[]{com.frank.mybatis.executor.Executor.class}, (proxy, method, args) -> {
                calls.add(method.getName() + ":" + args[0]);
                return null;
            });
    var configuration = new com.frank.mybatis.session.Configuration(
            new org.h2.jdbcx.JdbcDataSource());
    new com.frank.mybatis.session.DefaultSqlSession(configuration, executor, false).close();
    new com.frank.mybatis.session.DefaultSqlSession(configuration, executor, true).close();
    assertEquals(java.util.List.of("close:false", "close:true"), calls);
}
```

回滚失败与关闭失败的主异常/suppressed 语义由第 04 篇 `BaseExecutor.close` 与本篇 6.3 的 `Exceptions.suppress` 共同保证，6.4 已有组件测试。连接池可选适配还需在 HikariCP 依赖启用后验证“关闭 Session 后池仍能借出新连接”，并在测试 finally 中关闭整个池。

## 十、JSON：核心只定义边界，应用再选择 Jackson

**为什么需要这一步：** JSON 是最典型的「应用态类型」——核心框架不该绑定任何序列化库。做法是核心只留注册位与边界（SQL NULL 与 JSON null 是两回事），具体编解码作为可选依赖的 TypeHandler 接入。核心不知道 Jackson、Gson、PostgreSQL `jsonb` 或 MySQL `JSON`。H2 测试可先用 `VARCHAR` 验证编码/解码；生产 `jsonb` 要另写经目标驱动验证的 `Types.OTHER`/供应商对象适配。不能从 JSON 中读取类名后做任意多态反序列化，目标类型必须来自可信 `ResultMapping`。

**修改文件**：项目根 `pom.xml`<br>
**package**：不适用<br>
**依赖**：Jackson Databind<br>
**pom 增量**：需要，仅使用 JSON 处理器时加入现有 `<dependencies>`

```xml
<dependency>
  <groupId>com.fasterxml.jackson.core</groupId>
  <artifactId>jackson-databind</artifactId>
  <version>${jackson.version}</version>
</dependency>
```

**新增文件**：`src/main/java/com/frank/mybatis/type/JacksonJsonTypeHandler.java`<br>
**package**：`com.frank.mybatis.type`<br>
**依赖**：Jackson Databind<br>
**pom 增量**：需要，上面的 Jackson 依赖

```java
package com.frank.mybatis.type;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.*;
import java.util.Objects;

public final class JacksonJsonTypeHandler<T> extends BaseTypeHandler<T> {
    private final ObjectMapper mapper; private final Class<T> targetType;
    public JacksonJsonTypeHandler(ObjectMapper mapper, Class<T> type) { this.mapper = Objects.requireNonNull(mapper); targetType = Objects.requireNonNull(type); }
    @Override protected void setNonNullParameter(PreparedStatement ps, int i, T value, JDBCType type) throws SQLException {
        try { ps.setString(i, mapper.writeValueAsString(value)); }
        catch (JsonProcessingException ex) { throw new SQLException("cannot serialize JSON parameter " + i, ex); }
    }
    @Override protected T getNullableResult(ResultSet rs, String c) throws SQLException { return read(rs.getString(c), c); }
    @Override protected T getNullableResult(ResultSet rs, int i) throws SQLException { return read(rs.getString(i), "#" + i); }
    @Override protected T getNullableResult(CallableStatement cs, int i) throws SQLException { return read(cs.getString(i), "#" + i); }
    private T read(String json, String location) throws SQLException {
        if (json == null) return null;
        try { return mapper.readValue(json, targetType); }
        catch (JsonProcessingException ex) {
            String preview = json.length() <= 256 ? json : json.substring(0, 256) + "...";
            throw new SQLException("cannot deserialize JSON at " + location + ": " + preview, ex);
        }
    }
}
```

示例注册：`registry.register(Profile.class, JDBCType.VARCHAR, new JacksonJsonTypeHandler<>(objectMapper, Profile.class));`。禁止注册 `Object.class` 的万能 JSON 处理器。SQL NULL 和 JSON 文本 `null` 是不同数据库状态，必须在业务契约、查询条件与测试中分别断言。

### 本节可选组件测试：JSON 往返与两种 null

文件：`src/test/java/com/frank/mybatis/chapter05/JsonTypeHandlerTest.java`。先加入本节 Jackson 依赖再创建文件。使用 `String[].class` 作为可信目标类型，不额外引入 Profile 模型。

```java
package com.frank.mybatis.chapter05;

import com.frank.mybatis.type.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.sql.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class JsonTypeHandlerTest {
    @Test void jsonRoundTripAndNullStates() throws Exception {
        var handler = new JacksonJsonTypeHandler<>(new ObjectMapper(), String[].class);
        try (Connection c = DriverManager.getConnection("jdbc:h2:mem:json_" + java.util.UUID.randomUUID());
             PreparedStatement ps = c.prepareStatement("select cast(? as varchar) as payload")) {
            handler.setParameter(ps, 1, new String[]{"中文", "quote\""}, JDBCType.VARCHAR);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertArrayEquals(new String[]{"中文", "quote\""}, handler.getResult(rs, "payload"));
            }
            ps.setNull(1, Types.VARCHAR);
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertNull(handler.getResult(rs, 1));
                assertTrue(rs.wasNull());
            }
            ps.setString(1, "null");
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertNull(handler.getResult(rs, 1));
                assertFalse(rs.wasNull());
            }
            ps.setString(1, "{broken");
            try (ResultSet rs = ps.executeQuery()) {
                assertTrue(rs.next());
                assertThrows(SQLException.class, () -> handler.getResult(rs, "payload"));
            }
        }
    }
}
```

## 十一、可选 Spring 外部事务同步：先加依赖

**为什么需要这一步：** 进 Spring 环境后，连接与事务的归属权反转：框架若自己 commit/rollback/close 线程绑定连接，会直接破坏 `@Transactional`。适配重点是「复用连接、提交前 flush batch、归还而非关闭」。Spring 将连接绑定到当前线程。外部 `@Transactional` 存在时，框架不得自己 commit、rollback 或物理 close 该连接；只可复用连接，并在 Spring 提交前 flush batch。没有 Spring JDBC 依赖就不要复制本节三个文件。

**修改文件**：项目根 `pom.xml`<br>
**package**：不适用<br>
**依赖**：Spring JDBC<br>
**pom 增量**：需要，仅 Spring 应用加入现有 `<dependencies>`

```xml
<dependency>
  <groupId>org.springframework</groupId>
  <artifactId>spring-jdbc</artifactId>
  <version>${spring.version}</version>
</dependency>
```

`${spring.version}` 必须跟随项目已有 Spring Framework/Spring Boot BOM；不应为核心模块单独引入另一套 Spring 版本。

### 11.1 SpringManagedTransaction

**新增文件**：`src/main/java/com/frank/mybatis/spring/SpringManagedTransaction.java`<br>
**package**：`com.frank.mybatis.spring`<br>
**依赖**：Spring JDBC<br>
**pom 增量**：需要，上面的 Spring JDBC 依赖

```java
package com.frank.mybatis.spring;

import com.frank.mybatis.transaction.Transaction;
import java.sql.*;
import java.util.Objects;
import javax.sql.DataSource;
import org.springframework.jdbc.datasource.DataSourceUtils;

public final class SpringManagedTransaction implements Transaction {
    private final DataSource dataSource;
    private Connection connection; private boolean transactional; private boolean closed;
    public SpringManagedTransaction(DataSource dataSource) { this.dataSource = Objects.requireNonNull(dataSource); }
    @Override public Connection getConnection() throws SQLException {
        if (closed) throw new SQLException("transaction is closed");
        if (connection == null) {
            connection = DataSourceUtils.getConnection(dataSource);
            transactional = DataSourceUtils.isConnectionTransactional(connection, dataSource);
        }
        return connection;
    }
    @Override public void commit() throws SQLException {
        if (connection != null && !transactional && !connection.getAutoCommit()) connection.commit();
    }
    @Override public void rollback() throws SQLException {
        if (connection != null && !transactional && !connection.getAutoCommit()) connection.rollback();
    }
    @Override public void close() {
        if (!closed) { closed = true; if (connection != null) DataSourceUtils.releaseConnection(connection, dataSource); connection = null; }
    }
}
```

不要在 `getConnection()` 后无条件 `setAutoCommit(false)`，也不要调用 `Connection.close()`。外部事务已绑定时，isolation、readOnly、commit/rollback 都属于 Spring；无绑定事务时，此实现才按普通 JDBC 状态提交或回滚。

**新增文件**：`src/main/java/com/frank/mybatis/spring/SpringManagedTransactionFactory.java`<br>
**package**：`com.frank.mybatis.spring`<br>
**依赖**：Spring JDBC<br>
**pom 增量**：需要，上面的 Spring JDBC 依赖

```java
package com.frank.mybatis.spring;

import com.frank.mybatis.transaction.*;
import java.sql.Connection;
import javax.sql.DataSource;

public final class SpringManagedTransactionFactory implements TransactionFactory {
    @Override public Transaction newTransaction(DataSource ds, Integer level, boolean autoCommit) {
        return new SpringManagedTransaction(ds);
    }
    @Override public Transaction newTransaction(Connection connection) {
        throw new UnsupportedOperationException("SpringManagedTransactionFactory requires DataSource");
    }
}
```

装配时调用 `configuration.setTransactionFactory(new SpringManagedTransactionFactory())`，并让 `DefaultSqlSession` 以 `externallyManagedTransaction=true` 创建。这样 `SqlSession.close()` 不执行默认 rollback，最终提交或回滚由 Spring 事务管理器决定。

### 11.2 Spring 事务提交前 flush BatchExecutor

外部事务不会调用 `SqlSession.commit()`，因此 batch session 在第一次成功 `addBatch()` 后注册一次同步回调。`beforeCommit` 失败会让 Spring 事务走失败路径；`afterCompletion` 只重置本 session 的注册标记。

**新增文件**：`src/main/java/com/frank/mybatis/spring/SpringBatchSynchronization.java`<br>
**package**：`com.frank.mybatis.spring`<br>
**依赖**：Spring JDBC<br>
**pom 增量**：需要，上面的 Spring JDBC 依赖

```java
package com.frank.mybatis.spring;

import java.sql.SQLException;
import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.transaction.support.*;

public final class SpringBatchSynchronization {
    @FunctionalInterface public interface FlushAction { void flush() throws SQLException; }
    private SpringBatchSynchronization() {}
    public static void registerOnce(FlushAction action, AtomicBoolean registered) {
        if (!TransactionSynchronizationManager.isSynchronizationActive() || !registered.compareAndSet(false, true)) return;
        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override public void beforeCommit(boolean readOnly) {
                if (readOnly) return;
                try { action.flush(); }
                catch (SQLException ex) { throw new IllegalStateException("cannot flush MyBatis batch before Spring commit", ex); }
            }
            @Override public void afterCompletion(int status) { registered.set(false); }
        });
    }
}
```

核心模块不应让 `DefaultSqlSession` 直接 import Spring。可在 Spring 装配子类/监听器中，在 `BatchExecutor.update()` 成功后调用 `registerOnce(batch::flushStatements, registered)`；或者把无 Spring 依赖的 flush hook 放进核心，由本类实现。不要每条 update 注册一次同步，也不要在 `afterCompletion` 再执行 SQL。

### 11.3 可选单元测试：同步回调只注册一次

文件：`src/test/java/com/frank/mybatis/chapter05/SpringSynchronizationTest.java`。先启用 Spring JDBC 依赖。测试结束必须清理线程绑定状态，避免污染其他测试。

```java
package com.frank.mybatis.chapter05;

import com.frank.mybatis.spring.SpringBatchSynchronization;
import java.sql.SQLException;
import java.util.concurrent.atomic.*;
import org.junit.jupiter.api.Test;
import org.springframework.transaction.support.*;
import static org.junit.jupiter.api.Assertions.*;

class SpringSynchronizationTest {
    @Test void registersOnceFlushesBeforeCommitAndResetsAfterCompletion() {
        AtomicBoolean registered = new AtomicBoolean();
        AtomicInteger flushes = new AtomicInteger();
        SpringBatchSynchronization.registerOnce(() -> flushes.incrementAndGet(), registered);
        assertFalse(registered.get());
        TransactionSynchronizationManager.initSynchronization();
        try {
            SpringBatchSynchronization.registerOnce(() -> flushes.incrementAndGet(), registered);
            SpringBatchSynchronization.registerOnce(() -> flushes.incrementAndGet(), registered);
            var callbacks = TransactionSynchronizationManager.getSynchronizations();
            assertEquals(1, callbacks.size());
            callbacks.get(0).beforeCommit(true);
            assertEquals(0, flushes.get());
            callbacks.get(0).beforeCommit(false);
            assertEquals(1, flushes.get());
            callbacks.get(0).afterCompletion(TransactionSynchronization.STATUS_COMMITTED);
            assertFalse(registered.get());
            assertEquals(1, flushes.get());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }
    @Test void flushFailurePropagatesToTransactionManager() {
        var failure = new SQLException("batch failed");
        TransactionSynchronizationManager.initSynchronization();
        try {
            SpringBatchSynchronization.registerOnce(() -> { throw failure; }, new AtomicBoolean());
            var callback = TransactionSynchronizationManager.getSynchronizations().get(0);
            var thrown = assertThrows(IllegalStateException.class, () -> callback.beforeCommit(false));
            assertSame(failure, thrown.getCause());
        } finally {
            TransactionSynchronizationManager.clearSynchronization();
        }
    }
}
```

这组测试只固定回调协议；Spring 外部事务的集成验收还应使用 `DataSourceTransactionManager` 和 `TransactionTemplate`，断言连接复用、关闭 Session 后连接仍可用，以及外层回滚后写入不可见。

## 十二、H2 集成测试与命令

**为什么需要这一步：** 类型与事务的正确性最终都要落在真实数据库行为上——NULL 语义、时间精度、rollback 可见性，mock 一律给不出证据。以下测试使用真实 JDBC 验证 SQL NULL、时间和 rollback；它是现有项目的测试文件，不是独立实验工程。批处理、生成键和 Spring 测试应继续通过项目现有 mapper/statement 构建器构造真实 `MappedStatement`，以覆盖 XML/注解元数据路径。

**新增文件**：`src/test/java/com/frank/mybatis/chapter05/TypesAndTransactionTest.java`<br>
**package**：`com.frank.mybatis.chapter05`<br>
**依赖**：已有测试范围 H2、JUnit Jupiter<br>
**pom 增量**：不需要；项目未声明时仅在现有根 POM 添加测试依赖

```java
package com.frank.mybatis.chapter05;

import com.frank.mybatis.type.*;
import java.sql.*;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class TypesAndTransactionTest {
    private enum State { ACTIVE }
    private Connection open() throws SQLException { return DriverManager.getConnection("jdbc:h2:mem:types_" + java.util.UUID.randomUUID()); }
    @Test void nullAndLocalDateTimeRoundTrip() throws Exception {
        TypeHandlerRegistry registry = new TypeHandlerRegistry();
        LocalDateTime value = LocalDateTime.of(2026, 9, 13, 10, 20, 30, 123_000_000);
        try (Connection c = open(); Statement s = c.createStatement()) {
            s.execute("drop table if exists t_type"); s.execute("create table t_type(id bigint primary key,note varchar(20),created_at timestamp)");
            try (PreparedStatement ps = c.prepareStatement("insert into t_type values(?,?,?)")) {
                ps.setLong(1, 1L);
                registry.setParameter(ps, 2, null, String.class, JDBCType.VARCHAR, JDBCType.OTHER);
                registry.setParameter(ps, 3, value, LocalDateTime.class, JDBCType.TIMESTAMP, JDBCType.OTHER);
                assertEquals(1, ps.executeUpdate());
            }
            try (ResultSet rs = s.executeQuery("select note,created_at from t_type")) {
                assertTrue(rs.next()); assertNull(registry.getResult(rs, "note", String.class, JDBCType.VARCHAR));
                assertEquals(value, registry.getResult(rs, "created_at", LocalDateTime.class, JDBCType.TIMESTAMP));
            }
        }
    }
    @Test void enumUnknownValueFailsWithContext() throws Exception {
        try (Connection c = open(); Statement s = c.createStatement()) {
            s.execute("drop table if exists t_enum"); s.execute("create table t_enum(v varchar(20))"); s.execute("insert into t_enum values('REMOVED')");
            try (ResultSet rs = s.executeQuery("select v from t_enum")) {
                assertTrue(rs.next()); SQLException ex = assertThrows(SQLException.class, () -> new EnumTypeHandler<>(State.class).getResult(rs, "v"));
                assertTrue(ex.getMessage().contains("REMOVED")); assertTrue(ex.getMessage().contains("State"));
            }
        }
    }
    @Test void rollbackIsInvisibleToSecondConnection() throws Exception {
        try (Connection first = open(); Connection second = DriverManager.getConnection(first.getMetaData().getURL()); Statement schema = first.createStatement()) {
            schema.execute("drop table if exists t_tx"); schema.execute("create table t_tx(id bigint primary key)"); first.setAutoCommit(false);
            first.createStatement().executeUpdate("insert into t_tx values(1)"); first.rollback();
            try (ResultSet rs = second.createStatement().executeQuery("select count(*) from t_tx")) { assertTrue(rs.next()); assertEquals(0L, rs.getLong(1)); }
        }
    }
}
```

生成键测试应断言 insert 后实体 `id` 已写回；batch 测试应断言相同最终 SQL 只有一个 batch、SQL 变化形成新 batch、`flushStatements()` 后产生 counts；事务测试应使用两个独立连接，分别断言 commit 后可见、rollback 后不可见。连接池测试还要断言关闭 session 只归还连接，不关闭全局 DataSource。

**修改文件**：项目根 `pom.xml`<br>
**package**：不适用<br>
**依赖**：H2、JUnit Jupiter<br>
**pom 增量**：仅项目尚未声明时需要

```xml
<dependency>
  <groupId>com.h2database</groupId><artifactId>h2</artifactId><scope>test</scope>
</dependency>
<dependency>
  <groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><scope>test</scope>
</dependency>
```

已有 BOM/dependency management 时不要重复写版本；没有 BOM 时在项目已有的统一 properties 中定义一次。H2 是回归基线，不替代 PostgreSQL JSONB、`TIMESTAMP WITH TIME ZONE`、batch generated keys 与连接池 reset 的目标数据库集成测试。

**执行位置**：现有 Java 框架 Maven 根目录<br>
**package**：不适用<br>
**依赖**：JDK 17、Maven、已有测试依赖<br>
**pom 增量**：不需要

```bash
mvn -version
mvn -q -DskipTests compile
mvn -q test
mvn -q -Dtest=TypesAndTransactionTest test
mvn -q -Dtest=TypesAndTransactionTest#nullAndLocalDateTimeRoundTrip test
```

本系列是单模块工程（artifactId 为 `mini-mybatis-lab`），全部命令都在项目根目录执行，不需要 `-pl` 模块选择参数。

排错顺序：先确认 `mvn -version` 是 Java 17；其次检查可选 Spring/Jackson 文件是否已添加对应依赖；再打印 statement id、property、Java 类型、JDBC 类型和参数位置。null 失败时检查显式 `jdbcType`；主键未回填时检查数据库是否生成键、语句是否开启 `useGeneratedKeys`、对象是否可写；batch 失败时先 flush 并查看 counts；Spring 中连接提前关闭时检查是否用了 `SpringManagedTransactionFactory` 以及 session 是否错误执行默认 rollback。

## 十三、验收清单与本篇结论

**为什么需要这一步：** 这张表是全系列的最终回归清单——每个场景对应某一节刻意设计的边界，收尾时逐条过一遍，「所有权」这条主线才算闭合。

|场景|验收结果|
|---|---|
|null 参数|明确 jdbcType 时 `setNull`；无可推断类型时快速失败|
|数值/布尔 SQL NULL|不会变成 0/false|
|枚举|保存 `name()`；未知值带上下文失败|
|时间|`LocalDateTime` 与 TIMESTAMP 往返；不混入默认时区|
|JSON|可选依赖后才编译；SQL NULL 与 JSON `null` 区分|
|主键|单条/批量键数必须与参数数匹配|
|batch|查询/commit 前 flush；失败不提交|
|事务|Executor 不直接管理连接；rollback/close 失败为 suppressed|
|连接池|session 归还连接，不关闭 DataSource|
|Spring|复用线程绑定连接；外部事务负责最终 commit/rollback；beforeCommit flush|

这一篇的核心不是多加几个 JDBC API，而是划清所有权：`TypeHandlerRegistry` 拥有类型选择规则，`BatchExecutor` 拥有本 session 待执行语句，`TransactionFactory` 决定连接来源，`Transaction` 决定提交/关闭语义，连接池拥有物理连接，Spring 外部事务拥有最终提交权。守住这些边界后，JSON、方言时间、分页、二级缓存持久化和 Spring Boot 自动配置都能作为明确的适配层继续演进，而不会重新把类型、事务和连接搅回执行器。

> 系列导航：上一篇：[手写 MyBatis 04：缓存、插件与嵌套映射](/2026/09/12/articles/Mybatis/04-mybatis-cache-plugin-and-nested-mapping/) ｜ 本篇是第 5 篇（完结）
