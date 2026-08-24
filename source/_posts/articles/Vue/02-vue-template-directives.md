---
title: Vue 从零到一（02）：模板语法与常用指令，把页面真正写起来
date: 2026-08-21 10:00:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - 模板语法
description: 面向后端同学讲透 Vue 3 模板层：插值能放什么、v-bind 绑定 class/style 的三种姿势、事件修饰符对比原生 addEventListener、v-if 与 v-show 的成本账、v-for 的 key 在 diff 里到底干什么，最后拆开 v-model 这颗语法糖。
keywords:
  - Vue 指令
  - v-if v-show 区别
  - v-for key 作用
  - v-model 原理
lang: zh-CN
---

> **适合人群**：刚装好 Vite、能跑起页面，但模板里一堆 `v-` 开头的东西全靠复制粘贴的后端同学。
> 本篇基于 Vue 3.5，统一用 `<script setup>` 写法。前作[《组件生命周期》](/2026/08/18/articles/Vue/01-vue-component-lifecycle/)讲了组件的"生老病死"，这篇回到最地基的部分——**模板**，也就是你每天写的那块 HTML。

---

## 一、模板在 Vue 里是什么角色

先建立一个世界观：Vue 的页面 = **模板（结构）+ 响应式数据（内容）+ 方法（行为）**。模板本质上是一份"带占位符的 HTML"，Vue 拿着它编译成渲染函数，数据一变就重新渲染。

这跟后端的老朋友 Thymeleaf、JSP 是一个思路——都是"模板 + 数据 → 页面"。区别在于：Thymeleaf 在**服务端**渲染一次就完事，Vue 在**浏览器里**持续渲染，数据变了页面局部自动更新。所以 Vue 模板里的指令（`v-` 开头的特殊属性）不只是"填值"，还承担着"数据变了之后页面怎么跟着变"的职责。

记住这个对比，下面每个指令你都可以拿 Thymeleaf 里对应的东西类比，只是它们都活了过来。

## 二、插值：花括号里能放什么

{% raw %}
```html
<p>你好，{{ user.name }}</p>
<p>今年 {{ age + 1 }} 岁</p>
<p>{{ items.length }} 条记录</p>
<p>{{ ok ? '显示' : '隐藏' }}</p>
```
{% endraw %}

规则一句话：**只能放单个表达式，不能放语句**。`if`、`for` 这种语句不行，三元、链式调用、算术都行。原因很朴素——Vue 需要能追踪"这个位置依赖哪些数据"，表达式有确定的返回值，可以分析依赖；语句没有。

三个新手常见问题：

1. **插值输出的是纯文本**，不会解析 HTML。真要插入 HTML 得用 `v-html`，但那等于后端拼接 SQL 一样危险（XSS），内容不可信时绝对不用。
2. 属性里不能用插值语法，得用 `v-bind`，这就是下一节。
3. 花括号里的 `count` 来自 `<script setup>` 顶层的变量，setup 返回的东西模板天然可见，不用 `this`。

## 三、v-bind：把数据接到属性上

`v-bind:src` 简写 `:src`，冒号后面的属性值是一个**表达式**，而不是字符串：

```html
<img :src="user.avatar" :alt="user.name">
<a :href="detailUrl">详情</a>
<button :disabled="!hasNext">下一页</button>
```

不加冒号 `src="user.avatar"` 就是字面量字符串——这是新手第一天必踩的坑，记住：**冒号一加，引号里的内容从"字符串"变成"JS 表达式"**。

### class 绑定：三种姿势

```html
<!-- 1. 对象：键是类名，值是布尔 -->
<div :class="{ active: isActive, 'text-danger': hasError }"></div>

<!-- 2. 数组：列表拼接 -->
<div :class="[baseClass, isActive ? 'active' : '']"></div>

<!-- 3. 混用 -->
<div :class="['card', { active: isActive }]"></div>
```

