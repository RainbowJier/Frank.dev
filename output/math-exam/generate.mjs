// 九年级数学期中模拟试卷 — docx 生成脚本（试卷 + 参考答案）
import {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  ImageRun, Footer, PageNumber, AlignmentType, WidthType, BorderStyle,
  ShadingType, VerticalAlign, HeightRule,
} from "docx";
import fs from "fs";

const DIR = "D:/Projects/Frank.dev/output/math-exam";
const read = (p) => fs.readFileSync(`${DIR}/${p}`);

const SUN = { ascii: "Times New Roman", eastAsia: "SimSun" };
const HEI = { ascii: "Times New Roman", eastAsia: "SimHei" };
const INK = "000000";

const NB = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const NBs = { top: NB, bottom: NB, left: NB, right: NB };
const thin = { style: BorderStyle.SINGLE, size: 4, color: "000000" };
const thinBs = { top: thin, bottom: thin, left: thin, right: thin };

const CONTENT_W = 9506; // 11906 - 1200*2

// 富文本：~x~ 下标，^x^ 上标
function rich(text, base = {}) {
  const segs = text.split(/(~[^~]+~|\^[^^]+\^)/).filter((s) => s !== "");
  return segs.map((s) => {
    if (s.startsWith("~") && s.endsWith("~")) {
      return new TextRun({ text: s.slice(1, -1), size: 21, font: SUN, color: INK, subScript: true, ...base });
    }
    if (s.startsWith("^") && s.endsWith("^")) {
      return new TextRun({ text: s.slice(1, -1), size: 21, font: SUN, color: INK, superScript: true, ...base });
    }
    return new TextRun({ text: s, size: 21, font: SUN, color: INK, ...base });
  });
}

// ---------- 通用构件 ----------
function sectionTitle(text) {
  return new Paragraph({
    spacing: { before: 300, after: 150, line: 360 },
    keepNext: true,
    children: [new TextRun({ text, bold: true, size: 22, font: HEI, color: INK })],
  });
}

function stem(text, opts = {}) {
  return new Paragraph({
    spacing: { before: opts.before ?? 120, after: opts.after ?? 60, line: 360 },
    keepNext: true, keepLines: true,
    children: rich(text, opts.bold ? { bold: true } : {}),
  });
}

function subQ(text) {
  return new Paragraph({
    spacing: { before: 60, after: 40, line: 360 },
    keepNext: true, keepLines: true,
    children: rich(text),
  });
}

// 选项自动布局：估算宽度（中文 1.0，西文 0.55）
function estLen(s) {
  let w = 0;
  for (const ch of s) w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF]/.test(ch) ? 1 : 0.55;
  return w;
}
function optionTable(options) {
  const maxLen = Math.max(...options.map(estLen));
  const layout = maxLen <= 6 ? 4 : maxLen <= 16 ? 2 : 1;
  const cols = layout === 4 ? 4 : layout === 2 ? 2 : 1;
  const colW = Math.floor(CONTENT_W / cols);
  const labels = ["A", "B", "C", "D"];
  const rows = [];
  for (let r = 0; r < options.length / cols; r++) {
    rows.push(new TableRow({
      cantSplit: true,
      children: Array.from({ length: cols }, (_, c) => {
        const i = r * cols + c;
        const txt = i < options.length ? `${labels[i]}．${options[i]}` : "";
        return new TableCell({
          borders: NBs,
          width: { size: colW, type: WidthType.DXA },
          margins: { top: 0, bottom: 0, left: 60, right: 60 },
          children: [new Paragraph({
            spacing: { before: 20, after: 20, line: 360 },
            children: rich(txt),
          })],
        });
      }),
    }));
  }
  return new Table({ columnWidths: Array(cols).fill(colW), rows });
}

// 插图（原生 SVG + PNG 后备），题图题注
function figureBlock(svgName, dispW, dispH, qLabel) {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 100, after: 30, line: 240 },
      keepNext: true,
      children: [new ImageRun({
        type: "svg",
        data: read(`svg/${svgName}.svg`),
        transformation: { width: dispW, height: dispH },
        fallback: { type: "png", data: read(`png/${svgName}.png`) },
      })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 80, line: 360 },
      keepNext: true,
      children: [new TextRun({ text: `（${qLabel}图）`, size: 18, color: "666666", font: SUN })],
    }),
  ];
}

