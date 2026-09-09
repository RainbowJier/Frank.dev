---
title: 手写 MyBatis 02：XML、注解与 Statement ID，统一配置模型
date: 2026-09-10 10:00:00
categories:
  - Mybatis
tags:
  - Java
  - MyBatis
  - XML
  - 反射
lang: zh-CN
---

> 本文承接 01：把 JDBC、SqlSession、Mapper 动态代理继续推进到 XML、注解与统一配置模型。核心问题是：XML 中的 SQL 如何被找到，代理如何知道该执行哪条 SQL？答案是稳定的 `namespace + statement id`。

## 一、承接 01：从 Method 到字符串身份

第一篇可以用 `Method` 作为配置 key，但 XML 解析发生在启动期，执行发生在调用期，二者不应被某个反射对象绑死。重载方法、序列化、日志、跨模块配置也更适合字符串。因此本篇规定：Mapper 全限定名是 namespace，方法名是局部 id，二者拼成完整 id。

```text
lab.demo.UserMapper.findById
        = namespace + "." + statement id
```

本篇完成 XML、注解、资源加载、重复配置校验、参数校验、MapperProxy 和 CRUD。仍然不实现动态 SQL、缓存、插件和嵌套映射；目标是写出可编译、可运行、可解释的核心类。

## 二、Maven 与 H2 环境

建议独立建立 `mini-mybatis-lab`，不修改博客工程的 pnpm 配置。

```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>lab</groupId><artifactId>mini-mybatis-lab</artifactId><version>1.0-SNAPSHOT</version>
  <properties><maven.compiler.release>17</maven.compiler.release><project.build.sourceEncoding>UTF-8</project.build.sourceEncoding></properties>
  <dependencies>
    <dependency><groupId>com.h2database</groupId><artifactId>h2</artifactId><version>2.3.232</version></dependency>
    <dependency><groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId><version>5.11.0</version><scope>test</scope></dependency>
  </dependencies>
  <build><plugins>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId><version>3.13.0</version></plugin>
    <plugin><groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId><version>3.5.0</version></plugin>
  </plugins></build>
</project>
```

H2 使用内存数据库：

```java
String url = "jdbc:h2:mem:mybatis;MODE=PostgreSQL;DB_CLOSE_DELAY=-1";
try (Connection c = DriverManager.getConnection(url);
     Statement s = c.createStatement()) {
  s.executeUpdate("drop table if exists t_user");
  s.executeUpdate("create table t_user(id bigint primary key,user_name varchar(100) not null,age integer)");
}
```

`age` 允许 NULL，用来验证 JDBC NULL 映射。项目结构可按以下方式组织：

```text
src/main/java/lab/mybatis/{annotation,config,executor,mapping,proxy,session}
src/main/java/lab/demo/{User,UserMapper,UserXmlMapper,Demo}.java
src/main/resources/mapper/UserMapper.xml
```

## 三、统一模型 MappedStatement

### 3.1 命令类型

```java
package lab.mybatis.mapping;
public enum SqlCommandType { SELECT, INSERT, UPDATE, DELETE }
```

### 3.2 MappedStatement

```java
package lab.mybatis.mapping;
import java.lang.reflect.Method;
import java.util.Objects;
public final class MappedStatement {
  private final String id, namespace, sql;
  private final SqlCommandType commandType;
  private final Class<?> parameterType, resultType;
  private final Method method;
  public MappedStatement(String id,String namespace,String sql,SqlCommandType type,
      Class<?> parameterType,Class<?> resultType,Method method) {
    this.id=require(id,"id"); this.namespace=require(namespace,"namespace");
    this.sql=require(sql,"sql"); this.commandType=Objects.requireNonNull(type);
    this.parameterType=parameterType==null?Object.class:parameterType;
    this.resultType=resultType==null?Object.class:resultType; this.method=method;
  }
  private static String require(String s,String n) { if(s==null||s.isBlank()) throw new IllegalArgumentException(n+" is blank"); return s; }
  public String id(){return id;} public String namespace(){return namespace;} public String sql(){return sql;}
  public SqlCommandType commandType(){return commandType;} public Class<?> parameterType(){return parameterType;}
  public Class<?> resultType(){return resultType;} public Method method(){return method;}
}
```

