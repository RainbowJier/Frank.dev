---
title: RuoYi 框架从零到一 01 - RuoYi 框架初识
date: 2026-08-24 10:00:00
categories:
  - 教程
tags:
  - RuoYi
  - Spring Boot
  - Vue
  - 权限管理
description: RuoYi 是什么？单体版、前后端分离版、微服务版如何选型？本文带你认识 RuoYi 开源后台管理系统，快速启动第一个项目，了解核心特性与技术栈全景。
lang: zh-CN
---

> **适合人群**：Java 后端开发、全栈工程师、想快速搭建后台管理系统的同学
> 本文是《RuoYi 框架从零到一》系列第 01 篇，基于 RuoYi-Vue 4.x 版本（Spring Boot 4 + Vue 3）。
>
> 系列目录：1. RuoYi 框架初识（本篇）→ 2. 项目结构与核心模块 → 3. RBAC 权限模型 → ...

## 一、RuoYi 是什么

想象一下这样的场景：你接到一个新项目，需要做一个企业后台管理系统——用户管理、角色权限、操作日志、定时任务、数据导出……这些功能你已经写过无数遍，但每次都要从头搭架子，重复造轮子。

**RuoYi 就是来解决这个问题的**——它是一个开源的**后台管理系统脚手架**（或者说"快速开发框架"），把企业级应用的常见功能都实现好了，你直接基于它开发业务功能即可。

### 1.1 RuoYi 解决的核心问题

- **权限管理**：完整的 RBAC 权限模型（用户-角色-菜单-权限），还支持数据权限（只看自己部门的数据）
- **代码生成器**：连接数据库表，一键生成前后端 CRUD 代码（包括 Java、Vue、SQL），省掉 80% 的重复劳动
- **系统监控**：服务器监控、缓存监控、SQL 性能分析、在线用户管理，开箱即用
- **定时任务**：可视化配置定时任务，无需重启应用
- **操作日志**：自动记录用户操作轨迹，方便审计和问题排查
- **通用功能**：字典管理、参数配置、文件上传、Excel 导入导出、防重复提交……

用一句话总结：**RuoYi 把"非业务"的基础设施都准备好了，你只需要专注写业务逻辑**。

### 1.2 为什么选择 RuoYi

市面上类似的脚手架不少（若依、Jeecg-Boot、Guns、Blade），RuoYi 的优势是：

- **开源免费**：MIT 协议，可商用，无任何限制
- **文档完善**：官方文档详细，社区活跃（GitHub 3.5 万+ Star）
- **持续更新**：官方团队持续维护，紧跟 Spring Boot、Vue 最新版本
- **学习门槛低**：代码规范清晰，注释详细，适合新手学习和二次开发
- **多版本选择**：单体版、前后端分离版、微服务版，覆盖不同规模的项目需求

## 二、RuoYi 版本全景对比

RuoYi 官方提供了**四个版本**，技术栈和适用场景完全不同，选对版本能少走很多弯路。

![图1：RuoYi 四大版本对比与选型建议](ruoyi-version-comparison.svg)

### 2.1 版本对比表

| 特性 | 单体版 | 前后端分离版 | 微服务版 |
|------|--------|--------------|----------|
| **架构** | 前后端耦合 | 前后端分离 | 分布式微服务 |
| **后端** | Spring Boot + Shiro | Spring Boot + Security | Spring Cloud + Nacos |
| **前端** | jQuery + Bootstrap | Vue 3 + Element Plus | Vue 3 + Element Plus |
| **认证** | Session | JWT Token | JWT + 网关鉴权 |
| **部署** | 单个 jar 包 | 前后端分开部署 | 多个服务独立部署 |
| **学习成本** | ⭐ | ⭐⭐ | ⭐⭐⭐⭐ |
| **适用规模** | 小型项目 | 中型企业应用 | 大型分布式系统 |

### 2.2 版本选型建议（重要！）

**三条纪律**：

1. **小型项目/快速原型** → 选**单体版**：部署简单，一个 jar 包搞定，适合传统企业内部系统
2. **中型企业应用/需要移动端** → 选**前后端分离版**（推荐）：现代化技术栈，前后端团队可以并行开发，API 可以给多端调用
3. **大型系统/高并发场景** → 选**微服务版**：服务独立扩展，但运维复杂度高，需要团队有微服务经验

**一句话记住**：**80% 的企业应用场景适合选择"前后端分离版"**，它在功能完整性和技术复杂度之间取得了最佳平衡。本系列后续所有文章都基于 **RuoYi-Vue（前后端分离版）** 展开。

## 三、RuoYi-Vue 技术栈全景

RuoYi-Vue 采用**四层架构**设计，每一层的技术选型都是行业主流方案。

![图2：RuoYi-Vue 技术栈四层架构](ruoyi-tech-stack-architecture.svg)

