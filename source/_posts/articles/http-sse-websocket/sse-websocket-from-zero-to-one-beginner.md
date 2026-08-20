---
title: SSE / WebSocket 从零到一（初级篇）：实时通信快速入门
date: 2026-08-17 14:00:00
categories:
  - 教程
tags:
  - SSE
  - WebSocket
  - Node.js
  - 实时通信
description: 用 Node.js 和原生 HTML 从零理解短轮询、SSE 与 WebSocket，完成两个可运行的实时通信小项目。
keywords:
  - SSE 入门
  - WebSocket 入门
  - Node.js 实时通信
  - Server-Sent Events
lang: zh-CN
---

> 本文写给完全没接触过实时通信的你。只要会一点 HTML 和 JavaScript、电脑上装了 Node.js 18 以上版本，就能跟着做。所有命令在 Windows PowerShell、Git Bash 或 macOS / Linux 终端里都能直接执行。

## 一、什么是"实时通信"？先看一个等外卖的例子

平时我们打开网页，流程是这样的：浏览器问服务器一次，服务器答一次，然后这次"对话"就结束了。你想知道有没有新内容？只能再问一次。

这就像等外卖时**每隔 5 分钟下一次楼**，看看外卖放门口了没。大部分时候你白跑一趟，但外卖真到的时候，你也最多晚知道 5 分钟。

**实时通信**，就是想办法让"外卖一到，你立刻知道"，不用反复下楼。聊天消息、订单状态、股价行情，都是这个需求。

### 1. 四种方案：一步步进化

- **短轮询**：就是上面说的"每 5 分钟下一次楼"。浏览器每隔几秒问一次服务器"有新消息吗？"。写起来最简单，但大部分请求是白问的。
- **长轮询**：改进版——你问"有新消息吗？"，服务器说"**你先别挂电话，等有了我马上告诉你**"。这样你不用反复问了，但每次收到消息后，还得重新问一次。
- **SSE**：服务器直接开"广播"。浏览器只需要订阅一次，之后服务器有新消息就主动发过来。像收音机：电台一直播，你只管听。
- **WebSocket**：打电话。浏览器和服务器先"拨号接通"，之后两边想说什么就说什么，还能同时说。

流程图文字描述：**定时下楼问 → 问一次然后原地等 → 订阅广播只管听 → 拨通电话随便聊**。每一代都在减少"白跑的次数"，或者增加"能说话的人"。

![图1：实时通信技术从轮询到双向连接的演进](realtime-communication-evolution.svg)

短轮询长这样，一行 `setInterval` 就能写出来：

```js
// 浏览器每 3 秒问一次服务器：有新通知吗？
setInterval(async () => {
  const response = await fetch('/api/notifications'); // 发一次普通的 HTTP 请求
  const notifications = await response.json();        // 拿到本次结果
  renderNotifications(notifications);                 // 渲染到页面上
}, 3000);
```

它的缺点也很明显：哪怕 3 秒里什么都没发生，这个请求也照发不误。用户一多，服务器就被"问烦了"。所以要做真正的消息推送，我们通常会选 SSE 或 WebSocket——也就是下面两个实战。

### 常见踩坑提醒

- 轮询间隔不是越短越好。1 秒一次，1000 个在线用户就是每秒 1000 次请求，很容易把服务器问垮。
- 长轮询记得设置超时时间（比如 30 秒没消息就先放客户端回去），否则网络异常时会堆出一堆没人认领的请求。
- 先想清楚业务要多"实时"：股票行情要秒级，"订单已发货"的通知晚 10 秒完全没关系。要求不同，方案不同。

## 二、SSE 实战：做一个"服务器广播站"

### 1. 原理：一个故意"不写完"的 HTTP 响应

SSE 没有发明新协议，它还是一个 HTTP 响应，只是服务器**故意一直不结束**：

- 浏览器执行 `new EventSource('/events')`，发一个普通的 GET 请求，相当于"我要订阅这个频道"；
- 服务器回复几个特殊的响应头，意思是"接下来我发的都是事件流，你先别断开"；
- 然后服务器就可以往这条连接里一段一段地"写字"，每写一段，浏览器就收到一段。

服务器每次写的"便签"长这样：

```text
event: metric          ← 消息类型，相当于便签的标题
data: {"value":42}     ← 消息内容
id: 101                ← 消息编号（断线重连时有用）
retry: 3000            ← 断线后 3 秒再重连

（上面这个空行不是失误，它表示"这条便签写完了"）
```

两个对新手最友好的点：

1. **断线自动重连是浏览器免费送的**。网络闪断后 `EventSource` 会自己重新连，你一行重连代码都不用写。
2. 服务器想发二进制不行，但发**文本和 JSON 绰绰有余**，而通知、日志、进度条信息本来就是文本。

