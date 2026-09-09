---
title: "手写 MyBatis 05：类型系统、事务抽象与生态接入"
categories: [Mybatis]
---

# 手写 MyBatis 05：类型系统、事务抽象与生态接入

> Java 17、Maven、H2。本文是手写 MyBatis 系列阶段总结：从 JDBC 类型处理，到主键回填、批处理、事务、连接池边界和 Spring 同步适配，全部给出可落地的最小实现。

## 一、目标与架构边界

上一章的执行器能够运行 SQL，但类型转换、提交回滚和连接关闭仍然耦合。

本章把 Java 值与 JDBC 值的转换收敛到 TypeHandler，把事务生命周期收敛到 Transaction，把连接供应收敛到 DataSource。

核心原则是单一职责：SQL 构建不关心事务，事务不关心 JSON，连接池不决定业务提交。

示例使用 Java 17、H2 2.x、JUnit 5 和 Maven；生产环境替换驱动时必须重新验证类型映射。

## 二、TypeHandler 与 JdbcType

TypeHandler 同时负责参数写入和结果读取。

null 无法通过 Java 值推断数据库类型，因此 ParameterMapping 必须允许显式 JdbcType。

处理器选择顺序为显式处理器、Java 类型注册、JdbcType 注册、Unknown 兜底。

没有处理器时应该快速失败，并报告参数索引、属性名、Java 类型和 JDBC 类型。

```java
public interface TypeHandler<T> {
  void setParameter(PreparedStatement ps,int i,T value,JdbcType type)throws SQLException;
  T getResult(ResultSet rs,String column)throws SQLException;
  T getResult(ResultSet rs,int index)throws SQLException;
  T getResult(CallableStatement cs,int index)throws SQLException;
}
```

## 三、基础处理器

数值读取后必须调用 wasNull，否则数据库 NULL 会被误读为零。

String 使用 setString/getString；Long 使用 setLong/getLong；BigDecimal 使用 setBigDecimal。

Boolean 在不同数据库可能是 BOOLEAN、BIT 或字符值，必须由驱动和 JdbcType 策略统一。

byte[] 应使用 setBytes；大对象则需要独立的 Blob/Clob 处理器。

## 四、枚举

默认推荐 name()，因为 ordinal 会因新增枚举常量而改变历史意义。

数据库保存业务 code 时定义 CodeEnum 接口，处理器只保存 code，不依赖展示文本。

未知值必须抛出带原始值和枚举类名的 SQLException。

null 应保持 null，不应被转成第一个枚举常量。

## 五、JSON

核心层定义 JsonCodec，应用层选择 Jackson、Gson 或其他实现。

不要根据 JSON 中的类名进行任意多态反序列化；目标类型来自字段映射。

H2 可用 VARCHAR 模拟 JSON；PostgreSQL 常用 OTHER 与 PGobject。

序列化和反序列化错误都要保留列名、属性名和截断后的原文。

```java
interface JsonCodec { String encode(Object value) throws Exception;
 <T> T decode(String json,Class<T> type) throws Exception; }
```

## 六、时间类型

LocalDate 对应 DATE，LocalTime 对应 TIME，LocalDateTime 对应 TIMESTAMP。

Instant 必须明确 UTC 策略，不能隐式使用机器默认时区。

JDBC 4.2 的 getObject(Class) 简洁，但老驱动兼容性需通过测试确认。

边界测试要覆盖 null、闰日、纳秒和夏令时切换。

```java
final class LocalDateTimeTypeHandler extends BaseTypeHandler<LocalDateTime> {
 protected void setNonNullParameter(PreparedStatement ps,int i,LocalDateTime v,JdbcType t)throws SQLException { ps.setTimestamp(i,Timestamp.valueOf(v)); }
}
```

## 七、主键回填

prepareStatement 必须传入 RETURN_GENERATED_KEYS。

executeUpdate 成功后读取 getGeneratedKeys，再写回 keyProperty。

没有生成键时要抛错，不要把 null 当成功。

