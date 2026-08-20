---
title: Vue 从零到一（01）：组件生命周期与八个钩子的正确用法
date: 2026-08-18 20:00:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - Composition API
description: 用大白话讲清楚 Vue 3 组件从创建到销毁的完整生命周期：八个钩子各自能干什么、异步请求放 created 还是 mounted、父子组件的执行顺序，以及最常踩的四个坑。
keywords:
  - Vue 生命周期
  - Vue 钩子
  - created mounted 区别
  - Composition API
lang: zh-CN
---

> **适合人群**：用 Vue 写过页面，但被问到"请求该放 created 还是 mounted"就心里发虚的同学。
> 本篇基于 Vue 3.5，Options API 与 `<script setup>` 两种写法都覆盖，所有代码可直接复制运行。

## 一、组件的一生：从出生到退休

前端组件和后端的一次请求不一样。请求是"处理完就没了"，组件更像一个员工：**出生（创建）→ 上岗（挂载）→ 干活（更新）→ 退休（卸载）**，全程活在页面上，随时等待数据变化。

Vue 在每个关键节点都会**喊一嗓子**——这就是生命周期钩子（Lifecycle Hooks）。你在钩子里注册回调，框架走到那一步就替你调用。为什么要设计成这样？因为有些事只能在特定阶段干：

- 数据都还没准备好，你去读就是 undefined；
- DOM 还没挂到页面上，你 `document.querySelector` 拿到的是 null；
- 组件都要销毁了，你的定时器还开着，那就是内存泄漏。

先看全景图，对整体有感觉，下面再逐个拆：

![图1：Vue 3 组件生命周期全景——四个阶段八个钩子](vue-lifecycle-overview.svg)

（Composition API 的 `setup` 与 `onXxx` 系列和图中钩子的对应关系，见第三节。）

## 二、八个钩子各自能干什么

先上一张总表，**"此时能拿到什么"是理解钩子的钥匙**：

| 钩子 | 阶段 | data/methods | DOM | 典型用途 |
|------|------|:---:|:---:|----------|
| beforeCreate | 创建前 | ❌ | ❌ | 几乎不用，插件/全局配置 |
| created | 创建后 | ✅ | ❌ | 发不依赖 DOM 的请求、初始化数据 |
| beforeMount | 挂载前 | ✅ | ❌ | 很少用 |
| mounted | 挂载后 | ✅ | ✅ | 操作 DOM、初始化 echarts/轮播 |
| beforeUpdate | 更新前 | ✅ | 旧 DOM | 更新前记录旧状态（如滚动位置）|
| updated | 更新后 | ✅ | 新 DOM | 读取更新后的 DOM（慎改数据）|
| beforeUnmount | 卸载前 | ✅ | ✅ | 清理定时器、解绑事件、取消订阅 |
| unmounted | 卸载后 | ❌ | ❌ | 一般留空，做不了什么了 |

用一个最小的计数器组件把八个钩子全部打印一遍：

```js
export default {
  data() {
    return { count: 0 }
  },
  beforeCreate() {
    console.log('1 beforeCreate：实例刚出生')
    // this.count 此刻是 undefined
  },
  created() {
    console.log('2 created：数据就绪，页面还是空的')
    console.log(this.count)   // ✅ 0
    console.log(this.$el)     // ❌ undefined
  },
  beforeMount() {
    console.log('3 beforeMount：模板编译完成，还没上页面')
  },
  mounted() {
    console.log('4 mounted：DOM 挂好了')
    console.log(this.$el)     // ✅ 真实 DOM 节点
    setTimeout(() => this.count++, 1000)  // 触发更新钩子
  },
  beforeUpdate() {
    console.log('5 beforeUpdate：count 变了，DOM 还是旧值')
    console.log(this.$el.textContent.includes('0'))  // true，DOM 未更新
  },
  updated() {
    console.log('6 updated：DOM 已经是新值')
  },
  beforeUnmount() {
    console.log('7 beforeUnmount：实例还完整，最后的清理机会')
  },
  unmounted() {
    console.log('8 unmounted：彻底销毁')
  }
}
```

把组件用 `v-if` 控制显示/隐藏，控制台会按 1→8 的顺序完整走一遍。几个容易忽视的细节：

**created 和 mounted 是最常用的两个，区别只有一句话：created 有数据没 DOM，mounted 数据 DOM 都有。** 所以凡是需要 `this.$refs`、`echarts.init()`、`getBoundingClientRect()` 的操作，只能放 mounted。

**beforeUpdate 里的 DOM 是旧的，updated 里的 DOM 是新的。** 需要在更新前记录旧状态（比如保存滚动位置、做翻转动画的起点）用前者，需要读取新 DOM 用后者。

**清理动作放 beforeUnmount，别放 unmounted。** 卸载前实例还完整，能访问 data、能 clearInterval；到了 unmounted 一切都已释放，巧妇难为无米之炊。

## 三、Composition API：钩子都改名成了 onXxx

Vue 3 的 `<script setup>` 里找不到 beforeCreate 和 created——因为 **setup 本身就约等于这两个钩子**：它执行得比 beforeCreate 还早，此时 props 已经解析、响应式数据可用，但同样没有 DOM。

其余钩子全部改成了 `onXxx` 注册函数，且必须**在 setup 内同步调用**（直接写在 `<script setup>` 顶层即可）：

![图2：Options API 与 Composition API 钩子对照](vue-lifecycle-api-compare.svg)

```vue
<script setup>
import { ref, onMounted, onUpdated, onUnmounted } from 'vue'

const count = ref(0)

// 写在这里的代码 ≈ beforeCreate + created 阶段
console.log('数据可用：', count.value)   // ✅ 0
// document.getElementById('app')       // ❌ DOM 还不存在

onMounted(() => {
  console.log('DOM 就绪，可以初始化图表了')
})

onUpdated(() => {
  console.log('DOM 已更新')
})

onUnmounted(() => {
  console.log('组件销毁')
})
</script>

<template>
  <button @click="count++">{{ count }}</button>
</template>
```

