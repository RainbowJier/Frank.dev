---
title: 福建国土空间基础信息平台-AI 智能客服助手
date: 2026-08-17 11:00:00
categories:
  - 项目经历
tags:
  - Java
  - LangChain4j
  - SSE
  - RAG
  - AI 应用
period: 2026.06 - 至今
role: 后端开发（兼前端）
stack:
  - Spring Boot
  - LangChain4j
  - PostgreSQL + pgvector
  - MyBatis-Plus
  - Vue 3
description: 平台的 AI 智能客服子域：基于 LangChain4j 的 SSE 多轮流式对话、智能体与提示词管理、RAG 知识库与 Function Calling 工具调用，按 DDD 分层独立成服务。
---

## 项目背景

国土空间基础信息平台模块多、专业性强，业务人员在日常使用中经常遇到"这个功能在哪""这份数据怎么申请""报错是什么意思"之类的问题，传统的人工客服和静态 FAQ 都撑不住。这个子项目就是给平台补一个 AI 智能客服助手：用户在聊天界面提问，助手基于平台使用知识流式作答，后续还能通过工具调用直接查平台数据。

技术选型上是 **LangChain4j + OpenAI 兼容协议**：模型侧保持可替换（配置里换 base-url / model 即可），向量侧用本地 ONNX 推理的 `bge-small-zh-v15`（512 维，中文优化），不依赖外部向量服务。整个 AI 能力独立成一个服务，按 DDD 分层组织，与平台的微服务体系（Nacos、Sa-Token、Feign）预留了接回点。

## 我的职责

这个模块从零到一由我独立负责：

- 后端整个 AI 服务：DDD 七模块工程搭建、SSE 多轮流式对话全链路、会话管理、智能体与提示词管理、RAG 知识库（摄入管道 + 检索增强接入对话）、Function Calling 工具框架、用量统计；
- 前端聊天工作台（Vue 3 + Element Plus）：SSE 流式解析、Markdown 流式渲染、会话侧栏、智能体与知识库管理页；
- 输出多轮对话、智能体管理、知识库 RAG 三份功能设计文档（任务拆解到每一层每一个接口）。

## 总体架构

服务按 DDD 拆成七个 Maven 模块，依赖方向单向：adapter → application → domain ← infrastructure。最核心的约束是**领域层零框架依赖**——`LlmRequest`、`LlmTokenHandler`、`ToolCallDispatcher` 这些技术中立的模型和接口全部住在 domain，LangChain4j 只出现在 infrastructure 的网关实现里，application 编排的是自己的接口而不是别人的 SDK。这一条让"换模型供应商""换向量库"都收敛成 infrastructure 内部的改动：

![图 1：AI 客服助手 DDD 分层架构](/images/svg/ai-assistant-architecture.svg)

几个关键的架构决策：

- **先手工后声明式，边界不变**：第一版为了对消息组装、工具循环、事件推送有完全控制，自己拼 `SystemMessage → 历史 → 输入`、手写 Function Calling 回填循环；接入 RAG 时发现"记忆装载、工具回填、检索注入"三件事在手写代码里越缠越紧，于是把引擎层切到 LangChain4j **AiServices 声明式编排**——`ChatAssistant` 声明式接口（`@SystemMessage`/`@UserMessage` 模板 + TokenStream），记忆、工具、ContentRetriever 统一装配。因为 application 层只认 domain 的接口，这次重构只发生在 infrastructure 的一个实现类里，domain 只加了三个请求字段和一个回调；
- **流式/同步双模型按需缓存**：对话走流式模型，标题生成等一次性同步场景独立缓存一个同步模型（`OpenAiChatModel`，双重检查锁懒加载），不再把流式接口桥接成同步调用；
- **会话与智能体解耦**：会话只存 `agent_id`，中途换绑智能体就是换人格，历史消息保持不变。

## 一次流式对话的生命周期

对话接口是整个服务的核心。Controller 返回 `SseEmitter`，用 `CompletableFuture.runAsync` 把阻塞的流式调用甩到异步线程，请求线程立刻释放：

```java
@PostMapping(path = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
public SseEmitter stream(@RequestBody @Validated ChatStreamReq req) {
    Long userId = 1L; // TODO: Sa-Token 接入后替换
    SseEmitter emitter = new SseEmitter(aiProperties.getChat().getSseTimeout());
    setupEmitterCleanup(emitter, req.sessionId(), "stream");

    // 异步执行（避免阻塞 Tomcat 请求线程）
    CompletableFuture.runAsync(() -> {
        try {
            chatService.stream(req, userId, emitter);
        } catch (Exception e) {
            emitter.completeWithError(e);
        }
    });
    return emitter;
}
```