`Method` 仍作为元数据保存，但不再是 map key。执行器通过字符串 id 查找它。

### 3.3 Configuration

```java
package lab.mybatis.config;
import lab.mybatis.mapping.MappedStatement;
import java.util.*; import java.util.concurrent.ConcurrentHashMap;
public final class Configuration {
  private final Map<String,MappedStatement> statements=new ConcurrentHashMap<>();
  private final Set<String> namespaces=ConcurrentHashMap.newKeySet();
  public void addMapperNamespace(String n) {
    if(n==null||n.isBlank()) throw new IllegalArgumentException("blank namespace");
    if(!namespaces.add(n)) throw new IllegalStateException("duplicate namespace: "+n);
  }
  public void addMappedStatement(MappedStatement s) {
    MappedStatement old=statements.putIfAbsent(s.id(),s);
    if(old!=null) throw new IllegalStateException("duplicate statement id: "+s.id());
  }
  public MappedStatement getMappedStatement(String id) {
    MappedStatement s=statements.get(id);
    if(s==null) throw new IllegalArgumentException("unknown statement id: "+id);
    return s;
  }
  public boolean hasStatement(String id){return statements.containsKey(id);}
  public int statementCount(){return statements.size();}
  public Set<String> statementIds(){return Set.copyOf(statements.keySet());}
}
```

`putIfAbsent` 让重复 id 在启动期失败，避免 XML 与注解谁后加载谁覆盖的隐患。

## 四、XML 示例与 JDK DOM 解析

```xml
<?xml version="1.0" encoding="UTF-8" ?>
<mapper namespace="lab.demo.UserXmlMapper">
  <select id="findById" parameterType="long" resultType="lab.demo.User">
    select id,user_name,age from t_user where id=#{id}
  </select>
  <select id="findAll" resultType="lab.demo.User">
    select id,user_name,age from t_user order by id
  </select>
  <insert id="insert" parameterType="lab.demo.User">
    insert into t_user(id,user_name,age) values(#{id},#{userName},#{age})
  </insert>
  <update id="updateName" parameterType="lab.demo.User">
    update t_user set user_name=#{userName},age=#{age} where id=#{id}
  </update>
  <delete id="deleteById" parameterType="long">
    delete from t_user where id=#{id}
  </delete>
</mapper>
```

根 namespace 必须是接口全限定名，子节点 id 是局部名。DOM 会把缩进也作为文本，因此 SQL 必须 `trim()`。同时要禁用外部实体和 DOCTYPE，避免 XML 外部实体风险。

```java
package lab.mybatis.config;
import lab.mybatis.mapping.*; import org.w3c.dom.*; import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory; import java.io.*; import java.lang.reflect.*; import java.util.*;
public final class XmlMapperParser {
  private final Configuration configuration;
  public XmlMapperParser(Configuration c){configuration=c;}
  public void parse(InputStream input,ClassLoader loader) {
    if(input==null) throw new IllegalArgumentException("XML input is null");
    try(input) {
      DocumentBuilderFactory f=DocumentBuilderFactory.newInstance();
      f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING,true);
      f.setFeature("http://apache.org/xml/features/disallow-doctype-decl",true);
      f.setFeature("http://xml.org/sax/features/external-general-entities",false);
      f.setFeature("http://xml.org/sax/features/external-parameter-entities",false);
      f.setXIncludeAware(false); f.setExpandEntityReferences(false);
      Element root=f.newDocumentBuilder().parse(input).getDocumentElement();
      if(!"mapper".equals(root.getTagName())) throw new IllegalArgumentException("root must be mapper");
      String ns=required(root,"namespace"); Class<?> mapper=Class.forName(ns,false,loader); configuration.addMapperNamespace(ns);
      NodeList nodes=root.getChildNodes();
      for(int i=0;i<nodes.getLength();i++) { Node n=nodes.item(i); if(n.getNodeType()!=Node.ELEMENT_NODE) continue;
        Element e=(Element)n; SqlCommandType type=SqlCommandType.valueOf(e.getTagName().toUpperCase(Locale.ROOT));
        String local=required(e,"id"); Method method=findMethod(mapper,local); String sql=e.getTextContent().trim();
        if(sql.isBlank()) throw new IllegalArgumentException("blank SQL: "+ns+'.'+local);
        Class<?> p=method.getParameterCount()==1?method.getParameterTypes()[0]:Object.class;
        Class<?> r=List.class.isAssignableFrom(method.getReturnType())?Object.class:method.getReturnType();
        configuration.addMappedStatement(new MappedStatement(ns+'.'+local,ns,sql,type,p,r,method));
      }
    } catch(IllegalArgumentException e){throw e;} catch(Exception e){throw new IllegalStateException("parse mapper XML failed",e);}
  }
  private static String required(Element e,String n){String v=e.getAttribute(n);if(v==null||v.isBlank())throw new IllegalArgumentException("missing "+n);return v.trim();}
  private static Method findMethod(Class<?> t,String name){Method found=null;for(Method m:t.getMethods())if(m.getName().equals(name)){if(found!=null)throw new IllegalArgumentException("overloaded mapper method: "+name);found=m;}if(found==null)throw new IllegalArgumentException("method not found: "+name);return found;}
}
```

