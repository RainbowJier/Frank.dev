---
title: 福建国土空间基础信息平台-数据中心
date: 2026-08-17 10:00:00
categories:
  - 项目经历
tags:
  - Java
  - 微服务
  - RabbitMQ
  - GIS
period: 2026.01 - 2026.06
role: 后端开发（兼运营端前端）
stack:
  - Spring Cloud Alibaba
  - GDAL 3.7.2 (JNI)
  - PostgreSQL
  - RabbitMQ
  - Redis
  - MinIO
  - Vue 3
description: 平台核心数据服务模块，负责空间数据资源共享下载：GDB 异步导出、加密分发与大文件断点续传链路的设计与落地。
---

## 项目背景

国土空间基础信息平台是福建省自然资源领域的底座平台，汇聚了生态保护红线、城镇开发边界、村庄规划、详细规划等几十类空间数据（ArcGIS GDB 格式）。数据中心是其中的核心数据服务模块，负责空间数据资源管理、共享下载、GDB 文件处理与地图服务注册。

数据下载是我在这个模块里完整负责的一个功能：业务用户在页面上选择数据子类别与行政区划，提交下载请求后，系统裁剪 GDB 源文件、加密打包、上传对象存储，最后用户从下载记录里取回文件。听起来是一条简单链路，但 GIS 数据动辄几百 MB 到 2GB，裁剪耗时从几十秒到几分钟不等，同步接口根本撑不住——这决定了整个功能"异步任务"的形态。

## 我的职责

- 独立完成数据下载功能的**设计文档**（功能边界、核心流程、表结构、接口清单、风险点），先评审后开发；
- 后端全链路开发：resources 服务的下载记录、下载配置、行政区划中转、用户统计四个子域，以及 RabbitMQ 消费侧；
- 对接 GDAL 服务（Java JNI 调用）完成 GDB 裁剪导出，含部分底层驱动兼容性问题修复；
- 运营管理端前端（Vue 3 + Element Plus）：下载配置、区划划转、下载记录三个页面，以及大文件断点续传下载。

## 总体架构

整个功能跨了四个边界：运营端前端、resources 服务、异步处理链路、存储与登记。resources 服务内部按 DDD 分层组织（adapter → application → domain → infrastructure），网关接口隔离了 MyBatis-Plus、Feign、MinIO 这些具体依赖：

![图 1：数据下载功能端到端分层架构](/images/svg/data-download-architecture.svg)

几个关键的架构决策：

- **异步化**：GDB 裁剪是主要性能瓶颈，请求侧只做"校验 + 落库 + 投递消息"三件事就返回记录 ID，重活全部交给 MQ 消费者；
- **文件统一管理**：导出文件上传 MinIO 后，元数据统一登记到 OPS 服务的 `file_info` 表，下载记录只存 `file_id` 关联，文件名、大小在查询时实时填充——避免文件信息双写不一致；
- **队列按数据类别拆分**：基础类（BASIC）、新核心类（CORE）、旧核心类（CORE_OLD）三类数据走三条独立队列，互不积压，且都支持消息优先级。

## 一次下载请求的生命周期

用户点击"提交下载"之后，一条记录会经历 PROCESSING → EXPORTING → SUCCESS/FAILED 四个状态。完整链路如下：

![图 2：一次下载请求的生命周期与状态流转](/images/svg/data-download-lifecycle.svg)

### 请求侧：幂等 + 权限 + 审计

入口 Controller 上三个注解各司其职，`@Idempotent` 是我自己在 core-aop 模块里实现的通用能力：

```java
@OperationLog(description = "提交数据下载请求", category = OperationLogCategory.BUSINESS)
@PostMapping("/request")
@Idempotent(key = "#req.configId + ':' + #req.downloadType", expireSeconds = 300,
        message = "相同的下载请求已在处理中，请稍后再试")
@CheckResourcePermission(type = ResourcesTypeEnum.DATA_DOWNLOAD,
        action = ActionCodeEnum.INVOKE, resourceId = "#req.configId")
public AjaxResult<Long> requestDownload(@Valid @RequestBody DataDownloadRequestReq req) {
    return AjaxResult.success(dataDownloadRecordService.requestDownload(req));
}
```

