/* global hexo */
'use strict';

// 修复主题配置数组合并问题：Hexo 对数组按索引合并，主题自带的 navbar（6 项）
// 与 _config.oranges.yml 的 navbar（5 项）合并后，多余项会残留
// （如主题默认的 About/Friends 英文项）。
// 这里在生成前用站点配置中的 navbar 整体替换合并结果。
hexo.extend.filter.register('before_generate', function () {
  var tc = hexo.config.theme_config;
  if (tc && Array.isArray(tc.navbar) && hexo.theme && hexo.theme.config) {
    hexo.theme.config.navbar = tc.navbar;
  }
});
