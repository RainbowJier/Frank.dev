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
