---
title: '手写 MyBatis 04：缓存、插件与嵌套映射（项目增量）'
date: 2026-09-12 10:00:00
categories:
  - Mybatis
tags:
  - Java
  - MyBatis
  - 缓存
  - 插件
  - ResultMap
description: 承接第 03 篇的 com.frank.mybatis 项目，逐文件实现一级和二级缓存、插件签名链、ResultMap 嵌套映射与 chapter04 集成测试。
lang: zh-CN
---

> 本篇承接第 03 篇，不创建独立工程、不增加独立 `pom.xml`、不套单文件外壳。所有生产代码都位于真实 `com.frank.mybatis` 包；所有示例都是对既有工程的逐文件增量。
>
> 第 03 篇已经完成 `MappedStatement -> BoundSql -> 参数绑定 -> JDBC -> ResultSetHandler`。本篇在这条链上加入缓存、插件与对象图映射；动态 SQL、参数解析、会话和连接生命周期继续复用原实现。

## 一、范围、边界与最终调用链

**为什么需要这一步：** 缓存、插件、嵌套映射是三件互相纠缠的事——缓存要定义「什么算同一次查询」，插件要挂进执行链，嵌套映射要改写结果处理。先把最终调用链和「不做清单」画出来，后面每一节才知道自己在链上的位置。

![图 1：本篇的最终查询链](chapter04-final-chain.svg)

本篇完成四件事：

1. 用 `Cache`、`PerpetualCache` 和 `CacheKey` 实现会话级一级缓存。
2. 用 `TransactionalCache` 实现 namespace 级二级缓存的 commit/rollback 边界。
3. 用 `Interceptor`、`Invocation`、`Plugin`、`Signature` 实现精确签名的 JDK 代理链。
4. 用 `ResultMapping`、`ResultMap` 和改造后的 `ResultSetHandler` 完成 association、collection、JOIN 去重与 LEFT JOIN 空子项处理。

最终查询链如下：

```text
MapperProxy
  -> SqlSession
    -> Executor（一级缓存）
      -> namespace TransactionalCache（二级缓存）
        -> JDBC Statement
          -> ResultSetHandler
            -> ResultMap
              -> association / collection
```

本篇不实现分布式缓存、跨 JVM 序列化、懒加载、多层递归对象图或全功能 XML ResultMap 解析。先将最容易出错的运行时边界做正确：结果身份、事务可见性、代理签名和 JOIN 折叠。

### 1.1 当前 schema 的硬边界

当前项目的通用 schema **只有 `t_user`**。不要为了本篇把订单表加入第 03 篇的 schema，也不要在生产资源中声明 `t_order`、`t_order_item`。

嵌套映射实验专用表只新增到：

```text
src/test/resources/schema-ch04.sql
```

chapter04 测试夹具在 H2 测试库中加载它。这样第 03 篇的用户测试仍是最小基线，订单数据也不会误被业务代码当作当前主模型。

### 1.2 文件增量清单

新增的核心文件必须是以下路径：

```text
src/main/java/com/frank/mybatis/cache/Cache.java
src/main/java/com/frank/mybatis/cache/PerpetualCache.java
src/main/java/com/frank/mybatis/cache/CacheKey.java
src/main/java/com/frank/mybatis/cache/TransactionalCache.java

src/main/java/com/frank/mybatis/plugin/Interceptor.java
src/main/java/com/frank/mybatis/plugin/Invocation.java
src/main/java/com/frank/mybatis/plugin/Plugin.java
src/main/java/com/frank/mybatis/plugin/Signature.java

src/main/java/com/frank/mybatis/mapping/ResultMapping.java
src/main/java/com/frank/mybatis/mapping/ResultMap.java

src/test/resources/schema-ch04.sql
src/test/java/com/frank/mybatis/chapter04/Chapter04Fixture.java
src/test/java/com/frank/mybatis/chapter04/CacheChapter04Test.java
src/test/java/com/frank/mybatis/chapter04/PluginChapter04Test.java
src/test/java/com/frank/mybatis/chapter04/NestedMappingChapter04Test.java
```

修改既有文件：

```text
src/main/java/com/frank/mybatis/executor/Executor.java
src/main/java/com/frank/mybatis/executor/SimpleExecutor.java
src/main/java/com/frank/mybatis/executor/ResultSetHandler.java
src/main/java/com/frank/mybatis/session/DefaultSqlSession.java
src/main/java/com/frank/mybatis/session/DefaultSqlSessionFactory.java
src/main/java/com/frank/mybatis/session/Configuration.java
src/main/java/com/frank/mybatis/mapping/MappedStatement.java
```

新增的执行器骨架文件：

```text
src/main/java/com/frank/mybatis/executor/BaseExecutor.java
src/main/java/com/frank/mybatis/session/RowBounds.java
src/main/java/com/frank/mybatis/session/ResultHandler.java
src/main/java/com/frank/mybatis/exceptions/PersistenceException.java
```

执行器重构（第二节）是本篇其余章节的地基：`BaseExecutor` 提供缓存检查的挂载点与事务生命周期，`SimpleExecutor` 退化为纯 JDBC 子类。

### 1.3 代码块阅读规则

每个 Java 块均标明文件、package 和前置依赖；第 03 篇已有的 `Configuration`、`MappedStatement`、`BoundSql`、`SqlSession`、`Transaction` 直接复用，本文不重定义它们；`RowBounds`、`ResultHandler`、`PersistenceException` 与 `BaseExecutor` 在第二节引入。

文件：命令行｜package：无｜前置依赖：第 03 篇项目已可编译

```bash
mvn -q test
```

基线不通过时先修第 03 篇，避免缓存、代理和结果形状的变化掩盖原始错误。

## 二、先重构执行器：模板方法与生命周期

**为什么需要这一步：** 缓存和插件都要挂在执行器上，而第 03 篇的 `SimpleExecutor` 是一个单方法类：JDBC 准备、参数绑定、结果形状判断和资源关闭全部挤在 `execute` 里，既没有放缓存检查的位置，也没有 commit/rollback/close 生命周期。本节先做一次**不改行为**的结构重构，为后续章节腾出挂载点；重构完成后第 01～03 篇的全部测试必须原样通过，这是硬验收。

![图 2：单方法执行器到模板方法的重构](executor-template-method.svg)

重构后的分工：

| 组件 | 职责 |
| --- | --- |
| `session/RowBounds`（新增） | 逻辑分页参数，参与 CacheKey |
| `session/ResultHandler`（新增） | 逐批接收查询结果的回调接口 |
| `exceptions/PersistenceException`（新增） | 统一包装 SQLException 的运行时异常 |
| `Executor`（改写） | query/update/commit/rollback/close 五个生命周期方法 |
| `BaseExecutor`（新增） | 持有 Configuration 与 Transaction 的模板方法基类 |
| `SimpleExecutor`（改写） | 只做 JDBC 的 `doQuery`/`doUpdate` 实现 |
| `DefaultSqlSession`、`DefaultSqlSessionFactory`（改写） | Session 委托执行器生命周期；工厂预留插件包装点 |

### 2.1 RowBounds 与 ResultHandler

文件：`src/main/java/com/frank/mybatis/session/RowBounds.java`｜package：`com.frank.mybatis.session`｜前置依赖：无

```java
package com.frank.mybatis.session;

public final class RowBounds {

    public static final RowBounds DEFAULT = new RowBounds(0, Integer.MAX_VALUE);

    private final int offset;
    private final int limit;

    public RowBounds(int offset, int limit) {
        if (offset < 0 || limit < 1) {
            throw new IllegalArgumentException(
                    "invalid row bounds: " + offset + ", " + limit);
        }
        this.offset = offset;
        this.limit = limit;
    }

    public int getOffset() { return offset; }
    public int getLimit() { return limit; }
}
```

本篇不实现物理分页（把 offset/limit 翻译成 `LIMIT` 子句需要数据库方言），但 CacheKey 从现在起必须包含它们，否则第 1 页和第 2 页会互相命中。

文件：`src/main/java/com/frank/mybatis/session/ResultHandler.java`｜package：`com.frank.mybatis.session`｜前置依赖：无

```java
package com.frank.mybatis.session;

import java.util.List;

public interface ResultHandler<E> {
    void handleResult(List<E> results);
}
```

### 2.2 统一异常 PersistenceException

文件：`src/main/java/com/frank/mybatis/exceptions/PersistenceException.java`｜package：`com.frank.mybatis.exceptions`｜前置依赖：无

```java
package com.frank.mybatis.exceptions;

public class PersistenceException extends RuntimeException {

    public PersistenceException(String message) { super(message); }

    public PersistenceException(String message, Throwable cause) { super(message, cause); }
}
```

第 01～03 篇用 `IllegalStateException` 包装 JDBC 失败。本篇起统一换成 `PersistenceException`：它是"持久层失败"的语义类型，第五节的 `close()` 与第八节的插件解包都依赖能识别它。把执行器与 Session 里的旧包装点全局替换即可，异常语义不变。

### 2.3 MappedStatement 增量：resultMap 与 useCache 两个可选字段

第十章的嵌套映射与第七节的二级缓存都需要在语句元数据上挂可选配置。给第 03 篇的 `MappedStatement` 增加两个默认关闭/为空的字段，旧构造器与 `fromMapperMethod` 工厂不受影响：

文件：`src/main/java/com/frank/mybatis/mapping/MappedStatement.java`（增量）｜package：`com.frank.mybatis.mapping`｜前置依赖：本篇 `ResultMap`（第十章创建，字段先声明为可空引用）

```java
private final ResultMap resultMap;
private final boolean useCache;

public MappedStatement(String id, String namespace, SqlSource sqlSource,
                       SqlCommandType commandType, Class<?> parameterType,
                       Class<?> resultType, boolean returnsMany, Method method) {
    this(id, namespace, sqlSource, commandType, parameterType,
            resultType, returnsMany, method, null, true);
}

public MappedStatement(String id, String namespace, SqlSource sqlSource,
                       SqlCommandType commandType, Class<?> parameterType,
                       Class<?> resultType, boolean returnsMany, Method method,
                       ResultMap resultMap, boolean useCache) {
    // ……原有字段赋值保持不变，追加：
    this.resultMap = resultMap;
    this.useCache = useCache;
}

public ResultMap getResultMap() { return resultMap; }
public boolean isUseCache() { return useCache; }
```

`resultMap` 默认 `null` 表示沿用 `resultType` 简单映射，第 03 篇所有语句行为不变。

### 2.4 Executor 接口与 BaseExecutor

文件：`src/main/java/com/frank/mybatis/executor/Executor.java`（整体替换）｜package：`com.frank.mybatis.executor`｜前置依赖：`MappedStatement`、`RowBounds`、`ResultHandler`

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.session.ResultHandler;
import com.frank.mybatis.session.RowBounds;
import java.sql.SQLException;
import java.util.List;

