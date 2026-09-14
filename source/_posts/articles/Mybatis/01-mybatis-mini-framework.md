---
title: 手写 MyBatis 01：从注解 Mapper 到 JDBC 的最小闭环
date: 2026-09-09 10:00:00
categories:
  - Mybatis
tags:
  - Java
  - MyBatis
  - JDBC
  - 动态代理
description: 在既有 Java 17 与 H2 空骨架中，逐 checkpoint 实现注解 Mapper、SQL 元数据、代理、会话、事务、JDBC 执行和结果映射。
lang: zh-CN
---
> 本篇不是另起一个演示工程，而是直接在 `D:\Projects\mini-mybatis-lab` 的空骨架上敲代码。最终目标很小但完整：`UserMapper.findById(1L)` 能经过 JDK 动态代理、Session、Executor 和 JDBC，返回一个 `User`。
约束先说清楚：不新建项目，不新建 `pom.xml`，不建立 `lab` 包，也不把多个类拼在一个嵌套类示例里。每个代码块都对应一个独立 Java 文件，真实根包统一为 `com.frank.mybatis`。
![图 1：从 JDBC 的手工步骤到 Mapper 调用](jdbc-to-mybatis-evolution.svg)
## 1. 先确认空骨架，不要重写已有入口

为什么从这一步开始：在一个已有工程上增量施工，必须先确认起点本身可编译、入口可运行，否则后面任何测试失败都无法归因是新代码还是旧环境。下面的清单同时就是本篇全部施工的边界。

项目已经具备：
```text
D:\Projects\mini-mybatis-lab
├── pom.xml
├── src/main/java/com/frank/mybatis/MiniMybatisApplication.java
├── src/main/java/com/frank/mybatis/
│   ├── annotations/.gitkeep
│   ├── binding/.gitkeep
│   ├── builder/.gitkeep
│   ├── executor/.gitkeep
│   ├── mapping/.gitkeep
│   ├── session/.gitkeep
│   └── transaction/.gitkeep
├── src/main/resources/schema.sql
└── src/test/java/com/frank/mybatis/.gitkeep
```
`pom.xml` 已经提供 Java 17、H2 `2.3.232`、JUnit Jupiter `5.10.2`、编译插件和 Surefire；不要复制一份新的 Maven 配置。`MiniMybatisApplication` 已经在 `com.frank.mybatis` 包中创建 H2 数据源、读取 classpath 的 `schema.sql`、执行脚本并检查 `T_USER`，它是可运行的现有入口，不是本篇重写目标。
`schema.sql` 目前只有一张表：
```sql
CREATE TABLE t_user (
    id BIGINT PRIMARY KEY,
    user_name VARCHAR(100) NOT NULL,
    age INTEGER
);
```
因此本文的业务对象只需要 `id`、`userName`、`age`。先在项目目录执行：
```bash
cd /d D:\Projects\mini-mybatis-lab
mvn clean test
```
空骨架没有测试是正常的。后面每完成一个 checkpoint 都重新执行这条命令；最终还可以用 `mvn compile exec:java` 验证已有启动类仍能读取 `schema.sql`。
![图 2：配置、Mapper 代理、Session、事务与 Executor 的边界](mini-mybatis-architecture.svg)
## 2. 第 01 篇的能力边界

为什么先划边界：教学框架最容易死在“顺手多支持一点”。这张表既是本篇的验收标准，也是全系列的路线图——每个“明确不做”的项都对应真实 MyBatis 的一个模块，将在后续四篇逐一补齐；边界之内，每多写一行没有测试支撑的代码都是负债。

本篇只实现一个可解释、可测试的闭环：
| 能力 | 本篇行为 |
| --- | --- |
| SQL 来源 | 方法上的 `@Select`、`@Insert`、`@Update`、`@Delete` |
| 占位符 | `#{name}` 转成 JDBC `?`，按 SQL 出现顺序绑定 |
| 参数名称 | `@Param("name")`，未标注参数使用 `arg0`、`arg1` |
| 查询结果 | 单个 POJO、`List<POJO>`；0 行单查返回 `null` |
| 写操作 | 返回 JDBC 影响行数 `int` |
| 列映射 | `user_name` 与 `userName` 通过去下划线、小写匹配 |
| 事务 | 一个 `SqlSession` 持有一个 Connection，调用方显式 commit/rollback |
| 明确不做 | XML、动态 SQL、`${}`、缓存、插件、关联映射、TypeHandler、分页和 Spring 整合 |
最终调用链是：
```text
UserMapper.findById(1L)
  -> MapperProxy.invoke
  -> Configuration.getMappedStatement
  -> DefaultSqlSession.selectOne
  -> SimpleExecutor.queryOne
  -> PreparedStatement / ResultSet
  -> ResultSetHandler
  -> User
```
配置和 `MappedStatement` 可以被多个 Session 只读共享；Connection、Transaction 和绑定了 Session 的 Mapper 代理绝不能做成全局对象。
### 章节测试的组织方式

以下补充测试使用已有 JUnit Jupiter 5.10.2；纯逻辑测试不连接数据库，涉及 JDBC、结果映射和事务的测试使用 H2。每个完整代码块按标注路径创建，后续章节标注“追加”的方法放进同一个测试类。第 1、2 节的环境与能力约束由 JDBC 基线和各 checkpoint 验证；第 11、12 节复盘时运行全部测试，不另建重复用例。

如果你的 `mini-mybatis-lab` 已经领先本篇（比如实体叫 `TUser`、测试类带 `T1_` 序号前缀、用了 pom 里已有的 Lombok），保留自己的命名完全可以——本篇的文件名与“手写字段 + 访问器”的写法是教学基准，不是必须回退的硬性要求。

## 3. Checkpoint 1：先写 JDBC 基线

**为什么需要这一步：** 本篇接下来的每一层都在包装 JDBC。如果对底座行为的假设本来就是错的，错误会被代理、Session、Executor 层层包装，几乎不可能定位回数据库。先用裸 JDBC 把三件事钉死成基线：`?` 只能绑定值而不能拼接 SQL（后面所有 `#{}` 走预编译的依据）、SQL NULL 读出来就是 `null` 而不是 0 或空串、事务提交前其他连接不可见。此后任何一层出错，都能确信问题不在 H2。

![图 3：JDBC 基线钉死的三件事——预编译、NULL 语义、事务可见性](jdbc-baseline-facts.svg)

