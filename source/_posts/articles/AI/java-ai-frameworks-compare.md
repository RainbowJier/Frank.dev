---
title: Java AI 框架全景对比：LangChain4j、Spring AI 与各路新势力怎么选
date: 2026-09-03 10:00:00
categories:
  - 教程
tags:
  - Java
  - AI 应用
  - LangChain4j
  - Spring AI
  - 框架选型
description: Java AI 框架横向盘点：裸调 SDK 的边界、LangChain4j 积木式构建块与 Spring AI 约定式管道的设计哲学对比、Spring AI Alibaba 与 Semantic Kernel 的生态绑定得失、Koog 与 Google ADK 等新势力定位，以及一张选型决策树。
lang: zh-CN
---

> 三年前 Java 圈还在羡慕 Python 有 LangChain，如今的选择困难症已经反过来了：LangChain4j、Spring AI、Spring AI Alibaba、JetBrains Koog、Google ADK、Agents-Flex、Solon AI……名字比概念还多。这篇把它们摆到一张桌上，逐个讲清**设计哲学、能力边界与适用场景**。深入玩法见我此前的《LangChain4j 深入理解》系列，本文负责"选型总览"这一层。

## 一、先问自己：真的需要框架吗

所有框架之前，先看裸调 SDK 这条基线。大模型厂商几乎都提供 OpenAI 兼容接口，Java 17 自带的 HttpClient 就能直接发流式请求：

```java
// Java HttpClient 直连 OpenAI 兼容接口（示意）
HttpRequest request = HttpRequest.newBuilder()
        .uri(URI.create(baseUrl + "/chat/completions"))
        .header("Authorization", "Bearer " + apiKey)
        .POST(BodyPublishers.ofString("""
            {"model":"qwen-plus","stream":true,
             "messages":[{"role":"user","content":"红线数据怎么申请下载？"}]}"""))
        .build();
client.send(request, BodyHandlers.ofLines());   // SSE 还得自己逐行解析
```

一次原型、一个内部小工具，这样写完全够。但只要往生产走，五个轮子就得自己造：

1. **供应商可移植**：换模型厂商时，消息格式、参数、流式协议全部重写；
2. **工具调用循环**：`tool_calls` 应答 → 执行 → 回填 → 再请求的循环要手写状态机（有多繁琐见[系列第 02 篇](/2026/08/17/articles/AI/02-langchain4j-tool-calling/)）；
3. **会话记忆**：多轮历史怎么装、装多少、何时驱逐，每个模型上下文窗口还不一样；
4. **RAG 管道**：切分、向量化、检索、注入，一段都不能少；
5. **可观测与工程化**：token 统计、重试限流、链路追踪。

框架的价值就是替你造好这五个轮子。判断标准很简单：**调一次模型是需求，做一类 AI 应用才是框架的需求**。

## 二、版图：三年从荒漠到过剩

![图 1：Java AI 框架演进时间线](java-ai-landscape-timeline.svg)

把 2023 年至今的里程碑串起来，能看到三条清晰的线：

- **老牌双雄**：LangChain4j 与 Spring AI 在 2023 年前后脚起步，又在 2025 年 5 月同月交付 1.0 GA，如今分别是"集成最全"和"Spring 生态正统"的代表；
- **背靠大树系**：Spring AI Alibaba 借着 Spring AI 的地基叠加阿里云通义生态；Semantic Kernel 则走向反面——微软 2025 年 7 月宣布其进入维护模式，继任的 Microsoft Agent Framework 只面向 .NET 与 Python，Java 版成了断头路；
- **Agent 新势力**：2026 年前后，Google ADK for Java 与 JetBrains Koog 相继 1.0，加上 Spring 之父 Rod Johnson 的 Embabel，共识是**下一阶段的竞争在多智能体编排**，不在对话封装。

## 三、LangChain4j：积木式工具箱

一句话定位：**框架无关的 LLM 构建块集合**。它不关心你用 Spring、Quarkus 还是 Micronaut，只提供积木：几十家模型供应商、二十多种向量库、各类文档解析器的现成集成，外加把积木粘起来的声明式胶水 AiServices：

```java
interface Assistant {
    @SystemMessage("你是国土空间平台的智能客服")
    String chat(@UserMessage String message);
}

Assistant assistant = AiServices.builder(Assistant.class)
        .chatModel(model)                                             // 任意供应商实现
        .chatMemory(MessageWindowChatMemory.withMaxMessages(20))      // 记忆策略
        .tools(new OrderTools())                                      // @Tool 注解方法自动注册
        .contentRetriever(retriever)                                  // RAG 检索器
        .build();
```