public interface Executor {

    <E> List<E> query(MappedStatement ms, Object parameter,
                      RowBounds bounds, ResultHandler<E> handler) throws SQLException;

    int update(MappedStatement ms, Object parameter) throws SQLException;

    void commit(boolean required) throws SQLException;

    void rollback(boolean required) throws SQLException;

    void close(boolean forceRollback);
}
```

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（新增）｜package：`com.frank.mybatis.executor`｜前置依赖：`Executor`、`Configuration`、`Transaction`、`PersistenceException`

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.exceptions.PersistenceException;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.ResultHandler;
import com.frank.mybatis.session.RowBounds;
import com.frank.mybatis.transaction.Transaction;
import java.sql.SQLException;
import java.util.List;
import java.util.Objects;

public abstract class BaseExecutor implements Executor {

    protected final Configuration configuration;
    protected final Transaction transaction;

    protected BaseExecutor(Configuration configuration, Transaction transaction) {
        this.configuration = Objects.requireNonNull(configuration, "configuration");
        this.transaction = Objects.requireNonNull(transaction, "transaction");
    }

    @Override
    public <E> List<E> query(MappedStatement ms, Object parameter,
                             RowBounds bounds, ResultHandler<E> handler)
            throws SQLException {
        return doQuery(ms, parameter, bounds, handler);
    }

    @Override
    public int update(MappedStatement ms, Object parameter) throws SQLException {
        return doUpdate(ms, parameter);
    }

    @Override
    public void commit(boolean required) throws SQLException {
        if (required) {
            transaction.commit();
        }
    }

    @Override
    public void rollback(boolean required) throws SQLException {
        if (required) {
            transaction.rollback();
        }
    }

    @Override
    public void close(boolean forceRollback) {
        try {
            if (forceRollback) {
                transaction.rollback();
            }
        } catch (SQLException failure) {
            throw new PersistenceException("close executor failed", failure);
        } finally {
            transaction.close();
        }
    }

    protected abstract <E> List<E> doQuery(MappedStatement ms, Object parameter,
            RowBounds bounds, ResultHandler<E> handler) throws SQLException;

    protected abstract int doUpdate(MappedStatement ms, Object parameter)
            throws SQLException;
}
```

`query`/`update` 是稳定入口，`doQuery`/`doUpdate` 是子类扩展点；第六节会直接在 `query` 入口插入一级缓存检查，而不动 JDBC 代码。`close(true)` 的语义是"未显式提交的会话按回滚收尾"，与第 01 篇 Session 的关闭行为一致。

### 2.5 SimpleExecutor 改写为 JDBC 子类

文件：`src/main/java/com/frank/mybatis/executor/SimpleExecutor.java`（整体替换）｜package：`com.frank.mybatis.executor`｜前置依赖：`BaseExecutor`、`ParameterHandler`、`ResultSetHandler`、`BoundSql`

```java
package com.frank.mybatis.executor;

import com.frank.mybatis.mapping.BoundSql;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.mapping.SqlCommandType;
import com.frank.mybatis.session.ResultHandler;
import com.frank.mybatis.session.RowBounds;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.ArrayList;
import java.util.List;

public class SimpleExecutor extends BaseExecutor {

    private final ResultSetHandler resultHandler = new ResultSetHandler();

    public SimpleExecutor(com.frank.mybatis.session.Configuration configuration,
                          com.frank.mybatis.transaction.Transaction transaction) {
        super(configuration, transaction);
    }

    @Override
    @SuppressWarnings("unchecked")
    protected <E> List<E> doQuery(MappedStatement ms, Object parameter,
                                  RowBounds bounds, ResultHandler<E> handler)
            throws SQLException {
        if (ms.getCommandType() != SqlCommandType.SELECT) {
            throw new IllegalArgumentException("query on a DML statement: " + ms.getId());
        }
        BoundSql boundSql = ms.getSqlSource().getBoundSql(parameter);
        try (PreparedStatement statement = transaction.getConnection()
                .prepareStatement(boundSql.getSql())) {
            new ParameterHandler(configuration.getTypeHandlerRegistry())
                    .setParameters(statement, boundSql);
            try (ResultSet resultSet = statement.executeQuery()) {
                List<?> rows = resultHandler.handle(resultSet, ms.getResultType());
                List<E> result = (List<E>) trimToBounds(rows, bounds);
                if (handler != null) {
                    handler.handleResult(result);
                }
                return result;
            }
        }
    }

    @Override
    protected int doUpdate(MappedStatement ms, Object parameter) throws SQLException {
        if (ms.getCommandType() == SqlCommandType.SELECT) {
            throw new IllegalArgumentException("update on a SELECT statement: " + ms.getId());
        }
        BoundSql boundSql = ms.getSqlSource().getBoundSql(parameter);
        try (PreparedStatement statement = transaction.getConnection()
                .prepareStatement(boundSql.getSql())) {
            new ParameterHandler(configuration.getTypeHandlerRegistry())
                    .setParameters(statement, boundSql);
            return statement.executeUpdate();
        }
    }

    private static List<?> trimToBounds(List<?> rows, RowBounds bounds) {
        int fromIndex = Math.min(bounds.getOffset(), rows.size());
        int toIndex = Math.min(bounds.getOffset() + bounds.getLimit(), rows.size());
        return new ArrayList<>(rows.subList(fromIndex, toIndex));
    }
}
```

第 03 篇 `execute` 里的 JDBC 逻辑原样搬进 `doQuery`/`doUpdate`；"单查返回多行即失败"的形状检查上移到 Session（见下一小节），执行器从此只返回列表。连接改从 `transaction.getConnection()` 取，与第 03 篇语义一致。

### 2.6 Session 与工厂的对应改写

文件：`src/main/java/com/frank/mybatis/session/DefaultSqlSession.java`（整体替换）｜package：`com.frank.mybatis.session`｜前置依赖：本篇 `Executor`

```java
package com.frank.mybatis.session;

import com.frank.mybatis.exceptions.PersistenceException;
import com.frank.mybatis.executor.Executor;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.mapping.SqlCommandType;
import java.lang.reflect.Method;
import java.sql.SQLException;
import java.util.List;

public final class DefaultSqlSession implements SqlSession {

    private final Configuration configuration;
    private final Executor executor;
    private boolean closed;

    public DefaultSqlSession(Configuration configuration, Executor executor) {
        this.configuration = configuration;
        this.executor = executor;
    }

    @Override
    public <T> T selectOne(String id, Object parameter, Class<T> type) {
        MappedStatement statement = statement(id, SqlCommandType.SELECT);
        if (statement.returnsMany()) {
            throw new IllegalArgumentException("selectOne on a list statement: " + id);
        }
        List<T> rows = query(statement, parameter);
        if (rows.isEmpty()) {
            return null;
        }
        if (rows.size() > 1) {
            throw new PersistenceException("selectOne returned multiple rows: " + id);
        }
        return type.cast(rows.get(0));
    }

    @Override
    @SuppressWarnings("unchecked")
    public <T> List<T> selectList(String id, Object parameter, Class<T> type) {
        MappedStatement statement = statement(id, SqlCommandType.SELECT);
        if (!statement.returnsMany()) {
            throw new IllegalArgumentException("selectList on a single-row statement: " + id);
        }
        return (List<T>) query(statement, parameter);
    }

    @Override
    public int insert(String id, Object parameter) {
        return updateStatement(id, parameter, SqlCommandType.INSERT);
    }

    @Override
    public int update(String id, Object parameter) {
        return updateStatement(id, parameter, SqlCommandType.UPDATE);
    }

    @Override
    public int delete(String id, Object parameter) {
        return updateStatement(id, parameter, SqlCommandType.DELETE);
    }

    @Override
    public <T> T getMapper(Class<T> type) {
        requireOpen();
        return configuration.getMapperRegistry().getMapper(type, this);
    }

    @Override
    public void commit() {
        requireOpen();
        try {
            executor.commit(true);
        } catch (SQLException failure) {
            throw new PersistenceException("commit failed", failure);
        }
    }

    @Override
    public void rollback() {
        requireOpen();
        try {
            executor.rollback(true);
        } catch (SQLException failure) {
            throw new PersistenceException("rollback failed", failure);
        }
    }

    @Override
    public void close() {
        if (!closed) {
            closed = true;
            executor.close(true);
        }
    }

    private <T> List<T> query(MappedStatement statement, Object parameter) {
        requireOpen();
        try {
            return executor.query(statement, parameter, RowBounds.DEFAULT, null);
        } catch (SQLException failure) {
            throw new PersistenceException("query failed: " + statement.getId(), failure);
        }
    }

    private int updateStatement(String id, Object parameter, SqlCommandType commandType) {
        requireOpen();
        try {
            return executor.update(statement(id, commandType), parameter);
        } catch (SQLException failure) {
            throw new PersistenceException("update failed: " + id, failure);
        }
    }

    private MappedStatement statement(String id, SqlCommandType command) {
        requireOpen();
        MappedStatement statement = configuration.getMappedStatement(id);
        if (statement.getCommandType() != command) {
            throw new IllegalArgumentException("command type mismatch: " + id);
        }
        return statement;
    }

    private void requireOpen() {
        if (closed) {
            throw new IllegalStateException("SqlSession is closed");
        }
    }
}
```

`SqlSession` 接口签名与第 03 篇完全一致，Mapper 代理和第 01～03 篇的所有测试不需要任何修改。

文件：`src/main/java/com/frank/mybatis/session/DefaultSqlSessionFactory.java`（整体替换）｜package：`com.frank.mybatis.session`｜前置依赖：本篇 `Executor`、`BaseExecutor`

```java
package com.frank.mybatis.session;

import com.frank.mybatis.executor.Executor;
import com.frank.mybatis.executor.SimpleExecutor;
import com.frank.mybatis.transaction.JdbcTransaction;
import com.frank.mybatis.transaction.Transaction;

public class DefaultSqlSessionFactory implements SqlSessionFactory {

    private final Configuration configuration;

    public DefaultSqlSessionFactory(Configuration configuration) {
        this.configuration = configuration;
    }

    @Override
    public SqlSession openSession() {
        Transaction transaction = new JdbcTransaction(configuration.getDataSource());
        return new DefaultSqlSession(configuration, newExecutor(transaction));
    }

    protected Executor newExecutor(Transaction transaction) {
        return new SimpleExecutor(configuration, transaction);
    }

    protected Configuration getConfiguration() {
        return configuration;
    }
}
```

`newExecutor` 是第八节插件链的包装点；现在它只返回裸执行器。工厂从 `final class` 改为可继承的普通类，第三节测试夹具会覆写 `newExecutor` 注入计数器。

### 2.7 Configuration 增量：environmentId

CacheKey 需要区分环境（同一语句在测试库与生产库的结果不同）。给 `Configuration` 加一个环境标识：