**目标：** 在框架出现前证明 H2、预编译参数、SQL NULL 和事务行为都符合预期。
**新建目录：** `src/test/java/com/frank/mybatis/fixture` 与 `src/test/java/com/frank/mybatis/support`。
### 3.1 `fixture/User.java`
业务对象放 `fixture`，不要放到 `mapping`。它只需要无参构造器、字段和访问器：
```java
package com.frank.mybatis.fixture;
public class User {
    private Long id;
    private String userName;
    private Integer age;
    public User() {}
    public Long getId() { return id; }
    public void setId(Long id) { this.id = id; }
    public String getUserName() { return userName; }
    public void setUserName(String userName) { this.userName = userName; }
    public Integer getAge() { return age; }
    public void setAge(Integer age) { this.age = age; }
}
```
### 3.2 `support/H2DatabaseSupport.java`
每个测试拿到独立的内存库，并复用项目已有的 `src/main/resources/schema.sql`：
```java
package com.frank.mybatis.support;
import org.h2.jdbcx.JdbcDataSource;
import javax.sql.DataSource;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.Statement;
import java.util.UUID;
public final class H2DatabaseSupport {
    private H2DatabaseSupport() {}
    public static DataSource newDataSource() {
        JdbcDataSource ds = new JdbcDataSource();
        ds.setURL("jdbc:h2:mem:chapter01_" + UUID.randomUUID()
                + ";DB_CLOSE_DELAY=-1");
        ds.setUser("sa");
        ds.setPassword("");
        try (Connection c = ds.getConnection(); Statement s = c.createStatement()) {
            InputStream in = H2DatabaseSupport.class.getClassLoader()
                    .getResourceAsStream("schema.sql");
            if (in == null) throw new IllegalStateException("找不到 schema.sql");
            try (in) {
                s.execute(new String(in.readAllBytes(), StandardCharsets.UTF_8));
            }
            return ds;
        } catch (Exception e) {
            throw new IllegalStateException("初始化 H2 失败", e);
        }
    }
}
```
### 3.3 `chapter01/JdbcBaselineTest.java`
先用 JDBC 写一条插入和查询，最后 rollback，再用新连接确认数据不可见：
```java
package com.frank.mybatis.chapter01;
import com.frank.mybatis.support.H2DatabaseSupport;
import org.junit.jupiter.api.Test;
import javax.sql.DataSource;
import java.sql.*;
import static org.junit.jupiter.api.Assertions.*;
class JdbcBaselineTest {
    @Test
    void bindQueryNullAndRollback() throws Exception {
        DataSource ds = H2DatabaseSupport.newDataSource();
        try (Connection c = ds.getConnection()) {
            c.setAutoCommit(false);
            try (PreparedStatement p = c.prepareStatement(
                    "insert into t_user(id,user_name,age) values(?,?,?)")) {
                p.setLong(1, 1L);
                p.setString(2, "Frank");
                p.setNull(3, Types.INTEGER);
                assertEquals(1, p.executeUpdate());
            }
            try (PreparedStatement p = c.prepareStatement(
                    "select age from t_user where id=?")) {
                p.setLong(1, 1L);
                try (ResultSet r = p.executeQuery()) {
                    assertTrue(r.next());
                    assertNull(r.getObject(1));
                }
            }
            c.rollback();
        }
        try (Connection c = ds.getConnection(); Statement s = c.createStatement();
             ResultSet r = s.executeQuery("select count(*) from t_user")) {
            assertTrue(r.next());
            assertEquals(0, r.getInt(1));
        }
    }
}
```
**验收：** `mvn test` 通过。记住 `?` 只能绑定值，不能绑定列名或 SQL 片段；后续所有 `#{}` 都必须走 `PreparedStatement`。
## 4. Checkpoint 2：annotations，5 个运行时注解

**为什么需要这一步：** SQL 总要写在某个地方。写在每个调用点会散落且重复；写进独立配置文件就要先引入一套解析器（那是第 02 篇的事）。写在方法签名上，SQL 就和它的名字（接口.方法）声明在一起，调用点零样板。注解只做声明、绝不做执行：`RetentionPolicy.RUNTIME` 是为了启动期能反射读到它，而解析、校验都推迟到注册期完成。

**依赖：** 只有 Java 17。**目标：** 注解描述 SQL，绝不在注解中打开数据库。
以下 5 个文件分别创建在 `src/main/java/com/frank/mybatis/annotations`。不要把它们合并为一个外壳类。
### `Select.java`
```java
package com.frank.mybatis.annotations;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Select { String value(); }
```
### `Insert.java`
```java
package com.frank.mybatis.annotations;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Insert { String value(); }
```
### `Update.java`
```java
package com.frank.mybatis.annotations;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Update { String value(); }
```
### `Delete.java`
```java
package com.frank.mybatis.annotations;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface Delete { String value(); }
```
### `Param.java`
```java
package com.frank.mybatis.annotations;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.PARAMETER)
public @interface Param { String value(); }
```
**验收：** 让测试用反射检查 4 个 SQL 注解的 `RetentionPolicy.RUNTIME` 和 `@Param` 的参数目标；然后运行 `mvn test`。此时还没有构建器，所以注解不会产生任何执行效果。
### 4.1 单元测试：注解可在运行期读取

文件：`src/test/java/com/frank/mybatis/chapter01/AnnotationContractTest.java`。此测试只依赖本节五个注解，可立即执行 `mvn -Dtest=AnnotationContractTest test`。

```java
package com.frank.mybatis.chapter01;

import com.frank.mybatis.annotations.*;
import java.lang.annotation.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class AnnotationContractTest {
    @Test void sqlAnnotationsAreRuntimeMethodAnnotations() {
        for (Class<?> type : List.of(Select.class, Insert.class, Update.class, Delete.class)) {
            assertEquals(RetentionPolicy.RUNTIME, type.getAnnotation(Retention.class).value());
            assertArrayEquals(new ElementType[]{ElementType.METHOD},
                    type.getAnnotation(Target.class).value());
        }
        assertEquals(RetentionPolicy.RUNTIME, Param.class.getAnnotation(Retention.class).value());
        assertArrayEquals(new ElementType[]{ElementType.PARAMETER},
                Param.class.getAnnotation(Target.class).value());
    }
}
```

## 5. Checkpoint 3：mapping，把文本变成元数据

**为什么需要这一步：** `PreparedStatement` 只认 `?` 加下标，而人写的是 `#{name}`。两者之间必须有一次转换，产物就是两份元数据：最终 SQL（交给 `prepareStatement`）和有序参数名列表（绑定实参时按下标取用）。关键是转换在启动期只做一次、结果不可变共享——`MappedStatement` 注册后会被多个 Session 只读使用；每调用一次就重新正则解析一遍，既慢又给“注册期校验”留下漏洞。这也是固定 SQL 在第 03 篇引入 `SqlSource` 之前最简单正确的形态。

![图 4：模板注册期一次性转换为不可变元数据](template-to-metadata.svg)

