---
title: FastAPI 入门（03）：整合测试与覆盖率
date: 2026-10-30 16:10:00
categories:
  - 教程
tags:
  - Python
  - FastAPI
  - pytest
description: 用 dependency_overrides 替换依赖做整合测试，验证嵌套依赖下每次请求只创建一个数据库连接，并用 pytest-cov 看覆盖率报告，理解覆盖率的边界。
lang: zh-CN
---

> 本文是《Python 基础与 FastAPI 入门》系列第 03 篇，面向第一阶段第二周的「整合与测试」。前两篇分别讲了基础接口和依赖注入、中间件，本篇把它们放在一起测试。

文中测试在 Python 3.13、FastAPI 0.162.0、pytest 8.4 下实际运行通过，本篇新增 2 个整合测试，与第 02 篇的测试一起共 10 个全部通过，覆盖率 100%。

## 一、整合测试

前面的测试都是单接口测试，每个只验证一个函数。整合测试关心的是多个依赖、中间件、路由放在一起时是否协作正确。本节用 `dependency_overrides` 把数据库替换成计数对象，验证两件事：

1. 嵌套依赖（`get_admin_user` → `get_current_user` → `get_db`）下，一次请求只创建一个数据库连接。
2. 替换后的依赖在测试结束后被清理，不会污染其他测试。

```python
# tests/test_integration.py
from fastapi.testclient import TestClient

from app.deps import FakeDB, get_db
from app.main import app


class CountingDB(FakeDB):
    created = 0

    def __init__(self) -> None:
        super().__init__()
        CountingDB.created += 1


async def override_get_db():
    db = CountingDB()
    try:
        yield db
    finally:
        await db.close()


def test_one_db_per_request_even_with_nested_deps():
    CountingDB.created = 0
    app.dependency_overrides[get_db] = override_get_db
    try:
        client = TestClient(app)
        resp = client.get("/admin/stats", headers={"Authorization": "Bearer token-root"})
        assert resp.status_code == 200
        assert CountingDB.created == 1
    finally:
        app.dependency_overrides.clear()


def test_override_is_cleared_after_test():
    assert get_db not in app.dependency_overrides
```

注意 `try / finally` 里的 `clear()`。如果测试中途断言失败，没有这一步，替换会留在全局的 `app` 对象上，影响后面所有测试，而且错误很难排查。

## 二、覆盖率

覆盖率衡量测试执行到了多少代码行。安装并运行：

```bash
pip install pytest-cov
pytest tests/ --cov=app --cov-report=term-missing
```

本文的代码运行结果如下（`Missing` 列为空表示每一行都被执行过）：

```text
Name                Stmts   Miss  Cover   Missing
-------------------------------------------------
app\__init__.py         0      0   100%
app\deps.py            32      0   100%
app\main.py            31      0   100%
app\middleware.py      11      0   100%
-------------------------------------------------
TOTAL                  74      0   100%
10 passed
```

几点需要知道：

1. 覆盖率 100% 只说明代码被执行过，不说明结果是对的。`test_admin_forbidden_for_normal_user` 之类的断言才是在验证行为。
2. 本文的目标是 80% 以上。这个项目小，所以达到 100%。真实项目里，追求 100% 常常会导致写一堆没有价值的测试，把精力花在错误处理的边角上更划算。
3. 覆盖率报告的 `Missing` 列是最有用的部分。它直接告诉你哪些行没有被测试到，比总百分比更有指导意义。


## 三、练习

1. 用 `dependency_overrides` 把 `get_db` 替换成记录调用次数的对象，写测试确认一次请求只创建一个连接（本篇示例已覆盖，可自己改成对 `/items/1` 的测试）。
2. 运行 `pytest --cov=app --cov-report=term-missing`，故意注释掉 `middleware.py` 中的 `response.headers[...]` 行，观察 `Missing` 列的变化。
3. 给 `/admin/stats` 写一个不带 token 的整合测试，确认返回 401 且 `CountingDB.created` 仍为 1。

## 小结

整合测试关心多个部件放在一起是否协作正确。`dependency_overrides` 让你替换依赖而不改业务代码，覆盖率报告则告诉你哪些行没被执行。两者结合，才能判断测试是否真正覆盖了关键路径。
