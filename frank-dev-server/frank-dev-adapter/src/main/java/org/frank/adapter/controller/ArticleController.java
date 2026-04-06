package org.frank.adapter.controller;

import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.frank.adapter.controller.vo.UpdateStatusVo;
import org.frank.adapter.controller.vo.UpdateTopVo;
import org.frank.application.service.ArticleService;
import org.frank.common.core.domain.AjaxResult;
import org.frank.common.core.domain.BaseController;
import org.frank.mybatis.domain.PageResult;
import org.frank.shared.article.req.ArticlePageReq;
import org.frank.shared.article.req.ArticleReq;
import org.frank.shared.article.resp.ArticleResp;
import org.springframework.web.bind.annotation.*;

/**
 * 文章管理控制器
 *
 * @author Frank
 */
@RestController
@RequestMapping("/article")
public class ArticleController extends BaseController {

    @Resource
    private ArticleService articleService;

    /**
     * 分页查询文章列表
     */
    @GetMapping("/page")
    public AjaxResult<PageResult> page(ArticlePageReq pageReq) {
        PageResult pageResult = articleService.selectArticlePage(pageReq);
        return AjaxResult.success(pageResult);
    }

    /**
     * 查询文章详情
     */
    @GetMapping("/{id}")
    public AjaxResult<ArticleResp> getInfo(@PathVariable Long id) {
        ArticleResp resp = articleService.selectArticleById(id);
        return AjaxResult.success(resp);
    }

    /**
     * 创建文章
     */
    @PostMapping
    public AjaxResult<String> add(@RequestBody @Valid ArticleReq articleReq) {
        articleService.createArticle(articleReq, getUserId());
        return AjaxResult.success();
    }

    /**
     * 更新文章
     */
    @PutMapping
    public AjaxResult<String> edit(@RequestBody @Valid ArticleReq articleReq) {
        articleService.updateArticle(articleReq);
        return AjaxResult.success();
    }

    /**
     * 删除文章
     */
    @DeleteMapping("/{id}")
    public AjaxResult<String> remove(@PathVariable Long id) {
        articleService.deleteArticle(id);
        return AjaxResult.success();
    }

    /**
     * 发布/取消发布文章
     */
    @PutMapping("/status")
    public AjaxResult<String> updateStatus(@RequestBody UpdateStatusVo vo) {
        articleService.updateStatus(vo.getId(), vo.getStatus());
        return AjaxResult.success();
    }

    /**
     * 置顶/取消置顶文章
     */
    @PutMapping("/top")
    public AjaxResult<String> updateTop(@RequestBody UpdateTopVo vo) {
        articleService.updateTop(vo.getId(), vo.getIsTop());
        return AjaxResult.success();
    }
}
