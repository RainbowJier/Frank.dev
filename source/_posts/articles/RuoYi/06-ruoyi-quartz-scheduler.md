---
title: RuoYi 框架从零到一 06 - 定时任务调度系统
date: 2026-08-24 23:30:00
categories:
  - 教程
tags:
  - RuoYi
  - Quartz
  - 定时任务
  - 分布式调度
description: 深入解析 RuoYi 的 Quartz 定时任务调度系统：Cron 表达式详解、执行策略（Misfire Policy）、任务并发控制、执行日志管理、XXL-Job 分布式改造方案。
lang: zh-CN
---

> **适合人群**：已理解 RuoYi 基础架构，需要实现定时任务、数据统计、自动备份等场景的同学
> 本文是《RuoYi 框架从零到一》系列第 06 篇，基于 RuoYi-Vue 4.x 版本。
>
> 建议先读 {% post_link articles/RuoYi/02-ruoyi-project-structure '02 - 项目结构与核心模块' %}。

## 一、Quartz 定时任务原理

RuoYi 集成了 **Quartz** 框架，实现了可视化的定时任务调度系统。

![图1：Quartz 从配置任务到执行记录的完整流程与核心数据表](quartz-execution-flow.svg)

### 1.1 核心流程

**4 个步骤**：

1. **配置定时任务**：在系统管理 → 定时任务中配置任务名称、调用目标、Cron 表达式、执行策略
2. **Quartz 调度器**：`Scheduler` 解析 Cron，计算下次执行时间，`Trigger` 触发器触发，提交到线程池
3. **执行 Job**：反射调用目标方法，捕获异常，记录执行日志
4. **记录日志**：将执行时间、状态、异常信息写入 `sys_job_log` 表

### 1.2 核心数据表

#### （1）sys_job（任务配置表）

| 字段 | 说明 | 示例 |
|------|------|------|
| `job_id` | 任务 ID | `1` |
| `job_name` | 任务名称 | `系统默认（无参）` |
| `job_group` | 任务组名 | `DEFAULT` |
| `invoke_target` | 调用目标字符串 | `ryTask.ryNoParams` |
| `cron_expression` | Cron 表达式 | `0 0/10 * * * ?` |
| `misfire_policy` | 执行策略 | `1=立即执行` `2=执行一次` `3=放弃执行` |
| `concurrent` | 并发执行 | `0=允许` `1=禁止` |
| `status` | 状态 | `0=正常` `1=暂停` |

**调用目标格式**：

```
Bean名称.方法名(参数)
```

**示例**：

| 调用目标 | 说明 |
|---------|------|
| `ryTask.ryNoParams` | 调用 Spring Bean `ryTask` 的 `ryNoParams()` 方法（无参） |
| `ryTask.ryParams('hello')` | 调用 `ryParams(String param)` 方法，传递字符串参数 |
| `ryTask.ryMultipleParams('a', true, 2L, 3.0D, 4)` | 多参数：字符串、布尔、Long、Double、Integer |

#### （2）sys_job_log（执行日志表）

| 字段 | 说明 |
|------|------|
| `job_log_id` | 日志 ID |
| `job_name` | 任务名称 |
| `job_group` | 任务组名 |
| `invoke_target` | 调用目标 |
| `job_message` | 日志信息（如"执行成功"） |
| `status` | 执行状态（`0=成功` `1=失败`） |
| `exception_info` | 异常信息（失败时记录堆栈） |
| `create_time` | 执行时间 |

### 1.3 核心类

#### （1）ScheduleUtils（调度工具类）

**职责**：创建、更新、删除 Quartz Job。

**关键方法**：