SSE 超时设 300 秒，必须大于网关 120 秒的路由超时，否则网关先掐断连接，前端收到的是断流而不是业务结果。事件协议只有四种：`token`（文本片段）、`tool`（工具调用通知）、`done`（含 messageId 与 token 用量）、`error`——前后端各有一份对齐的枚举。

完整链路如下：

![图 2：一次流式对话的完整时序](/images/svg/ai-assistant-sse-sequence.svg)

编排层（ChatService）的顺序刻意设计过：

1. **先落库 user 消息**（status=success），再预存一条 **assistant 占位消息**（content 为空，status=sending）——拿到 messageId 后，流式过程中的任何状态变化都是"回写"而不是"插入"，前端也从第一帧起就有稳定的消息身份；
2. 消息状态机是 `sending → success / failed / interrupted`，**历史上下文只取 success**——失败和被中断的轮次不进记忆，避免污染后续对话；
3. `onComplete` 回调里回写全文与 token 用量，算耗时落一条 `ai_usage_record`，推 `done` 事件（含 messageId、token 用量与 RAG 命中溯源）；第二轮对话（messageCount ≤ 2）时顺手异步生成一个不超过 12 字的会话标题——生成指令就声明在引擎层 `TitleAssistant` 的 `@UserMessage` 模板上，用户不用面对一排"新对话"。

## 对话记忆：DB 是事实源，每轮请求装配 ChatMemory

记忆没有做成常驻内存的会话状态，而是**每轮请求从数据库现查、临时装配**。第一步按状态过滤取最近 6 轮：

```java
wrapper.eq(AiMessage::getSessionId, sessionId)
       .in(AiMessage::getRole, "user", "assistant")
       .eq(AiMessage::getStatus, "success")   // 失败/中断的轮次不进上下文
       .orderByDesc(AiMessage::getCreateTime)
       .last("LIMIT " + (maxRounds * 2));     // 1 轮 = user + assistant 两条
Collections.reverse(list);                    // 倒序取回后再反成正序
```

第二步把这批历史预装进引擎层的 `MessageWindowChatMemory`：每轮请求一个全新实例（随机 memoryId），容量设为 `轮数 × 2 + 8`——额外的 8 条余量留给本轮消息和工具调用轮的中间消息；system 角色刻意不进记忆，人设每次由 `@SystemMessage` 模板注入，保证不被历史稀释。

这个结构的好处：记忆与消息表天然一份存储，服务重启不丢上下文，"重新生成"直接作用于同一份数据；引擎只在单次请求的生命周期内管理追加消息，请求结束即丢弃，不存在跨请求的内存态需要维护。单条输入超 4000 字在入口截断（请求对象上还有 `@Size(max = 4000)` 双保险）。

## 停止与重新生成

**停止**是流式对话里最容易被做错的细节。回调线程无法真正中断 LLM 的流，所以是"协作式取消"：`ChatStreamRegistry` 用两个 `ConcurrentHashMap` 维护 sessionId → emitter / stopped 标记，`tryRegister` 靠 `putIfAbsent` 做会话级互斥（同一会话同时只有一路生成）；用户点停止时**只置标记、不摘注册**——刻意保留，让还在飞的 `onComplete` 能读到 stopped 状态，把消息体面地落库为 `interrupted`，而不是丢成一条永远 sending 的僵尸消息。已到的后续 token 在 `onToken` 里被标记短路丢弃。这个注册表目前是单实例内存态，多副本部署时升级为 Redis 是预留动作。

**重新生成**的语义是"从这条 assistant 消息开始重来"：找到它前面最近一条 user 消息，把 createTime 之后的消息（含自身）全部逻辑删除，再用原输入重走流式链路——不新落 user 消息，所以历史不会膨胀出重复提问。

## Function Calling：循环交给引擎，自己只管"翻译"

智能体的 `toolIds` 字段存 JSON 数组（如 `["ops_get_user","resources_list_file"]`），对话时解析成工具清单。工具目录是代码里维护的注册表（名称 + 自然语言参数说明 + 所属模块），分发靠 Spring 注入的 `Map<String, ToolInvokeExecutor>`——key 就是 bean name，`模块名 + "ToolExecutor"`，新增一个模块的工具只需要加一个实现类。

引擎层切到 AiServices 后，原先手写的调用循环整个消失，替换成"装配式"绑定：把 domain 的工具定义翻译成 `ToolSpecification → ToolExecutor` 映射，执行时委托回 domain 的 `ToolCallDispatcher`，轮数上限交给引擎参数，回调逐个翻译给前端：