// 浅灰答题横线：无框表格 + 单元格底边框（行高固定，方便书写，可跨页按行断开）
function answerLines(n) {
  return [new Table({
    columnWidths: [CONTENT_W],
    rows: Array.from({ length: n }, () => new TableRow({
      cantSplit: true,
      height: { value: 520, rule: HeightRule.ATLEAST },
      children: [new TableCell({
        borders: { top: NB, left: NB, right: NB, bottom: { style: BorderStyle.SINGLE, size: 3, color: "CCCCCC" } },
        width: { size: CONTENT_W, type: WidthType.DXA },
        margins: { top: 0, bottom: 0, left: 40, right: 40 },
        children: [new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: " ", size: 21, font: SUN })],
        })],
      })],
    })),
  })];
}

// ---------- 试卷头部 ----------
function examHeaderBlock() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 60, line: 360 },
      children: [new TextRun({ text: "九年级数学期中模拟试卷", bold: true, size: 32, font: HEI, color: INK })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 100, line: 360 },
      children: [new TextRun({ text: "（2026—2027学年上学期　满分：120分　考试时间：120分钟）", size: 21, font: SUN, color: INK })],
    }),
    // 考生信息行
    new Table({
      columnWidths: [3168, 3168, 3170],
      rows: [new TableRow({
        cantSplit: true,
        children: [
          ["姓名：______________", AlignmentType.LEFT],
          ["班级：______________", AlignmentType.CENTER],
          ["考号：______________", AlignmentType.RIGHT],
        ].map(([t, align]) => new TableCell({
          borders: NBs,
          width: { size: 3168, type: WidthType.DXA },
          margins: { top: 20, bottom: 20, left: 40, right: 40 },
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({ alignment: align, spacing: { before: 0, after: 0, line: 360 }, children: rich(t) })],
        })),
      })],
    }),
    // 注意事项
    ...[
      "注意事项：",
      "1．本试卷共三大题24小题，满分120分，考试时间120分钟。",
      "2．答题前，请将姓名、班级、考号填写在本试卷相应位置。",
      "3．解答应写出必要的文字说明、证明过程或演算步骤。",
    ].map((t, i) => new Paragraph({
      alignment: i === 0 ? AlignmentType.CENTER : AlignmentType.LEFT,
      indent: i === 0 ? undefined : { left: 700 },
      spacing: { before: i === 0 ? 120 : 20, after: i === 3 ? 120 : 20, line: 360 },
      children: [new TextRun({ text: t, size: 20, color: "333333", font: SUN })],
    })),
    // 得分表
    new Table({
      alignment: AlignmentType.CENTER,
      width: { size: 80, type: WidthType.PERCENTAGE },
      columnWidths: [1901, 1901, 1901, 1901, 1902],
      rows: [
        new TableRow({
          tableHeader: true, cantSplit: true,
          children: ["题号", "一", "二", "三", "总分"].map((t) => new TableCell({
            borders: thinBs,
            shading: { type: ShadingType.CLEAR, fill: "F0F0F0" },
            margins: { top: 60, bottom: 60, left: 60, right: 60 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 360 },
              children: [new TextRun({ text: t, bold: true, size: 21, font: SUN, color: INK })],
            })],
          })),
        }),
        new TableRow({
          cantSplit: true,
          children: ["得分", "", "", "", ""].map((t) => new TableCell({
            borders: thinBs,
            margins: { top: 60, bottom: 60, left: 60, right: 60 },
            verticalAlign: VerticalAlign.CENTER,
            children: [new Paragraph({
              alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 360 },
              children: [new TextRun({ text: t || " ", bold: t !== "", size: 21, font: SUN, color: INK })],
            })],
          })),
        }),
      ],
    }),
  ];
}