```java
public class ScheduleUtils {
    
    /**
     * 创建定时任务
     */
    public static void createScheduleJob(Scheduler scheduler, SysJob job) throws SchedulerException {
        // 1. 构建 Job 详细信息
        JobDetail jobDetail = JobBuilder.newJob(QuartzDisallowConcurrentExecution.class)
            .withIdentity(getJobKey(job.getJobId(), job.getJobGroup()))
            .build();
        
        // 2. 构建 Cron 触发器
        CronScheduleBuilder cronScheduleBuilder = CronScheduleBuilder.cronSchedule(job.getCronExpression());
        cronScheduleBuilder = handleCronScheduleMisfirePolicy(job, cronScheduleBuilder);
        
        CronTrigger trigger = TriggerBuilder.newTrigger()
            .withIdentity(getTriggerKey(job.getJobId(), job.getJobGroup()))
            .withSchedule(cronScheduleBuilder)
            .build();
        
        // 3. 放入任务详细信息
        jobDetail.getJobDataMap().put(ScheduleConstants.TASK_PROPERTIES, job);
        
        // 4. 判断是否存在
        if (scheduler.checkExists(getJobKey(job.getJobId(), job.getJobGroup()))) {
            scheduler.deleteJob(getJobKey(job.getJobId(), job.getJobGroup()));
        }
        
        // 5. 调度器中添加任务
        scheduler.scheduleJob(jobDetail, trigger);
        
        // 6. 如果是暂停状态，立即暂停
        if (job.getStatus().equals(ScheduleConstants.Status.PAUSE.getValue())) {
            scheduler.pauseJob(getJobKey(job.getJobId(), job.getJobGroup()));
        }
    }
}
```

#### （2）QuartzDisallowConcurrentExecution（禁止并发执行）

**职责**：具体执行定时任务的 Job 类，加了 `@DisallowConcurrentExecution` 注解，禁止并发执行。

```java
@DisallowConcurrentExecution
public class QuartzDisallowConcurrentExecution extends AbstractQuartzJob {
    @Override
    protected void doExecute(JobExecutionContext context, SysJob sysJob) throws Exception {
        JobInvokeUtil.invokeMethod(sysJob);
    }
}
```

**并发对比**：

| 类 | 并发行为 | 适用场景 |
|----|---------|---------|
| `QuartzDisallowConcurrentExecution` | 禁止并发（前一次未完成，下一次等待） | 数据统计、文件处理（避免重复） |
| `QuartzJobExecution` | 允许并发（同时运行多个实例） | 发送邮件、消息推送（互不影响） |

#### （3）JobInvokeUtil（反射调用工具）

**职责**：解析 `invoke_target` 字符串，通过反射调用目标方法。

```java
public class JobInvokeUtil {
    
    /**
     * 执行方法
     */
    public static void invokeMethod(SysJob sysJob) throws Exception {
        String invokeTarget = sysJob.getInvokeTarget();
        String beanName = getBeanName(invokeTarget);
        String methodName = getMethodName(invokeTarget);
        List<Object[]> methodParams = getMethodParams(invokeTarget);
        
        // 从 Spring 容器获取 Bean
        Object bean = SpringUtils.getBean(beanName);
        
        // 反射调用方法
        Method method = bean.getClass().getDeclaredMethod(methodName, getMethodParamsType(methodParams));
        method.invoke(bean, getMethodParamsValue(methodParams));
    }
    
    /**
     * 解析 Bean 名称：ryTask.ryNoParams → ryTask
     */
    public static String getBeanName(String invokeTarget) {
        int dotIndex = invokeTarget.indexOf(".");
        if (dotIndex != -1) {
            return invokeTarget.substring(0, dotIndex);
        }
        return invokeTarget;
    }
    
    /**
     * 解析方法名：ryTask.ryNoParams → ryNoParams
     */
    public static String getMethodName(String invokeTarget) {
        int dotIndex = invokeTarget.indexOf(".");
        int leftBracket = invokeTarget.indexOf("(");
        
        if (dotIndex != -1 && leftBracket != -1) {
            return invokeTarget.substring(dotIndex + 1, leftBracket);
        }
        return invokeTarget;
    }
}
```

## 二、Cron 表达式详解