`@Idempotent` 基于 Redis SETNX 实现，切面里用 SpEL 解析 key 并自动拼接用户 ID 做隔离；业务异常时释放 key 允许用户修正重试，系统异常则保留防止无限重试。配合消费侧"完成后删 key"，同一个用户对同一配置+下载方式的请求，5 分钟内只会产生一条记录。

### 消费侧：CAS 抢占防并发重投递

MQ 的 at-least-once 语义意味着消息可能重投。如果两个消费者同时处理同一条记录，轻则重复导出浪费资源，重则文件互相覆盖。我的解法是一行 SQL 级别的 CAS：

```java
@Override
public boolean claimExporting(Long id) {
    LambdaUpdateWrapper<DataDownloadRecord> wrapper = new LambdaUpdateWrapper<>();
    wrapper.eq(DataDownloadRecord::getId, id)
            .eq(DataDownloadRecord::getDownloadStatus, DataDownloadStatusEnum.PROCESSING.name())
            .set(DataDownloadRecord::getDownloadStatus, DataDownloadStatusEnum.EXPORTING.name());
    return update(wrapper);   // UPDATE ... WHERE status = 'PROCESSING'，只有一个消费者能改成功
}
```

`WHERE status = 'PROCESSING'` 保证了同一记录至多一个消费者能进入导出阶段，抢不到的直接 ack 跳过。成功路径上，"更新记录 + 配置下载次数 + 用户统计"三步放在 `TransactionTemplate` 里原子提交，而耗时的 GDAL 远程调用放在事务外，避免长事务：

```java
private void processDownload(DataDownloadMqMessage message, DataDownloadRecord record) {
    // 1. 远程调用 GDAL 导出（事务外，避免长事务）
    DataDownloadGdbExportResp exportResult = doExport(message);

    // 2. 更新记录 + 统计（事务内保证原子性）
    transactionTemplate.execute(status -> {
        record.setDownloadStatus(DataDownloadStatusEnum.SUCCESS.name());
        record.setFileId(exportResult.getFileId());
        record.setFilePassword(exportResult.getFilePassword());
        record.setLayerCount(exportResult.getLayerCount());
        record.setFeatureCount(exportResult.getFeatureCount());
        record.setFinishTime(LocalDateTime.now());
        dataDownloadRecordGateway.updateById(record);
        dataDownloadConfigGateway.incrementDownloadCount(record.getConfigId());
        dataDownloadUserStatisticsService.incrementDownloadCount(
                record.getUserId(), record.getDataCategory(), message.getDataSubtype());
        return null;
    });
}
```

无论成功失败，最后都删除幂等 key，把"再提交一次"的资格还给用户。

## 消息队列拓扑与可靠性

三条业务队列共用一个 Topic 交换机，按 routing key 分流，每条队列都配置了优先级参数和死信路由：

![图 3：RabbitMQ 队列拓扑与死信路由](/images/svg/data-download-mq-topology.svg)

```java
@Bean
public Queue basicDownloadQueue() {
    return QueueBuilder.durable(BASIC_DOWNLOAD_QUEUE)
            .withArgument("x-max-priority", 10)
            .withArgument("x-dead-letter-exchange", DLX_EXCHANGE)
            .withArgument("x-dead-letter-routing-key", DLX_ROUTING_KEY)
            .build();
}
```

可靠性设计里有三个容易被忽略的细节：

- **死信兜底**：消费失败的消息经 3 次重试耗尽后自动路由到 `dlx.queue`，留待人工或定时任务处理，而不是无限重试打爆消费者；
- **启动恢复**：服务重启时，停留在 PROCESSING/EXPORTING 的记录已经没有消费者会再处理了。`ApplicationRunner` 里一条批量 UPDATE 把它们全部标记为 FAILED（原因写"服务重启，处理中断"），用户看到明确失败好过永远"处理中"；
- **行政区划中转**：用户选择的是平台行政区划代码，而 GDB 数据里的过滤字段用的是另一套编码体系，中间靠 `data_download_admin_division_transfer` 映射表转换，映射规则在运营端可维护。

