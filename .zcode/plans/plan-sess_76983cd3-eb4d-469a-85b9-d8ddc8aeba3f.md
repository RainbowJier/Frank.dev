## 目标
新增《Java 并发进阶（05）：线程池》教程文章到既有 `Java` 专栏。文章将直接承接第 04 篇的预告，归档页会按目录自动归入 Java 分组，因此不改主题模板或站点分类配置。

## 实施内容
1. 新建 `source/_posts/articles/Java/05-java-thread-pool.md`。
   - Front matter 沿用当前 Java 并发系列约定：`categories: 教程`，标签为 Java、多线程、并发编程，`lang: zh-CN`。
   - 使用标题 `Java 并发进阶（05）：线程池`，说明其覆盖线程复用、`ThreadPoolExecutor` 执行逻辑、队列和拒绝策略、参数调优与生产实践。
   - 正文维持第 04 篇的叙事和结构：系列承接说明、问题切入、机制拆解、完整 Java 示例、常见误区/练习、面试速答和结语。
   - 核心内容将包括：为什么不能直接 `new Thread()`；`ThreadPoolExecutor` 七项构造参数；`execute()` 的“核心线程 → 入队 → 非核心线程 → 拒绝”决策；`ArrayBlockingQueue`、`LinkedBlockingQueue`、`SynchronousQueue` 的适用边界；内置与自定义拒绝策略；CPU/IO/批处理场景下的容量估算原则；具备命名线程、有界队列、日志化拒绝处理、优雅关闭和异常可观测性的生产级创建方式；`Executors` 默认工厂、无界队列、任务异常、`ThreadLocal` 清理、线程池互相等待等常见问题。
   - 使用严格路径的 Hexo `post_link` 串联第 04 篇，并在结尾给出 01–05 的系列阅读顺序。

2. 新建文章资源目录 `source/_posts/articles/Java/05-java-thread-pool/`，生成三张自包含科研风格 SVG 正文配图。
   - `java-thread-pool-execute-flow.svg`：`execute()` 的四段式决策流程，解释核心线程、队列、扩容和拒绝发生的条件。
   - `java-thread-pool-component-map.svg`：以 `ThreadPoolExecutor` 为主体的标注式原理图，标清 worker、工作队列、线程工厂和拒绝处理器的职责。
   - `java-thread-pool-queue-comparison.svg`：A/B 双面板说明无界队列使最大线程数与拒绝策略失去保护作用，以及有界队列如何建立背压。
   - SVG 将按 `research-svg` 规范使用 820px 白底画布、NPG 色板、细边框、期刊式图注，并逐条检查图中文字不超出容器；Markdown 以相对文件名引用图片。

3. 更新 `source/about/index.md` 的系列导航。
   - 将“Java 多线程从零到一”从 4 篇更新为 5 篇，并在现有第 04 篇后增加第 05 篇链接。
   - 该文件已有工作区改动，我会仅合并这段系列目录中的必要行，不覆盖其他既有修改。

## 校验
1. 对每个 SVG 使用 Python `xml.etree.ElementTree` 解析，确认 XML 合法。
2. 复核文章的 `post_link`、资源相对路径、围栏代码与 Front Matter。
3. 运行 `pnpm build`（项目定义为 `hexo generate`）验证 Hexo 生成、Nunjucks 链接和文章资源处理。该命令会生成站点产物，但不执行清理、提交或推送。

完成后会报告新增文件、实际构建结果及未触碰的既有工作区改动。