---
title: Vue 从零到一（07）：Axios 封装与 Spring Boot 联调，跨域一次讲清
date: 2026-08-21 10:50:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - Axios
  - Spring Boot
description: 面向后端同学讲透前后端联调：fetch 与 axios 选型、实例与拦截器封装（JWT 挂载、401 统一跳登录，对照 OkHttp 拦截器）、CORS 预检机制与 Vite 代理两种解法、Spring Boot 统一响应体 Result 的前端对接，以及 GET 数组参数序列化等高频坑。
keywords:
  - Axios 封装
  - 跨域 CORS
  - Vite 代理
  - JWT 前端
  - 统一响应体
lang: zh-CN
---

> **适合人群**：页面能跑、接口能通，但跨域报错只会复制粘贴 CORS 配置、token 每个请求手动塞的同学。
> 本篇基于 axios 1.x + Spring Boot 3 + Vite 6。前六篇都在前端圈内打转，这篇开始**真联调**——你写的 Spring Boot 接口和 Vue 页面正式接上头。

---

## 一、fetch 还是 axios

浏览器原生的 `fetch` 够用吗？看段代码就知道差在哪：

```js
// fetch：两步走，错误语义反直觉
const res = await fetch('/api/orders')
if (!res.ok) throw new Error(res.status)   // 404/500 不会自动 reject，要自己判断
const data = await res.json()             // JSON 还要手动再等一步
// 而且没有超时控制、没有拦截器
```

`fetch` 是底层 API，工程上缺的恰恰是高频刚需：**超时、自动 JSON、拦截器、请求取消、参数序列化**。axios 把这些都补齐了，所以企业项目基本都选它。类比一下：fetch 之于 axios，约等于 JDBC 之于 Spring JDBC——能力一样，抽象层级差一层。

## 二、实例封装：一处创建，全局使用

不要到处 `axios.get`，先创建带约定的实例：

```js
// api/http.js
import axios from 'axios'
import { useAuthStore } from '@/stores/auth'
import router from '@/router'

export const http = axios.create({
  baseURL: '/api',          // 所有请求自动拼前缀，部署时只改这一处
  timeout: 10_000,          // 超时毫秒数，fetch 时代要自己封装的东西
})
```

`baseURL` 用相对路径 `/api` 是刻意为之——它让"跨域问题"在开发与生产两种环境下有统一的解法，第四节展开。

## 三、拦截器：前端的 OkHttp Interceptor

后端同学对 OkHttp 的拦截器链应该肌肉记忆了：请求出去前统一加头，响应回来后统一处理。axios 的拦截器是同一套设计：

```js
// 请求拦截器：出门前挂 token
http.interceptors.request.use((config) => {
  const auth = useAuthStore()               // 运行时取，呼应第六篇的坑 2
  if (auth.token) {
    config.headers.Authorization = `Bearer ${auth.token}`
  }
  return config
})

// 响应拦截器：进门后统一拆包
http.interceptors.response.use(
  (response) => {
    const { code, message, data } = response.data   // 拆统一响应体
    if (code !== 0) {
      return Promise.reject(new Error(message || '业务失败'))
    }
    return data                     // 业务代码直接拿到 data，不用层层 .data.data
  },
  (error) => {
    if (error.response?.status === 401) {
      const auth = useAuthStore()
      auth.logout()
      router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    }
    return Promise.reject(error)
  }
)
```

![图1：Axios 拦截器链路——请求侧挂 token、响应侧拆包与 401 兜底](vue-axios-interceptor-chain.svg)

这套封装的价值在于**横切关注点收敛**：鉴权、拆包、401 兜底写一次，全项目几十个接口调用点全部受益——和你在后端把鉴权写进 Filter 而不是每个 Controller 手写，是同一个决策。

把拦截器和前两篇的 Pinia、Vue Router 串起来，就是一次完整的登录态生命周期：

![图2：登录后的完整请求时序——token 入库、请求挂头、过期统一兜底](vue-axios-login-flow.svg)

## 四、跨域：CORS 的原理与两种解法

联调第一晚的必修课。先把机制说透：**同源策略是浏览器的安全策略**，协议、域名、端口任一不同即跨域。注意主语是浏览器——服务器之间互相调用从来不存在跨域，curl 打任何接口都没有这个问题。

浏览器放开跨域靠 CORS：对"可能产生副作用"的请求，浏览器会先发一个 **OPTIONS 预检**，问服务器"这个源、这些头、这个方法行不行"，服务器用响应头回答（`Access-Control-Allow-Origin` 等），通过后才发真请求。类比：正式转账前的一通确认电话。

解法两条路，按环境选：

### 4.1 后端配置 CORS（治本，生产和联调都可用）

```java
@Configuration
public class WebConfig implements WebMvcConfigurer {

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/**")
                .allowedOriginPatterns("https://frank-dev.site", "http://localhost:5173")
                .allowedMethods("*")
                .allowedHeaders("*")
                .allowCredentials(true)   // 要带 cookie/token 时必须开
                .maxAge(3600);            // 预检结果缓存 1 小时，少打几次电话
    }
}
```

