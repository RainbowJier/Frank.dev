---
title: RuoYi 框架从零到一 02 - 项目结构与核心模块
date: 2026-08-24 14:00:00
categories:
  - 教程
tags:
  - RuoYi
  - Spring Boot
  - 项目架构
  - 模块化设计
description: 深入剖析 RuoYi 项目的目录结构与 6 大核心模块（admin/common/framework/system/generator/quartz），理解模块依赖关系、数据库设计规范与配置文件体系。
lang: zh-CN
---

> **适合人群**：已完成 RuoYi 项目启动，想深入了解项目结构的同学
> 本文是《RuoYi 框架从零到一》系列第 02 篇，基于 RuoYi-Vue 4.x 版本。
>
> 建议先读 {% post_link articles/RuoYi/01-ruoyi-framework-introduction '01 - RuoYi 框架初识' %}。

## 一、RuoYi-Vue 项目目录全景

用 IDEA 或 VSCode 打开 RuoYi-Vue 项目，你会看到**前后端两个独立的工程**：

### 1.1 后端项目结构（6 大模块）

```
RuoYi-Vue/
├── ruoyi-admin/          # Web 入口模块（Controller 层，应用启动入口）
├── ruoyi-common/         # 通用工具模块（工具类、注解、异常、枚举）
├── ruoyi-framework/      # 框架核心模块（Security、Redis、MyBatis 配置）
├── ruoyi-system/         # 系统管理模块（用户、角色、菜单、部门等业务）
├── ruoyi-generator/      # 代码生成器模块（Velocity 模板引擎）
├── ruoyi-quartz/         # 定时任务模块（Quartz 集成）
├── sql/                  # 数据库脚本（初始化 SQL、增量 SQL）
└── pom.xml               # 父 POM 文件（统一管理依赖版本）
```

**6 大模块的职责划分**是 RuoYi 架构设计的核心——这种**分层模块化设计**让代码职责清晰、易于维护扩展。

### 1.2 前端项目结构（Vue 3 工程）

```
ruoyi-ui/
├── src/
│   ├── api/              # API 接口定义（按模块划分，如 system/user.js）
│   ├── assets/           # 静态资源（图片、样式）
│   ├── components/       # 通用组件（文件上传、富文本编辑器）
│   ├── layout/           # 布局组件（头部、侧边栏、标签页）
│   ├── router/           # 前端路由配置
│   ├── store/            # Pinia 状态管理
│   ├── utils/            # 工具函数（请求封装、权限判断）
│   ├── views/            # 页面组件（按模块划分）
│   ├── App.vue           # 根组件
│   └── main.js           # 入口文件
├── public/               # 公共资源（index.html、favicon）
├── package.json          # 前端依赖配置
└── vite.config.js        # Vite 构建配置
```

前后端通过 **RESTful API** 交互，前端调用 `/dev-api/*` 接口（开发环境通过 Vite 代理到后端 8080 端口），实现完全解耦。

### 1.3 数据库脚本目录

```
sql/
├── ry_20240629.sql       # 主数据库脚本（包含所有表结构和初始数据）
└── quartz.sql            # Quartz 定时任务表（11 张表）
```

导入顺序：先执行 `ry_*.sql`，再执行 `quartz.sql`。

## 二、后端核心模块深度解析

接下来逐个剖析 6 大模块的职责、核心类、设计思想。

### 2.1 ruoyi-admin（Web 入口模块）

**职责**：应用启动入口 + Controller 层 + 配置文件

**核心类**：

- **RuoYiApplication.java**：Spring Boot 启动类，`main` 方法入口
- **RuoYiServletInitializer.java**：支持外部 Tomcat 部署（WAR 包方式）
- **resources/application.yml**：主配置文件（服务端口、应用名称、Token 配置）
- **resources/application-druid.yml**：数据源配置（MySQL 连接信息、Druid 连接池）
- **resources/logback.xml**：日志配置（日志级别、文件路径、滚动策略）
- **resources/mybatis/mybatis-config.xml**：MyBatis 配置（驼峰转换、分页插件）

**配置文件体系**（重要！）：

![图1：RuoYi 配置文件体系结构](ruoyi-config-files-structure.svg)

