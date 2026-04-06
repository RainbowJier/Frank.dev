package org.frank.domain.gateway;

import com.baomidou.mybatisplus.extension.service.IService;
import org.frank.domain.entity.ArticleCategory;

import java.util.List;

/**
 * 文章分类网关接口
 */
public interface IArticleCategoryGateway extends IService<ArticleCategory> {

    /**
     * 检查分类名称是否唯一
     *
     * @param categoryName 分类名称
     * @return true-唯一 false-不唯一
     */
    boolean checkCategoryNameUnique(String categoryName);

    /**
     * 查询所有正常状态的分类列表
     *
     * @return 分类列表
     */
    List<ArticleCategory> selectAllCategories();
}