文件：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量）｜package：`com.frank.mybatis.session`｜前置依赖：无

```java
private final String environmentId;

public Configuration(DataSource dataSource) {
    this(dataSource, "default");
}

public Configuration(DataSource dataSource, String environmentId) {
    this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    if (environmentId == null || environmentId.isBlank()) {
        throw new IllegalArgumentException("environmentId is blank");
    }
    this.environmentId = environmentId;
}

public String getEnvironmentId() { return environmentId; }
```

原有 `Configuration(DataSource)` 构造器继续可用，第 01～03 篇的测试代码不需要改。**验收**：重构完成后先跑 `mvn -q test`，全部历史测试通过再进入第三节；任何行为变化都说明重构引入了缺陷，先修复再继续。

## 三、测试数据与 chapter04 夹具

**为什么需要这一步：** 嵌套映射需要「用户-订单-明细」三层数据，而主 schema 只有 `t_user`。为实验扩主表会污染前面所有篇章的基线；把专用 schema 和夹具隔离在 chapter04 测试资源里，实验数据与主模型互不干扰。

### 3.1 嵌套实验专用 schema

文件：`src/test/resources/schema-ch04.sql`｜package：无｜前置依赖：H2、测试资源加载方式

```sql
DROP TABLE IF EXISTS t_order_item; DROP TABLE IF EXISTS t_order; DROP TABLE IF EXISTS t_user;
CREATE TABLE t_user (id BIGINT PRIMARY KEY, user_name VARCHAR(100) NOT NULL, age INTEGER);
CREATE TABLE t_order (
  id BIGINT PRIMARY KEY, user_id BIGINT NOT NULL, order_no VARCHAR(64) NOT NULL,
  CONSTRAINT fk_order_user FOREIGN KEY (user_id) REFERENCES t_user(id));
CREATE TABLE t_order_item (
  id BIGINT PRIMARY KEY, order_id BIGINT NOT NULL, sku VARCHAR(64) NOT NULL, quantity INTEGER NOT NULL,
  CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES t_order(id));
INSERT INTO t_user(id,user_name,age) VALUES (1,'Frank',30),(2,'Ada',NULL);
INSERT INTO t_order(id,user_id,order_no) VALUES (10,1,'O-001'),(11,1,'O-002'),(12,2,'O-003');
INSERT INTO t_order_item(id,order_id,sku,quantity) VALUES (100,10,'JAVA-17',2),(101,10,'H2',1);
```

该数据故意包含四个边界：用户 2 的 `age` 为 NULL；订单 10 产生两条 JOIN 行；订单 11 没有明细；用户 1 有两个订单。后面的测试分别验证 null、父去重、子集合和空子项。

### 3.2 夹具只负责数据库和会话

文件：`src/test/java/com/frank/mybatis/chapter04/Chapter04Fixture.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：第 03 篇 `Configuration`、`SqlSessionFactory`、H2

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.chapter01.UserMapper;
import com.frank.mybatis.executor.Executor;
import com.frank.mybatis.executor.SimpleExecutor;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.DefaultSqlSessionFactory;
import com.frank.mybatis.session.ResultHandler;
import com.frank.mybatis.session.RowBounds;
import com.frank.mybatis.session.SqlSession;
import com.frank.mybatis.session.SqlSessionFactory;
import com.frank.mybatis.transaction.Transaction;
import org.h2.jdbcx.JdbcDataSource;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class Chapter04Fixture implements AutoCloseable {

    private final JdbcDataSource dataSource = new JdbcDataSource();
    private final CountingExecutorFactory factory;

    public Chapter04Fixture() {
        String db = "ch04_" + UUID.randomUUID().toString().replace('-', '_');
        dataSource.setURL("jdbc:h2:mem:" + db + ";DB_CLOSE_DELAY=-1");
        dataSource.setUser("sa");
        dataSource.setPassword("");
        Configuration configuration = new Configuration(dataSource, "ch04");
        configuration.addMapper(UserMapper.class);
        factory = new CountingExecutorFactory(configuration);
    }

    public Configuration configuration() {
        return factory.getConfiguration();
    }

    public SqlSession openSession() {
        return factory.openSession();
    }

    public void reset() throws SQLException {
        try (Connection c = dataSource.getConnection(); Statement s = c.createStatement()) {
            s.execute("RUNSCRIPT FROM 'classpath:schema-ch04.sql'");
        }
    }

    /** 统计真正落到 JDBC 的查询次数：在 doQuery 层计数，缓存命中不会计入。 */
    public int selectCount(String methodName) {
        return factory.queryCounts.getOrDefault(methodName, 0);
    }

    @Override
    public void close() {
        // H2 内存库随连接池孤岛回收，无需显式删除。
    }

    /**
     * 覆写第 2.6 节工厂的 newExecutor，换成带计数器的 SimpleExecutor；
     * 第十一.4 节会在这里再串上 pluginAll。
     */
    static final class CountingExecutorFactory extends DefaultSqlSessionFactory {

        final Map<String, Integer> queryCounts = new ConcurrentHashMap<>();

        CountingExecutorFactory(Configuration configuration) {
            super(configuration);
        }

        @Override
        protected Executor newExecutor(Transaction transaction) {
            return new SimpleExecutor(getConfiguration(), transaction) {
                @Override
                protected <E> List<E> doQuery(MappedStatement ms, Object parameter,
                        RowBounds bounds, ResultHandler<E> handler) throws SQLException {
                    String id = ms.getId();
                    queryCounts.merge(id.substring(id.lastIndexOf('.') + 1), 1, Integer::sum);
                    return super.doQuery(ms, parameter, bounds, handler);
                }
            };
        }
    }
}
```

夹具只负责数据库、Configuration 装配和 `doQuery` 层计数，不复制 Mapper、Executor 或事务实现；覆写的是第 2.6 节工厂的 `newExecutor` 扩展点。

#### 章节测试约定

本篇补充的纯单元测试放在 `src/test/java/com/frank/mybatis/chapter04/CachePrimitivesTest.java`，先创建第四节给出的完整类，再把第五、七、九节方法追加进去。它不依赖 Session 工厂，可先运行 `mvn -Dtest=CachePrimitivesTest test`。插件测试使用第八节独立完整类。第一节范围与第三节 schema 由第十一节 H2 集成测试验收；第六、十节测试直接使用本节的 `Chapter04Fixture`。

注意：`selectCount` 在 `doQuery` 层统计真正落到 JDBC 的查询次数，缓存命中不会计入；放在执行器外层的插件统计的是查询调用次数，两者不能混用。`OrderMapper` 与订单 ResultMap 的注册在第十一.1 节作为构造器增量补上。

## 四、缓存基础：Cache 与 PerpetualCache

### 4.1 接口先隔离 Map

**为什么需要这一步：** 缓存不能让执行器直接依赖 `Map`。一级缓存和二级缓存需要相同的读写接口，而二级缓存还要加事务包装器。

文件：`src/main/java/com/frank/mybatis/cache/Cache.java`｜package：`com.frank.mybatis.cache`｜前置依赖：无

```java
package com.frank.mybatis.cache;

public interface Cache {
    String getId();
    void putObject(Object key, Object value);
    Object getObject(Object key);
    Object removeObject(Object key);
    void clear();
    int getSize();
}
```

`getId()` 是稳定身份，不是显示名称。namespace delegate、事务 wrapper、日志和测试都依赖它区分缓存实例。

### 4.2 最小存储实现

文件：`src/main/java/com/frank/mybatis/cache/PerpetualCache.java`｜package：`com.frank.mybatis.cache`｜前置依赖：`Cache`、Java 集合

```java
package com.frank.mybatis.cache;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;

public final class PerpetualCache implements Cache {
    private final String id;
    private final Map<Object, Object> entries = new HashMap<>();

    public PerpetualCache(String id) {
        if (id == null || id.isBlank()) {
            throw new IllegalArgumentException("cache id is blank");
        }
        this.id = id;
    }

    @Override public String getId() { return id; }

    @Override
    public void putObject(Object key, Object value) {
        entries.put(Objects.requireNonNull(key, "key"), value);
    }

    @Override public Object getObject(Object key) { return entries.get(key); }
    @Override public Object removeObject(Object key) { return entries.remove(key); }
    @Override public void clear() { entries.clear(); }
    @Override public int getSize() { return entries.size(); }
}
```

“永久”只表示不做 TTL、容量淘汰或磁盘持久化，正确性来自 update、commit、rollback、close 的清理。共享二级 delegate 若跨线程，还需并发与对象隔离测试。

#### 本节单元测试：覆盖、移除与缓存实例隔离

文件：`src/test/java/com/frank/mybatis/chapter04/CachePrimitivesTest.java`。

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.cache.*;
import com.frank.mybatis.mapping.*;
import java.util.*;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class CachePrimitivesTest {
    @Test void cacheStoresRemovesAndSeparatesInstances() {
        Cache first = new PerpetualCache("local.first");
        Cache second = new PerpetualCache("local.second");
        first.putObject("id", "old");
        first.putObject("id", "new");
        assertEquals(1, first.getSize());
        assertEquals("new", first.getObject("id"));
        assertNull(second.getObject("id"));
        assertEquals("new", first.removeObject("id"));
        assertEquals(0, first.getSize());
        first.putObject("another", List.of());
        first.clear();
        assertEquals(0, first.getSize());
        assertThrows(IllegalArgumentException.class, () -> new PerpetualCache(" "));
        assertThrows(NullPointerException.class, () -> first.putObject(null, "value"));
    }
}
```

## 五、CacheKey：把查询结果定义为有序身份

**为什么需要这一步：** 仅使用 statement id 会导致 `findById(1)` 与 `findById(2)` 互相命中；只使用 SQL 又会漏掉分页和环境。key 应包含：

![图 3：CacheKey 的有序身份](cachekey-ordered-identity.svg)

```text
statement id -> offset -> limit -> 最终 SQL -> 按问号顺序的参数 -> environment id
```

最终 SQL 必须来自 `BoundSql`，因为第 03 篇动态条件和 foreach 会改变 SQL 形状。数组参数也要按内容比较，不能按数组引用比较。

文件：`src/main/java/com/frank/mybatis/cache/CacheKey.java`｜package：`com.frank.mybatis.cache`｜前置依赖：Java 17 标准库

```java
package com.frank.mybatis.cache;

import java.lang.reflect.Array;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

public final class CacheKey {
    private int hashcode = 17;
    private long checksum;
    private int count;
    private final List<Object> values = new ArrayList<>();

    public CacheKey(Object... initialValues) {
        for (Object value : initialValues) update(value);
    }

    public void update(Object value) {
        Object normalized = normalize(value);
        int hash = normalized == null ? 1 : normalized.hashCode();
        count++;
        checksum += hash;
        hashcode = 37 * hashcode + hash * count;
        values.add(normalized);
    }

