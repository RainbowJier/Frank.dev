import api from '@/api';
import { defineStore } from 'pinia';

const useArticleStore = defineStore('article', {
  state: () => ({
    articleList: [],
    currentArticle: null,
    total: 0,
    pageNum: 1,
    pageSize: 10,
    categories: [],
  }),

  actions: {
    /**
     * 分页查询文章列表
     */
    fetchArticles(params = {}) {
      return new Promise((resolve, reject) => {
        api.articleApi.page({
          pageNum: this.pageNum,
          pageSize: this.pageSize,
          ...params,
        }).then(res => {
          this.articleList = res.data.rows || [];
          this.total = res.data.total || 0;
          this.pageNum = res.data.pageNum || 1;
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 查询文章详情
     */
    fetchArticle(id) {
      return new Promise((resolve, reject) => {
        api.articleApi.getInfo(id).then(res => {
          this.currentArticle = res.data;
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 创建文章
     */
    createArticle(data) {
      return new Promise((resolve, reject) => {
        api.articleApi.add(data).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 更新文章
     */
    updateArticle(data) {
      return new Promise((resolve, reject) => {
        api.articleApi.update(data).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 删除文章
     */
    deleteArticle(id) {
      return new Promise((resolve, reject) => {
        api.articleApi.remove(id).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 更新文章状态
     */
    updateStatus(id, status) {
      return new Promise((resolve, reject) => {
        api.articleApi.updateStatus({ id, status }).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 更新文章置顶状态
     */
    updateTop(id, isTop) {
      return new Promise((resolve, reject) => {
        api.articleApi.updateTop({ id, isTop }).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 获取分类列表
     */
    fetchCategories() {
      return new Promise((resolve, reject) => {
        api.categoryApi.list().then(res => {
          this.categories = res.data || [];
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 创建分类
     */
    createCategory(data) {
      return new Promise((resolve, reject) => {
        api.categoryApi.add(data).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 更新分类
     */
    updateCategory(data) {
      return new Promise((resolve, reject) => {
        api.categoryApi.update(data).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },

    /**
     * 删除分类
     */
    deleteCategory(id) {
      return new Promise((resolve, reject) => {
        api.categoryApi.remove(id).then(res => {
          resolve(res);
        }).catch(error => {
          reject(error);
        });
      });
    },
  },
});

export default useArticleStore;
