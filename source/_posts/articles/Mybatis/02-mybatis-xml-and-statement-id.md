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
description: 承接第 01 篇的注解 Mapper，在既有工程中新增 XMLMapperBuilder、XMLConfigBuilder 与 Resources，把 XML 与注解统一为字符串 statement id 的 MappedStatement 注册模型。
lang: zh-CN
---

> 本文承接第 01 篇。第 01 篇已经完成固定注解 SQL、`PreparedSql`、Executor、事务、`SqlSession` 和 JDK Mapper 代理。本篇只增加 XML Mapper 与统一 statement id：XML、注解都在启动期构造成同一种 `MappedStatement`，运行期代理只按字符串 id 路由。

本文严格对应已有项目 `D:\Projects\mini-mybatis-lab`：Java 17、H2 2.3.232、JUnit 5.10.2，真实根包是 `com.frank.mybatis`。不要创建 lab 包、独立 `pom.xml`、新 Maven 工程或嵌套外壳；直接在第 01 篇完成后的同一项目中增量修改。

## 1. 为什么从 Method key 迁移到 String id

**为什么需要这一步：** 本篇一切改动的源头是一个身份问题——XML 里的语句在启动期就存在，代理在运行期才拿到 `Method`，两个世界需要同一个稳定名字。下面的推导给出答案：字符串 statement id。

![图 1：为什么用字符串 statement id](method-key-vs-string-id.svg)

反射 `Method` 适合读取 `@Param` 和返回类型，但不适合做 XML 与注解共同的全局配置身份：XML 在启动期解析，代理在运行期取得 `Method`。两者需要一个不依赖具体反射对象的稳定名称。

```text
完整 statement id = namespace + "." + local id
com.frank.mybatis.chapter02.UserMapper.findById
└────────────── namespace ──────────────┘ └─ local id ─┘
```

本篇规定：Mapper 接口的全限定名就是 XML `namespace`；接口方法名就是 XML 的局部 `id`；Configuration 只用完整字符串 id 索引 `MappedStatement`。`Method` 仍可保留在代理调用时解析实参，但绝不再作为 Configuration 的 key。

```text
mybatis-config.xml / 注解接口
          │
          ▼
XMLConfigBuilder / XMLMapperBuilder / MapperAnnotationBuilder
          │
          ▼
Configuration: Map<String, MappedStatement>
          │
          ▼
MapperProxy → MapperMethod → statement id → SqlSession
```

本篇支持固定 SQL 的 `<select>`、`<insert>`、`<update>`、`<delete>`，以及第 01 篇已有的 SQL 注解。暂不实现别名、`resultMap`、动态 SQL、`${}`、Mapper 继承、default 方法、重载、缓存和插件。

## 2. 施工清单与前置接口

**为什么需要这一步：** 增量施工先划清改与不改。清单里最值得注意的是「SqlSession 和 Executor 保持原有边界」——本篇只动配置与路由层，执行层零改动，这也是 statement id 统一后收益的第一份证据。

以下路径都相对 `D:\Projects\mini-mybatis-lab`。`[修改]` 是第 01 篇已有文件；`[新增]` 是本篇新文件。业务 Mapper、测试实体和 XML 仍放在 `src/test`，不是框架主代码。

```text
[修改] src/main/java/com/frank/mybatis/mapping/MappedStatement.java
[修改] src/main/java/com/frank/mybatis/session/Configuration.java
[修改] src/main/java/com/frank/mybatis/binding/MapperProxy.java
[修改] src/main/java/com/frank/mybatis/binding/MapperProxyFactory.java
[修改] src/main/java/com/frank/mybatis/binding/MapperRegistry.java
[修改] src/main/java/com/frank/mybatis/builder/MapperAnnotationBuilder.java
[新增] src/main/java/com/frank/mybatis/binding/MapperMethod.java
[新增] src/main/java/com/frank/mybatis/builder/Resources.java
[新增] src/main/java/com/frank/mybatis/builder/XMLConfigBuilder.java
[新增] src/main/java/com/frank/mybatis/builder/XMLMapperBuilder.java
[新增] src/test/resources/mybatis-config.xml
[新增] src/test/resources/mapper/UserMapper.xml
[新增] src/test/java/com/frank/mybatis/chapter02/UserMapper.java
[新增] src/test/java/com/frank/mybatis/chapter02/AnnotationUserMapper.java
[新增] src/test/java/com/frank/mybatis/chapter02/MiniMybatisChapter02Test.java
```

第 01 篇的 `SqlSession` 和 Executor 保持原有边界，不要另起一套 `execute(String, Object[])` 接口：

```java
// 第 01 篇已有，继续使用。
<T> T selectOne(String id, Map<String, Object> parameters, Class<T> type);
<T> List<T> selectList(String id, Map<String, Object> parameters, Class<T> type);
int insert(String id, Map<String, Object> parameters);
int update(String id, Map<String, Object> parameters);
int delete(String id, Map<String, Object> parameters);
```

本篇的 `MapperMethod` 会按 `MappedStatement.commandType()` 调用这些现有方法。Executor、Transaction、`DefaultSqlSession`、`DefaultSqlSessionFactory` 无需重写；这正是 statement id 统一后的好处。

### 章节测试约定

本篇各节新增方法统一追加到第 11 节的 `MiniMybatisChapter02Test`，复用其 `configuration`、`factory`、JUnit 静态导入和 H2 夹具；需要额外类型时使用全限定名。先完成第 11 节夹具，再按章节运行 `mvn -Dtest=MiniMybatisChapter02Test#方法名 test`。第 1、2 节的身份规则和接口兼容性分别由元数据测试、路由测试以及现有 CRUD 回归覆盖。

## 3. [修改] `mapping/MappedStatement.java`

**为什么需要这一步：** XML 和注解两条解析路径迟早会写出两套相似的校验（id 匹配、返回形状、SQL 解析），一旦规则分叉，同一句 SQL 会因为来源不同而行为不同。收敛成 `fromMapperMethod` 一个工厂入口，两条路径共享同一份规则。

![图 2：两种来源汇入同一个工厂方法](one-factory-convergence.svg)

**文件：** `src/main/java/com/frank/mybatis/mapping/MappedStatement.java`
**package：** `com.frank.mybatis.mapping`

第 01 篇的记录已经保存字符串 id；本篇将“由注解构建器内部拼装”的逻辑收敛为 `fromMapperMethod`。XMLBuilder 和注解 Builder 都调用这一个工厂方法，因此它们必定拥有相同的 SQL 模板解析、id 校验和返回类型规则。

