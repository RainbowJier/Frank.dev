---
title: '手写 MyBatis 03：动态 SQL、${} 与丰富参数处理'
date: 2026-09-11 10:00:00
categories: [Mybatis]
tags:
  - Java
  - MyBatis
  - 动态SQL
  - 参数
description: 在 XML 配置与语句注册之上，用 Java 17、H2 和 Maven 实现 SqlNode、SqlSource、if/where/trim/foreach、Bean/Map/集合参数、安全表达式、白名单插值及可扩展 TypeHandler，并用完整测试验证绑定顺序与失败边界。
lang: zh-CN
---

> 固定 SQL 的难点是把问号与实参对齐；动态 SQL 的难点是：条件和循环改变了 SQL 结构之后，问号、值、类型、局部变量和安全边界仍然必须对齐。本篇不是把几个字符串相加，而是给 SQL 建立一套小型、可验证的执行模型。

## 一、承接 02：从配置入口走向运行时 SQL

第 01 篇把 JDBC 调用收进 Mapper 代理、会话和执行器。 第 02 篇所在的配置层阶段，解决的是 XML 如何进入配置、语句如何注册，以及如何按 statement id 找到元数据。 本篇沿着这一设计边界继续：不重新实现代理，也不另造一套事务管理，而是替换“固定 SQL 模板到参数列表”的中间层。

这里不依赖第 02 篇某个具体类名或文件路径；下面的实验工程可以独立运行。 接回系列工程时，只需要让语句元数据持有本篇的 `SqlSource`，由执行器在每次调用时取得 `BoundSql`。 结果集到 POJO 的映射、连接生命周期与事务仍由原来的组件负责。

### 1.1 本篇完成什么

| 能力 | 本文实现 | 明确边界 |
| --- | --- | --- |
| SQL 节点 | text、if、where、trim、foreach | 不含 choose、bind、include |
| SQL 来源 | StaticSqlSource、DynamicSqlSource | 静态路径仍复用统一渲染器，不做性能优化 |
| 参数根对象 | Bean、Map、Collection、数组、标量 | 不猜测多个 Java 方法参数的名字 |
| 属性读取 | public getter、record accessor、Map key | 不访问私有字段，不调用任意方法 |
| 表达式 | null、数值、布尔、比较、and/or | 不是完整 OGNL，不支持括号和字符串字面量 |
| `#{}` | 有序 ParameterMapping、PreparedStatement | null 必须提供 jdbcType |
| `${}` | 服务端枚举键到固定 SQL 片段的映射 | 默认拒绝，不提供直接拼接开关 |
| 类型 | 字符串、整数、日期时间、枚举、二进制、SQL ARRAY | 不声称所有 JDBC 驱动行为一致 |
| 验证 | JUnit 5 与真实 H2 JDBC | 不用 mock 代替数据库语义 |

### 1.2 为什么不继续返回一个 SQL 字符串

下面两个调用来自同一个 XML 模板，但 SQL 形状不同。

```text
name = null, ids = [1, 3]
=> select * from t_user WHERE id in (?,?)
=> mappings = [1, 3]

name = "Frank", ids = [1, 3]
=> select * from t_user WHERE name = ? AND id in (?,?)
=> mappings = ["Frank", 1, 3]
```

如果 SQL 是新生成的，而参数列表还是启动时缓存的，第二个调用会把名字绑定到 ID 上。 因此本篇维护一条不变量：**每次输出一个问号，就同时追加一个不可变参数映射。** 循环结束后不会再次去共享上下文里寻找最后一个 `item`。

另一个不变量是：**模板可以共享，调用上下文不能共享。** 同一个 `DynamicSqlSource` 被重复使用时，不得残留上一次的条件、循环变量或参数映射。

## 二、准备独立实验工程

### 2.1 文件结构与复制规则

以下是读者在博客仓库之外创建的练习工程，不是对博客源码目录的改造。 所有代码使用 `lab` 包，只有四个文件。

```text
mini-mybatis-03/
├── pom.xml
├── src/main/java/lab/DynamicSql.java
├── src/main/java/lab/Demo.java
└── src/test/java/lab/DynamicSqlTest.java
```

本文所有带 `framework-part` 标记的 Java 代码块，按顺序拼成 `DynamicSql.java`。 它们共用一个外壳类，最后一个框架块负责关闭外壳。 `demo-file` 与 `test-file` 后面的代码分别是完整的另外两个 Java 文件。 不要把解释用的 SQL、命令、输出块一起复制进 Java 文件。

### 2.2 Maven 配置

依赖版本固定，编译器固定为 Java 17，并明确使用 UTF-8，避免 Windows 默认编码影响中文测试字符串。 H2 放在普通依赖中，因为 Demo 也要使用它；JUnit 只用于测试。

<!-- pom-file -->
```xml
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>
  <groupId>lab</groupId>
  <artifactId>mini-mybatis-03</artifactId>
  <version>1.0-SNAPSHOT</version>
  <properties>
    <maven.compiler.release>17</maven.compiler.release>
    <project.build.sourceEncoding>UTF-8</project.build.sourceEncoding>
  </properties>
  <dependencies>
    <dependency>
      <groupId>com.h2database</groupId><artifactId>h2</artifactId><version>2.3.232</version>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId><artifactId>junit-jupiter</artifactId>
      <version>5.12.2</version><scope>test</scope>
    </dependency>
  </dependencies>
  <build>
    <plugins>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-compiler-plugin</artifactId>
        <version>3.13.0</version>
      </plugin>
      <plugin>
        <groupId>org.apache.maven.plugins</groupId><artifactId>maven-surefire-plugin</artifactId>
        <version>3.5.2</version>
      </plugin>
      <plugin>
        <groupId>org.codehaus.mojo</groupId><artifactId>exec-maven-plugin</artifactId>
        <version>3.5.0</version>
      </plugin>
    </plugins>
  </build>
</project>
```

## 三、先定义调用产物：BoundSql 与参数快照

### 3.1 三层对象不要混在一起

`SqlNode` 是模板树上的节点，负责向当前上下文输出 SQL。 `SqlSource` 是模板入口，负责为一次参数调用创建上下文。 `BoundSql` 是一次调用的结果，携带最终 SQL 和按出现顺序排列的参数映射。

真实 MyBatis 的 `ParameterMapping` 主要记录属性名、类型与处理器等元数据，值常由参数对象和 additionalParameters 取得。 本文为了把循环作用域讲清楚，选择在渲染时直接捕获参数值。 这是教学上的不同实现，不应据此认为真实 MyBatis 也是把所有值放在 ParameterMapping 内。

<!-- framework-part -->
```java
package lab;

import java.beans.Introspector;
import java.io.StringReader;
import java.lang.reflect.Array;
import java.math.BigDecimal;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.regex.*;
import javax.xml.XMLConstants;
import javax.xml.parsers.DocumentBuilderFactory;
import org.w3c.dom.*;
import org.xml.sax.InputSource;
import org.xml.sax.SAXException;
import org.xml.sax.helpers.DefaultHandler;

public final class DynamicSql {
    private DynamicSql() {}
    static IllegalArgumentException bad(String message) {
        return new IllegalArgumentException(message);
    }
    public record ParameterMapping(String path, Object value, JDBCType jdbcType) {}
    public record BoundSql(String sql, List<ParameterMapping> mappings) {
        public BoundSql { mappings = List.copyOf(mappings); }
    }
    public interface SqlNode { void apply(Context context); }
    public interface SqlSource { BoundSql getBoundSql(Object parameter); }
    public record StaticSqlSource(SqlNode root, Policy policy) implements SqlSource {
        public BoundSql getBoundSql(Object parameter) { return render(root, policy, parameter); }
    }
    public record DynamicSqlSource(SqlNode root, Policy policy) implements SqlSource {
        public BoundSql getBoundSql(Object parameter) { return render(root, policy, parameter); }
    }
    static BoundSql render(SqlNode root, Policy policy, Object parameter) {
        Context c = new Context(parameter, Map.of(), policy);
        root.apply(c);
        return new BoundSql(c.sql.toString().trim(), c.mappings);
    }
    static final class Context {
        final Object root;
        final Map<String, Object> locals;
        final Policy policy;
        final StringBuilder sql = new StringBuilder();
        final List<ParameterMapping> mappings = new ArrayList<>();
        Context(Object root, Map<String, Object> locals, Policy policy) {
            this.root = root; this.locals = locals; this.policy = policy;
        }
        Context child() { return new Context(root, new HashMap<>(locals), policy); }
        Object value(String path) { return resolve(root, locals, path); }
        void append(Context child, String text) {
            sql.append(text); mappings.addAll(child.mappings);
        }
    }
```

