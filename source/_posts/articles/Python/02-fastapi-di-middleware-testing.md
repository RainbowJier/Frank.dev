---
title: FastAPI 入门（02）：依赖注入、中间件与测试
date: 2026-10-30 15:40:00
categories:
  - 教程
tags:
  - Python
  - FastAPI
  - 异步编程
description: 用一个可运行的小项目讲清 FastAPI 的 Depends 依赖注入（含 yield 清理与嵌套依赖）、HTTP 中间件的执行顺序、全局异常处理，以及用 TestClient 写出可跑的测试。
lang: zh-CN
---

> 本文是《Python 基础与 FastAPI 入门》系列第 02 篇，面向第一阶段第二周。第 01 篇讲路由与 Pydantic 模型，本篇在它的基础上加入依赖注入、中间件和测试。

文中所有代码都在 Python 3.13、FastAPI 0.162.0、pytest 8.4 下实际运行通过，共 8 个测试全部通过。你可以按文末的目录结构把代码复制出来自己跑一遍。

## 本篇要解决什么问题

一个真实的 API 服务，很快会遇到这几件事：

1. 每个接口都要拿数据库连接，用完要关掉。
2. 很多接口都要先校验登录态，校验逻辑不能每个函数里复制一遍。
3. 每个请求都要记耗时、打请求 ID，或者统一加响应头。
4. 业务错误要返回统一的 JSON 格式，而不是各自抛不同的异常。
5. 接口写完了要能自动化测试，不能每次手动点 `/docs`。

FastAPI 用三个机制解决这些问题：`Depends`（依赖注入）、中间件、异常处理器。加上 `TestClient`，就能覆盖测试。下面按这个顺序讲。

**Java 视角**：`Depends` 大致对应 Spring 的 `@Autowired` 加上拦截器的前置检查，但它是显式写在函数参数里的，读代码时一眼就能看出这个接口依赖什么。

## 项目结构

```text
week02/
├── app/
│   ├── __init__.py
│   ├── deps.py          # 依赖：数据库、当前用户、管理员
│   ├── middleware.py    # 中间件：耗时统计与请求 ID
│   └── main.py          # 应用入口、路由、异常处理器
└── tests/
    └── test_main.py
```

依赖安装：

```bash
pip install fastapi uvicorn httpx pytest
```

`httpx` 是 `TestClient` 的底层库，必须装，否则测试时会报错。

## 一、依赖注入 Depends

### 1.1 最简单的依赖：返回一个值

依赖就是一个普通函数，FastAPI 调用路由前会先调用它，把返回值注入到路由参数里。

```python
from fastapi import Depends, FastAPI

app = FastAPI()

def get_page_size() -> int:
    return 20

@app.get("/items")
async def list_items(page_size: int = Depends(get_page_size)) -> dict[str, int]:
    return {"page_size": page_size}
```

这个例子没有实际意义，但它说明了机制：路由不关心 `page_size` 从哪来，只声明它需要。以后想换成从配置读取，只改依赖函数，路由一行都不用动。

### 1.2 带清理的依赖：yield 写法

数据库连接这类资源，要在请求结束后关闭。写法是把依赖写成生成器，`yield` 之前是准备，之后的 `finally` 是清理：

```python
# app/deps.py
from collections.abc import AsyncIterator


class FakeDB:
    """模拟一个数据库连接。真实项目里换成 SQLAlchemy 会话或连接池。"""

    def __init__(self) -> None:
        self.closed = False
        self.users = {"alice": "user", "root": "admin"}
        self.tokens = {"token-alice": "alice", "token-root": "root"}

    async def get_user_by_token(self, token: str) -> str | None:
        return self.tokens.get(token)

    async def get_role(self, username: str) -> str | None:
        return self.users.get(username)

    async def close(self) -> None:
        self.closed = True


async def get_db() -> AsyncIterator[FakeDB]:
    db = FakeDB()
    try:
        yield db
    finally:
        await db.close()

路由里声明 `db: FakeDB = Depends(get_db)` 后，FastAPI 会在处理请求时执行 `get_db`，请求结束（无论成功还是抛异常）都会执行 `finally`。这就是 Java 里 try-with-resources 的作用。

### 1.3 嵌套依赖：依赖里再依赖

鉴权通常分两步：先从请求头解析出用户，再判断这个用户是不是管理员。两步分别写成依赖，后一个依赖声明依赖前一个：

```python
# app/deps.py（续）
from fastapi import Depends, Header, HTTPException, status


