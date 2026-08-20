# 科研风格 SVG 模板库

六个完整可运行的模板，覆盖技术博客最常见的配图类型。每个模板都已包含公共骨架（字体栈、白底、外边框、箭头 marker、图注），复制后替换内容即可。画布默认宽 820。

改装原则：同类元素同色；palette 主色 ≤3 种；红色只留一处；所有文字用宽度公式验算（中文 ≈ 1.0×字号，拉丁 ≈ 0.55×字号）。

---

## 1. 横向流程图（flow）

适用：请求链路、处理步骤、数据流转。要点：节点同色系、终点用青绿标记目标、箭头上可加 11px 灰色小标注。

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 230" width="820" height="230"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="230" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="229" fill="none" stroke="#D9DFE8"/>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#5A6472"/>
    </marker>
  </defs>

  <!-- 节点 1–4 同色（深蓝），节点 5 目标态（青绿） -->
  <g stroke-width="1.5">
    <rect x="40"   y="64" width="120" height="56" rx="8" fill="#3C5488" fill-opacity="0.12" stroke="#3C5488"/>
    <rect x="195"  y="64" width="120" height="56" rx="8" fill="#3C5488" fill-opacity="0.12" stroke="#3C5488"/>
    <rect x="350"  y="64" width="120" height="56" rx="8" fill="#3C5488" fill-opacity="0.12" stroke="#3C5488"/>
    <rect x="505"  y="64" width="120" height="56" rx="8" fill="#3C5488" fill-opacity="0.12" stroke="#3C5488"/>
    <rect x="660"  y="64" width="120" height="56" rx="8" fill="#00A087" fill-opacity="0.12" stroke="#00A087"/>
  </g>
  <g text-anchor="middle" font-size="14" font-weight="500" fill="#252A33">
    <text x="100"  y="97">用户请求</text>
    <text x="255"  y="97">API 网关</text>
    <text x="410"  y="97">鉴权服务</text>
    <text x="565"  y="97">业务逻辑</text>
    <text x="720"  y="97">数据库</text>
  </g>
  <g text-anchor="middle" font-size="11" fill="#6B7280">
    <text x="100"  y="140">HTTPS</text>
    <text x="255"  y="140">路由转发</text>
    <text x="410"  y="140">JWT 校验</text>
    <text x="565"  y="140">领域服务</text>
    <text x="720"  y="140">持久化</text>
  </g>

  <g stroke="#5A6472" stroke-width="1.5">
    <line x1="163" y1="92" x2="189" y2="92" marker-end="url(#arrow)"/>
    <line x1="318" y1="92" x2="344" y2="92" marker-end="url(#arrow)"/>
    <line x1="473" y1="92" x2="499" y2="92" marker-end="url(#arrow)"/>
    <line x1="628" y1="92" x2="654" y2="92" marker-end="url(#arrow)"/>
  </g>

  <text x="410" y="205" text-anchor="middle" font-size="12" fill="#6B7280">图 1｜一次请求的完整链路</text>
