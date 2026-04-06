/**
 * 文章分类 API
 * @description 分类的增删改查操作
 */

import request from '@/utils/request';

export default {
  /**
   * 查询分类列表
   * @returns {Promise}
   */
  list() {
    return request({
      url: '/article/category/list',
      method: 'get',
    });
  },

  /**
   * 查询分类详情
   * @param {number} id - 分类ID
   * @returns {Promise}
   */
  getInfo(id) {
    return request({
      url: `/article/category/${id}`,
      method: 'get',
    });
  },

  /**
   * 创建分类
   * @param {Object} data - 分类数据
   * @returns {Promise}
   */
  add(data) {
    return request({
      url: '/article/category',
      method: 'post',
      data,
    });
  },

  /**
   * 更新分类
   * @param {Object} data - 分类数据
   * @returns {Promise}
   */
  update(data) {
    return request({
      url: '/article/category',
      method: 'put',
      data,
    });
  },

  /**
   * 删除分类
   * @param {number} id - 分类ID
   * @returns {Promise}
   */
  remove(id) {
    return request({
      url: `/article/category/${id}`,
      method: 'delete',
    });
  },
};
