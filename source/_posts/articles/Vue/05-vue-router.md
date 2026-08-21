---
title: Vue 从零到一（05）：Vue Router，单页应用的路由该怎么管
date: 2026-08-21 10:30:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - Vue Router
description: 面向后端同学讲透 Vue Router 4：前端路由和后端路由表的关系、hash 与 history 两种模式的部署差异、动态路由与嵌套路由写法、导航守卫完整执行链（对照 Spring 拦截器链），以及路由懒加载、鉴权实战和参数变化组件复用这类高频坑。
keywords:
  - Vue Router
  - 导航守卫
  - hash history 区别
  - 动态路由
  - 路由懒加载
lang: zh-CN
---

> **适合人群**：页面能写了，但一做多页面应用就被 `createRouter`、导航守卫、`useRoute` 和 `useRouter` 绕晕的同学。
> 本篇基于 Vue Router 4（配 Vue 3）。上一篇[《组件通信》](/2026/08/21/articles/Vue/04-vue-component-communication/)解决了组件之间怎么协作，这篇解决**页面之间**怎么组织——URL、组件、鉴权三件事在浏览器里怎么管起来。

---

## 一、SPA 为什么需要前端路由

传统多页应用（MPA）里，"换页面"就是发一个新请求，服务端渲染整张 HTML 回来。SPA 把页面全部搬进浏览器之后，问题来了：**换页面不再有请求，那 URL 变不变？刷新还回得来吗？**

前端路由就是答案：用 JS 维护一张 **URL ↔ 组件** 的映射表，URL 变化时不发请求，只切换挂载的组件。对后端同学有个非常顺手的类比——你写的 Spring MVC：

```java
@GetMapping("/orders/{id}")
public OrderDetail order(@PathVariable Long id) { ... }
```

Vue Router 干的是同一件事，只不过这张路由表**从服务端搬到了浏览器**，匹配结果不是执行方法而是渲染组件。理解了这个同构关系，后面的概念都能一一对应上。

## 二、hash 与 history：两种实现模式

前端路由要骗过浏览器"URL 变了但别发请求"，有两种骗法，这是面试高频题也是**部署时会真实踩坑**的点：

![图1：hash 与 history 对比——两种"不发请求改 URL"的方式及部署差异](vue-router-hash-history.svg)

- **hash 模式**：URL 形如 `example.com/#/orders/42`。`#` 后面的部分本来就不会发给服务器（它生来是页内锚点），改它天然不触发请求，监听 `hashchange` 事件即可切换视图。**部署零配置**，但地址丑、SEO 弱。
- **history 模式**：URL 是正常的 `example.com/orders/42`，靠 `history.pushState()` 修改地址栏而不刷新页面。好看、SEO 友好，但有一个**必须知道的代价**：用户刷新或直接输入该 URL 时，浏览器会老老实实向服务器请求 `/orders/42`——这个路径后端根本没有，返回 404。解法是服务端兜底（nginx 配 `try_files` 把所有路径指回 `index.html`，让前端路由接管），具体配置第 8 篇部署时展开。

```js
import { createRouter, createWebHashHistory } from 'vue-router'

// hash 模式；要 history 模式换成 createWebHistory()
const router = createRouter({
  history: createWebHashHistory(),
  routes: [],
})
```

本地开发用 Vite 时两种都无痛，**差异在部署**：内网工具、不想动 nginx 就 hash；正式产品、在意分享链接观感就 history + 服务端兜底。

## 三、路由表：动态路由与嵌套路由

### 3.1 基本骨架

```js
const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/orders/:id', name: 'orderDetail', component: OrderDetail },
  { path: '/:pathMatch(.*)*', name: 'notFound', component: NotFound },
]
```

三行分别是：静态路由、动态路由、404 兜底。`name` 是路由的唯一标识，编程式导航优先用它（改 path 不用到处改链接）。

### 3.2 动态路由：URL 里的路径参数

