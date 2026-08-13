/* ============================================================
   Frank's Notes · 中英双语切换
   用法：元素加 data-i18n="key"（纯文本）或 data-i18n-html="key"（含行内标签）
   切换按钮：<button class="lang-toggle" data-lang-toggle>中文 / English</button>
   语言记忆在 localStorage，默认中文。
   ============================================================ */

window.I18N = {
  zh: {
    /* 导航 */
    "nav.home": "首页",
    "nav.blog": "文章",
    "nav.projects": "作品",
    "nav.about": "关于",
    "lang.switch": "English",

    /* 页脚 */
    "footer.tagline": "个人主页 · 记录学习与思考",
    "footer.copyright": "© {year} Frank's Notes · 用 HTML 与 CSS 构建",

    /* 首页 */
    "home.name": "Frank",
    "home.subtitle": "前端开发者 · 终身学习者",
    "home.tagline": "把想法变成可用的产品，把学到的记录下来。",
    "home.contact": "邮箱",
    "home.about.en": "About",
    "home.about.zh": "关于我",
    "home.about.text": "你好，我是 Frank，一名前端开发者。我热爱把想法变成可用的产品，也喜欢在更广的技术栈里折腾——从 Spring 到多智能体框架，从计算机视觉到手写框架。这里记录我的学习路径、踩过的坑，以及偶尔的随想。",
    "home.skills.en": "Skills",
    "home.skills.zh": "技能",
    "home.exp.en": "Experience",
    "home.exp.zh": "经历",
    "home.exp1.title": "前端开发者",
    "home.exp1.date": "2024.07 — 至今",
    "home.exp1.desc": "负责 Web 应用的前端开发与用户体验优化。",
    "home.exp2.title": "计算机专业 · 本科",
    "home.exp2.date": "2020.09 — 2024.06",
    "home.exp2.desc": "系统学习计算机基础与软件开发，积累了丰富的实践项目经验。",
    "home.posts.en": "Latest Posts",
    "home.posts.zh": "最新文章",
    "home.posts.more": "查看全部文章 →",
    "home.projects.en": "Projects",
    "home.projects.zh": "精选作品",
    "home.projects.desc": "一些我做过的东西，从 Spring 全家桶到多智能体交易框架。",
    "home.projects.more": "浏览作品集 →",

    /* 文章列表页 */
    "blog.title": "文章",
    "blog.en": "Posts",
    "blog.subtitle": "一些关于代码、学习与生活的记录。",
    "post1.title": "你好，世界 —— 我的个人网站上线了",
    "post1.excerpt": "为什么在社交媒体之外，还需要一个属于自己的小角落。",
    "post2.title": "零服务器部署静态网站：从本地到上线",
    "post2.excerpt": "用一个纯静态网站走完「本地开发 → 自动部署 → 获得网址」的全过程。",

    /* 文章分类（筛选标签） */
    "cat.all": "全部",
    "cat.essay": "随笔",
    "cat.tech": "技术",

    /* 文章页通用 */
    "post.reading": "预计阅读 {n} 分钟",
    "post.prev": "← 上一篇",
    "post.next": "下一篇 →",
    "post.back": "← 返回列表",
    "post.author": "—— Frank",

    /* 文章1 正文 */
    "hello.eyebrow": "随笔 · No. 01",
    "hello.title": "你好，世界 —— 我的个人网站上线了",
    "hello.date": "2026 年 8 月 1 日",
    "hello.p1": "这是我的第一篇博客。花了一点时间，我终于在互联网上有了一个属于自己的、完全由我控制的小角落。这篇文章，想聊聊这个网站是什么、为什么要有它，以及我打算用它来做什么。",
    "hello.h2_1": "为什么要有个人网站",
    "hello.p2": "社交媒体上的内容会随着平台的变化而消失——链接会失效，账号会被封，算法会决定谁看到你的文字。而自己的网站不会。它像是互联网上的一个家：",
    "hello.li1": "可以完整地表达自己，不受字数与格式的限制；",
    "hello.li2": "学习过程中的笔记与思考，有了一个能沉淀下来的地方；",
    "hello.li3": "将来找工作或合作时，它就是最好的一张名片。",
    "hello.h2_2": "这个网站是怎么构成的",
    "hello.p3": "整个网站是纯静态的：HTML、CSS 和一点点 JavaScript，没有服务器、没有数据库、没有构建工具。这是刻意为之的选择——",
    "hello.quote": "静态网站是最简单、最可靠的形态：任何托管平台都能跑，几乎不会出故障，修改即发布。",
    "hello.p4": "如果你想搭一个类似的网站，核心其实只需要三个文件：",
    "hello.h2_3": "接下来打算写什么",
    "hello.p5": "计划中的话题大致有这么几类：",
    "hello.li4": "学习过程中踩过的坑，以及事后总结出来的方法；",
    "hello.li5": "一些有趣的小工具、小项目，以及复盘；",
    "hello.li6": "偶尔，一些与代码无关的随想。",
    "hello.h2_4": "写在最后",
    "hello.p6": "网站会持续更新。如果你看到这里，欢迎通过页脚的联系方式和我聊聊。祝我们都能拥有自己的小角落，并把想说的，认真写下来。",

    /* 文章2 正文 */
    "deploy.eyebrow": "技术 · No. 02",
    "deploy.title": "零服务器部署静态网站：从本地到上线",
    "deploy.date": "2026 年 7 月 20 日",
    "deploy.p1": "很多人以为「把网站做出来」很难，「让它能被全世界访问」更难。其实对一个纯静态网站来说，后者反而简单得令人意外——你不需要买服务器、不需要配环境，甚至不需要花钱。这篇文章，我们走完整条路。",
    "deploy.h2_1": "先理清一个概念：什么是「静态网站」",
    "deploy.p2": "静态网站，指的是网站由一堆固定的文件组成——HTML、CSS、JS、图片。浏览器请求某个地址，服务器就把对应文件原样发回来，没有数据库查询，没有动态渲染。",
    "deploy.p3": "它的好处很直接：",
    "deploy.li1": "快：文件直接发，没有计算；",
    "deploy.li2": "稳：没有运行中的程序，几乎不会崩；",
    "deploy.li3": "便宜：很多平台免费就能托管。",
    "deploy.h2_2": "三种常见的部署方式",
    "deploy.h3_1": "方式一：拖拽上传",
    "deploy.p4": "最简单。把整个文件夹拖到托管平台（如 EdgeOne Pages、Vercel）的上传区，等几秒，它给你一个网址。适合第一次发布，缺点是每次更新都要手动重传。",
    "deploy.h3_2": "方式二：Git 仓库 + 自动部署（推荐）",
    "deploy.p5": "把代码推到一个 Git 仓库（GitHub / Gitee），托管平台绑定仓库后，每次 git push 都会自动重新部署。一劳永逸。",
    "deploy.p6": "三行命令，网站就更新了。",
    "deploy.h3_3": "方式三：自建服务器",
    "deploy.p7": "买一台云服务器，用 Nginx 之类的软件托管文件。灵活、可控，但要自己维护、备案、续费。对个人小站来说，通常没必要。",
    "deploy.h2_3": "一条最省心的路径",
    "deploy.p8": "如果你只是想快速拥有一个能访问的个人网站，我会这样建议：",
    "deploy.li4": "用 HTML/CSS 把网站写出来（或者用一个模板）；",
    "deploy.li5": "把代码推到 GitHub；",
    "deploy.li6": "在 EdgeOne Pages 这类平台绑定仓库，开启自动部署；",
    "deploy.li7": "拿到平台给的免费域名，网站就上线了。",
    "deploy.quote": "整个过程不花一分钱，也不需要懂服务器。你唯一要学的，是基础的 Git 命令。",
    "deploy.h2_4": "最后",
    "deploy.p9": "「上线」这件事，门槛其实低到很多人想象不到。真正的难点从来不是技术，而是——你愿不愿意，把第一个版本先发出去。先上线，再迭代。共勉。",

    /* 作品集 */
    "projects.title": "作品集",
    "projects.en": "Projects",
    "projects.subtitle": "比起罗列技术栈，我更愿意讲清楚每个项目解决过什么问题。",
    "proj.view": "源码 →",
    "proj.more": "在 GitHub 查看全部 →",
    "proj1.desc": "基于多智能体 LLM 的金融交易框架。多个分工协作的 Agent 分析市场、辩论、给出交易决策——研究「让 LLM 像团队一样工作」。",
    "proj2.desc": "基于 Spring Framework 与 Spring Boot 的 API 网关，提供路由转发与更多能力。动手实现网关核心机制的过程，也是吃透微服务治理的过程。",
    "proj3.desc": "一套用于快速搭建 Web 系统的基础框架。把常用的认证、权限、分层等模块沉淀下来，新项目能更快起跑。",
    "proj4.desc": "MyBatis-Plus 的学习与实践仓库。从条件构造器到自动填充、分页插件，把常用特性都跑通并记录下来。",
    "proj5.desc": "基于 YOLOv5 的目标检测实践。从模型训练到推理部署，完整走一遍计算机视觉工程化的流程。",
    "proj6.desc": "手写一个迷你版 Spring。IoC、AOP 这些听起来抽象的概念，自己实现一遍之后，就再也不会觉得玄学了。",

    /* 关于页 */
    "about.title": "关于我",
    "about.en": "About",
    "about.p1": "你好，我是 Frank。一个相信「把想法做出来」比「把想法想完美」更重要的人。白天写代码，晚上偶尔写点字。",
    "about.p2": "我做前端开发，也喜欢在更广的技术栈里折腾——从 Spring 全家桶到多智能体框架，从计算机视觉到手写一个迷你版 Spring。比起追新名词，我更在意一个东西「到底是怎么运作的」。",
    "about.h2_1": "这个网站是什么",
    "about.p3": "Frank's Notes 是我的个人博客。它的存在不是为了表演，而是为了沉淀：把学过的东西记下来，把踩过的坑写下来，把偶尔闪过的想法留下来。如果某天某篇文字恰好帮到了你，那是它最好的归宿。",
    "about.p4": "网站本身是纯静态的——HTML、CSS 和一点点 JavaScript，托管在 EdgeOne Pages 上。没有框架，没有构建步骤，修改即发布。这种简单，我挺喜欢。",
    "about.h2_2": "一些事实",
    "about.fact1.label": "身份",
    "about.fact1.value": "前端开发者",
    "about.fact2.label": "所在地",
    "about.fact2.value": "中国",
    "about.fact3.label": "关注领域",
    "about.fact3.value": "Web · AI · 工程",
    "about.fact4.label": "写作工具",
    "about.fact4.value": "键盘与好奇心",
    "about.h2_3": "怎么找到我",
    "about.p5": "想聊聊技术、合作，或者只是想说声你好，欢迎通过下面任意一种方式找我。",
    "about.motto": "「先上线，再迭代。」—— 与所有迟迟不敢开始的人共勉。",

    /* ========== ★ 新文章字典从这里添加 ==========
       步骤：复制 posts/TEMPLATE.html → posts/xxx.html，
       把 key 前缀换成文章英文标识（如 my-post），
       在此加一篇 zh（必写）+ en（可选，缺省自动回退中文）。
       例：
       "my-post.eyebrow": "随笔 · No. 03",
       "my-post.title": "文章标题",
       "my-post.date": "2026 年 8 月 20 日",
       "my-post.p1": "正文第一段…",
       "my-post.h2_1": "小标题",
       "my-post.li1": "列表项",
       "my-post.quote": "引用",
    */
  },

  en: {
    /* 导航 */
    "nav.home": "Home",
    "nav.blog": "Posts",
    "nav.projects": "Projects",
    "nav.about": "About",
    "lang.switch": "中文",

    /* 页脚 */
    "footer.tagline": "Personal site · Notes on learning & building",
    "footer.copyright": "© {year} Frank's Notes · Built with HTML & CSS",

    /* 首页 */
    "home.name": "Frank",
    "home.subtitle": "Frontend Developer · Lifelong Learner",
    "home.tagline": "Turning ideas into products, and documenting what I learn.",
    "home.contact": "Email",
    "home.about.en": "About",
    "home.about.zh": "About Me",
    "home.about.text": "Hi, I'm Frank, a frontend developer. I love turning ideas into usable products and exploring beyond the frontend — from Spring to multi-agent frameworks, from computer vision to hand-writing frameworks. This site records my learning path, the pitfalls I stepped into, and occasional thoughts.",
    "home.skills.en": "Skills",
    "home.skills.zh": "Skills",
    "home.exp.en": "Experience",
    "home.exp.zh": "Experience",
    "home.exp1.title": "Frontend Developer",
    "home.exp1.date": "Jul 2024 — Present",
    "home.exp1.desc": "Building frontend for web applications and polishing user experience.",
    "home.exp2.title": "B.S. in Computer Science",
    "home.exp2.date": "Sep 2020 — Jun 2024",
    "home.exp2.desc": "Studied computer science fundamentals and software development with rich hands-on project experience.",
    "home.posts.en": "Latest Posts",
    "home.posts.zh": "Latest Posts",
    "home.posts.more": "View all posts →",
    "home.projects.en": "Projects",
    "home.projects.zh": "Selected Projects",
    "home.projects.desc": "Some things I've built — from the Spring ecosystem to a multi-agent trading framework.",
    "home.projects.more": "Browse projects →",

    /* 文章列表页 */
    "blog.title": "Posts",
    "blog.en": "Posts",
    "blog.subtitle": "Notes about code, learning and life.",
    "post1.title": "Hello, World — My Personal Site Is Live",
    "post1.excerpt": "Why we still need a corner of our own beyond social media.",
    "post2.title": "Deploy a Static Site with Zero Servers",
    "post2.excerpt": "From local development to auto-deployment and a public URL — the whole journey.",

    /* 文章分类（筛选标签） */
    "cat.all": "All",
    "cat.essay": "Essay",
    "cat.tech": "Tech",

    /* 文章页通用 */
    "post.reading": "{n} min read",
    "post.prev": "← Previous",
    "post.next": "Next →",
    "post.back": "← Back to list",
    "post.author": "— Frank",

    /* 文章1 正文 */
    "hello.eyebrow": "Essay · No. 01",
    "hello.title": "Hello, World — My Personal Site Is Live",
    "hello.date": "August 1, 2026",
    "hello.p1": "This is my first blog post. After some time, I finally have a small corner of the internet that is fully mine and under my control. This article is about what this site is, why I made it, and what I plan to do with it.",
    "hello.h2_1": "Why a personal website",
    "hello.p2": "Content on social media fades with platform changes — links break, accounts get banned, algorithms decide who sees your words. Your own website doesn't. It's like a home on the internet:",
    "hello.li1": "Express yourself fully, without word limits or format constraints;",
    "hello.li2": "Notes and thoughts from learning find a place to settle;",
    "hello.li3": "When hunting for a job or collaboration, it's the best business card.",
    "hello.h2_2": "How this site is built",
    "hello.p3": "The whole site is static: HTML, CSS and a bit of JavaScript. No servers, no databases, no build tools. This is a deliberate choice —",
    "hello.quote": "A static site is the simplest, most reliable form: any hosting platform can run it, it rarely breaks, and edits publish instantly.",
    "hello.p4": "If you want to build a similar site, you only need three files:",
    "hello.h2_3": "What's coming next",
    "hello.p5": "Planned topics roughly fall into these categories:",
    "hello.li4": "Pitfalls I stepped into while learning, and the methods I summarized;",
    "hello.li5": "Interesting little tools and projects, plus retrospectives;",
    "hello.li6": "Occasionally, thoughts unrelated to code.",
    "hello.h2_4": "Final words",
    "hello.p6": "The site will keep growing. If you've read this far, feel free to reach out via the contact links in the footer. May we all have our own little corner — and write down what we want to say, seriously.",

    /* 文章2 正文 */
    "deploy.eyebrow": "Tech · No. 02",
    "deploy.title": "Deploy a Static Site with Zero Servers",
    "deploy.date": "July 20, 2026",
    "deploy.p1": "Many people think \"building a website\" is hard and \"making it accessible worldwide\" is even harder. But for a purely static site, the latter is surprisingly simple — no servers, no environment setup, and it can even be free. This article walks the whole path.",
    "deploy.h2_1": "First, a concept: what is a \"static site\"",
    "deploy.p2": "A static site consists of fixed files — HTML, CSS, JS, images. When the browser requests a URL, the server sends back the file as-is: no database queries, no dynamic rendering.",
    "deploy.p3": "Its benefits are straightforward:",
    "deploy.li1": "Fast: files are served directly, no computation;",
    "deploy.li2": "Stable: no running programs, almost never crashes;",
    "deploy.li3": "Cheap: many platforms host it for free.",
    "deploy.h2_2": "Three common ways to deploy",
    "deploy.h3_1": "Way 1: Drag-and-drop upload",
    "deploy.p4": "The simplest. Drag the whole folder into a hosting platform (like EdgeOne Pages or Vercel), wait a few seconds, and get a URL. Good for the first release; the downside is re-uploading manually for every update.",
    "deploy.h3_2": "Way 2: Git repository + auto-deploy (recommended)",
    "deploy.p5": "Push code to a Git repository (GitHub / Gitee), bind it to a hosting platform, and every git push triggers an automatic redeploy. Set once, done forever.",
    "deploy.p6": "Three commands and the site is updated.",
    "deploy.h3_3": "Way 3: Self-hosted server",
    "deploy.p7": "Buy a cloud server and serve files with Nginx or similar. Flexible and controllable, but you have to maintain it, file ICP filings, and renew it. Usually unnecessary for a personal site.",
    "deploy.h2_3": "The most carefree path",
    "deploy.p8": "If you just want a personal site you can access quickly, here's my advice:",
    "deploy.li4": "Write the site in HTML/CSS (or use a template);",
    "deploy.li5": "Push the code to GitHub;",
    "deploy.li6": "Bind the repository on a platform like EdgeOne Pages and enable auto-deploy;",
    "deploy.li7": "Get the platform's free domain — the site is live.",
    "deploy.quote": "The whole process costs nothing and requires no server knowledge. The only thing you need to learn is basic Git commands.",
    "deploy.h2_4": "Finally",
    "deploy.p9": "The barrier to \"going live\" is far lower than most people imagine. The real difficulty was never technology — it's whether you're willing to ship the first version. Ship first, iterate later. Cheers.",

    /* 作品集 */
    "projects.title": "Projects",
    "projects.en": "Projects",
    "projects.subtitle": "Rather than listing tech stacks, I'd rather explain what problem each project solves.",
    "proj.view": "Source →",
    "proj.more": "View all on GitHub →",
    "proj1.desc": "A multi-agent LLM financial trading framework. Multiple agents analyze markets, debate, and make trading decisions — exploring how LLMs can work as a team.",
    "proj2.desc": "An API gateway built on Spring Framework and Spring Boot, providing routing and more. Implementing the gateway's core mechanisms is also a deep dive into microservice governance.",
    "proj3.desc": "A base framework for quickly building web systems, with auth, permissions and layered modules distilled for faster project starts.",
    "proj4.desc": "A learning & practice repo for MyBatis-Plus — from condition wrappers to auto-fill and pagination plugins, all common features tried and documented.",
    "proj5.desc": "Object detection practice based on YOLOv5 — from model training to inference deployment, walking through the full CV engineering pipeline.",
    "proj6.desc": "A mini Spring written by hand. Once you implement IoC and AOP yourself, these abstract concepts stop feeling magical.",
    "proj7.desc": "A graduation project exploring the OpenDigger data ecosystem with Python.",

    /* 关于页 */
    "about.title": "About Me",
    "about.en": "About",
    "about.p1": "Hi, I'm Frank. I believe \"shipping the idea\" matters more than \"perfecting the idea\". I write code by day and occasionally write words at night.",
    "about.p2": "I work on frontend development and love tinkering across the wider stack — from the Spring ecosystem to multi-agent frameworks, from computer vision to hand-writing a mini Spring. More than chasing buzzwords, I care about how things actually work.",
    "about.h2_1": "What this site is",
    "about.p3": "Frank's Notes is my personal blog. It exists not to perform, but to accumulate: writing down what I've learned, the pitfalls I've hit, and the thoughts that occasionally flash by. If some post happens to help you one day, that's its best possible ending.",
    "about.p4": "The site itself is purely static — HTML, CSS and a little JavaScript, hosted on EdgeOne Pages. No frameworks, no build steps, edit and publish. I quite like that simplicity.",
    "about.h2_2": "Some facts",
    "about.fact1.label": "Role",
    "about.fact1.value": "Frontend Developer",
    "about.fact2.label": "Location",
    "about.fact2.value": "China",
    "about.fact3.label": "Interests",
    "about.fact3.value": "Web · AI · Engineering",
    "about.fact4.label": "Writing tools",
    "about.fact4.value": "Keyboard & curiosity",
    "about.h2_3": "Find me",
    "about.p5": "To talk tech, collaborate, or just say hi — reach out through any channel below.",
    "about.motto": "\"Ship first, iterate later.\" — for everyone hesitating to start.",

    /* ========== ★ 新文章英文翻译从这里添加 ==========
       en 可选：某篇文章没写英文时，自动显示中文。
       写完后把上面 zh 示例对应的 en 文案放这里。
    */
  }
};

