---
name: research-svg
description: 生成科研论文风格的 SVG 配图（流程图、架构图、原理示意图、对比图、数据图、时间线），采用 Nature 期刊 NPG 学术配色。当用户想为博客文章生成任何配图、插图、示意图、流程图、架构图、原理图、图表，或提到 SVG、文章插图、正文配图时使用——即使用户没有明说"科研风格"。
---

# 科研风格 SVG 配图生成

为 frank.dev（Hexo 博客）的文章生成学术期刊风格的正文配图。产出物是**自包含的静态 SVG 文件**，保存到 `source/images/svg/`，在文章中用 markdown 直接引用。

目标审美：Nature / Science 论文里的 Figure——白底、细线、克制的配色、带面板角标（A/B/C）和图注（图 1｜……），而不是营销页的花哨插画。

## 工作流程

1. **判断图类型**：流程图 / 分层架构图 / 标注式原理图 / 对比图 / 数据图 / 时间线。然后读取本 skill 目录下的 `references/templates.md`，以对应模板为起点改内容——模板定义了视觉语言，不要另起炉灶。
2. **提取内容**：从用户描述或文章上下文中列出节点、流向、分组、标注点。信息不足时基于文章语义合理补充，先出图再说，不要反问打断。
3. **绘制**：严格按下面的设计规范写 SVG。
4. **自检**（必做，顺序执行）：
   - XML 合法性：`python -c "import xml.etree.ElementTree as ET; ET.parse(r'source/images/svg/<文件名>.svg')"`
   - 逐条 `<text>` 用宽度公式估算是否溢出所在盒子（见"文本硬性规则"）
   - 确认无外部依赖：不引用外部字体、图片、脚本、CSS
5. **交付**：报告保存路径，并给出可直接粘贴进文章的引用：

   ```markdown
   ![图1：三智能体架构](/images/svg/agent-harness-architecture.svg)
   ```

## 配色：Nature NPG 学术色系

| 角色 | 色值 | 用途 |
|------|------|------|
| 主色·深蓝 | `#3C5488` | 标题、主要结构、面板角标 |
| 辅色·青 | `#4DBBD5` | 次要模块、第二类元素 |
| 辅色·青绿 | `#00A087` | 目标态、成功/通过 |
| 强调·红 | `#E64B35` | 警示、关键差异（一张图最多一处） |
| 辅助·橙 | `#F39B7F` | 反馈回路、第三类元素 |
| 辅助·灰紫 | `#8491B4` | 背景层、弱化元素 |

中性色（每张图都必须有）：

| 用途 | 色值 |
|------|------|
| 画布背景（纸张感） | `#FFFFFF` |
| 墨色（正文文字） | `#252A33` |
| 次灰（说明、图注） | `#6B7280` |
| 边框、分隔线 | `#D9DFE8` |
| 模块浅底、表头 | `#F4F7FA` |
| 图表网格线 | `#E8EDF3` |
| 箭头、轴线 | `#5A6472` |

**用色规则**（这是"科研感"的核心，违反就会变成商务 PPT 风）：

- 填充一律低饱和：模块用 palette 色 `fill-opacity="0.10"`~`"0.15"` + 同色实色描边 1.5~2px，像论文示意图的"彩窗描边"画法
- 一张图的 palette 主色不超过 3 种；同一流程的同类节点用同一颜色
- 红色 `#E64B35` 只留给最重要的那一个警示/差异点
- 文字永远用墨色或次灰，不要用 palette 色写正文；palette 色只上图形不上文字
- 白色背景必须显式画出（博客有深色主题，白底让配图像"论文插图卡片"一样在两种主题下都可读）

## 字体与排版

字体栈（中文博客必需，缺中文字体会导致渲染退化）：

```
font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif"
```

字号阶梯（最小 11px，再小不可读）：

| 元素 | 字号 | 颜色/字重 |
|------|------|-----------|
| 图内小标题 | 18–20 | `#252A33`，weight 600 |
| 模块/节点标签 | 14–15 | `#252A33`，weight 500 |
| 子标注、协议名 | 11–12 | `#6B7280` |
| 面板角标 A/B/C | 16–18 | `#3C5488`，weight 700 |
| 图注（图 1｜……） | 12 | `#6B7280` |

