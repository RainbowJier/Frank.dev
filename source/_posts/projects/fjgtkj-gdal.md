---
title: 福建国土空间基础信息平台-GDAL 地理数据处理服务
date: 2026-08-21 10:00:00
categories:
  - 项目经历
tags:
  - Java
  - GDAL
  - GIS
  - JNI
  - 微服务
period: 2026.06 - 至今
role: 后端开发（服务独立负责人）
stack:
  - Spring Boot
  - GDAL 3.7.2 (JNI)
  - Oracle
  - PostGIS
  - MinIO
  - Docker
description: 平台的空间数据加工服务：修复 GDAL 驱动的 ArcGIS 兼容性问题（环方向、字段类型、空间精度），打通 GDB 裁剪与 Oracle、PostGIS 两类库表的三条 GDB 导出链路，并以导出后复检构建数据质检闭环。
---

## 项目背景

平台的几十类空间数据分布在不同的存储形态里：存量成果数据是 NAS 上的 ArcGIS FileGDB 文件，规划编制数据落在 Oracle（ArcSDE 空间库），临时用地数据在 PostGIS 里。业务侧需要的却是统一的出口——用户申请下载时，不管数据源是什么，拿到的都必须是一份能在 ArcGIS 里正常打开、结构完整、拓扑正确的 GDB 文件。

把 ArcGIS 生态之外的数据"变成合格的 GDB"，这件事比听起来难得多：GDAL 是开源界的事实标准，但 ESRI 的 FileGDB 规范里有大量没有写进文档的约定，两边对环方向、字段类型、空间精度的理解都有差异，直接转换出来的文件在 ArcGIS 里轻则字段丢失，重则几何破损。这个服务就是为消化这些差异而生的一块"专用加工车间"。

它被设计成独立部署的微服务，还有一个工程上的理由：GDAL 的 Java 绑定走 JNI 调用 C++ 原生库，配置是进程级的、内存不受 JVM 管理、最坏情况会直接崩掉整个进程。把它从业务服务里隔离出来，native 层的风险就不会外溢——上游的数据下载链路（另一篇{% post_link projects/fjgtkj-data-center '数据中心' %}里讲过）通过 Feign 调它，彼此只交换 JSON。

## 我的职责

- 从 0 到 1 搭建这个服务：DDD 分层的多模块工程、GDAL 环境自动配置（开发/生产两套路径）、Docker 部署与 NAS 挂载；
- 排查并修复 GDAL 驱动层的 ArcGIS 兼容性问题：多边形环方向、字段类型映射、空间精度参数；
- 实现三类数据源的 GDB 导出链路：GDB 文件裁剪、Oracle 批量导出、PostGIS 级联导出，统一走"质检 → 加密压缩 → 对象存储 → 文件登记"的后处理；
- 实现导出后数据质检与地理文件元数据读取两个能力，支撑上游的数据交付校验与数据资源登记。

## 总体架构

服务按 DDD 四层组织，GDAL 原生调用全部收敛在 infrastructure 的网关实现里，domain 层只定义接口，上层不感知 JNI 的存在：

![图 1：GDAL 服务在平台中的位置与内部分层](gdal-service-architecture.svg)

三类数据源各有独立网关：`DataDownloadGatewayImpl` 负责 GDB 文件到 GDB 文件的裁剪，`OracleGatewayImpl` 负责从 Oracle 空间库批量生成 GDB，`PostGisGatewayImpl` 负责 PostGIS 三表级联导出。应用层按数据子类别编排：城镇开发边界、生态保护红线、村庄规划走裁剪链路，详细规划走 Oracle 链路，临时用地走 PostGIS 链路——但无论哪条链路，出口都是同一个后处理管道。

## 三条导出链路

![图 2：三类数据源的 GDB 导出链路与统一后处理](gdb-export-pipeline.svg)

### 链路一：GDB 文件裁剪

存量 GDB 存在 NAS 上，用户按行政区划申请子集，所以这条链路做的是"GDB 到 GDB 的过滤复制"。最花心思的一点是**保留要素数据集（FeatureDataset）的分组结构**——源 GDB 里的图层不是平铺的，直接按图层名复制会把目录结构压扁。解法是读 FileGDB 的系统表 `GDB_Items`，从 `Path` 字段（形如 `\数据集名\图层名`）还原每个图层所属的数据集，再在目标 GDB 里用 `FEATURE_DATASET` 选项放回原位：

```java
// 通过 GDB_Items 系统表一次性还原 图层 → 数据集 的归属关系
String sql = "SELECT Name, Path FROM GDB_Items WHERE Path IS NOT NULL AND Path LIKE '\\%'";
Layer sqlLayer = ds.ExecuteSQL(sql);
```

图层复制本身是"忠实拷贝"：字段定义原样迁移（类型、宽度、精度），要素用 `SetFrom` 整体搬运，每 2000 条 `SyncToDisk` 一次控制内存。字段类型在目标驱动里创建失败时降级为 String，宁可宽一点也不丢字段。

### 链路二：Oracle 批量导出

