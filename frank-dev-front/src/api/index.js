/**
 * API 统一导出
 * @description 集中管理所有 API 模块
 */

import userAuth from './auth/userAuth';
import articleApi from './article/articleApi';
import categoryApi from './article/categoryApi';

export default{
  userAuth,
  articleApi,
  categoryApi,
};
