---
title: Hexo 发布文章流程
date: 2026-08-14 11:06:25
categories:
  - 教程
tags:
  - Hexo
description: 从创建到上线，Hexo 发布文章的最简流程。
---

这是一篇演示文章，用来验证文章发布流程。完整步骤如下：

## 1. 创建文章

```bash
pnpm exec hexo new 文件名
```

生成的文件在 `source/_posts/` 下，填写 front-matter（标题、日期、分类、标签）和 Markdown 正文。

## 2. 本地预览

```bash
pnpm exec hexo server
```

访问 http://localhost:4000 ，修改文件后自动重新生成，刷新即可看到。

## 3. 发布上线

```bash
git add source/_posts/
git commit -m "feat: 发布新文章"
git push
```

推送到 `main` 后 GitHub Actions 自动构建部署，约 1 分钟线上生效。