详细规划的数据在 Oracle 里，这条链路相当于用代码模拟了一遍 ArcGIS 的"图层转出"。关键是**元数据驱动**——图层怎么建不靠猜，全部从数据库系统视图里读：`ALL_TAB_COLUMNS` 给出字段定义，`USER_SDO_GEOM_METADATA` 与 `SPATIAL_REFERENCES` 给出坐标系与空间参数。

字段类型的映射规则是踩坑后固化下来的，核心是 Oracle 的 NUMBER 必须看精度和标度再决策：

```java
if (upperType.contains("NUMBER") || upperType.contains("NUMERIC")) {
    if (dataScale != null && dataScale.intValue() > 0) {
        return ogr.OFTReal;                    // 有小数位 → 浮点
    }
    // 无小数位按精度选择整型宽度，防止截断
    return dataPrecision.intValue() <= 9 ? ogr.OFTInteger : ogr.OFTInteger64;
}
```

空间精度同样从数据库读真值而不是用默认值兜底：XYUNITS 映射为 `XYSCALE`、容差映射为 `XYTOLERANCE`、FALSEX/FALSEY 映射为坐标原点，逐图层拼进创建选项。这些参数差一个数量级，ArcGIS 打开时就会报"空间参考与数据不匹配"。写入侧按 2000 条一批提交事务，过滤值按 1000 一批拼接 IN 查询，避免大表把内存打爆。

另外两个容易忽略的细节：OBJECTID 是 GDB 的保留字段，源表里的同名字段必须跳过、让驱动自动生成；坐标系写入前调用 `MorphToESRI()` 把 OGC 的 WKT 转成 ESRI 方言，否则 ArcGIS 认不出投影。

### 链路三：PostGIS 级联导出

临时用地的三张表有主从关系：CSBA 是主表，LINK 通过 CID 挂在 CSBA 下，FKBA 又通过 FID 挂在 LINK 下。用户的过滤条件只作用于主表，两张从表必须**级联过滤**，否则导出的关联数据会缺失或冗余：

```java
// FKBA：双重 JOIN 沿外键链追溯到主表的过滤条件
String sql = String.format(
        "SELECT f.* FROM %1$s.\"%2$s\" f "
        + "INNER JOIN %1$s.\"%3$s\" l ON f.\"%4$s\" = l.\"%5$s\" "
        + "INNER JOIN (%6$s) tmp_c ON l.\"%7$s\" = tmp_c.\"%8$s\"",
        schema, TABLE_FKBA, TABLE_LINK, FIELD_ID, FIELD_FID,
        csbaIdSubquery, FIELD_CID, FIELD_ID);
```

这条链路还支持增量导出：在主表条件上叠加修改时间（XGSJ）的时间窗口，默认取当天，只导出增量变化。PostGIS 与 FileGDB 的几何类型体系不完全对齐，导出前用 `GT_Flatten` 拍平维度、再归一化到 FileGDB 支持的多点/多线/多面。

## 驱动修复：让 ArcGIS 认得开

这是整个服务里最硬的一块。最初导出的 GDB 交给用户，ArcGIS 打开直接报 **incorrect ring ordering**，面要素渲染破损、拓扑检查全红。定位下来，根因是两家规范的多边形环方向约定**正好相反**：OGC/GDAL 内部是外环逆时针、内环顺时针，而 ESRI 要求外环顺时针、内环逆时针。GDAL 的开源驱动写 GDB 时不会自动翻转，ArcGIS 一旦发现方向不对就拒绝渲染。

![图 3：环方向约定的差异与基于鞋带公式的修复](ring-orientation-fix.svg)

修复放在要素写入前，逐几何做方向纠正。判向用的是鞋带公式——按环上顶点顺序累加有向面积，符号即方向，无需依赖任何几何库接口；反向则把顶点顺序整体倒序重写，同时保留 Z 值（规划数据普遍带高程，丢了 Z 等于把三维数据砍成二维）：

```java
// 鞋带公式判向：有向面积为负 → 顺时针（ESRI 要求的外环方向）
private boolean isClockwise(Geometry ring) {
    int n = ring.GetPointCount();
    double signedArea = 0;
    for (int i = 0; i < n - 1; i++) {
        signedArea += (ring.GetX(i + 1) - ring.GetX(i))
                * (ring.GetY(i + 1) + ring.GetY(i));
    }
    signedArea += (ring.GetX(0) - ring.GetX(n - 1))
            * (ring.GetY(0) + ring.GetY(n - 1));
    return signedArea < 0;
}

private void ensureClockwiseExterior(Geometry polygon) {
    Geometry exteriorRing = polygon.GetGeometryRef(0);
    if (exteriorRing != null && !isClockwise(exteriorRing)) {
        reverseRing(exteriorRing);          // 外环必须是顺时针
    }
    for (int i = 1; i < polygon.GetGeometryCount(); i++) {
        Geometry interiorRing = polygon.GetGeometryRef(i);
        if (interiorRing != null && isClockwise(interiorRing)) {
            reverseRing(interiorRing);      // 内环必须是逆时针
        }
    }
}
```

