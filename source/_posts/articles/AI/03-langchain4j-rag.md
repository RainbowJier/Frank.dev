---
title: LangChain4j 深入理解（03）：从零构建 RAG 检索增强
date: 2026-08-17 16:20:00
categories:
  - 教程
tags:
  - LangChain4j
  - RAG
  - AI 应用
  - Java
description: RAG 三段式全链路：文档解析与切分策略、向量化与维度一致性、EmbeddingStore 检索与 Filter 过滤、ContentRetriever 接入 AiServices 与高级编排管道。
lang: zh-CN
---

> 本文是《LangChain4j 深入理解》系列第 03 篇（收官）。前两篇拆了对话管道与工具循环，本篇补上管道里最后一块拼图：**检索增强（RAG, Retrieval-Augmented Generation）**。

## RAG 解决什么问题

模型的知识止步于训练截止日，更不知道你公司内部的操作手册。RAG 的思路朴素：**先把知识切碎存进向量库，回答前检索最相关的几段，塞进提示词让模型"开卷考试"**。

全链路就三段：

1. **摄入（Ingestion）**：文档 → 解析 → 切分 → 向量化 → 入库（离线，一次性或增量）；
2. **检索（Retrieval）**：问题 → 向量化 → 相似度搜索 → 命中分段（在线，每轮对话）；
3. **注入（Augmentation）**：命中内容拼进提示词，随问题一起交给模型。

LangChain4j 对三段都有抽象，逐段拆。

## 一、摄入管道

![图 1：RAG 摄入管道](langchain4j-rag-ingestion.svg)

### 解析：DocumentParser

按文件类型选解析器，都在 community 包里：

```java
DocumentParser parser = "pdf".equalsIgnoreCase(type)
        ? new ApachePdfBoxDocumentParser()   // PDF
        : new ApachePoiDocumentParser();     // doc / docx
Document document = parser.parse(inputStream);   // Document = 全文文本 + Metadata
```

还有 Tika（万能格式）、文本加载器一族。扫描件 PDF 没有文本层，解析出来是空的——摄入侧要有状态机兜底（后文实战部分）。

### 切分：DocumentSplitter

为什么不整篇入库？Embedding 模型有输入长度上限，且整篇向量会把主题稀释成"什么都像、什么都不像"。切分的目标是**每段自包含一个可检索的语义单元**：

```java
// 递归切分：优先按段落 → 句子 → 词，尽量不劈断语义单元
DocumentSplitter splitter = DocumentSplitters.recursive(500, 50, new OpenAiTokenizer());
List<TextSegment> segments = splitter.split(document);
// 每个 TextSegment = 切出来的文本片段 + 继承文档级 Metadata
```

两个参数是检索质量的**主旋钮**：

- **chunk 大小（500）**：太大稀释语义、塞进提示词也费 token；太小丢上下文，命中了也读不懂；
- **overlap（50）**：相邻分段重叠 50，防止关键句恰好被切断在边界——代价是存储冗余。

也可以完全自己控制切分（中文场景"一字 ≈ 一字符"很好估算），比如项目里用的字符滑窗：

```java
int step = Math.max(1, chunkSize - chunkOverlap);   // 防 overlap >= chunkSize 死循环
for (int start = 0; start < len; start += step) {
    chunks.add(text.substring(start, Math.min(start + chunkSize, len)));
}
```

### 元数据：Metadata 是检索的"户口"

每个分段都该挂上业务元数据——它决定了你**能不能按范围检索、能不能溯源、能不能级联删除**：

```java
TextSegment segment = TextSegment.from(chunk, Metadata.from("knowledgeBaseId", "1")
        .put("documentId", "42")
        .put("segmentId", "1024")
        .put("chunkIndex", "3"));
```

这四元组一个字段撑起三个下游能力：检索时按 `knowledgeBaseId` 过滤范围、回答后按 `segmentId` 追溯原文、删文档时按 `documentId` 清向量。

### 向量化与入库