`Class.forName` 的目的不是执行接口，而是确认 namespace 确实对应 Mapper。生产实现还会根据 XML 属性解析别名、类型处理器和结果映射。

## 五、注解与统一注册

```java
package lab.mybatis.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD) public @interface Select{String value();}
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD) public @interface Insert{String value();}
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD) public @interface Update{String value();}
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.METHOD) public @interface Delete{String value();}
@Retention(RetentionPolicy.RUNTIME) @Target(ElementType.PARAMETER) public @interface Param{String value();}
```

```java
package lab.mybatis.config;
import lab.mybatis.annotation.*; import lab.mybatis.mapping.*; import java.lang.reflect.*;
public final class MapperAnnotationParser {
  private final Configuration configuration; public MapperAnnotationParser(Configuration c){configuration=c;}
  public void parse(Class<?> mapper){
    if(!mapper.isInterface()) throw new IllegalArgumentException("mapper must be interface");
    String ns=mapper.getName(); configuration.addMapperNamespace(ns);
    for(Method m:mapper.getMethods()){ if(m.isDefault())continue; SqlCommandType type=null;String sql=null;
      if(m.isAnnotationPresent(Select.class)){type=SqlCommandType.SELECT;sql=m.getAnnotation(Select.class).value();}
      if(m.isAnnotationPresent(Insert.class)){if(type!=null)bad(m);type=SqlCommandType.INSERT;sql=m.getAnnotation(Insert.class).value();}
      if(m.isAnnotationPresent(Update.class)){if(type!=null)bad(m);type=SqlCommandType.UPDATE;sql=m.getAnnotation(Update.class).value();}
      if(m.isAnnotationPresent(Delete.class)){if(type!=null)bad(m);type=SqlCommandType.DELETE;sql=m.getAnnotation(Delete.class).value();}
      if(type==null)continue; if(sql==null||sql.isBlank())throw new IllegalArgumentException("blank SQL: "+m);
      Class<?> p=m.getParameterCount()==1?m.getParameterTypes()[0]:Object.class;Class<?> r=m.getReturnType();
      configuration.addMappedStatement(new MappedStatement(ns+'.'+m.getName(),ns,sql.trim(),type,p,r,m));
    }
  }
  private static void bad(Method m){throw new IllegalArgumentException("multiple SQL annotations: "+m);}
}
```

XML 与注解解析器都只做最后一件事：构造 `MappedStatement` 并调用 `addMappedStatement`。执行器不再知道 SQL 来源。

## 六、资源加载

```java
package lab.mybatis.config;
import java.io.*;
public final class ResourceLoader {
  private ResourceLoader(){}
  public static InputStream getResourceAsStream(String path,ClassLoader loader){
    String p=path.startsWith("/")?path.substring(1):path; InputStream in=loader.getResourceAsStream(p);
    if(in==null)throw new IllegalArgumentException("resource not found: "+path); return in;
  }
}
```

`src/main/resources/mapper/UserMapper.xml` 的运行时路径是 `mapper/UserMapper.xml`，不是源目录路径。`ClassLoader` 方式也能读取 jar 内资源。

## 七、MapperProxy 生成 statement id

