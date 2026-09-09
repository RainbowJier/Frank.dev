---
title: "手写 MyBatis 04：缓存、插件与嵌套映射"
date: 2026-09-12 10:00:00
categories: [Mybatis]
tags:
  - Java
  - MyBatis
  - 缓存
  - 插件
description: 承接第03篇动态 SQL 与参数处理，使用 Java 17、H2 和 Maven 实现 PerpetualCache、CacheKey、一级缓存、事务边界、插件代理链、ResultMap 与嵌套映射。

lang: zh-CN
---

> 本篇承接《手写 MyBatis 03：执行器与事务边界》，继续把一次 JDBC 查询扩展成可复用的执行链。我们逐步实现 PerpetualCache、一级缓存、TransactionalCache、CacheKey、更新清理、Interceptor/Plugin 代理链、签名校验，以及 ResultMap 的 association、collection、多表结果和去重。

## 一、目标与实验环境

最终链路：`Mapper -> SqlSession -> CachingExecutor -> CacheKey -> PerpetualCache -> StatementHandler -> JDBC -> ResultSetHandler -> ResultMap`。缓存不放在 Mapper 代理，而放在执行器模板；这样 XML、注解和测试调用共享同一语义。环境固定为 Java 17、Maven、H2 2.3.232、JUnit 5，不依赖真实 MyBatis。

```xml
<properties><maven.compiler.release>17</maven.compiler.release></properties>
<dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><version>2.3.232</version><scope>test</scope></dependency>
```

测试表包含用户、订单、明细：

```sql
create table t_user(id bigint primary key,user_name varchar(100) not null,age integer);
create table t_order(id bigint primary key,user_id bigint not null,order_no varchar(64));
create table t_order_item(id bigint primary key,order_id bigint not null,sku varchar(64),quantity integer not null);
insert into t_user values(1,'Frank',30),(2,'Ada',null);
insert into t_order values(10,1,'O-001'),(11,1,'O-002');
insert into t_order_item values(100,10,'JAVA-17',2),(101,10,'H2',1);
```

`age` 的 NULL、订单 10 的重复父行、订单 11 的空集合分别覆盖三个关键边界。

## 二、Cache 与 PerpetualCache

缓存需要稳定 id、读写、删除、清空和大小，不是 Map 的随意包装。

```java
public interface Cache {
  String getId(); void putObject(Object key,Object value);
  Object getObject(Object key); Object removeObject(Object key);
  void clear(); int getSize();
}
public final class PerpetualCache implements Cache {
  private final String id; private final Map<Object,Object> map=new HashMap<>();
  public PerpetualCache(String id){this.id=Objects.requireNonNull(id);}
  public String getId(){return id;}
  public void putObject(Object k,Object v){map.put(Objects.requireNonNull(k),v);}
  public Object getObject(Object k){return map.get(k);}
  public Object removeObject(Object k){return map.remove(k);}
  public void clear(){map.clear();} public int getSize(){return map.size();}
}
```

“永久”表示本类不负责过期，不表示数据永远正确。一级缓存可用会话私有 HashMap；二级共享缓存还需并发、容量、序列化和对象隔离策略。

## 三、CacheKey

只用 statement id 或 SQL 会把不同参数、分页、租户混在一起。key 必须包含 statement、offset、limit、最终 SQL、按占位符顺序排列的参数、环境和必要的租户信息。

```java
public final class CacheKey {
  private int hashcode=17; private long checksum; private int count;
  private final List<Object> values=new ArrayList<>();
  public CacheKey(Object... xs){for(Object x:xs)update(x);}
  public void update(Object x){int h=x==null?1:x.hashCode();count++;checksum+=h;
    hashcode=37*hashcode+h*count;values.add(x);}
  public int hashCode(){return hashcode;}
  public boolean equals(Object o){if(this==o)return true;if(!(o instanceof CacheKey k))return false;
    return hashcode==k.hashcode&&checksum==k.checksum&&count==k.count&&values.equals(k.values);}
  public String toString(){return "CacheKey"+values;}
}
CacheKey key=new CacheKey(ms.getId(),bounds.offset(),bounds.limit(),boundSql.sql());
for(Object p:boundSql.orderedParameters())key.update(p);
key.update(environmentId);
```

哈希只是快速筛选，最终比较有序值。数组参数需转为深内容结构，否则数组默认按引用比较。分页遗漏会造成第一页和第二页互相污染；租户条件若来自 ThreadLocal，也必须显式加入 key。