### 3.1 前端层：Vue 3 全家桶

- **Vue 3**：采用 Composition API，支持 `<script setup>` 语法糖，代码更简洁
- **Element Plus**：饿了么出品的企业级 UI 组件库，开箱即用
- **Pinia**：新一代状态管理工具（替代 Vuex），API 更简单
- **Vite**：极速构建工具，冷启动只需 2-3 秒，热更新毫秒级

### 3.2 网关层：Spring Security + JWT

- **Spring Security**：Spring 生态的安全框架，基于过滤器链实现认证和授权
- **JWT Token**：无状态认证方案，适合前后端分离和多终端场景
- **CORS 配置**：统一处理跨域问题，支持携带 Cookie 和自定义 Header

### 3.3 应用层：Spring Boot + MyBatis

- **Spring Boot 4.x**：最新的 Spring Boot 版本，要求 JDK 17+
- **MyBatis**：轻量级持久层框架，SQL 灵活可控
- **Quartz**：企业级定时任务调度框架，支持集群
- **Velocity**：模板引擎，用于代码生成器

### 3.4 数据层：MySQL + Redis + Druid

- **MySQL 5.7+**：主流关系型数据库，存储业务数据
- **Redis**：缓存 Token、用户权限信息、字典数据，提升性能
- **Druid**：阿里巴巴开源的数据库连接池，自带监控功能（可以看到慢 SQL）

## 四、快速启动第一个 RuoYi 项目

理论说得再多，不如动手跑起来。下面带你快速启动 RuoYi-Vue 项目，10 分钟内完成部署。

### 4.1 环境准备

确保你的电脑安装了以下软件：

- **JDK 17+**：Spring Boot 4 要求 JDK 17 或更高版本
- **Maven 3.6+**：后端项目构建工具
- **MySQL 5.7+**：数据库（推荐 8.0）
- **Redis 3.0+**：缓存服务
- **Node.js 18+**：前端构建环境（npm 或 pnpm）

### 4.2 后端启动

**步骤 1：克隆代码**

```bash
git clone https://gitee.com/y_project/RuoYi-Vue.git
cd RuoYi-Vue
```

**步骤 2：导入数据库**

在 MySQL 中创建数据库 `ry-vue`，然后执行 `sql/` 目录下的两个脚本：

```bash
mysql -u root -p ry-vue < sql/ry_20240629.sql
mysql -u root -p ry-vue < sql/quartz.sql
```

**步骤 3：修改配置**

打开 `ruoyi-admin/src/main/resources/application-druid.yml`，修改数据库连接：

```yaml
spring:
  datasource:
    druid:
      master:
        url: jdbc:mysql://localhost:3306/ry-vue?useUnicode=true&characterEncoding=utf8&zeroDateTimeBehavior=convertToNull&useSSL=true&serverTimezone=GMT%2B8
        username: root
        password: 你的密码
```

打开 `application.yml`，确认 Redis 配置（默认 localhost:6379，无密码）：

```yaml
redis:
  host: localhost
  port: 6379
  password:  # 如果 Redis 有密码，填在这里
```

**步骤 4：启动后端**

在 IDEA 中打开项目，找到 `ruoyi-admin` 模块的 `RuoYiApplication.java`，右键运行 `main` 方法。

看到以下日志说明启动成功：

