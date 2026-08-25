---
title: RuoYi 框架从零到一 09 - MyBatis 增强与分页
date: 2026-08-25 09:00:00
categories:
  - 教程
tags:
  - RuoYi
  - MyBatis
  - PageHelper
  - 性能优化
description: 从 RuoYi 的 Mapper/XML 分层出发，讲清 PageHelper 分页、动态 SQL、数据权限拦截器、读写分离以及慢 SQL 和深分页的优化策略。
lang: zh-CN
---

> **适合人群**：已经会写 RuoYi 基础 CRUD，希望把分页、动态 SQL 和查询性能做扎实的同学。
> 本文是《RuoYi 框架从零到一》系列第 09 篇。示例基于 RuoYi-Vue 常见的 MyBatis + PageHelper 组合；读写分离属于按需二次开发能力，并非单体版默认开启。
>
> 建议先读 {% post_link articles/RuoYi/05-ruoyi-code-generator '05 - 代码生成器深度解析' %}，理解生成的 Controller、Service、Mapper 和 XML 如何协作。

## 一、先搞清 RuoYi 的数据访问分层

RuoYi 的典型查询链路并不复杂：Controller 负责接收参数和分页入口，Service 承担业务规则和数据权限注解，Mapper 接口描述数据访问方法，XML 保留可控的 SQL。

```text
Controller → Service → Mapper 接口 → Mapper XML → MySQL
```

这样的分层有一个实际好处：**业务规则与 SQL 可以分别演进**。例如“用户列表”既需要用户名模糊查询，又需要部门数据权限。Controller 不需要拼 SQL，Service 负责声明数据权限，XML 专注查询条件和结果映射。

```java
@Service
public class SysUserServiceImpl implements ISysUserService {

    @Resource
    private SysUserMapper userMapper;

    @Override
    @DataScope(deptAlias = "d", userAlias = "u")
    public List<SysUser> selectUserList(SysUser user) {
        return userMapper.selectUserList(user);
    }
}
```

```xml
<select id="selectUserList" parameterType="SysUser" resultMap="SysUserResult">
    SELECT u.user_id, u.user_name, u.nick_name, u.status, u.create_time,
           d.dept_name
    FROM sys_user u
    LEFT JOIN sys_dept d ON u.dept_id = d.dept_id
    <where>
        u.del_flag = '0'
        <if test="userName != null and userName != ''">
            AND u.user_name LIKE CONCAT('%', #{userName}, '%')
        </if>
        <if test="status != null and status != ''">
            AND u.status = #{status}
        </if>
        ${params.dataScope}
    </where>
    ORDER BY u.user_id DESC
</select>
```

> **注意**：`${params.dataScope}` 是 RuoYi 数据权限切面内部生成的受控 SQL 片段。普通业务参数一律使用 `#{}`，不要把前端输入直接拼进 `${}`。

## 二、PageHelper 分页原理

### 2.1 Controller 的标准写法

RuoYi 的 `BaseController` 已把分页入口和统一返回封装好：

```java
@PreAuthorize("@ss.hasPermi('system:user:list')")
@GetMapping("/list")
public TableDataInfo list(SysUser user) {
    startPage();
    List<SysUser> list = userService.selectUserList(user);
    return getDataTable(list);
}
```

这里看起来只有三行，实际上完成了四件事：读取 `pageNum`、`pageSize` 和排序参数；把分页信息放进当前线程上下文；让 PageHelper 改写 Mapper SQL；把结果统一转为 `{ total, rows, code, msg }`。

![图1：PageHelper 分页请求链路](mybatis-page-query-flow.svg)

### 2.2 `startPage()` 做了什么

`BaseController.startPage()` 通常委托给 RuoYi 的 `PageUtils.startPage()`：

```java
protected void startPage() {
    PageUtils.startPage();
}
```

核心逻辑可以简化理解为：

```java
public static void startPage() {
    int pageNum = ServletUtils.getParameterToInt(Constants.PAGE_NUM, 1);
    int pageSize = ServletUtils.getParameterToInt(Constants.PAGE_SIZE, 10);
    String orderBy = SqlUtil.escapeOrderBySql(ServletUtils.getParameter(Constants.ORDER_BY_COLUMN));

    PageHelper.startPage(pageNum, pageSize, orderBy);
}
```

PageHelper 把分页参数保存到 **ThreadLocal**。因此它必须紧挨在目标 Mapper 查询之前调用；如果中间先执行了另一条 SQL，分页可能会“套”到错误的查询上。

### 2.3 SQL 如何被改写

假设原 SQL 是：

```sql
SELECT user_id, user_name, nick_name
FROM sys_user
WHERE del_flag = '0'
ORDER BY user_id DESC;
```

