---
title: Vue 从零到一（插读番外）：脚手架生成了什么——前端项目结构与配置逐个讲清
date: 2026-08-21 10:50:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - 工程化
  - 项目结构
description: 插读番外（建议位于主线 07 与 08 之间）：把 create-vue 脚手架生成的工程摊开讲透——index.html/main.ts/App.vue 的启动接力赛、src 各目录的职责边界、public 与 assets 两套静态资源通道的差别、package.json 与 scripts 字段逐个过、tsconfig/ESLint/.env 等根目录配置文件在编码期/dev/生产三个阶段的分工。面向 Java 后端同学，全程用 Spring Initializr 与 Maven 类比对齐。
keywords:
  - Vue 项目结构
  - create-vue 脚手架
  - vite.config
  - package.json
  - 前端工程化
lang: zh-CN
---

> **适合人群**：脚手架一把梭生成了项目，却没勇气逐个打开根目录里十来个配置文件的同学。
> **阅读位置**：本篇是插读番外，建议放在[第 07 篇联调](/2026/08/21/articles/Vue/07-vue-axios-springboot/)之后、[第 08 篇 Vite 上线](/2026/08/21/articles/Vue/08-vue-vite-deploy/)之前——先把房子的户型图看懂，再去看水电怎么装。此后读[构建工具全景](/2026/08/27/articles/Vue/09-vue-build-tools-ecosystem/)与[包管理器](/2026/08/27/articles/Vue/10-package-managers-npm-pnpm/)两篇番外也会顺很多。

---

## 一、项目是哪来的：脚手架就是前端的 Spring Initializr

Java 同学对这个场景毫不陌生：打开 start.spring.io，勾选 Web、Lombok、MyBatis，点 Generate，得到一个能直接跑的工程骨架。前端的对应物叫**脚手架（scaffolding）**，Vue 官方的版本是一条命令：

```bash
pnpm create vue@latest
# 或 npm init vue@latest —— 实际执行的是官方生成器 create-vue
```

交互式问答几个问题（要不要 TypeScript？装不装 Router 和 Pinia？挂不挂 ESLint？），回车结束就得到一个开箱即用的工程。它的本质和 Spring Initializr 一模一样：

![图1：脚手架的生成流程——交互式选型映射为依赖清单与预置目录](scaffold-create-flow.svg)

**模板仓库 + 渲染器**。create-vue 内部维护着一套带条件开关的项目模板，你的每个选择决定哪些依赖写进 package.json、哪些目录被创建出来。所以脚手架生成的结构不是某个人的怪癖，而是 Vue 官方持续维护的**社区共识**——这也正是值得花一篇把它读懂的理由：换个公司、换个项目，这套骨架基本不变。

## 二、一张图看懂标准目录

以勾选了 TS + Router + Pinia 的典型产物为例，整个工程长这样：

```text
my-vue-app/
├─ node_modules/        # 依赖本体，pnpm/npm 写入（永不进 git）
├─ public/              # 不走编译的静态资源：favicon、robots.txt，原样拷贝进产物
├─ src/
│  ├─ assets/           # 要走构建管线的静态资源：图片字体会被压缩、改名加 hash
│  ├─ components/       # 可复用组件（按钮、卡片这类会被多处引用的 UI 单元）
│  ├─ views/            # 页面级组件，一个路由对应一个 view
│  ├─ router/index.ts   # 路由表：URL 与 views 的映射关系
│  ├─ stores/           # Pinia 全局状态，一个领域一个文件
│  ├─ composables/      # 组合式函数 useXxx()，跨组件的逻辑复用
│  ├─ App.vue           # 根组件：<RouterView> 在这里撑起整个页面区
│  └─ main.ts           # 应用入口：创建 app 实例、安装插件、挂载到 DOM
├─ index.html           # 整个应用唯一的 HTML 文件，Vite 的真正入口
├─ package.json         # 依赖清单 + 任务脚本（scripts）
├─ vite.config.ts       # 构建配置：插件、代理、打包策略
└─ tsconfig*.json 等    # 类型检查与编辑器的一族配置
```

![图2：create-vue 生成的标准目录职责图——自上而下正是启动与组织的层次](src-directory-map.svg)

这份结构有两个最容易踩坑的理解点，单独强调：

**① public/ 与 src/assets/ 是两条通道**。public 里的文件构建时被**原样复制**，路径写死（如 `/favicon.ico`），不被压缩不改名；assets 里的文件会被构建管线处理——小图转 base64、大图压缩改名加内容 hash。判断口诀很简单：**需要 URL 固定不变的放 public，其余一律走 assets 让管线优化**。CSS 里 import 的图片想享受 hash 缓存，就必须放在 assets。