```java
package com.frank.mybatis.mapping;
import java.lang.reflect.Method;
import java.lang.reflect.ParameterizedType;
import java.lang.reflect.Type;
import java.util.List;
import java.util.Objects;
public record MappedStatement(
        String id,
        SqlCommandType commandType,
        String rawSql,
        PreparedSql preparedSql,
        Class<?> resultType,
        boolean returnsMany) {
    public MappedStatement {
        requireText(id, "statement id");
        Objects.requireNonNull(commandType, "commandType");
        requireText(rawSql, "rawSql");
        Objects.requireNonNull(preparedSql, "preparedSql");
        Objects.requireNonNull(resultType, "resultType");
    }
    public static MappedStatement fromMapperMethod(
            String id,
            SqlCommandType commandType,
            String rawSql,
            Method method) {
        Objects.requireNonNull(method, "mapper method");
        String expectedId = method.getDeclaringClass().getName()
                + "." + method.getName();
        if (!expectedId.equals(id)) {
            throw new IllegalArgumentException(
                    "statement id does not match mapper method: " + id);
        }
        String sql = requireText(rawSql, "SQL");
        ResultShape resultShape = resultShapeOf(method, commandType);
        return new MappedStatement(
                id,
                commandType,
                sql,
                SqlTemplateParser.parse(sql),
                resultShape.resultType(),
                resultShape.returnsMany());
    }
    private static ResultShape resultShapeOf(Method method, SqlCommandType commandType) {
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
    private static String requireText(String value, String label) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(label + " must not be blank");
        }
        return value.trim();
    }
    private record ResultShape(Class<?> resultType, boolean returnsMany) {
    }
}
```

`MappedStatement` 不保存某个 Session 或 Connection；配置构建完成后，它只是可被多个 Session 只读使用的元数据。查询仅支持具体 POJO 或 `List<具体 POJO>`，DML 必须返回 `int`，与第 01 篇 Executor 的行为一致。

### 本节单元测试：统一 id 与返回形状

以下方法验证工厂方法真实产出的类型信息，并确认错误 namespace 在接触 JDBC 前失败。

```java
@Test void statementFactoryValidatesIdentityAndReturnShape() throws Exception {
    var one = UserMapper.class.getMethod("findById", Long.class);
    var many = UserMapper.class.getMethod("findAll");
    var command = com.frank.mybatis.mapping.SqlCommandType.SELECT;
    var statement = com.frank.mybatis.mapping.MappedStatement.fromMapperMethod(
            UserMapper.class.getName() + ".findById", command,
            "select id,user_name,age from t_user where id=#{id}", one);
    assertEquals(User.class, statement.resultType());
    assertEquals(false, statement.returnsMany());
    assertEquals(List.of("id"), statement.preparedSql().parameterNames());
    assertTrue(com.frank.mybatis.mapping.MappedStatement.fromMapperMethod(
            UserMapper.class.getName() + ".findAll", command,
            "select id,user_name,age from t_user", many).returnsMany());
    assertThrows(IllegalArgumentException.class,
            () -> com.frank.mybatis.mapping.MappedStatement.fromMapperMethod(
                    "wrong.findById", command, "select 1", one));
    assertThrows(IllegalArgumentException.class,
            () -> com.frank.mybatis.mapping.MappedStatement.fromMapperMethod(
                    UserMapper.class.getName() + ".findById",
                    com.frank.mybatis.mapping.SqlCommandType.UPDATE, "update t_user set age=1", one));
}
```

## 4. [修改] `session/Configuration.java`

**为什么需要这一步：** 语句注册从「Mapper 接口内部」升级为跨 XML/注解的全局命名空间后，重复与冲突必须在使用前被拒绝——id 不含参数签名，重载方法天然无法区分；等到运行期才发现查错语句，比启动期失败难排查一个量级。

![图 3：三类身份歧义在注册期被拒绝](ambiguity-rejected-at-startup.svg)

**文件：** `src/main/java/com/frank/mybatis/session/Configuration.java`
**package：** `com.frank.mybatis.session`

Configuration 是唯一的全局语句注册表。它必须拒绝三类歧义：相同 namespace、相同完整 statement id、同一个接口的方法重载。因为 id 不含参数类型，`find(Long)` 和 `find(String)` 无法同时映射。

```java
package com.frank.mybatis.session;
import com.frank.mybatis.binding.MapperRegistry;
import com.frank.mybatis.builder.MapperAnnotationBuilder;
import com.frank.mybatis.mapping.MappedStatement;
import javax.sql.DataSource;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
public final class Configuration {
    private final DataSource dataSource;
    private final Map<String, MappedStatement> statements = new LinkedHashMap<>();
    private final Map<String, Class<?>> mapperNamespaces = new LinkedHashMap<>();
    private final MapperRegistry mapperRegistry = new MapperRegistry(this);
    public Configuration(DataSource dataSource) {
        this.dataSource = Objects.requireNonNull(dataSource, "dataSource");
    }
    public DataSource getDataSource() {
        return dataSource;
    }
    // 保留第 01 篇入口：直接注册接口即解析其 SQL 注解。
    public <T> void addMapper(Class<T> mapperType) {
        new MapperAnnotationBuilder(this, mapperType).parse();
    }
    // 仅供 builder 在语句已解析完成后注册 namespace 和代理。
    public synchronized <T> void addMapperNamespace(Class<T> mapperType) {
        Objects.requireNonNull(mapperType, "mapperType");
        if (!mapperType.isInterface()) {
            throw new IllegalArgumentException(
                    "Mapper must be an interface: " + mapperType.getName());
        }
        validateNoOverloads(mapperType);
        String namespace = mapperType.getName();
        if (mapperNamespaces.containsKey(namespace)) {
            throw new IllegalStateException("Duplicate mapper namespace: " + namespace);
        }
        mapperRegistry.addMapper(mapperType);
        mapperNamespaces.put(namespace, mapperType);
    }
    public synchronized void addMappedStatement(MappedStatement statement) {
        Objects.requireNonNull(statement, "statement");
        if (statements.putIfAbsent(statement.id(), statement) != null) {
            throw new IllegalStateException("Duplicate statement id: " + statement.id());
        }
    }
    public MappedStatement getMappedStatement(String id) {
        MappedStatement statement = statements.get(id);
        if (statement == null) {
            throw new IllegalArgumentException("Unknown statement id: " + id);
        }
        return statement;
    }
    public boolean hasStatement(String id) {
        return statements.containsKey(id);
    }
    public Set<String> getStatementIds() {
        return Set.copyOf(statements.keySet());
    }
    public MapperRegistry getMapperRegistry() {
        return mapperRegistry;
    }
    private static void validateNoOverloads(Class<?> mapperType) {
        Map<String, Method> byName = new LinkedHashMap<>();
        for (Method method : mapperType.getDeclaredMethods()) {
            if (method.isBridge() || method.isSynthetic()) {
                continue;
            }
            if (byName.putIfAbsent(method.getName(), method) != null) {
                throw new IllegalArgumentException(
                        "Overloaded mapper methods are not supported: "
                                + mapperType.getName() + "." + method.getName());
            }
        }
    }
}
```

