# 部署指南：发布到 EdgeOne Pages

本网站是纯静态站点（无服务器、无数据库），EdgeOne Pages 是腾讯云提供的免费静态托管服务：
- ✅ 免费额度，足够个人网站使用
- ✅ 国内访问快（腾讯云 CDN 节点）
- ✅ 免费域名 `https://xxx.edgeone.app`，无需备案
- ✅ 支持从 Gitee / GitHub 仓库拉取自动部署

> ⚠️ 说明：Gitee 官方的 Pages 托管服务目前暂停，所以「代码放 Gitee，托管用 EdgeOne Pages」是最适合国内用户的组合。
> 控制台界面可能随版本更新而变化，下面的步骤看思路，具体按钮以实际页面为准。

---

## 方式 A：直接上传文件夹（最快，5 分钟上线）

适合第一次发布，不用碰 Git。

1. 打开 **EdgeOne Pages 控制台**（腾讯云官网 → 搜索「EdgeOne」→ 进入「Pages」，或用账号直接登录控制台）。首次使用可用微信 / Gitee 等账号登录，按提示完成。
2. 点击 **创建项目 / 新建 Pages 项目**。
3. 选择 **上传文件** 方式（或拖拽上传）。
4. 上传本目录 `my-site/` 下的**所有文件**（`index.html`、`css/`、`js/`、`posts/`、`assets/`，注意要把文件夹里的文件传进去，而不是传一个文件夹压缩包）。
5. 等待几秒构建完成，控制台会给你一个免费域名，例如：`https://yourname.edgeone.app`。
6. 浏览器打开该网址验证，部署完成 ✅

**以后更新内容**：改完文件后，重新上传整个文件夹覆盖即可（也可以用方式 B 免去手动上传）。

---

## 方式 B：Gitee 仓库 + 自动部署（推荐长期使用）

### 第 1 步：把网站推送到 Gitee

1. 在 [gitee.com](https://gitee.com) 登录，新建一个仓库（例如 `my-site`，选「公开」）。
2. 在项目根目录执行（替换 `你的用户名`）：

```bash
git init
git add .
git commit -m "init: 个人网站首版"
git branch -M main
git remote add origin https://gitee.com/你的用户名/my-site.git
git push -u origin main
```

（仓库建立后 Gitee 页面会显示具体地址，以它为准。）

### 第 2 步：在 EdgeOne Pages 绑定仓库

1. 打开 EdgeOne Pages 控制台 → 创建项目。
2. 选择 **从代码仓库导入 / Git 仓库** 方式。
3. 按提示授权绑定 Gitee 账号，选择仓库 `my-site`。
4. 构建配置保持默认即可（本网站无需构建步骤，直接发布）。
5. 点击 **部署**，获得免费域名，上线 ✅

**以后更新内容**：本地改完执行 `git add . && git commit -m "更新说明" && git push`，EdgeOne 会自动重新部署，无需任何手动操作。

---

## 常见问题

**Q：需要备案吗？**
A：使用 EdgeOne Pages 提供的免费子域名（`*.edgeone.app`）不需要备案。以后绑定自己的顶级域名时，域名在国内服务器托管才需要备案。

**Q：如何绑定自己的域名？**
A：在控制台项目设置 → 自定义域中绑定，然后到域名服务商处添加 CNAME 解析记录指向 EdgeOne 提供的地址，等待生效即可。

**Q：怎么修改网站内容？**
A：所有页面都是普通 HTML 文件，用编辑器打开直接改文字。改完按方式 A 重新上传，或按方式 B 执行 `git push` 即可。

**Q：如何新增博客文章？**
A：复制 `posts/hello-world.html`，改文件名和内容；然后在 `blog.html` 列表里复制一张文章卡片，改标题、日期、链接即可。

**Q：如何新增项目卡片？**
A：打开 `projects.html`，复制一张 `.project-card` 卡片，改标题、说明、标签和链接即可。

**Q：想让网站同时支持中文和英文？**
A：这是纯静态 HTML，最简单的方式是复制一套英文页面，再在导航加一个语言切换链接。