后端同学最容易犯的错是拿着字符串拼接 `:class="'card' + isActive ? 'active' : ''"`——运算符优先级会先拼再判空，结果永远不对。老实用对象写法。

### style 绑定

```html
<div :style="{ color: theme.color, fontSize: theme.size + 'px' }"></div>
```

注意 CSS 属性名要驼峰（`fontSize`）或者加引号的 kebab-case（`'font-size'`）。

## 四、v-on：事件绑定与修饰符

`v-on:click` 简写 `@click`。原生 JS 里你写 `addEventListener('click', fn)`，Vue 里就是 `@click="fn"`，传参直接 `@click="submit(order.id)"`（不写括号时事件对象自动注入）。

真正省事的是**修饰符**——把 DOM 事件处理的"标准动作"声明出来：

```html
<!-- 阻止冒泡：等价于 e.stopPropagation() -->
<button @click.stop="onBtn">按钮</button>

<!-- 阻止默认行为：等价于 e.preventDefault()，表单提交必用 -->
<form @submit.prevent="onSubmit">...</form>

<!-- 只触发一次 -->
<button @click.once="init">初始化</button>

<!-- 按键修饰符：回车才触发 -->
<input @keyup.enter="onSearch">
```

可以链式：`@click.stop.prevent="fn"`。对比一下你写原生或 jQuery 的日子：每个 handler 里头两行都是 `stopPropagation` / `preventDefault`，现在这两行"仪式代码"消失了，模板一眼能看出这个事件的性格——这就是声明式的好处。

## 五、v-if vs v-show：同样是隐藏，成本结构不同

面试高频题，两张账本说清楚：

- `v-if`：**条件为假时，这个元素根本不存在**（不渲染、不占 DOM）。切换时走创建/销毁流程，还伴随着组件的挂载卸载（生命周期钩子会重新跑，见[第一篇](/2026/08/18/articles/Vue/01-vue-component-lifecycle/)）。
- `v-show`：元素**始终渲染**，只是切换 CSS 的 `display`。初始就要付一次渲染成本，之后切换只是改个样式，非常便宜。

![图1：v-if 与 v-show 的对比——渲染成本账本](vue-directive-vif-vshow.svg)

选型口诀：**切换频繁用 v-show（比如 tab 页签），条件很少翻转用 v-if（比如权限区块、弹窗）**。默认拿不准就先用 v-if——它是"惰性"的，初始为假连渲染成本都不付。

另外 `v-if` 可以配合 `v-else-if` / `v-else` 做分支，条件多于三个建议改成 `computed` 算出一个状态值再绑定。要批量控制一段结构，用 `<template v-if>` 包住——它是逻辑容器，不会产生真实 DOM 节点。

## 六、v-for：列表渲染与 :key

{% raw %}
```html
<li v-for="(item, index) in items" :key="item.id">
  {{ index }} - {{ item.name }}
</li>
```
{% endraw %}

`key` 不是可有可无的点缀，它是**每个节点的身份证**。Vue 更新列表时不做"整列重建"，而是做 **diff**：新旧列表对账，能复用的复用、该挪的挪、该删的删。对账的依据就是 key。

用 `index` 当 key 为什么是坑？看这个删除场景：

```js
const items = ref([
  { id: 1, name: '张三' },
  { id: 2, name: '李四' },
  { id: 3, name: '王五' },
])
// 删除第一个，index 0/1/2 变成李四/王五/无
```

以 index 为 key，Vue 眼里发生的是"位置 0 的内容从张三变成李四、位置 1 从李四变成王五、位置 2 没了"——三个节点全要**就地更新**。以 `item.id` 为 key，Vue 眼里是"张三这个节点没了，李四王五原样复用"——只删一个节点，剩下的一根手指都不用动。

![图2：key 参与下的列表 diff——有 key 按身份复用，无 key 按位置就地更新](vue-directive-key-diff.svg)