`LinkedHashMap` 让 `getStatementIds()` 的输出顺序稳定，便于调试。Configuration 只持有共享 `DataSource` 和只读元数据，绝不持有单个请求的 Connection。

### 本节单元测试：重复 namespace 与只读快照

```java
@Test void configurationRejectsDuplicateNamespaceAndProtectsIds() {
    assertThrows(IllegalStateException.class,
            () -> configuration.addMapperNamespace(UserMapper.class));
    assertThrows(IllegalArgumentException.class,
            () -> configuration.getMappedStatement("missing.findById"));
    var ids = configuration.getStatementIds();
    assertThrows(UnsupportedOperationException.class, ids::clear);
    assertEquals(6, configuration.getStatementIds().size());
}
```

只验证集合成员，不断言 `Set.copyOf` 的迭代顺序；内部使用 `LinkedHashMap` 不代表返回的 Set 保留顺序。

## 5. [新增] classpath 资源加载器

**为什么需要这一步：** XML 一旦成为配置来源，「从哪里读文件」就是第一个现实问题：源码目录里的路径在测试运行时和 jar 包里根本不存在。统一走 classpath，开发、测试、打包三种形态才是同一条路径。

**文件：** `src/main/java/com/frank/mybatis/builder/Resources.java`
**package：** `com.frank.mybatis.builder`

不要使用 `new FileInputStream("src/test/resources/..." )`。Maven 打包后资源位于 classpath，未必是磁盘普通文件；统一使用 classpath 路径，如 `mapper/UserMapper.xml`。

```java
package com.frank.mybatis.builder;
import java.io.InputStream;
public final class Resources {

    private Resources() {
    }

    public static InputStream getResourceAsStream(String resource) {
        if (resource == null || resource.isBlank()) {
            throw new IllegalArgumentException("Resource path must not be blank");
        }
        String path = resource.startsWith("/") ? resource.substring(1) : resource;
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        if (loader == null) {
            loader = Resources.class.getClassLoader();
        }
        InputStream input = loader.getResourceAsStream(path);
        if (input == null) {
            throw new IllegalArgumentException("Classpath resource not found: " + path);
        }
        return input;
    }
}
```

### 本节单元测试：classpath 路径与缺失资源

```java
@Test void resourcesSupportLeadingSlashAndRejectMissingPaths() throws Exception {
    try (var plain = Resources.getResourceAsStream("mybatis-config.xml");
         var slash = Resources.getResourceAsStream("/mybatis-config.xml")) {
        org.junit.jupiter.api.Assertions.assertArrayEquals(
                plain.readAllBytes(), slash.readAllBytes());
    }
    assertThrows(IllegalArgumentException.class, () -> Resources.getResourceAsStream(" "));
    assertThrows(IllegalArgumentException.class,
            () -> Resources.getResourceAsStream("mapper/does-not-exist.xml"));
}
```

## 6. [新增] `builder/XMLConfigBuilder.java`

**为什么需要这一步：** Mapper 的清单本身也需要一个声明处——硬编码在 Java 里意味着每加一份 XML 都要改代码。同时解析 XML 的第一课是安全：禁用 DOCTYPE 与外部实体不是可选项，XXE 是真实攻击面。

![图 4：classpath 统一加载与 XXE 防护](classpath-loading-and-xxe.svg)

**文件：** `src/main/java/com/frank/mybatis/builder/XMLConfigBuilder.java`
**package：** `com.frank.mybatis.builder`

本篇最小配置文件只列出 Mapper 来源。它不管理环境、DataSource 或事务，DataSource 仍由 Java 测试代码传给 Configuration。DOM 解析必须禁用 `DOCTYPE` 和外部实体，避免 XML External Entity（XXE）攻击。

```java
package com.frank.mybatis.builder;

import com.frank.mybatis.session.Configuration;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;
import org.xml.sax.EntityResolver;
import org.xml.sax.InputSource;

import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilder;
import javax.xml.parsers.DocumentBuilderFactory;
import java.io.InputStream;
import java.io.StringReader;
import java.util.Objects;

public final class XMLConfigBuilder {

    private final Configuration configuration;

    public XMLConfigBuilder(Configuration configuration) {
        this.configuration = Objects.requireNonNull(configuration, "configuration");
    }

    public Configuration parse(InputStream input) {
        Document document = parseDocument(input, "mybatis configuration");
        Element root = document.getDocumentElement();
        if (!"configuration".equals(root.getTagName())) {
            throw new IllegalArgumentException("Root element must be <configuration>");
        }
        Element mappers = onlyChild(root, "mappers");
        NodeList children = mappers.getChildNodes();
        for (int index = 0; index < children.getLength(); index++) {
            Node node = children.item(index);
            if (node.getNodeType() == Node.ELEMENT_NODE) {
                parseMapper((Element) node);
            }
        }
        return configuration;
    }

    private void parseMapper(Element mapper) {
        if (!"mapper".equals(mapper.getTagName())) {
            throw new IllegalArgumentException(
                    "Only <mapper> is allowed inside <mappers>");
        }
        String resource = attribute(mapper, "resource");
        String className = attribute(mapper, "class");
        if (resource.isEmpty() == className.isEmpty()) {
            throw new IllegalArgumentException(
                    "<mapper> must declare exactly one of resource or class");
        }
        if (!resource.isEmpty()) {
            try (InputStream input = Resources.getResourceAsStream(resource)) {
                new XMLMapperBuilder(configuration).parse(input);
            } catch (Exception exception) {
                if (exception instanceof RuntimeException runtimeException) {
                    throw runtimeException;
                }
                throw new IllegalStateException("Failed to load mapper resource: " + resource,
                        exception);
            }
            return;
        }
        try {
            ClassLoader loader = Thread.currentThread().getContextClassLoader();
            if (loader == null) {
                loader = XMLConfigBuilder.class.getClassLoader();
            }
            Class<?> mapperType = Class.forName(className, false, loader);
            new MapperAnnotationBuilder(configuration, mapperType).parse();
        } catch (ClassNotFoundException exception) {
            throw new IllegalArgumentException("Mapper class was not found: " + className,
                    exception);
        }
    }

    static Document parseDocument(InputStream input, String source) {
        if (input == null) {
            throw new IllegalArgumentException("XML input is null: " + source);
        }
        try (input) {
            DocumentBuilderFactory factory = DocumentBuilderFactory.newInstance();
            factory.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            factory.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            factory.setFeature("http://xml.org/sax/features/external-general-entities", false);
            factory.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            factory.setFeature("http://apache.org/xml/features/nonvalidating/load-external-dtd", false);
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            factory.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            factory.setXIncludeAware(false);
            factory.setExpandEntityReferences(false);

            DocumentBuilder builder = factory.newDocumentBuilder();
            EntityResolver rejectEntities = (publicId, systemId) ->
                    new InputSource(new StringReader(""));
            builder.setEntityResolver(rejectEntities);
            return builder.parse(input);
        } catch (Exception exception) {
            throw new IllegalArgumentException(
                    "Failed to parse " + source
                            + "; DOCTYPE and external entities are forbidden",
                    exception);
        }
    }

    private static Element onlyChild(Element parent, String expectedName) {
        Element found = null;
        NodeList children = parent.getChildNodes();
        for (int index = 0; index < children.getLength(); index++) {
            Node node = children.item(index);
            if (node.getNodeType() != Node.ELEMENT_NODE) {
                continue;
            }
            Element child = (Element) node;
            if (!expectedName.equals(child.getTagName()) || found != null) {
                throw new IllegalArgumentException("Expected exactly one <"
                        + expectedName + "> element");
            }
            found = child;
        }
        if (found == null) {
            throw new IllegalArgumentException("Missing <" + expectedName + "> element");
        }
        return found;
    }

    private static String attribute(Element element, String name) {
        String value = element.getAttribute(name);
        return value == null ? "" : value.trim();
    }
}
```