**一句话记住**：**ruoyi-admin 是"总指挥"，负责启动应用和暴露 HTTP 接口，但不包含具体业务逻辑**（业务逻辑在 ruoyi-system 模块）。

### 2.2 ruoyi-common（通用工具模块）

**职责**：为其他模块提供通用的工具类、注解、异常、枚举、常量

**核心内容**：

#### （1）工具类（utils 包）

- **StringUtils**：字符串工具类（判空、截取、格式化）
- **DateUtils**：日期工具类（格式化、计算时间差）
- **SecurityUtils**：安全工具类（获取当前登录用户、加密密码）
- **ServletUtils**：Servlet 工具类（获取请求参数、响应 JSON）
- **IpUtils**：IP 地址工具类（获取客户端真实 IP）
- **UuidUtils**：UUID 生成工具类（去除横线的 UUID）

#### （2）通用注解（annotation 包）

- **@Excel**：Excel 导入导出注解（标注在实体类字段上）
- **@DataScope**：数据权限注解（标注在 Service 方法上，自动过滤数据）
- **@Log**：操作日志注解（标注在 Controller 方法上，自动记录日志）
- **@RepeatSubmit**：防重复提交注解（防止用户连续点击按钮）
- **@DataSource**：多数据源切换注解（动态切换数据源）

#### （3）异常体系（exception 包）

- **ServiceException**：业务异常（如"用户名已存在"）
- **BaseException**：基础异常类（所有自定义异常的父类）
- **DemoModeException**：演示模式异常（演示环境禁止修改数据）

#### （4）枚举类（enums 包）

- **BusinessStatus**：操作状态枚举（SUCCESS、FAIL）
- **DataSourceType**：数据源类型枚举（MASTER、SLAVE）
- **UserStatus**：用户状态枚举（NORMAL、DISABLE、DELETED）

#### （5）统一返回封装（core 包）

- **AjaxResult**：统一返回格式 `{code, msg, data}`
- **TableDataInfo**：分页返回格式 `{total, rows, code, msg}`
- **R**：泛型返回工具类（链式调用）

**代码示例**：统一返回格式

```java
// Controller 返回示例
@GetMapping("/list")
public TableDataInfo list(SysUser user) {
    startPage();  // 开启分页
    List<SysUser> list = userService.selectUserList(user);
    return getDataTable(list);  // 返回 {total: 100, rows: [...], code: 200, msg: "查询成功"}
}

@PostMapping
public AjaxResult add(@RequestBody SysUser user) {
    return toAjax(userService.insertUser(user));  // 返回 {code: 200, msg: "操作成功"}
}
```

**一句话记住**：**ruoyi-common 是"工具箱"，所有模块都依赖它，但它不依赖任何业务模块**。

### 2.3 ruoyi-framework（框架核心模块）

**职责**：封装 Spring Security、Redis、MyBatis、全局异常处理等**框架级配置**

**核心组件架构**：

![图2：framework 模块核心组件架构](ruoyi-framework-core-modules.svg)

#### （1）Security 安全配置（config/SecurityConfig.java）

```java
@EnableGlobalMethodSecurity(prePostEnabled = true, securedEnabled = true)
public class SecurityConfig {
    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            // 禁用 CSRF（前后端分离项目不需要）
            .csrf(csrf -> csrf.disable())
            // 禁用 Session（使用 JWT 无状态认证）
            .sessionManagement(session -> session.sessionCreationPolicy(STATELESS))
            // 配置哪些路径不需要认证
            .authorizeHttpRequests(auth -> auth
                .requestMatchers("/login", "/captchaImage").permitAll()
                .anyRequest().authenticated()
            )
            // 添加 JWT 过滤器
            .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);
        return http.build();
    }
}
```

#### （2）JWT Token 过滤器（security/filter/JwtAuthenticationTokenFilter.java）

**工作流程**：

1. 从请求 Header 中提取 `Authorization: Bearer {token}`
2. 解析 Token，获取 `uuid`
3. 从 Redis 中加载用户信息（key: `login_tokens:{uuid}`）
4. 将用户信息存入 `SecurityContextHolder`（Spring Security 上下文）
5. 放行请求，后续 Controller 可通过 `SecurityUtils.getUserId()` 获取当前用户

