---
title: Vue 从零到一（06）：Pinia，什么时候才真的需要全局状态
date: 2026-08-21 10:40:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - Pinia
description: 面向后端同学讲透 Pinia：prop drilling 的痛、什么状态该进 store 什么不该、defineStore 选项式与组合式两种写法、state/getters/actions 三件套（对照 Java 类的字段与业务方法）、storeToRefs 防解构丢响应、登录态持久化，以及 store 与组合式函数的边界。
keywords:
  - Pinia
  - 状态管理
  - defineStore
  - storeToRefs
  - 状态持久化
lang: zh-CN
---

> **适合人群**：听到"全局状态"就想着往 store 里塞所有变量，或者反过来明明全员共享的数据还在用 props 硬传的同学。
> 本篇基于 Pinia 3。上一篇[《Vue Router》](/2026/08/21/articles/Vue/05-vue-router/)结尾说登录态"贯穿所有页面、刷新后还得活着"——这个需求 props 递层传、provide 都各缺一角，正好引出状态管理。

---

## 一、从 prop drilling 说起：状态放在哪都是问题

用户信息是个典型场景：头像显示在顶栏，权限判断藏在三个页面组件里，退出登录按钮在设置页。这份数据**天然属于全局**，但组件是树形的——数据总得先挂在某个组件上。

挂在根组件用 props 往下传？你会得到这个：

```html
<App :user="user">                  <!-- 数据的主人 -->
  <Layout :user="user">            <!-- 只是个搬运工 -->
    <Header :user="user" />        <!-- 真正的使用者 -->
    <SettingsPage :user="user" />  <!-- 也是搬运工 -->
      <LogoutButton :user="user" />  <!-- 使用者 -->
```

这就是 **prop drilling（逐层钻取）**：中间组件明明不关心 `user`，却被迫声明、转发、维护它。[第四篇](/2026/08/21/articles/Vue/04-vue-component-communication/)的 provide/inject 能砍掉中间层，但它有两个短板：**按组件树作用域生效**（跳出这棵子树就拿不到），且**刷新即失忆**（数据仍在内存里，页面一刷新全没了）。

![图1：prop drilling 与 Pinia 的对比——中间层被迫接力 vs 各组件直连仓库](vue-pinia-share-tree.svg)

全局状态管理要补的就是这两块：**一个挂在应用级别（不挂在任何组件上）的数据仓库**，外加**把仓库落到 localStorage 的持久化通道**。这就是 Pinia 的定位。

## 二、什么该进 store：先立规矩再动手

后端同学对"全局状态"应该有天然警惕——它就是前端版的"单例可变对象"，放错东西进来，测试和排查会一起遭殃。**先立准入规矩：**

| 该进 store | 不该进 store |
|-----------|-------------|
| 登录态：token、用户信息、权限菜单 | 某个表单的临时填写内容 |
| 跨页面共享的业务数据：购物车、草稿 | 单个组件的 loading、弹窗开关 |
| 刷新后需要"活着"的数据 | 只在一条父子链上流转的数据（props 够用） |

判断口诀：**问"刷新之后它还在吗"和"除了我家还有谁用"**。两个答案都是"否"，就老实待在组件里用 `ref`——本地状态进 store 不是架构升级，是污染。

![图2：状态放哪的决策——本地 ref、props/emit、provide、Pinia 的分界线](vue-pinia-scope-decision.svg)

## 三、defineStore：定义一个仓库

### 3.1 组合式写法（推荐先学这个）

```js
// stores/auth.js
import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { loginApi } from '@/api/auth'

export const useAuthStore = defineStore('auth', () => {
  // state：私有字段
  const token = ref('')
  const userInfo = ref(null)

  // getters：派生值（就是 computed）
  const isLoggedIn = computed(() => !!token.value)

  // actions：业务方法（同步异步都行）
  async function login(credentials) {
    const res = await loginApi(credentials)
    token.value = res.token
    userInfo.value = res.user
  }
  function logout() {
    token.value = ''
    userInfo.value = null
  }

  return { token, userInfo, isLoggedIn, login, logout }
})
```

组合式写法就是**把第三篇的响应式 API 原样搬进一个函数**——你已经会 `ref`/`computed`，就等于已经会 Pinia 了。`defineStore('auth', ...)` 的第一个参数是仓库唯一 id（devtools 里按它展示）。

### 3.2 选项式写法（读老代码必备）

```js
export const useCounterStore = defineStore('counter', {
  state: () => ({ count: 0, items: [] }),
  getters: {
    double: (state) => state.count * 2,
    quad() { return this.double * 2 },      // 访问其他 getter 用 this
  },
  actions: {
    increment() { this.count++ },           // this 指向 store 实例
    async fetchItems() { this.items = await api.list() },
  },
})
```

两种写法功能等价，团队里统一即可。Java 视角看这个结构会觉得眼熟：

![图3：Pinia 三件套与 Java 类的对照——字段、getter 方法、业务方法](vue-pinia-structure.svg)

`state` 是字段声明，`getters` 是带缓存的取值方法，`actions` 是可以改字段、可以发请求、可以互相调用的业务方法——**一个 store 就是一个无侵入容器的 Service 单例**，`useXxxStore()` 则是 `@Autowired`：在任何组件里调用它，拿到的都是同一个实例。

### 3.3 组件里怎么用