配置 XML 和 Mapper XML 共用 `parseDocument`，因此两类文件使用同一组 JDK 17 DOM 防护，而不是只保护其中一条路径。

### [新增] `src/test/resources/mybatis-config.xml`

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <mappers>
    <mapper resource="mapper/UserMapper.xml"/>
    <mapper class="com.frank.mybatis.chapter02.AnnotationUserMapper"/>
  </mappers>
</configuration>
```

`resource` 是 classpath 路径，不是 `src/test/resources/mapper/UserMapper.xml` 这样的源码路径。XML Mapper 与注解 Mapper 使用不同接口，因此两者可同时注册；同一接口既用 XML 又用注解会触发重复 namespace 校验。

### 本节单元测试：互斥来源与配置文件 XXE 防护

每次解析使用新的 Configuration，避免测试之间共享注册状态。输入是内存 XML，不依赖本机敏感文件是否存在。

```java
@Test void configRejectsAmbiguousSourcesAndDoctype() {
    for (String xml : List.of(
            "<configuration><mappers><mapper/></mappers></configuration>",
            "<configuration><mappers><mapper resource='x.xml' class='java.lang.String'/></mappers></configuration>",
            "<configuration><mappers/><mappers/></configuration>",
            "<!DOCTYPE configuration><configuration><mappers/></configuration>")) {
        var isolated = new Configuration(H2DatabaseSupport.newDataSource());
        assertThrows(IllegalArgumentException.class, () -> new XMLConfigBuilder(isolated)
                .parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8))), xml);
        assertTrue(isolated.getStatementIds().isEmpty());
    }
}
```

## 7. [新增] `builder/XMLMapperBuilder.java`

**为什么需要这一步：** 这是「XML 文件变成注册语句」的翻译官。严格校验（namespace 必须是接口、id 必须对应方法、SQL 非空）把拼写错误全部拦在启动期；先在局部 Map 完整解析、再统一注册，则保证半份坏文件不会污染 Configuration。

![图 5：先局部完整解析、后统一注册](parse-local-then-register.svg)

**文件：** `src/main/java/com/frank/mybatis/builder/XMLMapperBuilder.java`
**package：** `com.frank.mybatis.builder`

解析规则很严格：根节点只能是 `<mapper>`，namespace 必须加载为接口，SQL 标签只能是四种 CRUD 标签，局部 id 必须对应接口中的唯一方法，SQL 不能为空。先在局部 Map 中完整解析，再注册到 Configuration，避免半解析资源留下部分语句。

```java
package com.frank.mybatis.builder;

import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.mapping.SqlCommandType;
import com.frank.mybatis.session.Configuration;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.Node;
import org.w3c.dom.NodeList;

import java.io.InputStream;
import java.lang.reflect.Method;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

public final class XMLMapperBuilder {

    private static final Set<String> SQL_TAGS =
            Set.of("select", "insert", "update", "delete");
    private final Configuration configuration;

    public XMLMapperBuilder(Configuration configuration) {
        this.configuration = Objects.requireNonNull(configuration, "configuration");
    }

    public void parse(InputStream input) {
        Document document = XMLConfigBuilder.parseDocument(input, "mapper XML");
        Element root = document.getDocumentElement();
        if (!"mapper".equals(root.getTagName())) {
            throw new IllegalArgumentException("Root element must be <mapper>");
        }
        Class<?> mapperType = mapperType(requiredAttribute(root, "namespace"));
        Map<String, Method> methods = uniqueMethods(mapperType);
        Map<String, MappedStatement> parsed = new LinkedHashMap<>();

        NodeList children = root.getChildNodes();
        for (int index = 0; index < children.getLength(); index++) {
            Node node = children.item(index);
            if (node.getNodeType() != Node.ELEMENT_NODE) {
                continue;
            }
            Element statementElement = (Element) node;
            String tag = statementElement.getTagName();
            if (!SQL_TAGS.contains(tag)) {
                throw new IllegalArgumentException("Unsupported mapper element <"
                        + tag + "> in " + mapperType.getName());
            }
            String localId = requiredAttribute(statementElement, "id");
            Method method = methods.get(localId);
            if (method == null) {
                throw new IllegalArgumentException("No mapper method for XML statement: "
                        + mapperType.getName() + "." + localId);
            }
            if (method.isDefault()) {
                throw new IllegalArgumentException("Default mapper methods are not supported: "
                        + method);
            }
            String id = mapperType.getName() + "." + localId;
            String sql = statementElement.getTextContent().trim();
            MappedStatement statement = MappedStatement.fromMapperMethod(
                    id, commandType(tag), sql, method);
            if (parsed.putIfAbsent(id, statement) != null) {
                throw new IllegalArgumentException("Duplicate XML statement id: " + id);
            }
        }

        configuration.addMapperNamespace(mapperType);
        parsed.values().forEach(configuration::addMappedStatement);
    }