除了性能，**带状态的控件**更容易出灵异事件：列表里每行一个输入框，用 index 作 key，删除第一行后你会发现"第一行的输入内容还是张三填的那些"——因为按位置对账，输入框这个 DOM 被原样复用了，只是旁边文字变了。

三条纪律：**key 用稳定唯一的业务 id；不用 index（列表会增删排序时）；不用随机数（每次都变等于没有 key）**。

顺带一个优先级坑：Vue 3 里 `v-if` 的优先级**高于** `v-for`，所以 `v-for="u in users" v-if="u.active"` 会直接报错——v-if 执行时变量 u 还不存在。用 `computed` 先过滤出 `activeUsers` 再 v-for，一了百了。

## 七、v-model：一颗值得拆开看的语法糖

表单是前端交互的基本盘，而 `v-model` 是表单的核心：

```html
<input v-model="keyword">
```

它等价于：

```html
<input :value="keyword" @input="keyword = $event.target.value">
```

就这么两件事：**数据 → 视图**（`:value`），**视图 → 数据**（`@input` 回写）。所谓"双向绑定"不是什么黑魔法，就是这个语法糖在两头各接了一根线。

![图3：v-model 语法糖拆解——本质是 :value 与 @input 两根线的合并写法](vue-directive-vmodel-sugar.svg)

不同表单控件"回写"监听的事件不一样，`v-model` 帮你抹平了差异：

```html
<textarea v-model="remark"></textarea>
<input type="checkbox" v-model="agree">          <!-- 勾选 → true/false -->
<input type="radio" value="a" v-model="picked">  <!-- 选中 → 'a' -->
<select v-model="city">                          <!-- 选中项的 value -->
  <option value="hz">杭州</option>
</select>
<select v-model="cities" multiple>...</select>   <!-- 多选 → 数组 -->
```

三个修饰符解决高频琐事：

- `.lazy`：默认 input 每敲一个字符同步一次，加 `.lazy` 改成 `change` 事件（失焦才同步），搜索联想场景常用；
- `.number`：输入框拿到的永远是字符串，`.number` 自动转数字——不然你提交给后端的年龄是 `"18"`（字符串），Spring 端 `@RequestBody` 反序列化能兜住，`@RequestParam` 拼接场景就翻车了；
- `.trim`：去首尾空格。

## 八、新手最常踩的五个坑

1. **忘加冒号**：`:disabled="form.loading"` 写成 `disabled="form.loading"`——后者是恒真的字符串。
2. **class 用字符串拼接**：优先级坑 + 不可读，统一用对象/数组语法。
3. **v-for 的 key 用 index**：删除、排序后状态错位，详见上文。
4. **v-if 和 v-for 写在同一个节点**：Vue 3 中 v-if 先执行，变量未定义直接报错，先 computed 过滤。
5. **插值表达式里调接口/写复杂逻辑**：模板只做展示，取数、过滤、拼装全部收回 `<script setup>` 里，模板里最多留一个表达式。

## 九、总结

- 模板 = 带占位符的 HTML，Vue 在浏览器里持续重渲染，这是它与 Thymeleaf 的本质区别；
- 冒号是"字符串变表达式"的开关，class/style 绑定用对象和数组；
- 事件修饰符把 stopPropagation/preventDefault 这类仪式代码从 handler 里挤回了声明里；
- v-if 惰性渲染适合低频切换，v-show 改 display 适合高频切换；
- key 是 diff 对账的身份证，永远用稳定业务 id；
- v-model = `:value` + `@input`，双向绑定是语法糖不是魔法。

这些指令的"自动更新"看起来理所当然，但**数据变化是怎么被察觉的？依赖是怎么被收集的？** 这就进入 Vue 的心脏——响应式系统，下一篇把它拆开看。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. 模板语法与常用指令（本篇）→ 3. 响应式系统（下一篇）