// ---------- 选择题数据 ----------
const mcqs = [
  { num: 1, stem: "下列方程中，是一元二次方程的是（　　）", options: ["x−2＝0", "xy＋x＝1", "x²−2x−3＝0", "2x³−x²＝0"] },
  { num: 2, stem: "抛物线 y＝−2(x−1)²＋2 的顶点坐标是（　　）", options: ["(−1，2)", "(1，2)", "(1，−2)", "(−1，−2)"] },
  { num: 3, stem: "一元二次方程 x²−6x＋9＝0 的解是（　　）", options: ["x~1~＝x~2~＝3", "x~1~＝3，x~2~＝−3", "x~1~＝x~2~＝−3", "没有实数根"] },
  { num: 4, stem: "已知⊙O的半径为5 cm，点P到圆心O的距离OP＝4 cm，则点P与⊙O的位置关系是（　　）", options: ["点P在⊙O外", "点P在⊙O上", "点P在⊙O内", "无法确定"] },
  { num: 5, stem: "如图，在正方形网格中，△DEF是由△ABC旋转得到的，则旋转中心是（　　）", options: ["点M", "点N", "点Q", "点P"], fig: { name: "fig1-rotation-center-grid", w: 290, h: 304 } },
  { num: 6, stem: "下列事件中，是必然事件的是（　　）", options: ["打开电视机，正在播放广告", "任意画一个三角形，其内角和是180°", "掷一枚质地均匀的骰子，朝上一面的点数是6", "经过有交通信号灯的路口，遇到红灯"] },
  { num: 7, stem: "将抛物线 y＝2x² 向上平移3个单位长度，再向右平移1个单位长度，所得抛物线的解析式是（　　）", options: ["y＝2(x＋1)²＋3", "y＝2(x＋1)²−3", "y＝2(x−1)²−3", "y＝2(x−1)²＋3"] },
  { num: 8, stem: "二次函数 y＝ax²＋bx＋c 的图象如图所示，其与x轴的一个交点坐标为(−1，0)，对称轴为直线x＝1．现有以下结论：①abc＜0；②2a＋b＝0；③b²−4ac＞0；④4a−2b＋c＞0．其中正确的个数是（　　）", options: ["1个", "2个", "3个", "4个"], fig: { name: "fig2-parabola-coefficients", w: 280, h: 280 } },
  { num: 9, stem: "如图，A、B、C是⊙O上的三点，∠AOB＝100°，则∠ACB的度数是（　　）", options: ["25°", "50°", "60°", "80°"], fig: { name: "fig3-inscribed-angle", w: 280, h: 245 } },
  { num: 10, stem: "某种商品原价为每件100元，经过连续两次降价后，售价为每件81元．设平均每次降价的百分率为x，根据题意可列方程为（　　）", options: ["100(1−x)²＝81", "100(1＋x)²＝81", "100(1−2x)²＝81", "100(1−x²)＝81"] },
];

// ---------- 填空题数据 ----------
const fills = [
  { num: 11, text: "抛物线 y＝x²−2x＋3 与y轴的交点坐标为＿＿＿＿＿＿．" },
  { num: 12, text: "一元二次方程 x²＝3x 的解是＿＿＿＿＿＿＿＿．" },
  { num: 13, text: "半径为6的圆中，120°的圆心角所对的弧长为＿＿＿＿＿（结果保留π）．" },
  { num: 14, text: "如图，⊙O的半径为10，弦AB的长为16，则圆心O到弦AB的距离为＿＿＿＿＿．", fig: { name: "fig4-perpendicular-chord", w: 280, h: 229 } },
  { num: 15, text: "一个不透明的袋子中装有3个红球和2个白球，这些球除颜色外完全相同，随机摸出1个球，摸出的球恰好是红球的概率为＿＿＿＿＿．" },
  { num: 16, text: "已知二次函数 y＝x²−4x＋3，当0≤x≤5时，y的取值范围是＿＿＿＿＿＿＿．" },
];

