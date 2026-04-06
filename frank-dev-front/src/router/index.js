import { createWebHistory, createRouter } from 'vue-router';

import { setupRouterGuards } from './guards';
import { constantRoutes, errorRoutes } from './routes';

const router = createRouter({
  history: createWebHistory(),
  routes: [...constantRoutes, ...errorRoutes],
  scrollBehavior(to, from, savedPosition) {
    if (savedPosition) {
      return savedPosition;
    }
    return { top: 0 };
  },
});

// 注册路由守卫
setupRouterGuards(router);

export default router;