    private static Class<?> mapperType(String namespace) {
        try {
            ClassLoader loader = Thread.currentThread().getContextClassLoader();
            if (loader == null) {
                loader = XMLMapperBuilder.class.getClassLoader();
            }
            Class<?> mapperType = Class.forName(namespace, false, loader);
            if (!mapperType.isInterface()) {
                throw new IllegalArgumentException(
                        "Mapper namespace is not an interface: " + namespace);
            }
            return mapperType;
        } catch (ClassNotFoundException exception) {
            throw new IllegalArgumentException("Mapper namespace class was not found: "
                    + namespace, exception);
        }
    }

    private static Map<String, Method> uniqueMethods(Class<?> mapperType) {
        Map<String, Method> methods = new LinkedHashMap<>();
        for (Method method : mapperType.getDeclaredMethods()) {
            if (method.isBridge() || method.isSynthetic()) {
                continue;
            }
            if (methods.putIfAbsent(method.getName(), method) != null) {
                throw new IllegalArgumentException("Overloaded mapper methods are not supported: "
                        + mapperType.getName() + "." + method.getName());
            }
        }
        return methods;
    }

    private static SqlCommandType commandType(String elementName) {
        return SqlCommandType.valueOf(elementName.toUpperCase(Locale.ROOT));
    }

    private static String requiredAttribute(Element element, String name) {
        String value = element.getAttribute(name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException("Missing " + name + " on <"
                    + element.getTagName() + ">");
        }
        return value.trim();
    }
}
```

XML 不解析 `parameterType` 与 `resultType`。第 02 篇以接口方法签名为唯一类型来源，避免 XML 属性和接口声明冲突时出现第二个真相来源。

### [新增] `src/test/resources/mapper/UserMapper.xml`

`namespace` 必须精确等于接口全限定名；每个 `id` 必须精确等于方法名。本篇沿用第 01 篇已经支持的平面 `@Param` 占位符。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<mapper namespace="com.frank.mybatis.chapter02.UserMapper">
  <insert id="insert">
    insert into t_user(id, user_name, age)
    values(#{id}, #{userName}, #{age})
  </insert>
  <select id="findById">
    select id, user_name, age from t_user where id = #{id}
  </select>
  <select id="findAll">
    select id, user_name, age from t_user order by id
  </select>
  <update id="update">
    update t_user set user_name = #{userName}, age = #{age} where id = #{id}
  </update>
  <delete id="deleteById">
    delete from t_user where id = #{id}
  </delete>
</mapper>
```

### 本节单元测试：错误 XML 不留下已解析语句

```java
@Test void mapperXmlRejectsInvalidStatementsBeforeRegistration() {
    String namespace = UserMapper.class.getName();
    for (String body : List.of(
            "<select id='missing'>select 1</select>",
            "<select id='findAll'> </select>",
            "<select id='findAll'>select 1</select><select id='findAll'>select 2</select>",
            "<select id='findAll'>select 1</select><unknown/>")) {
        var isolated = new Configuration(H2DatabaseSupport.newDataSource());
        String xml = "<mapper namespace='" + namespace + "'>" + body + "</mapper>";
        assertThrows(IllegalArgumentException.class, () -> new XMLMapperBuilder(isolated)
                .parse(new ByteArrayInputStream(xml.getBytes(StandardCharsets.UTF_8))), body);
        assertTrue(isolated.getStatementIds().isEmpty());
    }
}
```

此测试固定的是“单份 XML 解析失败时不注册局部语句”；多份资源之间的原子装配仍需要额外的配置构建策略。

## 8. [修改] `builder/MapperAnnotationBuilder.java`

**为什么需要这一步：** 注解路径要和 XML 路径产出完全同构的 `MappedStatement`——都先局部解析、再走同一个工厂与注册口。否则「注解注册的语句」和「XML 注册的语句」会成为两套微妙不同的东西。

**文件：** `src/main/java/com/frank/mybatis/builder/MapperAnnotationBuilder.java`
**package：** `com.frank.mybatis.builder`

第 01 篇的 `Configuration.addMapper` 仍是注解入口；它委托本 Builder。XMLBuilder 与注解 Builder 都先构造局部语句，再调用 `Configuration.addMapperNamespace`、`addMappedStatement`。

```java
package com.frank.mybatis.builder;

import com.frank.mybatis.annotations.Delete;
import com.frank.mybatis.annotations.Insert;
import com.frank.mybatis.annotations.Select;
import com.frank.mybatis.annotations.Update;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.mapping.SqlCommandType;
import com.frank.mybatis.session.Configuration;

import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;

public final class MapperAnnotationBuilder {

    private final Configuration configuration;
    private final Class<?> mapperType;

    public MapperAnnotationBuilder(Configuration configuration, Class<?> mapperType) {
        this.configuration = Objects.requireNonNull(configuration, "configuration");
        this.mapperType = Objects.requireNonNull(mapperType, "mapperType");
    }

    public void parse() {
        if (!mapperType.isInterface()) {
            throw new IllegalArgumentException("Mapper must be an interface: "
                    + mapperType.getName());
        }
        Map<String, MappedStatement> parsed = new LinkedHashMap<>();
        for (Method method : mapperType.getDeclaredMethods()) {
            if (method.isBridge() || method.isSynthetic()) {
                continue;
            }
            if (method.isDefault() || Modifier.isStatic(method.getModifiers())) {
                throw new IllegalArgumentException("Default and static mapper methods are unsupported: "
                        + method);
            }
            String id = mapperType.getName() + "." + method.getName();
            if (parsed.containsKey(id)) {
                throw new IllegalArgumentException("Overloaded mapper methods are not supported: "
                        + id);
            }
            SqlDefinition definition = definitionOf(method);
            parsed.put(id, MappedStatement.fromMapperMethod(
                    id, definition.commandType(), definition.sql(), method));
        }
        configuration.addMapperNamespace(mapperType);
        parsed.values().forEach(configuration::addMappedStatement);
    }

    private static SqlDefinition definitionOf(Method method) {
        SqlDefinition definition = null;
        if (method.isAnnotationPresent(Select.class)) {
            definition = new SqlDefinition(SqlCommandType.SELECT,
                    method.getAnnotation(Select.class).value());
        }
        if (method.isAnnotationPresent(Insert.class)) {
            definition = onlyOne(definition, method, new SqlDefinition(SqlCommandType.INSERT,
                    method.getAnnotation(Insert.class).value()));
        }
        if (method.isAnnotationPresent(Update.class)) {
            definition = onlyOne(definition, method, new SqlDefinition(SqlCommandType.UPDATE,
                    method.getAnnotation(Update.class).value()));
        }
        if (method.isAnnotationPresent(Delete.class)) {
            definition = onlyOne(definition, method, new SqlDefinition(SqlCommandType.DELETE,
                    method.getAnnotation(Delete.class).value()));
        }
        if (definition == null) {
            throw new IllegalArgumentException("Mapper method has no SQL annotation: " + method);
        }
        return definition;
    }

    private static SqlDefinition onlyOne(
            SqlDefinition existing, Method method, SqlDefinition candidate) {
        if (existing != null) {
            throw new IllegalArgumentException("A mapper method may have only one SQL annotation: "
                    + method);
        }
        return candidate;
    }

    private record SqlDefinition(SqlCommandType commandType, String sql) {
        private SqlDefinition {
            if (sql == null || sql.isBlank()) {
                throw new IllegalArgumentException("SQL annotation must not be blank");
            }
            sql = sql.trim();
        }
    }
}
```