**依赖：** Checkpoint 2。**目录：** `src/main/java/com/frank/mybatis/mapping`。
### 5.1 `SqlCommandType.java`
```java
package com.frank.mybatis.mapping;
public enum SqlCommandType { SELECT, INSERT, UPDATE, DELETE }
```
### 5.2 `PreparedSql.java`
`parameterNames` 必须是列表，因为同一个名称可能出现两次：
```java
package com.frank.mybatis.mapping;
import java.util.List;
public record PreparedSql(String sql, List<String> parameterNames) {
    public PreparedSql {
        if (sql == null || sql.isBlank()) throw new IllegalArgumentException("SQL 为空");
        parameterNames = List.copyOf(parameterNames);
    }
}
```
### 5.3 `MappedStatement.java`
```java
package com.frank.mybatis.mapping;
import java.util.Objects;
public record MappedStatement(String id, SqlCommandType commandType, String rawSql,
                               PreparedSql preparedSql, Class<?> resultType,
                               boolean returnsMany) {
    public MappedStatement {
        Objects.requireNonNull(id);
        Objects.requireNonNull(commandType);
        Objects.requireNonNull(rawSql);
        Objects.requireNonNull(preparedSql);
        Objects.requireNonNull(resultType);
    }
}
```
本篇的 `id` 固定为 Mapper 接口全限定名加方法名，例如 `com.frank.mybatis.chapter01.UserMapper.findById`。
### 5.4 `SqlTemplateParser.java`
这个解析器只接受简单参数名，拒绝 `${}` 和非法的 `#{}`：
```java
package com.frank.mybatis.mapping;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.*;
public final class SqlTemplateParser {
    private static final Pattern TOKEN = Pattern.compile(
            "#\\{\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*}");
    private SqlTemplateParser() {}
    public static PreparedSql parse(String raw) {
        if (raw == null || raw.isBlank()) throw new IllegalArgumentException("SQL 为空");
        if (raw.contains("${}" ) || raw.contains("${"))
            throw new IllegalArgumentException("第 01 篇不支持 ${}");
        Matcher m = TOKEN.matcher(raw);
        StringBuffer sql = new StringBuffer();
        List<String> names = new ArrayList<>();
        while (m.find()) {
            names.add(m.group(1));
            m.appendReplacement(sql, "?");
        }
        m.appendTail(sql);
        if (sql.indexOf("#{") >= 0) throw new IllegalArgumentException("非法占位符");
        return new PreparedSql(sql.toString(), names);
    }
}
```
**验收：** 为 `select ... where id=#{ id } and age=#{age}` 写测试，断言 SQL 是两个 `?`，名称顺序是 `[id, age]`；重复 `#{id}` 必须留下两个名称。再断言 `${column}` 抛异常。
### 5.5 单元测试：参数顺序、重复参数与非法模板

文件：`src/test/java/com/frank/mybatis/chapter01/SqlTemplateParserTest.java`。修改原始名称列表不能改变已构造的元数据，这也是共享配置的前提。

```java
package com.frank.mybatis.chapter01;

import com.frank.mybatis.mapping.*;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class SqlTemplateParserTest {
    @Test void preservesSqlOrderAndRepeatedNames() {
        PreparedSql sql = SqlTemplateParser.parse(
                "select * from t_user where id=#{ id } and age=#{age} or id=#{id}");
        assertEquals("select * from t_user where id=? and age=? or id=?", sql.sql());
        assertEquals(List.of("id", "age", "id"), sql.parameterNames());
    }
    @Test void rejectsUnsupportedAndMalformedTemplates() {
        for (String raw : List.of(" ", "select ${column}", "select #{user.id}", "select #{id")) {
            assertThrows(IllegalArgumentException.class, () -> SqlTemplateParser.parse(raw), raw);
        }
        assertThrows(IllegalArgumentException.class, () -> SqlTemplateParser.parse(null));
    }
    @Test void parameterNamesAreDefensivelyCopied() {
        var names = new ArrayList<>(List.of("id"));
        PreparedSql sql = new PreparedSql("select ?", names);
        names.clear();
        assertEquals(List.of("id"), sql.parameterNames());
        assertThrows(UnsupportedOperationException.class, () -> sql.parameterNames().clear());
    }
}
```

## 6. Checkpoint 4：executor 的参数与结果处理

**为什么需要这一步：** 绑定与映射是 JDBC 里最容易写错的两段样板——占位符按它在 SQL 里的出现顺序对应下标，与 Java 形参顺序无关；列名要对上驼峰字段，NULL 不能落进基本类型。把它们收进一个组件并以 `Executor` 接口暴露有两个原因：其一，执行器只依赖 `Connection`、用完语句就关，事务边界完全留给上层；其二，有了接口，第 04 篇的缓存和第 05 篇的批处理才能换成别的实现而不动调用方。

![图 5：参数绑定按 SQL 出现顺序建立下标](bind-by-sql-order.svg)