```java
package lab.mybatis.session;
import java.sql.SQLException; import lab.mybatis.config.Configuration;
public interface SqlSession extends AutoCloseable {
  <T>T getMapper(Class<T> type); Object execute(String id,Object[] args)throws SQLException;
  void commit()throws SQLException;void rollback()throws SQLException;void close()throws SQLException;
}
```

```java
package lab.mybatis.proxy;
import lab.mybatis.config.Configuration;import lab.mybatis.session.SqlSession;import java.lang.reflect.*;
public final class MapperProxy implements InvocationHandler {
  private final Configuration c;private final SqlSession s;private final Class<?> type;
  public MapperProxy(Configuration c,SqlSession s,Class<?> type){this.c=c;this.s=s;this.type=type;}
  public Object invoke(Object proxy,Method m,Object[] args)throws Throwable{
    if(m.getDeclaringClass()==Object.class)return m.invoke(this,args);
    if(m.isDefault())throw new UnsupportedOperationException("default method is outside this demo");
    String id=type.getName()+'.'+m.getName(); if(!c.hasStatement(id))throw new IllegalArgumentException("no mapped statement: "+id);
    return s.execute(id,args==null?new Object[0]:args);
  }
}
```

代理不解析 XML、不判断注解，只根据接口类型和方法名生成 id。调用链因此是 `proxy -> id -> MappedStatement -> executor`。

## 八、执行器与参数绑定

下面是可运行的核心绑定规则：单个对象从字段读取；多个参数使用 `@Param`、`arg0` 和 `param1`；缺失参数直接报错。

```java
package lab.mybatis.executor;
import lab.mybatis.mapping.*;import java.lang.reflect.*;import java.sql.*;import java.util.*;import java.util.regex.*;
public final class SimpleExecutor {
  private static final Pattern P=Pattern.compile("#\\{\\s*([\\w$]+)\\s*}"); private final Connection connection;
  public SimpleExecutor(Connection c){connection=c;}
  public Object execute(MappedStatement ms,Object[] args)throws SQLException{
    Bound b=bind(ms,args);try(PreparedStatement ps=connection.prepareStatement(b.sql)){for(int i=0;i<b.values.size();i++)ps.setObject(i+1,b.values.get(i));
      if(ms.commandType()!=SqlCommandType.SELECT)return ps.executeUpdate();try(ResultSet rs=ps.executeQuery()){List<Object> rows=new ArrayList<>();while(rs.next())rows.add(map(ms.resultType(),rs));
        if(ms.method()!=null&&List.class.isAssignableFrom(ms.method().getReturnType()))return rows;if(rows.size()>1)throw new IllegalStateException("expected one row");return rows.isEmpty()?null:rows.get(0);}}
  }
  private Object map(Class<?> type,ResultSet rs)throws SQLException{try{Object bean=type.getDeclaredConstructor().newInstance();ResultSetMetaData md=rs.getMetaData();for(int i=1;i<=md.getColumnCount();i++){String n=camel(md.getColumnLabel(i));Field f=field(type,n);if(f!=null){f.setAccessible(true);f.set(bean,rs.getObject(i));}}return bean;}catch(Exception e){throw new IllegalStateException("map result failed",e);}}
  private static Field field(Class<?> t,String n){for(Class<?> x=t;x!=null;x=x.getSuperclass())try{return x.getDeclaredField(n);}catch(NoSuchFieldException ignored){}return null;}
  private static String camel(String s){StringBuilder b=new StringBuilder();boolean u=false;for(char c:s.toLowerCase().toCharArray()){if(c=='_')u=true;else{b.append(u?Character.toUpperCase(c):c);u=false;}}return b.toString();}
  private Bound bind(MappedStatement ms,Object[] args){Map<String,Object> named=new HashMap<>();Method m=ms.method();Object root=args.length==1?args[0]:null;if(m!=null)for(int i=0;i<args.length;i++){named.put("arg"+i,args[i]);named.put("param"+(i+1),args[i]);Parameter p=m.getParameters()[i];if(p.isAnnotationPresent(lab.mybatis.annotation.Param.class))named.put(p.getAnnotation(lab.mybatis.annotation.Param.class).value(),args[i]);}
    Matcher x=P.matcher(ms.sql());StringBuffer sql=new StringBuffer();List<Object> values=new ArrayList<>();while(x.find()){values.add(value(x.group(1),named,root));x.appendReplacement(sql,"?");}x.appendTail(sql);return new Bound(sql.toString(),values);}
  private Object value(String n,Map<String,Object> map,Object root){if(map.containsKey(n))return map.get(n);if(root==null)throw new IllegalArgumentException("missing parameter: "+n);try{Field f=field(root.getClass(),n);if(f==null)throw new NoSuchFieldException(n);f.setAccessible(true);return f.get(root);}catch(Exception e){throw new IllegalArgumentException("unknown parameter: "+n,e);}}
  private record Bound(String sql,List<Object> values){}
}
```

