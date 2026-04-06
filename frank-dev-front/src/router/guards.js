/**
 * 路由守卫
 * @description 处理路由认证和页面标题设置
 */

import useUserStore from '@/store/auth/user';
import { getToken } from '@/utils/auth';

// 白名单路由（无需认证）
const whiteList = ['/login', '/404', '/register', '/test/fig-mint'];

// 注册路由守卫的函数
export function setupRouterGuards(router) {
  // 路由前置守卫
  router.beforeEach(async (to, from, next) => {
    // 设置页面标题
    if (to.meta.title) {
      document.title = `${to.meta.title} - ${import.meta.env.VITE_APP_TITLE || 'AI Dev CID'}`;
    }

    const hasToken = getToken();

    if (hasToken) {
      if (to.path === '/login') {
        // 已登录，跳转到首页
        next({ path: '/' });
      } else {
        const userStore = useUserStore();

        // 判断是否已获取用户信息
        if (!userStore.name) {
          try {
            // 获取用户信息
            await userStore.getInfo();
          } catch (error) {
            // 获取用户信息失败，清除 token 并跳转到登录页
            await userStore.resetToken();
            next(`/login?redirect=${to.path}`);
            return;
          }
        }
        next();
      }
    } else {
      // 未登录
      if (whiteList.includes(to.path)) {
        next();
      } else {
        next(`/login?redirect=${to.path}`);
      }
    }
  });

  // 路由后置守卫
  router.afterEach(() => {
    // done
  });

  // 路由错误守卫
  router.onError((error) => {
    console.error('路由错误:', error);
  });
}
