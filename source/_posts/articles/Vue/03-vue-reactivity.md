---
title: Vue 从零到一（03）：响应式系统，数据变了视图为什么自动变
date: 2026-08-21 10:10:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - 响应式
description: 面向后端同学拆开 Vue 3 的心脏：命令式与声明式的分野、ref 为什么要 .value、reactive 的 Proxy 原理与丢响应场景、computed 的缓存语义、watch 与 watchEffect 的分工，最后用"拦截 → 收集 → 派发"三步讲清自动更新的底层机制。
keywords:
  - Vue 响应式
  - ref reactive 区别
  - Proxy 依赖收集
  - computed watch watchEffect
lang: zh-CN
---

> **适合人群**：会写模板和指令，但说不清 `.value` 是干嘛的、`reactive` 解构后为什么页面不更新的同学。
> 本篇基于 Vue 3.5。上一篇[《模板语法与指令》](/2026/08/21/articles/Vue/02-vue-template-directives/)结尾留了个问题：**数据变化是怎么被察觉的？** 这篇正面回答。

---

## 一、先想清楚：命令式与声明式的分野

用 jQuery（或者裸 JS）写页面的日子是这样的：

```js
// 命令式：每一步都亲手指挥 DOM
$('#count').text(count)
$('#count').css('color', count > 10 ? 'red' : 'black')
```

数据变了？你得**自己记得**去找所有用到它的地方，一个一个更新。忘了一处，页面就和数据不一致——这类 bug 的本质是：**数据和视图的同步靠人肉维护**。

Vue 的世界观相反：

```js
// 声明式：只描述"视图长什么样"，不管怎么更新
const count = ref(0)
```

```html
<span :style="{ color: count > 10 ? 'red' : 'black' }">{{ count }}</span>
```

数据变了，视图自动变。听起来像魔法，但框架领域没有魔法，只有机制。这个机制就是**响应式系统**，它要回答三个问题：

1. 数据被读取时，怎么知道**谁**在读？（不然不知道更新谁）
2. 数据被修改时，怎么**察觉**？
3. 察觉之后，**怎么精准更新**视图？

带着这三个问题往下看。

## 二、ref：给值套一个"盒子"

先看结论：`ref` 把值包进一个带 `.value` 属性的对象。

```vue
<script setup>
import { ref } from 'vue'

const count = ref(0)

function increment() {
  count.value++   // 改数据必须 .value
}
</script>

<template>
  <button @click="increment">{{ count }}</button>  <!-- 模板里不用 .value -->
</template>
```

为什么非要 `.value`？回到问题 2——**怎么察觉数据被修改**。Vue 3 的答案是 Proxy，但 Proxy 只能拦截**对象**的操作（属性读写），对 `let count = 0` 这种基本类型毫无办法：数字就是数字，赋值时没有任何钩子可挂。

所以 Vue 把值装进盒子 `{ value: 0 }`，对盒子的 `.value` 读写就可以被拦截了。`count.value++` 实际经历了：读取 `.value` → 修改 `.value` → 拦截器通知更新。**`.value` 不是设计洁癖，是拦截的挂载点**。

模板里为什么不用写 `.value`？编译器会把模板里对 ref 的裸引用自动补上（`count` → `count.value`），这是编译期做的事，省你一层心智。

两个补充事实：

- `ref` 也能装对象：`ref({ name: 'frank' })`，此时 `.value` 是一个深层响应式的对象，里面嵌套多深都会被追踪；
- 只想要浅层追踪时用 `shallowRef`，性能敏感的大列表场景偶尔会用到。

## 三、reactive：Proxy 直接包对象

`reactive` 是不用盒子的方案——直接用 Proxy 代理整个对象：

```js
import { reactive } from 'vue'

const user = reactive({ name: 'frank', profile: { age: 26 } })

user.name = 'Frank'          // 直接改，无需 .value，深层属性同样响应
user.profile.age++           // 嵌套对象也是响应式的
```

写起来比 `ref` 爽，但它有三条铁律级的局限，全都源于一点：**响应式在"这个代理对象"身上，不在变量名上**。

```js
const { name } = user        // 坑 1：解构后再改 name，页面不动
//            ↑ 拿到的是普通字符串，和代理对象断了联系

let u = reactive({ a: 1 })
u = reactive({ a: 2 })       // 坑 2：整个替换，旧引用的监听全丢了

function updateUser(user) { user.name = 'x' }  // 坑 3：传参没问题，
// 但如果函数里解构了、或调用方把返回值当普通对象存走，响应即断
```

![图1：ref 与 reactive 的结构对比——盒子方案与代理方案各自的丢响应风险](vue-reactivity-ref-vs-reactive.svg)

### ref vs reactive 怎么选

官方现在的推荐很明确：**默认用 ref**。理由：

1. `ref` 没有解构丢响应问题——你永远带着 `.value`，想丢都难；
2. `.value` 是个显式信号，读代码时一眼分清"这是响应式数据"还是普通变量；
3. `reactive` 的舒适区只有"一大坨配置型对象"，而这种场景往往用 `ref` 包对象也能覆盖。

`.value` 多敲五个字符，换来的是整类 bug 从根上消失，这笔账划算。后端类比：就像 Java 里宁可显式 `Optional` 也不愿拿到一个"可能是 null 也可能不是"的引用——**约束写在类型上，好过靠自觉**。

## 四、computed：带缓存的派生值

页面经常需要"由现有数据算出来的值"：

```js
import { ref, computed } from 'vue'

const items = ref([
  { price: 100, count: 2 },
  { price: 50, count: 1 },
])

const total = computed(() =>
  items.value.reduce((sum, it) => sum + it.price * it.count, 0)
)
```

```html
<p>总价：{{ total }}</p>
```

