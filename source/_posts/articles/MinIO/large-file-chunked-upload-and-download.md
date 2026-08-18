---
title: 大文件分片上传与断点续传：基于 MinIO 预签名直连的前后端实践
date: 2026-08-17 17:00:00
categories:
  - 教程
tags:
  - MinIO
  - 文件上传
  - 断点续传
  - Vue 3
  - Spring Boot
description: 从切片、SHA-256 指纹、预签名直连到 composeObject 合并，完整拆解一套生产级大文件分片上传与断点续传下载方案的前后端实现。
keywords:
  - MinIO 分片上传
  - 断点续传
  - 预签名 URL
  - IndexedDB
lang: zh-CN
---

# 大文件分片上传与断点续传：基于 MinIO 预签名直连的前后端实践

在 GIS、影像、模型权重这类场景里，动辄几百 MB 到几 GB 的文件是常态。如果用最朴素的 `multipart/form-data` 一把梭，会遇到四个问题：

1. **内存压力**：服务端 `MultipartFile` 会把整个文件缓存在内存或临时目录，几个并发大文件就能打爆 JVM；
2. **超时失败**：一次 HTTP 请求传 2GB，网关超时、网络抖动任何一个环节出问题都得从头再来；
3. **带宽瓶颈**：所有字节都流经应用服务器，它成了最贵的"网线"；
4. **无法续传**：传到 90% 断网，用户只能重传 100%。

这篇文章拆解一套我在生产项目中落地的方案：**前端切片 + MinIO 预签名 URL 直连 + 分片对象 compose 合并 + IndexedDB 断点下载**。后端基于 Spring Boot + MinIO Java SDK，前端是零第三方依赖的原生实现（Vue 3 环境可直接复用）。

## 一、总体架构：控制面与数据面分离

整个方案最重要的一个决策是**让字节流绕开应用服务器**：

![图 1：控制面与数据面分离架构](/images/svg/minio-control-data-plane.svg)

- **控制面**（实线，经网关到 OPS 服务）：只有轻量指令——初始化上传、查询秒传、合并分片、换取预签名 URL。这些接口的请求体只有几百字节；
- **数据面**（虚线，浏览器直连 MinIO）：真正的分片字节，通过预签名 URL 用 `PUT`/`GET` 直接与对象存储交互。

服务端只做"调度员"，不做"搬运工"。这样应用服务器的带宽、内存都与文件大小解耦，压测时 2GB 文件上传对 OPS 服务的额外负担只有几次 JSON 请求。

一个容易被忽略的细节：**预签名 URL 必须用对外地址生成**。签名计算包含 host，而服务访问 MinIO 用的是内网 `endpoint`，浏览器直连用的是对外 `address`——两者不一致时签名校验必然失败。所以工具类里维护了一个独立的预签名客户端：

```java
/**
 * 预签名 URL 专用客户端：endpoint 是服务访问 MinIO 的地址，
 * address 是文件对外访问地址；预签名 URL 供前端直连使用，须按 address 生成（host 参与签名）。
 * getPresignedObjectUrl 为本地签名计算，不会发起网络请求。
 */
private volatile MinioClient presignClient;

private MinioClient getPresignClient() {
    MinioClient client = presignClient;
    if (client == null) {
        synchronized (this) {
            client = presignClient;
            if (client == null) {
                String publicEndpoint = minioProperties.getAddress();
                if (StrUtil.isBlank(publicEndpoint)) {
                    publicEndpoint = minioProperties.getEndpoint();
                }
                client = MinioClient.builder()
                        .endpoint(trimTrailingSlash(publicEndpoint))
                        .credentials(minioProperties.getAccessKey(), minioProperties.getSecretKey())
                        .region(minioProperties.getRegion())
                        .build();
                presignClient = client;
            }
        }
    }
    return client;
}
```

签名本身是本地计算，不产生网络请求，所以这个客户端可以安全地复用（双重检查锁只初始化一次）。

## 二、分片上传：一个接口，三种结果

完整链路长这样：

![图 2：分片上传全流程](/images/svg/minio-chunk-upload-flow.svg)

### 2.1 前端：切片、指纹与并发池

切片用 `File.slice()` 按 10MB 一片切好，然后用浏览器原生 `crypto.subtle.digest('SHA-256', ...)` 对完整文件计算指纹。指纹有两个用途：**秒传判定**和**续传识别**——所以必须全量哈希，不能抽样（抽样的代价是可能误判"已存在"，把不同的文件当成同一个）。

```js
function runPool(items, concurrency, task) {
  const queue = [...items]
  let cursor = 0
  const workers = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (cursor < queue.length) {
      const idx = cursor++
      await task(queue[idx], idx)             // 共享游标的并发池
    }
  })
  return Promise.all(workers)
}

async function uploadWithRetry(fn, maxRetry) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      if (e?.name === 'AbortError') throw e   // 用户取消不重试
      if (attempt < maxRetry) await sleep(500 * (attempt + 1))  // 线性退避
    }
  }
  throw lastErr
}
```