## 四、一级缓存与更新清理

缓存应放在执行器查询模板，而不是 Mapper 代理。

```java
public abstract class BaseExecutor {
  private final PerpetualCache localCache;
  protected BaseExecutor(String id){localCache=new PerpetualCache(id+".local");}
  public <E> List<E> query(MappedStatement ms,Object p,RowBounds rb,ResultHandler<E> h){
    BoundSql sql=ms.getBoundSql(p); CacheKey key=createCacheKey(ms,p,rb,sql);
    @SuppressWarnings("unchecked") List<E> hit=(List<E>)localCache.getObject(key);
    if(hit!=null){h.handle(hit);return hit;}
    List<E> result=doQuery(ms,p,rb,sql,h);localCache.putObject(key,result);return result;
  }
  protected abstract <E> List<E> doQuery(MappedStatement ms,Object p,RowBounds rb,BoundSql s,ResultHandler<E> h);
  protected void clearLocalCache(){localCache.clear();}
  public int update(MappedStatement ms,Object p){clearLocalCache();return doUpdate(ms,p);}
}
```

同一 SqlSession 相同 key 命中；不同会话不共享。更新前清理最保守：失败只会多一次查询，不会返回旧对象。commit、rollback、close 都要清理，且 close 必须关闭连接。示例缓存返回同一可变实例，生产二级缓存应深拷贝或使用不可变 DTO。

```java
@Test void sameSessionHits(){try(SqlSession s=factory.openSession()){var m=s.getMapper(UserMapper.class);m.findById(1L);m.findById(1L);assertEquals(1,counter.selects());}}
@Test void updateClears(){try(SqlSession s=factory.openSession()){var m=s.getMapper(UserMapper.class);m.findById(1L);m.rename(1L,"Changed");assertEquals("Changed",m.findById(1L).getUserName());assertEquals(2,counter.selects());}}
```

## 五、TransactionalCache 与二级边界

若查询后立刻写共享 Map，会发生 A 未提交、B 命中、A 回滚的脏缓存。每个事务必须拥有自己的包装器，只有 delegate 共享。

```java
public final class TransactionalCache implements Cache {
  private final Cache delegate; private final Map<Object,Object> pending=new LinkedHashMap<>();
  private final Set<Object> missed=new LinkedHashSet<>(); private boolean clearOnCommit;
  public TransactionalCache(Cache d){delegate=Objects.requireNonNull(d);}
  public String getId(){return delegate.getId();}
  public Object getObject(Object k){if(pending.containsKey(k))return pending.get(k);Object v=delegate.getObject(k);if(v==null)missed.add(k);return v;}
  public void putObject(Object k,Object v){pending.put(k,v);}
  public Object removeObject(Object k){pending.remove(k);return delegate.removeObject(k);}
  public void clear(){clearOnCommit=true;pending.clear();}
  public int getSize(){return delegate.getSize();}
  public void commit(){if(clearOnCommit)delegate.clear();missed.forEach(delegate::removeObject);pending.forEach(delegate::putObject);reset();}
  public void rollback(){reset();}
  private void reset(){clearOnCommit=false;pending.clear();missed.clear();}
}
```

更新 namespace 时标记 `clearOnCommit`，commit 清共享缓存，rollback 丢 pending。一个 updateUser 可能影响多个查询，因此按 namespace 清理而不是只删一个 key。

```java
@Test void rollbackDoesNotPublish(){try(SqlSession a=factory.openSession()){a.getMapper(UserMapper.class).findById(1L);a.rollback();}try(SqlSession b=factory.openSession()){b.getMapper(UserMapper.class).findById(1L);assertEquals(2,counter.selects());}}
@Test void commitPublishes(){try(SqlSession a=factory.openSession()){a.getMapper(UserMapper.class).findById(1L);a.commit();}try(SqlSession b=factory.openSession()){b.getMapper(UserMapper.class).findById(1L);assertEquals(1,counter.selects());}}
```

## 六、Interceptor、Plugin 与签名校验

插件把分页、日志、耗时和审计从核心类移出。

```java
public interface Interceptor {Object intercept(Invocation i)throws Throwable;default Object plugin(Object t){return Plugin.wrap(t,this);}}
public record Invocation(Object target,Method method,Object[] args){public Object proceed()throws Throwable{try{return method.invoke(target,args);}catch(InvocationTargetException e){throw e.getCause();}}}
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE) @interface Intercepts{Signature[] value();}
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.TYPE) @interface Signature{Class<?> type();String method();Class<?>[] args();}
```