注解与 XML 最终都会调用 `MappedStatement.fromMapperMethod` 和 `Configuration.addMappedStatement`；Executor 不需要知道 SQL 的来源。

### [新增] `src/test/java/com/frank/mybatis/chapter02/AnnotationUserMapper.java`

**package：** `com.frank.mybatis.chapter02`

```java
package com.frank.mybatis.chapter02;

import com.frank.mybatis.annotations.Param;
import com.frank.mybatis.annotations.Select;
import com.frank.mybatis.fixture.User;

public interface AnnotationUserMapper {

    @Select("""
            select id, user_name, age
            from t_user
            where user_name = #{name}
            """)
    User findByName(@Param("name") String name);
}
```

### 本节单元测试：注解解析和 XML Mapper 的职责分离

```java
@Test void annotationBuilderRejectsMethodsWithoutSqlAnnotations() {
    var isolated = new Configuration(H2DatabaseSupport.newDataSource());
    assertThrows(IllegalArgumentException.class,
            () -> new MapperAnnotationBuilder(isolated, UserMapper.class).parse());
    assertTrue(isolated.getStatementIds().isEmpty());
    new MapperAnnotationBuilder(isolated, AnnotationUserMapper.class).parse();
    assertEquals(java.util.Set.of(AnnotationUserMapper.class.getName() + ".findByName"),
            isolated.getStatementIds());
}
```

`UserMapper` 的 SQL 来自 XML，因此直接交给注解 Builder 必须失败；通过配置 XML 装配成功则由第 11 节回归测试验证。

## 9. [新增] `binding/MapperMethod.java`

**为什么需要这一步：** 第 01 篇把路由逻辑全部塞在 `MapperProxy.invoke` 里；本篇它要同时懂 id 拼装、参数解析和 Session 方法选择，继续堆在代理里会变成上帝方法。抽成独立对象后，代理只剩「缓存 + 委托」两个动作。

![图 6：代理只做缓存与委托](proxy-method-cache.svg)

**文件：** `src/main/java/com/frank/mybatis/binding/MapperMethod.java`
**package：** `com.frank.mybatis.binding`

这是运行期“方法调用到 statement id”的绑定对象。它按完整 id 取出语句，再复用第 01 篇的 `ParameterHandler.resolve` 和 `SqlSession` CRUD 方法；它不读取 XML，也不扫描注解。

```java
package com.frank.mybatis.binding;

import com.frank.mybatis.executor.ParameterHandler;
import com.frank.mybatis.mapping.MappedStatement;
import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.SqlSession;

import java.lang.reflect.Method;
import java.util.Map;
import java.util.Objects;

public final class MapperMethod {

    private final String statementId;
    private final Method method;
    private final MappedStatement statement;

    public MapperMethod(Class<?> mapperType, Method method, Configuration configuration) {
        this.statementId = Objects.requireNonNull(mapperType, "mapperType").getName()
                + "." + Objects.requireNonNull(method, "method").getName();
        this.method = method;
        this.statement = Objects.requireNonNull(configuration, "configuration")
                .getMappedStatement(statementId);
    }

    public Object execute(SqlSession session, Object[] arguments) {
        Map<String, Object> parameters = ParameterHandler.resolve(method, arguments);
        return switch (statement.commandType()) {
            case SELECT -> statement.returnsMany()
                    ? session.selectList(statementId, parameters, statement.resultType())
                    : session.selectOne(statementId, parameters, statement.resultType());
            case INSERT -> session.insert(statementId, parameters);
            case UPDATE -> session.update(statementId, parameters);
            case DELETE -> session.delete(statementId, parameters);
        };
    }

    public String statementId() {
        return statementId;
    }
}
```

`Method` 在这里仅用于将实参解析成 `Map<String, Object>`；全局语句定位已完成字符串 id 迁移。

### 本节单元测试：路由到正确的 Session 方法

用 JDK 代理记录 Session 调用，不需要 Mockito，也不连接数据库执行 SQL。它验证 statement id、命名参数与结果类型实际传到了 Session。

```java
@Test void mapperMethodRoutesNamedParametersToSelectOne() throws Exception {
    var calls = new java.util.ArrayList<String>();
    SqlSession recording = (SqlSession) java.lang.reflect.Proxy.newProxyInstance(
            SqlSession.class.getClassLoader(), new Class<?>[]{SqlSession.class},
            (proxy, method, args) -> {
                calls.add(method.getName());
                assertEquals("selectOne", method.getName());
                assertEquals(UserMapper.class.getName() + ".findById", args[0]);
                assertEquals(java.util.Map.of("id", 7L), args[1]);
                assertEquals(User.class, args[2]);
                return null;
            });
    var binding = new com.frank.mybatis.binding.MapperMethod(UserMapper.class,
            UserMapper.class.getMethod("findById", Long.class), configuration);
    assertEquals(UserMapper.class.getName() + ".findById", binding.statementId());
    assertNull(binding.execute(recording, new Object[]{7L}));
    assertEquals(List.of("selectOne"), calls);
}
```

## 10. [修改] Mapper 代理与注册表

**为什么需要这一步：** 两个职责要各归其位：代理加上 `methodCache` 后，重复调用的反射开销只剩第一次；注册表删掉「注册即解析注解」的逻辑，否则 XML Mapper 注册时会被错误地再按注解解析一遍。