**依赖：** `PreparedSql`、`MappedStatement`。**目录：** `src/main/java/com/frank/mybatis/executor`。
### 6.1 `ParameterHandler.java`
先将 Java 方法参数命名，再按 SQL 模板记录的顺序绑定：
```java
package com.frank.mybatis.executor;
import com.frank.mybatis.annotations.Param;
import com.frank.mybatis.mapping.PreparedSql;
import java.lang.reflect.*;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.*;
public final class ParameterHandler {
    private ParameterHandler() {}
    public static Map<String,Object> resolve(Method method, Object[] args) {
        Parameter[] ps = method.getParameters();
        Object[] actual = args == null ? new Object[0] : args;
        if (ps.length != actual.length) throw new IllegalArgumentException("参数数量不匹配");
        Map<String,Object> values = new LinkedHashMap<>();
        for (int i = 0; i < ps.length; i++) {
            Param p = ps[i].getAnnotation(Param.class);
            String name = p == null ? "arg" + i : p.value();
            if (name.isBlank() || values.containsKey(name))
                throw new IllegalArgumentException("参数名为空或重复: " + name);
            values.put(name, actual[i]);
        }
        return values;
    }
    public static void bind(PreparedStatement ps, PreparedSql sql,
                            Map<String,Object> values) throws SQLException {
        for (int i = 0; i < sql.parameterNames().size(); i++) {
            String name = sql.parameterNames().get(i);
            if (!values.containsKey(name)) throw new IllegalArgumentException("未找到参数: " + name);
            ps.setObject(i + 1, values.get(name));
        }
    }
}
```
`containsKey` 很重要：它区分“参数不存在”和“参数值就是 null”。
### 6.2 `ResultSetHandler.java`
用无参构造器创建对象，用列 label 映射字段；SQL NULL 写入包装类型时保持 `null`：
```java
package com.frank.mybatis.executor;
import java.lang.reflect.*;
import java.sql.*;
import java.util.*;
public final class ResultSetHandler {
    public <T> List<T> handle(ResultSet rs, Class<T> type) throws SQLException {
        Map<String,Field> fields = fieldsOf(type);
        ResultSetMetaData meta = rs.getMetaData();
        List<T> result = new ArrayList<>();
        while (rs.next()) {
            try {
                Constructor<T> c = type.getDeclaredConstructor();
                c.setAccessible(true);
                T target = c.newInstance();
                for (int i = 1; i <= meta.getColumnCount(); i++) {
                    Field f = fields.get(key(meta.getColumnLabel(i)));
                    if (f == null) throw new IllegalStateException("没有对应字段: "
                            + meta.getColumnLabel(i));
                    Object value = rs.getObject(i);
                    if (value == null && f.getType().isPrimitive())
                        throw new IllegalStateException("NULL 不能写入基本类型: " + f);
                    f.set(target, value);
                }
                result.add(target);
            } catch (ReflectiveOperationException e) {
                throw new IllegalStateException("创建结果对象失败: " + type.getName(), e);
            }
        }
        return result;
    }
    private Map<String,Field> fieldsOf(Class<?> type) {
        Map<String,Field> result = new HashMap<>();
        for (Field f : type.getDeclaredFields()) {
            if (!Modifier.isStatic(f.getModifiers()) && !f.isSynthetic()) {
                f.setAccessible(true);
                result.put(key(f.getName()), f);
            }
        }
        if (result.isEmpty()) throw new IllegalArgumentException("结果类型没有字段");
        return result;
    }
    private String key(String value) { return value.replace("_", "").toLowerCase(Locale.ROOT); }
}
```
### 6.3 `Executor.java`
Executor 只描述 JDBC 操作，不拥有事务边界：
```java
package com.frank.mybatis.executor;
import com.frank.mybatis.mapping.MappedStatement;
import java.util.List;
import java.util.Map;
public interface Executor {
    <T> T queryOne(MappedStatement s, Map<String,Object> p, Class<T> type);
    <T> List<T> queryList(MappedStatement s, Map<String,Object> p, Class<T> type);
    int update(MappedStatement s, Map<String,Object> p);
}
```
### 6.4 `SimpleExecutor.java`
核心实现可以先写成下面这样。它关闭 `PreparedStatement` 和 `ResultSet`，但绝不 commit 或 close Connection：
```java
package com.frank.mybatis.executor;
import com.frank.mybatis.mapping.*;
import java.sql.*;
import java.util.*;
public final class SimpleExecutor implements Executor {
    private final Connection connection;
    private final ResultSetHandler resultHandler = new ResultSetHandler();
    public SimpleExecutor(Connection connection) { this.connection = connection; }
    public <T> T queryOne(MappedStatement s, Map<String,Object> p, Class<T> type) {
        List<T> rows = queryList(s, p, type);
        if (rows.isEmpty()) return null;
        if (rows.size() > 1) throw new IllegalStateException("selectOne 返回多行: " + s.id());
        return rows.get(0);
    }
    public <T> List<T> queryList(MappedStatement s, Map<String,Object> p, Class<T> type) {
        require(s, SqlCommandType.SELECT);
        try (PreparedStatement ps = connection.prepareStatement(s.preparedSql().sql())) {
            ParameterHandler.bind(ps, s.preparedSql(), p);
            try (ResultSet rs = ps.executeQuery()) { return resultHandler.handle(rs, type); }
        } catch (SQLException e) { throw new IllegalStateException("查询失败: " + s.id(), e); }
    }
    public int update(MappedStatement s, Map<String,Object> p) {
        if (s.commandType() == SqlCommandType.SELECT)
            throw new IllegalArgumentException("SELECT 不能 update");
        try (PreparedStatement ps = connection.prepareStatement(s.preparedSql().sql())) {
            ParameterHandler.bind(ps, s.preparedSql(), p);
            return ps.executeUpdate();
        } catch (SQLException e) { throw new IllegalStateException("更新失败: " + s.id(), e); }
    }
    private void require(MappedStatement s, SqlCommandType expected) {
        if (s.commandType() != expected) throw new IllegalArgumentException("命令类型不匹配");
    }
}
```
**验收：** 给 `rename(id,name)` 配置 SQL `set user_name=#{name} where id=#{id}`，确认第一个 JDBC 参数是 name 而不是 Java 参数下标 0；确认查询资源关闭且 Executor 没有提交事务。
### 6.5 组件测试：真实绑定、NULL 与单查边界

文件：`src/test/java/com/frank/mybatis/chapter01/ExecutorContractTest.java`。直接调用 Executor，失败时无需排查代理和 Session；H2 只作为 JDBC 适配边界。

```java
package com.frank.mybatis.chapter01;

import com.frank.mybatis.executor.*;
import com.frank.mybatis.fixture.User;
import com.frank.mybatis.mapping.*;
import com.frank.mybatis.support.H2DatabaseSupport;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class ExecutorContractTest {
    private MappedStatement statement(String sql, SqlCommandType command) {
        return new MappedStatement("test.statement", command, sql,
                SqlTemplateParser.parse(sql), User.class, false);
    }
    @Test void bindsBySqlOrderAndKeepsConnectionOpen() throws Exception {
        try (var c = H2DatabaseSupport.newDataSource().getConnection()) {
            c.setAutoCommit(false);
            var executor = new SimpleExecutor(c);
            var insert = statement("insert into t_user values(#{id},#{name},#{age})",
                    SqlCommandType.INSERT);
            Map<String,Object> values = new LinkedHashMap<>();
            values.put("age", null);
            values.put("name", "Frank");
            values.put("id", 1L);
            assertEquals(1, executor.update(insert, values));
            var query = statement("select id,user_name,age from t_user where id=#{id}",
                    SqlCommandType.SELECT);
            User user = executor.queryOne(query, Map.of("id", 1L), User.class);
            assertEquals("Frank", user.getUserName());
            assertNull(user.getAge());
            assertFalse(c.isClosed());
            c.rollback();
            assertNull(executor.queryOne(query, Map.of("id", 1L), User.class));
            assertThrows(IllegalArgumentException.class,
                    () -> executor.queryOne(query, Map.of(), User.class));
        }
    }
    @Test void selectOneRejectsMultipleRows() throws Exception {
        try (var c = H2DatabaseSupport.newDataSource().getConnection();
             var s = c.createStatement()) {
            s.executeUpdate("insert into t_user values(1,'A',20),(2,'B',21)");
            var query = statement("select id,user_name,age from t_user", SqlCommandType.SELECT);
            var executor = new SimpleExecutor(c);
            assertEquals(2, executor.queryList(query, Map.of(), User.class).size());
            assertThrows(IllegalStateException.class,
                    () -> executor.queryOne(query, Map.of(), User.class));
            assertThrows(IllegalArgumentException.class, () -> executor.update(query, Map.of()));
        }
    }
}
```

## 7. Checkpoint 5：transaction，把 Connection 生命周期独立出来

**为什么需要这一步：** 谁借出连接，谁就要对提交、回滚、关闭负责。如果 Executor 直接持有 `Connection` 并随手 commit，连接池和外部事务管理就永远插不进来。把生命周期收进 `Transaction` 接口后，Executor 只“使用”连接而不“拥有”连接——第 05 篇把 `new JdbcTransaction(dataSource)` 换成事务工厂、连接池或 Spring 实现时，执行器一行都不用改。`close()` 做成幂等、关闭后拒绝访问，则是防止同一段业务代码把连接归还两次。

![图 6：连接生命周期归 Transaction 所有](transaction-ownership.svg)