`/orders/:id` 里的 `:id` 就是前端的 `@PathVariable`。URL 命中后，参数从 `useRoute()` 里取：

```vue
<script setup>
import { useRoute } from 'vue-router'
import { computed } from 'vue'

const route = useRoute()                     // 当前路由信息（只读）
const orderId = computed(() => route.params.id)
</script>
```

`useRoute` 和 `useRouter` 一字之差容易混：**route 是"现在在哪"（当前路由对象，只读），router 是"我要去哪"（导航实例，能动手）**——类似请求上下文和重定向工具的关系。

![图2：动态路由匹配——path 模式与真实 URL 对账，提取 params 渲染目标组件](vue-router-dynamic-match.svg)

### 3.3 嵌套路由

后台系统的经典布局：侧边栏 + 顶栏永远不动，只有内容区切换。这靠 `children` + 组件内的 `<router-view>` 出口实现——**父组件渲染壳子，子路由渲染进壳子里的洞**：

```js
const routes = [
  {
    path: '/settings',
    component: SettingsLayout,        // 壳：侧边栏 + <router-view />
    children: [
      { path: 'profile', component: Profile },    // /settings/profile
      { path: 'account', component: Account },    // /settings/account
    ],
  },
]
```

```vue
<!-- SettingsLayout.vue -->
<template>
  <aside>侧边菜单</aside>
  <main>
    <router-view />        <!-- 子路由组件在这里进出 -->
  </main>
</template>
```

子路由 path 不带 `/` 表示拼接在父 path 后。注意 `<router-view>` 是个**占位出口**，App.vue 里那个是根出口，嵌套布局里的是子出口——一个萝卜一个坑。

### 3.4 声明式与编程式导航

```html
<!-- 声明式：模板里跳转 -->
<router-link :to="{ name: 'orderDetail', params: { id: 42 } }">订单 42</router-link>
```

```js
import { useRouter } from 'vue-router'
const router = useRouter()

router.push('/login')                          // 跳转（留历史记录，能后退）
router.replace({ name: 'login' })              // 替换（不留历史，登录后常用）
router.go(-1)                                  // 后退一步
```

`router-link` 最终渲染成 `<a>` 标签（SEO 和中键新开标签页都友好），点击被拦截成前端导航—— declarative 与 imperative 的关系，和事件绑定里 `@click` 与 `addEventListener` 一致。

## 四、导航守卫：前端的拦截器链

这是 Vue Router 最像后端的部分。**每次导航都是一次请求处理流程**，守卫就是这条链上的 Interceptor：

| 层级 | 钩子 | Spring 里对应的东西 |
|------|------|-------------------|
| 全局 | `beforeEach` / `beforeResolve` / `afterEach` | `Filter` / `HandlerInterceptor` |
| 路由独享 | `beforeEnter` | 某个 Controller 上单独的拦截配置 |
| 组件内 | `beforeRouteEnter` / `beforeRouteUpdate` / `beforeRouteLeave` | 事务边界 / AOP 切面里的前置检查 |

完整执行顺序（**面试高频，值得背下来**）：

![图3：一次导航的守卫执行链——离开守卫、全局前置、路由独享、组件内、解析确认、后置钩子](vue-router-guard-chain.svg)

1. 失活组件的 `beforeRouteLeave`（"你要走了，事务提交了吗"）
2. 全局 `beforeEach`（登录鉴权放这里）
3. 复用组件的 `beforeRouteUpdate`（同组件不同参数，见第六节坑 1）
4. 路由独享 `beforeEnter`
5. 激活组件的 `beforeRouteEnter`（此时组件实例还没创建，**拿不到 this**）
6. 全局 `beforeResolve`（异步组件加载完成后、确认前的最后关卡）
7. 导航确认 → 全局 `afterEach`（后置通知，常用来设置页面标题）
8. DOM 更新，视图切换完成