流程图文字描述：**浏览器订阅（GET）→ 服务器回"事件流"响应头 → 响应一直保持打开 → 服务器每写一段，浏览器收到一段 → 万一断线，浏览器自动重连**。

![图2：SSE 从建立连接到自动重连的事件流](sse-event-flow.svg)

### 2. 动手做：每 2 秒收到一条服务器推送

#### 第一步：创建项目并安装依赖

```bash
mkdir sse-demo      # 建一个项目文件夹
cd sse-demo         # 进入文件夹
pnpm init           # 生成 package.json
pnpm add express    # 安装 express（一个最常用的 Node.js 网页框架）
mkdir public        # 建一个放网页的文件夹
```

装完后 `package.json` 大致如下（依赖版本号可能略有不同，不用管）：

```json
{
  "name": "sse-demo",
  "version": "1.0.0",
  "private": true,
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^5.1.0" }
}
```

#### 第二步：编写服务端 `server.js`（项目根目录下新建）

```js
const express = require('express');

const app = express();
const clients = new Map(); // “花名册”：记下所有还没断开的浏览器
let nextClientId = 1;      // 给每个连接发个编号，方便打日志

// 让 public 文件夹里的 index.html 能被浏览器访问到
app.use(express.static('public'));

// 浏览器请求 /events 时进入这个函数，相当于“办理订阅”
app.get('/events', (req, res) => {
  const clientId = nextClientId++;

  // 这三个响应头是 SSE 的“暗号”：接下来是事件流，别缓存、别断开
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders(); // 先把响应头发出去，浏览器马上知道“订阅成功”

  // 封装一个发消息的函数：event 是标题，data 是内容
  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`); // 结尾两个换行，一条消息才算完
  };

  clients.set(clientId, { res, send });   // 登记进花名册
  send('connected', { clientId, message: 'SSE 连接已建立' });

  // 浏览器关页面或断网时会触发 close，把它从花名册删掉
  // 不删的话，断开的连接会一直占着内存
  req.on('close', () => {
    clients.delete(clientId);
    console.log(`客户端 ${clientId} 已断开，当前连接数：${clients.size}`);
  });
});

// 每 2 秒给花名册里所有人广播一条模拟数据（比如想象成服务器监控指标）
setInterval(() => {
  const payload = { time: new Date().toLocaleTimeString(), value: Math.floor(Math.random() * 100) };
  for (const client of clients.values()) client.send('metric', payload);
}, 2000);

// 每 15 秒发一条“心跳”（以冒号开头的注释，浏览器不显示）
// 作用是告诉路上的代理服务器：这条连接还活着，别掐断
setInterval(() => {
  for (const client of clients.values()) client.res.write(': heartbeat\n\n');
}, 15000);

app.listen(3000, () => console.log('SSE demo 已启动: http://localhost:3000'));
```

#### 第三步：编写前端 `public/index.html`

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>SSE 入门演示</title></head>
<body>
  <h1>SSE 实时指标</h1>
  <p id="status">正在连接……</p>
  <ul id="logs"></ul>
  <script>
    // 抓取页面上的元素，方便后面往里写内容
    const status = document.querySelector('#status');
    const logs = document.querySelector('#logs');
    const addLog = (text) => {
      const item = document.createElement('li');
      item.textContent = text;
      logs.prepend(item); // 新消息插到最上面
    };

    // 关键就这一行：EventSource 是浏览器内置的 SSE 客户端
    // 执行它 = 向 /events 发起订阅
    const source = new EventSource('/events');

    source.onopen = () => { status.textContent = '连接已打开'; };
    source.onerror = () => { status.textContent = '连接中断，浏览器正在自动重连……'; };

    // addEventListener 里的名字，必须和服务端 event: 后面的名字一致
    source.addEventListener('connected', (event) => {
      addLog(JSON.parse(event.data).message); // data 是字符串，要先转成对象
    });
    source.addEventListener('metric', (event) => {
      const data = JSON.parse(event.data);
      addLog(`时间：${data.time}，随机指标：${data.value}`);
    });
  </script>
</body>
</html>
```

#### 第四步：启动，看看会发生什么

```bash
pnpm start
```

打开 <http://localhost:3000>，**每 2 秒页面顶部就会蹦出一条新记录**，而你没有写任何 `setInterval` 轮询——是服务器主动推给你的。

按 F12 打开开发者工具 → Network（网络）标签 → 点击 `/events` 这个请求，你会发现它一直处于"进行中"状态，收到的数据量在慢慢变大。这就是"故意不结束的 HTTP 响应"。你还可以做个实验：按 Ctrl+C 停掉服务器，页面会显示"连接中断"；重新 `pnpm start`，不用刷新页面，消息会自己继续蹦出来——这就是浏览器自动重连。

### 常见踩坑提醒