`Plugin.wrap` 必须启动时校验 `type.getMethod(method,args)`，并只为目标实现的接口创建 JDK Proxy。签名中的 args 是精确参数类型，拼错方法立即失败。

```java
public static Object wrap(Object target,Interceptor interceptor){
  Intercepts a=interceptor.getClass().getAnnotation(Intercepts.class);
  if(a==null||a.value().length==0)throw new PluginException("missing @Intercepts");
  Map<Class<?>,Set<Method>> map=new HashMap<>();
  for(Signature s:a.value()){if(!s.type().isInterface())throw new PluginException("type must be interface");
    try{Method m=s.type().getMethod(s.method(),s.args());map.computeIfAbsent(s.type(),x->new HashSet<>()).add(m);}
    catch(NoSuchMethodException e){throw new PluginException("bad signature",e);}}
  Set<Class<?>> ifaces=map.keySet().stream().filter(i->i.isAssignableFrom(target.getClass())).collect(Collectors.toSet());
  if(ifaces.isEmpty())return target;
  return Proxy.newProxyInstance(target.getClass().getClassLoader(),ifaces.toArray(Class<?>[]::new),
    (proxy,method,args)->map.getOrDefault(method.getDeclaringClass(),Set.of()).contains(method)
      ? interceptor.intercept(new Invocation(target,method,args==null?new Object[0]:args)) : method.invoke(target,args));
}
```

代理链按注册顺序形成 `A.before -> B.before -> real -> B.after -> A.after`。插件必须调用 `proceed()`；目标内部 `this.method()` 会绕过代理。常见错误是签名类型写实现类、只检查方法名、重复包装目标。

## 七、ResultMap、association、collection

```java
public record ResultMapping(String property,String column,Class<?> javaType,boolean id){}
public record AssociationMapping(String property,ResultMap resultMap){}
public record CollectionMapping(String property,ResultMap resultMap,Class<?> elementType){}
public record ResultMap(String id,Class<?> type,List<ResultMapping> mappings,List<AssociationMapping> associations,List<CollectionMapping> collections){}
```

SQL 必须使用别名，避免两个表的 id 冲突：

```sql
select o.id order_id,o.user_id order_user_id,o.order_no,
 i.id item_id,i.order_id item_order_id,i.sku item_sku,i.quantity item_quantity
from t_order o left join t_order_item i on i.order_id=o.id
where o.user_id=? order by o.id,i.id
```

核心算法维护父 key：

```java
Map<CacheKey,Object> parents=new LinkedHashMap<>();
while(rs.next()){
  CacheKey pk=keyOf(rs,orderMap); Order parent=(Order)parents.get(pk);
  if(parent==null){parent=newInstance(Order.class);applySimple(rs,parent,orderMap);parents.put(pk,parent);results.add(parent);}
  if(getObject(rs,"item_id")!=null){CacheKey ck=keyOf(rs,itemMap);
    if(marked(parent,ck)==false){parent.getItems().add(mapItem(rs));mark(parent,ck);}}
}
```

订单 10 两行只创建一个父对象，两个明细分别追加；订单 11 的 LEFT JOIN 子 id 全 null，集合保持空。父 id、子 id 都应标记为 `id=true`。`association` 表示单值，`collection` 表示多值；循环映射必须截断。

## 八、多表方案选择

JOIN 只查一次但重复父列，适合稳定排序；嵌套 select 直观却产生 N+1；父查询后按 id 批量 `IN` 再分组，查询少但要处理参数上限。

```java
Map<Long,List<OrderItem>> grouped=items.stream().collect(Collectors.groupingBy(OrderItem::getOrderId,LinkedHashMap::new,Collectors.toList()));
for(Order o:orders)o.setItems(grouped.getOrDefault(o.getId(),List.of()));
```

选择取决于数据量、网络传输、排序、事务和懒加载，而不是固定教条。

## 九、失效场景与测试矩阵

|场景|必须验证|
|---|---|
|参数不同|CacheKey 不相等|
|页码不同|offset/limit 进入 key|
|更新成功|一级立即清理、二级提交清理|
|更新回滚|pending 丢弃|
|绕过 Mapper 更新|显式清理 namespace|
|触发器改关联表|加入关联 namespace|
|租户不同|租户 id 进入 key|
|JOIN 重复父行|父对象唯一|
|重复子行|子 id 去重|
|LEFT JOIN 空子项|空集合而非空对象|
|SQL NULL|Java 属性保持 null|

