---
title: LangChain4j 深入理解（01）：一次对话的底层执行逻辑
date: 2026-08-17 16:00:00
categories:
  - 教程
tags:
  - LangChain4j
  - AI 应用
  - Java
description: 拆开 LangChain4j 1.13 的对话链路：消息模型、ChatModel 与流式回调、ChatMemory 两种窗口策略、AiServices 动态代理的完整执行管道。
lang: zh-CN
---

> 本文是《LangChain4j 深入理解》系列第 01 篇，基于 **1.13.0** 版本。全系列三篇：对话的底层执行（本篇）→ 工具调用 Function Calling → 从零构建 RAG。
>
> 示例取自我在国土空间平台 AI 智能客服项目里的真实用法，可对照工程实践。

## 先看全貌：三层 API

LangChain4j 的对话能力从下到上分三层，理解了分层就理解了它的设计：

| 层 | 核心类型 | 你负责什么 |
|---|---|---|
| 模型层 | `ChatModel` / `StreamingChatModel` | 组装消息列表、发请求、收响应 |
| 记忆层 | `ChatMemory` | 多轮历史怎么装、装多少、何时驱逐 |
| 编排层 | `AiServices` | 只声明"我要什么"，整条管道自动跑 |

越往上越省心，越往下越可控。下面从最底下的消息模型开始，一层层往上拆。

## 消息模型：一切的基础

对大模型来说，一次请求就是一个**有序的消息列表**。LangChain4j 用一个 `ChatMessage` 家族来表达：

![图 1：LangChain4j 的消息模型](/images/svg/langchain4j-message-model.svg)

四种角色各司其职：

- **SystemMessage**：人设与规则，置顶且不参与记忆驱逐；
- **UserMessage**：用户输入，RAG 检索的命中内容默认也注入在这里（后面第三篇细说）；
- **AiMessage**：模型的输出。它有双重身份——要么是最终回答，要么是**工具调用请求**（`toolExecutionRequests`，第二篇主角）；
- **ToolExecutionResultMessage**：工具执行结果回填，作为一条消息追加进列表，让模型"看到"结果。

请求和响应的容器分别是 `ChatRequest` 和 `ChatResponse`：前者 = 消息列表 + 模型参数（temperature、maxTokens）+ 工具声明；后者 = AiMessage + `TokenUsage`（输入/输出 token 数，计费用的）+ FinishReason。

## 模型层：同步与流式两个接口

### ChatModel：一问一答

```java
ChatModel model = OpenAiChatModel.builder()
        .baseUrl("https://api.example.com/v1")   // OpenAI 兼容协议，可指向任意中转/私有部署
        .apiKey(System.getenv("LLM_API_KEY"))
        .modelName("gpt-5.4")
        .temperature(0.7)
        .build();

ChatResponse resp = model.chat(ChatRequest.builder()
        .messages(
                SystemMessage.from("你是国土空间平台的 AI 助手"),
                UserMessage.from("生态保护红线数据怎么申请下载？"))
        .build());

System.out.println(resp.aiMessage().text());              // 回答全文
System.out.println(resp.tokenUsage().inputTokenCount());  // 输入 token 数
```

### StreamingChatModel：逐 token 推送

聊天产品要的是"打字机效果"，靠流式接口的回调实现：

```java
StreamingChatModel streamingModel = OpenAiStreamingChatModel.builder()
        /* 同样的连接配置 */ .build();

streamingModel.chat(request, new StreamingChatResponseHandler() {
    @Override
    public void onPartialResponse(String token) {           // ① 每个片段到达
        emitter.send(token);                                  //    直接推给前端
    }
    @Override
    public void onCompleteResponse(ChatResponse response) {  // ② 全部结束
        // response.aiMessage().text() 已拼好全文；tokenUsage 取用量
    }
    @Override
    public void onError(Throwable error) {                   // ③ 出错
        emitter.completeWithError(error);
    }
});
```

注意一个工程细节：回调发生在框架的 IO 线程上，`onPartialResponse` 里只做轻量转发，落库这类阻塞操作留给 `onCompleteResponse` 之后的业务线程。

## 记忆层：ChatMemory 的两种窗口

模型本身无状态，多轮对话全靠把历史消息重新塞进请求。`ChatMemory` 负责管理这个列表，两种内置窗口策略：

![图 2：两种 ChatMemory 窗口策略](/images/svg/langchain4j-chat-memory-compare.svg)

```java
// A. 按条数：最多保留 N 条消息，超出驱逐最旧
ChatMemory byCount = MessageWindowChatMemory.builder()
        .id("session-42")
        .maxMessages(20)
        .build();

// B. 按 token：Tokenizer 逐条估算，总量不超 maxTokens
ChatMemory byToken = TokenWindowChatMemory.builder()
        .id("session-42")
        .maxTokens(4000, new OpenAiTokenizer())
        .build();
```

三条使用规则值得记住：