    private static Object normalize(Object value) {
        if (value == null || !value.getClass().isArray()) return value;
        int length = Array.getLength(value);
        Object[] copy = new Object[length];
        for (int i = 0; i < length; i++) copy[i] = normalize(Array.get(value, i));
        return Arrays.asList(copy);
    }

    @Override public int hashCode() { return hashcode; }

    @Override
    public boolean equals(Object other) {
        if (this == other) return true;
        if (!(other instanceof CacheKey that)) return false;
        return hashcode == that.hashcode
                && checksum == that.checksum
                && count == that.count
                && values.equals(that.values);
    }

    @Override public String toString() { return "CacheKey" + values; }
}
```

哈希只用于筛选，最终仍比较有序 `values`；日志不要输出敏感实参。

### 5.1 在已有执行器中构造 key

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（增量）｜package：`com.frank.mybatis.executor`｜前置依赖：第 03 篇 `MappedStatement`、`BoundSql`、`RowBounds`；本篇 `CacheKey`

```java
protected CacheKey createCacheKey(
        MappedStatement ms, Object parameter,
        RowBounds bounds, BoundSql boundSql) {
    CacheKey key = new CacheKey();
    key.update(ms.getId());
    key.update(bounds.getOffset());
    key.update(bounds.getLimit());
    key.update(boundSql.getSql());
    for (ParameterMapping mapping : boundSql.getParameterMappings()) {
        key.update(ParameterHandler.valueOf(boundSql, mapping.getProperty()));
    }
    key.update(configuration.getEnvironmentId());
    return key;
}
```

取值用的 `ParameterHandler.valueOf` 就是第 03 篇参数绑定的同一个函数（本篇起它从 private 改为 public），缓存 key 与 JDBC 绑定因此永远看到同一份值。不要从原始 Mapper 参数数组构造 key；动态 SQL 的参数顺序以已渲染的 BoundSql 为准。

#### 本节单元测试：有序身份和数组快照

追加到 `CachePrimitivesTest`。不要断言不同 key 的 hashCode 必然不同，哈希碰撞是允许的；必须断言 equals 能区分结果身份。

```java
@Test void cacheKeyIncludesOrderSqlPaginationAndEnvironment() {
    CacheKey key = new CacheKey("User.find", 0, 10, "select ?", 1L, "test");
    assertEquals(key, new CacheKey("User.find", 0, 10, "select ?", 1L, "test"));
    assertEquals(key.hashCode(), new CacheKey("User.find", 0, 10, "select ?", 1L, "test").hashCode());
    assertNotEquals(key, new CacheKey("User.find", 0, 10, "select ?", 2L, "test"));
    assertNotEquals(key, new CacheKey("User.find", 1, 10, "select ?", 1L, "test"));
    assertNotEquals(key, new CacheKey("User.find", 0, 20, "select ?", 1L, "test"));
    assertNotEquals(key, new CacheKey("User.find", 0, 10, "select ?,?", 1L, "test"));
    assertNotEquals(key, new CacheKey("User.find", 0, 10, "select ?", 1L, "prod"));
    assertNotEquals(new CacheKey(1L, 2L), new CacheKey(2L, 1L));
}

@Test void cacheKeyCopiesArrayContents() {
    long[] input = {3L, 1L};
    CacheKey key = new CacheKey("query", input);
    input[0] = 99L;
    assertEquals(new CacheKey("query", new long[]{3L, 1L}), key);
    assertNotEquals(new CacheKey("query", input), key);
}
```

## 六、一级缓存：Executor 的 session 私有状态

**为什么需要这一步：** 一级缓存属于一个 SqlSession，而不是 Mapper 代理、全局配置或静态字段。这样同一 session 的多个 Mapper 可共享结果，不同 session 仍能隔离自己的事务状态。

![图 4：一级缓存是 session 私有状态](l1-cache-session-scope.svg)

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（增量）｜package：`com.frank.mybatis.executor`｜前置依赖：`PerpetualCache`、`CacheKey`、第二节 `BaseExecutor`

```java
private final PerpetualCache localCache;

protected BaseExecutor(Configuration configuration, Transaction transaction) {
    this.configuration = configuration;
    this.transaction = transaction;
    this.localCache = new PerpetualCache("local." + System.identityHashCode(this));
}

@Override
public <E> List<E> query(MappedStatement ms, Object parameter,
                         RowBounds bounds, ResultHandler<E> handler)
        throws SQLException {
    BoundSql boundSql = ms.getSqlSource().getBoundSql(parameter);
    CacheKey key = createCacheKey(ms, parameter, bounds, boundSql);
    @SuppressWarnings("unchecked")
    List<E> hit = (List<E>) localCache.getObject(key);
    if (hit != null) {
        if (handler != null) handler.handleResult(hit);
        return hit;
    }
    List<E> result = doQuery(ms, parameter, bounds, handler, boundSql);
    localCache.putObject(key, result);
    return result;
}
```

回调签名就是第 2.1 节定义的 `handleResult(List<E>)`；命中缓存也必须触发回调，否则调用方会漏掉本批结果。

### 6.1 更新和会话结束都清理

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（增量）｜package：`com.frank.mybatis.executor`｜前置依赖：上一个代码块、第二节执行器生命周期

```java
@Override
public int update(MappedStatement ms, Object parameter) throws SQLException {
    clearLocalCache();
    return doUpdate(ms, parameter);
}

@Override
public void commit(boolean required) throws SQLException {
    clearLocalCache();
    if (required) transaction.commit();
}

@Override
public void rollback(boolean required) throws SQLException {
    try {
        clearLocalCache();
        if (required) transaction.rollback();
    } finally {
        discardPendingStatements();
    }
}

@Override
public void close(boolean forceRollback) {
    try {
        if (forceRollback) rollback(true);
    } catch (SQLException failure) {
        throw new PersistenceException("close executor failed", failure);
    } finally {
        localCache.clear();
        transaction.close();
    }
}

protected void clearLocalCache() { localCache.clear(); }
```

更新前清理是保守且容易审计的策略：更新失败最多导致一次额外查询，不会让同一事务继续读旧对象。`close()` 必须清理内存缓存并关闭事务资源，未提交会话按 rollback 处理。

#### 本节集成测试：相同参数命中，更新后重新查询

追加到 `CacheChapter04Test`，使用第十一节同一 `UserMapper` 和完成装配的夹具。计数发生在 `doQuery` 层（见第三节夹具），一二级缓存命中都不会计数，因此不需要为这个测试关闭 `useCache`。

```java
@Test void localCacheInvalidatesAfterUpdate() throws Exception {
    try (Chapter04Fixture fixture = new Chapter04Fixture()) {
        fixture.reset();
        try (SqlSession session = fixture.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            assertEquals("Frank", mapper.findById(1L).getUserName());
            assertEquals("Frank", mapper.findById(1L).getUserName());
            assertEquals(1, fixture.selectCount("findById"));
            mapper.rename(1L, "Changed");
            assertEquals("Changed", mapper.findById(1L).getUserName());
            assertEquals(2, fixture.selectCount("findById"));
            session.rollback();
            assertEquals("Frank", mapper.findById(1L).getUserName());
            assertEquals(3, fixture.selectCount("findById"));
        }
    }
}
```

## 七、二级缓存：TransactionalCache 不发布未提交结果

**为什么需要这一步：** 一级缓存只在一个 session 内可见。二级缓存的 delegate 按 namespace 共享，例如用户 Mapper 的所有查询共享一个 delegate。但查询结果不能直接写入 delegate：会话 A 查询后回滚时，会话 B 不应看到 A 的未提交缓存状态。

![图 5：二级缓存的事务发布边界](l2-transactional-boundary.svg)

`TransactionalCache` 是每个 executor/事务私有的 wrapper：

```text
delegate                 namespace 共享
entriesToAddOnCommit     当前事务暂存结果
entriesMissedInCache     当前事务 miss 记录
clearOnCommit            更新后的延迟清空标记
```

文件：`src/main/java/com/frank/mybatis/cache/TransactionalCache.java`｜package：`com.frank.mybatis.cache`｜前置依赖：`Cache`、Java 集合

```java
package com.frank.mybatis.cache;

import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class TransactionalCache implements Cache {
    private final Cache delegate;
    private final Map<Object, Object> entriesToAddOnCommit = new LinkedHashMap<>();
    private final Set<Object> entriesMissedInCache = new LinkedHashSet<>();
    private boolean clearOnCommit;

    public TransactionalCache(Cache delegate) {
        this.delegate = Objects.requireNonNull(delegate, "delegate");
    }

    @Override public String getId() { return delegate.getId(); }

    @Override
    public Object getObject(Object key) {
        if (entriesToAddOnCommit.containsKey(key)) {
            return entriesToAddOnCommit.get(key);
        }
        if (clearOnCommit) return null;
        Object value = delegate.getObject(key);
        if (value == null) entriesMissedInCache.add(key);
        return value;
    }

    @Override
    public void putObject(Object key, Object value) {
        entriesToAddOnCommit.put(key, value);
    }

    @Override
    public Object removeObject(Object key) {
        entriesToAddOnCommit.remove(key);
        return delegate.removeObject(key);
    }

    @Override
    public void clear() {
        clearOnCommit = true;
        entriesToAddOnCommit.clear();
    }

    @Override public int getSize() { return delegate.getSize(); }

    public void commit() {
        if (clearOnCommit) delegate.clear();
        for (Object key : entriesMissedInCache) delegate.removeObject(key);
        for (Map.Entry<Object, Object> entry : entriesToAddOnCommit.entrySet()) {
            delegate.putObject(entry.getKey(), entry.getValue());
        }
        reset();
    }

    public void rollback() { reset(); }

    private void reset() {
        clearOnCommit = false;
        entriesToAddOnCommit.clear();
        entriesMissedInCache.clear();
    }
}
```

`clear()` 只能标记，不能立刻清 delegate。否则 A 更新后 rollback，仍会错误删除 B 已提交的缓存。commit 的顺序是清旧 namespace、删 miss 时可能留下的旧值、发布 pending、重置 wrapper；rollback 只重置 wrapper。

### 7.1 Configuration 持有共享 delegate

文件：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量）｜package：`com.frank.mybatis.session`｜前置依赖：`Cache`、`PerpetualCache`、已有 Configuration

```java
private final Map<String, Cache> caches = new ConcurrentHashMap<>();

public Cache getOrCreateCache(String namespace) {
    return caches.computeIfAbsent(namespace,
            key -> new PerpetualCache("namespace." + key));
}
```

完整 statement id 不能作为二级 cache id。`updateUser` 会影响 `findById`、`findAll` 和其他用户查询，故失效粒度至少是 namespace。

### 7.2 在已有 Executor 增加二级协调

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（增量）｜package：`com.frank.mybatis.executor`｜前置依赖：`TransactionalCache`、`Configuration.getOrCreateCache`、已有 Executor 生命周期

```java
private final Map<String, TransactionalCache> transactionalCaches = new LinkedHashMap<>();