#### （3）Redis 缓存配置（config/RedisConfig.java）

```java
@Bean
public RedisTemplate<Object, Object> redisTemplate(RedisConnectionFactory factory) {
    RedisTemplate<Object, Object> template = new RedisTemplate<>();
    template.setConnectionFactory(factory);
    // 使用 FastJson 序列化（默认是 JDK 序列化，可读性差）
    template.setKeySerializer(new StringRedisSerializer());
    template.setValueSerializer(new FastJsonRedisSerializer<>(Object.class));
    return template;
}
```

#### （4）MyBatis 数据权限拦截器（interceptor/DataScopeInterceptor.java）

**原理**：通过 MyBatis 拦截器，在 SQL 执行前动态拼接数据权限 WHERE 条件

```java
// 示例：查询用户列表，自动过滤只看本部门的数据
@DataScope(deptAlias = "d", userAlias = "u")
public List<SysUser> selectUserList(SysUser user) {
    // 原始 SQL：SELECT * FROM sys_user u LEFT JOIN sys_dept d ON u.dept_id = d.dept_id
    // 拦截后 SQL：SELECT * FROM sys_user u LEFT JOIN sys_dept d ON u.dept_id = d.dept_id WHERE d.dept_id = 103
}
```

#### （5）全局异常处理器（web/exception/GlobalExceptionHandler.java）

```java
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(ServiceException.class)
    public AjaxResult handleServiceException(ServiceException e) {
        return AjaxResult.error(e.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public AjaxResult handleValidException(MethodArgumentNotValidException e) {
        return AjaxResult.error("参数校验失败: " + e.getBindingResult().getFieldError().getDefaultMessage());
    }
}
```

**一句话记住**：**framework 是"基础设施层"，提供认证、缓存、拦截、异常处理等底层能力，对业务代码透明**。

### 2.4 ruoyi-system（系统管理模块）

**职责**：实现系统管理的**所有业务逻辑**（用户、角色、菜单、部门、岗位等）

**模块结构**（标准的三层架构）：

```
ruoyi-system/
├── domain/               # 实体类（对应数据库表）
│   ├── SysUser.java
│   ├── SysRole.java
│   ├── SysMenu.java
│   ├── SysDept.java
│   └── ...
├── mapper/               # Mapper 接口（MyBatis 数据访问层）
│   ├── SysUserMapper.java
│   └── ...
├── service/              # Service 接口
│   ├── ISysUserService.java
│   └── ...
├── service/impl/         # Service 实现类
│   ├── SysUserServiceImpl.java
│   └── ...
└── resources/mapper/     # MyBatis XML 文件
    ├── SysUserMapper.xml
    └── ...
```

**核心业务模块**：

- **用户管理（User）**：新增、修改、删除、查询用户，分配角色
- **角色管理（Role）**：配置角色权限，绑定菜单和数据权限
- **菜单管理（Menu）**：维护菜单树（目录、菜单、按钮三层结构）
- **部门管理（Dept）**：维护部门树（支持无限层级）
- **岗位管理（Post）**：维护岗位信息（如"总经理"、"部门经理"）
- **字典管理（Dict）**：维护系统字典数据
- **参数配置（Config）**：维护系统参数（如"用户初始密码"）
- **通知公告（Notice）**：发布系统通知
- **操作日志（OperLog）**：记录用户操作日志
- **登录日志（LoginLog）**：记录用户登录日志

**代码示例**：用户管理 Service

```java
@Service
public class SysUserServiceImpl implements ISysUserService {
    @Autowired
    private SysUserMapper userMapper;

    @DataScope(deptAlias = "d", userAlias = "u")  // 数据权限注解
    @Override
    public List<SysUser> selectUserList(SysUser user) {
        return userMapper.selectUserList(user);
    }

    @Override
    public int insertUser(SysUser user) {
        // 1. 密码加密
        user.setPassword(SecurityUtils.encryptPassword(user.getPassword()));
        // 2. 插入用户
        int rows = userMapper.insertUser(user);
        // 3. 插入用户角色关联
        insertUserRole(user);
        return rows;
    }
}
```