声明一个接口，记忆、工具、RAG 在 builder 里各挂一行，整条管道由动态代理驱动——这是它代码量最小的根本原因。系列三篇拆过这条管道的每一环，不重复。

**特点**：

- 集成广度断档第一，冷门国产模型、小众向量库大概率有现成模块；
- 与宿主框架解耦，同一套代码在 Quarkus 和 Spring 里长得一样；
- 短板也来自同一处：模块众多且大量带 `-beta` 后缀，版本迭代快，升级要盯 release notes；文档散在官网与各仓库 README 之间。

**使用场景**：需要多模型可移植、宿主框架不定型、想精细控制管道每一环的团队——以及所有"非 Spring Boot"的 JVM 项目。

## 四、Spring AI：约定优于配置搬到 AI

一句话定位：**把 LLM 纳入 Spring 编程模型**。它的答案不是提供积木，而是提供"Spring 该有的样子"：starter 自动装配、配置文件切模型、ChatClient 流式 DSL、Advisor 管道：

```java
@Bean
ChatClient chatClient(ChatClient.Builder builder, OrderTools tools) {
    return builder
            .defaultSystem("你是国土空间平台的智能客服")
            .defaultTools(tools)                     // 同样是 @Tool 注解
            .defaultAdvisors(
                    MessageChatMemoryAdvisor.builder(chatMemoryRepository).build(),
                    new SimpleLoggerAdvisor())       // 观测即插即用
            .build();
}

String answer = chatClient.prompt().user("红线数据怎么申请下载？").call().content();
```

Advisor 是它的灵魂概念——一个横切增强管道，长得就像 Servlet Filter：请求先过记忆 Advisor 拼历史、过 RAG Advisor 注入检索内容，响应再逆序返回。切供应商只动配置：

```yaml
spring:
  ai:
    openai:
      base-url: https://dashscope.aliyuncs.com/compatible-mode   # 换厂商 = 换这三行
      api-key: ${DASHSCOPE_KEY}
      chat:
        options:
          model: qwen-plus
```

![图 2：LangChain4j 与 Spring AI 核心抽象对照](java-ai-abstraction-compare.svg)

**特点**：

- 与 Spring Boot 深度咬合：自动装配、Micrometer 可观测、生态内组件信手拈来；
- API 结构化程度高，团队协作时"姿势"容易被规范住；
- 短板是强绑定 Spring——离开 Spring Boot 它寸步难行；从 1.0 之前里程碑版本走过来的团队也吃过 API 大改的苦（1.0 之后趋于稳定）。

**使用场景**：已经在 Spring Boot 3.x 上运转的团队，想用最符合直觉的方式把 AI 能力接进现有工程——**主流之选，选它大概率不会错**。

## 五、背靠大树的两个：一个借势，一个殉道

### Spring AI Alibaba：站在 Spring AI 上的"云厂商增强包"

阿里出品，基于 Spring AI 构建，1.0 GA 已发布。它在 Spring AI 的地基上叠了三样东西：通义系模型与百炼平台的一等公民接入、Graph 多智能体编排（企业工作流、人机协同内置）、全中文文档与国内案例。**判断标准很直接：你的模型选型就是通义、基础设施就在阿里云，用它等于少写一半适配代码**；反之它的价值就只剩 Graph 编排那一块。

### Semantic Kernel 的教训：出身不等于生命力

SK 的 Java 版曾正经 GA 过，出自微软之手。但 2025 年 7 月微软宣布 Semantic Kernel 与 AutoGen 一并进入维护模式，火力转向 Microsoft Agent Framework——而新框架没有 Java 版。这个案例给选型者的启示比框架本身更有价值：**框架能不能活，看的是社区活跃度与厂商的持续投入，不是发布时的名头**。新项目直接排除。

## 六、轻量级与新势力速览

两类值得知道、但多数团队暂时不必上车的框架：

- **国产轻量双生子**：Agents-Flex 与 Solon AI。链式 API、体积小、国产模型适配积极，中文文档友好。适合轻量场景、信创要求项目，或本来就是 Solon 生态的用户。能力面（RAG、Agent 编排的完整度）与两大主流有差距，但胜在简单直接。
- **Agent 编排新势力**：JetBrains Koog（2026 年 3 月发布，Kotlin 优先，图编排与持久化是强项）、Google ADK for Java（2026 年初 1.0，与 Gemini/Vertex 深度协同）、Embabel（Rod Johnson 个人项目，领域模型中心的规划式编排）。它们的共识是把"多智能体编排"做成一等公民——当你的应用主体是**自治 Agent 工作流**而不是"带 AI 功能的业务系统"时，这一档才进入射程。