private TransactionalCache secondLevelCache(MappedStatement ms) {
    Cache delegate = configuration.getOrCreateCache(ms.getNamespace());
    return transactionalCaches.computeIfAbsent(delegate.getId(),
            ignored -> new TransactionalCache(delegate));
}

private void clearSecondLevelCache(String namespace) {
    TransactionalCache cache = transactionalCaches.get("namespace." + namespace);
    if (cache != null) cache.clear();
}
```

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（query/update/事务增量）｜package：`com.frank.mybatis.executor`｜前置依赖：上一个代码块、一级缓存 query

```java
private <E> List<E> querySecondLevel(MappedStatement ms, Object parameter,
                                     RowBounds bounds, ResultHandler<E> handler)
        throws SQLException {
    if (!ms.isUseCache()) return queryLocal(ms, parameter, bounds, handler);
    BoundSql boundSql = ms.getSqlSource().getBoundSql(parameter);
    CacheKey key = createCacheKey(ms, parameter, bounds, boundSql);
    TransactionalCache cache = secondLevelCache(ms);
    @SuppressWarnings("unchecked")
    List<E> hit = (List<E>) cache.getObject(key);
    if (hit != null) return hit;
    List<E> result = queryLocal(ms, parameter, bounds, handler);
    cache.putObject(key, result);
    return result;
}

@Override
public int update(MappedStatement ms, Object parameter) throws SQLException {
    clearLocalCache();
    clearSecondLevelCache(ms.getNamespace());
    return doUpdate(ms, parameter);
}

private void commitSecondLevelCaches() {
    transactionalCaches.values().forEach(TransactionalCache::commit);
}

private void rollbackSecondLevelCaches() {
    transactionalCaches.values().forEach(TransactionalCache::rollback);
}

@Override
public void commit(boolean required) throws SQLException {
    if (required) {
        transaction.commit();
    }
    commitSecondLevelCaches();
}

@Override
public void rollback(boolean required) throws SQLException {
    try {
        if (required) {
            transaction.rollback();
        }
    } finally {
        rollbackSecondLevelCaches();
    }
}

@Override
public void close(boolean forceRollback) {
    try {
        if (forceRollback) {
            rollback(true);
        }
    } catch (SQLException failure) {
        throw new PersistenceException("close executor failed", failure);
    } finally {
        localCache.clear();
        transaction.close();
    }
}
```

这一步把第六节的 `query` 主体抽成私有 `queryLocal`：`Executor.query` 的对外入口先走二级缓存（判断 `useCache` 与事务 wrapper），miss 后交给 `queryLocal` 处理一级缓存与 `doQuery`。`commit` 必须先完成数据库事务，再调用 `commitSecondLevelCaches()`；rollback 和 close 的 finally 块必须调用 `rollbackSecondLevelCaches()`。JDBC rollback 不会替你清除 Java pending。

### 7.3 更新清理与关联 namespace

按 namespace 清理不是删除 update 语句的 key；更新用户也会影响列表、分页和订单 JOIN 的 owner association。

若 `t_order` 查询映射了 `t_user`，在 MappedStatement 的已有元数据中增加 `flushNamespaces`，更新时同时标记 wrapper：

文件：`src/main/java/com/frank/mybatis/executor/BaseExecutor.java`（增量）｜package：`com.frank.mybatis.executor`｜前置依赖：已有 `MappedStatement.getFlushNamespaces()`

```java
private void clearSecondLevelCaches(MappedStatement ms) {
    clearSecondLevelCache(ms.getNamespace());
    for (String namespace : ms.getFlushNamespaces()) {
        clearSecondLevelCache(namespace);
    }
}
```

测试可以只配置用户和订单两个 namespace；生产实现应让 XML/注解解析阶段明确注册依赖，不能靠数据库触发器或 SQL 文本猜失效范围。

#### 本节单元测试：提交发布、回滚丢弃与延迟失效

追加到 `CachePrimitivesTest`。前两个方法验证基础生命周期，第三个固定当前事务更新后的缓存可见性。

```java
@Test void transactionalCachePublishesOnlyOnCommit() {
    Cache delegate = new PerpetualCache("users");
    var writer = new TransactionalCache(delegate);
    var reader = new TransactionalCache(delegate);
    writer.putObject("id", "pending");
    assertNull(delegate.getObject("id"));
    assertNull(reader.getObject("id"));
    writer.commit();
    assertEquals("pending", delegate.getObject("id"));
    writer.putObject("id", "discarded");
    writer.rollback();
    assertEquals("pending", writer.getObject("id"));
}

@Test void rollbackOfClearPreservesCommittedDelegate() {
    Cache delegate = new PerpetualCache("users");
    delegate.putObject("id", "committed");
    var tx = new TransactionalCache(delegate);
    tx.clear();
    assertEquals("committed", delegate.getObject("id"));
    tx.rollback();
    assertEquals("committed", tx.getObject("id"));
    tx.clear();
    tx.putObject("id", "updated");
    tx.commit();
    assertEquals("updated", delegate.getObject("id"));
}

@Test void clearHidesOldDelegateFromCurrentTransaction() {
    Cache delegate = new PerpetualCache("users");
    delegate.putObject("id", "old");
    var tx = new TransactionalCache(delegate);
    tx.clear();
    assertNull(tx.getObject("id"));
    assertEquals("old", delegate.getObject("id"));
}
```

最后一个测试可复现 `getObject` 不检查 `clearOnCommit` 时的旧值泄漏；上面的实现已加入这一判断：先查 pending，再在 `clearOnCommit` 为 true 时屏蔽旧 delegate。其他事务仍可读取已提交的 delegate。另一个接入边界由第 11.3 节“写会话未先查询就更新”的测试验证：失效逻辑不能只清理当前已经存在的 wrapper。

## 八、插件：精确签名，而不是按方法名猜测

**为什么需要这一步：** 日志、计数、SQL 改写这类横切需求不该侵入框架核心。插件用 JDK 动态代理包装接口实现。每个 Interceptor 声明一个精确 Signature：接口类型、方法名、完整参数类型。只拦截声明的方法，其他方法原样转发。

### 8.1 Signature

文件：`src/main/java/com/frank/mybatis/plugin/Signature.java`｜package：`com.frank.mybatis.plugin`｜前置依赖：Java 注解

```java
package com.frank.mybatis.plugin;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.TYPE)
public @interface Signature {
    Class<?> type();
    String method();
    Class<?>[] args() default {};
}
```

本教程的最小实现一个插件只声明一个签名。要支持多签名时再增加容器注解，不要先引入一套没有测试覆盖的注解模型。

### 8.2 Invocation

文件：`src/main/java/com/frank/mybatis/plugin/Invocation.java`｜package：`com.frank.mybatis.plugin`｜前置依赖：Java 反射

```java
package com.frank.mybatis.plugin;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

public final class Invocation {
    private final Object target;
    private final Method method;
    private final Object[] args;

    public Invocation(Object target, Method method, Object[] args) {
        this.target = target;
        this.method = method;
        this.args = args == null ? new Object[0] : args.clone();
    }

    public Object getTarget() { return target; }
    public Method getMethod() { return method; }
    public Object[] getArgs() { return args.clone(); }

    public Object proceed() throws Throwable {
        try {
            return method.invoke(target, args);
        } catch (InvocationTargetException failure) {
            throw failure.getCause();
        }
    }
}
```

必须解包 `InvocationTargetException`。否则 JDBC 或业务异常被额外包装，无法被第 03 篇统一异常策略正确识别。

### 8.3 Interceptor

文件：`src/main/java/com/frank/mybatis/plugin/Interceptor.java`｜package：`com.frank.mybatis.plugin`｜前置依赖：`Invocation`、`Plugin`

```java
package com.frank.mybatis.plugin;

import java.util.Properties;

public interface Interceptor {
    Object intercept(Invocation invocation) throws Throwable;

    default Object plugin(Object target) {
        return Plugin.wrap(target, this);
    }

    default void setProperties(Properties properties) { }
}
```

普通插件必须调用 `proceed()`；只有明确实现短路缓存、拒绝访问等语义时才可以不调用，并必须有专门测试。

### 8.4 Plugin：启动期验证签名

文件：`src/main/java/com/frank/mybatis/plugin/Plugin.java`｜package：`com.frank.mybatis.plugin`｜前置依赖：`Signature`、`Interceptor`、`Invocation`

```java
package com.frank.mybatis.plugin;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.lang.reflect.Proxy;

public final class Plugin implements InvocationHandler {
    private final Object target;
    private final Interceptor interceptor;
    private final Method signature;

    private Plugin(Object target, Interceptor interceptor, Method signature) {
        this.target = target;
        this.interceptor = interceptor;
        this.signature = signature;
    }

    public static Object wrap(Object target, Interceptor interceptor) {
        Signature annotation = interceptor.getClass().getAnnotation(Signature.class);
        if (annotation == null) {
            throw new PluginException("missing @Signature: "
                    + interceptor.getClass().getName());
        }
        if (!annotation.type().isInterface()) {
            throw new PluginException("signature type must be interface");
        }
        final Method method;
        try {
            method = annotation.type().getMethod(annotation.method(), annotation.args());
        } catch (NoSuchMethodException failure) {
            throw new PluginException("invalid signature: "
                    + annotation.type().getName() + '#' + annotation.method(), failure);
        }
        if (!annotation.type().isAssignableFrom(target.getClass())) return target;
        return Proxy.newProxyInstance(target.getClass().getClassLoader(),
                new Class<?>[]{annotation.type()},
                new Plugin(target, interceptor, method));
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] args) throws Throwable {
        if (signature.equals(method)) {
            return interceptor.intercept(new Invocation(target, method, args));
        }
        return method.invoke(target, args);
    }
}
```

文件：`src/main/java/com/frank/mybatis/plugin/PluginException.java`（若已有框架异常可复用）｜package：`com.frank.mybatis.plugin`｜前置依赖：Java 标准库

```java
package com.frank.mybatis.plugin;

public final class PluginException extends RuntimeException {
    public PluginException(String message) { super(message); }
    public PluginException(String message, Throwable cause) { super(message, cause); }
}
```

签名校验有四层：注解存在、类型是接口、`getMethod` 精确找得到方法、target 实现该接口。不能只按方法名比较，因为 `Executor.query` 可能重载；也不能把实现类写进 `type`，JDK Proxy 只能代理接口。

### 8.5 注册链与包装位置

文件：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量）｜package：`com.frank.mybatis.session`｜前置依赖：`Interceptor`、Java 集合、已有 Configuration

```java
private final List<Interceptor> interceptors = new ArrayList<>();

public void addInterceptor(Interceptor interceptor) {
    interceptors.add(Objects.requireNonNull(interceptor));
}

