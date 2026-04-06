/**
 * 文章管理 API
 * @description 文章的增删改查、发布、置顶等操作
 */

import request from '@/utils/request';

export default {
  /**
   * 分页查询文章列表
   * @param {Object} params - 查询参数
   * @param {string} params.title - 标题关键词
   * @param {number} params.categoryId - 分类ID
   * @param {number} params.status - 状态
   * @param {number} params.pageNum - 页码
   * @param {number} params.pageSize - 每页数量
   * @returns {Promise}
   */
  page(params) {
    return request({
      url: '/article/page',
      method: 'get',
      params,
    });
  },

  /**
   * 查询文章详情
   * @param {number} id - 文章ID
   * @returns {Promise}
   */
  getInfo(id) {
    return request({
      url: `/article/${id}`,
      method: 'get',
    });
  },

  /**
   * 创建文章
   * @param {Object} data - 文章数据
   * @returns {Promise}
   */
  add(data) {
    return request({
      url: '/article',
      method: 'post',
      data,
    });
  },

  /**
   * 更新文章
   * @param {Object} data - 文章数据
   * @returns {Promise}
   */
  update(data) {
    return request({
      url: '/article',
      method: 'put',
      data,
    });
  },

  /**
   * 删除文章
   * @param {number} id - 文章ID
   * @returns {Promise}
   */
  remove(id) {
    return request({
      url: `/article/${id}`,
      method: 'delete',
    });
  },

  /**
   * 更新文章状态（发布/取消发布）
   * @param {Object} data - { id, status }
   * @returns {Promise}
   */
  updateStatus(data) {
    return request({
      url: '/article/status',
      method: 'put',
      data,
    });
  },

  /**
   * 更新文章置顶状态
   * @param {Object} data - { id, isTop }
   * @returns {Promise}
   */
  updateTop(data) {
    return request({
      url: '/article/top',
      method: 'put',
      data,
    });
  },
};
