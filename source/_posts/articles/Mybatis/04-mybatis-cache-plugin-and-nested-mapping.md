---
title: 手写 MyBatis 04：缓存、插件与嵌套映射
date: 2026-09-09 14:00:00
categories:
  - Mybatis
tags: [Java, MyBatis, 缓存, 插件, ResultMap]
description: 承接第03篇，使用Java17、H2、Maven逐步实现缓存、插件与嵌套映射。
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
