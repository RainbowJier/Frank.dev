package org.frank.infrastructure.gateway;

import cn.hutool.core.util.ObjectUtil;
import cn.hutool.core.util.StrUtil;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import jakarta.annotation.Resource;
import org.frank.domain.entity.Article;
import org.frank.domain.gateway.IArticleGateway;
import org.frank.infrastructure.mapper.ArticleMapper;
import org.springframework.stereotype.Component;

@Component
public class ArticleGatewayImpl extends ServiceImpl<ArticleMapper, Article> implements IArticleGateway {

    @Resource
    private ArticleMapper mapper;

    @Override
    public IPage<Article> selectArticlePage(String title, Long categoryId, Integer status, int pageNum, int pageSize) {
        LambdaQueryWrapper<Article> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.like(StrUtil.isNotBlank(title), Article::getTitle, title)
                .eq(ObjectUtil.isNotNull(categoryId), Article::getCategoryId, categoryId)
                .eq(ObjectUtil.isNotNull(status), Article::getStatus, status)
                .orderByDesc(Article::getIsTop)
                .orderByDesc(Article::getCreateTime);

        Page<Article> page = new Page<>(pageNum, pageSize);
        return mapper.selectPage(page, queryWrapper);
    }

    @Override
    public long countByCategoryId(Long categoryId) {
        LambdaQueryWrapper<Article> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Article::getCategoryId, categoryId);
        return count(queryWrapper);
    }
}