批量主键顺序依赖驱动，框架应明确限制或提供顺序插入策略。

```java
try (PreparedStatement ps=connection.prepareStatement(sql,Statement.RETURN_GENERATED_KEYS)) {
  handler.setParameters(ps); ps.executeUpdate();
  try(ResultSet rs=ps.getGeneratedKeys()){ if(!rs.next()) throw new SQLException("未返回主键");
    PropertyAccess.write(parameter,keyProperty,rs.getObject(1)); }
}
```

## 八、BatchExecutor

相同 SQL 和映射可以复用 PreparedStatement。

update 阶段只 addBatch，flushStatements 阶段 executeBatch。

commit 前必须 flush，flush 失败必须 rollback。

批量执行返回的 update counts 可能是 SUCCESS_NO_INFO 或 EXECUTE_FAILED。

```java
for (ParameterObject value : values) { handler.setParameters(statement,value); statement.addBatch(); }
int[] counts=statement.executeBatch();
transaction.commit();
```

## 九、Transaction 与 JdbcTransaction

Executor 不直接 commit/rollback，而是依赖 Transaction。

JdbcTransaction 默认 autoCommit=false，close 必须幂等。

rollback 或 close 失败不能覆盖原始执行异常，应使用 addSuppressed。

连接的隔离级别、只读标记和超时都应在事务边界集中设置。

```java
interface Transaction { Connection getConnection() throws SQLException;
  void commit() throws SQLException; void rollback() throws SQLException; void close() throws SQLException; }
```

## 十、DataSource 与连接池

DataSource 负责提供连接，不负责决定业务何时提交。

池连接的 close 通常表示归还池，不是关闭物理连接。

归还前应恢复 autoCommit、只读、隔离级别和 warning。

任何异常路径都要关闭 ResultSet、Statement、Session，并保证连接最终可复用。

## 十一、Spring 事务同步

Spring 开启事务后，MyBatis 应复用线程绑定的连接。

SpringManagedTransaction 在外部事务中不自行 commit、rollback 或物理 close。

beforeCommit 可触发 BatchExecutor flush，afterCompletion 清理会话资源。

必须区分拥有连接与借用连接，避免事务完成前把连接归还连接池。

```java
Connection c=DataSourceUtils.getConnection(dataSource);
// 外部 Spring 事务存在时：不自行 commit，不提前 close
TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization(){
 public void beforeCommit(boolean readOnly){ executor.flushStatements(); }
});
```

## 十二、测试与运行

测试先建表，再执行插入、查询、提交和回滚。

类型测试验证 null、普通值、边界值和非法值。

事务测试验证提交可见、回滚不可见、重复 close 不报错。

连接归还测试借出并关闭会话，再次借出同一池资源，确认状态已恢复。

## 十三、逐步实现清单

01. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

01. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

01. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

01. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

01. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

01. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

01. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

01. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

01. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

01. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

01. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

01. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

01. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

01. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

01. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

02. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

02. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

02. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

02. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

02. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

02. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

02. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

02. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

02. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

02. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

02. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

02. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

02. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

02. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

02. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

03. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

03. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

03. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

03. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

03. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

03. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

03. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

03. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

03. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

03. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

03. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

03. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

03. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

03. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

03. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

04. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

04. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

04. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

04. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

04. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

04. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

04. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

04. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

04. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

04. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

04. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

04. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

04. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

04. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

04. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

05. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

05. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

05. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

05. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

05. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

05. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

05. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

05. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

05. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

05. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

05. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

05. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

05. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

05. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

05. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

06. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

06. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

06. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

06. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

06. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

06. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

06. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

06. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

06. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

06. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

06. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

06. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

06. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

06. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

06. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

07. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

07. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

07. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

07. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

07. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

07. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

07. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

07. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

07. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

07. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

07. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

07. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

07. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

07. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

07. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

08. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

08. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

08. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

08. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

08. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

08. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

08. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

08. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

08. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

08. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

08. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

08. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

08. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

08. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

08. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

09. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

09. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

09. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

09. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

09. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

09. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

09. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

09. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

09. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

09. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

09. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

09. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

09. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

09. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

09. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

10. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

10. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

10. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

10. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

10. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

10. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

10. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

10. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

10. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

10. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

10. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

10. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

10. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

10. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

10. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

11. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

11. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

11. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

11. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

11. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

11. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

11. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

11. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

11. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

11. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

11. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

11. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

11. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

11. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

11. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

12. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

12. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

12. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

12. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

12. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

12. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

12. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

12. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

12. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

12. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

12. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

12. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

12. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

12. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

12. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

13. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

13. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

13. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

13. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

13. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

13. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

13. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

13. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

13. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

13. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

13. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

13. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

13. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

13. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

13. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

14. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

14. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

14. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

14. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

14. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

14. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

14. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

14. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

14. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

14. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

14. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

14. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

14. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

14. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

14. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

15. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

15. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

15. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

15. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

15. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

15. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

15. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

15. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

15. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

15. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

15. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

15. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

15. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

15. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

15. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

16. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

16. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

16. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

16. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

16. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

16. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

16. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

16. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

16. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

16. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

16. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

16. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

16. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

16. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

16. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

17. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

17. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

17. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

17. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

17. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

17. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

17. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

17. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

17. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

17. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

17. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

17. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

17. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

17. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

17. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

18. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

18. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

18. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

18. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

18. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

18. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

18. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

18. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

18. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

18. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

18. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

18. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

18. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

18. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

18. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

19. 定义 JdbcType 与 TypeHandler 接口：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现 BaseTypeHandler 的 null 分支：检查输入、执行动作、验证结果，并记录失败上下文。

19. 注册包装类型与原始类型：检查输入、执行动作、验证结果，并记录失败上下文。

19. 接入 ParameterMapping：检查输入、执行动作、验证结果，并记录失败上下文。

19. 接入 ResultMapping：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现枚举 name 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现枚举 code 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

19. 注入 JsonCodec：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现 LocalDate 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现 LocalDateTime 处理器：检查输入、执行动作、验证结果，并记录失败上下文。

19. 开启 RETURN_GENERATED_KEYS：检查输入、执行动作、验证结果，并记录失败上下文。

19. 写回 keyProperty：检查输入、执行动作、验证结果，并记录失败上下文。

19. 缓存批处理语句：检查输入、执行动作、验证结果，并记录失败上下文。

19. 提交前 flush：检查输入、执行动作、验证结果，并记录失败上下文。

19. 定义 Transaction：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现 JdbcTransaction：检查输入、执行动作、验证结果，并记录失败上下文。

19. 包装 DataSource：检查输入、执行动作、验证结果，并记录失败上下文。

19. 实现连接归还校验：检查输入、执行动作、验证结果，并记录失败上下文。

19. 注册 Spring 同步：检查输入、执行动作、验证结果，并记录失败上下文。

19. 保留 suppressed 异常：检查输入、执行动作、验证结果，并记录失败上下文。

19. 补齐 H2 集成测试：检查输入、执行动作、验证结果，并记录失败上下文。

## 十四、Maven 配置与运行命令

```xml
<properties><maven.compiler.release>17</maven.compiler.release></properties>
<dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><version>2.2.224</version><scope>test</scope></dependency>
<dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.10.2</version><scope>test</scope></dependency>
```

```bash
mvn -q -DskipTests=false test
mvn -q -Dtest=TypeHandlerTest test
mvn -q -Dtest=TransactionTest test
```

## 十五、阶段总结

类型处理器隔离驱动差异，事务抽象隔离提交策略，数据源边界隔离连接供应，Spring 适配则复用外部事务。主键回填、批处理、异常保留与连接归还共同决定可靠性。完成本章后，框架已经从“能执行 SQL”进入“能在多类型、多事务环境下稳定执行 SQL”。下一章可继续加入插件、缓存、分页方言和 Spring Boot 自动配置，但仍应保持这些边界。