```vue
<script setup>
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()

// 状态与 getters 想解构，必须包 storeToRefs，否则丢响应
const { token, isLoggedIn } = storeToRefs(auth)

// actions 直接解构，没有响应问题
const { login, logout } = auth
</script>
```

`storeToRefs` 这一步是[第三篇](/2026/08/21/articles/Vue/03-vue-reactivity/)讲过的老问题换了个马甲：store 本体是个 reactive 对象，**裸解构 = 拿快照 = 丢响应**。函数（actions）不依赖响应式追踪，随便解。

### 3.4 批量修改与重置

```js
// $patch：批量改，一次通知（比逐个赋值少触发多次渲染）
auth.$patch({ token: 'x', userInfo: { name: 'frank' } })

// 函数式 $patch：适合数组等复杂改动
auth.$patch((state) => state.items.push(newItem))

// $reset：回到初始 state（仅选项式写法自带，组合式要自己暴露 reset 函数）
auth.$reset()
```

## 四、持久化：让登录态活过刷新

store 再全局也是内存里的，刷新归零。`pinia-plugin-persistedstate` 把指定 store 同步到 localStorage：

```js
// main.js
import { createPinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'

const pinia = createPinia()
pinia.use(piniaPluginPersistedstate)
```

```js
// 组合式写法里，persist 是 defineStore 的第三个参数
export const useAuthStore = defineStore('auth', () => { ... }, {
  persist: true,                              // 整仓持久化
  // persist: { pick: ['token'] },            // 或只持久化部分字段
})
```

从此刷新页面，Pinia 初始化时自动从 localStorage 恢复——**写入在内存、落盘在插件、恢复全自动**。

一个安全提醒，后端同学应该第一个意识到：**localStorage 里的 token 挡不住 XSS**，任何注入的脚本都能 `localStorage.getItem('token')` 拿走它。要求高的场景用 httpOnly cookie（JS 根本读不到）+ 后端会话，前端只留非敏感的用户展示信息。这是架构决策，不是前端一家的选择题。

## 五、store 与组合式函数的边界

Vue 生态里还有一个"共享逻辑"的方案：**组合式函数（Composable）**，比如 `useMouse()`、`useDebounce(fn)`。两者边界一句话：**composable 封装"行为"，store 共享"状态"**。

- `useMouse` 返回的坐标每次调用都是新的一份（各用各的），这是**行为复用**；
- `useAuthStore` 返回的 token 全应用同一份，这是**状态共享**；
- store 内部本来就用 ref/computed 实现——store 是 composable 的"全局单例特化版"。

另一个高频问题：**两个 store 互相调用**（下单时要读购物车、写库存）。正解是在 action 里调用，而不是模块顶层：

```js
export const useOrderStore = defineStore('order', () => {
  async function checkout() {
    const cart = useCartStore()      // ✅ 在 action 里调用另一个 store
    await createOrder(cart.items)
    cart.clear()
  }
  return { checkout }
})
```

顶层互相 `useXxxStore()` 会形成模块循环依赖（和 Java 两个 Bean 构造器互注入的死锁同款），action 内运行时调用则是 Spring 的 `getBean` 式懒获取，天然解环。

补一句 SSR：Pinia 对服务端渲染友好，每个请求创建独立 pinia 实例，防止用户 A 的数据串到用户 B——语义上就是 Spring 的 request scope，概念你已经有了。

## 六、高频坑清单

1. **裸解构 store 丢响应**：`const { token } = auth` 之后页面不更新——状态和 getters 用 `storeToRefs` 包一层，actions 直接解。
2. **在 setup 外的模块顶层调用 `useXxxStore()`**：pinia 还没安装，直接抛错。[第五篇](/2026/08/21/articles/Vue/05-vue-router/)路由守卫里那条例外就是这个原因——**在回调运行时调用**（守卫触发时应用早已就绪）。
3. **getter 里改 state**：getters 是 computed 的马甲，保持纯净；修改逻辑放 action。
4. **把 store 当全局变量桶**：表单临时态、组件私有 loading 都塞进去——回到第二节的准入规矩。
5. **依赖持久化的"顺序假设**"：恢复是异步插件时机，初始化逻辑别假设"store 一定已恢复完"，关键路径在 `onMounted` 后再读。
6. **devtools 里改了 state 页面没动**：大概率你裸解构了（同坑 1），或者该组件根本没建立依赖。

## 七、总结

- prop drilling 的痛源于"全局数据挂在树形结构上"，Pinia 把仓库挂到应用级；
- 准入规矩先行：刷新后还在、多方共享的才进 store；
- 组合式写法 = 响应式 API + 一个函数，选项式 = Java 类结构对照着读；
- `storeToRefs` 防解构丢响应，actions 随便解构；
- 持久化一行 `persist: true`，但 token 的 XSS 权衡要想清楚；
- composable 封行为、store 共享状态，store 互调在 action 里做。

数据归置好了，接下来回到每个页面都绕不开的事：**向后端发请求**。Axios 怎么封装、JWT 怎么挂、跨域在开发和生产分别怎么解、和 Spring Boot 的统一响应体怎么对接——下一篇把前后端联调一次讲完。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. [响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/) → 4. [组件通信](/2026/08/21/articles/Vue/04-vue-component-communication/) → 5. [Vue Router](/2026/08/21/articles/Vue/05-vue-router/) → 6. Pinia（本篇）→ 7. Axios 联调（下一篇）
