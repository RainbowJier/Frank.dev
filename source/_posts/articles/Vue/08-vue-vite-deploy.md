---
title: Vue 从零到一（08）：Vite 工程化与上线，从 npm run dev 到生产环境
date: 2026-08-21 11:00:00
categories:
  - 教程
tags:
  - Vue
  - 前端
  - Vite
  - 部署
description: 系列收官篇：Vite 为什么比 Webpack 快（esbuild 预构建 + 原生 ESM）、环境变量按 .env 文件分环境注入（对照 Spring 的 profile）、Element Plus 按需引入、打包分析与 manualChunks 分包，最后给出解决 history 路由 404 与生产跨域的完整 nginx 配置，并把全系列八篇串成一张全栈地图。
keywords:
  - Vite 原理
  - 环境变量
  - 打包优化
  - nginx 部署
  - 前端上线
lang: zh-CN
---

> **适合人群**：本地 `npm run dev` 一切正常，一到 `build` 部署就 404、白屏、跨域三连的同学。
> 本篇基于 Vite 6。这是系列收官——[上一篇](/2026/08/21/articles/Vue/07-vue-axios-springboot/)把接口调通了，这篇把整个前端**变成静态文件送上生产环境**，并回收前几篇埋的两颗雷（history 路由 404、生产跨域）。

---

## 一、Vite 为什么快：开发与生产是两台机器

先破除一个误解：Vite 的"快"主要发生在**开发期**，而且原理和 Webpack 有本质分野。

Webpack 开发模式的流程是：启动时把整个项目**打包成 bundle** 再起服务——项目越大，冷启动越慢。Vite 反过来：**开发期根本不打包**。

![图1：Vite 的双流程——开发期按需编译原生 ESM，生产期 Rollup 全量打包](vue-vite-dual-flow.svg)

- **开发期**：浏览器直接向 dev server 请求源码模块，Vite **按需编译**当前页面用到的文件；第三方依赖（node_modules 里的 vue、axios）用 esbuild 预构建成浏览器友好的 ESM 并缓存。esbuild 是 Go 写的打包器，比 JS 写的工具快一个数量级。
- **生产期**：仍然用 Rollup 做完整的 tree-shaking、压缩、分包——因为原生 ESM 的按需加载在网络上是大量零碎请求，生产环境必须要 bundle。

这带来一个必须记住的工程结论：**dev 和 prod 走的是两条代码路径，dev 正常不代表 build 正常**。上线前永远跑一次 `vite build && vite preview` 在本地模拟生产产物，这是排白屏问题最便宜的手段。

## 二、环境变量：前端的 profile 机制

Spring 用 `application-dev.yml` / `application-prod.yml` 区分环境，Vite 的对应物是根目录的 `.env` 文件族：

```bash
# .env.development —— npm run dev 时生效
VITE_API_BASE=/api
VITE_APP_TITLE=Frank 管理后台（开发）

# .env.production —— npm run build 时生效
VITE_API_BASE=/api
VITE_APP_TITLE=Frank 管理后台
```

![图2：环境变量注入链路——按模式选取 .env 文件，编译期注入 import.meta.env](vue-vite-env-chain.svg)

读取方式：

```js
// 只有 VITE_ 前缀的变量才会暴露给前端代码
const apiBase = import.meta.env.VITE_API_BASE
const isDev = import.meta.env.DEV
```

三条纪律：

1. **没有 `VITE_` 前缀的变量不会暴露**——这是刻意的安全设计；
2. 但反过来说，**带 `VITE_` 的变量会原样打进产物**，任何人打开浏览器 devtools 都能看到。前端没有真正的秘密，密钥类的东西必须留在后端（这个站自己的 AI 阅读助手走 GitHub Secret + Actions 注入，就是同一个原则）；
3. 模式（mode）与命令绑定：`vite` 是 development，`vite build` 是 production，自定义 mode 用 `--mode staging` 配 `.env.staging`。

## 三、组件库按需引入：别为几个组件背上全家桶

