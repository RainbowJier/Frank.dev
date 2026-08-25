---
title: Elasticsearch 从零到一（06）：Spring Boot 整合与 Java API Client 实战
date: 2026-08-25 10:20:00
categories:
  - 教程
tags:
  - Elasticsearch
  - Spring Boot
  - Java API Client
  - Java
  - Testcontainers
description: 面向 Java 开发者演示 Elasticsearch 8.x 官方 Java API Client 在 Spring Boot 中的 HTTPS、认证、超时配置，以及类型化搜索、聚合、高亮、分页和测试边界。
keywords:
  - Elasticsearch Java API Client
  - Spring Boot Elasticsearch 8
  - Elasticsearch HTTPS 认证
  - Testcontainers Elasticsearch
  - Elasticsearch Java 聚合
lang: zh-CN
---
> **适合人群**：已经掌握基本 Query DSL，想在 Spring Boot 项目中以可维护方式调用 Elasticsearch 8.x 的 Java 开发者。
> 本文使用 `blog_articles` 演示。业务主键 `id` 与 ES `_id` 保持一致；Java 代码省略了包名和常规 getter/setter，以突出客户端使用方式。
上一章 {% post_link articles/Elasticsearch/05-elasticsearch-aggregations-pagination 'Elasticsearch 从零到一（05）：聚合、筛选面板与深分页方案' %} 通过 JSON 请求实现了聚合和分页。 生产应用不应该把字符串 JSON 到处拼接：连接、安全、超时、字段名、错误语义和结果映射都需要集中治理。
## 一、选择正确的 ES 8 Java 客户端
ES Java 生态中有几个历史名称：
| 客户端 | 现状 | 新项目建议 |
| --- | --- | --- |
| Transport Client | 依赖集群内部传输协议，早已移除 | 不使用 |
| RestHighLevelClient | 旧的 REST 高层客户端，已弃用 | 仅维护存量代码 |
| Spring Data Elasticsearch Repository | Spring Data 抽象，适合有限 CRUD | 作为补充，不覆盖复杂 DSL |
| Elasticsearch Java API Client | 官方 ES 8 类型化客户端 | 新项目优先 |
官方 Java API Client 位于 `co.elastic.clients:elasticsearch-java`。 它建立在低层 `RestClient` 之上，通过 `ElasticsearchTransport` 传输 JSON，并由代码生成的 builder 提供类型化的 Query、Request 和 Response。 这不意味着所有 DSL 都要被隐藏；客户端同样允许使用明确的字段路径和 lambda builder，只是能尽早发现很多字段类型、枚举和结构错误。
![图1：Spring Boot 中从 HTTP 请求到官方 Java API Client 和 ES 集群的调用边界](spring-boot-es-architecture.svg)
Maven 依赖应让客户端版本与集群主版本保持兼容，并交由依赖管理统一控制：
```xml
<properties>
  <elasticsearch-java.version>8.15.5</elasticsearch-java.version>
</properties>
<dependencies>
  <dependency>
    <groupId>co.elastic.clients</groupId>
    <artifactId>elasticsearch-java</artifactId>
    <version>${elasticsearch-java.version}</version>
  </dependency>
  <dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-web</artifactId>
  </dependency>
</dependencies>
```
版本号仅是示例；请按项目的 ES 8.x 服务端版本、Spring Boot BOM 和安全补丁策略锁定。 不要同时引入旧 High Level Client 和新 Client 来“逐步试用”，以免出现重复的 HTTP 连接池、不同序列化配置与排障入口。
## 二、把连接参数放到配置而不是业务代码
本地开发、测试、预发与生产的 CA、地址和凭据都不同。 先定义受校验的配置对象：
```java
@ConfigurationProperties(prefix = "app.elasticsearch") @Validated
public record ElasticsearchProperties( @NotBlank String endpoint,
@NotBlank String username, @NotBlank String password,
@NotNull Duration connectTimeout, @NotNull Duration socketTimeout
) {
}
```
`application.yml` 中使用环境变量注入敏感值，仓库中只保留变量名或安全的本地默认值：
```yaml
app:
  elasticsearch:
    endpoint: ${ES_ENDPOINT:https://localhost:9200}
    username: ${ES_USERNAME:elastic}
    password: ${ES_PASSWORD:change-me}
    connect-timeout: 2s
    socket-timeout: 5s
```
ES 8 默认安全启用，HTTPS 不是“把 URL 改成 https”就够了。 JVM 必须信任签发 HTTP 证书的 CA；生产环境应使用受管的 truststore 或受控的 CA PEM，不应关闭证书校验。
下面示例从 PEM 创建 `SSLContext`，注册 Basic Auth、连接超时和读超时，并以 Spring Bean 生命周期关闭连接：
```java
@Configuration @EnableConfigurationProperties(ElasticsearchProperties.class)
public class ElasticsearchClientConfig {
@Bean(destroyMethod = "close") RestClient restClient(ElasticsearchProperties properties, SSLContext sslContext) {
HttpHost host = HttpHost.create(properties.endpoint()); CredentialsProvider credentials = new BasicCredentialsProvider();
credentials.setCredentials( AuthScope.ANY,
new UsernamePasswordCredentials( properties.username(), properties.password().toCharArray()
) );
return RestClient.builder(host) .setHttpClientConfigCallback(http -> http
.setSSLContext(sslContext) .setDefaultCredentialsProvider(credentials))
.setRequestConfigCallback(request -> request .setConnectTimeout(Timeout.ofMilliseconds(
Math.toIntExact(properties.connectTimeout().toMillis()))) .setResponseTimeout(Timeout.ofMilliseconds(
Math.toIntExact(properties.socketTimeout().toMillis())))) .build();
} @Bean
    ElasticsearchTransport elasticsearchTransport(RestClient restClient) {
return new RestClientTransport(restClient, new JacksonJsonpMapper()); }
@Bean ElasticsearchClient elasticsearchClient(ElasticsearchTransport transport) {
return new ElasticsearchClient(transport); }
}
```
上述 `sslContext` 可由独立 Bean 从部署的 CA 文件或 truststore 构建。 指纹校验、API Key 与服务账号 token 也能替代 Basic Auth；选择取决于部署平台。无论哪种认证方式，都不要打印 `Authorization`、密码、完整 cursor 或原始异常响应。
超时也不该只有一个数字：连接超时约束网络建立，响应超时约束单次 HTTP 等待；批量重建和用户搜索应有不同的调用级超时与线程隔离。
## 三、建立明确的文档、条件和响应模型
ES 文档模型不应直接成为 Controller 的出入参。 先用一个对齐 Mapping 的文档类型承接 `_source`：
```java
public record BlogArticleDocument( Long id,
String title, String content,
String category, List<String> tags,
String status, Long viewCount,
Instant publishedAt ) {
}
```
再定义面向接口的查询条件；这里把排序字段限制成枚举，防止客户端借字段名改变检索行为：
```java
public record ArticleSearchCriteria( String keyword,
String category, List<String> tags,
Instant publishedFrom, Instant publishedTo,
ArticleSort sort, String cursor,
Integer size ) {
} public enum ArticleSort {
RELEVANCE, NEWEST, MOST_VIEWED }
```
`cursor` 是服务端签发的不透明令牌，其中保存 PIT ID 和上一页的排序值。 不要把 `from`、任意 `sortField`、PIT ID 或 ES DSL 暴露成公共 API 参数。
## 四、使用类型化 Query 与 SearchRequest
服务层可将每一个可选条件转成 Query，最后再组合成 `bool`。 以下代码故意把“全文评分条件”和“精确过滤条件”分开，和 {% post_link articles/Elasticsearch/04-elasticsearch-query-dsl 'Elasticsearch 从零到一（04）：Query DSL、相关性与高亮搜索' %} 的 DSL 语义一致：
```java
private Query buildQuery(ArticleSearchCriteria criteria) {
List<Query> must = new ArrayList<>(); List<Query> filters = new ArrayList<>();
    if (StringUtils.hasText(criteria.keyword())) {
must.add(MultiMatchQuery.of(query -> query .query(criteria.keyword())
.fields("title^3", "content") .type(TextQueryType.BestFields)
)._toQuery()); }
filters.add(TermQuery.of(query -> query .field("status")
.value("PUBLISHED") )._toQuery());
    if (StringUtils.hasText(criteria.category())) {
filters.add(TermQuery.of(query -> query .field("category")
.value(criteria.category()) )._toQuery());
} if (!CollectionUtils.isEmpty(criteria.tags())) {
filters.add(TermsQuery.of(query -> query .field("tags")
.terms(values -> values.value( criteria.tags().stream().map(FieldValue::of).toList()
)) )._toQuery());
} if (criteria.publishedFrom() != null || criteria.publishedTo() != null) {
filters.add(DateRangeQuery.of(query -> query .field("publishedAt")
.gte(criteria.publishedFrom() == null ? null : criteria.publishedFrom().toString()) .lt(criteria.publishedTo() == null ? null : criteria.publishedTo().toString())
)._toQuery()); }
return BoolQuery.of(query -> query.must(must).filter(filters))._toQuery(); }
```
`term` 针对 `keyword` 字段精确匹配，`multi_match` 针对全文字段。 字段名仍是字符串，因此应集中在常量或字段注册表中；不要让每个 Controller 私自写一套 `"publishedAt"`。
![图2：HTTP 条件到类型化 Query、SearchRequest 与 SearchResponse 的映射关系](java-query-object-mapping.svg)
下面为三种业务排序构造稳定的 `SortOptions`。 相关性排序也追加 `id`，防止相同分值的记录在连续翻页时位置不确定：
```java
private List<SortOptions> buildSorts(ArticleSort sort) {
    return switch (sort) {
case RELEVANCE -> List.of( SortOptions.of(option -> option.score(score -> score.order(SortOrder.Desc))),
SortOptions.of(option -> option.field(field -> field.field("id").order(SortOrder.Desc))) );
case NEWEST -> List.of( SortOptions.of(option -> option.field(field -> field.field("publishedAt").order(SortOrder.Desc))),
SortOptions.of(option -> option.field(field -> field.field("id").order(SortOrder.Desc))) );
case MOST_VIEWED -> List.of( SortOptions.of(option -> option.field(field -> field.field("viewCount").order(SortOrder.Desc))),
SortOptions.of(option -> option.field(field -> field.field("id").order(SortOrder.Desc))) );
}; }
```
## 五、一次搜索同时返回列表、高亮与筛选
下面的 `search` 方法展示一个完整骨架：
1. 创建或复用短生命周期 PIT；
2. 构造类型化 query、sort、highlighter 和 aggregation；
3. 传入上次 cursor 的 `searchAfter`；
4. 将 `SearchResponse` 转换为自己的响应 DTO。
```java
public ArticleSearchResponse search(ArticleSearchCriteria criteria) {
CursorState cursor = cursorCodec.decodeOrCreate(criteria.cursor()); String pitId = cursor.pitId() != null ? cursor.pitId() : openPit();
    try {
SearchRequest.Builder request = new SearchRequest.Builder() .size(normalizeSize(criteria.size()))
.query(buildQuery(criteria)) .sort(buildSorts(criteria.sort()))
.pit(pit -> pit.id(pitId).keepAlive("1m")) .trackTotalHits(total -> total.enabled(true))
.highlight(highlight -> highlight .preTags("<em>")
.postTags("</em>") .fields("title", field -> field)
.fields("content", field -> field.fragmentSize(120).numberOfFragments(1))) .aggregations("categories", aggregation -> aggregation
.terms(terms -> terms.field("category").size(10))) .aggregations("tags", aggregation -> aggregation
.terms(terms -> terms.field("tags").size(20))); if (cursor.sortValues() != null) {
request.searchAfter(cursor.sortValues()); }
SearchResponse<BlogArticleDocument> response = client.search( request.build(), BlogArticleDocument.class
); return responseMapper.toSearchResponse(response, criteria, pitId);
    } catch (IOException exception) {
throw ElasticsearchSearchException.from(exception); }
}
```
PIT 的打开与关闭可使用类型化 API：
```java
private String openPit() {
    try {
return client.openPointInTime(request -> request .index("blog_articles")
.keepAlive("1m") ).id();
    } catch (IOException exception) {
throw ElasticsearchSearchException.from(exception); }
} public void closePit(String pitId) {
    if (pitId == null) {
return; }
    try {
client.closePointInTime(request -> request.id(pitId)); } catch (IOException exception) {
log.warn("Failed to close Elasticsearch PIT", exception); }
}
```
生产代码还需保证 cursor 过期、用户主动结束浏览、异常中断时的清理策略。 一次请求可通过 `keep_alive` 续期，但不能将 PIT 永久留给客户端。
### 5.1 映射 hit、高亮和聚合 buckets
不要假设 `_source` 一定存在，也不要假设每个字段都有高亮片段。 当没有高亮时，展示原始标题；当 `hits.total()` 为 `null` 时，使用“未精确计数”的降级文案。
```java
private ArticleItem toItem(Hit<BlogArticleDocument> hit) {
BlogArticleDocument source = Objects.requireNonNull(hit.source(), "missing _source"); List<String> titleFragments = hit.highlight().getOrDefault("title", List.of());
String displayTitle = titleFragments.isEmpty() ? source.title()
: String.join("", titleFragments); return new ArticleItem(source.id(), displayTitle, source.category(), source.publishedAt());
} private List<FilterBucket> categoryBuckets(SearchResponse<?> response) {
Aggregate aggregate = response.aggregations().get("categories"); if (aggregate == null || !aggregate.isSterms()) {
return List.of(); }
return aggregate.sterms().buckets().array().stream() .map(bucket -> new FilterBucket(bucket.key().stringValue(), bucket.docCount()))
.toList(); }
```
高亮标签是 HTML 片段，不能把用户输入原样拼回页面。 服务端和前端都必须按渲染框架的 XSS 规则处理；通常将 ES 返回的 `em` 标签限定为白名单，或传递 fragments 再由前端安全标记。
## 六、分页、错误与可观测性
接口建议返回自己的 `nextCursor`，不要直接返回 `SearchResponse`：
```java
public record ArticleSearchResponse( List<ArticleItem> items,
long total, String nextCursor,
List<FilterBucket> categories, List<FilterBucket> tags
) {
}
```
`nextCursor` 应从最后一个 `Hit.sort()` 和本次 PIT ID 创建，最好加签名、过期时间、查询哈希和租户信息。 当用户调整关键词、排序或筛选项时，旧 cursor 不能复用，应从新 PIT 的第一页开始。
异常处理不要只捕获 `Exception` 后返回空数组：
| 失败类别 | API 处理 | 运行策略 |
| --- | --- | --- |
| 参数非法、cursor 被篡改 | `400 Bad Request` | 不请求 ES |
| PIT 过期、索引不存在 | `409` 或明确业务错误 | 提示重新搜索并报警 |
| 认证、TLS 配置错误 | `503 Service Unavailable` | 禁止泄露凭据，立即排查部署 |
| 连接超时、节点不可用 | `503` | 有限重试、熔断、降级 |
| 查询语法或 Mapping 错误 | `500` | 记录 request ID 和安全字段日志 |
写入请求的重试必须结合幂等 ID、版本控制和上游事件语义；数据同步的完整设计会在 {% post_link articles/Elasticsearch/07-elasticsearch-mysql-sync 'Elasticsearch 从零到一（07）：MySQL 数据同步、幂等与一致性设计' %} 展开。
监控至少应记录 ES 调用耗时、错误类型、超时次数、PIT 数量、每页 size 与 aggregation bucket 数。 日志要携带 trace ID、索引别名和请求摘要，但不要记录全文正文、密码、token 或完整用户搜索词。
## 七、Repository 与原生 Client 如何分工
Spring Data Elasticsearch 的 Repository 能快速完成简单实体 CRUD、派生查询与少量声明式查询。 当字段模型稳定、查询单一、团队已经熟悉 Spring Data 时，它可以减少样板代码。
但搜索服务往往需要 `multi_match`、`bool.filter`、PIT、`search_after`、高亮、多层聚合、别名和批量操作。 这些功能通过原生官方 Client 更直观、更贴近 ES 8 API，也便于在升级时对照官方文档。
一个实用边界是：
- 管理后台的简单按 ID 读写可选择 Repository。
- 面向用户的搜索、筛选、补全、导出、索引维护统一封装在 native-client Service。
- 不在同一条核心检索链路混用两种抽象，避免实体 Mapping 和序列化规则分叉。
## 八、用 Testcontainers 验证真实边界
Mock `ElasticsearchClient` 适合单元测试 Service 的分支，但无法验证 Mapping、TLS、JSON 序列化、聚合路径和 ES 版本兼容性。 对这些边界使用 Testcontainers 启动真实 ES 8 镜像：
```java
@Testcontainers @SpringBootTest
class ArticleSearchIntegrationTest {
@Container static ElasticsearchContainer elasticsearch = new ElasticsearchContainer(
"docker.elastic.co/elasticsearch/elasticsearch:8.15.5" ).withEnv("xpack.security.enabled", "false");
@DynamicPropertySource static void elasticsearchProperties(DynamicPropertyRegistry registry) {
registry.add("app.elasticsearch.endpoint", elasticsearch::getHttpHostAddress); registry.add("app.elasticsearch.username", () -> "unused");
registry.add("app.elasticsearch.password", () -> "unused"); }
@Test void shouldReturnHighlightedArticleAndCategoryFacet() {
        // 创建测试索引、写入固定文档、refresh、调用搜索服务并断言结果。
} }
```
测试关闭安全仅限隔离容器，不能复制到生产。 若生产配置要求 HTTPS 与认证，至少保留一组集成测试验证 CA 信任、账号或 API Key 注入；测试还应覆盖空聚合、相同排序值、cursor 过期和索引别名切换。
## 九、总结与练习
- ES 8 新项目优先使用官方 Java API Client；旧客户端和 Repository 都有明确的历史或能力边界。
- Spring Boot 中集中配置 HTTPS 信任、认证、连接/响应超时和 Bean 关闭，不把凭据或客户端构造散落到业务层。
- 使用类型化 Query、SearchRequest、SearchResponse 构造搜索，并由 Service 映射为稳定的业务 DTO。
- 搜索接口要把稳定排序、PIT、`search_after`、高亮空值和 aggregation bucket 作为一体处理。
- Testcontainers 验证真实 ES 边界，Mock 则保留给快速单元测试。
> **思考与练习**
>
> 1. 将 `ArticleSort` 扩展为“相关性优先但近 30 天加权”，并说明哪些规则应放在 `function_score`，哪些应在应用层排序。
> 2. 为 cursor 设计签名负载，确保用户无法把自己的 PIT ID 换成其他租户的 PIT ID。
> 3. 写一个 Testcontainers 测试：插入两篇同一 `publishedAt` 的文章，验证以 `id` 作为第二排序字段时不会重复翻页。
**下一篇预告**：ES 写入从来不只是一次 `client.index` 调用。下一篇回到 MySQL 事实来源，讨论双写、消息队列、Binlog CDC、幂等、补偿与别名重建。详见 {% post_link articles/Elasticsearch/07-elasticsearch-mysql-sync 'Elasticsearch 从零到一（07）：MySQL 数据同步、幂等与一致性设计' %}。