`BoundSql` 复制列表，因此外部不能增删映射。 但这里不是对整个参数对象图做深拷贝：传入可变对象后，不应在 JDBC 绑定前由另一个线程修改它。 `Context.child()` 为 trim 和 foreach 提供暂存区域，只有子节点成功生成完整结果后才合并。 任何渲染异常都发生在创建 PreparedStatement 之前。

## 四、统一参数根对象：Map、Bean、集合与数组

### 4.1 先固定命名规则

| 输入 | 可用路径 | 说明 |
| --- | --- | --- |
| 单个 Bean / record | `name`、`user.address.city` | getter / record accessor |
| 单个 Map | `name`、`filter.name` | 必须存在 key，存在且为 null 是合法值 |
| 单个 Collection | `collection`、`collection.size` | List 额外支持 `list` 别名 |
| 单个 Java 数组 | `array`、`array.size` | 同时支持基本类型数组 |
| 任意根对象 | `_parameter` | 标量参数可写 `#{_parameter}` |
| 多个 Mapper 实参 | 由代理显式组成 Map | 本模块不依赖 `-parameters` 推断名称 |

如果代理收到 `find(name, ids)`，参数解析器应创建包含 `name`、`ids` 的 Map。 不要用 `Map.of` 装可能为 null 的实参；它会在 SQL 渲染之前抛出 NullPointerException。 `_parameter` 与集合别名属于保留入口，需要访问同名 Map key 时可以使用 `_parameter.key`。

### 4.2 缺失属性与 null 必须区分

`containsKey("name") == false` 通常是拼写错误；`containsKey("name") == true` 且值为 null 是业务输入。 我们只对后者允许 null 传播。 读取 `user.address.city` 时，若已存在的 `address` 为 null，后续路径返回 null；不会伪造一个空地址对象。

<!-- framework-part -->
```java
    static final String PATH = "[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z_][A-Za-z0-9_]*)*";
    static Object resolve(Object root, Map<String, Object> locals, String path) {
        if (!path.matches(PATH)) throw bad("非法属性路径: " + path);
        String[] parts = path.split("\\.");
        String first = parts[0];
        Object value;
        if (locals.containsKey(first)) value = locals.get(first);
        else if (first.equals("_parameter")) value = root;
        else if (first.equals("collection") && root instanceof Collection<?>) value = root;
        else if (first.equals("list") && root instanceof List<?>) value = root;
        else if (first.equals("array") && root != null && root.getClass().isArray()) value = root;
        else value = property(root, first);
        for (int i = 1; i < parts.length; i++) value = property(value, parts[i]);
        return value;
    }
    static Object property(Object object, String name) {
        if (name.equals("class")) throw bad("禁止 class 属性");
        if (object == null) return null;
        if (object instanceof Map<?, ?> map) {
            if (!map.containsKey(name)) throw bad("缺少 Map key: " + name);
            return map.get(name);
        }
        if (name.equals("size") && object instanceof Collection<?> c) return c.size();
        if (name.equals("size") && object.getClass().isArray()) return Array.getLength(object);
        try {
            if (object.getClass().isRecord()) {
                for (var component : object.getClass().getRecordComponents()) {
                    if (component.getName().equals(name)) return component.getAccessor().invoke(object);
                }
            }
            for (var pd : Introspector.getBeanInfo(object.getClass(), Object.class).getPropertyDescriptors()) {
                if (pd.getName().equals(name) && pd.getReadMethod() != null) {
                    return pd.getReadMethod().invoke(object);
                }
            }
        } catch (Exception e) {
            throw new IllegalArgumentException("读取属性失败: " + name, e);
        }
        throw bad("缺少可读属性: " + object.getClass().getName() + "." + name);
    }
```

这里故意不调用 `setAccessible(true)`。 实验 Bean 的类与 getter 必须 public，record 也采用 public 声明。 生产框架可以缓存属性描述符，但不要把“反射缓存”与“把某次调用的属性值缓存起来”混为一谈。

集合的 `size` 是引擎内建属性，不会把表达式中的任意 `size()` 方法调用放行。 对于 Map，先按 key 读取：`filter.size` 是 key `size`，不是 Map 的元素数量。 嵌套集合、嵌套数组则可以沿普通属性路径继续访问。

## 五、表达式：选择安全子集，而不是假装实现 OGNL

### 5.1 支持的语法

本篇表达式只服务于条件选择，语法如下。

```text
expression := conjunction ("or" conjunction)*
conjunction := comparison ("and" comparison)*
comparison := operand (== | != | > | >= | < | <=) operand
operand    := property.path | null | true | false | 十进制数
示例       := name != null
示例       := ids != null and ids.size > 0
示例       := age >= 18 and enabled == true
```

`and` 优先于 `or`，两者都短路求值。 XML 属性中 `<` 必须写成 `&lt;`，`>` 可以直接写；文本中的 SQL 小于号可放入 CDATA。 条件必须有比较运算符，不能只写 `test="enabled"`。

不支持括号、算术、字符串字面量、索引运算、方法调用、构造对象、静态成员访问。 这些限制在解析 XML 时检查，非法表达式不会等到“恰好命中该分支”才报错。 如果需要更丰富条件，先在业务层算出布尔属性，再写 `eligible == true`。

<!-- framework-part -->
```java
    static final String OPERAND = "(?:null|true|false|-?\\d+(?:\\.\\d+)?|" + PATH + ")";
    static final Pattern COMPARISON = Pattern.compile(
            "(" + OPERAND + ")\\s*(==|!=|>=|<=|>|<)\\s*(" + OPERAND + ")");
    interface Expr { boolean test(Context c); }
    static Expr expression(String input) {
        String[] ors = input.trim().split("\\s+or\\s+", -1);
        if (ors.length > 1) {
            List<Expr> nodes = Arrays.stream(ors).map(DynamicSql::expression).toList();
            return c -> nodes.stream().anyMatch(n -> n.test(c));
        }
        String[] ands = input.trim().split("\\s+and\\s+", -1);
        if (ands.length > 1) {
            List<Expr> nodes = Arrays.stream(ands).map(DynamicSql::expression).toList();
            return c -> nodes.stream().allMatch(n -> n.test(c));
        }
        Matcher m = COMPARISON.matcher(input.trim());
        if (!m.matches()) throw bad("不支持的表达式: " + input);
        String left = m.group(1), op = m.group(2), right = m.group(3);
        return c -> compare(operand(c, left), op, operand(c, right));
    }
    static Object operand(Context c, String token) {
        if (token.equals("null")) return null;
        if (token.equals("true") || token.equals("false")) return Boolean.valueOf(token);
        if (token.matches("-?\\d+(?:\\.\\d+)?")) return new BigDecimal(token);
        return c.value(token);
    }
    static boolean compare(Object a, String op, Object b) {
        boolean numbers = a instanceof Number && b instanceof Number;
        int order = numbers ? new BigDecimal(a.toString()).compareTo(new BigDecimal(b.toString())) : 0;
        boolean equal = numbers ? order == 0 : Objects.equals(a, b);
        return switch (op) {
            case "==" -> equal;
            case "!=" -> !equal;
            case ">", ">=", "<", "<=" -> {
                if (!numbers) throw bad("大小比较仅支持非 null 数值");
                yield switch (op) {
                    case ">" -> order > 0;
                    case ">=" -> order >= 0;
                    case "<" -> order < 0;
                    default -> order <= 0;
                };
            }
            default -> throw bad("未知运算符: " + op);
        };
    }
```