</svg>
```

---

## 2. 分层架构图（architecture）

适用：系统架构、技术栈分层、前后端职责划分。要点：层带用浅灰底 `#F4F7FA`，层名左侧配同色小方块，层内元件白底彩描边。

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 430" width="820" height="430"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="430" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="429" fill="none" stroke="#D9DFE8"/>

  <!-- 四个层带 -->
  <g fill="#F4F7FA" stroke="#D9DFE8">
    <rect x="40" y="40"  width="740" height="76" rx="10"/>
    <rect x="40" y="130" width="740" height="76" rx="10"/>
    <rect x="40" y="220" width="740" height="76" rx="10"/>
    <rect x="40" y="310" width="740" height="76" rx="10"/>
  </g>

  <!-- 层名：小方块 + 深蓝粗体 -->
  <g font-size="14" font-weight="600" fill="#3C5488">
    <rect x="64" y="73" width="10" height="10" fill="#4DBBD5"/>
    <text x="82" y="83">接入层</text>
    <rect x="64" y="163" width="10" height="10" fill="#3C5488"/>
    <text x="82" y="173">应用层</text>
    <rect x="64" y="253" width="10" height="10" fill="#8491B4"/>
    <text x="82" y="263">服务层</text>
    <rect x="64" y="343" width="10" height="10" fill="#00A087"/>
    <text x="82" y="353">数据层</text>
  </g>

  <!-- 层内元件：白底 + 彩描边 -->
  <g fill="#FFFFFF" stroke-width="1.5" font-size="13" fill-opacity="1">
    <g stroke="#4DBBD5">
      <rect x="190" y="54" width="182" height="48" rx="6"/>
      <rect x="386" y="54" width="182" height="48" rx="6"/>
      <rect x="582" y="54" width="182" height="48" rx="6"/>
    </g>
    <g stroke="#3C5488">
      <rect x="190" y="144" width="182" height="48" rx="6"/>
      <rect x="386" y="144" width="182" height="48" rx="6"/>
      <rect x="582" y="144" width="182" height="48" rx="6"/>
    </g>
    <g stroke="#8491B4">
      <rect x="190" y="234" width="182" height="48" rx="6"/>
      <rect x="386" y="234" width="182" height="48" rx="6"/>
      <rect x="582" y="234" width="182" height="48" rx="6"/>
    </g>
    <g stroke="#00A087">
      <rect x="190" y="324" width="280" height="48" rx="6"/>
      <rect x="484" y="324" width="280" height="48" rx="6"/>
    </g>
  </g>
  <g text-anchor="middle" font-size="13" fill="#252A33">
    <text x="281" y="83">Nginx</text><text x="477" y="83">CDN</text><text x="673" y="83">WAF</text>
    <text x="281" y="173">商品服务</text><text x="477" y="173">订单服务</text><text x="673" y="173">用户服务</text>
    <text x="281" y="263">消息队列</text><text x="477" y="263">缓存集群</text><text x="673" y="263">搜索引擎</text>
    <text x="330" y="353">MySQL 主从</text><text x="624" y="353">ES 集群</text>
  </g>

  <text x="410" y="414" text-anchor="middle" font-size="12" fill="#6B7280">图 2｜电商系统四层架构</text>
</svg>
```

---

## 3. 标注式原理图（schematic）

适用：结构剖析（内存布局、协议字段、内核组件）。要点：中央主体 + 内部子块，两侧用 1px 引线 + 小圆点挂说明文字，引线颜色 `#9AA4B2`。

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 400" width="820" height="400"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="400" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="399" fill="none" stroke="#D9DFE8"/>

  <!-- 中央主体 -->
  <rect x="270" y="50" width="280" height="300" rx="12" fill="#3C5488" fill-opacity="0.05" stroke="#3C5488" stroke-width="2"/>
  <text x="410" y="82" text-anchor="middle" font-size="15" font-weight="600" fill="#252A33">JVM 运行时数据区</text>

  <!-- 内部子块：四种 palette 色区分 -->
  <g stroke-width="1.5">
    <rect x="294" y="100" width="232" height="48" rx="6" fill="#4DBBD5" fill-opacity="0.12" stroke="#4DBBD5"/>
    <rect x="294" y="164" width="232" height="48" rx="6" fill="#00A087" fill-opacity="0.12" stroke="#00A087"/>
    <rect x="294" y="228" width="232" height="48" rx="6" fill="#F39B7F" fill-opacity="0.12" stroke="#F39B7F"/>
    <rect x="294" y="292" width="232" height="48" rx="6" fill="#8491B4" fill-opacity="0.12" stroke="#8491B4"/>
  </g>
  <g text-anchor="middle" font-size="13" fill="#252A33">
    <text x="410" y="129">堆</text>
    <text x="410" y="193">虚拟机栈</text>
    <text x="410" y="257">方法区</text>
    <text x="410" y="321">程序计数器</text>
  </g>

  <!-- 左侧引线标注（右对齐文字 + 小圆点锚） -->
  <g stroke="#9AA4B2" stroke-width="1">
    <line x1="246" y1="124" x2="286" y2="124"/>
    <line x1="246" y1="188" x2="286" y2="188"/>
  </g>
  <circle cx="290" cy="124" r="2.5" fill="#9AA4B2"/>
  <circle cx="290" cy="188" r="2.5" fill="#9AA4B2"/>
  <g font-size="12" fill="#6B7280" text-anchor="end">
    <text x="240" y="128">线程共享</text>
    <text x="240" y="192">线程私有</text>
  </g>

  <!-- 右侧引线标注 -->
  <g stroke="#9AA4B2" stroke-width="1">
    <line x1="534" y1="124" x2="574" y2="124"/>
    <line x1="534" y1="252" x2="574" y2="252"/>
  </g>
  <circle cx="530" cy="124" r="2.5" fill="#9AA4B2"/>
  <circle cx="530" cy="252" r="2.5" fill="#9AA4B2"/>
  <g font-size="12" fill="#6B7280">
    <text x="580" y="128">GC 主战场</text>
    <text x="580" y="256">类元信息</text>
  </g>

  <text x="410" y="380" text-anchor="middle" font-size="12" fill="#6B7280">图 3｜JVM 运行时数据区结构</text>