**不要写成方法**：`function getTotal() { ... }` 每次渲染都重算；`computed` 会缓存——依赖（`items`）没变，多次读取 `total` 只算一次，模板里用十次也只算一次。这是 `computed` 和方法调用的本质区别，语义上接近 Spring 的 `@Cacheable`：以依赖为 key 的自动缓存。

三条使用纪律：

1. **getter 必须纯净**：不发起请求、不改别的状态、不写 `Date.now()` 这种每次都变的值——缓存的前提是"依赖不变则结果不变"；
2. **别在 computed 里干重活以外的事**，副作用是 watch 的领地；
3. `computed` 默认只读，需要可写时提供 getter/setter 双函数（比如全名 = 名 + 姓，setter 里拆回去）。

## 五、watch 与 watchEffect：响应"变化"这件事

`computed` 是"派生一个值"，watch 是"数据变了之后**做点事**"——发请求、写 localStorage、操作非响应式的外部系统：

```js
import { ref, watch } from 'vue'

const keyword = ref('')

watch(keyword, (newVal, oldVal) => {
  console.log(`搜索词从 ${oldVal} 变成 ${newVal}`)
  fetchList(newVal)
})
```

三个高频配置：

```js
// 深度监听：watch 一个 ref 装的对象时默认会深层追踪，
// 用 getter 函数返回对象则只盯引用，需要显式 deep
watch(
  () => form.value,
  () => saveDraft(),
  { deep: true }
)

// 立即执行：默认首次不触发（没有"旧值"），immediate 让它起步就跑一次
watch(userId, loadOrders, { immediate: true })

// 清理上一次的副作用：搜索防抖、竞态取消的标准写法
watch(keyword, (val, old, onCleanup) => {
  const timer = setTimeout(() => fetchList(val), 300)
  onCleanup(() => clearTimeout(timer))   // 下次触发前取消上一次
})
```

`watchEffect` 是自动版：**不指定监听谁，回调里读了谁就监听谁**，并且立即执行一次：

```js
watchEffect(() => {
  // 用到 keyword 和 page，两者任一变化都会重跑
  fetchList(keyword.value, page.value)
})
```

![图2：派生与响应的选型——computed 求值、watch 回调、watchEffect 自动依赖](vue-reactivity-derived-choice.svg)

选型口诀：**要"值"用 computed，要"动作"用 watch，动作依赖的关系懒得列（或天然就是"一启动就要跑"）用 watchEffect**。工程里的常见拍板：搜索框防抖用 `watch + onCleanup`，初始加载用 `watchEffect` 或 `onMounted`，列表过滤/汇总一律 `computed`。

## 六、原理三步走：拦截 → 收集 → 派发

现在把开篇三个问题串起来。Vue 3 响应式的核心是两个拦截时机 + 一个登记簿：

1. **拦截 get（读）**：任何人读响应式数据，Vue 假设"当前正在运行的这个副作用函数"依赖它。"副作用函数"目前可以粗略理解为组件的渲染函数——组件渲染时读了 `count`，说明它依赖 `count`。
2. **依赖收集（track）**：把"count 被组件 A 依赖"这条关系登记进一个全局的映射表（数据 → 依赖它的副作用集合）。这就是观察者模式的注册环节，和你在后端写事件监听器 `addListener` 是一回事，只不过 Vue 帮你全自动注册。
3. **拦截 set（写）→ 派发更新（trigger）**：`count.value++` 触发 set 拦截，查登记簿找到依赖方，逐个重新执行——组件渲染函数重跑，生成新的虚拟 DOM，diff 后更新真实 DOM。

![图3：响应式系统三步走——Proxy 拦截读写、track 登记依赖、trigger 派发更新](vue-reactivity-proxy-flow.svg)

上一篇文章讲的模板更新、这一篇讲的 computed 缓存失效、watch 触发，底层都是这一套。所谓"双向绑定"，也不过是 `v-model` 的 `@input` 回写触发 set，set 触发 trigger，trigger 重渲染——同一个环。

## 七、新手最常踩的五个坑

1. **解构 reactive**：`const { name } = user` 之后改 `name` 页面不动——解构出来的是快照不是引用。要解构用 `toRefs(user)`，每个属性转成 ref。
2. **ref 忘了 `.value`**：脚本里 `count++` 改的是盒子的引用比较？不，那是对一个对象做 `++`，直接报错或静默无效。记住：**脚本里永远 .value，模板里永远不用**。
3. **watch 以为监听了，其实监听了个寂寞**：`watch(form.value, ...)` 传的是当前快照对象，换成 `watch(form, ...)`（传 ref 本身）。
4. **在 computed 里发请求/改状态**：缓存语义被破坏，还可能引发连锁更新死循环。派生归 computed，动作归 watch。
5. **把接口返回直接塞进 reactive 再整体替换**：`state = res.data` 丢响应。要么 `Object.assign(state, res.data)`，要么一开始就用 ref：`list.value = res.data`。

## 八、总结

- 响应式系统回答三件事：谁在读、怎么察觉写、怎么精准更新；
- Proxy 只能拦对象，所以基本类型用 ref 装盒子，`.value` 是拦截挂载点；
- reactive 写着爽但有解构/替换丢响应的坑，官方推荐默认 ref；
- computed 是以依赖为 key 的缓存派生，watch 负责变化后的动作，watchEffect 自动收集依赖；
- 底层机制是拦截 get 做 track、拦截 set 做 trigger——观察者模式的自动化版本。

数据有了、模板有了，但真实页面是成百上千个组件拼出来的——**组件之间怎么传数据、怎么发事件、怎么共享状态**？下一篇讲组件通信，其中 provide/inject 那一节，你会发现它和 Spring 的依赖注入惊人地神似。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. 响应式系统（本篇）→ 4. 组件通信（下一篇）