Cron 表达式是 Quartz 的核心，用于定义任务的执行时间。

![图2：Cron 表达式：秒 分 时 日 月 周 年，通配符控制执行规则](cron-expression-structure.svg)

### 2.1 7 个字段

Cron 表达式由 **7 个字段**组成（空格分隔）：

```
秒 分 时 日 月 周 年(可选)
0  15 10 *  *  ?  2024
```

| 字段 | 允许值 | 允许的通配符 |
|------|--------|-------------|
| 秒 | 0-59 | `, - * /` |
| 分钟 | 0-59 | `, - * /` |
| 小时 | 0-23 | `, - * /` |
| 日期 | 1-31 | `, - * ? / L W` |
| 月份 | 1-12 或 JAN-DEC | `, - * /` |
| 星期 | 0-7 或 SUN-SAT（0 和 7 都是周日） | `, - * ? / L #` |
| 年份 | 1970-2099（可选） | `, - * /` |

### 2.2 通配符含义

| 通配符 | 含义 | 示例 |
|--------|------|------|
| `*` | 所有值 | `0 0 * * * ?` → 每小时 |
| `?` | 不指定值（日期和星期互斥，只能用一个 `*`，另一个必须用 `?`） | `0 0 0 ? * MON` → 每周一 |
| `-` | 范围 | `0 0 9-18 * * ?` → 9 点到 18 点每小时 |
| `,` | 多个值（枚举） | `0 0 0 1,15 * ?` → 每月 1 号和 15 号 |
| `/` | 增量（步长） | `0 0/5 * * * ?` → 每 5 分钟 |
| `L` | 最后（Last） | `0 0 0 L * ?` → 每月最后一天 |
| `W` | 工作日（Weekday） | `0 0 0 15W * ?` → 每月 15 号最近的工作日 |
| `#` | 第几个星期几 | `0 0 0 ? * 6#3` → 每月第 3 个星期五 |

### 2.3 常用表达式

| 表达式 | 说明 |
|--------|------|
| `0 0 0 * * ?` | 每天凌晨执行 |
| `0 0 12 * * ?` | 每天中午 12 点执行 |
| `0 0/5 * * * ?` | 每 5 分钟执行 |
| `0 0 0/1 * * ?` | 每小时执行 |
| `0 0 0 1 * ?` | 每月 1 号凌晨执行 |
| `0 0 0 L * ?` | 每月最后一天凌晨执行 |
| `0 0 0 ? * MON` | 每周一凌晨执行 |
| `0 0 0 ? * MON-FRI` | 周一到周五凌晨执行 |
| `0 0 9,12,18 * * ?` | 每天 9 点、12 点、18 点执行 |
| `0 0 9-18 * * ?` | 每天 9 点到 18 点每小时执行 |
| `0 0 2 1 * ?` | 每月 1 号凌晨 2 点执行 |
| `0 0 2 ? * 6L` | 每月最后一个星期五凌晨 2 点执行 |
| `0 0 0 ? * 6#3` | 每月第 3 个星期五凌晨执行 |

### 2.4 日期与星期互斥

**重要规则**：`日期` 和 `星期` 字段**互斥**，只能使用一个 `*`，另一个必须用 `?`。

**错误示例**：

```
0 0 0 * * MON  ❌ （日期用了 *，星期也指定了 MON）
```

**正确写法**：

```
0 0 0 ? * MON  ✅ （日期用 ?，星期用 MON）
0 0 0 15 * ?   ✅ （日期用 15，星期用 ?）
```

### 2.5 在线生成工具

手写 Cron 容易出错，推荐使用在线工具：

- **Cron Expression Generator**：https://cron.qqe2.com/
- **Crontab Guru**（Linux 版，5 个字段）：https://crontab.guru/

## 三、执行策略（Misfire Policy）

当服务器宕机或任务执行时间过长，导致错过了预定的执行时间，Quartz 提供了 **3 种执行策略**。