### `src/main/java/com/frank/mybatis/binding/MapperProxy.java`

**package：** `com.frank.mybatis.binding`

```java
package com.frank.mybatis.binding;

import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.SqlSession;

import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Method;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

public final class MapperProxy implements InvocationHandler {

    private final SqlSession session;
    private final Configuration configuration;
    private final Class<?> mapperType;
    private final Map<Method, MapperMethod> methodCache = new ConcurrentHashMap<>();

    public MapperProxy(SqlSession session, Configuration configuration, Class<?> mapperType) {
        this.session = session;
        this.configuration = configuration;
        this.mapperType = mapperType;
    }

    @Override
    public Object invoke(Object proxy, Method method, Object[] arguments) {
        if (method.getDeclaringClass() == Object.class) {
            return objectMethod(proxy, method, arguments);
        }
        if (method.isDefault()) {
            throw new UnsupportedOperationException("Default mapper methods are unsupported: " + method);
        }
        MapperMethod mapperMethod = methodCache.computeIfAbsent(method,
                current -> new MapperMethod(mapperType, current, configuration));
        return mapperMethod.execute(session, arguments == null ? new Object[0] : arguments);
    }

    private Object objectMethod(Object proxy, Method method, Object[] arguments) {
        return switch (method.getName()) {
            case "toString" -> "MapperProxy(" + mapperType.getName() + ")";
            case "hashCode" -> System.identityHashCode(proxy);
            case "equals" -> proxy == (arguments == null ? null : arguments[0]);
            default -> throw new UnsupportedOperationException("Unsupported Object method: " + method);
        };
    }
}
```

代理内部以 `Method` 缓存 `MapperMethod` 是安全的局部优化；Configuration 的跨来源注册表仍只使用 id。

### `src/main/java/com/frank/mybatis/binding/MapperProxyFactory.java`

**package：** `com.frank.mybatis.binding`

第 01 篇工厂构造器已保存 Configuration，只需保留其代理创建职责：

```java
package com.frank.mybatis.binding;

import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.SqlSession;

import java.lang.reflect.Proxy;

public final class MapperProxyFactory<T> {

    private final Class<T> mapperType;
    private final Configuration configuration;

    public MapperProxyFactory(Class<T> mapperType, Configuration configuration) {
        this.mapperType = mapperType;
        this.configuration = configuration;
    }

    public T newInstance(SqlSession session) {
        Object proxy = Proxy.newProxyInstance(mapperType.getClassLoader(),
                new Class<?>[]{mapperType}, new MapperProxy(session, configuration, mapperType));
        return mapperType.cast(proxy);
    }
}
```

### `src/main/java/com/frank/mybatis/binding/MapperRegistry.java`

**package：** `com.frank.mybatis.binding`

关键变化是移除 `new MapperAnnotationBuilder(...).parse()`：注册表只管理代理工厂，构建器才负责解析 XML 或注解。否则 XML Mapper 注册时会被注册表再次按注解解析。

```java
package com.frank.mybatis.binding;

import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.SqlSession;

import java.util.HashMap;
import java.util.Map;

public final class MapperRegistry {

    private final Configuration configuration;
    private final Map<Class<?>, MapperProxyFactory<?>> factories = new HashMap<>();

    public MapperRegistry(Configuration configuration) {
        this.configuration = configuration;
    }

    public <T> void addMapper(Class<T> mapperType) {
        if (factories.putIfAbsent(mapperType,
                new MapperProxyFactory<>(mapperType, configuration)) != null) {
            throw new IllegalStateException("Mapper already registered: " + mapperType.getName());
        }
    }

    public <T> T getMapper(Class<T> mapperType, SqlSession session) {
        MapperProxyFactory<?> factory = factories.get(mapperType);
        if (factory == null) {
            throw new IllegalArgumentException("Mapper is not registered: " + mapperType.getName());
        }
        @SuppressWarnings("unchecked")
        MapperProxyFactory<T> typed = (MapperProxyFactory<T>) factory;
        return typed.newInstance(session);
    }
}
```

### 本节组件测试：代理身份与关闭后的调用

```java
@Test void proxyKeepsIdentityAndRejectsCallsAfterSessionClose() {
    SqlSession session = factory.openSession();
    UserMapper mapper;
    try (session) {
        mapper = session.getMapper(UserMapper.class);
        assertTrue(mapper.equals(mapper));
        assertEquals(false, mapper.equals(session.getMapper(UserMapper.class)));
        assertEquals(false, mapper.equals(null));
        assertEquals(System.identityHashCode(mapper), mapper.hashCode());
        assertTrue(mapper.toString().contains(UserMapper.class.getName()));
    }
    assertThrows(IllegalStateException.class, () -> mapper.findById(1L));
}
```

## 11. [新增] XML CRUD Mapper 与测试

**为什么需要这一步：** 组件各自正确不等于装配正确。这一节用一份 XML Mapper、一份注解 Mapper、同一个 Configuration 跑完整 CRUD——证明「两种来源、一套模型」不是口号，并覆盖重复 id、重载、XXE 等启动期拒绝路径。

### `src/test/java/com/frank/mybatis/chapter02/UserMapper.java`

**package：** `com.frank.mybatis.chapter02`

```java
package com.frank.mybatis.chapter02;

import com.frank.mybatis.annotations.Param;
import com.frank.mybatis.fixture.User;

import java.util.List;

public interface UserMapper {

    int insert(@Param("id") Long id, @Param("userName") String userName,
               @Param("age") Integer age);

    User findById(@Param("id") Long id);

    List<User> findAll();

    int update(@Param("id") Long id, @Param("userName") String userName,
               @Param("age") Integer age);

    int deleteById(@Param("id") Long id);
}
```

### `src/test/java/com/frank/mybatis/chapter02/MiniMybatisChapter02Test.java`

**package：** `com.frank.mybatis.chapter02`

测试复用第 01 篇的 `H2DatabaseSupport`，每个测试得到独立 H2 内存库和已执行的 `schema.sql`。测试覆盖 XML 与注解统一注册、CRUD、NULL、重复 id、重载和 XXE 防护。

