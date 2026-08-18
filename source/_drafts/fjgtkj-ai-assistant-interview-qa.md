---
title: AI 智能客服助手 · 面试问答总结
date: 2026-08-17 15:00:00
tags:
  - 面试准备
  - LangChain4j
  - RAG
description: 福建国土空间基础信息平台 AI 智能客服助手项目的面试问答梳理：SSE 流式、多轮记忆、Function Calling、RAG、DDD 分层与踩坑复盘。
---

# AI 智能客服助手 · 面试问答总结

> 材料：对应简历项目「福建省国土空间基础信息平台 - AI 智能客服助手」（2026.06 - 至今）。
> 用法：每题答案按"要点"组织，面试时按 30~60 秒口述展开；【追问】是面试官常见的下钻点。

## 0. 项目介绍（必背）

**30 秒版本**：

> 这是国土空间基础信息平台里的 AI 智能客服子域，我独立负责从零到一：后端用 Spring Boot + LangChain4j 按 DDD 分了七个模块，核心是多轮流式对话——SSE 推 token、可停止可重新生成；智能体可以绑定系统提示词、工具和知识库，知识库走 RAG：文档异步解析、滑动窗口切分、本地模型向量化，检索命中后注入提示词并落库溯源；前端 Vue 3 聊天工作台也是我做的，包括流式 Markdown 渲染的性能优化。

**2 分钟版本**（在 30 秒版基础上展开三个技术点）：

1. **流式链路**：Controller 返回 SseEmitter，CompletableFuture.runAsync 把阻塞调用甩到异步线程，自定义四种事件协议 token/tool/done/error；消息先落库占位再流式回写，状态机 sending → success/failed/interrupted；
2. **RAG 双管道**：摄入（上传白名单校验 → @Async 解析 PDF/Word → 滑窗切分 500/50 → bge-small 本地向量化 → 带 metadata 四元组入库）+ 检索（智能体绑定的知识库范围过滤 → Top-K 余弦检索 → 命中注入用户消息 → RagHit 溯源落库）；
3. **架构演进**：引擎层第一版是手工拼消息 + 手写工具循环，接 RAG 时切到 LangChain4j AiServices 声明式编排；因为 application 层只依赖 domain 接口，整个重构只动了 infrastructure 一个类。

**可报数字**：20+ 个接口、DDD 7 个 Maven 模块、记忆 6 轮、输入上限 4000 字、SSE 超时 300s（> 网关 120s）、工具循环上限 5 轮、RAG topK 默认 4、切分 500/重叠 50、向量 512 维、上传限 20MB。

---

## 一、项目总览与选型

### Q1 为什么做这个项目？业务价值是什么？

- 平台模块多、专业性强（自然资源领域），业务人员高频遇到"功能在哪、数据怎么申请、报错什么意思"的问题，人工客服和静态 FAQ 撑不住；
- AI 助手基于平台使用知识作答（RAG），后续通过 Function Calling 直接查平台数据，把"问答"升级成"办事"；
- 我的价值：独立把整个 AI 子域从零做成——不只是调 API，而是会话、智能体、知识库、工具、用量统计的完整工程体系。

### Q2 为什么选 LangChain4j，而不是 Spring AI 或自己封装？

- LangChain4j 对 Java 生态更友好，AiServices 声明式接口、ChatMemory、ContentRetriever、ToolExecutor 这些抽象正好覆盖我要的"记忆 + 工具 + RAG"三件事；
- Spring AI 当时在项目启动期还不够稳定（团队也考虑过），而且我们走 OpenAI 兼容协议，LangChain4j 的模型无关性足够；
- 关键点：**我没有让框架泄漏到领域层**——application 只认自建的 LlmGateway/LlmRequest/LlmTokenHandler 接口，LangChain4j 只出现在 infrastructure。所以"换框架"理论上也只是重写一个实现类。这句话是加分项，主动说。

### Q3 【追问】你说不依赖框架，那为什么还用 LangChain4j？

- 不重复造轮子的边界：消息协议、重试、流式解析这些"体力活"交给框架；**编排、状态、事件推送这些业务语义**握在自己手里；
- 事实证明有用：引擎层从手写编排切到 AiServices 时，domain 只加了三个请求字段和一个回调，上层零感知。

