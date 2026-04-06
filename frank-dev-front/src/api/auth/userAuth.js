/**
 * 认证相关 API
 * @description 处理用户登录、登出、验证码等认证相关操作
 */

import request from '@/utils/request';

export default {
  /**
   * 用户登录
   * @param {Object} data - 登录数据
   * @param {string} data.username - 用户名
   * @param {string} data.password - 密码
   * @param {string} data.code - 验证码
   * @param {string} data.uuid - 验证码 UUID
   * @returns {Promise}
   */
  login(data) {
    return request({
      url: '/sys-login/login',
      method: 'post',
      data,
      headers: {
        isToken: false,
        repeatSubmit: false,
      },
    });
  },

  /**
   * 用户登出
   * @returns {Promise}
   */
  logout() {
    return request({
      url: '/sys-login/logout',
      method: 'post',
    });
  },

  /**
   * 用户注册
   * @param {Object} data - 注册数据
   * @returns {Promise}
   */
  register(data) {
    return request({
      url: '/register',
      method: 'post',
      data,
      headers: {
        isToken: false,
      },
    });
  },

  
};