public Object pluginAll(Object target) {
    Object current = target;
    for (Interceptor interceptor : interceptors) {
        current = interceptor.plugin(current);
    }
    return current;
}
```

注册 A、B 后，`pluginAll` 的调用顺序为：

```text
B.before -> A.before -> target -> A.after -> B.after
```

文件：`src/main/java/com/frank/mybatis/session/DefaultSqlSessionFactory.java`（增量）｜package：`com.frank.mybatis.session`｜前置依赖：已有 executor 创建逻辑、`Configuration.pluginAll`

```java
@Override
protected Executor newExecutor(Transaction transaction) {
    return (Executor) configuration.pluginAll(
            new SimpleExecutor(configuration, transaction));
}
```

把插件装在一级、二级缓存协调后的 Executor 外层，插件可以观测命中与 miss；装在 JDBC Executor 外层则只能观测真实 SQL。选一种并用测试固定，不能在不同工厂路径中随意改变顺序。

#### 本节单元测试：完整插件夹具与包装顺序

文件：`src/test/java/com/frank/mybatis/chapter04/PluginContractTest.java`。利用 JDK 已有 public `Supplier` 接口作为目标，避免引入未给出的 Target 类；两份插件实例分别代表 A、B。

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.plugin.*;
import java.util.*;
import java.util.function.Supplier;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

@Signature(type = Supplier.class, method = "get")
class TraceInterceptor implements Interceptor {
    private final String name;
    private final List<String> events;
    TraceInterceptor(String name, List<String> events) {
        this.name = name;
        this.events = events;
    }
    public Object intercept(Invocation invocation) throws Throwable {
        events.add(name + ".before");
        try { return invocation.proceed(); }
        finally { events.add(name + ".after"); }
    }
}

class PluginContractTest {
    @Test void lastWrappedPluginRunsFirst() {
        List<String> events = new ArrayList<>();
        Supplier<String> target = () -> { events.add("target"); return "ok"; };
        var a = new TraceInterceptor("A", events);
        var b = new TraceInterceptor("B", events);
        Supplier<?> proxy = (Supplier<?>) b.plugin(a.plugin(target));
        assertEquals("ok", proxy.get());
        assertEquals(List.of("B.before", "A.before", "target", "A.after", "B.after"), events);
        events.clear();
        proxy.toString();
        assertTrue(events.isEmpty());
        assertSame("unrelated", a.plugin("unrelated"));
        assertThrows(PluginException.class, () -> Plugin.wrap(target, invocation -> invocation.proceed()));
    }
    @Test void invocationUnwrapsOriginalFailure() throws Exception {
        var original = new IllegalStateException("business failure");
        Supplier<String> target = () -> { throw original; };
        var invocation = new Invocation(target, Supplier.class.getMethod("get"), null);
        assertSame(original, assertThrows(IllegalStateException.class, invocation::proceed));
    }
}
```

按本节 `pluginAll` 的正序循环注册 A、B，实际包装为 `B(A(target))`，因此预期顺序是 B 先进入、A 先退出。以此断言为准；若希望 A 先进入，需要明确改为逆序包装并同步修改测试。

## 九、ResultMapping 与 ResultMap

**为什么需要这一步：** JOIN 场景中 `t_order.id`、`t_order_item.id`、`t_user.id` 会同时出现。自动下划线转驼峰无法区分这些列，所以 SQL 必须用别名，映射必须声明属性、列、Java 类型和 id 标志。

### 9.1 ResultMapping

文件：`src/main/java/com/frank/mybatis/mapping/ResultMapping.java`｜package：`com.frank.mybatis.mapping`｜前置依赖：Java 17 record

```java
package com.frank.mybatis.mapping;

import java.util.Objects;

public record ResultMapping(
        String property, String column, Class<?> javaType, boolean id) {
    public ResultMapping {
        if (property == null || property.isBlank()) {
            throw new IllegalArgumentException("result property is blank");
        }
        if (column == null || column.isBlank()) {
            throw new IllegalArgumentException("result column is blank");
        }
        javaType = Objects.requireNonNull(javaType, "javaType");
    }
}
```

父 map 与子 map 都必须至少有一个 `id=true`。没有 id 时用普通列拼 key，既会让不同对象误合并，也会让同一对象的列变化产生重复。

### 9.2 ResultMap

文件：`src/main/java/com/frank/mybatis/mapping/ResultMap.java`｜package：`com.frank.mybatis.mapping`｜前置依赖：`ResultMapping`、Java 集合

```java
package com.frank.mybatis.mapping;

import java.util.List;
import java.util.Objects;

public final class ResultMap {
    public enum NestedKind { ASSOCIATION, COLLECTION }

    public record Nested(String property, ResultMap resultMap,
                         NestedKind kind, Class<?> javaType) {
        public Nested {
            if (property == null || property.isBlank()) {
                throw new IllegalArgumentException("nested property is blank");
            }
            Objects.requireNonNull(resultMap, "resultMap");
            Objects.requireNonNull(kind, "kind");
            Objects.requireNonNull(javaType, "javaType");
        }
    }

    private final String id;
    private final Class<?> type;
    private final List<ResultMapping> mappings;
    private final List<Nested> nested;

    public ResultMap(String id, Class<?> type,
                     List<ResultMapping> mappings, List<Nested> nested) {
        this.id = Objects.requireNonNull(id, "id");
        this.type = Objects.requireNonNull(type, "type");
        this.mappings = List.copyOf(mappings);
        this.nested = List.copyOf(nested);
    }

    public String id() { return id; }
    public Class<?> type() { return type; }
    public List<ResultMapping> mappings() { return mappings; }
    public List<Nested> nested() { return nested; }
    public List<ResultMapping> idMappings() {
        return mappings.stream().filter(ResultMapping::id).toList();
    }
}
```

`ASSOCIATION` 表示单值属性，`COLLECTION` 表示多值属性。初版只处理一层嵌套，避免尚未设计循环检测时贸然递归；多层映射需要为每一层维护独立父子 key 上下文。

#### 本节单元测试：id 列筛选与元数据防御性复制

追加到 `CachePrimitivesTest`，无需订单实体，`Object.class` 这里只是类型元数据，不进行实例映射。

```java
@Test void resultMapCopiesMappingsAndSelectsIdentityColumns() {
    var id = new ResultMapping("id", "order_id", Long.class, true);
    var name = new ResultMapping("name", "order_no", String.class, false);
    var mappings = new ArrayList<>(List.of(id, name));
    var map = new ResultMap("order", Object.class, mappings, List.of());
    mappings.clear();
    assertEquals(List.of(id, name), map.mappings());
    assertEquals(List.of(id), map.idMappings());
    assertThrows(UnsupportedOperationException.class, () -> map.mappings().clear());
    assertThrows(IllegalArgumentException.class,
            () -> new ResultMapping(" ", "id", Long.class, true));
    assertThrows(IllegalArgumentException.class,
            () -> new ResultMapping("id", " ", Long.class, true));
}
```

## 十、改造 ResultSetHandler：从行映射到对象图

**为什么需要这一步：** 「一行结果映射一个对象」的假设在 JOIN 下失效——父行会重复出现，LEFT JOIN 会造出全 null 的假子对象。结果处理要从逐行映射升级成按身份折叠对象图，这正是 ResultMap 存在的理由。

![图 6：JOIN 行折叠为对象图](join-fold-object-graph.svg)

保留第 03 篇的简单 `resultType` 映射。只有 MappedStatement 绑定了有 nested 的 ResultMap 时才进入本节路径。

文件：`src/main/java/com/frank/mybatis/executor/ResultSetHandler.java`（已有文件增量入口）｜package：`com.frank.mybatis.executor`｜前置依赖：`ResultMap`、`MappedStatement`、第 03 篇简单映射

```java
public <E> List<E> handleResultSets(ResultSet rs, MappedStatement ms)
        throws SQLException {
    ResultMap map = ms.getResultMap();
    if (map == null || map.nested().isEmpty()) {
        return handleSimpleResultSet(rs, ms);
    }
    return handleNestedResultSet(rs, map);
}
```

`getResultMap()` 字段已在第 2.3 节预留：默认 `null` 走原来的 `resultType` 路径，所以第 03 篇的 `t_user` 测试不需要重写。`handleSimpleResultSet` 直接委托第 01 篇的列名映射方法 `handle`：

```java
private <E> List<E> handleSimpleResultSet(ResultSet rs, MappedStatement ms)
        throws SQLException {
    return handle(rs, ms.getResultType());
}
```

同时把 `SimpleExecutor.doQuery` 里对 `resultHandler.handle(resultSet, ms.getResultType())` 的调用改为 `resultHandler.handleResultSets(resultSet, ms)`——一行改动，两条路径在此分岔。

### 10.1 先定义父子 key 和空子项判断

文件：`src/main/java/com/frank/mybatis/executor/ResultSetHandler.java`（辅助方法）｜package：`com.frank.mybatis.executor`｜前置依赖：`CacheKey`、`ResultMap`、`ResultMapping`

```java
private CacheKey rowKey(ResultSet rs, ResultMap map) throws SQLException {
    CacheKey key = new CacheKey();
    key.update(map.id());
    for (ResultMapping mapping : map.idMappings()) {
        key.update(rs.getObject(mapping.column()));
    }
    return key;
}

private boolean hasIdentity(ResultSet rs, ResultMap map) throws SQLException {
    for (ResultMapping mapping : map.idMappings()) {
        if (rs.getObject(mapping.column()) != null) return true;
    }
    return false;
}
```

父 key 只用父 id，子 key 只用子 id。若把 `item_id` 放进父 key，订单 10 的两条 JOIN 行就会被错误创建成两个 Order。`hasIdentity` 是 LEFT JOIN 的关键：子 id 为 null 时，不创建空 OrderItem。

### 10.2 复用现有转换与反射赋值

文件：`src/main/java/com/frank/mybatis/executor/ResultSetHandler.java`（辅助方法）｜package：`com.frank.mybatis.executor`｜前置依赖：`ResultMap`、JDK 反射与 Introspector

```java
private <T> T mapSimple(ResultSet rs, ResultMap map) throws SQLException {
    T target = instantiate(map.type());
    for (ResultMapping mapping : map.mappings()) {
        Object raw = rs.getObject(mapping.column());
        Object value = raw == null ? null : convert(raw, mapping.javaType());
        setProperty(target, mapping.property(), value);
    }
    return target;
}
```

第 01 篇的 `ResultSetHandler` 只有按列名给字段赋值的主流程，嵌套映射还需要四个反射小助手和一个数值转换器：