// ---------- 试卷正文 ----------
const examChildren = [
  ...examHeaderBlock(),

  sectionTitle("一、选择题（本大题共10小题，每小题3分，共30分．每小题给出的四个选项中，只有一项符合题目要求）"),
  ...mcqs.flatMap((q) => [
    stem(`${q.num}．${q.stem}`),
    ...(q.fig ? figureBlock(q.fig.name, q.fig.w, q.fig.h, `第${q.num}题`) : []),
    optionTable(q.options),
  ]),

  sectionTitle("二、填空题（本大题共6小题，每小题3分，共18分．请把答案填在题中的横线上）"),
  ...fills.flatMap((q) => [
    new Paragraph({
      spacing: { before: 140, after: 60, line: 400 },
      keepLines: true,
      keepNext: q.fig ? true : false,
      children: rich(`${q.num}．${q.text}`),
    }),
    ...(q.fig ? figureBlock(q.fig.name, q.fig.w, q.fig.h, `第${q.num}题`) : []),
  ]),

  sectionTitle("三、解答题（本大题共8小题，共72分．解答应写出必要的文字说明、证明过程或演算步骤）"),

  stem("17．（6分）用配方法解方程：x²＋6x−7＝0．"),
  ...answerLines(6),

  stem("18．（8分）为创建绿色校园，某校2024年的绿化面积为20000平方米，计划经过两年建设，到2026年将绿化面积增加到28800平方米．求这两年绿化面积的年平均增长率．"),
  ...answerLines(7),

  stem("19．（8分）一个不透明的袋子中装有四张卡片，分别标有数字1、2、3、4，这些卡片除数字外完全相同．随机摸出1张卡片，记下数字后不放回，再随机摸出1张卡片．请用列表法或画树状图法，求两次摸出的卡片上的数字之和为奇数的概率．"),
  ...answerLines(8),

  stem("20．（10分）某校为了解学生每周课外阅读时间t（单位：小时），随机抽取部分学生进行调查，并将结果分为四组：A组（0≤t＜3），B组（3≤t＜6），C组（6≤t＜9），D组（t≥9），绘制成如图所示的不完整统计图．"),
  ...figureBlock("fig5-reading-stats-panels", 540, 237, "第20题"),
  subQ("（1）求本次调查共抽取的学生人数n，及扇形统计图中m的值；"),
  ...answerLines(3),
  subQ("（2）求C组的人数；"),
  ...answerLines(2),
  subQ("（3）若该校共有2000名学生，请估计每周课外阅读时间t≥9小时的学生人数．"),
  ...answerLines(3),

  stem("21．（8分）如图，在△OAB中，OA＝OB，点C是AB的中点，以点O为圆心、OC为半径作⊙O．"),
  ...figureBlock("fig6-tangent-isosceles", 288, 228, "第21题"),
  subQ("（1）求证：AB与⊙O相切；"),
  ...answerLines(5, 2),
  subQ("（2）若OA＝5，AB＝8，求⊙O的半径．"),
  ...answerLines(3),

  stem("22．（10分）已知二次函数的图象经过点(0，3)，(1，0)，(3，0)．"),
  subQ("（1）求该二次函数的解析式；"),
  ...answerLines(3),
  subQ("（2）求该二次函数图象的顶点坐标，并直接写出对称轴；"),
  ...answerLines(2),
  subQ("（3）当0＜x＜4时，直接写出y的取值范围．"),
  ...answerLines(2),

  stem("23．（10分）某商店销售一种商品，进价为每件40元．当售价为每件60元时，每周可售出300件；售价每上涨1元，每周少售出10件．设该商品售价为每件x元（60≤x≤80），每周销售利润为w元．"),
  subQ("（1）求w与x之间的函数关系式；"),
  ...answerLines(3),
  subQ("（2）当售价为每件多少元时，每周销售利润最大？最大利润是多少元？"),
  ...answerLines(4),

  stem("24．（12分）如图，抛物线 y＝x²−2x−3 与x轴交于A、B两点（点A在点B的左侧），与y轴交于点C，点P是抛物线在第四象限内的图象上一动点．"),
  ...figureBlock("fig7-parabola-triangle-area", 280, 293, "第24题"),
  subQ("（1）求点A、B、C的坐标；"),
  ...answerLines(2),
  subQ("（2）求△ABC的面积；"),
  ...answerLines(3),
  subQ("（3）连接PB、PC，当△PBC的面积最大时，求点P的坐标及△PBC面积的最大值．"),
  ...answerLines(6),

  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 240, after: 0, line: 360 },
    children: [new TextRun({ text: "（试卷完，请认真检查！）", size: 20, color: "333333", font: SUN })],
  }),
];