![图3：三种策略应对宕机：立即执行补全所有、执行一次跳到下轮、放弃执行直接丢弃](misfire-policy-comparison.svg)

### 3.1 三种策略对比

**场景假设**：任务每 5 分钟执行一次，但服务器在 10:00-10:15 之间宕机。

- **预定执行时间**：10:05、10:10、10:15
- **实际恢复时间**：10:20

#### （1）立即执行（MISFIRE_DEFAULT）

**行为**：服务器恢复后，立即补偿执行所有错过的任务。

**时间线**：

```
10:05  ❌ (宕机)
10:10  ❌ (宕机)
10:15  ❌ (宕机)
10:20  ✓ 立即执行 3 次
       → 10:05 补偿
       → 10:10 补偿
       → 10:15 补偿
10:25  ✓ 正常执行
```

**适用场景**：

- 数据统计（必须补全）
- 发送通知（不能漏掉）

#### （2）执行一次（MISFIRE_DO_NOTHING）

**行为**：忽略错过的任务，等待下一个正常调度时间。

**时间线**：

```
10:05  ❌ (宕机)
10:10  ❌ (宕机)
10:15  ❌ (宕机)
10:20  忽略补偿
10:25  ✓ 下次正常执行
10:30  ✓
```

**适用场景**：

- 实时性任务（无需补偿）
- 缓存刷新（只看当前状态）

#### （3）放弃执行（MISFIRE_IGNORE）

**行为**：直接丢弃错过的任务，继续按原计划执行。

**时间线**：

```
10:05  ❌ (宕机)
10:10  ❌ (宕机)
10:15  ❌ (宕机)
10:20  直接丢弃
10:25  ✓ 继续执行
10:30  ✓
```

**适用场景**：

- 非关键任务
- 监控检查（仅看当前状态）

### 3.2 配置执行策略

**在 RuoYi 中配置**：

1. 系统管理 → 定时任务 → 新增/编辑
2. **执行策略** 下拉框：
   - `立即执行`（默认）
   - `执行一次`
   - `放弃执行`

**数据库字段**：

```sql
misfire_policy CHAR(1) DEFAULT '1' COMMENT '计划执行错误策略（1立即执行 2执行一次 3放弃执行）'
```

## 四、自定义定时任务

### 4.1 快速开发

**步骤 1：编写任务类**

在 `ruoyi-quartz` 模块中创建任务类（或者在 `ruoyi-admin` 中）：

```java
package com.ruoyi.quartz.task;

import org.springframework.stereotype.Component;

/**
 * 自定义定时任务
 */
@Component("myTask")
public class MyTask {
    
    /**
     * 无参方法
     */
    public void noParams() {
        System.out.println("执行无参方法：" + System.currentTimeMillis());
    }
    
    /**
     * 有参方法
     */
    public void withParams(String message, Integer count) {
        System.out.println("执行有参方法：message=" + message + ", count=" + count);
    }
}
```

**步骤 2：配置任务**

1. 系统管理 → 定时任务 → 新增
2. **任务名称**：`我的定时任务`
3. **任务组名**：`DEFAULT`
4. **调用目标字符串**：
   - 无参：`myTask.noParams`
   - 有参：`myTask.withParams('hello', 5)`
5. **Cron 表达式**：`0 0/1 * * * ?`（每分钟执行）
6. **执行策略**：`立即执行`
7. **并发执行**：`允许`
8. **状态**：`正常`

**步骤 3：启动任务**

点击"操作" → "执行一次"，或等待 Cron 触发。

### 4.2 传递参数

**支持的参数类型**：

- `String`：字符串（用单引号包裹）
- `Boolean`：`true` / `false`
- `Long`：长整型（后缀 `L`）
- `Double`：浮点型（后缀 `D`）
- `Integer`：整型

**示例**：

```java
myTask.complexParams('hello', true, 100L, 3.14D, 42)
```

对应方法签名：

```java
public void complexParams(String str, Boolean bool, Long longNum, Double doubleNum, Integer intNum) {
    // ...
}
```

