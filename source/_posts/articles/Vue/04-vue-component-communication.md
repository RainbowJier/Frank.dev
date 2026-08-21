---
title: Vue 从零到一（04）：组件通信全解，从 props 到插槽
date: 2026-08-21 10:20:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - 组件通信
description: 面向后端同学讲全 Vue 3 组件通信：props 单向数据流与校验、defineEmits 事件上报、defineModel 双向绑定、provide/inject 跨层级注入（与 Spring 依赖注入对照），以及默认/具名/作用域三种插槽，最后给一张全场景选型速查表。
keywords:
  - Vue 组件通信
  - props emit
  - provide inject
  - 作用域插槽
lang: zh-CN
---

> **适合人群**：能把页面拆成组件，但一遇到"子组件要改父组件数据"就开始用各种歪招的同学。
> 本篇基于 Vue 3.5。前两篇备好了模板与响应式，这篇让组件之间**正式开始协作**——通信方式的选择题，几乎占据日常 Vue 开发决策的一半。

---

## 一、为什么组件需要"通信协议"

组件化的本质是**封装**：每个组件管好自己的数据和模板，对外只暴露约定的接口。这和后端的方法设计是同一个道理——

- 方法靠**参数**传入、靠**返回值**传出，函数内部变量外界不可见；
- 组件靠 **props** 传入、靠**事件**上报，组件内部状态外界不可见。

Java 里你不会为了"改一个对象的字段"去 `public` 所有字段，前端同理：把子组件的数据全塞进父组件随意改，组件化就名存实亡。所以 Vue 给组件间通信定了一套**分层协议**，按关系远近选用：

| 关系 | 首选方式 | 后端类比 |
|------|---------|---------|
| 父 → 子 | props | 方法参数 |
| 子 → 父 | emit 事件 | 回调 / 监听器 |
| 父 ↔ 子 双向 | v-model（defineModel） | 参数 + 返回值的语法合并 |
| 祖先 ↔ 深层后代 | provide / inject | Spring 依赖注入 |
| 任意组件 | 全局状态（Pinia，下一篇的下下篇） | 单例 Bean / 全局缓存 |

![图1：组件通信全景——按组件关系选协议，越近越简单，越远越松耦合](vue-comm-overview.svg)

下面逐个拆开看。

## 二、props：父到子的单向数据流

```html
<!-- 父组件 -->
<UserCard :user="currentUser" :show-avatar="true" />
```

```vue
<!-- 子组件 UserCard.vue -->
<script setup>
defineProps({
  user: {
    type: Object,
    required: true,
    validator: (u) => u.id !== undefined,
  },
  showAvatar: {
    type: Boolean,
    default: false,
  },
})
</script>

<template>
  <div class="card">
    <img v-if="showAvatar" :src="user.avatar">
    <span>{{ user.name }}</span>
  </div>
</template>
```

三个要点：

1. **类型校验是开发期的**：写 TypeScript 时直接 `defineProps<{ user: User }>()`，比运行时校验更早暴露问题——这套思路你在后端天天用，无非是 DTO 校验换了个位置。
2. **单向数据流**：props 是只读的。子组件里 `props.user.name = 'x'` 会收到警告（对象深层属性 technically 能改，但那是事故不是功能，见第八节坑 2）。
3. props 传的是**引用**（对象/数组），父组件改了 `currentUser`，子组件自动跟着变——因为[响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/)追踪的是同一份数据。

为什么要单向？想象如果双向都能改：A 调 B，B 又回头改 A 的入参，方法调用链立刻变成一团乱麻。前端的历史包袱（Angular 1 时代的双向 binding 满天飞）已经替这个行业试过错了。

## 三、emit：子到父的事件上报

子组件不直接改父组件的数据，而是**喊一嗓子**，决定权留给父组件：

```vue
<!-- 子组件 ConfirmDialog.vue -->
<script setup>
const emit = defineEmits(['confirm', 'cancel'])

function onOk() {
  emit('confirm')            // 只上报，不执行业务
}
</script>

<template>
  <button @click="onOk">确认</button>
</template>
```