这里数值比较用 BigDecimal 避免 `Integer(1)` 与 `Long(1)` 因包装类型不同而不相等。 输入应为有限数值，不承诺支持 NaN、Infinity 或自定义 Number 的任意字符串格式。 非数值只有相等比较，不会偷偷调用 `Comparable` 执行用户代码。

“安全子集”不是进程沙箱：Bean getter 依然是应用程序代码，可能有副作用。 XML 模板、Bean 类型和白名单配置必须由可信开发者控制；只有参数值可以来自不可信请求。 如果替换成 OGNL，应单独审查成员访问、类解析和方法执行权限，不能仅靠一个正则宣称安全。

## 六、区分数据槽位与 SQL 结构：#{} 和 ${}

### 6.1 白名单必须映射到服务端常量

`#{name}` 总是生成问号并记录值，即使输入是 `x' OR 1=1 --`，它仍是一个普通字符串。 `${sort}` 则影响 SQL 文本，只能从配置的候选键中选择一个固定片段。 例如 `name -> name`、`newest -> created_at desc`；没有命中的键必须报错，不能回退到原始输入。

不能只用“只含字母数字”的正则放行列名：那仍允许访问不该暴露的列。 也不能指望 `order by ?` 把参数当列名，它通常只是常量表达式。 这里额外限制输出片段的字符集，禁止分号、引号、注释和问号；真正的授权仍来自显式 Map。

<!-- framework-part -->
```java
    public record Policy(Map<String, Map<String, String>> choices) {
        public Policy {
            Map<String, Map<String, String>> copy = new HashMap<>();
            choices.forEach((path, values) -> {
                if (!path.matches(PATH)) throw bad("非法白名单路径: " + path);
                values.forEach((key, sql) -> {
                    if (!sql.matches("[A-Za-z_][A-Za-z0-9_]*(?:[ .,_][A-Za-z0-9_]+)*")) {
                        throw bad("白名单片段不符合受限标识符规则: " + key);
                    }
                });
                copy.put(path, Map.copyOf(values));
            });
            choices = Map.copyOf(copy);
        }
        public static Policy denyAll() { return new Policy(Map.of()); }
        String expand(String path, Object value) {
            Map<String, String> allowed = choices.get(path);
            if (!(value instanceof String key) || allowed == null || !allowed.containsKey(key)) {
                throw bad("SQL 插值未获白名单授权: " + path);
            }
            return allowed.get(key);
        }
    }
    interface Piece { void apply(Context c); }
    static SqlNode text(String template) {
        List<Piece> pieces = new ArrayList<>();
        StringBuilder literal = new StringBuilder();
        char quote = 0;
        for (int i = 0; i < template.length(); i++) {
            char ch = template.charAt(i);
            boolean slot = (ch == '#' || ch == '$') && i + 1 < template.length()
                    && template.charAt(i + 1) == '{';
            if (slot) {
                if (quote != 0) throw bad("占位符不能位于 SQL 引号内部");
                String prefix = literal.toString(); literal.setLength(0);
                pieces.add(c -> c.sql.append(prefix));
                int end = template.indexOf('}', i + 2);
                if (end < 0) throw bad("占位符缺少右花括号");
                String[] fields = template.substring(i + 2, end).split(",", -1);
                String path = fields[0].trim();
                if (!path.matches(PATH)) throw bad("非法占位符路径: " + path);
                if (ch == '$') {
                    if (fields.length != 1) throw bad("插值不接受类型选项");
                    pieces.add(c -> c.sql.append(c.policy.expand(path, c.value(path))));
                } else {
                    if (fields.length > 2) throw bad("仅支持 jdbcType 选项");
                    JDBCType jdbc = null;
                    if (fields.length == 2) {
                        String option = fields[1].trim();
                        if (!option.startsWith("jdbcType=")) throw bad("未知参数选项");
                        jdbc = JDBCType.valueOf(option.substring(9).trim());
                    }
                    JDBCType type = jdbc;
                    pieces.add(c -> {
                        Object value = c.value(path);
                        if (value == null && type == null) throw bad("null 必须声明 jdbcType: " + path);
                        c.sql.append('?');
                        c.mappings.add(new ParameterMapping(path, value, type));
                    });
                }
                i = end; continue;
            }
            if (quote == 0 && (ch == '?' || template.startsWith("--", i)
                    || template.startsWith("/*", i))) throw bad("禁止裸问号及 SQL 注释");
            if (ch == '\'' || ch == '"') {
                if (quote == 0) quote = ch;
                else if (quote == ch) {
                    if (i + 1 < template.length() && template.charAt(i + 1) == ch) {
                        literal.append(ch).append(ch); i++; continue;
                    }
                    quote = 0;
                }
            }
            literal.append(ch);
        }
        if (quote != 0) throw bad("SQL 引号不能跨节点或未闭合");
        String suffix = literal.toString();
        pieces.add(c -> c.sql.append(suffix));
        return c -> pieces.forEach(p -> p.apply(c));
    }
```

### 6.2 为什么还要写一个小扫描器

直接用正则替换全部 `#{}`，会把 `name = '#{name}'` 错误变成引号内的问号。 那不是 JDBC 参数，绑定数量也会失配。 本文支持标准单引号字符串、双引号标识符及重复引号转义，拒绝引号内的模板占位符。

扫描器不压缩 SQL 内部空白，避免把 `'a  b'` 改成 `'a b'`。 为保持实现边界可验证，不支持 SQL 注释、反引号、美元引用或跨节点引号；模板作者不能绕过这一约定。 这不是通用 SQL 词法分析器；扩展到 PostgreSQL/MySQL 方言时，应先扩展词法测试，再扩大语法范围。

## 七、把动态标签实现为节点树

### 7.1 Mixed 与 If：先组合，再有条件地输出

Mixed 节点按 XML 子节点顺序执行，不排序、不合并参数名。 同一个参数出现两次，也要产生两个映射，因为 JDBC 认位置，不认属性名。 If 的条件在启动时编译成 Expr，在调用时读取当前参数。

### 7.2 Trim 与 Where：只修剪边界，不改 SQL 内部

trim 先把子节点输出到临时缓冲区，再删除前后空白。 若没有内容，就既不输出 prefix/suffix，也不输出参数。 where 等价于受限配置的 trim：前缀为 WHERE，删除开头独立的 AND 或 OR。

必须检查单词边界，不能把 `order_no` 开头的 `or` 删除。 本篇 trim 允许单词或逗号作为 override token，不支持跨单词模式。 它满足 where 的 AND/OR 和更新语句末尾逗号两种常见需要。 模板作者仍负责在相邻 SQL 单词之间留空格：Mixed 和 If 不会替每个文本节点自动补空格。 `prefix`、`suffix`、`open`、`close`、`separator` 是可信模板的固定结构属性，不做占位符解析；其中不要放裸问号、`#{}` 或 `${}`。 如需动态值，把占位符放在文本节点中，保证每个 JDBC 问号都经过映射生成路径。

### 7.3 Foreach：每轮都有自己的参数快照

循环输入可以是 Collection 或任意 Java 数组；不把字符串视为字符集合。 每个元素都有独立的 item/index 局部变量，嵌套循环可以遮蔽外层同名变量，但不会改写外层。 只有实际产生 SQL 的迭代才参与 separator 拼接。 空输入、null 输入、全部迭代无输出都直接报错，避免悄悄把 `WHERE id IN (...)` 整体抹掉。

