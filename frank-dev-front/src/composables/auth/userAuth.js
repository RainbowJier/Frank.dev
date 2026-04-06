/**
 * 认证相关的 composable
 * @description 封装用户认证相关的逻辑
 */

import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';

import useUserStore from '@/store/auth/user';

/**
 * 用户认证 Hook
 * @returns {Object} 认证相关的方法和状态
 */
export function useAuth() {
  const router = useRouter();
  const userStore = useUserStore();
  
  const loading = ref(false);
  const error = ref(null);

  // 计算属性：用户是否已登录
  const isLoggedIn = computed(() => !!userStore.token);

  /**
   * 用户登录
   * @param {Object} loginForm - 登录表单数据
   * @returns {Promise<boolean>} 登录是否成功
   */
  const login = async (loginForm) => {
    try {
      loading.value = true;
      error.value = null;
      
      await userStore.login(loginForm);
      return true;
    } catch (err) {
      error.value = err.message || '登录失败';
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * 用户登出
   * @returns {Promise<void>}
   */
  const logout = async () => {
    try {
      await userStore.logout();
      await router.push('/login');
    } catch (err) {
      console.error('登出失败:', err);
    }
  };

  /**
   * 获取用户信息
   * @returns {Promise<Object>} 用户信息
   */
  const getUserInfo = async () => {
    try {
      loading.value = true;
      const userInfo = await userStore.getInfo();
      return userInfo;
    } catch (err) {
      error.value = err.message || '获取用户信息失败';
      throw err;
    } finally {
      loading.value = false;
    }
  };

  return {
    // 状态
    loading,
    error,
    isLoggedIn,
    
    // 方法
    login,
    logout,
    getUserInfo,
  };
}