---

## 二、SSE 流式链路

### Q4 为什么用 SSE 而不是 WebSocket？

- 对话是"一问一答 + 服务端单向流"：请求带 body（POST JSON），响应是 token 流——SSE 半双工正好匹配，WebSocket 的双向能力用不上还要付出协议升级、心跳、状态管理的成本；
- SSE 走纯 HTTP，过网关、过 Nginx 配置简单（只需打开流式响应支持），WebSocket 在企业内网网关经常被掐；
- 【追问】为什么不用长轮询？token 级推送用轮询延迟和空转都不可接受。

### Q5 SseEmitter 怎么用的？怎么不阻塞 Tomcat？

- Controller `new SseEmitter(300_000)` 立即返回，`CompletableFuture.runAsync` 把整段阻塞的流式生成甩到异步线程，请求线程即刻释放；
- 超时 300 秒是刻意大于网关 120 秒路由超时的——否则网关先断，用户看到的是断流而不是业务结果；
- emitter 上挂了清理回调（onCompletion/onTimeout），超时或客户端断开时从注册表摘除、标记停止。

### Q6 SSE 事件协议怎么设计的？

- 四种事件，前后端枚举对齐：`token`（文本片段）、`tool`（工具调用通知，含参数）、`done`（messageId、token 用量、引用溯源，前端重新生成要用 messageId）、`error`（纯文本）；
- 设计原则：**流上只推"增量"，结果性数据（用量、溯源）全部收敛在 done 一帧**，前端收到 done 才把消息从 streaming 态转正式态。

### Q7 前端为什么不用 EventSource，怎么解析的？

- EventSource 只能 GET、不能带自定义 header（我们的 token header 和 POST body 都需要），所以用 `fetch + ReadableStream + TextDecoder` 手写解析；
- 核心正确性问题是**半包**：网络分块不保证对齐事件边界。解法：按 `\n\n` 切分事件，最后一段可能是半包，留在 buffer 等下一个 chunk 拼接；
- 兜底：流关闭但没收到 done（网关提前掐断）时强制触发 onDone，否则前端会永久卡在 streaming 态、输入框锁死。

### Q8 用户点击"停止"，技术上发生了什么？

- **协作式取消**：回调线程无法真正中断 LLM 的流，所以用 `ChatStreamRegistry`（两个 ConcurrentHashMap：sessionId → emitter / stopped 标记）；
- `tryRegister` 用 `putIfAbsent` 做会话级互斥——同一会话同时只有一路生成，重复提交直接推 error 事件；
- stop 时**只置 stopped 标记、不摘注册**：让还在飞的 onComplete 读到停止状态，把消息体面落库为 interrupted；已到的后续 token 在 onToken 里短路丢弃；
- 前端先 AbortController.abort() 立即断本地读取（不等服务端确认），再调 /chat/stop 让后端落库，UI 标"已中断"。

### Q9 【追问】这个方案有什么局限？

- 注册表是单实例内存态，多副本部署时互斥和停止都会失效——升级路径是 Redis：互斥用 SETNX，停止标记用 pub/sub 或按 sessionId 的路由；
- 这是已知的、标注在代码注释里的技术债，不是没意识到。

### Q10 重新生成怎么实现的？

- 语义是"从这条 assistant 消息重来"：找到目标消息前面最近一条 user 消息（createTime 倒序 LIMIT 1），把它之后的全部消息（含目标自身）逻辑删除（removeAfter），再用原输入重走流式链路；
- 不新落 user 消息，历史不会膨胀重复提问；前端复用原消息对象原地重写，done 后更新为新 messageId。

---

## 三、多轮对话与记忆

### Q11 多轮记忆怎么实现的？

- **DB 是事实源，每轮请求临时装配**：先从 ai_message 按条件查最近 6 轮（`role in (user,assistant) and status = success`，LIMIT 12 倒序再 reverse），再预装进引擎层的 `MessageWindowChatMemory`（每请求新实例，容量 = 轮数×2+8，多出的 8 条余量留给本轮和工具轮消息）；
- system 角色刻意不进记忆——人设每次由 @SystemMessage 模板注入，不被历史稀释；
- 好处：记忆与消息一份存储，重启不丢，重新生成直接作用同一份数据；引擎只在请求生命周期内管理追加，无跨请求内存态。

