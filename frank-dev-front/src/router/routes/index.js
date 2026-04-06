/**
 * 路由模块
 * @description 路由定义
 */

// 公开路由（无需认证）
export const constantRoutes = [
  {
    path: '/login',
    name: 'Login',
    component: () => import('@/views/auth/Login.vue'),
    meta: {
      title: '登录',
      hidden: true,
    },
  },
  {
    path: '/',
    name: 'Index',
    component: () => import('@/views/home/index.vue'),
    meta: {
      title: '首页',
      icon: 'dashboard',
      affix: true,
    },
  },
  {
    path: '/article/list',
    name: 'ArticleList',
    component: () => import('@/views/article/ArticleList.vue'),
    meta: {
      title: '文章管理',
      icon: 'document',
    },
  },
  {
    path: '/article/create',
    name: 'ArticleCreate',
    component: () => import('@/views/article/ArticleForm.vue'),
    meta: {
      title: '新建文章',
      hidden: true,
    },
  },
  {
    path: '/article/edit/:id',
    name: 'ArticleEdit',
    component: () => import('@/views/article/ArticleForm.vue'),
    meta: {
      title: '编辑文章',
      hidden: true,
    },
  },
  {
    path: '/article/detail/:id',
    name: 'ArticleDetail',
    component: () => import('@/views/article/ArticleDetail.vue'),
    meta: {
      title: '文章详情',
      hidden: true,
    },
  },
  {
    path: '/article/category',
    name: 'CategoryList',
    component: () => import('@/views/article/CategoryList.vue'),
    meta: {
      title: '分类管理',
      icon: 'menu',
    },
  },
  {
    path: '/404',
    name: 'NotFound',
    component: () => import('@/views/error/404NotFound.vue'),
    meta: {
      title: '404 Not Found',
      hidden: true,
    },
  }
];

// 404/Unknown Route Catch-all
export const errorRoutes = [
  {
    path: '/:pathMatch(.*)*',
    redirect: '/404',
    meta: { hidden: true },
  },
];