async def get_current_user(
    authorization: str | None = Header(default=None),
    db: FakeDB = Depends(get_db),
) -> str:
    if authorization is None or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="缺少 Bearer token")
    token = authorization.removeprefix("Bearer ")
    username = await db.get_user_by_token(token)
    if username is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="token 无效")
    return username


async def get_admin_user(
    username: str = Depends(get_current_user),
    db: FakeDB = Depends(get_db),
) -> str:
    role = await db.get_role(username)
    if role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅管理员可访问")
    return username
```

几个要点：

1. `get_db` 被 `get_current_user` 和 `get_admin_user` 同时依赖。FastAPI 在同一个请求里只会调用一次 `get_db`，所以整个请求共享同一个数据库连接，不会开两个。
2. 依赖里抛出的 `HTTPException` 会直接中断请求，路由函数不会执行。这正是鉴权该放的位置。
3. `Header(default=None)` 从请求头 `Authorization` 读值。FastAPI 把参数名中的下划线转成连字符，所以 `authorization` 对应 `Authorization` 头，不需要手动指定。

路由只需要声明它要的最终依赖：

```python
@app.get("/admin/stats")
async def admin_stats(username: str = Depends(get_admin_user)) -> dict[str, object]:
    return {"operator": username, "item_count": 2}
```

### 1.4 常见错误

| 错误写法 | 后果 | 正确写法 |
|------|------|------|
| 依赖里用 `db = FakeDB()` 不 yield | 连接永远不会关闭 | 用 `yield` 加 `finally` |
| 把 token 写成 `token: str` 普通参数 | 它会变成查询参数 `?token=`，不是请求头 | 用 `Header(...)` |
| 在依赖里 `return JSONResponse(401)` | 路由仍会执行，错误被当成正常返回值 | `raise HTTPException` |

## 二、中间件

中间件包裹在整个请求外面，每个请求都会经过它。典型用途是记录耗时、打请求 ID、加统一响应头。

```python
# app/middleware.py
import time
import uuid

from fastapi import Request