### Q12 【追问】为什么不用框架的常驻 ChatMemory / Redis 会话记忆？

- 客服场景量级下每轮一次索引查询成本可忽略，换来的是**单一事实源**和"历史可编辑重放"的能力；
- 常驻 memory 还要解决失效、淘汰、多副本一致三个问题，收益配不上复杂度；如果以后量大，加一层"会话热记忆缓存"即可，接口不变。

### Q13 为什么历史只取 success？

- failed/interrupted 的轮次内容不完整或错误，进上下文会污染后续回答；且这天然实现了"失败重试不留脏历史"；
- 用户侧感知一致：历史列表能看到中断消息（查询不过滤），但模型上下文里没有。

### Q14 上下文长度怎么控制？

- 单条输入入口双保险：`@Size(max=4000)` + 服务层截断；
- 历史按轮数窗口（6 轮）硬截断，配合引擎 memory 的 maxMessages 双重限制；
- 【追问】为什么不定长 token 截断？中文场景字符数够用且零成本，token 计数要过 tokenizer，精度收益小。

---

## 四、Function Calling 与 AiServices 重构

### Q15 工具调用整体怎么设计的？

- **目录 + 分发 + 绑定**三层：
  - 目录：ToolRegistry 代码级注册表（code、自然语言参数说明、所属模块），如 ops_get_user、resources_list_file 等 4 个；
  - 分发：Spring 注入的 `Map<String, ToolInvokeExecutor>`（key = bean name = 模块名 + "ToolExecutor"），domain 只定义 ToolCallDispatcher 接口；
  - 绑定：引擎层把 domain 工具定义翻译成 `ToolSpecification → ToolExecutor`，执行时委托回 dispatcher，循环轮数上限 `maxSequentialToolsInvocations(5)`；
- 智能体的 toolIds（JSON 数组）决定哪些工具可用——工具是"按智能体授权"的。

### Q16 工具执行失败怎么办？

- 不抛异常：catch 后转 `{"error": "..."}` JSON 回填给模型，让模型自己决定怎么向用户解释——比如"该数据暂时查不到"；
- 抛异常会中断整次生成，用户等待 30 秒收到一个错误，体验远差于模型体面收尾。

### Q17 为什么要限制 5 轮？

- 防模型"套娃"：极端情况下模型可能反复调用工具不收敛，轮数硬上限保证一定进入最终流式输出；
- 客服场景 5 轮足够（多数一问一答就结束）。

### Q18 讲讲 AiServices 重构的来龙去脉（高频亮点题）

- **第一版手工编排**：自己拼 SystemMessage → 历史 → 输入，手写工具回填循环（每轮 CompletableFuture 桥接成同步拿决策），动机是对消息组装和事件推送有完全控制；
- **转折**：接 RAG 时发现记忆装载、工具回填、检索注入三件事在手写代码里越缠越紧，每加一个能力都要动同一段编排逻辑，改动面失控；
- **切换**：引擎层换成 AiServices——ChatAssistant 声明式接口（@SystemMessage/@UserMessage 模板 + TokenStream），memory/tools/ContentRetriever 统一 builder 装配，回调（onPartialResponse/onRetrieved/beforeToolExecution/onCompleteResponse）逐个翻译回 domain 的 LlmTokenHandler；
- **收益**：重构只发生在 infrastructure 一个实现类；domain 只加了 knowledgeBaseIds/ragTopK/ragMinScore 三个字段和 onRetrieved 一个回调；application 层零改动——六边形边界"用一次实战验证了"；
- 【话术】"为控制力手写的代码，在需求长大后要重新估值"——这是我在这个项目里最重要的一条工程教训。

### Q19 标题自动生成为什么单独搞个同步模型？

- 第一版拿流式模型 CompletableFuture 桥接成同步（future.get 60s），桥接代码比业务还多；
- 重构后 ChatModelFactory 双模型缓存（流式 + OpenAiChatModel 同步，都是双重检查锁懒加载），标题指令声明在 TitleAssistant 的 @UserMessage 模板上，一行调用；
- 低频一次性场景用同步模型更直白，两个实例共享同一份连接配置。

---

## 五、RAG 知识库