```java
AiServices<ChatAssistant> builder = AiServices.builder(ChatAssistant.class)
        .streamingChatModel(chatModelFactory.getStreamingChatModel())
        .chatMemory(buildChatMemory(request))                 // 预装 DB 历史
        .tools(buildToolExecutors(request.getTools(), dispatcher))
        .maxSequentialToolsInvocations(MAX_TOOL_ROUNDS);      // 5 轮上限，防失控
ContentRetriever retriever = buildContentRetriever(request);  // 智能体绑定了知识库才启用
if (retriever != null) {
    builder.contentRetriever(retriever);
}
TokenStream stream = builder.build().chat(systemPrompt, userInput);

stream.onPartialResponse(token -> handler.onToken(token))
        .onRetrieved(contents -> handler.onRetrieved(toRagHits(contents)))
        .beforeToolExecution(before -> handler.onToolCall(
                before.request().name(), parseArguments(before.request().arguments())))
        .onCompleteResponse(response -> handler.onComplete(
                fullContent.toString(), inputTokens(response), outputTokens(response)))
        .onError(handler::onError)
        .start();
```

![图 3：AiServices 装配与回调翻译](/images/svg/ai-assistant-tool-loop.svg)

防御性设计保留了下来：工具执行异常不抛出，而是转成 `{"error": ...}` JSON 回填给模型，让它自己决定怎么向用户解释；每次工具调用经 `beforeToolExecution` 实时推给前端，界面上渲染成胶囊，用户能看到助手"正在查什么"。

## RAG 知识库

知识库是三张业务表（`ai_knowledge_base` / `ai_document` / `ai_document_segment`）加一张向量表（`ai_embedding`，pgvector）。摄入与检索两条管道均已上线：

![图 4：知识库 RAG 摄入与检索管道](/images/svg/ai-assistant-rag-pipeline.svg)

上传侧同步做三件事：白名单校验（pdf / doc / docx，≤20MB）、文件落盘（UUID 重命名）、登记 `ai_document`（pending）并原子累加知识库文档数，然后立刻返回 docId。重活全部丢给独立的异步 Bean 解析：

```java
@Async
public void parse(AiDocument doc, int chunkSize, int chunkOverlap) {
    try {
        // pending → parsing
        String text = extractText(doc);          // PDFBox / POI 按类型选解析器
        List<String> chunks = splitText(text, chunkSize, chunkOverlap);
        // 分段落库（雪花 ID 回填），再批量向量化入库
        segmentGateway.saveBatch(segments);
        embeddingGateway.addAll(segments);       // bge-small 512 维，本地 ONNX 推理
        // success + segment_count / vector_count 统计
    } catch (Exception e) {
        // failed，fail_reason 截断 500 字，前端可手动重新解析
    }
}
```

切分是按字符的滑动窗口，chunk_size 默认 500、overlap 默认 50，每个知识库独立配置（`@Min/@Max` 校验）。step 有个防死循环的小心思：

```java
int step = Math.max(1, chunkSize - chunkOverlap);   // 防 overlap >= chunkSize 时步长归零
for (int start = 0; start < len; start += step) {
    int end = Math.min(start + chunkSize, len);
    chunks.add(text.substring(start, end));
    if (end >= len) break;
}
```

向量入库时每个分段带四元组 metadata（knowledgeBaseId / documentId / segmentId / chunkIndex）——这是检索过滤和级联删除的依据。pgvector 侧建的是 `VECTOR(512)` + HNSW 余弦索引（m=16, ef_construction=64），外加两个 jsonb 表达式索引支撑按知识库/文档维度清理。删除与重新解析时用 `GREATEST(0, vector_count - N)` 防统计负数，解析失败不自动重试（避免重复写向量），把"重新解析"留给用户手动触发。

**检索已接入对话链路**。编排层解析智能体的 `knowledgeBaseIds`（如 `[1,2]`）与 `ragConfig`（topK、similarityThreshold）——配置解析失败就降级为不启用，不让一次配置笔误打断对话——然后随 `LlmRequest` 传给引擎层构造检索器：

```java
var builder = EmbeddingStoreContentRetriever.builder()
        .embeddingStore(embeddingStore)
        .embeddingModel(embeddingModel)
        .maxResults(request.getRagTopK() != null ? request.getRagTopK() : DEFAULT_RAG_TOP_K)  // 默认 4
        .filter(metadataKey("knowledgeBaseId")
                .isIn(kbIds.stream().map(String::valueOf).collect(toList())));
if (request.getRagMinScore() != null) {
    builder.minScore(request.getRagMinScore());   // 相似度阈值，可选
}
```

摄入时写进向量的四元组 metadata 在这里兑现：`isIn(knowledgeBaseId)` 把检索范围锁死在智能体绑定的知识库内。命中的段落由引擎自动**注入用户消息**——而不是拼进 system prompt，人设保持纯净，检索内容随轮次滚动——同时经 `onRetrieved` 回调翻译成 domain 的 `RagHit`（segmentId / documentId / knowledgeBaseId / score），完成时序列化落库到消息的 `referencedDocs` 字段做溯源，用量记录里的 `ragHit` 计数也从写死 0 变成真实命中数。