<!-- framework-part -->
```java
    record Mixed(List<SqlNode> children) implements SqlNode {
        Mixed { children = List.copyOf(children); }
        public void apply(Context c) { children.forEach(n -> n.apply(c)); }
    }
    record If(Expr condition, SqlNode body) implements SqlNode {
        public void apply(Context c) { if (condition.test(c)) body.apply(c); }
    }
    static String strip(String sql, String overrides, boolean prefix) {
        for (String raw : overrides.split("\\|")) {
            String token = raw.trim();
            if (token.isEmpty()) continue;
            if (!token.matches("[A-Za-z]+|,")) throw bad("不支持的 trim token: " + token);
            String word = Pattern.quote(token);
            String regex = token.equals(",") ? word : word + "(?![A-Za-z0-9_])";
            if (!prefix && !token.equals(",")) regex = "(?<![A-Za-z0-9_])" + word;
            Pattern p = Pattern.compile(prefix ? "^" + regex : regex + "$", Pattern.CASE_INSENSITIVE);
            Matcher m = p.matcher(sql);
            if (m.find()) return (prefix ? sql.substring(m.end()) : sql.substring(0, m.start())).trim();
        }
        return sql;
    }
    record Trim(String prefix, String suffix, String pre, String post, SqlNode body) implements SqlNode {
        public void apply(Context c) {
            Context child = c.child(); body.apply(child);
            String sql = strip(strip(child.sql.toString().trim(), pre, true), post, false);
            if (!sql.isBlank()) c.append(child, " " + prefix + " " + sql + " " + suffix + " ");
        }
    }
    static List<Object> elements(Object input) {
        if (input instanceof Collection<?> c) return new ArrayList<>(c);
        if (input != null && input.getClass().isArray()) {
            List<Object> result = new ArrayList<>();
            for (int i = 0; i < Array.getLength(input); i++) result.add(Array.get(input, i));
            return result;
        }
        throw bad("foreach 需要非 null Collection 或数组");
    }
    record ForEach(String collection, String item, String index, String open,
                   String close, String separator, SqlNode body) implements SqlNode {
        public void apply(Context c) {
            List<Object> values = elements(c.value(collection));
            if (values.isEmpty()) throw bad("foreach 不接受空集合");
            if (values.size() > 1000) throw bad("单次 foreach 超过 1000 个元素");
            Context joined = c.child();
            int emitted = 0;
            for (int i = 0; i < values.size(); i++) {
                Context iteration = c.child();
                iteration.locals.put(item, values.get(i));
                iteration.locals.put(index, i);
                body.apply(iteration);
                String sql = iteration.sql.toString().trim();
                if (!sql.isEmpty()) {
                    if (emitted++ > 0) joined.sql.append(separator);
                    joined.append(iteration, sql);
                }
            }
            if (emitted == 0) throw bad("foreach 没有产生任何 SQL");
            c.append(joined, open + joined.sql + close);
        }
    }
```

这里没有采用真实 MyBatis 的 `__frch_item_0` 一类唯一变量重写策略。 因为映射直接保存每轮解析到的值，循环结束后即使局部上下文被回收，绑定结果仍然稳定。 对于 `#{item.id}`，快照保存的是该轮的 ID，而不是保存一个将来再求值的 `item.id` 名字。

1000 是示例的单次循环防护阈值，不是所有数据库统一的 IN 限制。 嵌套循环仍可能乘法增长；生产系统还要限制总映射数、SQL 长度、查询超时和分页上限。 对权限 ID 集合，空集合应报错或由业务层直接返回空结果；不要套上一个 if 让权限条件消失。

## 八、从 XML 构建 SqlSource

### 8.1 解析时完成结构检查

这里只解析一个 `<script>`，而不是再实现整个 Mapper XML 注册器。 第 02 篇的构建器可以在拿到 select/update 等语句体后复用相同节点构建逻辑。 本实验用 `<script>` 做独立入口，降低与已有配置层的耦合。

DOM 的文本节点与 CDATA 都编译为文本节点；未知标签、未知属性直接失败。 XML 外部实体与 DOCTYPE 被禁用，不允许解析器去读取本地文件或访问外部网络。 XML 注释不输出 SQL；注意 XML 注释与 SQL 注释不是同一种东西。

<!-- framework-part -->
```java
    static String required(Element e, String name) {
        String value = e.getAttribute(name);
        if (value.isBlank()) throw bad("缺少属性: " + e.getTagName() + "." + name);
        return value;
    }
    static void attrs(Element e, String... allowed) {
        Set<String> names = Set.of(allowed);
        for (int i = 0; i < e.getAttributes().getLength(); i++) {
            String name = e.getAttributes().item(i).getNodeName();
            if (!names.contains(name)) throw bad("未知属性: " + name);
        }
    }
    static SqlNode children(Element e) {
        List<SqlNode> nodes = new ArrayList<>();
        for (Node n = e.getFirstChild(); n != null; n = n.getNextSibling()) {
            if (n instanceof Element child) nodes.add(element(child));
            else if (n.getNodeType() == Node.TEXT_NODE || n.getNodeType() == Node.CDATA_SECTION_NODE) {
                nodes.add(text(n.getNodeValue()));
            } else if (n.getNodeType() != Node.COMMENT_NODE) throw bad("不支持的 XML 节点");
        }
        return new Mixed(nodes);
    }
    static String symbol(Element e, String key) {
        String value = required(e, key);
        if (!value.matches("[A-Za-z][A-Za-z0-9_]*")) throw bad("非法循环变量: " + value);
        if (Set.of("collection", "array", "list").contains(value)) throw bad("循环变量使用保留名称");
        return value;
    }
    static SqlNode element(Element e) {
        return switch (e.getTagName()) {
            case "script" -> { attrs(e); yield children(e); }
            case "if" -> {
                attrs(e, "test"); yield new If(expression(required(e, "test")), children(e));
            }
            case "where" -> {
                attrs(e); yield new Trim("WHERE", "", "AND|OR", "", children(e));
            }
            case "trim" -> {
                attrs(e, "prefix", "suffix", "prefixOverrides", "suffixOverrides");
                yield new Trim(e.getAttribute("prefix"), e.getAttribute("suffix"),
                        e.getAttribute("prefixOverrides"), e.getAttribute("suffixOverrides"), children(e));
            }
            case "foreach" -> {
                attrs(e, "collection", "item", "index", "open", "close", "separator");
                String collection = required(e, "collection");
                if (!collection.matches(PATH)) throw bad("非法集合路径");
                String item = symbol(e, "item");
                String index = e.hasAttribute("index") ? symbol(e, "index") : "index";
                if (item.equals(index)) throw bad("item 与 index 不能相同");
                yield new ForEach(collection, item, index, e.getAttribute("open"),
                        e.getAttribute("close"), e.getAttribute("separator"), children(e));
            }
            default -> throw bad("未知动态标签: " + e.getTagName());
        };
    }
    public static SqlSource parse(String xml, Policy policy) {
        Objects.requireNonNull(policy);
        try {
            DocumentBuilderFactory f = DocumentBuilderFactory.newInstance();
            f.setFeature(XMLConstants.FEATURE_SECURE_PROCESSING, true);
            f.setFeature("http://apache.org/xml/features/disallow-doctype-decl", true);
            f.setFeature("http://xml.org/sax/features/external-general-entities", false);
            f.setFeature("http://xml.org/sax/features/external-parameter-entities", false);
            f.setAttribute(XMLConstants.ACCESS_EXTERNAL_DTD, "");
            f.setAttribute(XMLConstants.ACCESS_EXTERNAL_SCHEMA, "");
            f.setXIncludeAware(false); f.setExpandEntityReferences(false);
            var builder = f.newDocumentBuilder();
            builder.setErrorHandler(new DefaultHandler() {
                @Override public void error(org.xml.sax.SAXParseException e) throws SAXException { throw e; }
                @Override public void fatalError(org.xml.sax.SAXParseException e) throws SAXException { throw e; }
            });
            Element root = builder.parse(new InputSource(new StringReader(xml))).getDocumentElement();
            if (!root.getTagName().equals("script")) throw bad("根节点必须是 script");
            SqlNode node = element(root);
            boolean dynamic = root.getElementsByTagName("*").getLength() > 0 || root.getTextContent().contains("${");
            return dynamic ? new DynamicSqlSource(node, policy) : new StaticSqlSource(node, policy);
        } catch (Exception e) {
            throw new IllegalArgumentException("SQL 脚本解析失败", e);
        }
    }
```