两个高频翻车点：`allowCredentials(true)` 与 `allowedOrigins("*")` **不能同时用**（规范禁止，Spring 启动直接报错），要么列白名单要么用 `allowedOriginPatterns`；以及**鉴权拦截器要把 OPTIONS 放行**——预检请求不带自定义头，被登录拦截器拦了就会出现"预检 401 → 真请求根本没发出去"的灵异现场。

### 4.2 开发环境：Vite 代理（让跨域根本不发生）

```js
// vite.config.js
export default {
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:8080',   // Spring Boot
        changeOrigin: true,
      },
    },
  },
}
```

原理：前端页面和 dev server 同源（都是 5173），浏览器视角**根本没有跨域**；Vite 收到 `/api` 请求后，由 Node 侧转发给 8080——服务器对服务器，无同源策略。开发期零 CORS 配置，后端一行不用改。

![图3：跨域两种解法——浏览器直连时的预检流程 vs Vite 代理的同源转发](vue-axios-cors-proxy.svg)

选型口诀：**开发用代理（顺滑），生产靠部署同源（第 8 篇的 nginx 反代，连 CORS 配置都能省掉），后端 CORS 配置留给"确实要开放给第三方源"的场景。**

## 五、对接统一响应体

后端规范的项目都有 `Result<T>`：

```java
public record Result<T>(int code, String message, T data) {
    public static <T> Result<T> ok(T data) { return new Result<>(0, "success", data); }
    public static <T> Result<T> fail(int code, String message) { return new Result<>(code, message, null); }
}
```

前端的配合姿势在第三节已经埋了：响应拦截器统一拆包。业务侧拿到的就是干净的 `data`，TypeScript 泛型补上类型：

```ts
// api/order.ts
import { http } from './http'

export function getOrder(id: number): Promise<Order> {
  return http.get(`/orders/${id}`)     // 拦截器已拆包，这里直接是 Order
}
export function createOrder(cmd: CreateOrderCmd): Promise<Order> {
  return http.post('/orders', cmd)     // axios 自动 application/json
}
```

一个语义约定要 team 内对齐：**HTTP 状态码与业务 code 分工**——传输层、框架层错误用 HTTP 状态（401/404/500），业务规则失败（库存不足）HTTP 200 + code 非 0。前端两层各拦各的，职责清晰。

## 六、联调高频坑清单

1. **GET 数组参数序列化**：`params: { ids: [1, 2] }` axios 默认序列化成 `ids[]=1&ids[]=2`，Spring `@RequestParam List<Long> ids` 收不到。用 `paramsSerializer` 定制成 `ids=1&ids=2`（axios 1.x 用 `new URLSearchParams({ ids: '1,2' })` 拼逗号也行，后端 Spring 能拆逗号分隔的 List）。
2. **GET 传复杂对象**：query 参数天生是扁平键值对，深层对象（嵌套筛选条件）塞不进去——改 POST + body，别硬编码 JSON 字符串进 URL。
3. **预检被拦**：登录拦截器/网关把 OPTIONS 当普通请求拦下（不带 token），放行它或全局 CORS 配置置于鉴权之前。
4. **401 跳登录死循环**：登录接口本身返回 401（密码错误）也触发了拦截器的跳转逻辑——把登录接口的 401 与过期 401 区分开（比如只在携带过 token 的请求上触发跳转）。
5. **绝对 URL 绕过代理**：代码里写死 `http://localhost:8080/api` 不走 Vite 代理，跨域又回来了——统一走 `baseURL` 相对路径。
6. **重复弹错**：响应拦截器 toast 报错 + 调用处又 catch 弹一次——约定"拦截器只兜底透传，提示归调用方"或反过来，别两头都做。

## 七、总结

- fetch 是 JDBC，axios 是 Spring JDBC：工程刚需（超时/拦截器/序列化）决定选型；
- 实例 + 双拦截器 = 横切关注点收敛：token 挂载、统一拆包、401 兜底写一次全局生效；
- 跨域是浏览器策略，不是网络问题：CORS 预检是"先打电话确认"，开发用 Vite 代理让它根本不发生；
- `allowCredentials` 与通配 Origins 互斥、预检要放行，是后端侧两大高频翻车点；
- HTTP 状态码管传输层，业务 code 管业务规则，前端两层各拦各的。

接口通了，最后一步：**怎么把它构建成静态文件、放到服务器上、配上域名跑起来**。下一篇是系列收官——Vite 的构建原理、环境变量、打包优化，以及那份让 history 路由和 `/api` 反代一次性解决的 nginx 配置。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. [响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/) → 4. [组件通信](/2026/08/21/articles/Vue/04-vue-component-communication/) → 5. [Vue Router](/2026/08/21/articles/Vue/05-vue-router/) → 6. [Pinia](/2026/08/21/articles/Vue/06-vue-pinia/) → 7. Axios 联调（本篇）→ 8. Vite 工程化与上线（下一篇）