**现状与边界**：向量存储当前仍跑在 InMemory 占位实现上（重启丢向量），等内网 Nexus 放行 pgvector 依赖后一键切换——网关接口层零改动，这是分层带来的直接红利；工具执行器也还是占位实现，待平台侧接口开放后接入真实 Feign 调用。

## 前端：把 SSE 和流式渲染做稳

前端没有用 EventSource——它发不了 POST body 和自定义 header，所以用 `fetch + ReadableStream` 手写解析。SSE 事件以空行分隔，而网络分块不保证对齐事件边界，半包处理是正确性的关键：

```js
buffer += decoder.decode(value, { stream: true })
const parts = buffer.split('\n\n')   // SSE 事件以空行分隔
buffer = parts.pop() || ''           // 最后一段可能是半包，留在 buffer
parts.forEach(dispatch)              // 完整事件逐个分发：token / tool / done / error
```

另一个兜底：流关闭但没收到 `done` 事件（网关提前掐断、服务异常）时强制触发 `onDone`，否则前端会永久卡在 streaming 态、输入框锁死。停止按钮则先 `AbortController.abort()` 立即断掉本地读取（不等服务端确认，避免停止期间 token 还在涌入），再调 `/chat/stop` 让后端落库中断状态。

流式 Markdown 渲染踩过一次真实的性能坑：最初每来一个 token 就全量 `marked + highlight.js + DOMPurify` 重渲染整个消息，内容一长就是 O(n²)，页面直接卡死。重构后做了三级节流：rAF 内按内容长度分级限频（<1000 字 80ms / 1000–3000 字 120ms / >3000 字 200ms），超过 2000 字符切到不带代码高亮的轻量渲染，流式结束后再全量高亮一次。另外 marked-highlight 与自定义 renderer 的双重转义问题（插件会把高亮 HTML 写回 `token.text` 并置 `token.escaped`）也在 renderer 里按 token 状态分流解决。会话快速切换的竞态用自增请求序号丢弃过期响应，防止旧会话的消息晚到覆盖新会话。

## 踩过的坑

- **`@Async` 自调用失效**：解析逻辑最初写在 Service 内部方法上，`this.parse()` 绕过了代理，异步注解形同虚设。拆成独立的 `DocumentParseExecutor` Bean 后才真正异步——这也是"文档解析独立成支撑组件"的直接原因；
- **SSE 半包**：本地开发一切正常（分块恰好对齐），联调环境 token 一多就出现"事件丢失"。根因是没处理跨 chunk 的半包，`split('\n\n')` 后把尾段留在 buffer 才修好；
- **停止不是中断**：最早版本的 stop 直接 `remove()` 注册表并 complete emitter，结果 `onComplete` 读不到停止状态，被中断的消息落库成了 success。改成"只置标记、收尾时再清理"后，interrupted 语义才完整；
- **流式渲染的性能悬崖**：如上一节所述，全量重渲染在长回复下必然卡死，分级节流 + 轻量渲染双管齐下后，3000 字以上的回复也能稳定 60fps；
- **向量统计防负数**：并发删除与重新解析会让 `vector_count` 出现减成负数的窗口，`GREATEST(0, ...)` 兜底加唯一约束才稳；
- **手写编排的维护成本**：第一版手工拼消息、手写工具循环时一切可控；接 RAG 时发现同一个方法里要同时改记忆装载、工具回填、检索注入三处逻辑，改动面开始失控。切到 AiServices 后这些纠缠收敛到引擎内部，infrastructure 一个类消化了全部变化——为控制力手写的代码，在需求长大后要重新估值。

## 成果与展望

- 从零交付 AI 客服服务：SSE 流式对话（含停止、重新生成、自动标题）、会话管理（置顶/归档/重命名/级联删除）、智能体与提示词管理（默认智能体、用户可选范围）、知识库摄入与 RAG 检索增强（上传/异步解析/向量化/检索注入/referencedDocs 溯源）共 20+ 个接口；
- 前端聊天工作台独立成型：流式 Markdown 渲染、工具调用胶囊、会话侧栏、管理页面，配套一套自建的 MindMarket 设计系统（token 化、Stylelint 约束）；
- 工程上的沉淀可复用：SSE 事件协议（token/tool/done/error）、协作式取消注册表、声明式 AiServices 装配（记忆/工具/RAG 一处组装、回调翻译回 domain）、向量网关抽象（存储可替换）；
- 进行中：pgvector 持久化切换、工具执行器对接平台真实接口（Feign + Nacos）、Sa-Token 鉴权替换开发期的 mock 上下文、多副本部署下的停止注册表改造（Redis）。