以 Element Plus 为例，全量引入会把整个组件库塞进 bundle（数百 KB 起）。按需引入靠两个 unplugin 插件，一次配置全局受益：

```js
// vite.config.js
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

export default {
  plugins: [
    AutoImport({ resolvers: [ElementPlusResolver()] }),
    Components({ resolvers: [ElementPlusResolver()] }),
  ],
}
```

效果：模板里写 `<el-table>`，构建时只有 table 组件及其样式进入产物——**用啥进啥，不用白不用**。语义上又是一处后端老朋友：这叫按需装配，和 Spring 在 classpath 上按依赖自动装配starter 是一个思路的两种表达。

## 四、打包分析与分包

先看再优化，不猜：

```js
// vite.config.js
import { visualizer } from 'rollup-plugin-visualizer'

export default {
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vue: ['vue', 'vue-router', 'pinia'],   // 框架全家桶单独分包
          echarts: ['echarts'],                   // 大体量库单独分包
        },
      },
    },
  },
  plugins: [visualizer({ open: true })],          // build 后自动打开体积报告
}
```

分包的收益逻辑：业务代码天天变，框架代码万年不变——**拆开后，业务 chunk 的 hash 变了，框架 chunk 的 hash 不变，用户缓存就能续命**。配合[第五篇](/2026/08/21/articles/Vue/05-vue-router/)的路由懒加载（每个页面一个 chunk），首屏只下载登录页需要的资源。

三条经验：

1. 先跑 visualizer 再动手，通常一两个意外的大依赖（误引入 moment 全量 + locale、图标库整包引入）就能解释 80% 的体积问题；
2. `manualChunks` 别切太碎，几十 KB 的 chunk 反而增加请求开销；
3. 产物文件名带 hash（Vite 默认如此），这是缓存策略的前提，别手贱关掉。

## 五、上线：一份解决所有问题的 nginx 配置

`pnpm build` 产出 `dist/` 目录——一堆带 hash 的静态文件。把它交给 nginx，同时回收前几篇埋的两颗雷：

- [第五篇](/2026/08/21/articles/Vue/05-vue-router/)的雷：history 模式下用户刷新 `/orders/42`，nginx 找不到该路径的文件返回 404；
- [第七篇](/2026/08/21/articles/Vue/07-vue-axios-springboot/)的雷：生产环境如果前端和后端不同域，跨域又回来了。

![图3：生产部署拓扑——nginx 统一入口：静态文件、history 兜底、API 反向代理](vue-vite-deploy-topology.svg)

```nginx
server {
    listen 80;
    server_name admin.example.com;

    # 前端静态资源：带 hash 的文件，一年长缓存
    location /assets/ {
        root /var/www/dist;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }

    # history 路由兜底：找不到的路径一律回 index.html，交给前端路由
    location / {
        root /var/www/dist;
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache";    # index.html 永远不缓存，保证发版即生效
    }

    # API 反向代理：生产同源，跨域问题从根上消失
    location /api/ {
        proxy_pass http://127.0.0.1:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # 顺手开压缩，JS/CSS 体积再砍七成
    gzip on;
    gzip_types text/css application/javascript application/json;
}
```

四个配置点各管一件事：

1. **`try_files $uri $uri/ /index.html`**：找得到文件给文件，找不到回 index.html——前端路由接管路径，404 雷拆除；
2. **`/api/` 反代到 Spring Boot**：浏览器眼里所有请求都同源（都打向 nginx），CORS 雷拆除，后端一行 CORS 配置都省了；
3. **缓存双标**：`/assets/` 里的文件名带 hash，内容变名字变，敢缓存一年；`index.html` 是入口，永远 `no-cache`，否则发版后用户还在跑旧壳子引用已删除的旧资源，白屏；
4. **gzip**：一行配置换 70% 传输量，没有理由不开。

部署动作就三步：`pnpm build` → 把 `dist/` 传到 `/var/www/dist` → `nginx -s reload`。要自动化，GitHub Actions 里同样三步（本站的 Hexo 就是这么发布的），前端后端可以各一个 workflow。