`runPool` 是一个工作窃取式的并发池：N 个 worker 共享一个自增游标，先做完的 worker 自动取下一片，不会出现"快片等慢片"。单片失败按 500ms × 重试次数线性退避，最多重试 3 次；用户主动取消（`AbortError`）则直接上抛，不做无意义重试。

### 2.2 初始化接口：秒传 / 续传 / 全新

前端只调一个初始化接口 `POST /file-info/presigned/upload-url`，把 `fileIdentifier`（SHA-256）、`chunkCount`、可选的 `uploadId` 发过去，服务端返回三种结果之一：

```java
// 是否秒传：按指纹查 file_info 表
FileInfo existing = fileInfoGateway.getByIdentifier(identifier);
if (existing != null) {
    resp.setSkipUpload(true);
    resp.setExistingFileId(existing.getId());
    return resp;                              // 路径一：一个字节都不用传
}

// 是否续传：带 uploadId 重入时，逐个探测分片对象是否存在
List<Integer> uploadedChunks = resumeUpload
        ? findUploadedChunks(bucketName, partObjectNames)
        : List.of();

resp.setUploadId(uploadId);
resp.setUploadedChunks(uploadedChunks);       // 路径二：跳过这些分片
resp.setPresignedUrls(buildPresignedPartUrls(bucketName, partObjectNames, expirySeconds));
                                             // 路径三：全新会话，全部分片待传
```

注意一个设计取舍：**上传进度的"真相源"在服务端（MinIO 里已存在的分片对象），而不是前端本地存储**。暂停后再继续时，前端只回传会话三要素（`uploadId`、`objectName`、`fileIdentifier`），已传了哪些分片完全由服务端探测得出，前端不用自己记——少一份需要维护一致性的状态。代价是会话标识只存在组件内存里：页面刷新后 session 丢失，重新初始化会生成新的 `uploadId` 和对象名，旧分片够不着了，只能整文件重传（旧分片交给定时清理回收）。`fileIdentifier` 能救场的只有一种情况——这个文件曾经被完整传完过，直接命中秒传。

### 2.3 服务端：分片即对象 + compose 合并

MinIO Java SDK 8.5.x 并不暴露 S3 的 `createMultipartUpload/uploadPart/completeMultipartUpload` 这套原生分片 API（只有 `composeObject` 是公开的）。所以方案绕了一步：

```java
// 说明：MinIO Java SDK 8.5.x 不对外暴露 createMultipartUpload/uploadPart/
// completeMultipartUpload/abortMultipartUpload 等方法（仅 composeObject 公开）。
// 因此采用"分片作为独立对象上传 + composeObject 合并"的方案实现断点续传/并发上传：
//   1. 每个分片作为独立完整对象上传到 {objectName}.parts/{uploadId}/{partNumber}
//   2. 全部分片上传完成后，用 composeObject 按序拼接为最终对象
//   3. 合并成功后删除临时分片对象
// 这种方案不依赖 S3 multipart upload 的 uploadId，uploadId 仅作为本系统内的会话标识。

public String buildPartObjectName(String objectName, String uploadId, int partNumber) {
    return objectName + ".parts/" + uploadId + "/" + String.format("%010d", partNumber);
}
```

每个分片是一个完整独立的小对象，序号定长补零到 10 位——字典序就是分片序，列出来直接按序 compose。`uploadId` 不是 S3 的，是系统自己生成的 UUID，仅用于圈定"哪一次上传会话的哪些分片"。

![图 4：分片对象的存储布局](/images/svg/minio-parts-object-layout.svg)

### 2.4 合并的防御性设计

合并接口是整个链路最容易出幺蛾子的地方：前端可能漏传分片、网关可能超时但服务端实际成功了、两个用户可能并发传同一个文件。逐个设防：

```java
@Transactional(rollbackFor = Exception.class)
public FileInfoDetailResp mergeChunks(ChunkMergeReq req) {
    // 1. 幂等重试：目标对象已存在且大小一致，说明上次合并已在 MinIO 完成
    //    （如网关超时 504 但服务端已合并成功），跳过合并直接入库
    if (isMergedObjectValid(bucketName, objectName, req.fileSize())) {
        return saveMergedFile(..., false);
    }

    // 2. 分片完整性：逐个 statObject 探测，缺任何一片都拒绝合并
    List<Integer> missingChunks = minioUtils.findMissingChunks(bucketName, partObjectNames);
    if (!missingChunks.isEmpty()) {
        throw new BusinessException("分片不完整，缺失分片: " + missingChunks);
    }

    // 3. 合并（MinIO 服务端原子拼接，字节不过应用）
    minioUtils.composeChunks(bucketName, objectName, partObjectNames);

    // 4. 合并后校验实际大小与声明一致，不一致则删除合并对象与分片，防止损坏文件入库
    long actualSize = minioUtils.statObject(bucketName, objectName).size();
    if (req.fileSize() == null || actualSize != req.fileSize()) {
        safeDeleteObject(bucketName, objectName);
        minioUtils.deleteChunkObjects(bucketName, buildPartsPrefix(objectName, uploadId));
        throw new BusinessException("合并结果与声明大小不一致，请重新上传");
    }

    return saveMergedFile(..., true);
}
```