当执行 `PageHelper.startPage(2, 10)` 后，插件一般会额外发起总数查询，并把数据查询改写为：

```sql
SELECT COUNT(0)
FROM sys_user
WHERE del_flag = '0';

SELECT user_id, user_name, nick_name
FROM sys_user
WHERE del_flag = '0'
ORDER BY user_id DESC
LIMIT 10, 10;
```

`getDataTable(list)` 则读取 `PageInfo` 中的总数：

```java
protected TableDataInfo getDataTable(List<?> list) {
    TableDataInfo rspData = new TableDataInfo();
    rspData.setCode(HttpStatus.SUCCESS);
    rspData.setMsg("查询成功");
    rspData.setRows(list);
    rspData.setTotal(new PageInfo(list).getTotal());
    return rspData;
}
```

### 2.4 三个分页坑

1. **`startPage()` 调晚了**：只能对紧随其后的第一条查询生效。
2. **返回后又遍历触发查询**：懒加载或二次查询可能导致 N+1 问题，页面越大越慢。
3. **深分页变慢**：`LIMIT 1000000, 20` 需要跳过大量记录，索引再好也会越来越慢。

深分页可使用“游标/Keyset 分页”：

```sql
-- 不再传 pageNum，而是传上一页最后一条 id
SELECT user_id, user_name, nick_name
FROM sys_user
WHERE del_flag = '0'
  AND user_id < #{lastId}
ORDER BY user_id DESC
LIMIT #{pageSize};
```

它适合无限滚动、流水日志等“只向后翻”的列表；需要任意跳页的后台表格仍优先使用普通分页。

## 三、动态 SQL：灵活不等于随意拼接

![图2：MyBatis 动态 SQL 组合](mybatis-dynamic-sql.svg)

### 3.1 常用标签

| 标签 | 作用 | 常见用途 |
|---|---|---|
| `<if>` | 条件成立时拼接片段 | 可选查询条件 |
| `<where>` | 自动添加 WHERE，并去掉首个 AND/OR | 多条件查询 |
| `<trim>` | 自定义前后缀、去除指定前缀 | 复杂 UPDATE / WHERE |
| `<set>` | 自动处理 UPDATE 字段逗号 | 动态更新 |
| `<foreach>` | 遍历集合 | `IN (...)`、批量插入 |
| `<choose>` | 类似 if / else if / else | 条件分支 |

### 3.2 安全的动态查询

```xml
<select id="selectByIds" resultType="SysUser">
    SELECT user_id, user_name, nick_name
    FROM sys_user
    <where>
        del_flag = '0'
        <if test="userIds != null and userIds.size() > 0">
            AND user_id IN
            <foreach collection="userIds" item="id" open="(" separator="," close=")">
                #{id}
            </foreach>
        </if>
    </where>
</select>
```

`#{id}` 会变成预编译参数，数据库把“SQL 结构”和“参数值”分开处理，避免注入。

### 3.3 `${}` 只能用于受控结构

下面的写法是危险的：

```xml
ORDER BY ${orderBy}
```

如果 `orderBy` 来自前端，攻击者可能构造额外 SQL。RuoYi 的排序字段会经过 `SqlUtil.escapeOrderBySql()` 白名单过滤；自己的接口也应该做同样处理：

```java
private static final Set<String> ALLOWED_SORT_COLUMNS = Set.of("userId", "userName", "createTime");

public String safeOrderBy(String column, String direction) {
    String safeColumn = ALLOWED_SORT_COLUMNS.contains(column) ? column : "userId";
    String safeDirection = "asc".equalsIgnoreCase(direction) ? "ASC" : "DESC";
    return safeColumn + " " + safeDirection;
}
```

**口诀**：**值用 `#{}`，结构走白名单；不要让请求参数直接进入 `${}`。**

## 四、数据权限与插件链

RuoYi 的 `@DataScope` 不是 MyBatis 默认功能，而是基于 AOP 在进入 Mapper 前把权限 SQL 放进 `BaseEntity.params`。PageHelper、日志插件、自定义拦截器则在 MyBatis 执行层继续工作。

![图3：查询增强与拦截器链](mybatis-interceptor-chain.svg)

一个典型顺序如下：

1. Controller 调用 Service；
2. `DataScopeAspect` 根据当前用户角色生成部门/本人范围；
3. Mapper XML 通过 `${params.dataScope}` 使用受控条件；
4. PageHelper 拦截并追加 count/limit；
5. 数据源路由决定使用主库或从库；
6. SQL 被执行并记录耗时。

### 4.1 自定义拦截器的原则