### 8.2 静态路径为什么仍然接收参数

静态是指 SQL 形状不随参数改变，不是“所有调用使用同一组值”。 只有文本和 `#{}` 的脚本属于 StaticSqlSource；有标签或 `${}` 的脚本属于 DynamicSqlSource。 两者都持有已经解析好的节点，因此不会在每次查询时重新解析 XML。

本文两者共用渲染逻辑以保持示例一致。 进一步优化时，可让静态来源预存问号 SQL 和属性描述，调用时只创建值快照。 绝不能把第一次渲染得到的整个 BoundSql 缓存在 MappedStatement 中：它含有第一次调用的实参。

## 九、类型处理器：让 JDBC 绑定成为可扩展边界

### 9.1 ParameterMapping 决定位置，TypeHandler 决定编码

参数绑定从下标 1 开始，严格遍历 mappings，不遍历 Map，也不按参数名排序。 处理器按照 Java 运行时类型与可选 JDBCType 联合查找。 优先使用精确的 `(Java类型, JDBC类型)` 注册，其次是该 Java 类型的默认注册，最后才走枚举兜底。

null 没有运行时 Java 类型，本篇不推断 getter 的泛型信息，而是要求显式 jdbcType，再调用 `setNull`。 非 null 且声明 jdbcType 时，仍先经过对应 Java 类型的处理器，避免把一切都退化成驱动猜测。 没有处理器就失败，不把任意复杂对象交给 `setObject`。

### 9.2 数组必须区分三种语义

`foreach collection="array"` 把 Java 数组展开为多个标量问号。 `byte[]` 默认作为一个 VARBINARY 值，用于二进制内容。 SQL ARRAY 是一个问号对应数据库数组，显式包装为 `SqlArray`，提供数据库元素类型名。

SQL ARRAY 的元素类型名是可信代码给出的数据库类型，不接收请求中任意字符串。 数组对象由 JDBC Connection 创建，必须在 Statement 使用结束后 free。 下面的资源收集器同时处理“绑定到一半失败”与“执行后正常关闭”两种路径。

<!-- framework-part -->
```java
    @FunctionalInterface
    public interface TypeHandler<T> {
        void set(PreparedStatement ps, int index, T value, JDBCType jdbc, Resources resources) throws SQLException;
    }
    public record SqlArray(String elementType, Object[] values) {
        public SqlArray {
            if (!Set.of("BIGINT", "INTEGER", "VARCHAR").contains(elementType)) throw bad("不支持的数组元素类型");
            values = values.clone();
        }
        @Override public Object[] values() { return values.clone(); }
    }
    public static final class Resources implements AutoCloseable {
        private final List<java.sql.Array> arrays = new ArrayList<>();
        void add(java.sql.Array array) { arrays.add(array); }
        @Override public void close() throws SQLException {
            SQLException failure = null;
            for (java.sql.Array array : arrays) {
                try { array.free(); }
                catch (SQLException e) {
                    if (failure == null) failure = e; else failure.addSuppressed(e);
                }
            }
            arrays.clear();
            if (failure != null) throw failure;
        }
    }
    public static final class TypeHandlerRegistry {
        private record Key(Class<?> javaType, JDBCType jdbcType) {}
        private final Map<Key, TypeHandler<?>> handlers = new HashMap<>();
        private boolean frozen;
        public <T> TypeHandlerRegistry register(Class<T> type, JDBCType jdbc, TypeHandler<T> handler) {
            if (frozen) throw bad("注册表已冻结");
            handlers.put(new Key(Objects.requireNonNull(type), jdbc), Objects.requireNonNull(handler));
            return this;
        }
        public TypeHandlerRegistry freeze() { frozen = true; return this; }
        public static TypeHandlerRegistry defaults() {
            TypeHandlerRegistry r = new TypeHandlerRegistry();
            r.register(String.class, null, (p, i, v, j, x) -> p.setString(i, v));
            r.register(Integer.class, null, (p, i, v, j, x) -> p.setInt(i, v));
            r.register(Long.class, null, (p, i, v, j, x) -> p.setLong(i, v));
            r.register(Boolean.class, null, (p, i, v, j, x) -> p.setBoolean(i, v));
            r.register(BigDecimal.class, null, (p, i, v, j, x) -> p.setBigDecimal(i, v));
            r.register(LocalDate.class, null, (p, i, v, j, x) -> p.setObject(i, v, Types.DATE));
            r.register(LocalDateTime.class, null, (p, i, v, j, x) -> p.setObject(i, v, Types.TIMESTAMP));
            r.register(Instant.class, null, (p, i, v, j, x) ->
                    p.setObject(i, v.atOffset(ZoneOffset.UTC), Types.TIMESTAMP_WITH_TIMEZONE));
            r.register(java.util.Date.class, null, (p, i, v, j, x) -> p.setTimestamp(i, new Timestamp(v.getTime())));
            r.register(java.sql.Date.class, null, (p, i, v, j, x) -> p.setDate(i, v));
            r.register(Timestamp.class, null, (p, i, v, j, x) -> p.setTimestamp(i, v));
            r.register(byte[].class, null, (p, i, v, j, x) -> p.setBytes(i, v));
            r.register(SqlArray.class, JDBCType.ARRAY, (p, i, v, j, x) -> {
                java.sql.Array array = p.getConnection().createArrayOf(v.elementType(), v.values());
                x.add(array); p.setArray(i, array);
            });
            return r;
        }
        @SuppressWarnings("unchecked")
        void bind(PreparedStatement ps, int index, ParameterMapping m, Resources resources) throws SQLException {
            Object value = m.value();
            if (value == null) {
                if (m.jdbcType() == null) throw bad("null 缺少 jdbcType: " + m.path());
                ps.setNull(index, m.jdbcType().getVendorTypeNumber()); return;
            }
            Class<?> type = value instanceof Enum<?> e ? e.getDeclaringClass() : value.getClass();
            TypeHandler<Object> handler = (TypeHandler<Object>) handlers.get(new Key(type, m.jdbcType()));
            if (handler == null) handler = (TypeHandler<Object>) handlers.get(new Key(type, null));
            if (handler != null) handler.set(ps, index, value, m.jdbcType(), resources);
            else if (value instanceof Enum<?> e) ps.setString(index, e.name());
            else throw bad("未注册 TypeHandler: " + type.getName());
        }
    }
    public static final class ParameterHandler {
        private final TypeHandlerRegistry registry;
        public ParameterHandler(TypeHandlerRegistry registry) { this.registry = Objects.requireNonNull(registry); }
        public void bind(PreparedStatement ps, BoundSql sql, Resources resources) throws SQLException {
            for (int i = 0; i < sql.mappings().size(); i++) registry.bind(ps, i + 1, sql.mappings().get(i), resources);
        }
    }
}
```

默认处理器的目标类型是固定的：例如 LocalDate 默认写 DATE，非 null 的 jdbcType 不会自动改变其日期语义。 若需要同一 Java 类型编码到其他列类型，必须注册精确二元键；不要依赖驱动隐式转换。 本篇不实现继承层次搜索，避免多个父接口处理器产生歧义；自定义 Date 子类也需要显式注册。

枚举默认保存 `name()`，不保存 ordinal，因为调整枚举声明顺序不应改写历史数据含义。 若数据库保存业务编码，给该枚举注册专用处理器，例如把 ACTIVE 映射到 A；读取端也必须做逆向映射。 注册表在启动阶段配置完成后 freeze，再安全发布给会话工厂；运行中不允许热改共享 HashMap。