从 Vue 2 项目迁移的同学最容易踩的坑是改名：`beforeDestroy/destroyed` 在 Vue 3 里叫 `beforeUnmount/unmounted`。名字对不上时钩子**根本不会执行**，而且生产环境一声不吭，建议迁移时全局搜一遍旧名字。

## 四、异步请求到底放 created 还是 mounted？

这是生命周期里被问得最多的问题。先给结论：

| 场景 | 放哪里 | 原因 |
|------|--------|------|
| 普通列表/详情数据 | created（或 setup） | 不依赖 DOM，尽早发出，与渲染并行 |
| echarts、swiper 等初始化 | mounted | 需要真实 DOM 节点 |
| 需要先拿容器尺寸再请求 | mounted | 拿到宽高才知道请求多少数据 |
| SSR 项目 | created（setup） | 服务端渲染不执行 mounted |

核心差别看图：created 发请求，网络等待和 DOM 渲染是**并行**的；mounted 发请求，要等渲染完才发出，中间有一段网络在"空等"：

![图3：created 与 mounted 发请求的时序对比](vue-lifecycle-fetch-timing.svg)

对首屏来说，`总耗时 ≈ max(渲染, 请求)` 和 `渲染 + 请求` 的差距，在网络越慢的设备上越明显。

两个补充：

- `<script setup>` 里想直接 `const data = await fetchUser()`，必须配合 `<Suspense>` 使用，否则会阻塞组件渲染，一般不推荐；常规做法还是发起一个不 await 的异步函数。
- 请求放在 created/setup 里要处理"回来时组件已经卸载"的情况（用户早把页面切走了），用 AbortController 或在卸载钩子里置标志位。

## 五、父子组件的执行顺序（面试高频）

假设父组件的模板里用了一个子组件，初次挂载的完整顺序是：

```text
父 beforeCreate → 父 created → 父 beforeMount
→ 子 beforeCreate → 子 created → 子 beforeMount
→ 子 mounted → 父 mounted
```

为什么会这样？父组件挂载时渲染模板，渲染过程中**遇到子组件标签，才去创建子组件**——所以创建动作是父先子后；而父的 mounted 要等自己的 DOM（包含子组件的 DOM）全部就绪才触发——所以挂载完成是子先父后。

更新和卸载同理，一句话总结：**开始是父先，完成是子先**。

![图4：父子组件生命周期执行顺序](vue-parent-child-mount-order.svg)

注意一个前提：上图更新链成立的前提是"变化来自父组件的数据"。如果只是子组件自己的 data 变了，父组件从头到尾不会触发任何更新钩子。

## 六、最容易踩的四个坑

**坑 1：在 updated 里改数据，死循环。**

```js
updated() {
  this.count++   // ❌ 数据变 → 重新渲染 → updated → 数据又变……
}
```

updated 里只做读取类操作（打日志、上报、同步第三方库状态）。确实要改，必须加条件判断保证只执行一次。

**坑 2：v-if 为 false 的组件，一个钩子都不会执行。**

`v-if` 控制的是"组件存在与否"：false 时根本不创建；每次从 false 变 true 都完整走一遍创建挂载，反之走卸载。`v-show` 则始终创建组件，只是 `display: none`。所以"切换就要重新初始化"用 v-if，"频繁切换省创建成本"用 v-show。

另外，如果给组件包了 `<keep-alive>`，切换时不再触发 unmounted，取而代之的是 `activated` / `deactivated`——缓存组件的"重新上岗/暂时休息"。

**坑 3：定时器和全局监听不清理，内存泄漏。**

```vue
<script setup>
import { onMounted, onUnmounted } from 'vue'

let timer = null
onMounted(() => {
  timer = setInterval(poll, 3000)
  window.addEventListener('resize', onResize)
})
onUnmounted(() => {
  clearInterval(timer)                            // 不清理 = 定时器一直跑
  window.removeEventListener('resize', onResize)   // 回调被全局引用，组件无法回收
})
function poll() { /* 轮询逻辑 */ }
function onResize() { /* 自适应逻辑 */ }
</script>
```

判断标准很简单：凡是"注册到组件外面"的东西（setInterval、window 事件、WebSocket、第三方 SDK 回调），都必须在卸载钩子里逐个撤销，有借有还。

**坑 4：把 Vue 2 的钩子名照搬到 Vue 3。**

除了上面说的 `beforeDestroy → beforeUnmount`，还有 `destroyed → unmounted`。这类"拼写对了、名字错了"的问题不报错、不执行，是最隐蔽的一类 bug。

## 七、总结

一张表带走全部（Vue 3）：

| 你想干什么 | Options API | Composition API |
|-----------|-------------|-----------------|
| 组件创建后立刻拿初始数据 | created | setup 顶层 |
| 初始化 echarts、操作 ref | mounted | onMounted |
| 渲染后同步第三方库 | updated（只读）| onUpdated（只读）|
| 清理定时器、事件、订阅 | beforeUnmount | onBeforeUnmount |
| keep-alive 缓存组件重新显示 | activated | onActivated |
| 捕获后代组件错误 | errorCaptured | onErrorCaptured |

最后送一句口诀：

> **创建父先子后，完成子先父后；请求数据赶早（created），操作 DOM 等牢（mounted），副作用要有借有还（beforeUnmount）。**

生命周期是 Vue 响应式系统的"时间轴视图"——把这条时间轴刻进脑子，后面学 watch、computed、nextTick 时你会发现，它们不过是同一条时间轴上的不同站点。