- **最经典的坑**：消息结尾少写了两个换行 `\n\n`。少写一个换行，浏览器就认为"这条还没写完"，于是永远不触发回调，页面一条消息都收不到，也不报错。
- 页面经过 Nginx 等代理时，消息可能被"攒着一起发"（代理默认会缓冲响应）。生产环境通常要加 `X-Accel-Buffering: no` 这类配置，并把读取超时调长。
- SSE 是**单向**的，只能服务器→浏览器。浏览器想提交数据，另外用普通的 `fetch` 就行，别在 SSE 里硬憋。
- 想发图片之类的二进制数据？SSE 不擅长（要转成文本编码，体积变大），这种需求直接看下一节 WebSocket。

## 三、WebSocket 实战：做一个"聊天室"

### 1. 原理：先拨号（握手），再聊天

WebSocket 前一秒还是 HTTP，后一秒就不是了。整个过程像打电话：

**第一步，浏览器"拨号"**——发一个普通 HTTP 请求，但带了几个特殊的请求头，意思是"我想升级成 WebSocket，行不行？"：

```http
GET /chat HTTP/1.1
Upgrade: websocket              ← “我想换成 websocket 协议”
Connection: Upgrade             ← “这是一次协议升级请求”
Sec-WebSocket-Key: 随机字符串    ← 用来核验身份的一串随机字符
Sec-WebSocket-Version: 13       ← 协议版本，如今都用 13
```

**第二步，服务器"接电话"**——回一句 `101`：

```http
HTTP/1.1 101 Switching Protocols   ← 101 的意思是“可以，现在切换协议”
Upgrade: websocket
Connection: Upgrade
Sec-WebSocket-Accept: 根据 Key 算出的校验值
```

新手常见误会：**101 不是错误码**！平时见惯了 200、404、500，看到 1xx 会慌。恰恰相反，收到 101 就代表"电话接通了"。

**第三步，开始聊天**——从这一刻起，这条连接上跑的不再是 HTTP 的一问一答，而是 WebSocket 消息。两边都能随时发、同时发（这就是术语"全双工"的意思：像打电话，两边可以同时说话），还能发二进制数据（图片、文件都行）。

流程图文字描述：**浏览器发起带 Upgrade 的请求 → 服务器校验 Key 并回复 101 → 协议切换完成 → 双方随时互发消息**。

![图3：WebSocket HTTP 握手与全双工消息流](websocket-handshake-flow.svg)

### 2. 动手做：一个能群聊的聊天室

#### 第一步：创建项目并安装依赖

```bash
mkdir websocket-demo     # 建项目文件夹
cd websocket-demo
pnpm init
pnpm add express ws      # ws 是 Node.js 最常用的 WebSocket 库
mkdir public
```

```json
{
  "name": "websocket-demo",
  "version": "1.0.0",
  "private": true,
  "scripts": { "start": "node server.js" },
  "dependencies": { "express": "^5.1.0", "ws": "^8.18.0" }
}
```

#### 第二步：编写服务端 `server.js`

```js
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const app = express();
app.use(express.static('public')); // 照旧：让 public 里的网页能被访问

// 用 Node 内置模块创建 HTTP 服务器
// 网页和聊天功能共用 3001 一个端口，互不打架
const server = http.createServer(app);

// 在这个服务器上再“挂”一个 WebSocket 服务，地址是 /chat
const wss = new WebSocketServer({ server, path: '/chat' });

// 有浏览器“拨号”接通时，触发 connection
wss.on('connection', (socket, request) => {
  const ip = request.socket.remoteAddress;
  console.log(`有人进来了：${ip}`);
  socket.send(JSON.stringify({ type: 'system', text: '欢迎进入聊天室' }));

  // 有人发消息时，转发给聊天室里的所有人（包括发送者自己）
  socket.on('message', (buffer) => {
    const message = JSON.stringify({
      type: 'chat',
      text: buffer.toString(), // 收到的原始数据是 Buffer，先转成字符串
      at: new Date().toLocaleTimeString(),
    });
    for (const client of wss.clients) {
      if (client.readyState === 1) client.send(message); // 1 = 接通状态，才能发
    }
  });

  socket.on('close', () => console.log(`有人离开了：${ip}`));
  socket.on('error', (error) => console.error('WebSocket 出错了：', error.message));
});

server.listen(3001, () => console.log('WebSocket demo 已启动: http://localhost:3001'));
```

#### 第三步：编写前端 `public/index.html`