```html
<!-- 父组件 -->
<ConfirmDialog @confirm="handleSubmit" @cancel="showDialog = false" />
```

这就是**观察者模式**：子组件发布事件，父组件订阅处理。你在后端写的 `ApplicationEventPublisher` + `@EventListener` 是同一件事的 Spring 版。事件的命名用 kebab-case，`emit('confirm')` 对应模板里 `@confirm`。

带参数也一样自然：`emit('submit', { id, quantity })`，父组件 `@submit="onSubmit"` 里接的就是这个对象。

## 四、v-model 落到组件上：defineModel

表单类组件（输入框、开关、日期选择）高频需要"父子双向"。Vue 3.4+ 给了官方姿势——`defineModel`：

```vue
<!-- 子组件 SearchInput.vue -->
<script setup>
const keyword = defineModel()   // 声明一个可双向的模型
</script>

<template>
  <input v-model="keyword">
</template>
```

```html
<!-- 父组件 -->
<SearchInput v-model="query" />
```

子组件里改 `keyword.value`，父组件的 `query` 同步变；反之亦然。它不是打破了单向数据流，而是**语法合并**：`v-model="query"` 展开成 `:modelValue="query" @update:modelValue="query = $event"`——仍然是 props 下行 + 事件上行，[第二篇](/2026/08/21/articles/Vue/02-vue-template-directives/)拆过的那两根线，只不过线被框架接线员提前接好了。

![图2：单向数据流的完整回路——props 下行、事件上行，v-model 是合并写法](vue-comm-one-way-flow.svg)

一个组件还能有多个双向值：`v-model:title="title" v-model:page="page"`，子组件里 `defineModel('title')`、`defineModel('page')`——命名模型在分页组件这类场景很好用。

## 五、provide / inject：跨层级注入

props 传深层组件要逐层搬运（术语叫 prop drilling），四层之后代码就没法看了：

```html
<Grandpa :theme="theme">     <!-- 只是为了往下传 -->
  <Father :theme="theme">    <!-- 自己根本不用 -->
    <Son :theme="theme">     <!-- 还是不用 -->
      <Leaf :theme="theme" />  <!-- 真正的使用者 -->
```

`provide / inject` 让祖先直接把数据"放进上下文"，任意深度的后代按 key 取用：

```vue
<!-- 祖先组件 -->
<script setup>
import { provide, ref } from 'vue'

const theme = ref('dark')
provide('theme', theme)        // 提供：连响应式一起给
</script>
```

```vue
<!-- 任意深层后代 -->
<script setup>
import { inject } from 'vue'

const theme = inject('theme')  // 注入：拿到的就是那个 ref
</script>
```

后端同学到这里应该已经坐不住了：**这就是 Spring 的依赖注入**。`provide` 是往容器里注册 Bean，`inject` 是 `@Autowired` 按 key 取——区别只是 Spring 的容器全局唯一、靠类型匹配，Vue 的容器是**组件树作用域**、靠字符串 key 匹配，子树里离得最近的 provide 覆盖更远的（和类加载器双亲委派的就近覆盖异曲同工）。

同样的纪律也适用：**注入的东西应该是"环境性"的**——主题、当前用户、国际化文案；业务数据老老实实走 props，别把组件树当成全局变量桶。

## 六、插槽：把"一半页面"传给子组件

props 传的是**数据**，插槽传的是**模板片段**——这是组件通信里最容易被低估的一维。

```html
<!-- Card 是一个通用容器组件 -->
<Card>
  <h3>订单详情</h3>       <!-- 这段 DOM 通过插槽"传进"Card -->
  <p>共 3 件商品</p>
</Card>
```

```vue
<!-- Card.vue -->
<template>
  <div class="card">
    <slot />              <!-- 站位：父组件塞的内容渲染在这里 -->
  </div>
</template>
```