```
(♥◠‿◠)ノ゙  若依启动成功   ლ(´ڡ`ლ)゙  
.-------.       ____     __        
|  _ _   \      \   \   /  /    
| ( ' )  |       \  _. /  '       
|(_ o _) /        _( )_ .'         
| (_,_).' __  ___(_ o _)'          
|  |\ \  |  ||   |(_,_)'         
|  | \ `'   /|   `-'  /           
|  |  \    / \      /           
''-'   `'-'   `-..-'              
```

后端默认端口 `8080`，访问 http://localhost:8080 能看到 Swagger 文档说明接口已启动。

### 4.3 前端启动

**步骤 1：安装依赖**

```bash
cd ruoyi-ui
npm install
# 或者使用 pnpm（速度更快）
pnpm install
```

**步骤 2：启动开发服务器**

```bash
npm run dev
```

看到以下提示说明启动成功：

```
VITE v5.x.x  ready in 1234 ms

➜  Local:   http://localhost:80/
➜  Network: use --host to expose
```

**步骤 3：访问系统**

打开浏览器访问 http://localhost:80，看到登录页面：

- **默认账号**：`admin`
- **默认密码**：`admin123`

### 4.4 登录体验

登录后你会看到一个完整的后台管理系统首页，左侧是菜单树，右侧是工作台。点击几个菜单感受一下：

- **系统管理 → 用户管理**：增删改查用户，分配角色
- **系统管理 → 角色管理**：配置角色权限，绑定菜单
- **系统监控 → 在线用户**：查看当前登录的用户，可强制下线
- **系统工具 → 代码生成**：选择数据库表，一键生成 CRUD 代码

**背后的认证流程**是这样的：

![图3：JWT Token 认证完整流程](ruoyi-login-flow.svg)

1. **前端登录**：输入用户名密码，发送 `POST /login` 请求
2. **Security 验证**：Spring Security 过滤器链验证用户名密码
3. **生成 JWT**：验证通过后，`TokenService` 生成 JWT Token
4. **存入 Redis**：将 Token 和用户权限信息存入 Redis（key: `login_tokens:{uuid}`）
5. **返回 Token**：前端接收 Token，存储到 `localStorage`
6. **携带 Token**：后续请求在 Header 中携带 `Authorization: Bearer {token}`
7. **权限加载**：后端从 Redis 中加载用户权限，完成鉴权

**一句话记住**：**RuoYi 的认证是"无状态"的**——后端不记录 Session，所有状态都在 JWT Token 里，天然支持分布式部署和多终端访问。

## 五、核心特性一览

快速过一遍 RuoYi 的核心功能，知道它能做什么，后续文章再深入每个模块。

### 5.1 完善的权限管理

- **RBAC 权限模型**：用户 → 角色 → 菜单 → 权限标识，四层关系灵活配置
- **数据权限**：可以配置"只看自己部门的数据"、"只看本人的数据"等 5 种数据权限范围
- **按钮级权限**：前端按钮根据权限标识动态显示/隐藏（如"新增"按钮只有管理员能看到）
- **动态路由**：前端路由根据用户权限动态生成，没权限的菜单压根不加载

### 5.2 代码生成器（重点！）

这是 RuoYi 最省时间的功能——连接数据库表，配置字段类型（文本、下拉、日期等），一键生成：

- **后端代码**：Controller、Service、ServiceImpl、Mapper.java、Mapper.xml
- **前端页面**：Vue 3 的增删改查页面（包括表格、表单、分页、搜索）
- **SQL 脚本**：菜单和权限的 INSERT 语句，直接导入数据库

生成的代码包括：列表查询、分页、新增、修改、删除、导出 Excel，**开箱即用，无需修改**。

### 5.3 定时任务调度

基于 Quartz 实现，可以在页面上：

- 新增定时任务（填写 Cron 表达式）
- 暂停/恢复任务
- 立即执行一次（调试用）
- 查看任务执行日志（成功/失败、耗时、异常信息）

**支持并发/串行策略**：同一个任务上次没执行完，这次是等待还是并发执行，都能配置。

### 5.4 系统监控

- **服务监控**：CPU 使用率、内存、磁盘、JVM 堆栈信息（基于 oshi 库）
- **缓存监控**：Redis 信息、命令统计、实时监控 Key 数量
- **SQL 监控**：Druid 提供的 SQL 性能分析，能看到慢 SQL、执行次数、耗时分布
- **在线用户**：查看当前登录用户的 IP、登录时间、浏览器信息，可强制下线

### 5.5 操作日志

通过 `@Log` 注解自动记录用户操作：

```java
@Log(title = "用户管理", businessType = BusinessType.INSERT)
@PostMapping
public AjaxResult add(@RequestBody SysUser user) {
    return toAjax(userService.insertUser(user));
}
```

记录内容包括：操作人、操作模块、操作类型、请求参数、返回结果、IP 地址、操作时间，方便审计和问题排查。

### 5.6 字典管理

系统参数的"码表"管理，比如：

- 用户性别：`0-男, 1-女, 2-未知`
- 订单状态：`1-待支付, 2-已支付, 3-已取消`

前端下拉框直接绑定字典类型，后台修改字典值后前端自动生效（Redis 缓存 + 动态刷新）。

## 结语

这篇文章带你快速认识了 RuoYi：

- **它是什么**：开源的后台管理系统脚手架，解决企业应用的"基础设施"问题
- **怎么选版本**：80% 场景选前后端分离版（RuoYi-Vue）
- **技术栈全景**：前端 Vue 3 全家桶 + 后端 Spring Boot + 数据层 MySQL + Redis
- **如何启动**：10 分钟跑起来，体验完整的后台管理系统
- **核心功能**：权限、代码生成器、定时任务、监控、日志、字典

**下一篇预告**：我们将深入 RuoYi 项目结构，剖析 6 大核心模块（admin/common/framework/system/generator/quartz）的职责划分，理解模块依赖关系、数据库设计规范和配置文件体系——这是二次开发的基础。

> **思考与练习**
>
> 1. 尝试修改登录页的 Logo 和标题，感受前端组件的结构
> 2. 在"用户管理"模块新增一个用户，观察数据库 `sys_user` 表的变化
> 3. 在"代码生成"模块，用自己的数据库表生成一套 CRUD 代码，看看生成的代码结构