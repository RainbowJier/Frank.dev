package org.frank.application.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.util.ObjectUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.frank.application.service.ArticleCategoryService;
import org.frank.common.exception.BusinessException;
import org.frank.domain.entity.ArticleCategory;
import org.frank.domain.gateway.IArticleCategoryGateway;
import org.frank.domain.gateway.IArticleGateway;
import org.frank.shared.article.req.ArticleCategoryReq;
import org.frank.shared.article.resp.ArticleCategoryResp;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.stream.Collectors;

/**
 * 文章分类服务实现
 *
 * @author Frank
 */
@Slf4j
@Service
public class ArticleCategoryServiceImpl implements ArticleCategoryService {

    @Resource
    private IArticleCategoryGateway articleCategoryGateway;

    @Resource
    private IArticleGateway articleGateway;

    @Override
    public List<ArticleCategoryResp> selectCategoryList() {
        List<ArticleCategory> categories = articleCategoryGateway.selectAllCategories();
        return categories.stream().map(category -> {
            ArticleCategoryResp resp = BeanUtil.copyProperties(category, ArticleCategoryResp.class);
            resp.setArticleCount(articleGateway.countByCategoryId(category.getId()));
            return resp;
        }).collect(Collectors.toList());
    }

    @Override
    public ArticleCategoryResp selectCategoryById(Long id) {
        ArticleCategory category = articleCategoryGateway.getById(id);
        if (ObjectUtil.isNull(category)) {
            throw new BusinessException("分类不存在");
        }

        ArticleCategoryResp resp = BeanUtil.copyProperties(category, ArticleCategoryResp.class);
        resp.setArticleCount(articleGateway.countByCategoryId(category.getId()));
        return resp;
    }

    @Override
    public void createCategory(ArticleCategoryReq categoryReq) {
        if (!articleCategoryGateway.checkCategoryNameUnique(categoryReq.getCategoryName())) {
            throw new BusinessException("分类名称已存在");
        }

        ArticleCategory category = BeanUtil.copyProperties(categoryReq, ArticleCategory.class);
        if (ObjectUtil.isNull(category.getSortOrder())) {
            category.setSortOrder(0);
        }
        if (ObjectUtil.isNull(category.getStatus())) {
            category.setStatus(1);
        }

        articleCategoryGateway.save(category);
        log.info("文章分类创建成功，名称：{}", category.getCategoryName());
    }

    @Override
    public void updateCategory(ArticleCategoryReq categoryReq) {
        ArticleCategory existingCategory = articleCategoryGateway.getById(categoryReq.getId());
        if (ObjectUtil.isNull(existingCategory)) {
            throw new BusinessException("分类不存在");
        }

        ArticleCategory category = BeanUtil.copyProperties(categoryReq, ArticleCategory.class);
        articleCategoryGateway.updateById(category);
        log.info("文章分类更新成功，ID：{}", category.getId());
    }

    @Override
    public void deleteCategory(Long id) {
        ArticleCategory category = articleCategoryGateway.getById(id);
        if (ObjectUtil.isNull(category)) {
            throw new BusinessException("分类不存在");
        }

        // 检查分类下是否有文章
        long articleCount = articleGateway.countByCategoryId(id);
        if (articleCount > 0) {
            throw new BusinessException("该分类下存在文章，无法删除");
        }

        category.setDelFlag(0);
        articleCategoryGateway.updateById(category);
        log.info("文章分类删除成功，ID：{}", id);
    }
}