## 文件链路与大文件分发

GDAL 服务收到导出请求后，按行政区划过滤字段裁剪 GDB、重新校验图层与要素数量，然后生成随机 8 位解压密码，把 GDB 压缩成加密 ZIP 上传 MinIO 并登记 `file_info`，返回 fileId。资源侧的上传同样考虑了失败回滚：

```java
// 登记 file_info 失败时，回滚已上传的 MinIO 对象，避免孤儿文件
try {
    OpsFileInfo info = opsFileGateway.register(fileName, result.getFileUrl(), size, "application/zip");
    return info.getId();
} catch (Exception e) {
    try {
        minioUtils.deleteFile(bucketName, objectName);
    } catch (Exception ex) {
        log.warn("回滚MinIO文件失败: {}/{}", bucketName, objectName, ex);
    }
    throw e;
}
```

下载侧是最花心思的部分。GDB 文件普遍几百 MB，一次性 blob 下载在网络抖动时就得从头再来，所以我实现了基于 **HTTP Range + IndexedDB** 的断点续传：

![图 4：前端断点续传：HTTP Range 分片 + IndexedDB 持久化](/images/svg/data-download-resumable.svg)

流程是：先调 OPS 接口换取 MinIO 预签名 URL（浏览器直连对象存储，不占服务带宽），然后按 10MB 分片、6 并发发 Range 请求；每个分片校验大小后写入 IndexedDB 持久化（配额不足时降级内存），页面刷新后已下载的分片直接复用；全部就绪后合并 Blob 触发保存。分片失败自动重试，预签名过期自动刷新重签。进度实时回显在按钮文案上（"断点下载 45%"），体验上接近网盘客户端。

## 安全设计

- **IDOR 防护**：查询详情、删除记录时校验 `checkOwnership`，非记录所有者直接拒绝；
- **越权校验**：旧核心类下载按"用户行政区划代码是否为传入代码的前缀"判断层级权限，市级用户拿不到县级以外的数据；
- **细粒度权限**：`@CheckResourcePermission` 按资源配置 + 操作码（INVOKE）鉴权，资源 ID 从 SpEL 表达式取；
- **文件加密**：导出文件全部加随机密码压缩，密码仅记录在用户自己的下载记录详情里。

## 踩过的坑

- **GDAL 驱动兼容性**：部分 ArcGIS 字段类型在 GDAL 底层驱动导出时会丢字段或直接失败。定位到 C++ 驱动层后，借助 AI 辅助阅读和重写原生处理逻辑，修复了特殊类型的导出问题——这也是这个项目里收获最独特的部分：Java 工程师第一次真正下到了 native 层。
- **消息重投递**：开发阶段压测时发现同一记录被消费两次，导出了两份一样的文件。排查后确认是消费者 ack 超时导致重投，CAS 抢占方案上线后问题消失。
- **事务边界**：最初版本把 GDAL 远程调用包在 `@Transactional` 里，一次几分钟的导出把数据库连接占满。重构为"远程调用在事务外、状态更新在编程式事务内"后恢复正常。

## 成果

- 完整交付数据下载功能：平台端 4 个接口 + 第三方开放接口 3 个，覆盖基础类/核心类/旧核心类共 20+ 数据子类别；
- 异步链路上线后，提交请求的接口响应稳定在毫秒级，与 GDB 裁剪耗时完全解耦；
- 断点续传上线后，大文件下载成功率显著提升，弱网环境用户不再需要从头重下；
- 沉淀了 `@Idempotent` 幂等组件与断点续传前端工具，被其他模块复用；
- 输出功能设计文档、接口文档、部署文档与用户手册等完整交付材料。