```html
<!doctype html>
<html lang="zh-CN">
<head><meta charset="UTF-8"><title>WebSocket 入门演示</title></head>
<body>
  <h1>WebSocket 聊天室</h1>
  <p id="status">正在连接……</p>
  <input id="message" placeholder="输入消息">
  <button id="send">发送</button>
  <button id="close">关闭连接</button>
  <ul id="logs"></ul>
  <script>
    const status = document.querySelector('#status');
    const input = document.querySelector('#message');
    const logs = document.querySelector('#logs');
    const addLog = (text) => {
      const item = document.createElement('li');
      item.textContent = text;
      logs.append(item); // 聊天记录往下面追加
    };

    // 关键一行：new WebSocket = 开始拨号
    // 注意协议名是 ws://（网页是 http 时用它；网页是 https 时要用 wss://）
    const socket = new WebSocket(`ws://${location.host}/chat`);

    socket.onopen = () => { status.textContent = '连接已打开'; };
    socket.onmessage = (event) => {
      const data = JSON.parse(event.data); // 服务端发来的是 JSON 字符串
      addLog(`[${data.at || '系统'}] ${data.text}`);
    };
    socket.onclose = () => { status.textContent = '连接已关闭'; };
    socket.onerror = () => { status.textContent = '连接发生错误'; };

    // 点“发送”：先确认电话是接通状态，再把输入框的内容发出去
    document.querySelector('#send').onclick = () => {
      if (socket.readyState !== WebSocket.OPEN || !input.value.trim()) return;
      socket.send(input.value.trim());
      input.value = '';
    };
    document.querySelector('#close').onclick = () => socket.close(); // 主动挂电话
  </script>
</body>
</html>
```

#### 第四步：启动，两个标签页聊天

```bash
pnpm start
```

打开**两个**浏览器标签页，都访问 <http://localhost:3001>。在左边标签页输入"你好"点发送——右边标签页**立刻**也出现"你好"。因为服务器把这条消息广播给了聊天室里的所有人。按 F12 → Network → 筛选 WS，还能亲眼看到那条 `/chat` 连接和每一条收发的消息帧。

点"关闭连接"会主动挂断；刷新页面就重新拨号。终端窗口里能同步看到"有人进来了 / 有人离开了"的日志。

### 常见踩坑提醒

- 网页地址是 `https://` 开头时，必须连 `wss://`（加密版 WebSocket）。连 `ws://` 会被浏览器当"混合内容"直接拦截，这是上线后最常见的问题。
- `socket.send()` 前先检查 `readyState === WebSocket.OPEN`。电话还没接通就说话，会直接报错。
- 经过 Nginx 等反向代理时，必须配置转发 `Upgrade` 和 `Connection` 两个请求头，否则握手永远失败，页面一直卡在"正在连接"。
- 服务端收到 `close` 要及时清理。只广播不清理，掉线的人会一直占着内存。

## 四、SSE 和 WebSocket 到底选哪个？

| 对比维度 | SSE | WebSocket |
| --- | --- | --- |
| 通俗理解 | 收音机：只管听 | 打电话：两边随便聊 |
| 底层协议 | 还是 HTTP，只是响应不结束 | 先 HTTP 握手升级，之后走 WebSocket 帧 |
| 通信方向 | 只能服务器 → 浏览器 | 双向，两边随时发 |
| 能发什么 | 文本 / JSON | 文本、JSON、图片等二进制都行 |
| 断线重连 | 浏览器自动重连（白送的） | 要自己写重连逻辑 |
| 上手难度 | 低，和写普通接口差不多 | 稍高，要处理握手、状态、重连 |
| 典型场景 | 通知、日志、进度条、股价 | 聊天、游戏、协同编辑 |
| 选择口诀 | "我只是想听服务器说" | "我要和服务器来回聊" |

一句话总结：**页面只需要"听"服务器更新，选 SSE**——代码少、自动重连白送；**用户要和服务器"互动"，选 WebSocket**——比如聊天室里每个人都能发言。

### 常见踩坑提醒

- 别为了"显得高级"一律用 WebSocket。单向推送的需求用 SSE，部署和排错都省事得多。
- WebSocket ≠ 消息队列。用户掉线期间的消息它不会帮你存，重要消息要落库，用户重连后再补发。
- SSE 的自动重连只保证"连接恢复"，不保证"消息不丢"。要求可靠时，要用 `id` 编号配合服务端存档，重连后从断点继续发。

## 五、小结

用四句大白话记住这四种技术：

- **短轮询**：每隔几秒下楼看一次外卖；
- **长轮询**：问一次，站在楼下等到外卖来了再回去；
- **SSE**：订阅电台广播，只管听；
- **WebSocket**：和服务器打电话，两边随便聊。

下一步建议：先把本文两个 Demo 跑起来，打开 F12 的 Network 面板亲眼看看那条"永远不结束"的请求和那次 `101` 握手；然后再去研究进阶话题——SSE 断线后从 `Last-Event-ID` 续传、WebSocket 的指数退避重连、连接鉴权，以及多台服务器时用 Redis 转发广播。
