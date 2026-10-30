---
title: FastAPI 入门（01）：第一个接口、路由参数与 Pydantic 校验
date: 2026-10-30 15:50:00
categories:
  - 教程
tags:
  - Python
  - FastAPI
  - Pydantic
description: 从零搭建一个 FastAPI 服务，讲清路由装饰器、路径参数与查询参数、Pydantic 请求模型的自动校验、response_model 的作用，以及自动生成的 /docs 文档。
lang: zh-CN
---

> 本文是《Python 基础与 FastAPI 入门》系列第 01 篇，面向第一阶段第一周。本周的目标是跑通一个能收请求、做校验、返回结构化数据的服务。

文中代码在 Python 3.13、FastAPI 0.162.0、pytest 8.4 下实际运行通过，共 7 个测试全部通过。

## 为什么选 FastAPI

FastAPI 基于类型注解工作。你把参数写成 `int`、把请求体写成 Pydantic 模型，框架就会自动完成三件事：解析请求、校验数据、生成 API 文档。写 Java 的人可以把它理解成 Spring Boot Web 加 Bean Validation 加 Swagger，但代码量大约是它们的五分之一。

## 一、第一个应用

```python
# app/main.py
from fastapi import FastAPI

app = FastAPI(title="我的第一个 AI 服务", version="0.1.0")


@app.get("/")
async def root() -> dict[str, str]:
    return {"message": "hello"}
```

`app` 是应用对象，`@app.get("/")` 把函数注册为 `GET /` 的处理器。函数用 `async def` 定义，这是异步路由，第 04 篇会详细讲它的含义。

启动服务：

```bash
pip install fastapi uvicorn
uvicorn app.main:app --reload
```

`app.main:app` 的意思是“在 `app/main.py` 文件里找到名为 `app` 的对象”。`--reload` 会在代码改动后自动重启，只用于开发。

访问 `http://127.0.0.1:8000/` 会看到 `{"message": "hello"}`。

### 自动文档是 FastAPI 最直接的好处

打开下面两个地址，不需要写任何文档代码：

- `http://127.0.0.1:8000/docs`：Swagger UI，可以直接在页面里发请求
- `http://127.0.0.1:8000/openapi.json`：机器可读的 OpenAPI 规范

## 二、路径参数与查询参数

```python
@app.get("/items/{item_id}")
async def get_item(item_id: int, q: str | None = None) -> dict[str, object]:
    return {"item_id": item_id, "q": q}
```

- `{item_id}` 是路径参数，函数参数名要一致。
- `item_id: int` 让框架把路径里的字符串自动转成整数。
- `q: str | None = None` 是查询参数，对应 `?q=...`，不传时为 `None`。

试一下：

| 请求 | 结果 |
|------|------|
| `GET /items/42?q=abc` | 200，`{"item_id": 42, "q": "abc"}` |
| `GET /items/42` | 200，`{"item_id": 42, "q": null}` |
| `GET /items/abc` | 422，错误信息说明 `item_id` 必须是整数 |

第三行的 422 不是你写的代码返回的，是框架在调用函数之前就完成了类型校验。这一点很重要：你的函数体只会收到合法的 `int`，不需要自己判断。

## 三、请求体与 Pydantic 模型

接收 JSON 请求体时，定义一个继承 `BaseModel` 的类：

```python
from pydantic import BaseModel, Field


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1, description="用户问题")
    top_k: int = Field(default=5, ge=1, le=50)
    stream: bool = False


class QueryResponse(BaseModel):
    answer: str
    sources: list[str]


@app.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest) -> QueryResponse:
    return QueryResponse(answer=f"你问的是：{req.query}", sources=["doc_1.md"])
```

几个要点：

1. `Field(..., min_length=1)` 中的 `...` 表示这个字段必填。
2. `ge=1, le=50` 限定整数范围，超出就返回 422。
3. `stream: bool = False` 有默认值，请求里可以不传。
4. 函数参数 `req: QueryRequest` 是强类型对象，函数体里直接用 `req.query`，不需要手写任何 `if` 检查。

