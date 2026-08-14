/* ============================================================
   阅读时长估算 —— 为文章计算 page.reading_time（分钟）
   供主题 post.ejs 的「X 分钟阅读」显示用（站点脚本，非主题修改）。
   规则：中文按 ~400 字/分钟，英文按 ~200 词/分钟，取两者之和，至少 1 分钟。
   ============================================================ */
'use strict';

hexo.extend.filter.register('after_post_render', function (data) {
  if (data.reading_time !== undefined) return data;
  if (!data.content) return data;

  var plain = String(data.content)
    .replace(/<code[\s\S]*?<\/code>/gi, ' ')   // 去掉行内/代码块
    .replace(/<[^>]+>/g, ' ');                  // 去 HTML 标签

  var cjk = (plain.match(/[\u4e00-\u9fff]/g) || []).length;
  var words = (plain.replace(/[\u4e00-\u9fff]/g, ' ').match(/[A-Za-z0-9]+/g) || []).length;

  var mins = Math.max(1, Math.round(cjk / 400 + words / 200));
  data.reading_time = mins;
  return data;
});