// ---------- 参考答案 ----------
const answerChildren = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120, line: 360 },
    children: [new TextRun({ text: "九年级数学期中模拟试卷　参考答案", bold: true, size: 28, font: HEI, color: INK })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 200, line: 360 },
    children: [new TextRun({ text: "（2026—2027学年上学期）", size: 21, font: SUN, color: INK })],
  }),

  sectionTitle("一、选择题（每小题3分，共30分）"),
  new Table({
    alignment: AlignmentType.CENTER,
    width: { size: 96, type: WidthType.PERCENTAGE },
    columnWidths: [950, ...Array(10).fill(Math.floor((CONTENT_W * 0.96 - 950) / 10))],
    rows: [
      new TableRow({
        tableHeader: true, cantSplit: true,
        children: ["题号", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10"].map((t) => new TableCell({
          borders: thinBs,
          shading: { type: ShadingType.CLEAR, fill: "F0F0F0" },
          margins: { top: 50, bottom: 50, left: 40, right: 40 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 360 },
            children: [new TextRun({ text: t, bold: true, size: 21, font: SUN, color: INK })],
          })],
        })),
      }),
      new TableRow({
        cantSplit: true,
        children: ["答案", "C", "B", "A", "C", "D", "B", "D", "C", "B", "A"].map((t) => new TableCell({
          borders: thinBs,
          margins: { top: 50, bottom: 50, left: 40, right: 40 },
          children: [new Paragraph({
            alignment: AlignmentType.CENTER, spacing: { before: 0, after: 0, line: 360 },
            children: [new TextRun({ text: t, size: 21, font: SUN, color: INK })],
          })],
        })),
      }),
    ],
  }),

  sectionTitle("二、填空题（每小题3分，共18分）"),
  ...[
    "11．(0，3)",
    "12．x~1~＝0，x~2~＝3",
    "13．4π",
    "14．6",
    "15．3/5",
    "16．−1≤y≤8",
  ].map((t) => new Paragraph({ spacing: { before: 40, after: 40, line: 360 }, children: rich(t) })),

  sectionTitle("三、解答题（共72分）"),
  ...[
    { h: "17．（6分）", lines: [
      "解：移项，得 x²＋6x＝7．配方，得 x²＋6x＋9＝16，即 (x＋3)²＝16．",
      "则 x＋3＝±4，所以 x~1~＝1，x~2~＝−7．",
    ]},
    { h: "18．（8分）", lines: [
      "解：设这两年绿化面积的年平均增长率为x．由题意得 20000(1＋x)²＝28800，",
      "即 (1＋x)²＝1.44，1＋x＝±1.2．∵ 1＋x＞0，∴ 1＋x＝1.2，x＝0.2＝20%．",
      "答：这两年绿化面积的年平均增长率为20%．",
    ]},
    { h: "19．（8分）", lines: [
      "解：列表（或树状图）可得，两次摸卡共有12种等可能的结果：",
      "(1,2)，(1,3)，(1,4)，(2,1)，(2,3)，(2,4)，(3,1)，(3,2)，(3,4)，(4,1)，(4,2)，(4,3)．",
      "其中数字之和为奇数的有8种：(1,2)，(1,4)，(2,1)，(2,3)，(3,2)，(3,4)，(4,1)，(4,3)．",
      "所以 P(数字之和为奇数)＝8/12＝2/3．",
    ]},
    { h: "20．（10分）", lines: [
      "解：（1）由条形图，A组40人；由扇形图，A组占20%．n＝40÷20%＝200．",
      "B组所占百分比为 60÷200＝30%，D组占15%，",
      "所以 m%＝1−20%−30%−15%＝35%，即 m＝35．",
      "（2）C组人数＝200−40−60−30＝70（人）．",
      "（3）2000×15%＝300（人）．即全校约有300名学生每周课外阅读时间不少于9小时．",
    ]},
    { h: "21．（8分）", lines: [
      "（1）证明：∵ OA＝OB，点C是AB的中点，∴ OC⊥AB（等腰三角形底边上的中线与高互相重合）．",
      "又∵ OC是⊙O的半径，点C在⊙O上，即直线AB经过半径OC的外端且垂直于半径OC，",
      "∴ AB与⊙O相切．",
      "（2）解：AC＝1/2·AB＝4．在Rt△OAC中，∠OCA＝90°，",
      "OC＝√(OA²−AC²)＝√(5²−4²)＝√9＝3．即⊙O的半径为3．",
    ]},
    { h: "22．（10分）", lines: [
      "解：（1）设 y＝ax²＋bx＋c．将 (0，3)，(1，0)，(3，0) 代入，得 c＝3；a＋b＋c＝0；9a＋3b＋c＝0．",
      "解得 a＝1，b＝−4．所以 y＝x²−4x＋3．",
      "（2）y＝(x−2)²−1．顶点坐标为(2，−1)，对称轴为直线 x＝2．",
      "（3）当0＜x＜4时，y的最小值为−1（x＝2时取得），y随x趋近于0或4而趋近于3但取不到3，",
      "所以 −1≤y＜3．",
    ]},
    { h: "23．（10分）", lines: [
      "解：（1）售价为每件x元时，每周销量为 300−10(x−60)＝(900−10x) 件，",
      "w＝(x−40)(900−10x)＝−10x²＋1300x−36000（60≤x≤80）．",
      "（2）w＝−10(x−65)²＋6250．∵ 60≤65≤80，",
      "∴ 当 x＝65 时，w取最大值6250．",
      "答：售价定为每件65元时，每周销售利润最大，最大利润为6250元．",
    ]},
    { h: "24．（12分）", lines: [
      "解：（1）令 y＝0，x²−2x−3＝0，解得 x~1~＝−1，x~2~＝3，故 A(−1，0)，B(3，0)；",
      "令 x＝0，y＝−3，故 C(0，−3)．",
      "（2）AB＝3−(−1)＝4，OC＝3，S△ABC＝1/2×AB×OC＝1/2×4×3＝6．",
      "（3）设直线BC的解析式为y＝kx＋b，将B(3，0)，C(0，−3)代入得 y＝x−3．",
      "设P(t，t²−2t−3)（0＜t＜3），BC＝√(3²＋3²)＝3√2，",
      "点P到直线BC的距离 d＝|t−(t²−2t−3)−3|/√2＝(3t−t²)/√2．",
      "S△PBC＝1/2×3√2×(3t−t²)/√2＝(3/2)t(3−t)＝−(3/2)(t−3/2)²＋27/8．",
      "∵ 0＜3/2＜3，∴ 当 t＝3/2 时，S△PBC 最大，最大值为27/8，",
      "此时 t²−2t−3＝9/4−3−3＝−15/4，即 P(3/2，−15/4)．",
    ]},
  ].flatMap(({ h, lines }) => [
    new Paragraph({
      spacing: { before: 160, after: 40, line: 360 },
      keepNext: true,
      children: [new TextRun({ text: h, bold: true, size: 21, font: SUN, color: INK })],
    }),
    ...lines.map((t) => new Paragraph({ spacing: { before: 20, after: 20, line: 360 }, children: rich(t) })),
  ]),
];