**一句话记住**：**system 是"业务核心层"，所有系统管理功能的业务逻辑都在这里**。

### 2.5 ruoyi-generator（代码生成器模块）

**职责**：连接数据库表，根据 Velocity 模板生成前后端 CRUD 代码

**核心流程**：

1. **读取数据库表结构**：通过 `information_schema` 系统表查询表结构和字段信息
2. **配置生成选项**：选择生成模板（单表、树表、主子表）、设置包路径、模块名
3. **渲染 Velocity 模板**：将表结构数据填充到模板变量中
4. **生成代码文件**：生成 Java、XML、Vue、SQL 文件，打包成 ZIP 下载

**模板文件**（位于 `resources/vm/` 目录）：

```
vm/
├── java/
│   ├── domain.java.vm          # 实体类模板
│   ├── mapper.java.vm          # Mapper 接口模板
│   ├── service.java.vm         # Service 接口模板
│   ├── serviceImpl.java.vm     # Service 实现类模板
│   └── controller.java.vm      # Controller 模板
├── xml/
│   └── mapper.xml.vm           # MyBatis XML 模板
├── vue/
│   └── index.vue.vm            # Vue 页面模板
└── sql/
    └── sql.vm                  # 菜单 SQL 模板
```

**生成的代码包括**：

- 列表查询（分页、搜索、排序）
- 新增、修改、删除
- 导出 Excel
- 前端表格、表单、搜索框
- 菜单和权限 SQL

**一句话记住**：**generator 是"效率神器"，能省掉 80% 的 CRUD 重复劳动**。

### 2.6 ruoyi-quartz（定时任务模块）

**职责**：集成 Quartz 定时任务调度框架，提供可视化任务管理

**核心功能**：

- **动态配置任务**：在页面上新增定时任务（无需重启应用）
- **Cron 表达式支持**：灵活配置执行时间（如"每天凌晨 2 点"）
- **任务执行日志**：记录每次任务执行的结果、耗时、异常信息
- **并发策略**：支持并发执行/串行执行（上次没执行完，这次是等待还是并行）
- **失败重试**：任务失败后自动重试（可配置重试次数）

**数据库表**（11 张 Quartz 表）：

- **sys_job**：任务配置表（RuoYi 自定义，存储任务基本信息）
- **qrtz_***：Quartz 框架表（存储触发器、调度器状态等）

**一句话记住**：**quartz 是"定时器"，让后台任务可以按计划自动执行**。

## 三、模块依赖关系

理解模块依赖关系是二次开发的基础——知道哪些模块可以随意修改，哪些模块牵一发而动全身。

![图3：RuoYi 六大模块依赖关系图](ruoyi-module-dependency.svg)

**依赖规则**：

1. **ruoyi-admin 依赖所有模块**：它是 Web 入口，需要整合所有功能
2. **ruoyi-framework 依赖 common 和 system**：框架层需要用到工具类和业务实体
3. **ruoyi-common 不依赖任何模块**：它是最底层的工具模块
4. **generator 和 quartz 是独立功能模块**：可以单独拆卸（不需要代码生成器的项目可以删除 generator 模块）

**Maven 依赖配置示例**（ruoyi-admin 的 pom.xml）：

```xml
<dependencies>
    <!-- 通用工具 -->
    <dependency>
        <groupId>com.ruoyi</groupId>
        <artifactId>ruoyi-common</artifactId>
    </dependency>
    <!-- 框架核心 -->
    <dependency>
        <groupId>com.ruoyi</groupId>
        <artifactId>ruoyi-framework</artifactId>
    </dependency>
    <!-- 系统模块 -->
    <dependency>
        <groupId>com.ruoyi</groupId>
        <artifactId>ruoyi-system</artifactId>
    </dependency>
    <!-- 代码生成 -->
    <dependency>
        <groupId>com.ruoyi</groupId>
        <artifactId>ruoyi-generator</artifactId>
    </dependency>
    <!-- 定时任务 -->
    <dependency>
        <groupId>com.ruoyi</groupId>
        <artifactId>ruoyi-quartz</artifactId>
    </dependency>
</dependencies>
```