LocalDate 不带时区，LocalDateTime 也不是时间线上的唯一瞬间。 Instant 在示例中编码为 UTC 的 OffsetDateTime，目标列使用 TIMESTAMP WITH TIME ZONE。 历史 `java.util.Date` 用 Timestamp 传递，但跨时区行为仍需针对目标驱动验证，不能照搬 H2 结论。

## 十、完整运行示例：查询、条件与排序

以下 Demo 使用自己的连接，只为演示新模块，不取代系列会话中的事务边界。 它建表、写入三条数据，再用动态脚本筛选 ACTIVE 用户和 ID 集合。 `sort` 传入的是逻辑键 `name`，不是客户端任意 SQL。

<!-- demo-file -->
```java
package lab;

import java.sql.*;
import java.util.*;
import static lab.DynamicSql.*;

public final class Demo {
    public enum State { ACTIVE, DISABLED }
    public static final Policy POLICY = new Policy(Map.of("sort", Map.of("name", "name", "id", "id")));
    public static final String QUERY = """
            <script>
              select id, name from t_user
              <where>
                <if test="name != null">AND name = #{name}</if>
                <if test="state != null">AND state = #{state}</if>
                AND id in
                <foreach collection="ids" item="id" open="(" close=")" separator=",">#{id}</foreach>
              </where>
              order by ${sort}
            </script>
            """;
    public static void seed(Connection c) throws SQLException {
        try (Statement s = c.createStatement()) {
            s.execute("create table t_user(id bigint primary key, name varchar(80), state varchar(20))");
            s.executeUpdate("insert into t_user values (1,'Frank','ACTIVE'),(2,'Bob','DISABLED'),(3,'Ada','ACTIVE')");
        }
    }
    public static List<String> query(Connection c, BoundSql sql, TypeHandlerRegistry registry) throws SQLException {
        List<String> rows = new ArrayList<>();
        try (Resources resources = new Resources(); PreparedStatement ps = c.prepareStatement(sql.sql())) {
            new ParameterHandler(registry).bind(ps, sql, resources);
            try (ResultSet rs = ps.executeQuery()) {
                while (rs.next()) rows.add(rs.getLong("id") + ":" + rs.getString("name"));
            }
        }
        return rows;
    }
    public static void main(String[] args) throws Exception {
        try (Connection c = DriverManager.getConnection("jdbc:h2:mem:demo03")) {
            seed(c);
            Map<String, Object> params = new HashMap<>();
            params.put("name", null); params.put("state", State.ACTIVE);
            params.put("ids", List.of(1L, 3L)); params.put("sort", "name");
            BoundSql sql = parse(QUERY, POLICY).getBoundSql(params);
            System.out.println(sql.sql());
            System.out.println(sql.mappings().stream().map(ParameterMapping::value).toList());
            System.out.println(query(c, sql, TypeHandlerRegistry.defaults().freeze()));
        }
    }
}
```

资源声明顺序是 Resources 在前、PreparedStatement 在后，因此关闭时先关闭 Statement，再释放 SQL ARRAY。 绑定、查询、结果集读取任何一步异常，try-with-resources 都会执行清理，并保留 suppressed 异常。 本例没有事务写入接口，seed 使用默认自动提交；接回系列工程后，业务写操作仍由 SqlSession 显式提交或回滚。

运行命令在练习工程根目录执行。

```bash
mvn -q test
mvn -q exec:java -Dexec.mainClass=lab.Demo
```

输出 SQL 的换行和空格取决于 XML 缩进，以下把空白排版规整后展示。 参数顺序与查询结果必须与下面一致。

```text
select id, name from t_user WHERE state = ? AND id in (?,?) order by name
[ACTIVE, 1, 3]
[3:Ada, 1:Frank]
```

## 十一、完整测试：先检查形状，再验证数据库行为

### 11.1 测试不只检查“执行没报错”

SQL 恰好能执行，不代表绑定顺序正确；例如交换两个同类型 ID，驱动不会替我们发现问题。 所以测试分两层：直接断言 BoundSql 的形状与值顺序，再让 H2 检查真实 SQL 语义。 白名单、表达式与 XML 安全测试则必须断言拒绝路径，而不是只展示正常输入。

下面共 12 个测试方法；辅助方法只规范化测试中的 SQL 空白，不参与实际生成。 生产日志不要像 Demo 一样直接打印所有参数，应脱敏并控制长度。

