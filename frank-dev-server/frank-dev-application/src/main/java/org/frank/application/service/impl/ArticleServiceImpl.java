package org.frank.application.service.impl;

import cn.hutool.core.bean.BeanUtil;
import cn.hutool.core.util.ObjectUtil;
import com.baomidou.mybatisplus.core.metadata.IPage;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.frank.application.service.ArticleService;
import org.frank.common.exception.BusinessException;
import org.frank.domain.entity.Article;
import org.frank.domain.entity.ArticleCategory;
import org.frank.domain.gateway.IArticleCategoryGateway;
import org.frank.domain.gateway.IArticleGateway;
import org.frank.mybatis.domain.PageResult;
import org.frank.shared.article.req.ArticlePageReq;
import org.frank.shared.article.req.ArticleReq;
import org.frank.shared.article.resp.ArticleResp;
import org.springframework.stereotype.Service;

/**
 * 文章服务实现
 *
 * @author Frank
 */
@Slf4j
@Service
public class ArticleServiceImpl implements ArticleService {

    @Resource
    private IArticleGateway articleGateway;

    @Resource
    private IArticleCategoryGateway articleCategoryGateway;

    @Override
    public PageResult selectArticlePage(ArticlePageReq pageReq) {
        int pageNum = ObjectUtil.isNotNull(pageReq.getPageNum()) ? pageReq.getPageNum() : 1;
        int pageSize = ObjectUtil.isNotNull(pageReq.getPageSize()) ? pageReq.getPageSize() : 10;

        IPage<Article> page = articleGateway.selectArticlePage(
                pageReq.getTitle(),
                pageReq.getCategoryId(),
                pageReq.getStatus(),
                pageNum,
                pageSize
        );

        return PageResult.ok(page, ArticleResp.class);
    }

    @Override
    public ArticleResp selectArticleById(Long id) {
        Article article = articleGateway.getById(id);
        if (ObjectUtil.isNull(article)) {
            throw new BusinessException("文章不存在");
        }

        ArticleResp resp = BeanUtil.copyProperties(article, ArticleResp.class);

        // 填充分类名称
        if (ObjectUtil.isNotNull(article.getCategoryId())) {
            ArticleCategory category = articleCategoryGateway.getById(article.getCategoryId());
            if (ObjectUtil.isNotNull(category)) {
                resp.setCategoryName(category.getCategoryName());
            }
        }

        return resp;
    }

    @Override
    public void createArticle(ArticleReq articleReq, Long authorId) {
        Article article = BeanUtil.copyProperties(articleReq, Article.class);
        article.setAuthorId(authorId);
        article.setViewCount(0L);
        article.setLikeCount(0L);
        article.setIsTop(0);
        if (ObjectUtil.isNull(article.getStatus())) {
            article.setStatus(0);
        }

        articleGateway.save(article);
        log.info("文章创建成功，标题：{}，作者ID：{}", article.getTitle(), authorId);
    }

    @Override
    public void updateArticle(ArticleReq articleReq) {
        Article existingArticle = articleGateway.getById(articleReq.getId());
        if (ObjectUtil.isNull(existingArticle)) {
            throw new BusinessException("文章不存在");
        }

        Article article = BeanUtil.copyProperties(articleReq, Article.class);
        articleGateway.updateById(article);
        log.info("文章更新成功，ID：{}", article.getId());
    }

    @Override
    public void deleteArticle(Long id) {
        Article article = articleGateway.getById(id);
        if (ObjectUtil.isNull(article)) {
            throw new BusinessException("文章不存在");
        }

        article.setDelFlag(0);
        articleGateway.updateById(article);
        log.info("文章删除成功，ID：{}", id);
    }

    @Override
    public void updateStatus(Long id, Integer status) {
        Article article = articleGateway.getById(id);
        if (ObjectUtil.isNull(article)) {
            throw new BusinessException("文章不存在");
        }

        article.setStatus(status);
        articleGateway.updateById(article);
        log.info("文章状态更新成功，ID：{}，状态：{}", id, status);
    }

    @Override
    public void updateTop(Long id, Integer isTop) {
        Article article = articleGateway.getById(id);
        if (ObjectUtil.isNull(article)) {
            throw new BusinessException("文章不存在");
        }

        article.setIsTop(isTop);
        articleGateway.updateById(article);
        log.info("文章置顶状态更新成功，ID：{}，置顶：{}", id, isTop);
    }
}