后端类比：**模板方法模式**——父类定骨架、子类填实现；这里反过来，子组件定骨架（卡片框、头部样式），父组件填内容。`<slot>` 就是钩子方法。

三种形态按需升级：

```html
<!-- 具名插槽：多个站位，各填各的 -->
<Card>
  <template #header>订单详情</template>
  <template #footer>合计 ¥356</template>
  <p>商品列表……</p>          <!-- 填默认插槽 -->
</Card>
```

```html
<!-- 作用域插槽：子组件把数据"回传"给插槽内容用 -->
<UserList :users="users">
  <template #default="{ user, index }">
    <span :class="{ vip: user.vip }">#{{ index }} {{ user.name }}</span>
  </template>
</UserList>
```

作用域插槽方向感最强：**模板是父组件写的，数据是子组件给的**。列表组件把每行数据 `user`、`index` 交出来，怎么渲染每一行由使用者决定——Element Plus 的表格列定义全是这个机制。它等于把"回调"从传函数变成了传模板。

![图3：作用域插槽——子组件出数据，父组件出模板，渲染发生在子组件站位处](vue-comm-scoped-slot.svg)

## 七、选型速查

写组件前先问两个问题：

1. **传的是数据还是结构？** 结构（一段 DOM）→ 插槽；数据 → 继续。
2. **方向和距离？** 父到子 → props；子到父 → emit；双向表单值 → defineModel；跨多层的"环境"→ provide/inject；跨页面的"业务状态"→ Pinia（本系列第 6 篇）。

拿不准时的默认答案：**props + emit**。它是耦合最紧也最直白的方式，而"组件关系是否应该这么紧"本身是个好的设计压力测试——如果 props 层数太深让你烦躁，那是组件边界画错了的信号，而不是该换通信方式的信号。

## 八、常见坑

1. **直接改 props**：`props.msg = 'x'` 直接警告；`props.user.name = 'x'`（深层属性）不警告但埋雷——父子两处同时改一个对象，更新顺序不可控。需要"基于 props 改"时，用 `computed` 派生或 `ref(props.user)` 拷贝后本地化。
2. **对象 props 的共享幻觉**：传引用意味着子组件深层修改会影响父组件。想隔离就传浅拷贝，想联动就明确这是约定。
3. **emit 的事件名与处理函数对不上**：`emit('submitForm')` 配 `@submit-form`，camelCase 与 kebab-case 混用排查半小时——统一风格能省掉整类问题。
4. **defineModel 与手写 modelValue 混用**：3.4+ 项目统一用 defineModel；维护老代码时先确认它是 `props: ['modelValue'] + emit('update:modelValue')` 的手写版，两种写法别混。
5. **provide 注入了非响应式值**：`provide('theme', 'dark')` 之后祖先改主题，后代纹丝不动——传 ref 本身（不是 `.value`），响应式才能沿着注入链传下去。
6. **拿插槽当 props 用**：只想传一个标题，却让使用者写 `<template #header>` 包一整段标题 DOM——纯数据用 props，别让使用者替你写渲染。

## 九、总结

- 组件通信是协议问题：props 像方法参数，emit 像事件回调，单向数据流保住封装；
- v-model/defineModel 是 props + emit 的接线合并，双向绑定没有魔法；
- provide/inject 是组件树作用域的依赖注入，Spring 用户零成本迁移心智；
- 插槽传结构：默认、具名、作用域三档，作用域插槽是"数据子出、模板父出"的回调变体；
- 选型默认 props + emit，层级太深先反思组件边界。

组件内部已经五脏俱全，组件之间也能协作了——但真实应用是**多个页面**组成的：URL 怎么映射到组件？切换页面怎么做鉴权拦截？下一篇讲 Vue Router，它的导航守卫体系，正好能和你在 Spring 里写的拦截器链一一对上。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. [响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/) → 4. 组件通信（本篇）→ 5. Vue Router（下一篇）
