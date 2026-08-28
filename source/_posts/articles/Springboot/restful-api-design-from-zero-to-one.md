---
title: RESTful API 设计从 0 到 1：大白话讲透资源、方法、状态码与 Spring Boot 实战
date: 2026-08-18 10:00:00
categories:
  - 教程
tags:
  - RESTful
  - HTTP
  - API 设计
description: 从一份"动词满天飞"的接口事故现场讲起，用大白话讲透 REST 的资源建模、HTTP 方法幂等性、URI 设计规范与状态码家族，并给出一套可以直接抄走的 Spring Boot 用户管理 CRUD 与全局异常处理代码。
keywords:
  - RESTful 教程
  - REST API 设计
  - HTTP 幂等性
  - Spring Boot RESTful
lang: zh-CN
---

> 写给每次设计接口都在纠结"这个接口叫什么名、用 GET 还是 POST、返回什么码"的 Java 开发者。这篇不背论文，先用大白话把 REST 的思想讲明白，再落地到可以直接抄走的 Spring Boot 代码。

## 一、什么是 RESTful：先看一份"事故现场"接口文档

接手过一个老项目，接口文档长这样：

- `GET /getUserById?id=1` —— 查用户
- `POST /user/delete?id=1` —— 删用户
- `POST /user/update` —— 改用户
- `GET /user/getUserList` —— 用户列表

每一行都要靠注释才知道是干嘛的：删除用 POST、更新不传 id、列表方法名里带 get……接口一多，文档没人维护，前端靠口口相传，调用方靠猜。

**RESTful 就是治这个病的。** 它由 HTTP 协议的主要设计者之一 Roy Fielding 在 2000 年的博士论文中提出（REST = Representational State Transfer，表述性状态转移），核心主张一句话：

> 把后端提供的一切都看作**资源**，用 **URI 定位资源**，用 **HTTP 方法表达意图**，用 **状态码反馈结果**。

![图 1：REST 核心思想](rest-core-concept.svg)

### 1.1 一切皆资源：URI 是名词，方法是动词

把接口当成"操作数据库里的东西"来设计：

- 用户是一种资源，订单是一种资源，商品也是一种资源；
- URI 只负责**定位**：`/users/1` 就是"1 号用户"这个资源，它是个名词，不带任何动作；
- 动作全部交给 HTTP 方法：`GET /users/1` 是查询，`DELETE /users/1` 是删除，`PUT /users/1` 是更新。

上面那份事故文档，用 RESTful 重写后：`GET /users/1`、`DELETE /users/1`、`PUT /users/1`、`GET /users`——不用一行注释，看 URI + 方法就知道是什么操作。这种"看一眼就懂"的能力，就是接口的**自解释性**。

### 1.2 RESTful 不是标准，是约定

没有编译器强迫你写 RESTful，它只是一种**风格约定**。但全行业都按这套约定说话时，收益是巨大的：

- 新同事看 URI 就能上手，不用翻文档；
- 网关、监控、重试组件能根据方法语义做正确的事（GET 失败可以自动重试，POST 不敢）；
- 缓存可以放心地按 `GET + URI` 做键。

### 1.3 两条最容易被忽略的约束

**无状态（Stateless）**：每个请求必须自带全部信息（认证令牌、参数），服务器不依赖"上一个请求"留下的记忆。这样任何一个实例都能处理任何请求——这是后面负载均衡、横向扩容的基础。

**资源的表现层（Representation）**：资源本身是数据，客户端拿到的是它的一种"表现形式"，通常是 JSON。请求头里的 `Content-Type: application/json` 就是在声明表现格式。

## 二、HTTP 方法：把动词从 URI 里请出去

HTTP 协议早就内置了一套标准动词，不用白不用。先看全景：

![图 2：五种 HTTP 方法的语义、安全性与幂等性](rest-http-methods.svg)

两个容易混的概念，面试也常问：

**安全性（Safe）**：这个方法**只读**、不会改动服务器数据吗？只有 GET 安全。注意"安全"不是指加密，是指"不产生副作用"。

**幂等性（Idempotent）**：同一个请求发 1 次和发 N 次，**结果是否相同**。GET、PUT、DELETE 是幂等的：

- `PUT /users/1` 全量替换成同一个值，替换 100 次结果也一样；
- `DELETE /users/1` 删 1 次和删 100 次都是"1 号用户不存在了"；
- **POST 不幂等**：提交两次订单就是两笔订单。

幂等性为什么重要？网络是不靠谱的——客户端发出请求，超时了，它不知道服务器到底执行没执行，只能重试。如果接口幂等，重试就是安全的；POST 不幂等，盲目重试就可能重复下单，这就是支付接口都要加"幂等令牌"（客户端先生成一个唯一 ID，服务端据此去重）的原因。

**PUT 和 PATCH 的区别**：PUT 是**全量替换**，请求体里要带上资源的完整字段，没带的字段会被覆盖成空；PATCH 是**部分更新**，只传要改的字段。字段少的资源用 PUT 就够，字段多且更新零散时 PATCH 更省流量。