```java
private <T> T instantiate(Class<T> type) throws SQLException {
    try {
        var constructor = type.getDeclaredConstructor();
        constructor.setAccessible(true);
        return constructor.newInstance();
    } catch (ReflectiveOperationException failure) {
        throw new SQLException("cannot instantiate " + type.getName(), failure);
    }
}

private static void setProperty(Object target, String property, Object value)
        throws SQLException {
    try {
        var setter = setterOf(target.getClass(), property);
        if (setter == null) {
            throw new SQLException("no setter for property " + property
                    + " on " + target.getClass().getName());
        }
        setter.invoke(target, value);
    } catch (ReflectiveOperationException failure) {
        throw new SQLException("cannot set property " + property, failure);
    }
}

private static Object getProperty(Object target, String property) throws SQLException {
    try {
        for (var descriptor : java.beans.Introspector.getBeanInfo(
                target.getClass(), Object.class).getPropertyDescriptors()) {
            if (descriptor.getName().equals(property)) {
                return descriptor.getReadMethod().invoke(target);
            }
        }
    } catch (ReflectiveOperationException | java.beans.IntrospectionException failure) {
        throw new SQLException("cannot read property " + property, failure);
    }
    throw new SQLException("no getter for property " + property
            + " on " + target.getClass().getName());
}

private static Method setterOf(Class<?> type, String property) throws SQLException {
    try {
        for (var descriptor : java.beans.Introspector.getBeanInfo(
                type, Object.class).getPropertyDescriptors()) {
            if (descriptor.getName().equals(property)) {
                return descriptor.getWriteMethod();
            }
        }
    } catch (java.beans.IntrospectionException failure) {
        throw new SQLException("cannot inspect " + type.getName(), failure);
    }
    return null;
}

private static Object convert(Object raw, Class<?> javaType) {
    if (raw == null || javaType.isInstance(raw)) {
        return raw;
    }
    if (raw instanceof Number number) {
        if (javaType == Integer.class || javaType == int.class) return number.intValue();
        if (javaType == Long.class || javaType == long.class) return number.longValue();
        if (javaType == Double.class || javaType == double.class) return number.doubleValue();
    }
    throw new IllegalArgumentException("cannot convert "
            + raw.getClass().getName() + " to " + javaType.getName());
}
```

使用 `getObject` 后再转换可保留 SQL NULL。若继续使用 `getInt`，必须检查 `wasNull()`；否则用户 2 的 age 会被错误映射为 0。`convert` 只做同类型透传与 Number 拆箱，故意不实现字符串到数字的魔法转换——读不明白的数据应该失败，而不是悄悄变成 0。

### 10.3 JOIN 折叠、collection 去重和 association 单值

文件：`src/main/java/com/frank/mybatis/executor/ResultSetHandler.java`（核心增量）｜package：`com.frank.mybatis.executor`｜前置依赖：本节前两个方法、已有属性读写器

```java
private <E> List<E> handleNestedResultSet(ResultSet rs, ResultMap root)
        throws SQLException {
    List<E> result = new ArrayList<>();
    Map<CacheKey, Object> parents = new LinkedHashMap<>();
    Map<CacheKey, Set<CacheKey>> seenChildren = new HashMap<>();

    while (rs.next()) {
        CacheKey parentKey = rowKey(rs, root);
        @SuppressWarnings("unchecked")
        E parent = (E) parents.get(parentKey);
        if (parent == null) {
            parent = mapSimple(rs, root);
            initializeNested(parent, root);
            parents.put(parentKey, parent);
            seenChildren.put(parentKey, new HashSet<>());
            result.add(parent);
        }

        for (ResultMap.Nested nested : root.nested()) {
            ResultMap childMap = nested.resultMap();
            if (!hasIdentity(rs, childMap)) continue;
            CacheKey childKey = rowKey(rs, childMap);
            if (!seenChildren.get(parentKey).add(childKey)) continue;
            Object child = mapSimple(rs, childMap);
            attach(parent, nested, child);
        }
    }
    return result;
}

private void initializeNested(Object parent, ResultMap map) {
    for (ResultMap.Nested nested : map.nested()) {
        setProperty(parent, nested.property(),
                nested.kind() == ResultMap.NestedKind.COLLECTION
                        ? new ArrayList<>() : null);
    }
}

@SuppressWarnings("unchecked")
private void attach(Object parent, ResultMap.Nested nested, Object child) {
    if (nested.kind() == ResultMap.NestedKind.ASSOCIATION) {
        setProperty(parent, nested.property(), child);
        return;
    }
    ((List<Object>) getProperty(parent, nested.property())).add(child);
}
```

三层保护分别是：`parents` 去重父对象，`seenChildren` 在同一父对象中去重子对象，`hasIdentity` 跳过 LEFT JOIN 的空子项。association 应只有一个子对象；若同一父行出现不同 association key，生产实现应抛出映射异常，不要静默以最后一行覆盖第一行。

#### 本节集成测试：父子身份与空集合

追加到第十一节 `NestedMappingChapter04Test`，前置依赖为已经注册的 `OrderMapper` 和 `NestedMaps.orderWithItems()`。第 11.5 节已有行数断言，本测试进一步核对每个子对象的身份与归属，避免“数量正确、对象重复”漏检。

```java
@Test void nestedChildrenKeepTheirIdentityAndParent() throws Exception {
    try (Chapter04Fixture fixture = new Chapter04Fixture()) {
        fixture.reset();
        try (SqlSession session = fixture.openSession()) {
            List<Order> orders = session.getMapper(OrderMapper.class).findByUserId(1L);
            assertEquals(List.of(10L, 11L), orders.stream().map(Order::getId).toList());
            assertEquals(List.of(100L, 101L), orders.get(0).getItems().stream()
                    .map(OrderItem::getId).toList());
            assertTrue(orders.get(0).getItems().stream()
                    .allMatch(item -> Long.valueOf(10L).equals(item.getOrderId())));
            assertNotSame(orders.get(0).getItems(), orders.get(1).getItems());
            assertTrue(orders.get(1).getItems().isEmpty());
            assertTrue(session.getMapper(OrderMapper.class).findByUserId(999L).isEmpty());
        }
    }
}
```

## 十一、chapter04 的 ResultMap、Mapper 与测试

**为什么需要这一步：** ResultMap、插件、缓存到此都还是纯组件，只有接进真实的 Mapper 与 H2 数据，JOIN 折叠、缓存失效、插件链这些承诺才可验证。测试模型放 chapter04 测试包，不进生产模型。

### 11.1 测试模型和 ResultMap

测试模型可放在 `com.frank.mybatis.chapter04`，不要因为实验订单表把 Order 加到当前生产用户模型。

文件：`src/test/java/com/frank/mybatis/chapter04/Order.java`、`OrderItem.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：第 03 篇 `User`

两个测试 POJO 使用 public 无参构造器与普通 setter：`Order` 有 `id`、`userId`、`orderNo`、单值 `User owner` 和初始化为空的 `List<OrderItem> items`；`OrderItem` 有 `id`、`orderId`、`sku`、`quantity`。它们只属于 chapter04，不能加入当前生产用户模型。

文件：`src/test/java/com/frank/mybatis/chapter04/NestedMaps.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：`ResultMap`、`ResultMapping`、`Order`、`OrderItem`

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.mapping.ResultMap;
import com.frank.mybatis.mapping.ResultMapping;
import java.util.List;

public final class NestedMaps {
    private NestedMaps() { }

    public static ResultMap orderWithItems() {
        ResultMap item = new ResultMap("ch04.item", OrderItem.class, List.of(
                new ResultMapping("id", "item_id", Long.class, true),
                new ResultMapping("orderId", "item_order_id", Long.class, false),
                new ResultMapping("sku", "item_sku", String.class, false),
                new ResultMapping("quantity", "item_quantity", Integer.class, false)), List.of());
        return new ResultMap("ch04.order", Order.class, List.of(
                new ResultMapping("id", "order_id", Long.class, true),
                new ResultMapping("userId", "order_user_id", Long.class, false),
                new ResultMapping("orderNo", "order_no", String.class, false)),
                List.of(new ResultMap.Nested("items", item,
                        ResultMap.NestedKind.COLLECTION, OrderItem.class)));
    }
}
```

ResultMap 是纯 Java 元数据，还需要一条把它挂到语句上的线：`@ResultMap` 注解引用注册表中的 id，注解构建器据此改用 10 参构造器。

文件：`src/main/java/com/frank/mybatis/annotations/ResultMap.java`（新增）｜package：`com.frank.mybatis.annotations`｜前置依赖：无

```java
package com.frank.mybatis.annotations;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

@Retention(RetentionPolicy.RUNTIME)
@Target(ElementType.METHOD)
public @interface ResultMap {
    String value();
}
```

文件：`src/main/java/com/frank/mybatis/session/Configuration.java`（增量）｜package：`com.frank.mybatis.session`｜前置依赖：本节 `ResultMap`

```java
private final Map<String, ResultMap> resultMaps = new HashMap<>();

public void addResultMap(String id, ResultMap resultMap) {
    if (resultMaps.putIfAbsent(id, resultMap) != null) {
        throw new IllegalStateException("Duplicate resultMap id: " + id);
    }
}

public ResultMap getResultMap(String id) {
    ResultMap map = resultMaps.get(id);
    if (map == null) {
        throw new IllegalArgumentException("Unknown resultMap id: " + id);
    }
    return map;
}
```

文件：`src/main/java/com/frank/mybatis/builder/MapperAnnotationBuilder.java`（替换 statement 构建片段）｜package：`com.frank.mybatis.builder`｜前置依赖：`ResultMap` 注解、`Configuration.getResultMap`

```java
SqlDefinition definition = definitionOf(method);
SqlSource sqlSource = XMLScriptBuilder.parseText(
        definition.sql(), configuration.getSqlWhitelist());
MappedStatement statement;
if (method.isAnnotationPresent(ResultMap.class)) {
    ResultMap resultMap = configuration.getResultMap(
            method.getAnnotation(ResultMap.class).value());
    statement = new MappedStatement(id, mapperType.getName(), sqlSource,
            definition.commandType(), Object.class, resultMap.type(),
            method.getReturnType() == List.class, method, resultMap, true);
} else {
    statement = MappedStatement.fromMapperMethod(
            id, mapperType.getName(), sqlSource, definition.commandType(), method);
}
parsed.put(id, statement);
```

最后给第三节夹具的构造器追加两行，让 chapter04 测试能拿到订单映射：

```java
configuration.addMapper(OrderMapper.class);
configuration.addResultMap("ch04.order", NestedMaps.orderWithItems());
```

未标注 `@ResultMap` 的语句完全不受影响，仍走 `fromMapperMethod` 的 resultType 路径。

### 11.2 SQL 必须使用列别名

文件：`src/test/java/com/frank/mybatis/chapter04/OrderMapper.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：第 03 篇 `@Select`、`Order`、注册的 ResultMap

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.annotations.Select;
import java.util.List;