- **只做一件事**：分页、审计、脱敏、租户条件不要塞进同一个拦截器。
- **明确顺序**：多个插件改写 SQL 时，顺序会影响最终语句。
- **避免重复条件**：数据权限和多租户都可能追加 `dept_id`/`tenant_id`，必须有统一约定。
- **保留可观测性**：开发环境打开 SQL 日志，线上记录慢 SQL 和错误 SQL，不要长期开 DEBUG 全量参数。

## 五、多数据源与读写分离

单体 RuoYi-Vue 中可以通过 `@DataSource` 做动态数据源切换，但读写分离需要自己准备从库、复制延迟监控和故障策略。

![图4：读写分离的最小闭环](mybatis-read-write-splitting.svg)

### 5.1 基础配置示意

```yaml
spring:
  datasource:
    dynamic:
      primary: master
      datasource:
        master:
          url: jdbc:mysql://db-master:3306/ry_vue
          username: ${DB_MASTER_USERNAME}
          password: ${DB_MASTER_PASSWORD}
        slave:
          url: jdbc:mysql://db-slave:3306/ry_vue
          username: ${DB_SLAVE_USERNAME}
          password: ${DB_SLAVE_PASSWORD}
```

密码应来自环境变量、密钥管理服务或部署平台，不能提交到 Git。

### 5.2 在 Service 上路由

```java
@Service
public class ReportServiceImpl implements IReportService {

    @DataSource(DataSourceType.SLAVE)
    @Override
    public List<UserReportVO> selectDailyReport(LocalDate date) {
        return reportMapper.selectDailyReport(date);
    }

    @DataSource(DataSourceType.MASTER)
    @Transactional(rollbackFor = Exception.class)
    @Override
    public void saveReportConfig(ReportConfig config) {
        reportMapper.insertReportConfig(config);
    }
}
```

### 5.3 必须接受“复制延迟”

写入主库后立即从从库读取，可能读到旧数据。以下场景必须回主库：

- 用户刚修改完资料，立刻回显；
- 下单、支付、库存变更；
- 权限、菜单、字典等影响访问控制的数据。

读写分离不是“给所有查询加 `SLAVE`”，而是根据一致性要求划边界。

## 六、查询性能优化清单

### 6.1 从执行计划开始

```sql
EXPLAIN
SELECT user_id, user_name, create_time
FROM sys_user
WHERE del_flag = '0'
  AND status = '0'
  AND create_time >= '2026-08-01'
ORDER BY create_time DESC
LIMIT 20;
```

重点关注：

- `type=ALL`：往往是全表扫描；
- `rows`：预估扫描行数；
- `key`：是否实际命中目标索引；
- `Extra` 中的 `Using filesort`、`Using temporary`：不一定错误，但应结合数据量判断。

### 6.2 避免 N+1 查询

反例：先查 20 个用户，再循环查 20 次部门。

```java
List<SysUser> users = userMapper.selectUserList(query);
for (SysUser user : users) {
    user.setDept(deptMapper.selectDeptById(user.getDeptId()));
}
```

优化：一次 `JOIN` 或一次 `IN` 批量查询，再在内存组装。

```xml
SELECT u.user_id, u.user_name, d.dept_name
FROM sys_user u
LEFT JOIN sys_dept d ON d.dept_id = u.dept_id
WHERE u.del_flag = '0'
```

### 6.3 建索引前先问三个问题

1. 高频过滤条件是什么？
2. 排序字段是什么？
3. 是否能利用联合索引的最左前缀？

例如用户列表最常按状态和创建时间过滤排序：

```sql
CREATE INDEX idx_user_status_create_time
ON sys_user(status, create_time DESC);
```

索引不是越多越好。每个索引都增加写入成本，并占用存储空间。

## 七、总结

- `startPage()` 必须紧挨分页查询；PageHelper 通过 ThreadLocal 和插件改写 SQL。
- 动态 SQL 用标签组织条件，参数值统一用 `#{}`；`${}` 只可接收经过白名单校验的结构。
- `@DataScope` 是 RuoYi 的 AOP 增强，和 PageHelper、动态数据源一起构成查询链路。
- 读写分离是可选架构，必须处理复制延迟和故障切换。
- 性能优化从慢 SQL、执行计划、N+1 和深分页的证据开始，而不是凭感觉加缓存或索引。

**下一篇预告**：接口除了能调用，还要可读、可校验、可定位错误。我们会拆解 Swagger/OpenAPI、JSR-303 参数校验、统一异常处理和防重复提交。

> **思考与练习**
>
> 1. 为一个用户列表接口加入 `startPage()`，观察 PageHelper 生成的 count SQL 与分页 SQL。
> 2. 用 `<foreach>` 实现批量 ID 查询，并确认所有值都使用 `#{}`。
> 3. 对一个真实慢查询执行 `EXPLAIN`，记录扫描行数、命中索引和优化前后耗时。