```java
// 本地 ONNX 推理的中文模型，512 维，无需外部 API
EmbeddingModel embeddingModel = new BgeSmallZhV15EmbeddingModel();

List<Embedding> embeddings = embeddingModel.embedAll(segments).content();  // 批量
embeddingStore.addAll(embeddings, segments);   // 向量与分段绑定入库
```

一条铁律：**向量维度必须与存储建表维度一致**——换 embedding 模型通常意味着换维度，整库重建。`embedAll` 批量比循环 `embed` 高效得多，几百段一次入库。

懒人版：`EmbeddingStoreIngestor` 把"切分 → 向量化 → 入库"串成一行：

```java
EmbeddingStoreIngestor ingestor = EmbeddingStoreIngestor.builder()
        .documentSplitter(DocumentSplitters.recursive(500, 50, new OpenAiTokenizer()))
        .embeddingModel(embeddingModel)
        .embeddingStore(embeddingStore)
        .build();
ingestor.ingest(document);
```

要插自定义逻辑（状态机、进度跟踪、失败重试）就拆开手工控制——两套姿势，看工程需要。

## 二、检索管道

![图 2：一次向量检索](langchain4j-rag-retrieval.svg)

检索的输入是问题、输出是命中分段列表，中间四个可调项：

```java
Embedding queryEmbedding = embeddingModel.embed("红线数据怎么申请下载？").content();

EmbeddingSearchRequest request = EmbeddingSearchRequest.builder()
        .queryEmbedding(queryEmbedding)
        .maxResults(4)                                   // topK：取几段
        .minScore(0.5)                                   // 相似度阈值：低于即丢弃
        .filter(metadataKey("knowledgeBaseId").isIn("1", "2"))  // 范围过滤
        .build();

EmbeddingSearchResult<TextSegment> result = embeddingStore.search(request);
List<EmbeddingMatch<TextSegment>> matches = result.matches();   // 按得分降序
```

四个旋钮的理解：

- **maxResults（topK）**：命中段落数。太少覆盖不全，太多稀释注意力还费 token；客服场景 4~5 段是常见起点；
- **minScore**：相似度闸门，语义是"**宁可没有，不要噪音**"——0.4 的相似度命中多半是无关段落，硬塞给模型反而诱导幻觉。注意 score 的绝对分布随模型而异，换模型要重新标定；
- **filter**：检索前先缩小范围（按知识库、租户、文档类型……），metadata 在这里兑现价值；
- **相似度**：默认余弦相似度，得分归一到 0~1（越接近 1 越相似），pgvector 侧对应 HNSW 余弦索引。

### 存储选型

`EmbeddingStore<TextSegment>` 是统一抽象，实现一族即插即用：

```java
// 开发期：内存占位，重启即失，接口与生产一致
EmbeddingStore<TextSegment> store = new InMemoryEmbeddingStore<>();

// 生产：pgvector（向量列 + HNSW 余弦索引）
EmbeddingStore<TextSegment> store = PgVectorEmbeddingStore.builder()
        .host("127.0.0.1").port(5432)
        .databaseName("fjgtkj_ai")
        .table("ai_embedding")
        .dimension(512)          // 必须与 embedding 模型输出一致
        .createTable(false)      // 表结构交给 SQL 脚本管理更稳
        .build();
```

同一接口下两个实现的切换是**零改动换 Bean**——这也是为什么摄入和检索代码都不该直接 new 具体存储。

## 三、注入与编排

### 最简接入：contentRetriever

上一篇的执行管道里有一段虚线的"检索增强"，接上它只需要：

```java
ContentRetriever retriever = EmbeddingStoreContentRetriever.builder()
        .embeddingStore(store)
        .embeddingModel(embeddingModel)
        .maxResults(4)
        .minScore(0.5)
        .filter(metadataKey("knowledgeBaseId").isIn("1", "2"))
        .build();

AiServices.builder(Assistant.class)
        .streamingChatModel(model)
        .contentRetriever(retriever)     // 管道里的 RAG 段从此生效
        .build();
```