1. **驱逐以"条"为单位**——再精确的 token 窗口也不会把一条消息劈成两半，所以 token 容量是近似值；
2. **SystemMessage 是例外**——条数超限时优先驱逐普通消息，人设被刻意保留；
3. **memoryId 隔离会话**——同一个 ChatMemory 按 id 分桶，配 `chatMemoryProvider` 就能按用户/会话各自记忆（下一节示例）。

### 实战视角：DB 是事实源，每轮请求装配

我的项目里没有让 ChatMemory 常驻：每轮对话先从数据库现查最近 6 轮（只取成功消息），预装进一个**全新的** `MessageWindowChatMemory`（容量 6×2+8，余量留给本轮和工具轮消息），请求结束即丢弃。好处是记忆与消息表一份存储、重启不丢、"重新生成"直接作用于同一份数据——框架的 ChatMemory 管单次请求内的追加，跨请求的事实源握在自己手里。

## 编排层：AiServices 声明式接口

到这里你已经能拼出一个完整的对话服务了——但每个接口都要手写模板、装载记忆、处理回调。`AiServices` 把这些固化成一条管道，你只声明接口：

```java
interface Assistant {
    @SystemMessage("你是国土空间平台的 AI 助手，回答准确简洁")
    @UserMessage("{{question}}")
    String chat(@V("question") String question, @MemoryId String sessionId);
}

Assistant assistant = AiServices.builder(Assistant.class)
        .chatModel(model)                                        // 返回 String → 同步调用
        .chatMemoryProvider(id -> MessageWindowChatMemory.builder()
                .id(id).maxMessages(20).build())                 // 按 @MemoryId 分桶
        .build();

String answer = assistant.chat("生态保护红线数据怎么申请下载？", "session-42");
```

背后是一个 **JDK 动态代理**拦截你的方法调用，把它翻译成一条完整的执行管道：

![图 3：AiServices 一次调用的执行管道](/images/svg/langchain4j-aiservices-pipeline.svg)

逐段拆开这条管道：

1. **模板解析**：`{{question}}` 占位符用 `@V` 参数填充，`@SystemMessage` 渲染成 SystemMessage；
2. **检索增强**（可选）：配置了 `contentRetriever` 时，先检索知识库、命中内容注入用户消息——没配置整段跳过（第三篇展开）；
3. **记忆装载**：按 `@MemoryId` 从 ChatMemory 取历史，拼在 system 之后；
4. **调用模型**：**方法返回类型决定走同步还是流式**——`String`/POJO 用 `chatModel`，`TokenStream` 用 `streamingChatModel`；
5. **工具循环**（可选）：模型请求调用工具时自动执行、回填、再调（第二篇展开）；
6. **记忆回写**：AI 回答（和工具中间消息）追加回 ChatMemory，下轮可用；
7. **结果转换**：返回 `String` 拿文本；返回 **POJO 时框架自动生成 JSON Schema 做"结构化输出"**，模型被迫按结构回答、框架反序列化成对象——这是 AiServices 被低估的能力。

### 流式接口的声明

把返回类型换成 `TokenStream`，回调式消费：

```java
interface StreamAssistant {
    @SystemMessage("你是国土空间平台的 AI 助手")
    @UserMessage("{{q}}")
    TokenStream chat(@V("q") String q, @MemoryId String sessionId);
}

TokenStream ts = assistant.chat("红线数据怎么申请？", "session-42");
ts.onPartialResponse(token -> emitter.send(token))     // 推给前端
  .onCompleteResponse(resp -> saveMessage(resp))       // 落库 + 用量
  .onError(err -> log.warn("生成失败", err))
  .start();                                            // 别忘了 start() 才真正发起
```

`TokenStream` 上还有两个与后两篇相关的钩子：`onRetrieved`（RAG 命中回调，可做引用溯源）和 `beforeToolExecution` / `onToolExecuted`（工具执行前后回调，可做前端"正在调用工具"提示）。

## 小结

- 一次请求 = 有序消息列表；`AiMessage` 身兼"回答"与"工具请求"两职；
- `ChatModel` 同步、`StreamingChatModel` 流式回调；token 用量从 `TokenUsage` 取；
- `ChatMemory` 两种窗口：按条数精确可控，按 token 省成本但近似；SystemMessage 不驱逐；
- `AiServices` 是动态代理驱动的管道：模板 → RAG → 记忆 → 模型 → 工具 → 回写 → 转换；返回类型决定同步/流式，POJO 返回值自动结构化输出；
- 工程上可以让 ChatMemory 只管"单请求生命周期"，跨请求事实源放数据库。

下一篇拆管道里最有意思的一段：**工具调用**——模型怎么"请求"执行你的代码，框架怎么驱动这个循环。

> 系列目录：1. 对话的底层执行（本篇）→ 2. [工具调用 Function Calling](/2026/08/17/articles/AI/02-langchain4j-tool-calling/) → 3. [从零构建 RAG](/2026/08/17/articles/AI/03-langchain4j-rag/)