### 4.3 访问 Spring Bean

**场景**：在任务中调用 Service、Mapper。

**方式 1：注入依赖**

```java
@Component("dataStatTask")
public class DataStatTask {
    
    @Autowired
    private IUserService userService;
    
    public void statUserCount() {
        Long count = userService.countUsers();
        System.out.println("当前用户总数：" + count);
    }
}
```

**方式 2：手动获取 Bean**

```java
@Component("manualTask")
public class ManualTask {
    
    public void execute() {
        IUserService userService = SpringUtils.getBean(IUserService.class);
        Long count = userService.countUsers();
        System.out.println("当前用户总数：" + count);
    }
}
```

### 4.4 异常处理

**Quartz 会捕获所有异常**，并记录到 `sys_job_log` 表。

**手动记录日志**：

```java
@Component("safeTask")
public class SafeTask {
    
    private static final Logger log = LoggerFactory.getLogger(SafeTask.class);
    
    public void execute() {
        try {
            // 业务逻辑
            int result = 10 / 0;  // 模拟异常
        } catch (Exception e) {
            log.error("任务执行失败", e);
            throw new RuntimeException("任务执行失败：" + e.getMessage());
        }
    }
}
```

**查看执行日志**：

系统管理 → 定时任务 → 操作 → 调度日志

## 五、分布式任务调度（XXL-Job）

Quartz 是**单机调度**，在分布式环境下存在问题：

- **数据库锁竞争**：多台服务器同时抢占任务，效率低
- **无法负载均衡**：任务只在一台机器上执行，资源浪费
- **无法分片处理**：海量数据无法并行处理

**解决方案**：使用 **XXL-Job** 分布式任务调度平台。

![图4：XXL-Job 调度中心管理多执行器，支持路由策略与分片广播](xxl-job-distributed-architecture.svg)

### 5.1 XXL-Job 架构

#### 核心组件

| 组件 | 说明 |
|------|------|
| **调度中心（xxl-job-admin）** | 管理任务配置、Cron 调度、执行器注册、日志收集 |
| **执行器（xxl-job-executor）** | 实际执行任务的节点，自动注册到调度中心，接收调度指令 |

#### 核心特性

- **去中心化**：执行器自动注册，无需手动配置
- **路由策略**：轮询、随机、一致性哈希、故障转移、忙碌转移
- **分片广播**：海量数据并行处理（每个执行器处理一部分）
- **动态扩容**：新增执行器自动加入调度
- **执行日志**：实时查看任务执行日志（滚动日志）

### 5.2 集成 XXL-Job

#### 步骤 1：部署调度中心

**方式 1：Docker 部署**

```bash
docker run -d \
  --name xxl-job-admin \
  -p 8080:8080 \
  -e PARAMS="--spring.datasource.url=jdbc:mysql://127.0.0.1:3306/xxl_job?useUnicode=true&characterEncoding=UTF-8 \
  --spring.datasource.username=root \
  --spring.datasource.password=123456" \
  xuxueli/xxl-job-admin:2.4.0
```

**方式 2：源码部署**

1. 下载源码：https://github.com/xuxueli/xxl-job
2. 执行 SQL：`doc/db/tables_xxl_job.sql`
3. 修改配置：`xxl-job-admin/src/main/resources/application.properties`
4. 启动：`mvn clean package` → `java -jar xxl-job-admin.jar`

访问：http://localhost:8080/xxl-job-admin（默认账号 `admin/123456`）

#### 步骤 2：RuoYi 集成执行器

**（1）添加依赖**

在 `ruoyi-admin/pom.xml` 中：

```xml
<dependency>
    <groupId>com.xuxueli</groupId>
    <artifactId>xxl-job-core</artifactId>
    <version>2.4.0</version>
</dependency>
```

**（2）配置执行器**

在 `application.yml` 中：