## 三、URI 设计规范：名词的语法

![图 3：URI 设计正反对照](rest-uri-design-compare.svg)

### 规则 1：资源用复数名词

`/users` 表示用户集合，`/users/1` 表示其中的 1 号。集合用复数是主流约定（也有团队坚持单数，关键是**全项目统一**）。

### 规则 2：层级表达从属，但别嵌套太深

用户下的订单：`GET /users/1/orders`（1 号用户的订单列表）。层级建议**不超过两层**——再深就提升为顶层资源：`GET /orders?userId=1` 同样清晰，还更好分页。

### 规则 3：过滤、分页、排序走查询参数

```text
GET /users?page=1&size=20&sort=createdAt,desc&role=admin&keyword=frank
```

所有"筛选条件"都是查询参数，不要发明 `/users/admin/recent` 这种路径。

### 规则 4：URI 里不出现动词

动词的活儿全被 HTTP 方法干了，URI 里再出现 `getUser`、`deleteUser` 就是语义重复。

### 规则 5：命名用小写 + 中划线

URL 里字母大小写不敏感但习惯难统一，统一小写；多个单词用中划线：`/refund-orders`（而不是 `refundOrders` 或 `refund_orders`——驼峰和下划线留给 JSON 字段和代码）。

## 四、状态码：接口的表情

HTTP 状态码是接口的"表情"，出现在响应的第一行，任何 HTTP 客户端、网关、监控都认识它：

![图 4：HTTP 状态码家族地图](rest-status-codes.svg)

日常开发记住这些就够用：

| 场景 | 状态码 |
| --- | --- |
| 查询成功 | 200 OK |
| 创建成功 | 201 Created |
| 删除成功（无响应体） | 204 No Content |
| 参数校验失败 | 400 Bad Request |
| 没登录 / 令牌失效 | 401 Unauthorized |
| 登录了但没权限 | 403 Forbidden |
| 资源不存在 | 404 Not Found |
| 重复创建等状态冲突 | 409 Conflict |
| 触发限流 | 429 Too Many Requests |
| 代码抛异常 | 500 Internal Server Error |

401 和 403 的区分记一句话：**401 是"你是谁？"，403 是"我知道你是谁，但你不行"。**

### 常见误区：全部返回 200，错误塞在 body 里

很多老项目所有接口都返回 200，body 里再放 `{code: 500, msg: "系统错误"}`。这样做把 HTTP 语义整个架空了：

- 网关和监控按状态码统计错误率，全部 200 意味着**报警全瞎**；
- 前端的统一响应拦截器只能去解析 body 才能判断成败，处处写特判；
- 重试、熔断组件无法基于状态码自动决策。

正确姿势：**HTTP 状态码表达"这一类结果"，业务码放 body 里表达"具体哪件事"**，两者配合（见下一节）。

## 五、统一响应格式与全局异常处理

### 5.1 统一响应体

```java
public record Result<T>(int code, String message, T data) {

    public static <T> Result<T> ok(T data) {
        return new Result<>(0, "success", data);
    }

    public static <T> Result<T> fail(int code, String message) {
        return new Result<>(code, message, null);
    }
}
```

`code = 0` 表示成功，非 0 是业务错误码（比如 40401 表示"用户不存在"，前三位对齐 HTTP 状态码，方便人读）。

### 5.2 业务异常携带 HTTP 状态码

```java
public class BizException extends RuntimeException {

    private final int code;         // 业务码
    private final HttpStatus http;  // 对应的 HTTP 状态码

    public BizException(int code, HttpStatus http, String message) {
        super(message);
        this.code = code;
        this.http = http;
    }

    public static BizException userNotFound(Long id) {
        return new BizException(40401, HttpStatus.NOT_FOUND, "用户不存在: " + id);
    }

    public static BizException usernameDuplicated(String username) {
        return new BizException(40901, HttpStatus.CONFLICT, "用户名已存在: " + username);
    }

    public int getCode() { return code; }
    public HttpStatus getHttp() { return http; }
}
```

### 5.3 全局异常处理：一个类兜住所有接口

```java
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /** 业务异常：状态码由异常自己决定 */
    @ExceptionHandler(BizException.class)
    public ResponseEntity<Result<Void>> handleBiz(BizException e) {
        return ResponseEntity.status(e.getHttp())
                .body(Result.fail(e.getCode(), e.getMessage()));
    }

    /** 参数校验失败：统一 400 */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<Result<Void>> handleValid(MethodArgumentNotValidException e) {
        String msg = e.getBindingResult().getFieldErrors().stream()
                .map(f -> f.getField() + " " + f.getDefaultMessage())
                .collect(Collectors.joining("；"));
        return ResponseEntity.badRequest().body(Result.fail(40000, msg));
    }

    /** 兜底：未知异常统一 500，日志记全，对外不泄露堆栈 */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<Result<Void>> handleOther(Exception e) {
        log.error("未捕获异常", e);
        return ResponseEntity.internalServerError()
                .body(Result.fail(50000, "系统繁忙，请稍后重试"));
    }
}
```