**② views/ 与 components/ 的分界是"复用性"而非大小**。只被路由渲染一次的页面进 views；被两个以上地方引用的才升格进 components。反过来让 components 塞满一次性页面代码，是这个目录腐化的第一步。

至于 utils/ 与 api/ 这类目录，脚手架默认并不生成——它们是团队约定俗成的扩展位，几乎所有真实项目都会补上（接口封装见[第 07 篇](/2026/08/21/articles/Vue/07-vue-axios-springboot/)的 axios 实例章节）。

## 三、启动接力赛：index.html → main.ts → App.vue

传统多页时代每个 URL 对应一个 HTML；SPA 之后整个应用只剩**一个 index.html**，而且它从 Webpack 时代的 dist 产物位置搬回了项目根目录——因为 Vite 直接拿它当 dev server 的入口去解析。

```html
<!-- index.html（节选） -->
<body>
  <div id="app"></div>
  <script type="module" src="/src/main.ts"></script>
</body>
```

浏览器打开 `localhost:5173` 时拿到这个文件，顺着 `type="module"` 的声明继续拉取 main.ts，于是接力开始：

```ts
// src/main.ts —— 职责上就是 SpringBoot 应用的 main 方法
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

createApp(App)
  .use(router)          // 安装路由插件
  .use(createPinia())   // 安装状态管理
  .mount('#app')        // 挂载：用组件树替换 id=app 的 DOM
```

![图3：从输入网址到首屏渲染——入口三文件的接力流程](app-startup-chain.svg)

对照后端一眼就懂：**main.ts 是 SpringBoot 的 main 方法**——先组装好各个 Bean（router、pinia），最后一行 run()；**App.vue 是唯一的 RootConfiguration 类**，`<RouterView>` 标签相当于给所有路由页面预留的容器洞。装配完成后，浏览器地址栏怎么变，都是 router 在替你换视图，index.html 永远只有这一份。

## 四、package.json：前端的 pom.xml

这是根目录唯一必须逐字段搞懂的文件，挑关键的讲：

```jsonc
{
  "name": "my-vue-app",
  "private": true,
  "type": "module",                    // 以 ESM 规范解析 .js 文件
  "scripts": {
    "dev": "vite",                     // 启动开发服务器
    "build": "run-p type-check \"build-only {@}\"",  // 并行：类型检查 + 打包
    "preview": "vite preview",         // 本地预览生产产物
    "type-check": "vue-tsc --build"
  },
  "dependencies": {                    // 运行时依赖：打进产物（compile scope）
    "vue": "^3.5.0",
    "vue-router": "^4.5.0",
    "pinia": "^3.0.0"
  },
  "devDependencies": {                 // 构建期工具：只在开发机用（provided/test scope）
    "vite": "^6.0.0",
    "@vitejs/plugin-vue": "^5.2.0",
    "typescript": "^5.6.0"
  }
}
```

- **dependencies vs devDependencies**：前者等价 Maven 的 compile scope，会进最终产物；后者等价 provided/test，只在构建与开发期存在。Vite、TypeScript 属于后者——用户的浏览器不需要它们；
- **scripts**：`npm run xxx` 的任务入口，本质是 shell 别名。看到教程说"跑一下 build"，指的就是这里定义的名字；
- **`^` 版本号**：`^3.5.0` 表示锁大版本、接受 3.x 的小更新。真正钉死版本的是旁边的 **pnpm-lock.yaml 锁文件**（Maven 世界对应 pom.xml 里的 `<dependencyManagement>` 定版）——**锁文件必须提交 git**，否则同事和你装出的依赖树可能完全不同，这正是[包管理器那篇番外](/2026/08/27/articles/Vue/10-package-managers-npm-pnpm/)的核心议题；
- **node_modules/ 永远不进 git**：lockfile 已经完整描述了依赖树，任何人一条 `pnpm install` 就能精确重建它。

## 五、根目录配置文件盘点：谁在哪个阶段起作用

脚手架生成的十来个"户口本"文件各自负责一段生命周期，放到三个阶段里看就不乱了：

![图4：同一批配置文件在编码期、开发期、生产期的分工地图](config-files-scope.svg)