```java
@Test void nestedRows(){List<Order> xs=mapper.findByUserId(1L);assertEquals(2,xs.size());assertEquals(2,xs.get(0).getItems().size());assertTrue(xs.get(1).getItems().isEmpty());}
@Test void nullIsNull(){assertNull(userMapper.findById(2L).getAge());}
@Test void invalidSignatureFailsEarly(){assertThrows(PluginException.class,()->new Broken().plugin(handler));}
```

H2 事务测试使用两个独立连接并 `setAutoCommit(false)`，A 未提交时 B 的读取、A rollback 后的缓存可见性要分别断言。测试既断言值也断言 JDBC 次数，避免缓存未生效或命中旧值。

## 十、迁移、性能与验收

从第 03 篇迁移：保留 JDBC 执行器；加入会话级 PerpetualCache；统一 CacheKey；在 update、commit、rollback、close 清理；为 namespace 注册共享 delegate；每事务创建 TransactionalCache；用 CachingExecutor 装饰；Handler 创建后执行 pluginAll；将反射列映射提升为 ResultMap；删除 Mapper 代理里的临时缓存，避免双重生命周期。

不要把 SqlSession 放进单例或跨线程共享。二级缓存可变对象要深拷贝或不可变；缓存击穿需要 single-flight 或外部能力。日志只打印 namespace、statement、命中、key hash 和事务状态，不记录敏感参数。

验收清单：Java17 下 `mvn test` 通过；一级缓存只在会话内共享；key 区分 SQL、参数、分页、环境和租户；写操作正确失效；二级 rollback 不发布、commit 发布；错误签名启动即失败；插件链顺序稳定；父子对象去重；空子行为空集合；NULL 不变成 0。

## 十一、总结与 05 预告

`CacheKey` 定义结果身份，`PerpetualCache` 提供基础存储，一级缓存绑定会话，`TransactionalCache` 把二级缓存绑定提交边界；`Interceptor`/`Plugin` 以精确签名插入横切逻辑；`ResultMap` 通过父子 key 把 JOIN 行折叠成对象图。真正要守住的是边界：缓存不能泄漏未提交数据，更新要传播到正确 namespace，代理只能拦截明确方法，嵌套映射要同时处理父去重、子去重和空子行。

下一篇《手写 MyBatis 05》将实现动态 SQL 与 XML/注解解析：`if`、`where`、`trim`、`foreach`、参数节点和安全 SQL 片段组合，并继续复用本篇的 MappedStatement、插件链、缓存 key 与 ResultMap。

## 十二、逐步实验记录：从失败到正确
下面按实验顺序记录每个可观察结论。每个实验都应在独立会话、独立 H2 数据库或清晰的事务夹具中执行，避免上一个测试留下的缓存影响下一个测试。

### 12.1 PerpetualCache 的读写

**实验问题。** 我们要确认“PerpetualCache 的读写”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment1() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(1);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.2 CacheKey 的参数维度

**实验问题。** 我们要确认“CacheKey 的参数维度”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment2() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(2);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.3 分页 key 的隔离

**实验问题。** 我们要确认“分页 key 的隔离”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment3() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(3);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.4 一级缓存的会话边界

**实验问题。** 我们要确认“一级缓存的会话边界”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment4() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(4);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.5 更新后的一级失效

**实验问题。** 我们要确认“更新后的一级失效”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment5() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(5);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.6 commit 的二级发布

**实验问题。** 我们要确认“commit 的二级发布”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment6() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(6);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.7 rollback 的二级丢弃

**实验问题。** 我们要确认“rollback 的二级丢弃”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment7() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(7);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.8 namespace 的整体清理

**实验问题。** 我们要确认“namespace 的整体清理”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment8() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(8);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.9 插件接口筛选

**实验问题。** 我们要确认“插件接口筛选”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment9() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(9);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.10 插件参数精确匹配

**实验问题。** 我们要确认“插件参数精确匹配”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment10() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(10);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.11 代理链嵌套顺序

**实验问题。** 我们要确认“代理链嵌套顺序”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment11() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(11);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.12 异常解包

**实验问题。** 我们要确认“异常解包”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment12() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(12);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.13 ResultMap 列别名