## 六、系列收官：把八篇串成一张地图

回头看，这个系列其实造了一栋完整的房子：

- **砖瓦**（02 模板与指令、03 响应式）：声明式渲染的地基，数据驱动视图；
- **房间**（01 生命周期、04 组件通信）：组件是独立单元，靠 props/emit/插槽协作，钩子是它在时间轴上的接缝；
- **走廊**（05 Vue Router）：URL 组织页面，守卫链是前端的拦截器体系；
- **水电**（06 Pinia）：全局状态仓库，登录态这类跨页数据的中枢；
- **门窗**（07 Axios 联调）：拦截器封装 + 跨域解法，和你的 Spring Boot 接上头；
- **交付**（08 本篇）：构建、分包、nginx，从代码变成线上系统。

对一个 Java 出身的工程师，最值得带走的一条主线是：**Vue 里到处都是后端的老概念换了个壳**——依赖收集是自动注册的观察者，导航守卫是拦截器链，Pinia 是带响应式的 Service 单例，`try_files` 兜底和 CORS 预检说到底都是"让边界两边的世界达成协议"。前端不比后端神秘，只是边界不同。

## 七、高频坑清单

1. **dev 正常 build 白屏**：先 `vite preview` 复现，再开浏览器控制台看 404 的资源路径——多半是 `base` 没配（部署在子路径 `/app/` 下时需要 `base: '/app/'`）。
2. **发版后老用户白屏**：`index.html` 被缓存，引用的旧 hash 资源已被新版本替换删除——把入口文件的缓存策略改成 `no-cache`。
3. **生产 sourcemap 泄露源码**：`build.sourcemap` 默认关闭，别为了排查线上问题随手打开后忘记关；要排查用错误上报 + 本地复现。
4. **`import.meta.env` 写进运行时判断做逻辑分支**：环境变量是编译期注入，分支在构建时就固化了——这是特性（摇树优化）也是陷阱（两套行为）。
5. **大依赖整包引入**：moment 全量 + 全语言包、图标库 `import * as`——先跑 visualizer，体积问题基本一抓一个准。

## 八、总结

- Vite 开发期不打包（esbuild 预构建 + 原生 ESM 按需编译），生产期 Rollup 全量打包，两条路径决定了"上线必须先 preview"；
- `.env.{mode}` 是前端的 profile 机制，`VITE_` 前缀才暴露、暴露即公开，密钥留在后端；
- unplugin 按需引入组件库，visualizer 先看再切包，缓存续命靠 hash 不变；
- 一份 nginx 同时解决 history 404（try_files）与生产跨域（反代），缓存双标 + gzip 是标配；
- 八篇合起来：模板响应式打底，组件与通信立墙，路由状态通水电，联调构建到交付。

系列完结。接下来想继续深入的话，三个自然的方向：TypeScript 全覆盖（后端同学的上风位）、Nuxt/SSR（SEO 场景）、或者干脆回头把这八篇的知识落到一个真实项目上——比如给这个博客做一个 Vue 版的管理后台。

> 系列目录：1. [组件生命周期](/2026/08/18/articles/Vue/01-vue-component-lifecycle/) → 2. [模板语法与常用指令](/2026/08/21/articles/Vue/02-vue-template-directives/) → 3. [响应式系统](/2026/08/21/articles/Vue/03-vue-reactivity/) → 4. [组件通信](/2026/08/21/articles/Vue/04-vue-component-communication/) → 5. [Vue Router](/2026/08/21/articles/Vue/05-vue-router/) → 6. [Pinia](/2026/08/21/articles/Vue/06-vue-pinia/) → 7. [Axios 联调](/2026/08/21/articles/Vue/07-vue-axios-springboot/) → 插读·[脚手架生成的项目结构与配置](/2026/08/21/articles/Vue/07b-vue-scaffold-project-structure/) → 8. Vite 工程化与上线（本篇·完结）