```yaml
xxl:
  job:
    admin:
      addresses: http://localhost:8080/xxl-job-admin  # 调度中心地址
    executor:
      appname: ruoyi-executor  # 执行器名称（调度中心配置）
      ip:  # 执行器 IP（空=自动获取）
      port: 9999  # 执行器端口
      logpath: ./logs/xxl-job  # 日志路径
      logretentiondays: 30  # 日志保留天数
    accessToken:  # 通信 Token（与调度中心一致）
```

**（3）编写配置类**

```java
package com.ruoyi.framework.config;

import com.xxl.job.core.executor.impl.XxlJobSpringExecutor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class XxlJobConfig {
    
    @Value("${xxl.job.admin.addresses}")
    private String adminAddresses;
    
    @Value("${xxl.job.executor.appname}")
    private String appname;
    
    @Value("${xxl.job.executor.port}")
    private int port;
    
    @Value("${xxl.job.executor.logpath}")
    private String logPath;
    
    @Bean
    public XxlJobSpringExecutor xxlJobExecutor() {
        XxlJobSpringExecutor executor = new XxlJobSpringExecutor();
        executor.setAdminAddresses(adminAddresses);
        executor.setAppname(appname);
        executor.setPort(port);
        executor.setLogPath(logPath);
        return executor;
    }
}
```

**（4）编写任务**

```java
package com.ruoyi.quartz.task;

import com.xxl.job.core.handler.annotation.XxlJob;
import org.springframework.stereotype.Component;

@Component
public class XxlJobTask {
    
    /**
     * 简单任务（无参）
     */
    @XxlJob("demoJobHandler")
    public void demoJobHandler() {
        System.out.println("XXL-Job 任务执行：" + System.currentTimeMillis());
    }
    
    /**
     * 分片任务（海量数据并行处理）
     */
    @XxlJob("shardingJobHandler")
    public void shardingJobHandler() {
        // 获取分片参数
        int shardIndex = XxlJobHelper.getShardIndex();  // 当前分片序号（0开始）
        int shardTotal = XxlJobHelper.getShardTotal();  // 总分片数
        
        System.out.println("分片任务：" + shardIndex + "/" + shardTotal);
        
        // 示例：处理用户数据
        // SELECT * FROM sys_user WHERE user_id % #{shardTotal} = #{shardIndex}
    }
}
```

#### 步骤 3：调度中心配置任务

1. 登录 XXL-Job 调度中心：http://localhost:8080/xxl-job-admin
2. **执行器管理** → 新增执行器：
   - AppName：`ruoyi-executor`
   - 注册方式：`自动注册`
3. **任务管理** → 新增任务：
   - 执行器：`ruoyi-executor`
   - JobHandler：`demoJobHandler`
   - Cron：`0 0/1 * * * ?`
   - 路由策略：`轮询`
   - 运行模式：`BEAN`
4. **启动任务**

### 5.3 路由策略

XXL-Job 支持多种路由策略，决定任务在哪台执行器上运行：

| 策略 | 说明 |
|------|------|
| **第一个** | 固定选择第一台机器 |
| **最后一个** | 固定选择最后一台机器 |
| **轮询** | 依次轮询所有机器 |
| **随机** | 随机选择一台机器 |
| **一致性哈希** | 每个任务固定路由到同一台机器 |
| **最不经常使用（LFU）** | 选择使用频率最低的机器 |
| **最近最久未使用（LRU）** | 选择最久未使用的机器 |
| **故障转移** | 按顺序依次心跳检测，第一个活着的机器执行 |
| **忙碌转移** | 按顺序依次心跳检测，第一个空闲的机器执行 |
| **分片广播** | 广播到所有机器，每台机器获取分片参数并行处理 |

### 5.4 分片广播（海量数据处理）

**场景**：有 1000 万用户数据需要统计，单机处理需要 10 小时，如何并行？

**方案**：使用 **分片广播** 路由策略，3 台执行器并行处理。

**实现**：