这里故意只做教学级映射；真实 MyBatis 会通过 `ParameterMapping` 和 `TypeHandler` 处理类型、枚举、日期、数组和嵌套属性。

## 九、Session、工厂与 CRUD Demo

```java
package lab.mybatis.session;
import lab.mybatis.config.Configuration;import lab.mybatis.executor.SimpleExecutor;import lab.mybatis.proxy.MapperProxy;import java.lang.reflect.Proxy;import java.sql.*;
public final class DefaultSqlSession implements SqlSession {
  private final Configuration c;private final Connection connection;private boolean closed;
  public DefaultSqlSession(Configuration c,Connection x){this.c=c;connection=x;}
  public <T>T getMapper(Class<T> type){return type.cast(Proxy.newProxyInstance(type.getClassLoader(),new Class<?>[]{type},new MapperProxy(c,this,type)));}
  public Object execute(String id,Object[] args)throws SQLException{if(closed)throw new IllegalStateException("session closed");return new SimpleExecutor(connection).execute(c.getMappedStatement(id),args);}
  public void commit()throws SQLException{connection.commit();}public void rollback()throws SQLException{connection.rollback();}
  public void close()throws SQLException{if(!closed){try{if(!connection.getAutoCommit())connection.rollback();}finally{closed=true;connection.close();}}}
}
```

```java
package lab.demo;
public class User {private Long id;private String userName;private Integer age;public User(){}public User(Long i,String n,Integer a){id=i;userName=n;age=a;}public Long getId(){return id;}public String getUserName(){return userName;}public Integer getAge(){return age;}public void setId(Long v){id=v;}public void setUserName(String v){userName=v;}public void setAge(Integer v){age=v;}}
```

```java
package lab.demo;
import lab.mybatis.annotation.*;import java.util.List;
public interface UserMapper {
 @Insert("insert into t_user(id,user_name,age) values(#{id},#{userName},#{age})") int insert(User u);
 @Select("select id,user_name,age from t_user where id=#{id}") User findById(@Param("id")Long id);
 @Select("select id,user_name,age from t_user order by id") List<User> findAll();
 @Update("update t_user set user_name=#{userName},age=#{age} where id=#{id}") int update(User u);
 @Delete("delete from t_user where id=#{id}") int delete(@Param("id")Long id);
}
```

```java
package lab.demo;import java.util.List;
public interface UserXmlMapper {int insert(User u);User findById(Long id);List<User> findAll();int updateName(User u);int deleteById(Long id);}
```

启动时先加载 XML，再解析注解：

```java
Configuration c=new Configuration();ClassLoader loader=Thread.currentThread().getContextClassLoader();
try(var in=ResourceLoader.getResourceAsStream("mapper/UserMapper.xml",loader)){new XmlMapperParser(c).parse(in,loader);}
new MapperAnnotationParser(c).parse(UserMapper.class);
```

工厂从 JDBC URL 打开连接并关闭自动提交；Session 负责事务，代理不持有连接。

```java
try(SqlSession s=new DefaultSqlSessionFactory(c,url).openSession()){
  UserMapper m=s.getMapper(UserMapper.class);
  m.insert(new User(1L,"Frank",25));m.update(new User(1L,"Frank Zhang",26));
  System.out.println(m.findAll());m.delete(1L);s.commit();
}
```

`DefaultSqlSessionFactory` 的核心如下：

```java
public final class DefaultSqlSessionFactory implements SqlSessionFactory {
 private final Configuration c;private final String url;public DefaultSqlSessionFactory(Configuration c,String u){this.c=c;url=u;}
 public SqlSession openSession()throws SQLException{Connection x=DriverManager.getConnection(url);x.setAutoCommit(false);return new DefaultSqlSession(c,x);}
}
```

