package org.frank.application.service;

import org.frank.mybatis.domain.PageResult;
import org.frank.shared.article.req.ArticlePageReq;
import org.frank.shared.article.req.ArticleReq;
import org.frank.shared.article.resp.ArticleResp;

/**
 * 文章服务接口
 *
 * @author Frank
 */
public interface ArticleService {

    /**
     * 分页查询文章列表
     *
     * @param pageReq 分页查询参数
     * @return 分页结果
     */
    PageResult selectArticlePage(ArticlePageReq pageReq);

    /**
     * 根据ID查询文章详情
     *
     * @param id 文章ID
     * @return 文章详情
     */
    ArticleResp selectArticleById(Long id);

    /**
     * 创建文章
     *
     * @param articleReq 文章请求对象
     * @param authorId   作者ID
     */
    void createArticle(ArticleReq articleReq, Long authorId);

    /**
     * 更新文章
     *
     * @param articleReq 文章请求对象
     */
    void updateArticle(ArticleReq articleReq);

    /**
     * 删除文章（逻辑删除）
     *
     * @param id 文章ID
     */
    void deleteArticle(Long id);

    /**
     * 发布/取消发布文章
     *
     * @param id     文章ID
     * @param status 状态（0草稿 1已发布）
     */
    void updateStatus(Long id, Integer status);

    /**
     * 置顶/取消置顶文章
     *
     * @param id    文章ID
     * @param isTop 是否置顶（0否 1是）
     */
    void updateTop(Long id, Integer isTop);
}