**一句话记住**：**依赖是单向的，底层模块不依赖上层模块，确保代码解耦**。

## 四、数据库设计规范

RuoYi 的数据库设计遵循**严格的命名规范**和**RBAC 权限模型**。

### 4.1 核心表结构

![图4：RuoYi 核心表 ER 关系图（RBAC 权限模型）](ruoyi-database-er-diagram.svg)

**核心表说明**：

| 表名 | 说明 | 关键字段 |
|------|------|----------|
| **sys_user** | 用户表 | user_id, user_name, password, dept_id |
| **sys_role** | 角色表 | role_id, role_name, data_scope（数据权限范围） |
| **sys_menu** | 菜单权限表 | menu_id, menu_name, perms（权限标识） |
| **sys_dept** | 部门表（树形） | dept_id, parent_id, ancestors（祖级列表） |
| **sys_post** | 岗位表 | post_id, post_name |
| **sys_user_role** | 用户角色关联表 | user_id, role_id |
| **sys_role_menu** | 角色菜单关联表 | role_id, menu_id |
| **sys_role_dept** | 角色部门关联表 | role_id, dept_id（数据权限用） |

**权限关系**：

- 一个用户可以有多个角色（N:N 关系，通过 sys_user_role 关联）
- 一个角色可以有多个菜单权限（N:N 关系，通过 sys_role_menu 关联）
- 一个角色可以关联多个部门（N:N 关系，通过 sys_role_dept 关联，用于数据权限）

### 4.2 表设计特点

#### （1）统一字段前缀

- **sys_***：系统管理模块表（如 sys_user、sys_role）
- **gen_***：代码生成器模块表（如 gen_table、gen_table_column）
- **qrtz_***：Quartz 定时任务表（如 qrtz_triggers）

#### （2）通用字段（所有表都有）

```sql
CREATE TABLE sys_xxx (
    ...
    create_by    VARCHAR(64)   DEFAULT '' COMMENT '创建者',
    create_time  DATETIME                 COMMENT '创建时间',
    update_by    VARCHAR(64)   DEFAULT '' COMMENT '更新者',
    update_time  DATETIME                 COMMENT '更新时间',
    remark       VARCHAR(500)  DEFAULT NULL COMMENT '备注'
);
```

这些字段由 MyBatis 自动填充（通过 `MyMetaObjectHandler` 拦截器）。

#### （3）逻辑删除

```sql
del_flag  CHAR(1)  DEFAULT '0'  COMMENT '删除标志（0代表存在 2代表删除）'
```

删除数据时不执行 `DELETE`，而是执行 `UPDATE sys_user SET del_flag='2'`（软删除）。

#### （4）树形结构字段

```sql
CREATE TABLE sys_dept (
    dept_id    BIGINT       NOT NULL AUTO_INCREMENT COMMENT '部门id',
    parent_id  BIGINT       DEFAULT 0               COMMENT '父部门id',
    ancestors  VARCHAR(50)  DEFAULT ''              COMMENT '祖级列表',
    ...
);
```

**ancestors 字段**存储祖先节点 ID（如 `0,100,101`），用于快速查询子孙节点：

```sql
-- 查询部门 101 的所有子孙部门
SELECT * FROM sys_dept WHERE ancestors LIKE '%,101,%' OR ancestors LIKE '101,%';
```

**一句话记住**：**RuoYi 的表设计遵循"约定优于配置"，所有表的公共字段和命名规则都是统一的**。

## 五、配置文件体系详解

RuoYi 的配置分散在多个文件中，每个文件负责不同的配置领域。

### 5.1 application.yml（主配置文件）

```yaml
# 服务配置
server:
  port: 8080                     # 后端服务端口
  servlet:
    context-path: /              # 应用访问路径

# Spring 配置
spring:
  application:
    name: ruoyi                  # 应用名称
  profiles:
    active: druid                # 激活 druid 配置文件

# Token 配置
token:
  header: Authorization          # Token 请求头名称
  secret: abcdefghijklmnopqrstuvwxyz  # Token 密钥
  expireTime: 30                 # Token 有效期（分钟）

# 文件上传配置
ruoyi:
  profile: D:/ruoyi/uploadPath   # 文件上传路径
  addressEnabled: true           # IP 地址归属地查询
```