这样业务代码里只需要 `throw BizException.userNotFound(id)`，状态码、业务码、错误信息一次到位。

## 六、Spring Boot 实战：一套完整的用户管理接口

五个方法覆盖一套资源的标准 CRUD，注意每个方法对应的状态码：

```java
@RestController
@RequestMapping("/api/v1/users")
public class UserController {

    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }

    /** 列表 + 分页：GET /api/v1/users?page=1&size=20 */
    @GetMapping
    public Result<PageResult<UserVO>> list(@RequestParam(defaultValue = "1") int page,
                                           @RequestParam(defaultValue = "20") int size) {
        return Result.ok(userService.page(page, size));
    }

    /** 查询单个：GET /api/v1/users/1 */
    @GetMapping("/{id}")
    public Result<UserVO> getById(@PathVariable Long id) {
        return Result.ok(userService.getById(id));
    }

    /** 新增：POST /api/v1/users，返回 201 */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Result<UserVO> create(@RequestBody @Valid UserCreateRequest req) {
        return Result.ok(userService.create(req));
    }

    /** 全量更新：PUT /api/v1/users/1 */
    @PutMapping("/{id}")
    public Result<UserVO> update(@PathVariable Long id,
                                 @RequestBody @Valid UserUpdateRequest req) {
        return Result.ok(userService.update(id, req));
    }

    /** 删除：DELETE /api/v1/users/1，返回 204 无响应体 */
    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        userService.delete(id);
    }
}
```

用 curl 过一遍完整生命周期：

```bash
# 新增用户 → 201
curl -i -X POST "http://localhost:8080/api/v1/users" \
  -H "Content-Type: application/json" \
  -d '{"username":"frank","email":"frank@example.com"}'

# 查询列表（第 1 页，每页 20）→ 200
curl "http://localhost:8080/api/v1/users?page=1&size=20"

# 查单个 → 200；不存在则 404
curl -i "http://localhost:8080/api/v1/users/1"

# 删除 → 204
curl -i -X DELETE "http://localhost:8080/api/v1/users/1"
```

几个 Spring 细节：`@PathVariable` 取路径里的 `{id}`；`@RequestBody` 把 JSON 反序列化成对象；`@Valid` 触发参数校验（校验失败走上面全局处理的 400 分支）；`@ResponseStatus` 在返回成功时把状态码改成 201/204，而异常场景的状态码由 `ResponseEntity` 接管。

## 七、工程上再往前一步

**版本管理**：接口免不了要改，用 `/api/v1/...` 把版本放进路径，破坏性变更发 v2，老版本留一个过渡期。另一种主流做法是请求头 `Accept: application/vnd.myapp.v2+json`，效果相同，团队统一即可。

**分页响应的结构**：列表接口别只返回数组，带上总数和分页信息，前端才能渲染页码：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "list": [ { "id": 1, "username": "frank" } ],
    "total": 137,
    "page": 1,
    "size": 20
  }
}
```

**HATEOAS 知道即可**：REST 论文里的完整形态还要求响应里带"下一步动作的链接"（比如订单响应里带 `payUrl`、`cancelUrl`）。这是最严格的约束，实践中绝大多数公司的"RESTful"只做到本文这套水平，面试能说出这个词和含义就够了。

**幂等令牌**：对 POST 这类不幂等的接口，让客户端先申请一个一次性 token（或自己生成 UUID），请求带上它，服务端用 Redis `SETNX` 去重——重复请求直接返回首次的结果。

## 八、设计自查清单

新接口上线前，过一遍这十条：

1. URI 里只有名词（复数），没有动词；
2. 动作由 GET / POST / PUT / PATCH / DELETE 表达；
3. 过滤、分页、排序全部走查询参数；
4. 资源层级不超过两层；
5. 命名统一小写 + 中划线；
6. 成功：查询 200、创建 201、删除 204；
7. 失败：参数错 400、未登录 401、没权限 403、不存在 404、冲突 409；
8. 响应体统一 `{code, message, data}`，业务码和 HTTP 状态码各司其职；
9. 所有异常收敛到 `@RestControllerAdvice`，500 不外泄堆栈；
10. 不幂等的接口（支付、下单）有幂等令牌兜底。

## 九、总结

RESTful 的本质不是"URL 好看"，而是**复用 HTTP 协议自带的语义系统**：URI 定位资源、方法表达意图、状态码反馈结果、无状态支撑横向扩容。这套约定让接口自解释，让网关、监控、缓存、重试这些基础设施都能按协议正确工作。

从下一篇接口开始，先把 URI 里的动词请出去——这一步最便宜，收益最大。

---

推荐结合阅读：[SSE / WebSocket 从零到一](/2026/08/17/articles/http-sse-websocket/sse-websocket-from-zero-to-one-beginner/)（同为 HTTP 体系下的实时通信方案）、[接口限流从 0 到 1](/2026/08/17/articles/Java/java-api-rate-limiting/)（429 状态码背后的算法实现）。
