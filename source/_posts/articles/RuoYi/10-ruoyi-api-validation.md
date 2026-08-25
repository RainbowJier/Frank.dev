---
title: RuoYi 框架从零到一 10 - 接口文档与参数校验
date: 2026-08-25 10:00:00
categories:
  - 教程
tags:
  - RuoYi
  - Swagger
  - 参数校验
  - 接口设计
description: 从 Controller 边界出发，讲清 RuoYi 的统一响应、Swagger/OpenAPI 文档、JSR-303 分组校验、全局异常处理、防重复提交和生产环境接口安全。
lang: zh-CN
---

> **适合人群**：已经会写 RuoYi CRUD，希望让接口更容易协作、校验更可靠、错误更容易定位的同学。
> 本文是《RuoYi 框架从零到一》系列第 10 篇。Swagger/OpenAPI 的具体依赖会随 RuoYi 分支和 Spring Boot 版本变化，本文重点讲设计方式。
>
> 建议先读 {% post_link articles/RuoYi/09-ruoyi-mybatis-pagination '09 - MyBatis 增强与分页' %}。

## 一、Controller 是系统边界

一个接口不是“把方法暴露出去”这么简单。它至少需要回答五个问题：

1. 谁可以调用？
2. 请求参数长什么样？
3. 参数不合法时返回什么？
4. 成功和失败如何统一表达？
5. 调用方在哪里查看和调试？

![图1：RuoYi 接口统一处理链路](ruoyi-api-request-response.svg)

RuoYi 常见的 Controller 结构如下：

```java
@RestController
@RequestMapping("/system/user")
public class SysUserController extends BaseController {

    @PreAuthorize("@ss.hasPermi('system:user:add')")
    @PostMapping
    public AjaxResult add(@Validated(AddGroup.class) @RequestBody SysUser user) {
        return toAjax(userService.insertUser(user));
    }
}
```

- `@RestController`：返回 JSON；
- `@RequestMapping`：统一资源路径；
- `@PreAuthorize`：方法级权限；
- `@Validated`：触发参数校验；
- `AjaxResult`：统一表达成功或失败。

## 二、统一响应结构

### 2.1 AjaxResult

RuoYi 的 `AjaxResult` 通常使用 `code`、`msg`、`data` 三个核心字段：

```json
{
  "code": 200,
  "msg": "操作成功",
  "data": {
    "userId": 1001
  }
}
```

失败响应示例：

```json
{
  "code": 500,
  "msg": "用户名已存在",
  "data": null
}
```

业务代码不应该把数据库异常原文直接返回给前端；可预期的业务问题抛出 `ServiceException`，由全局处理器转换为安全的提示信息。

### 2.2 TableDataInfo

列表接口使用 `TableDataInfo` 表达分页数据：

```json
{
  "code": 200,
  "msg": "查询成功",
  "total": 125,
  "rows": [
    { "userId": 1, "userName": "admin" }
  ]
}
```

这样前端表格只需要约定 `rows` 和 `total`，不必为每个业务模块写一套分页解析逻辑。

### 2.3 不要混用响应模型

建议在团队内约定：

- 单对象、新增、修改、删除：`AjaxResult`；
- 分页列表：`TableDataInfo`；
- 跨服务调用：可在网关或 Cloud 分支定义泛型 `R<T>`，但不要让同一个项目出现多套互不兼容的错误码。

## 三、Swagger/OpenAPI 文档

![图3：接口文档生成架构](openapi-document-architecture.svg)

### 3.1 文档从哪里来

OpenAPI 文档通常由三部分共同生成：

1. Controller 的路径和 HTTP 方法；
2. DTO、字段和校验注解；
3. `@Api`、`@ApiOperation` 或 OpenAPI 3 的 `@Tag`、`@Operation` 等描述注解。

RuoYi 不同分支可能使用 Springfox Swagger 2，也可能迁移到 springdoc OpenAPI。判断项目实际使用哪一种，应该先看 `pom.xml` 和配置类，不要直接复制另一分支的配置。

### 3.2 Swagger 2 风格示例

