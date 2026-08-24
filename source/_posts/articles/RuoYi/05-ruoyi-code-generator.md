---
title: RuoYi 框架从零到一 05 - 代码生成器深度解析
date: 2026-08-24 23:00:00
categories:
  - 教程
tags:
  - RuoYi
  - 代码生成器
  - Velocity
  - 模板引擎
description: 深入剖析 RuoYi 的代码生成器：Velocity 模板引擎原理、三种生成模板类型（单表/树形表/主子表）、自定义模板开发，实现一键生成前后端 CRUD 代码。
lang: zh-CN
---

> **适合人群**：已理解 RuoYi 基础架构，想掌握代码生成器提升开发效率的同学
> 本文是《RuoYi 框架从零到一》系列第 05 篇，基于 RuoYi-Vue 4.x 版本。
>
> 建议先读 {% post_link articles/RuoYi/02-ruoyi-project-structure '02 - 项目结构与核心模块' %}。

## 一、代码生成器工作原理

RuoYi 的代码生成器是提升开发效率的核心工具，可以根据数据库表结构，**一键生成前后端完整 CRUD 代码**：

![图1：代码生成器从配置到生成 7 个文件的完整流程](ruoyi-code-generator-flow.svg)

### 1.1 核心流程

**4 个步骤**：

1. **配置生成信息**：从数据库导入表，配置类名、业务名、功能描述、字段类型
2. **选择模板类型**：单表 CRUD / 树形表 / 主子表（一对多）
3. **Velocity 模板渲染**：读取 `.vm` 模板文件，注入上下文变量（表信息、字段信息），生成代码
4. **下载代码文件**：打包成 ZIP，包含 7 个文件（Controller / Service / Mapper / Domain / Vue / API / SQL）

### 1.2 生成的 7 个文件

| 文件类型 | 文件名 | 作用 |
|---------|--------|------|
| **后端** | `XxxController.java` | 处理 HTTP 请求（增删改查接口） |
| | `IXxxService.java` | 业务接口定义 |
| | `XxxServiceImpl.java` | 业务逻辑实现 |
| | `XxxMapper.java` | MyBatis 数据访问接口 |
| | `XxxMapper.xml` | MyBatis SQL 映射文件 |
| | `Xxx.java` | 实体类（对应数据库表） |
| **前端** | `index.vue` | Vue 列表页面（表格 + 表单） |
| | `xxx.js` | Axios API 请求封装 |
| **SQL** | `menu.sql` | 菜单权限 SQL（可选） |

**一句话记住**：**数据库表 → 配置生成信息 → Velocity 渲染模板 → 前后端 7 个文件**。

## 二、Velocity 模板引擎

RuoYi 使用 **Apache Velocity** 作为模板引擎（类似 Thymeleaf、FreeMarker）。