环方向之外还有一组配套修复：数据库来源的几何先用 `MakeValid()` 修复自交叉等无效拓扑，再叠加驱动级的 `OGR_APPLY_GEOMETRY_VALIDATION=YES` 打开写入校验；字段创建失败降级 String(255)；坐标系 `MorphToESRI()` 转方言。驱动选择上也做了双保险——优先用 ESRI 官方 SDK 的 FileGDB 驱动，不可用时回退开源的 OpenFileGDB（两者创建选项略有差异，代码里按各自约定传参）。这一组修复上线后，ArcGIS 端的兼容性问题清零。

## 数据质检

导出"没报错"不等于"数据对"。质检做了两层：

**第一层是交付前复检**。每份 GDB 导出完成后，服务会重新以只读方式打开它，逐图层重数图层总数与要素总数，连同递归求和的文件大小一起回填到下载记录；详细规划这类一次导出多个 GDB 的场景，按目录聚合统计。这一步挡住的是"静默失败"——过滤条件写错导致空图层、驱动中途丢要素但流程正常走完，这类问题只有重开文件数一遍才能暴露：

```java
// 重新打开导出产物做复检：图层数与要素数以文件实际内容为准
ds = ogr.Open(gdbPath, 0);
int layerCount = ds.GetLayerCount();
long featureCount = 0;
for (int i = 0; i < layerCount; i++) {
    featureCount += ds.GetLayer(i).GetFeatureCount(0);
}
```

**第二层是元数据读取**。对外提供按路径读取 NAS 上任意地理文件的能力：遍历根组与子组的全部图层，抽取字段名、别名、类型、注释、几何类型、要素数量与文件大小，字段元数据并发读取、Future 汇总。上游的数据资源登记与入库核对都以此为准——它回答的是"这份数据长什么样"，与导出复检的"这份数据全不全"互补，构成完整的质检闭环。

## JNI 工程细节

在 JVM 里驾驭 C++ 库，几条纪律是必须守住的：

- **native 内存手动释放**。`Feature`、`Geometry`、`Layer`、`DataSource` 都是 JNI 侧的堆对象，Java 的 GC 管不到它们，所有获取路径都套 `try/finally` 显式 `delete()`。漏一次是一次 native 泄漏，导出大文件时几百个图层的累积足以拖垮容器。
- **进程级配置只设一次**。`GDAL_CACHEMAX`、线程数等配置是进程全局的，重复设置无意义还可能污染状态，用 volatile + 双重检查锁保证只执行一次。
- **专用线程池隔离**。元数据并发读取跑在独立的 `gdal-worker` 线程池上（核心数取 CPU、CallerRunsPolicy 兜底），不与其他业务共享线程，native 调用的阻塞不会扩散。
- **环境差异收进启动配置**。开发环境从 `gdal.home` 推导 `GDAL_DATA` 与 `PROJ_LIB`，生产环境走 system-props 路径，注册驱动、性能参数、中文属性编码（`SHAPE_ENCODING=CP936`）统一在 `GdalAutoConfiguration` 里完成，业务代码零感知。

部署上，服务跑在 Docker 里，NAS 以 `/mnt/nas/gdb` 挂载进容器作为源数据的统一入口。开发环境则有一对容易漏的配置：`java.library.path` 指向 `gdalalljni.dll`、`PATH` 指向 `gdal.dll`，少任何一个都会得到一个看不出因果的 `UnsatisfiedLinkError`。

## 踩过的坑

- **环方向问题的第一反应是错的**。最初以为是源数据质量问题，找数据组核了两轮数据才发现是规范差异。这件事给我的教训是：跨生态的数据交换，先怀疑约定差异，再怀疑数据本身。
- **反转环坐标时丢过 Z 值**。早期版本只倒序了 X/Y，带高程的规划面在 ArcGIS 里高程全部归零。修复后倒序时会检测是否存在非零 Z 并一并保留。
- **文件名大小写坑了 Linux 编译**。`PostGisGatewayImpl` 的文件名大小写与类名不一致，Windows 上一切正常，CI 的 Linux 环境直接编译失败。此后约定新文件创建即检查大小写。
- **全量加载的内存压力**。早期版本把整表查询结果堆在内存里再写 GDB，大表逼近容器内存上限。改为过滤值分批查询（1000/批）+ 事务分批提交（2000/批）后回落到稳定水位。

## 成果

- 平台 5 类数据子类别的 GDB 导出全部落地：城镇开发边界、生态保护红线、村庄规划走裁剪链路，详细规划（2 个 GDB、24 张表）走 Oracle 链路，临时用地（3 表级联）走 PostGIS 链路；
- ArcGIS 兼容性问题清零：环方向纠正、字段类型映射、空间精度参数、坐标系方言转换四类修复上线后，再未收到"ArcGIS 打不开/打开报错"的反馈；
- 导出-质检-加密-归档一条龙：每份产物都经过重开复检，随机密码压缩后上传 MinIO 并统一登记文件信息，失败路径带对象存储回滚；
- 服务以 Docker 独立部署稳定运行，作为平台空间数据加工的统一入口被数据下载等上游链路复用。