守卫的返回值决定流程走向，和拦截器返回 false 一个意思：

```js
router.beforeEach((to) => {
  const auth = useAuthStore()                 // 运行时再取，见下方注意
  if (to.meta.requiresAuth && !auth.token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  // 返回 true 或 undefined = 放行
})
```

三个实战细节：

- **meta 是路由的"注解"**：把 `requiresAuth`、`title`、`roles` 挂在路由记录上，守卫里统一读取——和后端把权限标在注解上、拦截器统一解析是同一套设计；
- 在守卫里用 Pinia store 要在**回调内部**调用 `useAuthStore()`，别在模块顶层调用——路由模块加载时 Pinia 可能还没装好（下一篇讲 Pinia 时会回应这点）；
- `afterEach` 里改 `document.title` 是最干净的落点，它没有取消导航的能力，纯后置。

## 五、懒加载：按路由分包

路由组件默认写法是静态 import，全部打进一个 bundle——首屏要下载整个应用。懒加载把"组件"变成"组件的下载动作"：

```js
const routes = [
  { path: '/settings', component: () => import('../views/SettingsLayout.vue') },
]
```

`() => import()` 构建时自动拆成独立 chunk，进入该路由才下载。**按路由分包是性价比最高的前端性能优化**，因为它天然按"页面"切分、用户只用得着自己要去的那几页——就像微服务按业务边界拆库，而不是把所有表塞一个库。

配套两件事：路由加上 `name`（懒加载组件配合命名路由跳转更稳）；首屏组件（首页、登录页）可以保持静态 import，让 Vite 把它们注入首屏。

## 六、高频坑清单

1. **同组件不同参数，组件不重建**：`/orders/1` 跳 `/orders/2` 命中同一个组件，出于复用考虑 Vue 不会销毁重建，`setup` 里的请求**不会重跑**。解法：`watch(() => route.params.id, load, { immediate: true })` 或组件内 `beforeRouteUpdate`。类比单例 Service 的字段复用问题——复用是特性，脏数据是事故。
2. **history 模式部署 404**：本地好好的，上了服务器一刷新就 404——服务端没配兜底（见第二节，第 8 篇给 nginx 配置）。
3. **忘了 404 兜底路由**：`/:pathMatch(.*)*` 必须放最后，否则它先匹配走所有路径。
4. **重复导航报错**：`push` 到当前路由（参数也相同）会得到一个冗余导航警告——按钮防抖或在 `push` 前比对 `route.fullPath`。
5. **`beforeRouteEnter` 里拿 this / setup 变量**：组件还没创建，守卫里只能通过 `next(vm => ...)` 在创建后回调。
6. **滚动位置不复位**：长页面切路由后停在上次的位置，配 `scrollBehavior(to, from, savedPosition)` 返回 `{ top: 0 }` 或 `savedPosition`。

## 七、总结

- 前端路由 = 搬进浏览器的路由表，URL 切组件不发请求，和 `@RequestMapping` 同构；
- hash 部署零配置但丑，history 好看但要求服务端兜底，差异在部署不在开发；
- 动态路由 `:id` 是前端版 `@PathVariable`，嵌套路由靠 `<router-view>` 出口逐层挖洞；
- 导航守卫完整链：离开 → 全局前置 → 路由独享 → 组件内 → 解析确认 → 后置，鉴权统一放 `beforeEach` + meta；
- 懒加载按路由分包，是性价比最高的首屏优化。

路由把页面组织起来了，但有个东西贯穿所有页面：**登录态**。用户信息、token、菜单权限——它在登录页写入、在任意页面读取、刷新后还得活着。这正是全局状态管理的主场，下一篇讲 Pinia，你会发现它就是一个跑在浏览器里的、类型安全的 ApplicationContext。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. [响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/) → 4. [组件通信](/2026/08/21/articles/Vue/04-vue-component-communication/) → 5. Vue Router（本篇）→ 6. Pinia（下一篇）