### Q20 讲一遍 RAG 摄入管道

- 上传（同步）：白名单校验（pdf/doc/docx，≤20MB）→ 落盘（UUID 重命名）→ 登记 ai_document（pending）+ 原子累加文档数 → 返回 docId；
- 解析（异步）：独立 Bean 的 @Async 方法（独立是为了避免 this 调用绕过代理）→ 状态机 pending → parsing → success/failed（fail_reason 截 500 字）；
- PDFBox / POI 按类型选解析器提取全文 → 滑动窗口切分（默认 500 字/重叠 50，知识库级可配 100–2000/0–200）；
- bge-small-zh-v15 本地 ONNX 推理批量向量化（512 维）→ 入向量库，每段落带 metadata 四元组（knowledgeBaseId/documentId/segmentId/chunkIndex）；
- 前端 3 秒轮询文档列表，parsing 转圈、failed 显示原因 + 手动重解析按钮。

### Q21 切分为什么用滑动窗口 + 重叠？

- chunk_size=500 保证单段语义完整度和向量质量，overlap=50 防止关键句恰好被切断在边界；
- step 有个细节：`Math.max(1, chunkSize - chunkOverlap)` 防止 overlap ≥ chunkSize 时步长归零死循环；
- 【追问】为什么不用 token/句子边界切分？中文一字一 token 近似成立，字符滑窗实现简单、行为可预测；句子边界切分是已知优化方向。

### Q22 为什么 embedding 用本地模型？

- bge-small-zh-v15：中文优化、512 维、ONNX 进程内推理——不依赖外部向量 API，无网络开销、无数据出域（政务场景敏感点）、零调用成本；
- 备选 all-minilm-l6-v2（384 维多语言）在依赖里预留，切换只需换 Bean + 向量表维度并重建索引；
- 【追问】维度不一致会怎样？写入直接报错——所以"Embedding 模型维度与向量表定义一致"是上线检查项。

### Q23 metadata 四元组是干嘛的？

- 三个用途：**检索过滤**（isIn(knowledgeBaseId) 锁定智能体绑定的知识库范围）、**溯源**（RagHit 带回 segmentId/documentId，落库 referencedDocs，回答可追溯到原文段落）、**级联删除**（删知识库/文档时按 metadata Filter 清向量）。

### Q24 检索怎么接入对话的？

- 编排层解析智能体 knowledgeBaseIds + ragConfig（topK/similarityThreshold，**解析失败降级为不启用**，配置笔误不打断对话）→ 随 LlmRequest 下传；
- 引擎层构造 EmbeddingStoreContentRetriever：embeddingStore + embeddingModel + maxResults（默认 4）+ filter isIn(knowledgeBaseId)，minScore 可选；
- 命中内容由 AiServices **自动注入用户消息**（不是拼进 system prompt——人设保持纯净，检索内容随轮次滚动）；
- onRetrieved 回调翻译成 domain 的 RagHit 列表 → onComplete 时序列化进消息 referencedDocs + usage.ragHit 计数（原来是写死 0）。

### Q25 【追问】为什么注入 user message 而不是 system prompt？

- system 是"人格与规则"，检索内容是"本轮参考资料"——语义不同；混在一起会让模型把资料当指令（也缓解 prompt injection 面）；
- 每轮检索结果随用户消息滚动，system 保持稳定，token 结构更干净。

### Q26 向量库用的什么？pgvector 索引怎么建的？

- 设计上是 pgvector：`VECTOR(512)` 列 + **HNSW 余弦索引**（m=16, ef_construction=64），另建两个 jsonb 表达式索引支撑按知识库/文档过滤清理；
- 当前状态诚实说：开发期跑 InMemoryEmbeddingStore 占位（内网 Nexus 还没放行 pgvector 依赖），**网关接口层零改动可切换**——这正是分层抽象的红利；
- 【话术】不要谎称生产已用 pgvector；把"占位实现 + 零成本切换路径"讲清楚反而是亮点。

### Q27 文档解析失败怎么办？

- 状态机 failed + fail_reason（截 500 字），不自动重试——避免半途写入的向量重复；
- 用户手动"重新解析"（仅 failed/success 允许）：先清旧分段与向量再重跑，计数用 `GREATEST(0, vector_count - N)` 防负数。