排版规则：

- 图注固定放图底部居中：`图 N｜一句话描述`，图内不放大标题（期刊 Figure 都靠 caption 说话）
- 多面板图左上角加粗体角标 **A / B / C**——这是最有"论文味"的一个元素
- 外边距 ≥ 28px，元素间距 ≥ 16px；默认画布宽 820（适配博客内容栏），高度按内容 260–700
- 画布最外层加 0.5px `#D9DFE8` 细边框，防止白底图在深色主题里"无限融化"

## 图形语言

- 描边：细结构 1.5px、主框架 2px，`stroke-linecap="round"`
- 圆角：容器 `rx="10"`、元件 `rx="6"`
- 箭头：`<marker>` 定义（模板里有现成的），线色 `#5A6472` 或模块主色，1.5px
- 虚线只用于"间接/反馈/可选"路径：`stroke-dasharray="5 4"`
- 标注引线：1px `#9AA4B2` 细线 + 起点小圆点 `r="2.5"`，指向说明文字
- 图表网格线只用 `#E8EDF3` 1px，坐标轴线用 `#5A6472` 1.5px

## 文本硬性规则（SVG 配图最常见的翻车点）

写每个 `<text>` 前先估算宽度：

- 中日韩字符宽 ≈ `1.0 × font-size`
- 拉丁字母/数字 ≈ `0.55 × font-size`
- 盒内可用文本宽 = 盒宽 − 24（左右各 12px padding）

溢出时的处理优先级：**换行（`<tspan dy="1.5em">`）＞ 缩字号（下限 11px）＞ 加宽盒子**。

其他：

- 转义 `&` `<` `>` 为 `&amp;` `&lt;` `&gt;`
- 多行文本用 `<tspan>`，行高 1.5em；居中文本 `text-anchor="middle"`，基线 y 要手动 +5 左右补偿视觉居中
- 文件名用小写 kebab-case 英文，能望文生义：`context-reset-vs-compaction.svg`

## 保存与引用

- 保存到 `source/images/svg/<文件名>.svg`
- 文章中引用：`![图1：xxx](/images/svg/<文件名>.svg)`
- 交付时提醒用户：图片会随 `push main` 自动部署上线

## 迷你示例（视觉语言速查）

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 820 180" width="820" height="180"
     font-family="'Noto Sans SC','PingFang SC','Microsoft YaHei','Helvetica Neue',Arial,sans-serif">
  <rect width="820" height="180" fill="#FFFFFF"/>
  <rect x="0.5" y="0.5" width="819" height="179" fill="none" stroke="#D9DFE8"/>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M0 0 L10 5 L0 10 z" fill="#5A6472"/>
    </marker>
  </defs>
  <!-- 同类节点同色：低饱和填充 + 实色描边 -->
  <rect x="80" y="55" width="140" height="52" rx="8" fill="#3C5488" fill-opacity="0.12" stroke="#3C5488" stroke-width="1.5"/>
  <text x="150" y="86" text-anchor="middle" font-size="14" font-weight="500" fill="#252A33">上下文重置</text>
  <!-- 箭头 -->
  <line x1="228" y1="81" x2="330" y2="81" stroke="#5A6472" stroke-width="1.5" marker-end="url(#arrow)"/>
  <!-- 目标态用青绿 -->
  <rect x="336" y="55" width="140" height="52" rx="8" fill="#00A087" fill-opacity="0.12" stroke="#00A087" stroke-width="1.5"/>
  <text x="406" y="86" text-anchor="middle" font-size="14" font-weight="500" fill="#252A33">干净的新起点</text>
  <!-- 图注 -->
  <text x="410" y="156" text-anchor="middle" font-size="12" fill="#6B7280">图 1｜上下文重置示意</text>
</svg>
```

需要完整的六类图模板（流程 / 架构 / 原理标注 / 对比 / 数据 / 时间线）时，读 `references/templates.md`。