**目录：** `src/main/java/com/frank/mybatis/transaction`。**依赖：** JDK JDBC 与已有 H2。
### 7.1 `Transaction.java`
```java
package com.frank.mybatis.transaction;
import java.sql.Connection;
public interface Transaction extends AutoCloseable {
    Connection getConnection();
    void commit();
    void rollback();
    void close();
}
```
### 7.2 `JdbcTransaction.java`
```java
package com.frank.mybatis.transaction;
import javax.sql.DataSource;
import java.sql.*;
public final class JdbcTransaction implements Transaction {
    private final Connection connection;
    private boolean closed;
    public JdbcTransaction(DataSource ds) {
        try {
            connection = ds.getConnection();
            connection.setAutoCommit(false);
        } catch (SQLException e) { throw new IllegalStateException("打开事务失败", e); }
    }
    public Connection getConnection() { requireOpen(); return connection; }
    public void commit() { execute("提交失败", connection::commit); }
    public void rollback() { execute("回滚失败", connection::rollback); }
    public void close() {
        if (!closed) {
            closed = true;
            try { connection.close(); }
            catch (SQLException e) { throw new IllegalStateException("关闭连接失败", e); }
        }
    }
    private void execute(String message, SqlAction action) {
        requireOpen();
        try { action.run(); } catch (SQLException e) { throw new IllegalStateException(message, e); }
    }
    private void requireOpen() { if (closed) throw new IllegalStateException("事务已关闭"); }
    @FunctionalInterface private interface SqlAction { void run() throws SQLException; }
}
```
**验收：** 一个事务插入后 rollback，另一个连接查不到；commit 后能查到；close 后调用 `getConnection()` 抛 `IllegalStateException`。
### 7.3 组件测试：提交、回滚与重复关闭

文件：`src/test/java/com/frank/mybatis/chapter01/JdbcTransactionTest.java`。观察连接从事务外部读取，避免把“本连接可见”误当成提交成功。

```java
package com.frank.mybatis.chapter01;

import com.frank.mybatis.support.H2DatabaseSupport;
import com.frank.mybatis.transaction.JdbcTransaction;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class JdbcTransactionTest {
    @Test void commitPersistsAndRollbackDiscards() throws Exception {
        var ds = H2DatabaseSupport.newDataSource();
        var tx = new JdbcTransaction(ds);
        var connection = tx.getConnection();
        try (tx; var s = connection.createStatement()) {
            assertFalse(connection.getAutoCommit());
            s.executeUpdate("insert into t_user values(1,'Committed',20)");
            tx.commit();
            s.executeUpdate("insert into t_user values(2,'Rolled back',20)");
            tx.rollback();
        }
        assertTrue(connection.isClosed());
        assertDoesNotThrow(tx::close);
        assertThrows(IllegalStateException.class, tx::getConnection);
        assertThrows(IllegalStateException.class, tx::commit);
        try (var c = ds.getConnection(); var s = c.createStatement();
             var rs = s.executeQuery("select id from t_user order by id")) {
            assertTrue(rs.next());
            assertEquals(1L, rs.getLong(1));
            assertFalse(rs.next());
        }
    }
}
```

## 8. Checkpoint 6：session，组织一次业务会话

**为什么需要这一步：** 一次业务操作往往是“多条语句 + 一个事务”，调用方不应该手动编排连接、提交、回滚和异常清理。`SqlSession` 就是这条业务会话的唯一入口：打开即开始一个事务，语句按 statement id 路由到 Executor，关闭即回滚未提交的工作。`Configuration` 放在 session 包并做成全局唯一，因为它是所有 Session 共享的注册表——数据源与语句元数据注册一次、只读共享，Session 实例则用完即弃，两者的生命周期本来就不该搅在一起。

![图 7：一次业务会话的边界与两条出口](session-transaction-scope.svg)

**目录：** `src/main/java/com/frank/mybatis/session`。这里的 Session 负责把 statement id 转为 Executor 调用，并暴露事务操作。
### 8.1 `SqlSession.java`
```java
package com.frank.mybatis.session;
import java.util.List;
import java.util.Map;
public interface SqlSession extends AutoCloseable {
    <T> T selectOne(String id, Map<String,Object> p, Class<T> type);
    <T> List<T> selectList(String id, Map<String,Object> p, Class<T> type);
    int insert(String id, Map<String,Object> p);
    int update(String id, Map<String,Object> p);
    int delete(String id, Map<String,Object> p);
    <T> T getMapper(Class<T> type);
    void commit();
    void rollback();
    void close();
}
```
### 8.2 `Configuration.java`
Configuration 稍后会引用 `MapperRegistry`，先把 statement 注册和数据源保存好：
```java
package com.frank.mybatis.session;
import com.frank.mybatis.binding.MapperRegistry;
import com.frank.mybatis.mapping.MappedStatement;
import javax.sql.DataSource;
import java.util.*;
public final class Configuration {
    private final DataSource dataSource;
    private final Map<String,MappedStatement> statements = new HashMap<>();
    private final MapperRegistry mapperRegistry = new MapperRegistry(this);
    public Configuration(DataSource dataSource) { this.dataSource = Objects.requireNonNull(dataSource); }
    public DataSource getDataSource() { return dataSource; }
    public void addMappedStatement(MappedStatement s) {
        if (statements.putIfAbsent(s.id(), s) != null)
            throw new IllegalArgumentException("重复 statement id: " + s.id());
    }
    public MappedStatement getMappedStatement(String id) {
        MappedStatement s = statements.get(id);
        if (s == null) throw new IllegalArgumentException("未注册 statement: " + id);
        return s;
    }
    public <T> void addMapper(Class<T> type) { mapperRegistry.addMapper(type); }
    public MapperRegistry getMapperRegistry() { return mapperRegistry; }
}
```
### 8.3 `DefaultSqlSession.java`
```java
package com.frank.mybatis.session;
import com.frank.mybatis.executor.*;
import com.frank.mybatis.mapping.*;
import com.frank.mybatis.transaction.Transaction;
import java.util.*;
public final class DefaultSqlSession implements SqlSession {
    private final Configuration configuration;
    private final Transaction transaction;
    private final Executor executor;
    private boolean closed;
    public DefaultSqlSession(Configuration c, Transaction t) {
        configuration = c; transaction = t; executor = new SimpleExecutor(t.getConnection());
    }
    public <T> T selectOne(String id, Map<String,Object> p, Class<T> t) {
        return executor.queryOne(statement(id, SqlCommandType.SELECT), p, t);
    }
    public <T> List<T> selectList(String id, Map<String,Object> p, Class<T> t) {
        return executor.queryList(statement(id, SqlCommandType.SELECT), p, t);
    }
    public int insert(String id, Map<String,Object> p) { return executor.update(statement(id, SqlCommandType.INSERT), p); }
    public int update(String id, Map<String,Object> p) { return executor.update(statement(id, SqlCommandType.UPDATE), p); }
    public int delete(String id, Map<String,Object> p) { return executor.update(statement(id, SqlCommandType.DELETE), p); }
    public <T> T getMapper(Class<T> type) { requireOpen(); return configuration.getMapperRegistry().getMapper(type, this); }
    public void commit() { requireOpen(); transaction.commit(); }
    public void rollback() { requireOpen(); transaction.rollback(); }
    public void close() {
        if (!closed) { closed = true; try { transaction.rollback(); } finally { transaction.close(); } }
    }
    private MappedStatement statement(String id, SqlCommandType command) {
        requireOpen(); MappedStatement s = configuration.getMappedStatement(id);
        if (s.commandType() != command) throw new IllegalArgumentException("命令类型不匹配: " + id);
        return s;
    }
    private void requireOpen() { if (closed) throw new IllegalStateException("SqlSession 已关闭"); }
}
```
### 8.4 `SqlSessionFactory.java`
```java
package com.frank.mybatis.session;
public interface SqlSessionFactory { SqlSession openSession(); }
```
### 8.5 `DefaultSqlSessionFactory.java`
```java
package com.frank.mybatis.session;
import com.frank.mybatis.transaction.JdbcTransaction;
public final class DefaultSqlSessionFactory implements SqlSessionFactory {
    private final Configuration configuration;
    public DefaultSqlSessionFactory(Configuration configuration) { this.configuration = configuration; }
    public SqlSession openSession() {
        return new DefaultSqlSession(configuration, new JdbcTransaction(configuration.getDataSource()));
    }
}
```
**验收：** 构造一个 `Configuration`、打开两个 Session，验证它们各自获得 Connection；Session close 会回滚未提交工作，但不会撤销已经 commit 的数据。
### 8.6 Session 测试：关闭时回滚与会话隔离

