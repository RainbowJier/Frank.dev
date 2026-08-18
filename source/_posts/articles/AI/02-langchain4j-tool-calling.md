---
title: LangChain4j 深入理解（02）：工具调用 Function Calling 全链路
date: 2026-08-17 16:10:00
categories:
  - 教程
tags:
  - LangChain4j
  - AI 应用
  - Java
description: 从线上协议到执行循环，拆透 LangChain4j 的工具调用：ToolSpecification 声明、tool_calls 应答、ToolExecutor 执行回填、流式钩子与错误处理策略。
lang: zh-CN
---

> 本文是《LangChain4j 深入理解》系列第 02 篇。上一篇拆了对话的执行管道，本篇展开其中最有意思的一段：**工具调用**。

## 先纠正一个直觉：模型不会"执行"任何东西

问模型"查一下 350100 行政区划下有哪些数据资源"，它其实**没有能力**查——它能做的只是在自己的回复里输出一段结构化文本："我请求调用 `list_resources` 这个工具，参数是 `{"divisionCode":"350100"}`"。真正的执行者是**你的代码**，执行完把结果作为一条消息回填给模型，模型再基于结果组织最终回答。

所以 Function Calling 是一个**协议 + 循环**：

- 协议：模型怎么"声明工具"、怎么"请求调用"、结果怎么"回填"；
- 循环：请求 → 执行 → 回填 → 再请求，直到模型不再要工具、给出最终回答。

LangChain4j 把协议翻译成了三个类型，循环则由 AiServices 引擎自动驱动。

## 线上协议：三步看懂报文

以 OpenAI 兼容格式为例（LangChain4j 的 `OpenAiStreamingChatModel` 底层就是这套）：

![图 1：Function Calling 的线上协议](/images/svg/langchain4j-tool-wire-protocol.svg)

**第一步：请求里声明工具**。每个工具是名称 + 自然语言描述 + 参数 JSON Schema——模型是靠**读描述**来决定什么时候调、怎么传参的，所以描述质量直接决定调用质量：

```json
{
  "tools": [{
    "type": "function",
    "function": {
      "name": "list_resources",
      "description": "按行政区划代码查询该区已发布的数据资源清单",
      "parameters": {
        "type": "object",
        "properties": {
          "divisionCode": { "type": "string", "description": "六位行政区划代码" }
        },
        "required": ["divisionCode"]
      }
    }
  }]
}
```

**第二步：模型请求调用**。注意 `arguments` 是一段 **JSON 字符串**，不是结构化对象——模型在"手写 JSON"，写歪了要靠你解析时兜底：

```json
{
  "role": "assistant",
  "tool_calls": [{
    "id": "call_1",
    "function": { "name": "list_resources", "arguments": "{\"divisionCode\":\"350100\"}" }
  }]
}
```

**第三步：结果回填**。以 `role: "tool"` 的消息追加回消息列表，`tool_call_id` 与请求配对，`content` 是结果 JSON——模型下一轮就能"看到"执行结果。

LangChain4j 的对应关系：声明 ↔ `ToolSpecification`，请求 ↔ `AiMessage.toolExecutionRequests()`（每个含 id/name/arguments），回填 ↔ `ToolExecutionResultMessage`。

## 声明工具的三种姿态

![图 2：工具的三种接入姿态](/images/svg/langchain4j-tool-binding.svg)

### 姿态一：@Tool 注解，方法即工具（默认推荐）

```java
class DataTools {

    @Tool("按行政区划代码查询该区已发布的数据资源清单")
    public List<String> listResources(
            @P("六位行政区划代码，如 350100") String divisionCode) {
        return resourceService.listByDivision(divisionCode);
    }
}

AiServices.builder(Assistant.class)
        .streamingChatModel(model)
        .tools(new DataTools())        // 一个对象里所有 @Tool 方法自动注册
        .build();
```

参数类型自动生成 JSON Schema，`@P` 补充参数含义。适合工具固定、和业务 Bean 一一对应的场景。

### 姿态二：手工绑定，目录可动态（进阶）

当工具来自**运行时注册表**、需要按用户/智能体**过滤可用集合**时，用底层 API 手工装配：

```java
Map<ToolSpecification, ToolExecutor> tools = new LinkedHashMap<>();
for (ToolDefinition tool : toolRegistry.listByCodes(agent.getToolIds())) {  // 按智能体授权过滤
    ToolSpecification spec = ToolSpecification.builder()
            .name(tool.getCode())
            .description(tool.getDescription())
            .build();
    tools.put(spec, (request, memoryId) ->
            execute(request.name(), parseArguments(request.arguments())));
}

AiServices.builder(Assistant.class)
        .streamingChatModel(model)
        .tools(tools)
        .maxSequentialToolsInvocations(5)   // 轮数上限，防"套娃"调用
        .build();
```