```java
package com.frank.mybatis.chapter02;

import com.frank.mybatis.builder.MapperAnnotationBuilder;
import com.frank.mybatis.builder.Resources;
import com.frank.mybatis.builder.XMLConfigBuilder;
import com.frank.mybatis.builder.XMLMapperBuilder;
import com.frank.mybatis.fixture.User;
import com.frank.mybatis.session.Configuration;
import com.frank.mybatis.session.DefaultSqlSessionFactory;
import com.frank.mybatis.session.SqlSession;
import com.frank.mybatis.session.SqlSessionFactory;
import com.frank.mybatis.support.H2DatabaseSupport;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.sql.SQLException;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class MiniMybatisChapter02Test {

    private Configuration configuration;
    private SqlSessionFactory factory;

    @BeforeEach
    void setUp() {
        configuration = new Configuration(H2DatabaseSupport.newDataSource());
        try (InputStream input = Resources.getResourceAsStream("mybatis-config.xml")) {
            new XMLConfigBuilder(configuration).parse(input);
        } catch (Exception exception) {
            throw new IllegalStateException("Failed to initialize chapter02 configuration", exception);
        }
        factory = new DefaultSqlSessionFactory(configuration);
    }

    @Test
    void registersXmlAndAnnotationStatementsByStringId() {
        assertTrue(configuration.hasStatement(
                "com.frank.mybatis.chapter02.UserMapper.findById"));
        assertTrue(configuration.hasStatement(
                "com.frank.mybatis.chapter02.AnnotationUserMapper.findByName"));
        assertEquals(6, configuration.getStatementIds().size());
    }

    @Test
    void xmlCrudAndAnnotationQueryShareOneConfiguration() {
        try (SqlSession session = factory.openSession()) {
            UserMapper xmlMapper = session.getMapper(UserMapper.class);
            AnnotationUserMapper annotationMapper = session.getMapper(AnnotationUserMapper.class);

            assertEquals(1, xmlMapper.insert(1L, "Frank", null));
            assertEquals(1, xmlMapper.insert(2L, "Alice", 20));
            User frank = xmlMapper.findById(1L);
            assertNotNull(frank);
            assertEquals("Frank", frank.getUserName());
            assertNull(frank.getAge());

            List<User> users = xmlMapper.findAll();
            assertEquals(2, users.size());
            assertEquals("Alice", annotationMapper.findByName("Alice").getUserName());
            assertEquals(1, xmlMapper.update(1L, "Frank Zhang", 26));
            assertEquals(1, xmlMapper.deleteById(2L));
            session.commit();
        }
        try (SqlSession session = factory.openSession()) {
            UserMapper mapper = session.getMapper(UserMapper.class);
            assertEquals(1, mapper.findAll().size());
            assertEquals(26, mapper.findById(1L).getAge());
        }
    }

    @Test
    void rejectsDuplicateStatementId() {
        String id = "com.frank.mybatis.chapter02.UserMapper.findById";
        assertThrows(IllegalStateException.class,
                () -> configuration.addMappedStatement(configuration.getMappedStatement(id)));
    }

    @Test
    void rejectsOverloadedMapperMethods() {
        Configuration isolated = new Configuration(H2DatabaseSupport.newDataSource());
        assertThrows(IllegalArgumentException.class,
                () -> new MapperAnnotationBuilder(isolated, OverloadedMapper.class).parse());
    }

    @Test
    void rejectsDoctypeBeforeAnyExternalEntityCanBeResolved() {
        String malicious = """
                <!DOCTYPE mapper [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>
                <mapper namespace="com.frank.mybatis.chapter02.UserMapper">
                  <select id="findAll">select '&xxe;'</select>
                </mapper>
                """;
        Configuration isolated = new Configuration(H2DatabaseSupport.newDataSource());
        assertThrows(IllegalArgumentException.class,
                () -> new XMLMapperBuilder(isolated).parse(new ByteArrayInputStream(
                        malicious.getBytes(StandardCharsets.UTF_8))));
    }

    interface OverloadedMapper {
        User findById(Long id);
        User findById(String id);
    }
}
```

`ParameterHandler` 延续第 01 篇的职责：按 `@Param` 建立参数 Map，再按 `PreparedSql.parameterNames()` 的顺序绑定 JDBC 参数。本篇 XML 只使用平面 `#{id}`、`#{userName}`、`#{age}`，所以不会暗中要求未实现的嵌套属性或 OGNL。

## 12. 错误边界、调试顺序与验收

**为什么需要这一步：** 配置类错误的价值在于「启动即失败」。把每类错误对应到抛出位置，排错时按表索骥，而不是在 SQL 与数据库之间兜圈子。

启动期应立即失败的配置如下：

| 错误 | 失败位置 |
| --- | --- |
| `<mapper>` 同时有 resource 和 class，或两者都没有 | `XMLConfigBuilder` |
| classpath 资源不存在 | `Resources` |
| `DOCTYPE`、外部 DTD、外部实体 | `XMLConfigBuilder.parseDocument` |
| namespace 找不到类或不是接口 | `XMLMapperBuilder` |
| XML id 没有对应方法，SQL 为空，标签不支持 | `XMLMapperBuilder` |
| 多个 SQL 注解，空 SQL 注解 | `MapperAnnotationBuilder` |
| 同一 namespace、完整 id 或 Mapper 重载 | `Configuration` / Builder |
| 代理调用未配置方法 | `MapperMethod` 的 `getMappedStatement` |

调试时先输出 `configuration.getStatementIds()`，再检查接口全限定名、XML namespace 和方法名，最后才检查 SQL、参数绑定与 H2。这样可将“配置没有定位到语句”与“数据库执行失败”分开。

在 `D:\Projects\mini-mybatis-lab` 根目录执行：

```bash
mvn test
mvn package
mvn -Dtest=MiniMybatisChapter02Test test
```

完成本篇后应满足：Configuration 以 `Map<String, MappedStatement>` 保存语句；XML 与注解生成同规则 id；JDK DOM 禁止 DOCTYPE/外部实体；资源从 classpath 加载；重复 namespace/id 与重载明确失败；MapperProxy 仅按 id 路由；XML CRUD、注解查询和 `mvn test` 均通过。

下一篇再将固定 `PreparedSql` 升级为按调用生成的 `BoundSql`，逐步加入 `<if>`、`<where>`、`<foreach>`。本篇建立的 namespace、statement id、统一注册表和代理路由不需要推倒重来。

> 系列导航：上一篇：[手写 MyBatis 01：从注解 Mapper 到 JDBC 的最小闭环](/2026/09/09/articles/Mybatis/01-mybatis-mini-framework/) ｜ 本篇是第 2 篇 ｜ 下一篇：[手写 MyBatis 03：动态 SQL 与参数绑定](/2026/09/11/articles/Mybatis/03-mybatis-dynamic-sql-and-parameters/)