// ---------- 组装 ----------
const pageProps = {
  page: {
    size: { width: 11906, height: 16838 },
    margin: { top: 850, bottom: 850, left: 1200, right: 1200 },
  },
};
const footer = () => new Footer({
  children: [new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 0 },
    children: [new TextRun({ children: [PageNumber.CURRENT], size: 18, font: SUN })],
  })],
});
const defaultStyles = {
  default: {
    document: {
      run: { font: SUN, size: 21, color: INK },
      paragraph: { spacing: { line: 360 } },
    },
  },
};

const examDoc = new Document({
  creator: "Math Dept.",
  title: "九年级数学期中模拟试卷",
  styles: defaultStyles,
  sections: [{ properties: pageProps, footers: { default: footer() }, children: examChildren }],
});

const answerDoc = new Document({
  creator: "Math Dept.",
  title: "九年级数学期中模拟试卷 参考答案",
  styles: defaultStyles,
  sections: [{ properties: pageProps, footers: { default: footer() }, children: answerChildren }],
});

const buf1 = await Packer.toBuffer(examDoc);
fs.writeFileSync(`${DIR}/九年级数学期中模拟试卷.docx`, buf1);
console.log("试卷 OK", buf1.length, "bytes");
const buf2 = await Packer.toBuffer(answerDoc);
fs.writeFileSync(`${DIR}/九年级数学期中模拟试卷-参考答案.docx`, buf2);
console.log("参考答案 OK", buf2.length, "bytes");