![图2：Velocity 模板通过 $ 引用变量、# 控制逻辑，渲染成最终代码](velocity-template-syntax.svg)

### 2.1 核心语法

#### （1）变量引用

```velocity
$变量名           ## 直接输出（变量不存在会报错）
${变量名}         ## 静默引用（变量不存在不报错）
$!{变量名}        ## 静默引用（null 输出空字符串）
```

**示例**：

```velocity
package com.ruoyi.${moduleName}.controller;

/**
 * ${functionName}Controller
 * 
 * @author ${author}
 * @date ${datetime}
 */
@RestController
@RequestMapping("/${businessName}")
public class ${ClassName}Controller {
    // ...
}
```

生成后（假设 `moduleName=system`，`functionName=用户管理`，`ClassName=SysUser`）：

```java
package com.ruoyi.system.controller;

/**
 * 用户管理Controller
 * 
 * @author ruoyi
 * @date 2026-08-24
 */
@RestController
@RequestMapping("/user")
public class SysUserController {
    // ...
}
```

#### （2）条件判断

```velocity
#if($condition)
    执行代码
#elseif($other)
    其他代码
#else
    默认代码
#end
```

**示例**（根据字段类型生成不同的 Java 类型）：

```velocity
#foreach($column in $columns)
    #if($column.javaType == 'Date')
    @JsonFormat(pattern = "yyyy-MM-dd HH:mm:ss")
    #end
    private ${column.javaType} ${column.javaField};
#end
```

#### （3）循环遍历

```velocity
#foreach($item in $list)
    $item.name
    $foreach.index  ## 索引，从 0 开始
    $foreach.count  ## 计数，从 1 开始
#end
```

**示例**（生成所有字段的 getter/setter）：

```velocity
#foreach($column in $columns)
    public ${column.javaType} get${column.capJavaField}() {
        return ${column.javaField};
    }
    
    public void set${column.capJavaField}(${column.javaType} ${column.javaField}) {
        this.${column.javaField} = ${column.javaField};
    }
#end
```

#### （4）方法调用

```velocity
$table.getTableName()              ## 调用 Java 方法
$table.tableName                   ## 直接访问属性
$StringUtils.capitalize($name)     ## 调用工具类
```

### 2.2 RuoYi 常用变量

代码生成时，RuoYi 会将以下变量注入到 Velocity 上下文：

#### **表信息（$table）**

| 变量 | 说明 | 示例 |
|------|------|------|
| `$table.tableName` | 数据库表名 | `sys_user` |
| `$table.className` | Java 类名（大驼峰） | `SysUser` |
| `$table.businessName` | 业务名（小驼峰） | `user` |
| `$table.moduleName` | 模块名 | `system` |
| `$table.functionName` | 功能名称 | `用户` |
| `$table.functionAuthor` | 作者 | `ruoyi` |
| `$table.pkColumn` | 主键字段对象 | `user_id` |

#### **字段信息（$columns）**

`$columns` 是一个 `List<GenTableColumn>`，每个元素包含：

| 变量 | 说明 | 示例 |
|------|------|------|
| `$column.columnName` | 数据库字段名 | `user_name` |
| `$column.javaField` | Java 属性名（小驼峰） | `userName` |
| `$column.capJavaField` | Java 属性名（大驼峰） | `UserName` |
| `$column.javaType` | Java 类型 | `String` / `Long` / `Date` |
| `$column.columnComment` | 字段注释 | `用户账号` |
| `$column.isRequired` | 是否必填 | `true` / `false` |
| `$column.isPk` | 是否主键 | `true` / `false` |
| `$column.isInsert` | 是否插入 | `true` / `false` |
| `$column.isEdit` | 是否编辑 | `true` / `false` |
| `$column.isList` | 是否列表字段 | `true` / `false` |
| `$column.isQuery` | 是否查询字段 | `true` / `false` |
| `$column.queryType` | 查询方式 | `EQ` / `LIKE` / `BETWEEN` |
| `$column.htmlType` | 表单类型 | `input` / `select` / `datetime` |
| `$column.dictType` | 字典类型 | `sys_user_sex` |

### 2.3 模板文件位置

**ruoyi-generator 模块**：

```
ruoyi-generator/
└── src/main/resources/vm/
    ├── java/
    │   ├── controller.java.vm       # Controller 模板
    │   ├── service.java.vm          # Service 接口模板
    │   ├── serviceImpl.java.vm      # Service 实现模板
    │   ├── mapper.java.vm           # Mapper 接口模板
    │   ├── domain.java.vm           # 实体类模板
    │   ├── sub-domain.java.vm       # 树形表/主子表 实体类
    │   └── ...
    ├── xml/
    │   └── mapper.xml.vm            # MyBatis XML 模板
    ├── vue/
    │   └── index.vue.vm             # Vue 页面模板
    ├── js/
    │   └── api.js.vm                # Axios API 模板
    └── sql/
        └── sql.vm                   # 菜单权限 SQL 模板
```

## 三、三种生成模板类型

RuoYi 支持 **3 种生成模板类型**，适应不同的业务场景：

![图3：三种模板类型：单表最常用，树形表需 parent_id，主子表需外键关联](three-template-types.svg)

### 3.1 单表 CRUD（最常用）

#### 适用场景

**最常见的业务表**，独立存在，无层级关系。

**示例表**：

```sql
CREATE TABLE sys_user (
  user_id      BIGINT       NOT NULL AUTO_INCREMENT COMMENT '用户ID',
  user_name    VARCHAR(30)  NOT NULL                COMMENT '用户账号',
  nick_name    VARCHAR(30)  NOT NULL                COMMENT '用户昵称',
  email        VARCHAR(50)  DEFAULT ''              COMMENT '用户邮箱',
  phonenumber  VARCHAR(11)  DEFAULT ''              COMMENT '手机号码',
  status       CHAR(1)      DEFAULT '0'             COMMENT '帐号状态（0正常 1停用）',
  create_time  DATETIME                             COMMENT '创建时间',
  PRIMARY KEY (user_id)
) COMMENT = '用户信息表';
```

#### 生成功能

- ✅ 列表查询 + 分页
- ✅ 新增
- ✅ 修改
- ✅ 删除（单个/批量）
- ✅ 导出 Excel

#### 生成步骤

1. **导入表**：系统管理 → 代码生成 → 导入 → 选择 `sys_user`
2. **编辑配置**：
   - **基本信息**：类名 `SysUser`，业务名 `user`，功能名 `用户`
   - **字段信息**：勾选"插入"、"编辑"、"列表"、"查询"
3. **生成代码**：点击"生成代码"，下载 ZIP

#### 生成的 Controller 片段

```java
@RestController
@RequestMapping("/system/user")
public class SysUserController extends BaseController {
    
    @Autowired
    private ISysUserService sysUserService;
    
    /**
     * 查询用户列表
     */
    @PreAuthorize("@ss.hasPermi('system:user:list')")
    @GetMapping("/list")
    public TableDataInfo list(SysUser sysUser) {
        startPage();
        List<SysUser> list = sysUserService.selectSysUserList(sysUser);
        return getDataTable(list);
    }
    
    /**
     * 新增用户
     */
    @PreAuthorize("@ss.hasPermi('system:user:add')")
    @Log(title = "用户", businessType = BusinessType.INSERT)
    @PostMapping
    public AjaxResult add(@Validated @RequestBody SysUser sysUser) {
        return toAjax(sysUserService.insertSysUser(sysUser));
    }
    
    /**
     * 修改用户
     */
    @PreAuthorize("@ss.hasPermi('system:user:edit')")
    @Log(title = "用户", businessType = BusinessType.UPDATE)
    @PutMapping
    public AjaxResult edit(@Validated @RequestBody SysUser sysUser) {
        return toAjax(sysUserService.updateSysUser(sysUser));
    }
    
    /**
     * 删除用户
     */
    @PreAuthorize("@ss.hasPermi('system:user:remove')")
    @Log(title = "用户", businessType = BusinessType.DELETE)
    @DeleteMapping("/{userIds}")
    public AjaxResult remove(@PathVariable Long[] userIds) {
        return toAjax(sysUserService.deleteSysUserByUserIds(userIds));
    }
}
```

### 3.2 树形表（Tree）

#### 适用场景

**部门、菜单、分类、区域** 等树形层级结构。

#### 核心字段

**必须包含以下字段**：

| 字段 | 说明 |
|------|------|
| `parent_id` | 父节点 ID（0 表示根节点） |
| `ancestors` | 祖级列表（如 `0,100,101`，用于快速查询子树） |
| `order_num` | 排序字段 |

**示例表**：

```sql
CREATE TABLE sys_dept (
  dept_id     BIGINT       NOT NULL AUTO_INCREMENT COMMENT '部门id',
  parent_id   BIGINT       DEFAULT 0               COMMENT '父部门id',
  ancestors   VARCHAR(50)  DEFAULT ''              COMMENT '祖级列表',
  dept_name   VARCHAR(30)  DEFAULT ''              COMMENT '部门名称',
  order_num   INT          DEFAULT 0               COMMENT '显示顺序',
  leader      VARCHAR(20)  DEFAULT NULL            COMMENT '负责人',
  status      CHAR(1)      DEFAULT '0'             COMMENT '部门状态（0正常 1停用）',
  PRIMARY KEY (dept_id)
) COMMENT = '部门表';
```

#### 生成功能

- ✅ 树形列表（递归构建）
- ✅ 新增子节点
- ✅ 修改/删除校验（不能删除有子节点的节点）
- ✅ 展开/折叠树节点

#### 配置要点

**编辑生成信息 → 生成信息 → 生成模板 → 选择"树表"**：

- **树编码字段**：`dept_id`
- **树父编码字段**：`parent_id`
- **树名称字段**：`dept_name`

#### 生成的 Service 片段

```java
/**
 * 构建前端所需要树结构
 *
 * @param depts 部门列表
 * @return 树结构列表
 */
@Override
public List<SysDept> buildDeptTree(List<SysDept> depts) {
    List<SysDept> returnList = new ArrayList<>();
    List<Long> tempList = depts.stream().map(SysDept::getDeptId).collect(Collectors.toList());
    
    for (SysDept dept : depts) {
        // 如果是顶级节点，遍历该父节点的所有子节点
        if (!tempList.contains(dept.getParentId())) {
            recursionFn(depts, dept);
            returnList.add(dept);
        }
    }
    
    if (returnList.isEmpty()) {
        returnList = depts;
    }
    return returnList;
}

/**
 * 递归列表
 */
private void recursionFn(List<SysDept> list, SysDept t) {
    // 得到子节点列表
    List<SysDept> childList = getChildList(list, t);
    t.setChildren(childList);
    
    for (SysDept tChild : childList) {
        if (hasChild(list, tChild)) {
            recursionFn(list, tChild);
        }
    }
}
```

### 3.3 主子表（一对多）

#### 适用场景

**订单-订单明细、合同-合同项、问卷-问题** 等一对多关系。

#### 表结构示例

**主表**（t_order）：

```sql
CREATE TABLE t_order (
  order_id     BIGINT         NOT NULL AUTO_INCREMENT COMMENT '订单ID',
  order_no     VARCHAR(50)    NOT NULL                COMMENT '订单编号',
  total_amount DECIMAL(10,2)  DEFAULT 0.00            COMMENT '总金额',
  create_time  DATETIME                               COMMENT '创建时间',
  PRIMARY KEY (order_id)
) COMMENT = '订单表';
```

**子表**（t_order_item）：

```sql
CREATE TABLE t_order_item (
  item_id      BIGINT         NOT NULL AUTO_INCREMENT COMMENT '明细ID',
  order_id     BIGINT         NOT NULL                COMMENT '订单ID（外键）',
  product_name VARCHAR(100)   NOT NULL                COMMENT '商品名称',
  quantity     INT            DEFAULT 1               COMMENT '数量',
  price        DECIMAL(10,2)  DEFAULT 0.00            COMMENT '单价',
  PRIMARY KEY (item_id),
  FOREIGN KEY (order_id) REFERENCES t_order(order_id)
) COMMENT = '订单明细表';
```

#### 生成功能

- ✅ 主表 CRUD
- ✅ 子表关联查询（`LEFT JOIN`）
- ✅ 新增时批量插入子表
- ✅ 修改时先删后插子表
- ✅ 删除时级联删除子表

#### 配置要点

**编辑主表生成信息 → 生成信息 → 生成模板 → 选择"主子表"**：

- **关联子表的表名**：`t_order_item`
- **子表关联的外键名**：`order_id`

#### 生成的 Service 片段

```java
/**
 * 新增订单
 */
@Override
@Transactional
public int insertOrder(Order order) {
    // 1. 插入主表
    int rows = orderMapper.insertOrder(order);
    
    // 2. 批量插入子表
    insertOrderItem(order);
    
    return rows;
}

/**
 * 修改订单
 */
@Override
@Transactional
public int updateOrder(Order order) {
    // 1. 删除旧的子表数据
    orderItemMapper.deleteOrderItemByOrderId(order.getOrderId());
    
    // 2. 批量插入新的子表数据
    insertOrderItem(order);
    
    // 3. 更新主表
    return orderMapper.updateOrder(order);
}

/**
 * 删除订单
 */
@Override
@Transactional
public int deleteOrderByOrderIds(Long[] orderIds) {
    // 1. 删除子表
    orderItemMapper.deleteOrderItemByOrderIds(orderIds);
    
    // 2. 删除主表
    return orderMapper.deleteOrderByOrderIds(orderIds);
}

/**
 * 新增订单明细信息
 */
public void insertOrderItem(Order order) {
    List<OrderItem> orderItemList = order.getOrderItemList();
    Long orderId = order.getOrderId();
    
    if (CollectionUtils.isNotEmpty(orderItemList)) {
        for (OrderItem orderItem : orderItemList) {
            orderItem.setOrderId(orderId);
        }
        orderItemMapper.batchOrderItem(orderItemList);
    }
}
```

## 四、自定义模板开发

当默认生成的代码不满足需求时，可以**自定义模板**。

![图4：自定义模板：复制 vm 文件 → 添加业务代码 → 重新生成即可获得定制化代码](custom-template-development.svg)

### 4.1 开发流程

**3 个步骤**：

1. **复制原始模板**：从 `ruoyi-generator/resources/vm/java/controller.java.vm` 复制一份
2. **修改模板内容**：添加自定义方法、修改注解、调整包名
3. **配置模板路径**：在 `VelocityInitializer` 中注册新模板

### 4.2 实战：添加批量导入方法

#### 步骤 1：复制模板

```bash
cd ruoyi-generator/src/main/resources/vm/java
cp controller.java.vm controller-import.java.vm
```

#### 步骤 2：修改模板

在 `controller-import.java.vm` 中添加：

```velocity
    /**
     * 批量导入${functionName}
     */
    @PreAuthorize("@ss.hasPermi('${permissionPrefix}:import')")
    @Log(title = "${functionName}", businessType = BusinessType.IMPORT)
    @PostMapping("/importData")
    public AjaxResult importData(MultipartFile file, boolean updateSupport) throws Exception {
        ExcelUtil<${ClassName}> util = new ExcelUtil<>(${ClassName}.class);
        List<${ClassName}> ${className}List = util.importExcel(file.getInputStream());
        String operName = SecurityUtils.getUsername();
        String message = ${className}Service.import${ClassName}Data(${className}List, updateSupport, operName);
        return success(message);
    }

    /**
     * 下载${functionName}导入模板
     */
    @PostMapping("/importTemplate")
    public void importTemplate(HttpServletResponse response) {
        ExcelUtil<${ClassName}> util = new ExcelUtil<>(${ClassName}.class);
        util.importTemplateExcel(response, "${functionName}数据");
    }
```

#### 步骤 3：配置模板路径

修改 `GenTableServiceImpl.java`，在 `prepareContext()` 方法中：

```java
VelocityContext context = new VelocityContext();
context.put("table", genTable);
context.put("columns", genTable.getColumns());
context.put("dtoPackageName", GenConstants.BASE_PACKAGE);

// 添加自定义模板
List<String> templates = new ArrayList<>();
templates.add("vm/java/controller-import.java.vm");  // 自定义模板
templates.add("vm/java/service.java.vm");
// ... 其他模板
```

#### 步骤 4：重新生成代码

重启 `ruoyi-admin`，重新导入表并生成代码，新的 Controller 会包含批量导入方法。

### 4.3 常见自定义场景

| 场景 | 修改模板 | 要点 |
|------|---------|------|
| 添加统计接口 | `controller.java.vm` | 添加 `@GetMapping("/stat")` 方法 |
| 修改返回格式 | `controller.java.vm` | 将 `AjaxResult` 改为自定义 `R<T>` |
| 添加 DTO 转换 | `serviceImpl.java.vm` | 引入 `MapStruct`，添加转换逻辑 |
| 集成分布式 ID | `domain.java.vm` | 主键字段改为 `@TableId(type = IdType.ASSIGN_ID)` |
| 添加字段校验 | `domain.java.vm` | 添加 `@NotNull`、`@Length`、`@Email` 等注解 |
| 修改前端布局 | `vue/index.vue.vm` | 调整表格列宽、表单布局 |

### 4.4 模板调试技巧

**问题**：修改模板后生成的代码有语法错误？

**调试方法**：

1. **查看 Velocity 日志**：在 `application.yml` 中开启日志：

```yaml
logging:
  level:
    org.apache.velocity: DEBUG
```

2. **单独测试模板**：

```java
@Test
public void testTemplate() throws Exception {
    VelocityEngine ve = new VelocityEngine();
    ve.init();
    
    Template template = ve.getTemplate("vm/java/controller.java.vm", "UTF-8");
    
    VelocityContext context = new VelocityContext();
    context.put("table", genTable);
    context.put("columns", columns);
    
    StringWriter writer = new StringWriter();
    template.merge(context, writer);
    
    System.out.println(writer.toString());
}
```

3. **检查变量是否存在**：在模板中添加调试输出：

```velocity
## 调试：输出所有变量
$table
$columns
$foreach.count
```

## 五、最佳实践

### 5.1 生成前的准备工作

1. **规范表设计**：
   - 主键统一命名（如 `表名_id`）
   - 必须有 `create_time`、`update_time`、`create_by`、`update_by`
   - 字段注释完整（会生成到注解和前端表单）

2. **配置字典数据**：
   - 状态字段（如 `status`）关联字典类型 `sys_normal_disable`
   - 性别字段关联 `sys_user_sex`
   - 前端会自动生成下拉框

3. **选择正确的查询方式**：
   - 精确查询：`EQ`（等于）
   - 模糊查询：`LIKE`（包含）
   - 范围查询：`BETWEEN`（时间范围）

### 5.2 生成后的优化工作

**生成的代码只是起点，需要手动优化**：

1. **添加业务校验**：

```java
@Override
public int insertUser(SysUser user) {
    // 1. 校验用户名唯一性
    if (userMapper.checkUserNameUnique(user.getUserName()) > 0) {
        throw new ServiceException("用户名已存在");
    }
    
    // 2. 密码加密
    user.setPassword(SecurityUtils.encryptPassword(user.getPassword()));
    
    // 3. 插入数据
    return userMapper.insertUser(user);
}
```

2. **优化 SQL 性能**：

```xml
<!-- 生成的 SQL 可能有冗余字段，按需精简 -->
<select id="selectUserList" resultMap="SysUserResult">
    SELECT user_id, user_name, nick_name, email, status, create_time
    FROM sys_user
    WHERE del_flag = '0'
    <if test="userName != null and userName != ''">
        AND user_name LIKE concat('%', #{userName}, '%')
    </if>
    ORDER BY create_time DESC
</select>
```

3. **完善前端交互**：

```vue
<template>
  <el-form :model="form" :rules="rules">
    <el-form-item label="用户账号" prop="userName">
      <el-input v-model="form.userName" placeholder="请输入用户账号" maxlength="30" />
    </el-form-item>
    
    <!-- 添加：用户名重复校验 -->
    <el-form-item label="用户昵称" prop="nickName">
      <el-input 
        v-model="form.nickName" 
        placeholder="请输入用户昵称"
        @blur="checkNickNameUnique"
      />
    </el-form-item>
  </el-form>
</template>

<script>
export default {
  methods: {
    // 昵称唯一性校验
    async checkNickNameUnique() {
      if (this.form.nickName) {
        const res = await checkNickName(this.form.nickName, this.form.userId);
        if (!res.data) {
          this.$message.warning('昵称已存在');
        }
      }
    }
  }
}
</script>
```

### 5.3 常见问题

#### （1）生成的菜单 SQL 如何使用？

**问题**：下载的 ZIP 中有 `sql/menu.sql`，如何导入？

**答案**：

1. 打开 `menu.sql`，找到 `INSERT INTO sys_menu` 语句
2. **修改 `menu_id`**：避免与现有菜单冲突（查询 `SELECT MAX(menu_id) FROM sys_menu`）
3. 在数据库中执行 SQL
4. 刷新页面，左侧菜单自动出现

**示例**：

```sql
-- 用户管理菜单
INSERT INTO sys_menu VALUES(2000, '用户管理', 1, 1, 'user', 'system/user/index', NULL, 1, 0, 'C', '0', '0', 'system:user:list', 'user', 'admin', sysdate(), '', NULL, '用户管理菜单');
-- 用户新增按钮
INSERT INTO sys_menu VALUES(2001, '用户新增', 2000, 1, '', '', NULL, 1, 0, 'F', '0', '0', 'system:user:add', '#', 'admin', sysdate(), '', NULL, '');
-- 用户修改按钮
INSERT INTO sys_menu VALUES(2002, '用户修改', 2000, 2, '', '', NULL, 1, 0, 'F', '0', '0', 'system:user:edit', '#', 'admin', sysdate(), '', NULL, '');
-- 用户删除按钮
INSERT INTO sys_menu VALUES(2003, '用户删除', 2000, 3, '', '', NULL, 1, 0, 'F', '0', '0', 'system:user:remove', '#', 'admin', sysdate(), '', NULL, '');
```

#### （2）生成的代码能直接运行吗？

**答案**：**不能直接运行，需要手动集成**。

**步骤**：

1. **复制后端代码到对应模块**：
   - `Controller`、`Service`、`ServiceImpl` → `ruoyi-admin/src/main/java/com/ruoyi/web/controller/...`
   - `Mapper.java` → `ruoyi-system/src/main/java/com/ruoyi/system/mapper/...`
   - `Mapper.xml` → `ruoyi-system/src/main/resources/mapper/...`
   - `Domain` → `ruoyi-system/src/main/java/com/ruoyi/system/domain/...`

2. **复制前端代码**：
   - `index.vue` → `ruoyi-ui/src/views/...`
   - `api.js` → `ruoyi-ui/src/api/...`

3. **执行菜单 SQL**：在数据库中插入菜单权限

4. **重启后端**，刷新前端页面

#### （3）如何生成多模块代码？

**问题**：项目分为 `ruoyi-system`、`ruoyi-business`、`ruoyi-report` 三个模块，如何指定生成到不同模块？

**答案**：修改生成配置中的 **包路径**。

**编辑生成信息 → 生成信息 → 生成路径**：

| 模块 | 包路径 |
|------|--------|
| `ruoyi-system` | `com.ruoyi.system` |
| `ruoyi-business` | `com.ruoyi.business` |
| `ruoyi-report` | `com.ruoyi.report` |

生成后，代码会放在对应包下：

```
com.ruoyi.business.controller.UserController
com.ruoyi.business.service.IUserService
com.ruoyi.business.mapper.UserMapper
```

## 结语

这篇文章深入剖析了 RuoYi 的代码生成器：

- **工作流程**：配置生成信息 → 选择模板类型 → Velocity 渲染 → 生成前后端 7 个文件
- **Velocity 语法**：`$变量引用`、`#if 条件判断`、`#foreach 循环遍历`、`$table/$columns` 核心变量
- **三种模板类型**：单表 CRUD（最常用）、树形表（parent_id + ancestors）、主子表（外键关联 + 级联操作）
- **自定义模板**：复制 .vm 文件 → 添加业务逻辑 → 重新生成代码
- **最佳实践**：规范表设计、配置字典、生成后优化（业务校验、SQL 性能、前端交互）

**下一篇预告**：我们将深入 RuoYi 的定时任务调度系统——Quartz 集成原理、Cron 表达式、任务执行日志、分布式任务调度改造。

> **思考与练习**
>
> 1. 尝试生成一个"商品管理"表（包含 `product_name`、`price`、`stock` 字段），体验完整流程
> 2. 阅读 `GenTableServiceImpl.java` 源码，理解代码生成的核心逻辑
> 3. 自定义一个模板，为所有 Controller 添加"导出 PDF"方法