### 5.2 application-druid.yml（数据源配置）

```yaml
spring:
  datasource:
    type: com.alibaba.druid.pool.DruidDataSource
    druid:
      master:
        url: jdbc:mysql://localhost:3306/ry-vue?useUnicode=true&characterEncoding=utf8&zeroDateTimeBehavior=convertToNull&useSSL=true&serverTimezone=GMT%2B8
        username: root
        password: password
        driver-class-name: com.mysql.cj.jdbc.Driver
      # 连接池配置
      initial-size: 5              # 初始连接数
      min-idle: 10                 # 最小空闲连接
      max-active: 20               # 最大活跃连接
      max-wait: 60000              # 获取连接最大等待时间（毫秒）
      # 监控配置
      stat-view-servlet:
        enabled: true
        url-pattern: /druid/*      # 访问 http://localhost:8080/druid 查看监控
        login-username: admin
        login-password: 123456
```

### 5.3 logback.xml（日志配置）

```xml
<configuration>
    <!-- 日志文件路径 -->
    <property name="log.path" value="./logs"/>

    <!-- 控制台日志 -->
    <appender name="console" class="ch.qos.logback.core.ConsoleAppender">
        <encoder>
            <pattern>%d{HH:mm:ss.SSS} [%thread] %-5level %logger{36} - %msg%n</pattern>
        </encoder>
    </appender>

    <!-- 文件日志（按天滚动） -->
    <appender name="file" class="ch.qos.logback.core.rolling.RollingFileAppender">
        <file>${log.path}/ruoyi.log</file>
        <rollingPolicy class="ch.qos.logback.core.rolling.TimeBasedRollingPolicy">
            <fileNamePattern>${log.path}/ruoyi-%d{yyyy-MM-dd}.log</fileNamePattern>
            <maxHistory>30</maxHistory>
        </rollingPolicy>
    </appender>

    <!-- 日志级别 -->
    <root level="INFO">
        <appender-ref ref="console"/>
        <appender-ref ref="file"/>
    </root>
</configuration>
```

### 5.4 mybatis-config.xml（MyBatis 配置）

```xml
<configuration>
    <settings>
        <!-- 驼峰命名转换（数据库 user_name → Java userName） -->
        <setting name="mapUnderscoreToCamelCase" value="true"/>
        <!-- 开启二级缓存 -->
        <setting name="cacheEnabled" value="true"/>
        <!-- 延迟加载 -->
        <setting name="lazyLoadingEnabled" value="true"/>
    </settings>

    <!-- 分页插件 -->
    <plugins>
        <plugin interceptor="com.github.pagehelper.PageInterceptor">
            <property name="helperDialect" value="mysql"/>
            <property name="reasonable" value="true"/>
            <property name="supportMethodsArguments" value="true"/>
        </plugin>
    </plugins>
</configuration>
```

**一句话记住**：**配置文件采用"分而治之"策略，每个文件负责一个配置领域，清晰明了**。

## 结语

这篇文章深入剖析了 RuoYi 的项目结构：

- **6 大模块职责**：admin（入口）、common（工具）、framework（框架）、system（业务）、generator（生成器）、quartz（定时任务）
- **模块依赖关系**：单向依赖，底层不依赖上层，确保解耦
- **数据库设计规范**：RBAC 权限模型、统一字段、树形结构、逻辑删除
- **配置文件体系**：application.yml、druid.yml、logback.xml、mybatis-config.xml 各司其职

**下一篇预告**：我们将深入 RBAC 权限模型的实现原理，剖析"用户-角色-菜单-权限"四层关系、数据权限（DataScope）的 SQL 拦截机制、JWT Token 的生成与验证流程——这是 RuoYi 最核心的功能模块。

> **思考与练习**
>
> 1. 尝试在 ruoyi-system 模块新增一个业务表（如"商品管理"），按照现有结构创建 domain、mapper、service
> 2. 阅读 `SecurityConfig.java`，理解 Spring Security 的过滤器链配置
> 3. 在数据库中插入一条 sys_menu 记录，观察前端菜单树的变化