完成下一节 binding 依赖和第 10 节夹具后，将此方法追加到 `MiniMybatisChapter01Test`。两个同时打开的 Session 应有独立事务；观察会话显式使用 READ COMMITTED 的 H2 默认行为。

```java
@Test void sessionsAreIsolatedAndCloseRollsBack() {
    try (SqlSession observer = factory.openSession()) {
        try (SqlSession writer = factory.openSession()) {
            UserMapper mapper = writer.getMapper(UserMapper.class);
            assertEquals(1, mapper.insert(8L, "Pending", 20));
            assertNotNull(mapper.findById(8L));
            assertNull(observer.getMapper(UserMapper.class).findById(8L));
        }
        assertNull(observer.getMapper(UserMapper.class).findById(8L));
    }
}
```

## 9. Checkpoint 7：binding 三件套和 builder

**为什么需要这一步：** 调用方想要的是 `userMapper.findById(1L)`，而不是 `session.selectOne("com.frank.mybatis.chapter01.UserMapper.findById", Map.of("id", 1L), User.class)`——字符串 id、手工组 Map、结果强转，每一样都是出错点。接口加 JDK 动态代理把这层样板全部吸收掉。代理内不扫描注解、不拼 id、不创建连接，是因为这些反射成本只在注册期由 builder 付一次；运行期的每次调用只是一次查表转发。

**依赖：** 前面所有类型。**目标：** 注册 Mapper 时解析一次，运行时代理只路由，不扫描注解、不创建连接。
### 9.1 `binding/MapperProxyFactory.java`
```java
package com.frank.mybatis.binding;
import com.frank.mybatis.session.*;
import java.lang.reflect.Proxy;
public final class MapperProxyFactory<T> {
    private final Class<T> mapperType;
    private final Configuration configuration;
    public MapperProxyFactory(Class<T> type, Configuration c) { mapperType = type; configuration = c; }
    public T newInstance(SqlSession session) {
        Object proxy = Proxy.newProxyInstance(mapperType.getClassLoader(),
                new Class<?>[]{mapperType}, new MapperProxy(session, configuration, mapperType));
        return mapperType.cast(proxy);
    }
}
```
### 9.2 `binding/MapperRegistry.java`
```java
package com.frank.mybatis.binding;
import com.frank.mybatis.builder.MapperAnnotationBuilder;
import com.frank.mybatis.session.*;
import java.util.*;
public final class MapperRegistry {
    private final Configuration configuration;
    private final Map<Class<?>,MapperProxyFactory<?>> factories = new HashMap<>();
    public MapperRegistry(Configuration c) { configuration = c; }
    public <T> void addMapper(Class<T> type) {
        if (!type.isInterface()) throw new IllegalArgumentException("Mapper 必须是接口");
        if (factories.containsKey(type)) throw new IllegalArgumentException("Mapper 已注册");
        new MapperAnnotationBuilder(configuration, type).parse();
        factories.put(type, new MapperProxyFactory<>(type, configuration));
    }
    public <T> T getMapper(Class<T> type, SqlSession session) {
        MapperProxyFactory<?> factory = factories.get(type);
        if (factory == null) throw new IllegalArgumentException("Mapper 未注册: " + type.getName());
        @SuppressWarnings("unchecked") MapperProxyFactory<T> typed = (MapperProxyFactory<T>) factory;
        return typed.newInstance(session);
    }
}
```
### 9.3 `binding/MapperProxy.java`
```java
package com.frank.mybatis.binding;
import com.frank.mybatis.executor.ParameterHandler;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.session.*;
import java.lang.reflect.*;
import java.util.Map;
public final class MapperProxy implements InvocationHandler {
    private final SqlSession session;
    private final Configuration configuration;
    private final Class<?> mapperType;
    public MapperProxy(SqlSession s, Configuration c, Class<?> type) {
        session = s; configuration = c; mapperType = type;
    }
    public Object invoke(Object proxy, Method method, Object[] args) {
        if (method.getDeclaringClass() == Object.class) {
            return switch (method.getName()) {
                case "toString" -> "MapperProxy(" + mapperType.getName() + ")";
                case "hashCode" -> System.identityHashCode(proxy);
                case "equals" -> proxy == args[0];
                default -> throw new IllegalStateException("不支持 Object 方法");
            };
        }
        String id = mapperType.getName() + "." + method.getName();
        MappedStatement s = configuration.getMappedStatement(id);
        Map<String,Object> p = ParameterHandler.resolve(method, args);
        return switch (s.commandType()) {
            case SELECT -> s.returnsMany() ? session.selectList(id, p, s.resultType())
                    : session.selectOne(id, p, s.resultType());
            case INSERT -> session.insert(id, p);
            case UPDATE -> session.update(id, p);
            case DELETE -> session.delete(id, p);
        };
    }
}
```
### 9.4 `builder/MapperAnnotationBuilder.java`
构建器负责唯一注解、SQL 解析、参数名称和返回形状检查。为保持本篇边界，它拒绝 default、static 和重载方法：
```java
package com.frank.mybatis.builder;
import com.frank.mybatis.annotations.*;
import com.frank.mybatis.executor.ParameterHandler;
import com.frank.mybatis.mapping.*;
import com.frank.mybatis.session.Configuration;
import java.lang.reflect.*;
import java.util.*;
public final class MapperAnnotationBuilder {
    private final Configuration configuration;
    private final Class<?> mapperType;
    public MapperAnnotationBuilder(Configuration c, Class<?> type) { configuration = c; mapperType = type; }
    public void parse() {
        Set<String> names = new HashSet<>();
        for (Method m : mapperType.getDeclaredMethods()) {
            if (m.isDefault() || Modifier.isStatic(m.getModifiers()) || !names.add(m.getName()))
                throw new IllegalArgumentException("不支持 default、static 或重载: " + m);
            parseMethod(m);
        }
    }
    private void parseMethod(Method m) {
        SqlCommandType command = commandOf(m);
        String raw = switch (command) {
            case SELECT -> m.getAnnotation(Select.class).value();
            case INSERT -> m.getAnnotation(Insert.class).value();
            case UPDATE -> m.getAnnotation(Update.class).value();
            case DELETE -> m.getAnnotation(Delete.class).value();
        };
        PreparedSql prepared = SqlTemplateParser.parse(raw);
        Map<String,Object> declared = ParameterHandler.resolve(m, new Object[m.getParameterCount()]);
        for (String name : prepared.parameterNames())
            if (!declared.containsKey(name)) throw new IllegalArgumentException("SQL 参数未声明: " + name);
        boolean many = false;
        Class<?> resultType;
        if (command == SqlCommandType.SELECT) {
            if (m.getReturnType() == List.class) {
                Type t = m.getGenericReturnType();
                if (!(t instanceof ParameterizedType p) || !(p.getActualTypeArguments()[0] instanceof Class<?>))
                    throw new IllegalArgumentException("列表查询必须是 List<具体类型>");
                resultType = (Class<?>) ((ParameterizedType) t).getActualTypeArguments()[0];
                many = true;
            } else {
                resultType = m.getReturnType();
                if (resultType.isPrimitive() || resultType.isInterface() || resultType == Object.class)
                    throw new IllegalArgumentException("查询必须返回具体 POJO");
            }
        } else {
            if (m.getReturnType() != int.class) throw new IllegalArgumentException("写方法必须返回 int");
            resultType = Void.class;
        }
        String id = mapperType.getName() + "." + m.getName();
        configuration.addMappedStatement(new MappedStatement(id, command, raw, prepared, resultType, many));
    }
    private SqlCommandType commandOf(Method m) {
        int count = (m.isAnnotationPresent(Select.class) ? 1 : 0)
                + (m.isAnnotationPresent(Insert.class) ? 1 : 0)
                + (m.isAnnotationPresent(Update.class) ? 1 : 0)
                + (m.isAnnotationPresent(Delete.class) ? 1 : 0);
        if (count != 1) throw new IllegalArgumentException("必须且只能有一个 SQL 注解: " + m);
        if (m.isAnnotationPresent(Select.class)) return SqlCommandType.SELECT;
        if (m.isAnnotationPresent(Insert.class)) return SqlCommandType.INSERT;
        if (m.isAnnotationPresent(Update.class)) return SqlCommandType.UPDATE;
        return SqlCommandType.DELETE;
    }
}
```
**验收：** `configuration.addMapper(UserMapper.class)` 能注册；故意写错 `#{naem}`、加两个 SQL 注解、注册两次或声明重载时，错误应在注册期抛出，而不是等到请求期间才暴露。
### 9.5 单元测试：注册校验与代理的 Object 方法