```java
@XxlJob("userStatJobHandler")
public void userStatJobHandler() {
    // 获取分片参数
    int shardIndex = XxlJobHelper.getShardIndex();  // 0, 1, 2
    int shardTotal = XxlJobHelper.getShardTotal();  // 3
    
    // SQL 分片：user_id % 3 = 0/1/2
    List<User> users = userMapper.selectList(
        Wrappers.<User>lambdaQuery()
            .apply("user_id % {0} = {1}", shardTotal, shardIndex)
    );
    
    // 业务处理
    for (User user : users) {
        // 统计逻辑
    }
}
```

**执行流程**：

- 执行器 1：处理 `user_id % 3 = 0` 的数据（333 万）
- 执行器 2：处理 `user_id % 3 = 1` 的数据（333 万）
- 执行器 3：处理 `user_id % 3 = 2` 的数据（334 万）

**时间**：3 台并行，理论上 **10 小时 ÷ 3 ≈ 3.5 小时**。

## 六、最佳实践

### 6.1 任务设计原则

1. **幂等性**：任务重复执行结果一致（避免重复插入、重复扣款）
2. **超时控制**：长任务分批处理，避免阻塞线程池
3. **异常处理**：捕获所有异常，记录日志，不影响下次执行
4. **避免死锁**：禁止并发执行时，注意数据库锁竞争

### 6.2 性能优化

1. **批量处理**：1000 次单条插入 → 1 次批量插入
2. **分页查询**：避免一次性加载百万级数据到内存
3. **异步处理**：耗时操作（发送邮件、HTTP 请求）使用线程池
4. **数据库索引**：统计查询必须有索引

### 6.3 常见问题

#### （1）任务不执行？

**排查步骤**：

1. 检查任务状态是否为 **正常**
2. 检查 Cron 表达式是否正确（在线工具验证）
3. 查看执行日志（调度日志）是否有异常
4. 检查 Bean 名称是否正确（`@Component("myTask")`）
5. 检查方法签名是否匹配参数

#### （2）任务重复执行？

**原因**：集群环境下，多台服务器同时执行。

**解决方案**：

- **Quartz 集群模式**：配置数据库锁（`org.quartz.jobStore.isClustered=true`）
- **使用 XXL-Job**：天然支持分布式

#### （3）任务执行时间过长，阻塞后续任务？

**解决方案**：

1. **禁止并发执行**：确保任务串行
2. **增加线程池大小**：`application.yml` 配置：

```yaml
spring:
  task:
    scheduling:
      pool:
        size: 10  # 默认 1，增加到 10
```

3. **拆分任务**：长任务拆成多个短任务

#### （4）如何手动触发任务？

**方式 1：系统界面**

系统管理 → 定时任务 → 操作 → **执行一次**

**方式 2：代码调用**

```java
@Autowired
private ISysJobService jobService;

public void manualExecute() {
    SysJob job = jobService.selectJobById(1L);
    jobService.run(job);
}
```

## 结语

这篇文章深入解析了 RuoYi 的定时任务调度系统：

- **Quartz 原理**：配置任务 → Scheduler 调度 → 反射调用 → 记录日志
- **Cron 表达式**：7 个字段（秒 分 时 日 月 周 年），通配符控制执行规则
- **执行策略**：立即执行（补全所有）、执行一次（跳到下轮）、放弃执行（直接丢弃）
- **自定义任务**：`@Component` + `invoke_target` + 反射调用
- **XXL-Job**：分布式调度、路由策略、分片广播（海量数据并行处理）

**下一篇预告**：我们将深入 RuoYi 的系统监控与日志管理——在线用户监控、服务器性能监控、操作日志与登录日志、Druid 数据源监控。

> **思考与练习**
>
> 1. 编写一个定时任务，每天凌晨 2 点统计昨天新增用户数
> 2. 使用分片广播处理 100 万条订单数据（3 台执行器并行）
> 3. 对比 Quartz 和 XXL-Job 的优缺点，选择适合你项目的方案