async def add_process_time_and_request_id(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", uuid.uuid4().hex)
    start = time.perf_counter()
    response = await call_next(request)
    elapsed_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Process-Time-Ms"] = f"{elapsed_ms:.2f}"
    response.headers["X-Request-ID"] = request_id
    return response
```

`call_next(request)` 的意思是“放行到下一层”。它之前的代码在请求进入时执行，之后的代码在响应返回时执行。

注册方式：

```python
app.middleware("http")(add_process_time_and_request_id)
```

执行顺序像洋葱一样一层层进出：

```text
请求 → 中间件（进入）→ 依赖 → 路由函数 → 中间件（返回）→ 响应
```

这和 Spring 的 `HandlerInterceptor` 很像：`preHandle` 对应 `call_next` 之前，`postHandle` 对应之后。区别是 FastAPI 的中间件是普通的异步函数，不需要实现接口。

注意：`call_next` 之后修改 `response.headers` 是合法的，但不要在这里读取请求体。请求体只能读一次，读完就没了。

## 三、异常处理：统一错误格式

业务代码里经常要抛“订单不存在”“库存不足”这类错误。如果每个路由都自己拼错误 JSON，前端就要适配很多种格式。做法是定义一个业务异常，再注册全局处理器统一转换：

```python
# app/main.py（节选）
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse


class BusinessError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message


app = FastAPI(title="依赖注入与中间件示例")


@app.exception_handler(BusinessError)
async def business_error_handler(request: Request, exc: BusinessError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error_code": exc.code, "message": exc.message},
    )
```

路由里直接抛出即可，不需要关心 HTTP 格式：

```python
@app.get("/items/{item_id}")
async def get_item(item_id: int) -> dict[str, object]:
    if item_id not in ITEMS:
        raise BusinessError("ITEM_NOT_FOUND", f"商品 {item_id} 不存在")
    return {"item_id": item_id, "name": ITEMS[item_id]}
```

`@app.exception_handler` 对应 Spring 的 `@ControllerAdvice` 加 `@ExceptionHandler`。

## 四、完整代码

把前面的片段合在一起，就是 `app/main.py`：

```python
# app/main.py
from fastapi import Depends, FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from app.deps import FakeDB, get_admin_user, get_current_user, get_db
from app.middleware import add_process_time_and_request_id


class BusinessError(Exception):
    def __init__(self, code: str, message: str) -> None:
        self.code = code
        self.message = message


class ItemOut(BaseModel):
    item_id: int
    name: str


ITEMS = {1: "键盘", 2: "鼠标"}

app = FastAPI(title="依赖注入与中间件示例")
app.middleware("http")(add_process_time_and_request_id)


@app.exception_handler(BusinessError)
async def business_error_handler(request: Request, exc: BusinessError) -> JSONResponse:
    return JSONResponse(
        status_code=400,
        content={"error_code": exc.code, "message": exc.message},
    )


@app.get("/items/{item_id}", response_model=ItemOut)
async def get_item(item_id: int, db: FakeDB = Depends(get_db)) -> ItemOut:
    if item_id not in ITEMS:
        raise BusinessError("ITEM_NOT_FOUND", f"商品 {item_id} 不存在")
    return ItemOut(item_id=item_id, name=ITEMS[item_id])


@app.get("/me")
async def me(username: str = Depends(get_current_user)) -> dict[str, str]:
    return {"username": username}


@app.get("/admin/stats")
async def admin_stats(username: str = Depends(get_admin_user)) -> dict[str, object]:
    return {"operator": username, "item_count": len(ITEMS)}
```

这里有一个细节：`get_item` 显式声明了 `db: FakeDB = Depends(get_db)`，但函数体没有用到 `db`。这是为了演示，真实项目里它会用来查询数据。去掉它也能运行，只是失去了连接生命周期的演示。

## 五、用 TestClient 写测试

`TestClient` 包装了应用，直接在内存里发请求，不需要启动 uvicorn。

```python
# tests/test_main.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_get_item_ok():
    resp = client.get("/items/1")
    assert resp.status_code == 200
    assert resp.json() == {"item_id": 1, "name": "键盘"}


def test_get_item_not_found_uses_business_error():
    resp = client.get("/items/999")
    assert resp.status_code == 400
    assert resp.json()["error_code"] == "ITEM_NOT_FOUND"


def test_me_without_token_returns_401():
    resp = client.get("/me")
    assert resp.status_code == 401


def test_me_with_invalid_token_returns_401():
    resp = client.get("/me", headers={"Authorization": "Bearer wrong"})
    assert resp.status_code == 401


def test_me_with_valid_token():
    resp = client.get("/me", headers={"Authorization": "Bearer token-alice"})
    assert resp.status_code == 200
    assert resp.json() == {"username": "alice"}


def test_admin_forbidden_for_normal_user():
    resp = client.get("/admin/stats", headers={"Authorization": "Bearer token-alice"})
    assert resp.status_code == 403


def test_admin_allowed_for_admin():
    resp = client.get("/admin/stats", headers={"Authorization": "Bearer token-root"})
    assert resp.status_code == 200
    assert resp.json() == {"operator": "root", "item_count": 2}


def test_response_has_timing_and_request_id_headers():
    resp = client.get("/items/1", headers={"X-Request-ID": "abc123"})
    assert resp.headers["X-Request-ID"] == "abc123"
    assert "X-Process-Time-Ms" in resp.headers
```

运行：

```bash
pytest tests/ -v
```

实测输出末尾为 `8 passed`。测试文件里的 `client.get` 不会真正占用端口，所以很快。

### 测试的几个要点

1. 每个测试只验证一件事。`test_me_without_token_returns_401` 和 `test_me_with_invalid_token_returns_401` 分开写，失败时一眼能看出是哪种情况。
2. 对鉴权要测三种情况：没有 token、token 错误、权限不足。只测成功路径会漏掉最容易出问题的分支。
3. 测试里不要依赖真实数据库。这里 `FakeDB` 是内存对象。真实项目可以用 `app.dependency_overrides[get_db] = fake_db_factory` 把依赖替换掉，这是 FastAPI 测试的标准做法。

## 六、练习

1. 给 `/items` 加一个 `POST` 接口，接收 `ItemIn`（`name` 长度 1 到 50），写一个测试验证空名称返回 422。
2. 实现 `get_premium_user` 依赖，嵌套在 `get_current_user` 之上，非会员返回 403。在 `FakeDB` 里增加一个会员字段来支持它。
3. 用 `app.dependency_overrides` 把 `get_db` 替换成一个记录调用次数的假对象，写测试确认一次请求只创建一个数据库连接。
4. 运行 `uvicorn app.main:app --reload`，打开 `http://127.0.0.1:8000/docs`，先点右上角 `Authorize` 填入 `Bearer token-alice`，再调用 `/admin/stats`，应返回 403；换成 `token-root` 应返回 200。

## 七、本篇验收清单

- [ ] 能解释 `yield` 依赖的清理时机
- [ ] 能写出嵌套依赖并说明为什么同一请求里 `get_db` 只执行一次
- [ ] 能区分 `Header(...)` 和普通参数
- [ ] 能用 `raise HTTPException` 中断请求
- [ ] 能用 `@app.exception_handler` 统一业务错误格式
- [ ] 能用 `TestClient` 写出覆盖成功、未登录、越权的测试

## 八、Java 与 FastAPI 对照

| Spring | FastAPI | 说明 |
|--------|---------|------|
| `@Autowired` | `Depends(...)` | FastAPI 显式声明在参数上 |
| `HandlerInterceptor` | `@app.middleware("http")` | 洋葱模型，`call_next` 相当于放行 |
| `@ControllerAdvice` | `@app.exception_handler` | 统一异常转换 |
| try-with-resources | `yield` 依赖 | 请求结束后清理资源 |
| `MockMvc` | `TestClient` | 不启动服务器的集成测试 |
| `@MockBean` | `app.dependency_overrides` | 替换依赖做测试 |

## 九、常见坑

| 症状 | 原因 | 解法 |
|------|------|------|
| 测试报 `ImportError: httpx` | 没装 httpx | `pip install httpx` |
| 响应头里没有 `X-Request-ID` | 中间件没注册，或注册在 `include_router` 之后 | 在 `app` 创建后立即 `app.middleware` |
| 依赖里的连接没释放 | 没用 `yield` 和 `finally` | 改成生成器写法 |
| 鉴权接口返回 422 而不是 401 | 请求头名字写错，或参数被当成查询参数 | 确认用 `Header` 且头名正确 |
| 异步路由里调用了阻塞 IO | 事件循环被卡住，所有请求变慢 | 换成异步客户端，或放进线程池 |

## 小结

依赖注入把“这个接口需要什么”写在参数上，中间件处理所有请求共有的横切逻辑，异常处理器统一错误格式。三者配合 `TestClient`，就能写出可以反复运行的服务。下一篇进入异步编程，讲 `async` 与 `await` 到底在做什么。