Java 里这需要 `@RequestBody` 加 `@Valid` 加 DTO 上的 `@NotBlank`、`@Min`、`@Max`。FastAPI 的写法等价，但字段约束和类型定义写在同一个地方。

### response_model 的作用

`response_model=QueryResponse` 有三个作用：

1. 文档准确：`/docs` 里会展示返回结构。
2. 过滤字段：函数即使返回多余字段，也只会输出 `QueryResponse` 声明过的字段。
3. 类型保证：返回值必须符合模型结构。

第二点在生产环境很关键。假设函数内部为了调试多返回了 `debug_info`，只要声明了 `response_model`，它就不会泄露给用户。

## 四、用 TestClient 写测试

测试不需要启动服务器，`TestClient` 直接在内存中发请求：

```python
# tests/test_basics.py
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root():
    assert client.get("/").json() == {"message": "hello"}


def test_path_and_query():
    resp = client.get("/items/42", params={"q": "abc"})
    assert resp.json() == {"item_id": 42, "q": "abc"}


def test_invalid_path_type_returns_422():
    assert client.get("/items/abc").status_code == 422


def test_post_query_ok():
    resp = client.post("/query", json={"query": "什么是 FastAPI"})
    assert resp.status_code == 200
    assert resp.json()["sources"] == ["doc_1.md"]


def test_empty_query_returns_422():
    assert client.post("/query", json={"query": ""}).status_code == 422


def test_top_k_out_of_range_returns_422():
    assert client.post("/query", json={"query": "x", "top_k": 0}).status_code == 422


def test_response_model_filters_extra_fields():
    resp = client.post("/query", json={"query": "x"})
    assert set(resp.json().keys()) == {"answer", "sources"}
```

运行：

```bash
pip install pytest httpx
pytest tests/ -v
```

`httpx` 必须安装，`TestClient` 依赖它。

## 五、练习

1. 给 `/query` 的 `QueryRequest` 加一个 `language` 字段，只允许 `"zh"` 或 `"en"`。提示：用 `Literal["zh", "en"]`。
2. 写一个 `UserCreate` 和 `UserOut` 模型对，`UserCreate` 包含 `password`，`UserOut` 不包含。用 `response_model=UserOut` 的接口验证返回值里确实没有密码。
3. 在 `/docs` 页面里找到 `/items/{item_id}` 的参数说明，确认 `item_id` 显示为 `integer`。

## 六、本篇验收清单

- [ ] 能用 `uvicorn app.main:app --reload` 启动服务
- [ ] 能解释路径参数、查询参数、请求体三者的区别
- [ ] 能用 `Field` 添加必填、长度、范围约束
- [ ] 能解释 `response_model` 为什么要写
- [ ] 能用 `TestClient` 写出覆盖正常与 422 情况的测试

## 七、Java 与 FastAPI 对照

| Spring | FastAPI | 说明 |
|--------|---------|------|
| `@RestController` + `@GetMapping` | `@app.get()` | 路由直接挂在应用对象上 |
| `@PathVariable` | `{item_id}` 加类型注解 | 类型自动转换 |
| `@RequestParam` | 函数普通参数 | 不在路径里的参数就是查询参数 |
| `@RequestBody` + DTO + `@Valid` | `BaseModel` 参数 | 校验写在模型字段上 |
| Swagger 注解 | 不需要写 | 自动生成 |

## 八、常见坑

| 症状 | 原因 | 解法 |
|------|------|------|
| 启动报 `Could not import module` | 启动命令路径不对 | 在项目根目录运行 `uvicorn app.main:app` |
| 请求返回 422 但不知道为什么 | 没看错误详情 | 读响应里的 `detail` 数组，它列出了每个字段的问题 |
| 查询参数取不到值 | 函数参数名和 URL 参数名不一致 | 保持名字一致，或用 `Query(alias=...)` |
| 返回了不该返回的字段 | 没写 `response_model` | 所有对外接口都声明 `response_model` |
| 测试报 `ImportError: httpx` | 没装 httpx | `pip install httpx` |

## 小结

本周你已经能写出一个带路径参数、查询参数、请求体校验和自动文档的服务。下一篇讲依赖注入、中间件和测试，把这个服务做得更像真实项目。