入库阶段还有最后一道防线：`file_identifier` 上有唯一约束，并发上传同一文件时 `DuplicateKeyException` 会被捕获，回查已存在记录返回（对调用方表现为幂等成功），同时清掉本次多余的合并对象和分片——数据库约束兜住了竞态的最后一条缝。

### 2.5 孤儿分片治理

用户传了一半关页面、取消失败、异常退出，`.parts/` 下就会留下孤儿分片。除了取消时主动调 `chunk/abort` 清理，还有一个每日 03:00 的兜底调度器：列出 `file-parts/` 前缀下的全部分片对象，按 `.parts/{uploadId}/` 聚合成会话，**以会话内最新分片的时间为准**判断是否超过 24 小时保留期，超期整会话批量删除。"以最新分片时间为准"意味着活跃会话永远不会被误清——只要还在传，就有新的分片刷新时间戳。

## 三、断点续传下载：Range + IndexedDB

下载侧的完整链路：

![图 3：断点续传下载流程](/images/svg/minio-resumable-download-flow.svg)

整体思路与上传对称，但进度真相源换了位置：**下载进度存在浏览器 IndexedDB 里**（服务端无从知晓用户下载到哪了），库结构是两个 store：

- `tasks`：任务元信息 `{taskKey, fileId, fileName, totalSize, chunkSize, chunkCount}`；
- `chunks`：每片 `{id, taskKey, chunkIndex, start, end, size, blob}`，`taskKey = ops-file:{fileId}:{chunkSize}`。

几个值得展开的细节：

**恢复时只读 key 不读 Blob**。初始化阶段用 `getAllKeys()` 只拿已完成的分片号集合，不加载任何 Blob 内容——否则恢复一个 2GB 的任务会瞬间把历史分片全部读进内存，续传反而成了内存炸弹。

**分片大小校验防"代理吞 Range"**。有些反向代理不透传 `Range` 头，MinIO 会返回完整 200 文件而不是 206 分片；如果不校验，把这个"分片"存进去，合并出来的文件必然损坏且很难排查。所以每个分片落盘前都比对 `blob.size !== expectedLength`：

```js
// 校验分片大小，防止代理吞掉 Range 返回全量文件导致合并损坏
if (result.blob.size !== expectedLength) {
  throw new Error('服务器返回分片大小不符，可能存在代理未透传 Range 头，请检查网络配置')
}
```

**配额降级**。IndexedDB 有存储配额，超出时 `put` 会抛 Quota 异常。捕获后切换 `memoryOnly = true`，后续分片存内存 Map——刷新后无法续传，但至少本次下载能完成，属于优雅降级。

**预签名过期自动刷新**。预签名 URL 有时效，大文件下载到一半过期是常态。判定逻辑是 `status === 403` 且响应体匹配 `ExpiredToken / Request has expired / SignatureDoesNotMatch / AccessDenied`（或空 body），命中就重新向后端换一个 URL 继续当前分片，对上层无感：

```js
async function fetchRangeWithRetry(getDownloadUrl, refreshDownloadUrl, start, end, onChunkProgress, maxRetry = 2) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetry; attempt++) {
    try {
      return await fetchRange(getDownloadUrl(), start, end, onChunkProgress)
    } catch (e) {
      lastErr = e
      if (isPresignedExpired(e) && attempt < maxRetry) {
        await refreshDownloadUrl()            // 403 过期 → 重取预签名 URL 续传
        continue
      }
      if (attempt < maxRetry) await sleep(500 * (attempt + 1))
    }
  }
  throw lastErr
}
```

最后一个隐蔽的坑：**直连 MinIO 的 fetch 必须 `credentials: 'omit'`**。预签名 URL 已经携带签名参数，如果再带上 cookie，MinIO 的 CORS 策略（`Access-Control-Allow-Origin: *` 与 credentials 不兼容）会直接拒绝跨域请求。

## 四、方案要点回顾

| 问题 | 方案 | 关键点 |
|------|------|--------|
| 服务端内存/带宽 | 预签名直连 | 控制面/数据面分离，字节不过应用 |
| 重复上传 | SHA-256 秒传 | 全量哈希换可靠判定 |
| 上传中断重头来 | 分片对象 + 服务端探测续传 | 进度真相源在 MinIO，暂停/继续无需前端记进度 |
| 合并竞态/损坏 | 幂等 + 完整性 + 大小三重校验 | 数据库唯一约束兜底并发 |
| 下载中断重头来 | Range 分片 + IndexedDB | 恢复只读 key；配额降级内存 |
| 预签名过期 | 403 识别 + 自动刷新 | 对上层无感 |
| 孤儿分片 | 会话聚合定时清理 | 以最新分片时间判断活跃 |

这套方案的前端部分（`chunkUpload.js` / `resumableDownload.js`）是纯函数式的编排器，不依赖任何组件库；后端部分沉淀在公共 `core-minio` 模块里，任何业务服务引入依赖即可获得完整的文件能力。如果你正在做类似的大文件传输功能，希望这些从生产环境里踩出来的细节能帮你少走弯路。