默认行为：**检索命中内容追加注入到用户消息里**（不是 system prompt）——人设保持纯净，检索内容随轮次滚动。想在命中时拿到引用做溯源，用 `TokenStream` 的回调：

```java
stream.onRetrieved(contents -> {
    // contents: List<Content>，含命中分段与其 metadata
    // 取出 segmentId / documentId 落库，即可回答后展示"引用自《操作手册》第 3 节"
});
```

### 高级编排：RetrievalAugmentor

`contentRetriever(...)` 其实是"全默认组件 + 单检索器直通"的快捷方式。完整编排由 `RetrievalAugmentor` 承担，五个环节各自可替换：

![图 3：RetrievalAugmentor 高级 RAG 管道](langchain4j-rag-augmentor.svg)

- **QueryTransformer（查询变换）**：改写口语化问题、扩展成多个子查询、或压缩超长历史——多查询扩展能显著提高召回，代价是多次检索；
- **QueryRouter（查询路由）**：把（可能多个）查询分发给（可能多个）检索器——"技术问题路由到向量库，政策问题路由到公文库"；
- **ContentRetriever（检索器）**：向量库、全文检索、Web 搜索……任何"给 Query 还 Content"的实现；
- **ContentAggregator（内容聚合）**：多路命中合并、去重、重排（如按 score 或 LLM rerank），选出最终注入集；
- **ContentInjector（内容注入）**：把内容拼进提示词的位置与格式。

单库场景不必碰这些；等你要"多知识库路由 + 查询扩展 + 重排"时，它们就是现成的扩展点。

## 实战视角：把 RAG 挂到智能体上

知识库范围和检索参数不该写死在代码里。我的做法是挂在智能体配置上（jsonb 字段，运行时解析）：

```java
// 智能体配置：knowledgeBaseIds=[1,2]，ragConfig={"topK":4,"similarityThreshold":0.5}
var builder = EmbeddingStoreContentRetriever.builder()
        .embeddingStore(store)
        .embeddingModel(embeddingModel)
        .maxResults(agent.ragTopKOrDefault(4))
        .filter(metadataKey("knowledgeBaseId").isIn(agent.knowledgeBaseIds()));
if (agent.ragMinScore() != null) {
    builder.minScore(agent.ragMinScore());
}
```

配套三个工程决策：配置解析失败**降级为不启用**（配置笔误不打断对话）；命中经 `onRetrieved` 翻译成溯源记录落库；摄入侧带状态机（pending → parsing → success/failed）+ 手动重解析，失败不自动重试避免向量重复写入。

## 排查与调参清单

RAG 效果差时按顺序检查：

1. **切分**：命中段落是不是被劈断了语义（调 overlap）；chunk 是不是太大稀释了主题；
2. **minScore**：调低看是否有结果——有但被阈值拦了说明阈值过严，无则继续往下查；
3. **维度一致**：换过模型没重建库，写入/检索直接报错；
4. **描述与文档质量**：垃圾进垃圾出，扫描件、表格转文本的质量决定上限；
5. **topK**：召回不足加 topK 或上查询扩展（QueryTransformer）。

## 小结

- RAG 三段式：摄入（解析→切分→向量化→入库）、检索（向量化→过滤→相似度排序）、注入（拼进用户消息）；
- chunk 大小与 overlap 是摄入侧主旋钮，topK 与 minScore 是检索侧主旋钮；minScore 的语义是"宁可没有，不要噪音"；
- Metadata 是被低估的设计：范围过滤、引用溯源、级联删除三件事一个字段全包；
- `EmbeddingStore` 抽象让开发期 InMemory 与生产 pgvector 零成本互切；
- `contentRetriever()` 是直通快捷方式，`RetrievalAugmentor` 五环节（变换/路由/检索/聚合/注入）是进阶扩展点。

> 系列目录：1. [对话的底层执行](/2026/08/17/articles/AI/01-langchain4j-chat-internals/) → 2. [工具调用 Function Calling](/2026/08/17/articles/AI/02-langchain4j-tool-calling/) → 3. 从零构建 RAG（本篇）