**vite.config.ts —— 最值得精读的一个**。它是主线的构建剧本，默认长这样：

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: { '@': '/src' },            // @ 指向 src，import 时免写相对路径
  },
  server: {
    proxy: { '/api': 'http://localhost:8080' },  // 联调代理，07 篇的主角之一
  },
})
```

[第 08 篇](/2026/08/21/articles/Vue/08-vue-vite-deploy/)的环境变量、分包优化都会回到这个文件，那里细讲；本篇只需记住它的定位：**开发期代理、编译期注入、打包期策略，三件事都在这办**。

**tsconfig.json 族**：TypeScript 的规则手册——严格模式开不开、编译目标浏览器、以及 `paths` 里 `@/*` 的映射声明（和上面 vite.config 的 alias 必须**成对出现**：前者管编辑器的跳转提示，后者管运行时解析）。新版脚手架会把它们拆成 tsconfig.app / tsconfig.node 多份继承文件，看到别慌，规则主体仍在根部那份。

**eslint.config.js + .prettierrc**：质量与格式分属两套系统——ESLint 管代码好坏（未使用变量、 hooks 误用），Prettier 只管长相（缩进引号换行）。混为一谈是老项目的经典病灶，如今扁平化的 eslint.config.js 已把两者职责切干净。`.vscode/extensions.json` 则把推荐插件固化下来，新人 clone 完编辑器会主动提示安装，团队环境从此一致。

**env.d.ts / .d.ts 族**：类型世界的"声明补丁"。比如告诉 TS"`import.meta.env.VITE_XXX` 这个东西存在"——文件名随模板版本略有差异，职能不变：**管住编辑器的红波浪线，不影响任何运行时行为**。

## 六、目录会长歪吗：约定的扩展位

真实项目只需要在脚手架之上增补两块共识，就能长期保持整洁：

- **api/ 层**：按后端领域建文件（user.ts、order.ts），统一从 07 篇封装的 axios 实例发请求。组件里永远不直接出现裸 fetch/url 字符串；
- **composables/**：超过一个组件要用的有状态逻辑（防抖搜索、表格分页）抽成 useXxx 函数。它与 stores/ 的边界一句话：**逻辑复用找 composable，数据共享找 store**（第 06 篇详述过的取舍）。

再往后若有多环境部署诉求，该动的是 vite.config 与 .env 家族（08 篇主场）；若多仓库公共代码沉淀，该上的是 monorepo workspace（包管理器篇末尾点到）。结构这条线到此就闭环了——**你会发现此后所有的演进都不必推翻脚手架给的形状，只是在预留的插槽里继续填充**。

## 七、高频坑清单

1. **该放 assets 的图丢进了 public**：发布后发现图片既没 hash 也没压缩，CDN 缓存更新失灵——固定 URL 的刚需才有资格进 public，其余交给管线。
2. **Windows 上跑得好好的，CI 上找不到文件**：Linux 区分大小写而 Windows 不区分。`Header.vue` 被 import 成 `header.vue` 本地无恙、流水线当场爆炸——组件文件坚持 PascalCase、import 路径照抄实际大小写。
3. **alias 只配了一半**：只在 vite.config 加了 `@`，忘了同步 tsconfig 的 paths（或反之）。症状是"编辑器里一片红但能跑"或"编辑器正常一跑就报 404 解析失败"——两个文件永远成对修改。
4. **把 lockfile 塞进了 .gitignore**：每位同事 install 出不同版本组合，"我这能复现"成了口头禅。锁文件必须入库，升级依赖用命令而不是手改 json。
5. **components/ 变垃圾场**：任何页面私有组件也往里塞，半年后没人敢删里面任何文件。守住一条线：views 放一次性的，components 只收真正的公共件。

## 八、总结

- 脚手架 = 前端界的 Spring Initializr：选型即生成，产出的是官方维护的社区共识结构；
- 启动是一条接力赛：index.html 声明 module 入口 → main.ts 装配插件并 mount → App.vue 长出整棵组件树；
- 两套静态资源通道别混淆：public 原样拷贝保 URL，assets 走管线吃优化；
- package.json 是前端的 pom.xml：双依赖清单分清 compile 与 provided，锁文件入库、node_modules 出库；
- 十来个根目录配置各管一段：tsconfig/eslint 服务编码期，vite.config 主宰 dev 与 build，.d.ts 补声明——按阶段归位就不再眼花；
- 结构演进靠扩展位而不是推倒重来：api 层收口请求，composables 收口逻辑，更深的变化交给后续篇章里的构建配置。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. [响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/) → 4. [组件通信](/2026/08/21/articles/Vue/04-vue-component-communication/) → 5. [Vue Router](/2026/08/21/articles/Vue/05-vue-router/) → 6. [Pinia](/2026/08/21/articles/Vue/06-vue-pinia/) → 7. [Axios 联调](/2026/08/21/articles/Vue/07-vue-axios-springboot/) → **插读·脚手架项目结构（本篇，在此处插入主线阅读）** → 8. [Vite 工程化与上线](/2026/08/21/articles/Vue/08-vue-vite-deploy/)（完结）｜番外：[前端构建工具全景](/2026/08/27/articles/Vue/09-vue-build-tools-ecosystem/) · [npm/Yarn/pnpm 包管理器](/2026/08/27/articles/Vue/10-package-managers-npm-pnpm/)