</svg>
```

---

## 4. 双面板对比图（comparison）

适用：方案 A/B 对比、前后对照、优劣并置。要点：面板左上角加期刊风粗体角标 A/B，行首小圆点代替大色块，红色只点出关键差异行。

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 370" width="820" height="370"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="370" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="369" fill="none" stroke="#D9DFE8"/>

  <!-- 面板 A -->
  <rect x="40" y="40" width="360" height="280" rx="10" fill="#FFFFFF" stroke="#D9DFE8"/>
  <text x="64" y="72" font-size="18" font-weight="700" fill="#3C5488">A</text>
  <text x="86" y="71" font-size="14" font-weight="600" fill="#252A33">压缩 Compaction</text>
  <circle cx="78" cy="110" r="3" fill="#00A087"/>
  <text x="92" y="114" font-size="13" fill="#252A33">连续性得以保留</text>
  <circle cx="78" cy="150" r="3" fill="#8491B4"/>
  <text x="92" y="154" font-size="13" fill="#252A33">早期历史被原地摘要</text>
  <circle cx="78" cy="190" r="3" fill="#E64B35"/>
  <text x="92" y="194" font-size="13" fill="#252A33">上下文焦虑仍然残留</text>

  <!-- 面板 B -->
  <rect x="420" y="40" width="360" height="280" rx="10" fill="#FFFFFF" stroke="#D9DFE8"/>
  <text x="444" y="72" font-size="18" font-weight="700" fill="#3C5488">B</text>
  <text x="466" y="71" font-size="14" font-weight="600" fill="#252A33">上下文重置 Reset</text>
  <circle cx="458" cy="110" r="3" fill="#00A087"/>
  <text x="472" y="114" font-size="13" fill="#252A33">全新起点，无历史包袱</text>
  <circle cx="458" cy="150" r="3" fill="#4DBBD5"/>
  <text x="472" y="154" font-size="13" fill="#252A33">状态靠交接产物传递</text>
  <circle cx="458" cy="190" r="3" fill="#F39B7F"/>
  <text x="472" y="194" font-size="13" fill="#252A33">编排复杂度与开销增加</text>

  <text x="410" y="348" text-anchor="middle" font-size="12" fill="#6B7280">图 4｜上下文压缩 vs 上下文重置</text>
</svg>
```

---

## 5. 条形数据图（bar）