/* ---------- 切换逻辑 ---------- */
(function () {
  var STORAGE_KEY = "frank-notes-lang";
  var current = "zh";

  function applyLang(lang) {
    current = lang;
    var dict = window.I18N[lang] || window.I18N.zh;

    // 英文缺 key 时自动回退中文 —— 新文章只需写中文，英文可后补
    function getText(key) {
      if (dict[key] !== undefined) return dict[key];
      if (lang !== "zh" && window.I18N.zh[key] !== undefined) return window.I18N.zh[key];
      return undefined;
    }

    // 文本节点
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      var key = el.getAttribute("data-i18n");
      var text = getText(key);
      if (text !== undefined) {
        // 支持 {n} 占位符（如阅读时长），值来自 data-i18n-placeholder
        var ph = el.getAttribute("data-i18n-placeholder");
        if (ph !== null) text = text.replace("{n}", ph);
        el.textContent = text;
      }
    });

    // 含行内标签的节点（innerHTML）
    document.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-html");
      var html = getText(key);
      if (html !== undefined) el.innerHTML = html;
    });

    // 带 {year} 占位符的文本
    document.querySelectorAll("[data-i18n-year]").forEach(function (el) {
      var key = el.getAttribute("data-i18n-year");
      var text = getText(key);
      if (text !== undefined) {
        el.textContent = text.replace("{year}", String(new Date().getFullYear()));
      }
    });

    // 语言切换按钮文案
    var toggle = document.querySelector("[data-lang-toggle]");
    if (toggle) toggle.textContent = getText("lang.switch");

    // 文档标题（可选：页面标题的 key）
    var titleEl = document.querySelector("[data-i18n-title]");
    if (titleEl) {
      var tKey = titleEl.getAttribute("data-i18n-title");
      var tText = getText(tKey);
      if (tText) document.title = tText;
    }

    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) { /* ignore */ }
  }

  function toggleLang() {
    applyLang(current === "zh" ? "en" : "zh");
  }

  // 初始化
  var saved = "zh";
  try { saved = localStorage.getItem(STORAGE_KEY) || "zh"; } catch (e) { /* ignore */ }
  if (window.I18N[saved]) applyLang(saved);

  // 绑定切换按钮
  document.addEventListener("DOMContentLoaded", function () {
    var toggle = document.querySelector("[data-lang-toggle]");
    if (toggle) toggle.addEventListener("click", toggleLang);
  });
})();
