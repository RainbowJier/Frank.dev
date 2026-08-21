# Vue 从零到一 · 系列写作规划

> 本文件是写作进度文档，不在 Hexo source 内，不会被发布。
> **2026-08-21 系列写作全部完成**：02–08 共 7 篇（每篇正文 + 3 张 SVG）已写完并通过构建校验，**待提交推送**；01 此前已上线。推送上线后可考虑收官联动（见文末）。

## 系列定位

面向**有后端基础（尤其 Java/Spring）的读者**，用后端概念类比讲 Vue 3.5（Composition API + `<script setup>` 为主线）。
每篇结构：blockquote 引言（适合人群 + 与前后篇衔接）→ 三到七个 `## 一、二、三` 大节 → 常见坑清单 → 总结 + 下篇预告。

## 规范速查

- 目录：`source/_posts/articles/Vue/`，文件名 `NN-kebab-case.md`，配图存同名目录，正文相对文件名引用 `![图N：描述](xxx.svg)`
- front-matter：`categories: [教程]`，tags 含 `Vue`、`前端`，description 一段话，keywords 列表，`lang: zh-CN`
- 配图：research-svg skill（NPG 学术配色，白底细线，图注"图 N｜……"），每篇 3 张左右
- 正文长度对标已有文章：240–430 行

## 文章清单与进度

### 01 组件生命周期 —— ✅ 已上线（2026-08-18）

`01-vue-component-lifecycle.md`，4 张图已就位。后续新篇需要引用它（讲挂载/卸载时机时链接）。

### 02 模板语法与常用指令 —— ✅ 已写完（2026-08-21，待推送）

`02-vue-template-directives.md`《Vue 从零到一（02）：模板语法与常用指令，把页面真正写起来》

要点：插值能放什么；v-bind 与 class/style 绑定三种姿势；v-on 与事件修饰符（对比 addEventListener）；v-if vs v-show（切换成本 vs 初始成本）；v-for 与 :key（diff 复用、index 作 key 的坑、v-if/v-for 同级优先级）；v-model 语法糖拆解与表单控件、修饰符。

配图：①v-if vs v-show 对比 ②:key 与 diff 复用 ③v-model 语法糖拆解

### 03 响应式系统 —— ✅ 已写完（2026-08-21，待推送）

`03-vue-reactivity.md`《Vue 从零到一（03）：响应式系统，数据变了视图为什么自动变》

要点：命令式 vs 声明式（jQuery 对照）；ref 与 .value；reactive 与 Proxy；ref vs reactive 选型（解构丢响应）；computed 缓存语义；watch/watchEffect（deep、immediate、清理函数）；原理三步走：拦截 → 依赖收集 → 派发更新；坑：解构丢响应、watch 隐式 deep、ref 忘 .value。

配图：①Proxy 拦截/收集/派发流程 ②ref vs reactive 对比 ③computed vs watch vs watchEffect 选型

### 04 组件通信 —— ✅ 已写完（2026-08-21，待推送）

`04-vue-component-communication.md`《Vue 从零到一（04）：组件通信全解，从 props 到插槽》

要点：组件是独立单元（类比方法调用/微服务）；props 单向数据流与 defineProps 校验；defineEmits；组件上 v-model 与 defineModel（3.4+）；provide/inject（重点类比 Spring 依赖注入）；默认/具名/作用域插槽；通信选型；坑：直接改 props、引用类型 props 的共享陷阱。引用 01（父子挂载顺序）。

配图：①通信方式全景选型 ②单向数据流 + emit 回传 ③作用域插槽数据分发

### 05 路由 Vue Router —— ✅ 已写完（2026-08-21，待推送）

`05-vue-router.md`《Vue 从零到一（05）：Vue Router，单页应用的路由该怎么管》

要点：SPA 为什么需要前端路由；hash vs history；路由表、动态路由 `:id`、嵌套路由；命名路由与编程式导航；导航守卫全景（全局/路由独享/组件内，执行顺序，类比 Spring 拦截器链）；路由懒加载与 meta 权限；坑：路由参数变化组件复用（watch $route）、滚动行为。

配图：①导航守卫执行链 ②hash vs history 对比 ③动态路由匹配示意

### 06 状态管理 Pinia —— ✅ 已写完（2026-08-21，待推送）

`06-vue-pinia.md`《Vue 从零到一（06）：Pinia，什么时候才真的需要全局状态》

要点：props 逐层传递的痛点；什么该进 store（用户会话、跨页共享），什么不该（表单临时态）；defineStore 选项式与组合式两种写法；state/getters/actions；$reset、$patch；组合式函数 vs store 边界；pinia-plugin-persistedstate 持久化；与 SSR 一句话交代。

配图：①组件树中的共享状态 ②Pinia 三件套结构 ③本地态 vs 全局态决策

### 07 前后端联调 —— ✅ 已写完（2026-08-21，待推送）

`07-vue-axios-springboot.md`《Vue 从零到一（07）：Axios 封装与 Spring Boot 联调，跨域一次讲清》

要点：fetch vs axios；实例封装（baseURL、超时）；请求/响应拦截器挂 JWT（401 统一跳登录）；Spring Boot CORS 配置与 Vite dev 代理两种方案对比（开发用代理、生产靠 nginx 反代）；统一响应体 `Result<T>` 的前端处理；坑：GET 数组参数序列化、深层 JSON 的 Content-Type。

配图：①跨域与 Vite 代理示意 ②Axios 拦截器链路 ③一次登录后的完整请求时序

### 08 工程化与部署 —— ✅ 已写完（2026-08-21，待推送，系列收官篇）

`08-vue-vite-deploy.md`《Vue 从零到一（08）：Vite 工程化与上线，从 npm run dev 到生产环境》

要点：Vite 为什么快（esbuild 预构建 + 原生 ESM，对比 Webpack 全量打包）；`.env.development/.production` 与 import.meta.env；Element Plus 按需引入；打包分析与分包（manualChunks、路由懒加载）；history 模式 404 与 nginx try_files； gzip/缓存头；系列收官：全栈视角把 01–08 串成一个接 Spring Boot 的完整前端。

配图：①Vite 开发/生产双流程 ②环境变量注入链路 ③生产部署拓扑（nginx + API 反代）

## 收官联动

08 收官时考虑：Skill-Hub 页面挂系列入口；`hexo-guide.md` 或关于页补一句系列导航。批次全部上线后更新本文件为"完结"状态。