---

## 六、DDD 分层与架构

### Q28 DDD 七个模块怎么分的？依赖方向？

- adapter（Controller）→ application（服务编排）→ domain（实体/接口）← infrastructure（实现）+ shared（DTO/枚举）+ client（Feign 预留）+ starter（唯一可执行 jar）；
- 依赖倒置的关键：domain 定义 LlmGateway/EmbeddingGateway/ToolCallDispatcher 等接口，infrastructure 实现它们并 import LangChain4j；**domain 和 application 全工程 grep 不到一个 dev.langchain4j**；
- 只有 starter 开 spring-boot-maven-plugin，其他模块 skip=true。

### Q29 分层带来过什么实际收益？（用事实说话）

- 两次：① 引擎层手写编排 → AiServices 整体重写，只动 infrastructure 一个类；② 向量库 InMemory → pgvector 的切换路径设计成只换一个 Bean；
- 【话术】"分层不是画出来好看的，是每次变更的爆炸半径计量单位"。

### Q30 领域层现在有什么？

- 实体：AiSession/AiMessage/AiAgent/AiUsageRecord/知识库三件套；
- 技术中立模型：LlmRequest（系统提示词/历史/输入/工具/RAG 范围）、LlmTokenHandler（onToken/onComplete/onError/onToolCall/onRetrieved）、RagHit、ToolDefinition、ChatTurn；
- 网关接口：LlmGateway/MessageGateway/EmbeddingGateway 等——全部面向业务语义，不含任何 SDK 类型。

---

## 七、数据设计与工程细节

### Q31 消息表怎么设计的？

- 核心字段：sessionId、role（user/assistant）、content、status（sending/success/failed/interrupted）、tokensInput/tokensOutput、referencedDocs（RAG 溯源 JSON）、createTime；
- 雪花 ID（assign_id）+ deleted 逻辑删除（全局 logic-delete 配置）；
- 【追问】为什么先落库占位？流式过程中任何状态变化都是"回写"，前端从第一帧起有稳定 messageId；服务中途崩溃也留下 sending 尸骸可查，启动恢复/人工排查有据。

### Q32 会话重命名为什么要"单字段更新"？

- `new AiSession(); setId; setTitle; updateById` 只 update title 一个字段；
- 如果 updateById 全量实体，并发场景会把别的线程刚更新的 messageCount/lastActiveTime 用旧值盖回去——这是个典型丢失更新问题；
- 置顶/归档同理，读现值取反 + 单字段更新，@Transactional 包住。

### Q33 用量统计怎么做的？失败影响对话吗？

- 每次正常完成落一条 ai_usage_record：tokens 输入/输出/总计、耗时、是否用工具、ragHit 命中数；
- token 数来自模型响应的 TokenUsage（可能为 null 则记 0）；
- saveUsage 整体 try-catch 静默（失败只 warn）——**统计挂了不能影响对话主流程**，这是链路里刻意的降级点。

### Q34 删除会话的顺序？

- 先 stopSession 停掉正在生成的流（否则流还在往一个已删会话写消息）→ 级联逻辑删消息 → 删会话；全程归属校验（非本人 FORBIDDEN）。

---

## 八、前端工程

### Q35 流式 Markdown 渲染怎么优化的？

- 问题：最初每 token 全量 marked + highlight.js + DOMPurify 重渲染，内容一长 O(n²)，3000 字页面卡死；
- 三级优化：① rAF 内按内容长度分级限频（<1000 字 80ms / 1000–3000 字 120ms / >3000 字 200ms）；② 超过 2000 字符切"轻量渲染"（跳过代码高亮），流式结束后全量高亮一次；③ 历史消息（非流式）同步直渲；
- 配套：hljs 按语言注册（不全量打包 190+ 语言）、DOMPurify 净化、代码块复制按钮事件委托。

### Q36 还有哪些前端细节值得讲？

- 会话快速切换竞态：自增请求序号丢弃过期响应，防旧会话消息晚到覆盖新会话；
- 自动滚动 rAF 节流（每 token 读 scrollHeight 会强制布局）；用户上翻即停跟随，距底 120px 出现回底按钮；
- 输入框 4000 字限制：>3000 渐入计数器、>3500 变黄、>4000 变红 + 抖动 + 硬拒发送；
- axios 请求去重（url+method+params+data 生成 key 的 pendingMap + CancelToken）。