**实验问题。** 我们要确认“ResultMap 列别名”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment13() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(13);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.14 父对象去重

**实验问题。** 我们要确认“父对象去重”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment14() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(14);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.15 子对象去重

**实验问题。** 我们要确认“子对象去重”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment15() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(15);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.16 LEFT JOIN 空对象

**实验问题。** 我们要确认“LEFT JOIN 空对象”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment16() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(16);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.17 association 单值映射

**实验问题。** 我们要确认“association 单值映射”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment17() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(17);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.18 collection 空集合

**实验问题。** 我们要确认“collection 空集合”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment18() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(18);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.19 NULL 类型处理

**实验问题。** 我们要确认“NULL 类型处理”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment19() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(19);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.20 H2 双连接事务

**实验问题。** 我们要确认“H2 双连接事务”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment20() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(20);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.21 可变结果保护

**实验问题。** 我们要确认“可变结果保护”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment21() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(21);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.22 绕过框架更新

**实验问题。** 我们要确认“绕过框架更新”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment22() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(22);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.23 触发器关联失效

**实验问题。** 我们要确认“触发器关联失效”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment23() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(23);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.24 租户 key 隔离

**实验问题。** 我们要确认“租户 key 隔离”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment24() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(24);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.25 缓存命中日志

**实验问题。** 我们要确认“缓存命中日志”不是偶然行为，而是由明确的生命周期或元数据规则保证。先准备最小输入，再观察命中次数、对象数量和事务状态。

**执行步骤。**

1. 创建测试夹具并清空共享缓存。
2. 执行一次原始操作，记录 SQL 和返回值。
3. 重复操作或改变一个维度。
4. 检查计数器、结果对象和日志。
5. finally 中关闭会话，避免连接泄漏。

```java
@Test
void experiment25() {
    fixture.reset();
    try (SqlSession session = fixture.openSession()) {
        Object first = fixture.run(session);
        Object second = fixture.runAgain(session);
        assertNotNull(first);
        assertNotNull(second);
        fixture.assertExpectedForCase(25);
    }
}
```

**结论。** 如果结果不符合预期，按“最终 SQL -> CacheKey 字段 -> 缓存层级 -> 清理时机 -> 事务提交”顺序排查。不要先修改 Map 的实现；多数错误来自边界放错位置。

### 12.26 代码审查清单 1

审查第 1 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review1(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.27 代码审查清单 2

审查第 2 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review2(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.28 代码审查清单 3

审查第 3 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review3(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.29 代码审查清单 4

审查第 4 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review4(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.30 代码审查清单 5

审查第 5 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review5(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.31 代码审查清单 6

审查第 6 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review6(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.32 代码审查清单 7

审查第 7 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review7(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.33 代码审查清单 8

审查第 8 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review8(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.34 代码审查清单 9

审查第 9 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review9(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.35 代码审查清单 10

审查第 10 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review10(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.36 代码审查清单 11

审查第 11 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review11(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.37 代码审查清单 12

审查第 12 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review12(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.38 代码审查清单 13

审查第 13 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review13(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.39 代码审查清单 14

审查第 14 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review14(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.40 代码审查清单 15

审查第 15 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review15(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.41 代码审查清单 16

审查第 16 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review16(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.42 代码审查清单 17

审查第 17 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review17(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.43 代码审查清单 18

审查第 18 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review18(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.44 代码审查清单 19

审查第 19 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review19(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.45 代码审查清单 20

审查第 20 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review20(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.46 代码审查清单 21

审查第 21 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review21(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.47 代码审查清单 22

审查第 22 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review22(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.48 代码审查清单 23

审查第 23 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review23(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.49 代码审查清单 24

审查第 24 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review24(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

### 12.50 代码审查清单 25

审查第 25 组代码时，重点看输入是否可能为 null、集合是否可变、方法是否重载、SQL 是否包含分页和租户条件。缓存 key 的构造顺序一旦改变，旧数据应整体失效，不能只依赖哈希值“碰巧不同”。

插件必须通过声明的接口方法进入 `intercept`，未声明的方法原样转发；嵌套结果必须先判断子 id，再创建子对象。更新清理最好覆盖失败、回滚、关闭和异常传播路径。

```java
void review25(MappedStatement ms, CacheKey key) {
    require(ms.getId() != null);
    require(key != null);
    // 真实项目在这里加入断言、指标或测试夹具。
}
```