适用：性能对比、覆盖率、实验结果。要点：网格线只用 `#E8EDF3`，对照组用灰紫弱化、实验组上色，数值标注在柱顶。数据是编造示意时必须在图注里说明。

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 390" width="820" height="390"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="390" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="389" fill="none" stroke="#D9DFE8"/>

  <!-- 网格线（基线最深，其余浅灰） -->
  <g stroke="#E8EDF3" stroke-width="1">
    <line x1="90" y1="70"  x2="770" y2="70"/>
    <line x1="90" y1="130" x2="770" y2="130"/>
    <line x1="90" y1="190" x2="770" y2="190"/>
    <line x1="90" y1="250" x2="770" y2="250"/>
  </g>
  <line x1="90" y1="310" x2="770" y2="310" stroke="#5A6472" stroke-width="1.5"/>

  <!-- Y 轴刻度与轴标签 -->
  <g font-size="11" fill="#6B7280" text-anchor="end">
    <text x="78" y="314">0</text><text x="78" y="254">25</text>
    <text x="78" y="194">50</text><text x="78" y="134">75</text><text x="78" y="74">100</text>
  </g>
  <text transform="translate(30 190) rotate(-90)" text-anchor="middle" font-size="11" fill="#6B7280">任务完成率（%）</text>

  <!-- 柱：第 1 根灰紫作对照，其余递进上色 -->
  <rect x="143" y="155" width="64" height="155" fill="#8491B4" fill-opacity="0.35"/>
  <rect x="313" y="115" width="64" height="195" fill="#3C5488" fill-opacity="0.85"/>
  <rect x="483" y="97"  width="64" height="213" fill="#4DBBD5" fill-opacity="0.85"/>
  <rect x="653" y="75"  width="64" height="235" fill="#00A087" fill-opacity="0.85"/>
  <g text-anchor="middle" font-size="12" fill="#252A33">
    <text x="175" y="147">62</text><text x="345" y="107">78</text>
    <text x="515" y="89">85</text><text x="685" y="67">94</text>
  </g>
  <g text-anchor="middle" font-size="13" fill="#252A33">
    <text x="175" y="334">基线</text><text x="345" y="334">+规划器</text>
    <text x="515" y="334">+评估器</text><text x="685" y="334">+重置循环</text>
  </g>

  <text x="410" y="368" text-anchor="middle" font-size="12" fill="#6B7280">图 5｜Harness 各环节对任务完成率的提升（示意数据）</text>
</svg>
```

---

## 6. 时间线（timeline）

适用：版本演进、技术发展史、项目里程碑。要点：单轴线 + 箭头，里程碑圆点循环用色，标注上下交错避免重叠。

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 270" width="820" height="270"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="270" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="269" fill="none" stroke="#D9DFE8"/>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#5A6472"/>
    </marker>
  </defs>

  <!-- 主轴 -->
  <line x1="60" y1="140" x2="770" y2="140" stroke="#5A6472" stroke-width="1.5" marker-end="url(#arrow)"/>

  <!-- 里程碑圆点，颜色循环 -->
  <circle cx="130" cy="140" r="5" fill="#4DBBD5"/>
  <circle cx="330" cy="140" r="5" fill="#3C5488"/>
  <circle cx="530" cy="140" r="5" fill="#00A087"/>
  <circle cx="710" cy="140" r="5" fill="#F39B7F"/>

  <!-- 标注上下交错 -->
  <g text-anchor="middle">
    <text x="130" y="104" font-size="13" font-weight="600" fill="#252A33">v0.1 原型</text>
    <text x="130" y="120" font-size="11" fill="#6B7280">验证核心想法</text>
    <text x="330" y="172" font-size="13" font-weight="600" fill="#252A33">v1.0 发布</text>
    <text x="330" y="188" font-size="11" fill="#6B7280">首个稳定版本</text>
    <text x="530" y="104" font-size="13" font-weight="600" fill="#252A33">v2.0 重构</text>
    <text x="530" y="120" font-size="11" fill="#6B7280">插件化架构</text>
    <text x="710" y="172" font-size="13" font-weight="600" fill="#252A33">v3.0 生态</text>
    <text x="710" y="188" font-size="11" fill="#6B7280">社区共建</text>
  </g>

  <text x="410" y="248" text-anchor="middle" font-size="12" fill="#6B7280">图 6｜项目版本演进时间线</text>
</svg>
```

---

## 组合技巧

- **多面板组合**：把对比图的面板结构 + 原理图的内部结构组合，每面板左上角 A/B/C 角标，即得到论文里最常见的 multi-panel figure
- **反馈回路**：流程图中用 `stroke-dasharray="5 4"` 的橙色 `#F39B7F` 曲线（`<path d="M.. C..">`）从后段绕回前段，配 11px 标注"不通过 · 修订"
- **图注编号**：一篇文章多张图时编号连续（图 1、图 2……），描述写"是什么"而不是"画了什么"