<!-- test-file -->
```java
package lab;

import org.junit.jupiter.api.Test;
import java.sql.*;
import java.time.*;
import java.util.*;
import static lab.DynamicSql.*;
import static org.junit.jupiter.api.Assertions.*;

public class DynamicSqlTest {
    public static final class Filter {
        public String getName() { return "Frank"; }
        public Integer getAge() { return 20; }
    }
    public record Group(List<Long> ids) {}
    public record Token(String value) {}
    static BoundSql bound(String xml, Object parameter) { return parse(xml, Policy.denyAll()).getBoundSql(parameter); }
    static List<Object> values(BoundSql sql) { return sql.mappings().stream().map(ParameterMapping::value).toList(); }
    static String flat(BoundSql sql) { return sql.sql().replaceAll("\\s+", " ").trim(); }
    static Connection connection() throws SQLException {
        return DriverManager.getConnection("jdbc:h2:mem:t" + UUID.randomUUID());
    }
    static int update(Connection c, BoundSql sql, TypeHandlerRegistry registry) throws SQLException {
        try (Resources resources = new Resources(); PreparedStatement ps = c.prepareStatement(sql.sql())) {
            new ParameterHandler(registry).bind(ps, sql, resources); return ps.executeUpdate();
        }
    }
    @Test void staticSqlAndRepeatedParameters() {
        SqlSource source = parse("<script>select #{_parameter}, #{_parameter}</script>", Policy.denyAll());
        assertInstanceOf(StaticSqlSource.class, source);
        BoundSql first = source.getBoundSql(7L);
        assertEquals("select ?, ?", first.sql()); assertEquals(List.of(7L, 7L), values(first));
        assertEquals(List.of(8L, 8L), values(source.getBoundSql(8L)));
        assertThrows(UnsupportedOperationException.class, () -> first.mappings().clear());
    }
    @Test void beanMapNullAndMissing() {
        BoundSql bean = bound("<script>select #{name}, #{age}</script>", new Filter());
        assertEquals(List.of("Frank", 20), values(bean));
        Map<String, Object> p = new HashMap<>(); p.put("name", null);
        assertNull(bound("<script>select #{name,jdbcType=VARCHAR}</script>", p).mappings().get(0).value());
        assertThrows(IllegalArgumentException.class, () -> bound("<script>select #{name}</script>", p));
        assertThrows(IllegalArgumentException.class, () -> bound("<script>select #{missing}</script>", p));
        assertThrows(IllegalArgumentException.class, () -> bound("<script>select #{class}</script>", new Filter()));
    }
    @Test void ifWhereAndShortCircuit() {
        String xml = "<script>select 1<where><if test='ids != null and ids.size > 0'>AND x = #{x}</if></where></script>";
        Map<String, Object> p = new HashMap<>(); p.put("ids", null);
        SqlSource source = parse(xml, Policy.denyAll()); assertInstanceOf(DynamicSqlSource.class, source);
        assertEquals("select 1", flat(source.getBoundSql(p)));
        p.put("ids", List.of(1)); p.put("x", 9);
        assertEquals("select 1 WHERE x = ?", flat(source.getBoundSql(p)));
        assertEquals(List.of(9), values(source.getBoundSql(p)));
        assertEquals("WHERE order_no = 1", flat(bound("<script><where>order_no = 1</where></script>", Map.of())));
        assertEquals("WHERE x = 1", flat(bound("<script><where>or x = 1</where></script>", Map.of())));
        assertEquals("yes", bound("<script><if test='true == true or missing > 0'>yes</if></script>", Map.of()).sql());
    }
    @Test void trimUpdateExecutes() throws Exception {
        String xml = """
                <script>update t_user
                <trim prefix="SET" suffixOverrides=",">
                  <if test="name != null">name = #{name},</if>
                  <if test="state != null">state = #{state},</if>
                </trim>where id = #{id}</script>
                """;
        Map<String, Object> p = new HashMap<>(); p.put("name", "Neo"); p.put("state", null); p.put("id", 1L);
        BoundSql sql = bound(xml, p); assertEquals("update t_user SET name = ? where id = ?", flat(sql));
        assertEquals(List.of("Neo", 1L), values(sql));
        try (Connection c = connection()) {
            Demo.seed(c); assertEquals(1, update(c, sql, TypeHandlerRegistry.defaults().freeze()));
        }
        assertEquals("", bound("<script><trim prefix='SET'><if test='x != null'>x=#{x}</if></trim></script>",
                Collections.singletonMap("x", null)).sql());
    }
    @Test void collectionsArraysIndexAndEmpty() {
        String xml = "<script><foreach collection='collection' item='v' index='i' open='(' close=')' separator=','>#{i},#{v}</foreach></script>";
        assertEquals(List.of(0, 8L, 1, 9L), values(bound(xml, List.of(8L, 9L))));
        String array = xml.replace("collection='collection'", "collection='array'");
        assertEquals(List.of(0, 8L, 1, 9L), values(bound(array, new long[]{8L, 9L})));
        assertThrows(IllegalArgumentException.class, () -> bound(xml, List.of()));
        assertThrows(IllegalArgumentException.class, () -> bound(xml, null));
        assertThrows(IllegalArgumentException.class, () -> bound(xml, Collections.nCopies(1001, 1)));
        String skipped = xml.replace("#{i},#{v}", "<if test='v > 0'>#{v}</if>");
        assertEquals("(?,?)", bound(skipped, List.of(-1, 8, 9)).sql());
        assertThrows(IllegalArgumentException.class, () -> bound(skipped, List.of(-1)));
    }
    @Test void nestedLoopScopesAndSnapshots() {
        String xml = """
                <script><foreach collection="collection" item="g" separator=";">
                <foreach collection="g.ids" item="v" separator=",">#{v}</foreach>:#{index}
                </foreach></script>
                """;
        assertEquals(List.of(1L, 2L, 0, 3L, 1), values(bound(xml, List.of(new Group(List.of(1L, 2L)), new Group(List.of(3L))))));
        String shadow = "<script><foreach collection='collection' item='v'>"
                + "<foreach collection='v.ids' item='v'>#{v}</foreach>#{v.ids.size}</foreach></script>";
        assertEquals(List.of(7L, 1), values(bound(shadow, List.of(new Group(List.of(7L))))));
    }
    @Test void whitelistAndInjectionAreDifferentChannels() throws Exception {
        SqlSource source = parse(Demo.QUERY, Demo.POLICY);
        Map<String, Object> p = new HashMap<>(); p.put("name", null); p.put("state", Demo.State.ACTIVE);
        p.put("ids", List.of(1L, 3L)); p.put("sort", "name");
        TypeHandlerRegistry registry = TypeHandlerRegistry.defaults().freeze();
        try (Connection c = connection()) {
            Demo.seed(c); assertEquals(List.of("3:Ada", "1:Frank"), Demo.query(c, source.getBoundSql(p), registry));
            p.put("name", "x' OR 1=1 --"); BoundSql attack = source.getBoundSql(p);
            assertFalse(attack.sql().contains("OR 1=1")); assertTrue(Demo.query(c, attack, registry).isEmpty());
        }
        p.put("sort", "name desc; drop table t_user");
        assertThrows(IllegalArgumentException.class, () -> source.getBoundSql(p));
        assertThrows(IllegalArgumentException.class, () -> bound("<script>order by ${sort}</script>", Map.of("sort", "name")));
        assertThrows(IllegalArgumentException.class, () -> new Policy(Map.of("sort", Map.of("x", "name;delete"))));
    }
    @Test void rejectsUnsafeExpressionsXmlAndPlaceholderContexts() {
        for (String expr : List.of("name.toString() != null", "@java.lang.System@exit(0)", "(age > 1)", "age > 0 and")) {
            assertThrows(IllegalArgumentException.class, () -> parse("<script><if test='" + expr + "'>x</if></script>", Policy.denyAll()));
        }
        for (String xml : List.of("<script><choose/></script>", "<script><if typo='x'>a</if></script>",
                "<!DOCTYPE script [<!ENTITY x SYSTEM 'file:///not-read'>]><script>&x;</script>",
                "<script>select '#{x}'</script>", "<script>select ?</script>", "<script>select 1 -- #{x}</script>",
                "<script>select #{x</script>", "<script>select #{x,unknown=1}</script>")) {
            assertThrows(IllegalArgumentException.class, () -> parse(xml, Policy.denyAll()));
        }
        assertEquals("select 'a  b', 'it''s'", bound("<script>select 'a  b', 'it''s'</script>", null).sql());
        assertEquals("select 1 < 2", bound("<script><![CDATA[select 1 < 2]]></script>", null).sql());
    }
    @Test void nullDateEnumBinaryAndSqlArrayRoundTrip() throws Exception {
        TypeHandlerRegistry registry = TypeHandlerRegistry.defaults().freeze();
        LocalDate day = LocalDate.of(2026, 9, 9); LocalDateTime time = day.atTime(12, 34, 56);
        Instant instant = Instant.parse("2026-09-09T04:34:56Z");
        Map<String, Object> p = new HashMap<>(); p.put("n", null); p.put("day", day); p.put("time", time);
        p.put("instant", instant); p.put("state", Demo.State.ACTIVE); p.put("bytes", new byte[]{1, 2});
        p.put("ids", new SqlArray("BIGINT", new Object[]{1L, 3L}));
        p.put("legacy", java.util.Date.from(instant));
        try (Connection c = connection(); Statement s = c.createStatement()) {
            s.execute("create table types(n varchar(30), d date, t timestamp, z timestamp with time zone, "
                    + "e varchar(20), b varbinary, a bigint array, legacy timestamp)");
            BoundSql sql = bound("<script>insert into types values(#{n,jdbcType=VARCHAR},#{day},#{time},#{instant},"
                    + "#{state},#{bytes},#{ids,jdbcType=ARRAY},#{legacy})</script>", p);
            assertEquals(1, update(c, sql, registry));
            try (ResultSet rs = s.executeQuery("select * from types")) {
                assertTrue(rs.next()); assertNull(rs.getString("n"));
                assertEquals(day, rs.getObject("d", LocalDate.class)); assertEquals(time, rs.getObject("t", LocalDateTime.class));
                assertEquals(instant, rs.getObject("z", OffsetDateTime.class).toInstant());
                assertEquals("ACTIVE", rs.getString("e")); assertArrayEquals(new byte[]{1, 2}, rs.getBytes("b"));
                java.sql.Array array = rs.getArray("a");
                try { assertArrayEquals(new Object[]{1L, 3L}, (Object[]) array.getArray()); } finally { array.free(); }
                assertEquals(instant.toEpochMilli(), rs.getTimestamp("legacy").getTime());
            }
        }
    }
    @Test void customHandlerAndUnknownType() throws Exception {
        TypeHandlerRegistry registry = TypeHandlerRegistry.defaults();
        registry.register(Token.class, JDBCType.VARCHAR, (ps, i, v, j, r) -> ps.setString(i, "token:" + v.value()));
        registry.register(Demo.State.class, null, (ps, i, v, j, r) -> ps.setString(i, v == Demo.State.ACTIVE ? "A" : "D"));
        registry.freeze();
        assertThrows(IllegalArgumentException.class, () -> registry.register(String.class, null, (p, i, v, j, r) -> {}));
        try (Connection c = connection(); Statement s = c.createStatement()) {
            s.execute("create table custom(v varchar(40), e varchar(2))");
            assertEquals(1, update(c, bound("<script>insert into custom values(#{v,jdbcType=VARCHAR},#{e})</script>",
                    Map.of("v", new Token("abc"), "e", Demo.State.ACTIVE)), registry));
            try (ResultSet rs = s.executeQuery("select * from custom")) {
                assertTrue(rs.next()); assertEquals("token:abc", rs.getString(1)); assertEquals("A", rs.getString(2));
            }
            assertThrows(IllegalArgumentException.class, () -> update(c,
                    bound("<script>insert into custom(v) values(#{v})</script>", Map.of("v", new Object())), registry));
        }
    }
    @Test void sameTemplateDoesNotLeakPriorParameters() {
        SqlSource source = parse(Demo.QUERY, Demo.POLICY);
        for (int i = 0; i < 30; i++) {
            Map<String, Object> p = new HashMap<>(); p.put("name", i % 2 == 0 ? "Frank" : null);
            p.put("state", null); p.put("ids", List.of((long) i)); p.put("sort", "id");
            List<Object> expected = i % 2 == 0 ? List.of("Frank", (long) i) : List.of((long) i);
            assertEquals(expected, values(source.getBoundSql(p)));
        }
    }
    @Test void concurrentRenderingHasIndependentContexts() {
        SqlSource source = parse("<script><foreach collection='array' item='v' separator=','>#{v}</foreach></script>", Policy.denyAll());
        java.util.stream.IntStream.range(0, 100).parallel().forEach(i ->
                assertEquals(List.of(i, i + 1), values(source.getBoundSql(new int[]{i, i + 1}))));
    }
}
```