```java
@Api(tags = "用户管理")
@RestController
@RequestMapping("/system/user")
public class SysUserController {

    @ApiOperation("查询用户列表")
    @ApiImplicitParams({
        @ApiImplicitParam(name = "userName", value = "用户账号", dataType = "String"),
        @ApiImplicitParam(name = "pageNum", value = "页码", dataType = "Integer")
    })
    @GetMapping("/list")
    public TableDataInfo list(SysUser user) {
        startPage();
        return getDataTable(userService.selectUserList(user));
    }
}
```

### 3.3 OpenAPI 3 风格示例

```java
@Tag(name = "用户管理")
@RestController
@RequestMapping("/system/user")
public class SysUserController {

    @Operation(summary = "查询用户列表", description = "按账号和状态分页查询")
    @GetMapping("/list")
    public TableDataInfo list(SysUserQuery query) {
        startPage();
        return getDataTable(userService.selectUserList(query));
    }
}
```

**建议**：新项目优先使用当前 Spring 生态维护中的 OpenAPI 方案；存量 RuoYi 项目则以现有依赖为准，避免为了“换文档页面”引入不必要的框架升级。

### 3.4 文档分组

大型项目可按模块分组：

```java
@Bean
public GroupedOpenApi systemApi() {
    return GroupedOpenApi.builder()
            .group("system")
            .pathsToMatch("/system/**")
            .build();
}

@Bean
public GroupedOpenApi businessApi() {
    return GroupedOpenApi.builder()
            .group("business")
            .pathsToMatch("/business/**")
            .build();
}
```

### 3.5 生产环境不要裸奔

文档页面可能暴露路径、参数和模型信息。生产环境至少做到：

```yaml
springdoc:
  api-docs:
    enabled: false
  swagger-ui:
    enabled: false
```

如果必须开放，应该放在内网、网关白名单或单独的管理认证之后，并对文档接口自身做访问审计。

## 四、JSR-303 参数校验

### 4.1 DTO 与实体分离

查询条件、创建请求和修改请求的约束通常不同，建议使用 DTO，而不是把所有校验都堆到数据库实体上：

```java
public class UserCreateRequest {

    @NotBlank(message = "用户账号不能为空")
    @Size(max = 30, message = "用户账号不能超过 30 个字符")
    private String userName;

    @NotBlank(message = "邮箱不能为空")
    @Email(message = "邮箱格式不正确")
    private String email;
}
```

```java
@PostMapping
public AjaxResult add(@Validated @RequestBody UserCreateRequest request) {
    return toAjax(userService.create(request));
}
```

### 4.2 常用注解

| 注解 | 作用 |
|---|---|
| `@NotNull` | 不能为 `null`，允许空字符串 |
| `@NotBlank` | 不能为 `null`，不能是空白字符串 |
| `@NotEmpty` | 集合、数组、字符串不能为空 |
| `@Size` | 长度或集合大小限制 |
| `@Length` | Hibernate Validator 的字符串长度限制 |
| `@Email` | 邮箱格式 |
| `@Pattern` | 正则表达式 |
| `@Min` / `@Max` | 数值上下限 |
| `@Past` / `@Future` | 日期范围 |

### 4.3 新增与修改分组

```java
public interface AddGroup {}
public interface EditGroup {}

public class UserRequest {

    @Null(message = "新增时不能传用户 ID", groups = AddGroup.class)
    @NotNull(message = "修改时必须传用户 ID", groups = EditGroup.class)
    private Long userId;

    @NotBlank(message = "用户账号不能为空", groups = {AddGroup.class, EditGroup.class})
    private String userName;
}
```

Controller 选择分组：

```java
@PostMapping
public AjaxResult add(@Validated(AddGroup.class) @RequestBody UserRequest request) {
    return toAjax(userService.create(request));
}

@PutMapping
public AjaxResult edit(@Validated(EditGroup.class) @RequestBody UserRequest request) {
    return toAjax(userService.update(request));
}
```

![图2：分组校验与异常转换流程](validation-groups-flow.svg)

## 五、全局异常处理

### 5.1 为什么要统一处理

如果每个 Controller 都自己 `try-catch`，很快会出现：错误码不一致、异常信息泄露、日志重复记录。统一异常处理器可以把异常分成四类：

1. **参数异常**：字段校验失败，返回 400；
2. **认证/权限异常**：未登录或无权限，返回 401/403；
3. **业务异常**：库存不足、名称重复，返回业务提示；
4. **系统异常**：未知错误，记录完整日志但只返回通用提示。

### 5.2 处理器示例