`ToolExecutor` 只有两个参数（请求 + memoryId）、一个 String 返回值——返回的字符串就是回填给模型的 `content`，**内容完全由你决定**，这是错误处理的关键钩子（见下文）。

### 姿态三：混合 + 钩子

注解工具与手工工具可以合并在一次 `tools(...)` 里；执行过程经 `TokenStream` 的钩子暴露：

```java
stream.beforeToolExecution(before -> {
    String name = before.request().name();                  // 工具名
    Map<String, Object> args = parse(before.request().arguments());
    emitter.send(toolEvent(name, args));                    // 推前端"正在查询资源清单…"
})
.onToolExecuted(execution ->
        log.info("{} 执行完成: {}", execution.request().name(), execution.result()));
```

`beforeToolExecution` 在执行前触发（适合前端提示、审计），`onToolExecuted` 在结果就绪后触发（适合日志、监控）。

## 执行循环：框架替你转的轮子

声明完工具，AiServices 引擎在每次对话里自动驱动这个循环：

![图 3：工具调用循环](/images/svg/langchain4j-tool-loop.svg)

逐帧解释：

1. **带着工具声明调用模型**——tools 参数随消息列表一起发；
2. 模型返回的 `AiMessage` **要么是工具请求，要么是最终回答**，判断依据是 `hasToolExecutionRequests()`；
3. 有请求就**逐个执行**：一条 AiMessage 可能同时请求多个工具（并行调用），按顺序执行；
4. 每个结果包成 `ToolExecutionResultMessage` 追加进消息列表，**再次调用模型**；
5. 循环直至模型不再请求工具，进入最终流式输出；
6. `maxSequentialToolsInvocations(N)` 给循环兜底——模型偶尔会陷入反复调用不收敛，硬上限保证一定收尾。

如果不用 AiServices、直接拿 `ChatModel` 手写这个循环也完全可行（我就写过一版：每轮同步拿决策、执行、回填、直到无请求再切流式输出）——但记忆装载、工具回填、检索注入很快会在手写代码里纠缠成一团。框架循环的价值就是把这三件事解耦到管道里。

## 错误处理：最重要的一节

工具执行失败时你有一个战略选择：**抛异常，还是回填 error**。

默认行为是异常上抛——整次生成中断，用户等了几十秒收到一个报错。更优雅的策略是把失败翻译成模型能理解的信息：

```java
private String execute(String toolCode, Map<String, Object> params) {
    Map<String, Object> result;
    try {
        result = dispatcher.dispatch(toolCode, params);
    } catch (Exception e) {
        // 不抛异常：失败也是"信息"，让模型自己决定怎么向用户解释
        result = Collections.singletonMap("error", "工具执行失败: " + e.getMessage());
    }
    return objectMapper.writeValueAsString(result);
}
```

配套的两道防线：

- **参数解析兜底**：`arguments` 是模型手写的 JSON 字符串，可能不合法——解析失败别炸，降级成 `{"rawArguments": "..."}` 让模型看到自己的原始输出；
- **轮数上限**：`maxSequentialToolsInvocations(5)`，极端情况的最后防线。

一个安全提醒：工具的 description 会进模型上下文，**不要在里面放敏感信息**；工具命名保持最小权限——模型只会调用你声明过的工具，但"声明了"就等于"授权了"。

## 小结

- Function Calling 的本质：模型只输出"调用请求"（JSON 字符串），执行和回填都是你的代码，协议由框架翻译成 `ToolSpecification` / `ToolExecutionRequest` / `ToolExecutionResultMessage`；
- 三种接入姿态：`@Tool` 注解（快）、`tools(Map)` 手工绑定（动态/可过滤）、两者混合；钩子 `beforeToolExecution` / `onToolExecuted` 负责推送与审计；
- 循环由 AiServices 驱动：请求 → 执行 → 回填 → 再调，`maxSequentialToolsInvocations` 兜底；
- 错误处理选"回填 error"而非"抛异常"，失败信息让模型体面转述；参数解析永远留兜底。

下一篇是系列收官：**RAG 检索增强**——知识怎么切碎、怎么变成向量、检索器怎么接进 AiServices 管道的"检索增强"那一段。

> 系列目录：1. [对话的底层执行](/2026/08/17/articles/AI/01-langchain4j-chat-internals/) → 2. 工具调用 Function Calling（本篇）→ 3. [从零构建 RAG](/2026/08/17/articles/AI/03-langchain4j-rag/)