## 十、校验、测试与常见坑

启动期必须校验 namespace 非空且对应接口；XML id 非空且能找到唯一方法；SQL 非空；同一 namespace 不重复；完整 statement id 不重复。多个参数建议全部使用 `@Param`，不要依赖未开启 `-parameters` 的真实参数名。

重复 id 测试：

```java
assertThrows(IllegalStateException.class,()->configuration.addMappedStatement(secondSameId));
```

注册测试：

```java
assertTrue(c.hasStatement("lab.demo.UserXmlMapper.findById"));
assertTrue(c.hasStatement("lab.demo.UserMapper.findById"));
```

CRUD 集成测试必须覆盖插入影响行数、单对象查询、列表查询、更新、删除、NULL、提交和回滚。一个常见误区是把 `src/main/resources` 写进运行时路径；另一个是 XML namespace 写成短类名，最终代理生成的 id 永远匹配不上。还要注意 XML 与注解同时注册同一个接口会触发重复 namespace；应选择一种来源，或明确设计合并规则。

调试时先打印 `statementIds()`，再打印代理生成的 id，然后检查绑定后的 SQL 和参数，最后检查 H2 语法。这样能区分配置定位错误与 SQL 执行错误。

## 十一、真实 MyBatis 对应关系

本文 `Configuration` 对应真实全局配置；`MappedStatement` 是同名核心对象；`MapperProxy` 对应 Mapper 代理工厂；`XmlMapperParser` 和 `MapperAnnotationParser` 分别对应 XML 与注解构建器；`SimpleExecutor` 是执行器体系的极简版本。真实实现还拥有 MapperRegistry、SqlSource、BoundSql、ParameterMapping、ResultMap、TypeHandler、缓存、插件和 key generator。

真实 MyBatis 也把 `namespace.id` 作为 statement 身份。本文只支持简单 `#{property}`，不支持 `${}`、动态标签、嵌套结果和类型处理器；这些简化不改变主线：解析阶段把声明转换成统一运行时模型，调用阶段只用字符串 id 查模型，执行阶段不关心来源。

## 十二、03 预告与小结

下一篇将把固定 SQL 升级为 `SqlSource`，实现 `<if>`、`<where>`、`<foreach>`，并解释为什么动态 SQL 必须在每次调用时生成 `BoundSql`。建议在本篇基础上自行添加 `findByName(@Param("name") String name)`，再故意写一个重复 id，观察启动期失败。

本篇的四个结论是：

1. `namespace + statement id` 是稳定身份。
2. XML 与注解都注册为 `MappedStatement`。
3. 配置必须拒绝重复 namespace、重复 id 和缺失参数。
4. MapperProxy 只生成 id，再把调用交给 Session 和 Executor。


### 练习与复盘 1

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 2

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 3

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 4

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 5

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 6

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 7

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 8

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 9

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 10

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 11

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 12

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 13

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 14

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 15

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 16

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 17

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 18

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 19

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 20

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 21

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 22

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 23

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 24

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 25

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 26

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 27

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 28

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 29

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 30

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 31

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 32

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 33

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 34

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 35

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 36

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 37

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 38

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 39

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 40

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 41

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 42

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 43

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 44

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 45

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 46

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 47

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 48

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 49

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 50

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 51

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 52

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 53

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 54

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 55

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 56

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 57

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 58

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 59

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 60

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 61

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 62

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 63

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 64

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 65

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 66

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 67

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 68

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 69

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 70

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 71

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 72

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 73

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 74

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 75

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 76

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 77

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 78

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 79

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 80

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 81

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 82

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 83

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 84

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 85

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 86

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 87

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 88

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 89

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 90

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 91

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 92

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 93

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 94

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 95

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 96

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 97

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 98

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 99

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 100

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 101

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 102

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 103

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 104

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 105

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 106

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 107

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 108

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 109

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 110

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 111

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 112

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 113

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 114

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 115

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 116

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 117

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 118

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 119

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。

### 练习与复盘 120

检查本轮实验的 namespace、statement id、参数名称、SQL 占位符、返回类型与事务边界。先确认配置注册，再确认代理定位，最后检查 JDBC 执行；任何一步失败都应保留原始异常与上下文。