```java
@RestControllerAdvice
public class GlobalExceptionHandler {

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public AjaxResult handleValidException(MethodArgumentNotValidException ex) {
        String message = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + ": " + error.getDefaultMessage())
                .collect(Collectors.joining("；"));
        return AjaxResult.error(HttpStatus.BAD_REQUEST, message);
    }

    @ExceptionHandler(BindException.class)
    public AjaxResult handleBindException(BindException ex) {
        String message = ex.getAllErrors().stream()
                .map(ObjectError::getDefaultMessage)
                .collect(Collectors.joining("；"));
        return AjaxResult.error(HttpStatus.BAD_REQUEST, message);
    }

    @ExceptionHandler(ServiceException.class)
    public AjaxResult handleServiceException(ServiceException ex) {
        return AjaxResult.error(ex.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public AjaxResult handleException(Exception ex) {
        log.error("未处理异常", ex);
        return AjaxResult.error("系统繁忙，请稍后重试");
    }
}
```

### 5.3 不要把异常吞掉

下面的写法会让问题难以排查：

```java
try {
    service.save(request);
} catch (Exception e) {
    return AjaxResult.error("保存失败");
}
```

至少要记录上下文，或者让统一处理器接管：

```java
try {
    service.save(request);
} catch (Exception e) {
    log.error("保存用户失败，userName={}", request.getUserName(), e);
    throw new ServiceException("保存用户失败");
}
```

## 六、防重复提交与幂等

RuoYi 常见的 `@RepeatSubmit` 主要用于防止用户短时间重复点击。它解决的是“重复请求”，不是完整的业务幂等。

### 6.1 接口防重复提交

```java
@RepeatSubmit(interval = 2000, message = "请求过于频繁，请稍后再试")
@PostMapping("/save")
public AjaxResult save(@RequestBody OrderCreateRequest request) {
    return toAjax(orderService.create(request));
}
```

### 6.2 业务幂等还需要唯一约束

支付、订单、库存等核心操作应该同时使用业务幂等键和数据库唯一索引：

```sql
ALTER TABLE t_order
ADD UNIQUE KEY uk_order_request_no (request_no);
```

```java
@Transactional(rollbackFor = Exception.class)
public Long create(OrderCreateRequest request) {
    Order old = orderMapper.selectByRequestNo(request.getRequestNo());
    if (old != null) {
        return old.getOrderId();
    }
    try {
        orderMapper.insert(request.toEntity());
    } catch (DuplicateKeyException ex) {
        return orderMapper.selectByRequestNo(request.getRequestNo()).getOrderId();
    }
    return request.getOrderId();
}
```

## 七、接口设计检查清单

### 请求层

- 路径是否表达资源，而不是暴露内部方法名？
- 创建、修改、查询是否使用不同 DTO？
- 是否限制分页大小，避免 `pageSize=100000`？
- 是否校验排序字段和导出字段？

### 响应层

- 是否统一 `code`、`msg`、`data` 或 `rows`、`total`？
- 是否隐藏堆栈、SQL、内部路径和密钥？
- 错误信息是否足够定位，但没有暴露敏感实现？

### 文档层

- 是否标记权限要求、参数说明和响应模型？
- 是否有可执行的请求示例？
- 生产环境是否关闭或保护 Swagger UI？

## 八、总结

- Controller 是认证、校验、业务和响应的边界，不只是路由入口。
- `AjaxResult` 适合普通操作，`TableDataInfo` 适合分页列表，团队应避免响应结构漂移。
- Swagger/OpenAPI 要结合当前 RuoYi 分支的依赖使用，生产环境必须受控。
- DTO、校验注解和分组校验能把错误尽早挡在业务层之外。
- 全局异常处理器统一转换参数、业务和系统异常；核心写接口还要用唯一约束保证幂等。

**下一篇预告**：Redis 缓存能提升性能，也会带来穿透、击穿、一致性和热点 Key 问题。下一篇会把这些问题放到 RuoYi 的 Token、字典和业务缓存场景中逐一拆开。

> **思考与练习**
>
> 1. 为用户新增和修改接口分别设计 `AddGroup`、`EditGroup` 校验。
> 2. 为一个分页接口补充 OpenAPI 响应模型和参数上限。
> 3. 为订单创建接口增加幂等请求号和数据库唯一索引。