![图 3：主流框架能力矩阵](java-ai-capability-matrix.svg)

## 七、选型：一张决策树加一张表

![图 4：Java AI 框架选型决策树](java-ai-selection-decision.svg)

决策逻辑其实就四问，按顺序问自己：

1. **做的是原型还是产品？** 原型直接裸调 SDK，别让框架增加理解成本；
2. **宿主技术栈是什么？** Spring Boot 项目默认 Spring AI，阿里云生态加码 Spring AI Alibaba；非 Spring 或多框架并存，选 LangChain4j；
3. **应用主体是 AI 还是业务？** 业务系统里嵌 AI 对话/RAG，双雄任选；应用本身就是多智能体工作流，看 Koog / Google ADK 这一档；
4. **有没有硬约束？** 信创或极端轻量 → Agents-Flex / Solon AI；深度绑定 Gemini/Vertex → ADK。

汇总成一张表（信息截至 2026-09）：

| 维度 | LangChain4j | Spring AI | Spring AI Alibaba | Semantic Kernel Java |
| --- | --- | --- | --- | --- |
| 维护方 | 社区（独立项目） | Spring 官方 | 阿里巴巴 | 微软（维护模式，不建议新项目） |
| 当前版本 | 1.19 | 1.1.x | 1.0+ | 1.x（停更） |
| 核心抽象 | AiServices 声明式接口 | ChatClient + Advisor 管道 | Graph 节点编排 | Kernel + Plugin |
| 框架耦合 | 无，Quarkus/Micronaut/Spring 通吃 | 深度绑定 Spring Boot | 绑定 Spring + 阿里云 | 无 |
| 模型接入 | 集成数量断档第一 | 主流供应商全覆盖 | 通义/百炼一等公民 | 偏好 Azure 系 |
| RAG | 全家桶，可编排度高 | 结构化 ETL + Advisor 注入 | 同 Spring AI 并加平台件 | 较基础 |
| 多智能体编排 | agent 模块（迭代快） | 基础 Agent 能力 + MCP | Graph 编排是招牌 | 弱 |
| 可观测 | 依赖宿主方案 | Micrometer 一等公民 | 同 Spring AI | 一般 |
| 文档语言 | 英文为主 | 英文为主 | 中文友好 | 英文 |
| 适合场景 | 需要可移植与精细控制 | Spring 团队的主答案 | 阿里云生态团队 | 无新项目理由 |

## 八、我自己怎么选的

平台 AI 智能客服项目落地时我选了 LangChain4j，决策路径可以复述：其一，项目要与既有工程解耦成独立服务，不想把 AI 能力焊死在 Spring 全家桶上；其二，需要同时适配多家模型供应商做效果对比，LangChain4j 的集成广度让"换模型"退化成换一个 Maven 坐标；其三，AiServices 一个接口声明就把记忆、工具、RAG 收进同一条管道，代码量与团队理解成本都最小。反过来，如果那是一个纯 Spring Boot 单体里的小模块，我会毫不犹豫选 Spring AI——**没有最好的框架，只有贴着约束选的框架**。

## 小结

- 裸调 SDK 是所有讨论的基线：五个轮子（可移植、工具循环、记忆、RAG、可观测）里只要有两个要造，就该看框架了；
- LangChain4j 给**构建块**，Spring AI 给**约定**——前者灵活、集成广、框架无关，后者结构化、自动装配、与 Spring 深度咬合，各有各的"意见"；
- Spring AI Alibaba 是云厂商增强包，通义 + 阿里云团队的首选；Semantic Kernel Java 是断头路，选型要看社区生命力而非出身；
- Koog、Google ADK、Embabel 押注的是多智能体编排，应用主体是自治工作流时才进入射程；
- 四问决策：原型还是产品、宿主是什么栈、主体是 AI 还是业务、有没有硬约束。

> 延伸阅读——《LangChain4j 深入理解》系列：1. [对话的底层执行](/2026/08/17/articles/AI/01-langchain4j-chat-internals/) → 2. [工具调用 Function Calling](/2026/08/17/articles/AI/02-langchain4j-tool-calling/) → 3. [从零构建 RAG](/2026/08/17/articles/AI/03-langchain4j-rag/)
