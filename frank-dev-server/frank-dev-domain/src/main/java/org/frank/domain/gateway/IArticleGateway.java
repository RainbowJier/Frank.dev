package org.frank.domain.gateway;

import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.service.IService;
import org.frank.domain.entity.Article;

/**
 * 文章网关接口
 */
public interface IArticleGateway extends IService<Article> {

    /**
     * 分页查询文章列表
     *
     * @param title      标题关键词（可选）
     * @param categoryId 分类ID（可选）
     * @param status     状态（可选）
     * @param pageNum    页码
     * @param pageSize   每页数量
     * @return 分页结果
     */
    IPage<Article> selectArticlePage(String title, Long categoryId, Integer status, int pageNum, int pageSize);

    /**
     * 根据分类ID查询文章数量
     *
     * @param categoryId 分类ID
     * @return 文章数量
     */
    long countByCategoryId(Long categoryId);
}