将以下方法追加到第 10 节的 `MiniMybatisChapter01Test`；使用现有 `UserMapper`，无需额外业务模型。无注解、参数拼写错误与重载接口应各自使用独立 Configuration 验证，不能在失败注册后的对象上继续装配。

```java
@Test void registrationRejectsDuplicatesAndUnknownStatements() {
    Configuration c = new Configuration(H2DatabaseSupport.newDataSource());
    c.addMapper(UserMapper.class);
    assertThrows(IllegalArgumentException.class, () -> c.addMapper(UserMapper.class));
    assertThrows(IllegalArgumentException.class, () -> c.addMapper(User.class));
    assertThrows(IllegalArgumentException.class, () -> c.getMappedStatement("missing.id"));
    var statement = c.getMappedStatement(UserMapper.class.getName() + ".rename");
    assertEquals(List.of("name", "id"), statement.preparedSql().parameterNames());
}

@Test void proxyObjectMethodsDoNotExecuteSql() {
    try (SqlSession s = factory.openSession()) {
        UserMapper first = s.getMapper(UserMapper.class);
        UserMapper second = s.getMapper(UserMapper.class);
        assertTrue(first.equals(first));
        assertFalse(first.equals(second));
        assertFalse(first.equals(null));
        assertEquals(System.identityHashCode(first), first.hashCode());
        assertTrue(first.toString().contains(UserMapper.class.getName()));
    }
}
```

## 10. Checkpoint 8：真实 Mapper 与端到端测试

**为什么需要这一步：** 前面七个 checkpoint 验证的都是单个组件的契约，还没有任何代码证明这些层拼在一起真的能工作。端到端测试用一条真实业务接口走完 代理 → Session → Executor → JDBC → 结果映射 的全链路，并专门覆盖最容易被边界条件坑掉的场景：参数乱序、NULL、commit/rollback 的可见性、关闭后的调用。它锁住的不是某个类，而是层与层之间的契约——这正是 MyBatis 相对于裸 JDBC 的全部价值所在。

**目录：** `src/test/java/com/frank/mybatis/chapter01`。这里不引入新依赖，直接使用项目 `pom.xml` 中已有的 H2 和 JUnit。
### 10.1 `chapter01/UserMapper.java`
```java
package com.frank.mybatis.chapter01;
import com.frank.mybatis.annotations.*;
import com.frank.mybatis.fixture.User;
import java.util.List;
public interface UserMapper {
    @Insert("insert into t_user(id,user_name,age) values(#{id},#{name},#{age})")
    int insert(@Param("id") Long id, @Param("name") String name, @Param("age") Integer age);
    @Select("select id,user_name,age from t_user where id=#{id}")
    User findById(@Param("id") Long id);
    @Select("select id,user_name,age from t_user where age >= #{minAge} order by id")
    List<User> findByMinimumAge(@Param("minAge") Integer minAge);
    @Update("update t_user set user_name=#{name} where id=#{id}")
    int rename(@Param("id") Long id, @Param("name") String name);
    @Delete("delete from t_user where id=#{arg0}")
    int deleteById(Long id);
}
```
`rename` 刻意让 SQL 顺序与 Java 参数顺序不同；`deleteById` 刻意不写 `@Param`，验证默认名称 `arg0`。
### 10.2 `chapter01/MiniMybatisChapter01Test.java`
```java
package com.frank.mybatis.chapter01;
import com.frank.mybatis.fixture.User;
import com.frank.mybatis.session.*;
import com.frank.mybatis.support.H2DatabaseSupport;
import org.junit.jupiter.api.*;
import javax.sql.DataSource;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;
class MiniMybatisChapter01Test {
    private SqlSessionFactory factory;
    @BeforeEach void setUp() {
        DataSource ds = H2DatabaseSupport.newDataSource();
        Configuration c = new Configuration(ds);
        c.addMapper(UserMapper.class);
        factory = new DefaultSqlSessionFactory(c);
    }
    @Test void crudAndCommit() {
        try (SqlSession s = factory.openSession()) {
            UserMapper m = s.getMapper(UserMapper.class);
            assertEquals(1, m.insert(1L, "Frank", 25));
            assertEquals(1, m.insert(2L, "Alice", null));
            assertEquals(1, m.rename(1L, "Frank Updated"));
            assertEquals("Frank Updated", m.findById(1L).getUserName());
            assertNull(m.findById(2L).getAge());
            List<User> users = m.findByMinimumAge(18);
            assertEquals(1, users.size());
            assertEquals(1, m.deleteById(2L));
            s.commit();
        }
        try (SqlSession s = factory.openSession()) {
            UserMapper m = s.getMapper(UserMapper.class);
            assertEquals("Frank Updated", m.findById(1L).getUserName());
            assertNull(m.findById(2L));
        }
    }
    @Test void rollbackHidesWriteFromNextSession() {
        try (SqlSession s = factory.openSession()) {
            assertEquals(1, s.getMapper(UserMapper.class).insert(3L, "Rollback", 20));
            s.rollback();
        }
        try (SqlSession s = factory.openSession()) {
            assertNull(s.getMapper(UserMapper.class).findById(3L));
        }
    }
    @Test void closedSessionRejectsMapperCall() {
        SqlSession s = factory.openSession();
        UserMapper m = s.getMapper(UserMapper.class);
        s.close();
        assertThrows(IllegalStateException.class, () -> m.findById(1L));
    }
}
```
**验收：** `mvn clean test` 全部通过。这个测试同时覆盖插入、单查、列表、更新、删除、`user_name -> userName`、NULL、参数乱序、commit、rollback 和 Session 关闭边界。
![图 8：一次 Mapper 方法调用的代理与 JDBC 时序](mapper-proxy-invocation-sequence.svg)
## 11. 完成后的目录树与调用复盘