public interface OrderMapper {
    @Select("""
        SELECT o.id AS order_id, o.user_id AS order_user_id, o.order_no,
               i.id AS item_id, i.order_id AS item_order_id,
               i.sku AS item_sku, i.quantity AS item_quantity
        FROM t_order o
        LEFT JOIN t_order_item i ON i.order_id = o.id
        WHERE o.user_id = #{_parameter}
        ORDER BY o.id, i.id
        """)
    List<Order> findByUserId(Long userId);
}
```

`order_id` 与 `item_id` 是 ResultMap 契约。不能写 `select o.*, i.*` 再期待驱动稳定地区分重复列名。

`findByUserId` 是无 `@Param` 的单参数方法，`ParamNameResolver` 会把 `Long` 原样作为根对象，标量只能用 `_parameter` 引用（第 03 篇 10.1 节）。给参数加上 `@Param("userId")` 后就可以改写成 `#{userId}`；两种写法不要混用。

### 11.3 一级、二级缓存测试

文件：`src/test/java/com/frank/mybatis/chapter04/CacheChapter04Test.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：`Chapter04Fixture`、第 01 篇 `chapter01.UserMapper`（夹具已注册）

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.chapter01.UserMapper;
import com.frank.mybatis.session.SqlSession;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;

class CacheChapter04Test {
    @Test
    void sameSessionHitsFirstLevelCache() throws Exception {
        try (Chapter04Fixture fixture = new Chapter04Fixture()) {
            fixture.reset();
            try (SqlSession session = fixture.openSession()) {
                UserMapper mapper = session.getMapper(UserMapper.class);
                mapper.findById(1L);
                mapper.findById(1L);
                assertEquals(1, fixture.selectCount("findById"));
            }
        }
    }

    @Test
    void rollbackDoesNotPublishSecondLevelCache() throws Exception {
        try (Chapter04Fixture fixture = new Chapter04Fixture()) {
            fixture.reset();
            try (SqlSession first = fixture.openSession()) {
                first.getMapper(UserMapper.class).findById(1L);
                first.rollback();
            }
            try (SqlSession second = fixture.openSession()) {
                second.getMapper(UserMapper.class).findById(1L);
                assertEquals(2, fixture.selectCount("findById"));
            }
        }
    }

    @Test
    void commitPublishesAndUpdateClearsNamespace() throws Exception {
        try (Chapter04Fixture fixture = new Chapter04Fixture()) {
            fixture.reset();
            try (SqlSession seed = fixture.openSession()) {
                seed.getMapper(UserMapper.class).findById(1L);
                seed.commit();
            }
            try (SqlSession writer = fixture.openSession()) {
                writer.getMapper(UserMapper.class).rename(1L, "Changed");
                writer.commit();
            }
            try (SqlSession reader = fixture.openSession()) {
                assertEquals("Changed", reader.getMapper(UserMapper.class)
                        .findById(1L).getUserName());
            }
        }
    }
}
```

`selectCount` 可由本节插件计数，或复用第 03 篇已有 JDBC 计数器。测试必须同时断言查询次数和数据库结果；只断言值无法证明缓存真的命中或真正清理。

### 11.4 插件签名和链测试

文件：`src/test/java/com/frank/mybatis/chapter04/PluginChapter04Test.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：`Interceptor`、`Invocation`、`Plugin`、`Signature`、第八节 `Configuration.addInterceptor`、`Chapter04Fixture`

第一个测试走真实链路：拦截 `Executor.query`，验证声明的方法被拦截、未声明的方法原样转发；第二个测试固定"缺签名的插件在包装期失败"。注意拦截器必须在 `openSession()` 之前注册——执行器在 openSession 时才被 `pluginAll` 包装。

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.chapter01.UserMapper;
import com.frank.mybatis.executor.Executor;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.plugin.Interceptor;
import com.frank.mybatis.plugin.Invocation;
import com.frank.mybatis.plugin.Plugin;
import com.frank.mybatis.plugin.PluginException;
import com.frank.mybatis.plugin.Signature;
import com.frank.mybatis.session.ResultHandler;
import com.frank.mybatis.session.RowBounds;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class PluginChapter04Test {

    @Signature(type = Executor.class, method = "query",
            args = {MappedStatement.class, Object.class, RowBounds.class, ResultHandler.class})
    static class CountingInterceptor implements Interceptor {
        int calls;

        @Override
        public Object intercept(Invocation invocation) throws Throwable {
            calls++;
            return invocation.proceed();
        }
    }

    @Test
    void executorQueryIsInterceptedOnTheRealChain() throws Exception {
        try (Chapter04Fixture fixture = new Chapter04Fixture()) {
            fixture.reset();
            CountingInterceptor interceptor = new CountingInterceptor();
            fixture.configuration().addInterceptor(interceptor);
            try (var session = fixture.openSession()) {
                assertNotNull(session.getMapper(UserMapper.class).findById(1L));
            }
            assertEquals(1, interceptor.calls);
        }
    }

    @Test
    void missingSignatureFailsAtWrapTime() {
        Interceptor broken = new Interceptor() { };
        assertThrows(PluginException.class, () -> Plugin.wrap(new Object(), broken));
    }
}
```

配合第八.4 节的 `PluginContractTest`（Supplier 目标 + A/B 链顺序断言），插件部分的行为就完整了：签名校验四层、链式包装顺序、`proceed()` 解包原始异常、未声明方法转发。运行 `mvn -q -Dtest='PluginContractTest,PluginChapter04Test' test`。

### 11.5 JOIN、LEFT JOIN、NULL 测试

文件：`src/test/java/com/frank/mybatis/chapter04/NestedMappingChapter04Test.java`｜package：`com.frank.mybatis.chapter04`｜前置依赖：`Chapter04Fixture`、`OrderMapper`、注册的 `NestedMaps.orderWithItems()`

```java
package com.frank.mybatis.chapter04;

import com.frank.mybatis.chapter01.UserMapper;
import com.frank.mybatis.session.SqlSession;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.junit.jupiter.api.Assertions.*;

class NestedMappingChapter04Test {
    @Test
    void joinDeduplicatesParentsAndKeepsChildren() throws Exception {
        try (Chapter04Fixture fixture = new Chapter04Fixture()) {
            fixture.reset();
            try (SqlSession session = fixture.openSession()) {
                List<Order> orders = session.getMapper(OrderMapper.class)
                        .findByUserId(1L);
                assertEquals(2, orders.size());
                assertEquals(10L, orders.get(0).getId());
                assertEquals(2, orders.get(0).getItems().size());
                assertEquals(11L, orders.get(1).getId());
                assertTrue(orders.get(1).getItems().isEmpty());
            }
        }
    }

    @Test
    void sqlNullRemainsNull() throws Exception {
        try (Chapter04Fixture fixture = new Chapter04Fixture()) {
            fixture.reset();
            try (SqlSession session = fixture.openSession()) {
                assertNull(session.getMapper(UserMapper.class)
                        .findById(2L).getAge());
            }
        }
    }
}
```

collection 测试验证订单 10 的两条行被折叠为一个父对象和两个子对象；订单 11 验证 LEFT JOIN 子 id 全 null 时集合为空，而不是含有一条全 null 的明细。association 测试可在 SQL 中加入 `u.id AS user_id`、`u.user_name AS user_name`、`u.age AS user_age`，注册 `NestedKind.ASSOCIATION`，并断言 `order.getOwner()` 是唯一 User。

## 十二、验证命令、失效矩阵与结论

**为什么需要这一步：** 缓存与映射的 bug 几乎都是「偶现」——只有把失效场景列成矩阵逐条断言，才敢说实现正确；这张表同时是后续重构的回归清单。

### 12.1 测试命令

文件：命令行｜package：无｜前置依赖：真实项目根目录、Maven、JUnit 5

```bash
mvn -q test
```

文件：命令行｜package：无｜前置依赖：chapter04 测试类

```bash
mvn -q -Dtest='com.frank.mybatis.chapter04.*' test
```

文件：命令行｜package：无｜前置依赖：缓存测试

```bash
mvn -q -Dtest=com.frank.mybatis.chapter04.CacheChapter04Test test
```

文件：命令行｜package：无｜前置依赖：插件测试

```bash
mvn -q -Dtest=com.frank.mybatis.chapter04.PluginChapter04Test test
```

文件：命令行｜package：无｜前置依赖：嵌套映射测试

```bash
mvn -q -Dtest=com.frank.mybatis.chapter04.NestedMappingChapter04Test test
```

### 12.2 必须覆盖的失效与映射矩阵

| 场景 | 必须结果 |
| --- | --- |
| 同 session、同 key | 一级缓存命中，JDBC 只执行一次 |
| 不同 session | 一级缓存不共享 |
| 二级查询后 rollback | pending 丢弃，另一 session 不能命中 |
| 二级查询后 commit | 结果发布到 namespace delegate |
| update 后同 session 查询 | 一级缓存已清，不能返回旧对象 |
| update commit | namespace 二级缓存清理 |
| update rollback / close | 不发布清理或 pending 结果 |
| 参数、SQL、offset、limit、环境不同 | CacheKey 不相等 |
| 数组参数内容相同 | CacheKey 相等 |
| 插件签名错误 | 包装期失败 |
| 未声明方法 | 原样转发 |
| 多插件 | 顺序稳定，均能 proceed |
| JOIN 重复父行 | 父对象唯一 |
| 子 id 重复 | collection 不重复追加 |
| LEFT JOIN 子 id 为 null | 空集合，不创建空子对象 |
| SQL NULL | Java 属性仍为 null |

### 12.3 最后检查

四个边界必须成立：CacheKey 定义结果身份；一级缓存绑定 SqlSession，二级缓存只在 commit 后发布；插件只代理精确签名并显式 proceed；ResultMap 用父/子 id 折叠 JOIN，子 id 为空时跳过对象创建。不要跨线程共享 SqlSession，也不要修改二级缓存命中的可变对象。生产二级缓存还需容量、并发、复制和跨进程失效策略；主 schema 仍只有 `t_user`，订单表只存在 `schema-ch04.sql`。

至此，执行链上只剩最后一块没有归位的职责：JDBC 值与 Java 类型之间的转换还散落在各处，生成主键、批量执行和连接所有权也没有明确边界。第 05 篇用 `TypeHandlerRegistry`、`BatchExecutor` 和 `TransactionFactory` 收拢它们——本篇的 `BaseExecutor` 生命周期与 `Configuration` 挂载点会原样复用，不需要再次重构。

> 系列导航：上一篇：[手写 MyBatis 03：动态 SQL 与参数绑定](/2026/09/11/articles/Mybatis/03-mybatis-dynamic-sql-and-parameters/) ｜ 本篇是第 4 篇 ｜ 下一篇：[手写 MyBatis 05：类型、批处理、事务与 Spring 生态增量](/2026/09/13/articles/Mybatis/05-mybatis-types-transactions-and-ecosystem/)
