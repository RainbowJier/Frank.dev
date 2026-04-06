package org.frank.application.service;

import org.frank.shared.article.req.ArticleCategoryReq;
import org.frank.shared.article.resp.ArticleCategoryResp;

import java.util.List;

/**
 * 文章分类服务接口
 *
 * @author Frank
 */
public interface ArticleCategoryService {

    /**
     * 查询所有分类列表
     *
     * @return 分类列表
     */
    List<ArticleCategoryResp> selectCategoryList();

    /**
     * 根据ID查询分类详情
     *
     * @param id 分类ID
     * @return 分类详情
     */
    ArticleCategoryResp selectCategoryById(Long id);

    /**
     * 创建分类
     *
     * @param categoryReq 分类请求对象
     */
    void createCategory(ArticleCategoryReq categoryReq);

    /**
     * 更新分类
     *
     * @param categoryReq 分类请求对象
     */
    void updateCategory(ArticleCategoryReq categoryReq);

    /**
     * 删除分类（逻辑删除）
     *
     * @param id 分类ID
     */
    void deleteCategory(Long id);
}