**为什么需要这一步：** 写完不等于理解。把目录树和"注册期一次、调用期一次"的执行顺序各自串一遍，后面四篇在任意一层插入新能力（XML 解析、动态 SQL、缓存、批处理）时，你才判断得出改动落在哪个时机、会波及哪些边界。

完成本篇后，新增文件应是：
```text
src/main/java/com/frank/mybatis/
├── MiniMybatisApplication.java                 # 已有，保持不动
├── annotations/{Select,Insert,Update,Delete,Param}.java
├── mapping/{SqlCommandType,PreparedSql,MappedStatement,SqlTemplateParser}.java
├── executor/{ParameterHandler,ResultSetHandler,Executor,SimpleExecutor}.java
├── transaction/{Transaction,JdbcTransaction}.java
├── session/{Configuration,SqlSession,DefaultSqlSession,
│            SqlSessionFactory,DefaultSqlSessionFactory}.java
├── binding/{MapperProxy,MapperProxyFactory,MapperRegistry}.java
└── builder/MapperAnnotationBuilder.java
src/test/java/com/frank/mybatis/
├── fixture/User.java
├── support/H2DatabaseSupport.java
└── chapter01/{JdbcBaselineTest,UserMapper,MiniMybatisChapter01Test}.java
```
一次 `addMapper` 的注册期顺序是：`MapperRegistry` 检查接口和重复注册，`MapperAnnotationBuilder` 读取方法注解，`SqlTemplateParser` 生成 `PreparedSql`，构建器校验参数和返回值，最后 `Configuration` 保存 `MappedStatement`。
一次方法调用的运行期顺序是：代理计算 statement id，`ParameterHandler` 把实参变成名称到值的 Map，Session 按命令类型调用 Executor，Executor 创建并关闭 JDBC 语句，结果交给 `ResultSetHandler`。Executor 不 commit，Session 不解析注解，代理不创建 Connection，各层边界因此清楚。
常见故障可以按层定位：
| 现象 | 先检查 |
| --- | --- |
| 注册时提示未声明参数 | `@Param` 名称与 `#{}` 是否完全一致 |
| H2 报参数数量错误 | `PreparedSql.parameterNames()` 与 SQL `?` 顺序 |
| `userName` 为空 | 查询是否返回 `user_name`，POJO 是否有无参构造器 |
| 新 Session 查不到写入 | 是否调用 `session.commit()` |
| 关闭后仍想调用 Mapper | 代理绑定的 Session 已经失效 |
| 多行却调用单查 | 改用 `List<User>` 或收紧 SQL 条件 |
![图 9：本篇教学实现与真实 MyBatis 的能力边界](mini-vs-real-mybatis.svg)
## 12. 与真实 MyBatis 的对照，以及第 01 篇的止步处

**为什么需要这一步：** 手写的意义不是替代 MyBatis，而是建立对照。知道每个手写类对应官方框架的哪个组件，将来读真实源码或排查线上问题时才有地图；同时明确本篇止步在哪里，"不做"的每一项才会在后续篇章里变成"为什么值得做"。

| 本篇文件 | 真实 MyBatis 中接近的概念 |
| --- | --- |
| `Configuration`、`MapperRegistry` | 全局配置与 Mapper 注册表 |
| `MapperAnnotationBuilder` | 注解 Mapper 构建器 |
| `MapperProxy` | MapperProxy 与 MapperMethod |
| `MappedStatement`、`PreparedSql` | MappedStatement、SqlSource、BoundSql 的简化组合 |
| `ParameterHandler` | DefaultParameterHandler 与 TypeHandlerRegistry 的很小子集 |
| `SimpleExecutor` | Executor、StatementHandler 的合并教学实现 |
| `ResultSetHandler` | DefaultResultSetHandler、ResultMap 的最小映射 |
| `JdbcTransaction` | JDBC 事务实现 |
本篇故意不支持 XML、动态 SQL、`${}`、缓存、批量、关联对象、继承 Mapper、生成主键和外部事务。尤其不要把 `${}` 当作更方便的 `#{}`：它是文本替换，若接收外部输入就会把 SQL 注入风险带进来。

到这里，读者已经亲手实现了“配置期失败、调用期路由、执行期绑定、结果期映射、会话期提交”的主干。下一篇解决的是配置的组织问题：SQL 全部堆在 Java 注解里并不好维护，MyBatis 的答案是 XML Mapper 与统一的 statement id——XML 与注解在启动期注册成同一种 `MappedStatement`，运行期代理只按字符串 id 路由。再往后（第 03 篇）才会把固定的 `PreparedSql` 拆成按调用生成的 `SqlSource` 与 `BoundSql`，届时 `#{}` 占位符、`<if>`/`<foreach>` 与 TypeHandler 会有各自清晰的职责边界。

参考：
- [MyBatis 官方入门文档](https://mybatis.org/mybatis-3/getting-started.html)
- [MyBatis Java API](https://mybatis.org/mybatis-3/java-api.html)
- [MyBatis 源码](https://github.com/mybatis/mybatis-3)
- [Java 17 InvocationHandler API](https://docs.oracle.com/en/java/javase/17/docs/api/java.base/java/lang/reflect/InvocationHandler.html)
- [H2 Database 文档](https://h2database.com/html/main.html)

> 系列导航：本篇是第 1 篇 ｜ 下一篇：[手写 MyBatis 02：XML、注解与 Statement ID，统一配置模型](/2026/09/10/articles/Mybatis/02-mybatis-xml-and-statement-id/)