### 11.2 这些测试分别守住什么

| 测试组 | 主要断言 |
| --- | --- |
| 静态模板与重复引用 | 同名属性可重复绑定，下一次调用使用新值 |
| Bean / Map | getter 可读，缺 key 报错，null 必须有类型 |
| if / where | 短路，不留空 WHERE，不误删 order_no |
| trim | 删除最后一个逗号，生成真实可执行 UPDATE |
| foreach | List / 基本类型数组 / index / 跳过分支 / 空集合拒绝 |
| 嵌套循环 | 参数顺序稳定，同名变量退出后恢复外层作用域 |
| 安全策略 | 数据注入作为值，结构注入被白名单拒绝 |
| 词法与 XML | 拒绝方法表达式、DOCTYPE、未知标签和错误占位符 |
| 类型往返 | SQL NULL、日期、时区、枚举、二进制、SQL ARRAY |
| 扩展与共享 | 自定义处理器、冻结注册表、重复和并发渲染隔离 |

正常执行 `mvn test` 应得到 `Tests run: 12, Failures: 0, Errors: 0, Skipped: 0`。 如果依赖下载失败，先确认 Maven 镜像与网络；如果提示不支持 release 17，检查 `mvn -version` 中实际使用的 JDK。 如果出现缺少属性错误，先看参数根对象是 Bean、Map 还是集合，不要为了让测试通过而把所有缺失都改成 null。

并发测试只说明模板渲染上下文不共享，不代表同一个 JDBC Connection 可以并发使用。 SqlSession、Statement 和 ResultSet 仍然遵循上一阶段的会话隔离规则。 SQL ARRAY 的驱动资源测试以 H2 为基线；上线其他数据库前要补该驱动的创建、绑定和释放集成测试。

## 十二、如何接回第 02 篇的执行链

启动阶段，配置构建器读取 statement id、命令类型与结果类型，把语句体编译为 SqlNode 树，包装成 SqlSource 后存进 MappedStatement；同时配置白名单并冻结 TypeHandlerRegistry。注册器不能持有请求参数、Connection 或某次调用的 BoundSql。

调用阶段只有两个接入点：参数命名之后、prepareStatement 之前生成 BoundSql；创建 Statement 之后、execute 之前按映射顺序绑定参数。保留原来的结果映射与事务边界。

```text
MapperProxy：方法实参 -> Bean 或命名 Map
    -> MappedStatement：取得共享 SqlSource
    -> SqlSource：为当前调用生成 BoundSql
    -> Executor：connection.prepareStatement(boundSql.sql())
    -> ParameterHandler：按 mappings 顺序绑定
    -> Statement：executeQuery / executeUpdate
    -> 原 ResultSetHandler：完成结果映射
    -> 原 SqlSession：负责提交、回滚与连接关闭
```

注解和 XML 应复用同一个脚本编译入口。迁回 Mapper XML 时可直接遍历 select/update 元素的子节点，`<script>` 只是本实验的适配外壳。多参数仍沿用前篇代理的 `@Param` 或显式命名约定，不在动态层重新猜名字。

执行器必须保留 Resources 的生命周期：在 Statement 使用结束后释放 SQL ARRAY，不能在 bind 内提前 free，也不能把数组存进共享注册表。模板缓存的是规则，映射列表保留的是本次调用的顺序，二者不能混用。

## 十三、边界复盘与 04 预告

### 13.1 本篇仍未解决的事情

动态 where 所有条件为空时可以生成无条件 SELECT，这是查询模板的正常能力，却未必符合某个业务接口的安全要求。 对于 UPDATE/DELETE，应在业务入口或后续 SQL 检查层强制主键、租户或权限条件，不能仅靠 where 标签兜底。 trim 没有内容时不输出 SET，因此“所有更新字段为空”会形成非法 UPDATE；业务层应提前拒绝空补丁，而不是自动改成无条件更新。

`IN (NULL)` 不等于 `IS NULL`；集合里若允许 null，需要明确业务语义，并为对应占位符声明 jdbcType。 SQL 的三值逻辑与 Java 的 null 比较不同，本篇表达式只决定是否输出节点，不改变数据库的比较规则。 多值 IN 与 SQL ARRAY 也不是可互换语法：前者多个问号，后者一个数据库数组值，SQL 写法取决于方言。

类型处理器目前只负责入参，不承担 ResultSet 到复杂对象图的装配。 没有实现通用 OGNL、完整 MyBatis XML、二级缓存、分页方言、插件、批处理和自动生成主键。 也没有为了缩短代码而给这些功能留下“返回 null”的伪实现：不支持的入口应明确失败。

### 13.2 与真实 MyBatis 对照阅读

可以对照官方文档的动态 SQL、XML 参数配置和 Java API 类型处理器章节，再阅读源码中的对应组件。 重点不是记住类名，而是检查“启动时编译哪些内容、调用时保存哪些状态”。

- 动态 SQL 文档：<https://mybatis.org/mybatis-3/dynamic-sql.html>
- XML 参数与字符串替换：<https://mybatis.org/mybatis-3/sqlmap-xml.html>
- TypeHandler 配置：<https://mybatis.org/mybatis-3/configuration.html#typeHandlers>

源码阅读顺序可从 `XMLScriptBuilder` 到 `MixedSqlNode`、`IfSqlNode`、`TrimSqlNode`、`ForEachSqlNode`。 接着看 `DynamicContext`、`DynamicSqlSource`、`BoundSql`、`DefaultParameterHandler` 和 `TypeHandlerRegistry`。 真实版本的静态预解析、OGNL 上下文、additionalParameters 和类型推断比本文丰富，具体细节应以所用版本为准。

### 13.3 下一篇：从参数类型走向结果映射

第 04 篇将沿执行链继续处理查询结果：列别名如何对应属性、SQL NULL 如何避免变成基本类型零值、枚举与日期如何反向解码。 再逐步引入显式 resultMap、构造器映射与嵌套对象，为关联查询和一对多去重建立基础。 本篇已经把 SQL 生成与参数绑定从执行器中拆出来，下一篇不需要再次修改 if/foreach 来添加结果映射能力。

到这里，迷你框架完成了关键转变：共享的不再是某次调用的 SQL 和参数，而是生成它们的规则。 **模板负责结构，表达式负责选择，白名单负责授权，ParameterMapping 负责顺序，TypeHandler 负责 JDBC 编码。** 只要这五个职责不混在一起，动态 SQL 再复杂，也可以逐层定位、独立测试，而不是在一长串字符串拼接里碰运气。
