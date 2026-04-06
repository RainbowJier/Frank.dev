package org.frank.infrastructure.gateway;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.frank.domain.entity.ArticleCategory;
import org.frank.domain.gateway.IArticleCategoryGateway;
import org.frank.infrastructure.mapper.ArticleCategoryMapper;
import org.springframework.stereotype.Component;

import java.util.List;

@Component
public class ArticleCategoryGatewayImpl extends ServiceImpl<ArticleCategoryMapper, ArticleCategory>
        implements IArticleCategoryGateway {

    @Resource
    private ArticleCategoryMapper mapper;

    @Override
    public boolean checkCategoryNameUnique(String categoryName) {
        LambdaQueryWrapper<ArticleCategory> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ArticleCategory::getCategoryName, categoryName);
        return count(queryWrapper) == 0;
    }

    @Override
    public List<ArticleCategory> selectAllCategories() {
        LambdaQueryWrapper<ArticleCategory> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ArticleCategory::getStatus, 1)
                .orderByAsc(ArticleCategory::getSortOrder);
        return mapper.selectList(queryWrapper);
    }
}