---

## 九、踩坑复盘（面试官最爱）

### Q37 讲三个你印象最深的坑

1. **@Async 自调用失效**：解析逻辑写在 Service 内部方法，this.parse() 绕过代理，异步注解形同虚设（表现为接口同步阻塞几分钟）。拆成独立 DocumentParseExecutor Bean 才真正异步。教训：AOP 代理机制要刻在脑子里；
2. **SSE 半包**：本地正常联调必现丢事件。根因是分块边界不对齐事件边界，split('\n\n') 后尾段要留 buffer 拼接。教训：流式协议调试必须在真实网络环境下做；
3. **停止语义**：第一版 stop 直接摘注册表 + complete，结果 onComplete 读不到停止状态，被中断的消息落库成 success。改成"只置标记、收尾时再清理"，interrupted 语义才完整。教训：异步系统里"清理"的时机和"状态可见性"是一体的。

### Q38 如果重新做一遍，你会改什么？

- 一开始就上 AiServices 而不是手写编排？——不，先手写再抽象让我真正理解了框架在做什么，重构时才知道边界在哪；
- 真正会改的：① SSE 事件协议加上 requestId/序号，多副本下更稳；② 摄入管道一开始就按消息队列设计（现在 @Async 单机），大文件解析削峰是刚需；③ 切分上句子边界感知，重叠 50 对中文表格类文档不够。

---

## 十、开放题与延伸

### Q39 部署多副本要改什么？

- ChatStreamRegistry → Redis：互斥 SETNX（带 TTL 兜底），停止标记按 sessionId 路由或 pub/sub 广播；
- @Async 解析 → 消息队列（平台已有 RabbitMQ）：解析任务削峰 + 重试语义；
- 向量库切 pgvector（本来就计划内）；会话粘性不需要——SSE 是短生命周期连接。

### Q40 怎么防 prompt 注入 / 控制幻觉？

- 已做：检索内容注入 user message 而非 system（不污染指令层）；工具结果只以 JSON 数据形态回填；referencedDocs 溯源让人工可验证；
- 可做：知识库内容清洗（隐藏指令扫描）、相似度阈值调优 + "知识库没有就直说"的提示词约束、回答附引用原文段落的前端展示。

### Q41 这个项目里你最有成就感的一点？

- 推荐答 AiServices 重构故事（Q18）：不是用了多新的技术，而是在需求变化时验证了自己画的架构边界真的守得住——domain 加三个字段、application 零改动，infrastructure 一个类消化了引擎层的整个重写；
- 备选答 RAG 溯源闭环（Q23/Q24）：从摄入时的 metadata 设计，到检索过滤、回答溯源、用量统计，一个字段设计撑起了四个下游能力。

---

## 附：数字与名词速查

| 项 | 值 |
|---|---|
| 模块 | 7 个 Maven 模块（DDD） |
| 接口 | 20+（对话 4 / 会话 7 / 智能体 7 / 知识库若干） |
| LangChain4j | 1.13.0（community beta23） |
| 模型 | OpenAI 兼容协议，gpt-5.4（temperature 0.7，maxTokens 2048） |
| Embedding | bge-small-zh-v15，512 维，本地 ONNX（备选 all-minilm-l6-v2/384 维） |
| 记忆 | 6 轮（12 条，仅 success），memory 容量 6×2+8 |
| 输入上限 | 4000 字（@Size + 截断双保险） |
| SSE 超时 | 300s（网关 120s） |
| 事件协议 | token / tool / done / error |
| 消息状态 | sending → success / failed / interrupted |
| 工具 | 4 个内置，轮数上限 5 |
| RAG | topK 默认 4，minScore 可选（similarityThreshold） |
| 切分 | 500 字 / 重叠 50（可配 100–2000 / 0–200） |
| 向量表 | ai_embedding VECTOR(512)，HNSW 余弦（m=16, ef=64） |
| 上传 | pdf/doc/docx，≤20MB |
| 标题 | ≤12 字（截 20），messageCount ≤ 2 触发 |
| 前端 | Vue 3 + Vite，marked + hljs + DOMPurify，节流 80/120/200ms |
