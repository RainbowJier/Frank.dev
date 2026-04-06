import api from '@/api';
import defAva from '@/assets/user/profile.jpg';
import { getToken, setToken, removeToken } from '@/utils/auth';
import { defineStore } from 'pinia';
const useUserStore = defineStore('user', {
  state: () => ({
    token: getToken(),
    id: '',
    name: '',
    nickName: '',
    avatar: '',
  }),

  actions: {
    // 登录
    login(userInfo) {
      return new Promise((resolve, reject) => {
        api.userAuth.login(userInfo).then(res => {
          setToken(res.data.token);
          this.token = res.data.token;
          resolve();
        }).catch(error => {
          reject(error);
        });
      });
    },

    // 获取用户信息
    getInfo() {
      return new Promise((resolve, _reject) => {
        // Mock data to avoid calling the removed API
        const res = {
          code: 200,
          msg: '操作成功',
          data: {
            user: {
              userId: 1,
              userName: 'admin',
              nickName: 'Admin',
              avatar: '',
            },
          },
        };
        const user = res.data.user;
        const avatar =
          user.avatar === '' || user.avatar === null
            ? defAva
            : import.meta.env.VITE_APP_BASE_API + user.avatar;

        this.id = user.userId;
        this.name = user.userName;
        this.nickName = user.nickName;
        this.avatar = avatar;
        resolve(res);
      });
    },

    // 退出系统 - 调用后端接口
    logout() {
      return new Promise((resolve, reject) => {
        api.userAuth.logout().then(() => {
          this.token = '';
          removeToken();
          resolve();
        }).catch(error => {
          reject(error);
        });
      });
    },

    // 强制退出（不调用后端接口，直接清除本地状态）
    forceLogOut() {
      this.token = '';
      removeToken();
      return Promise.resolve();
    },

    // 重置 Token（用于路由守卫中的错误处理）
    resetToken() {
      this.token = '';
      removeToken();
      return Promise.resolve();
    },
  },
});

export default useUserStore;
