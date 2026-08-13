此目录用于存放图片等静态资源（如头像、项目截图、文章配图）。

使用方法：把图片文件放进本目录，然后在 HTML 中引用，例如：

```html
<img src="assets/avatar.png" alt="我的头像">
```

注意：`index.html`、`blog.html`、`projects.html` 引用用相对路径 `assets/xxx`；
`posts/` 目录下的文章引用时需要写成 `../assets/xxx`。
