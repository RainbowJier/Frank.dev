'use strict';

// 专栏目录名 → 展示名：归档页「按分组」视图与学习计划页文章选择器共用。
// 新增 source/_posts/articles/ 下的专栏目录时，在此补一行。
const groupDisplayNames = {
  'Java': 'Java',
  'Mybatis': 'Mybatis',
  'MYSQL': 'MySQL',
  'Redis': 'Redis',
  'RabbitMQ': 'RabbitMQ',
  'Oracle': 'Oracle',
  'Elasticsearch': 'Elasticsearch',
  'Vue': 'Vue',
  'AI': 'AI',
  'RESTful': 'RESTful',
  'MinIO': 'MinIO',
  'Springboot': 'Spring',
  'http-sse-websocket': 'SSE / WebSocket'
};

// 用源路径判断文章所属专栏（_posts/articles/<目录>/<文件>.md）；permalink 形如 .../articles/<目录>/<slug>/，
// 但 articles 根目录下的散文名为 .../articles/<slug>/，形状相同，故仅作兜底并要求两段路径。
hexo.extend.helper.register('post_column', function (post) {
  const source = String(post.source || '').replace(/\\/g, '/');
  let match = source.match(/_posts\/articles\/([^/]+)\/[^/]+$/);
  if (match) return groupDisplayNames[match[1]] || match[1];
  match = String(post.path || '').match(/articles\/([^/]+)\/[^/]+\/$/);
  if (match) return groupDisplayNames[match[1]] || match[1];
  return '其他';
});
