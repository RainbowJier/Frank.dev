package org.frank.adapter.controller;

import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.frank.application.service.ArticleCategoryService;
import org.frank.common.core.domain.AjaxResult;
import org.frank.common.core.domain.BaseController;
import org.frank.shared.article.req.ArticleCategoryReq;
import org.frank.shared.article.resp.ArticleCategoryResp;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 文章分类管理控制器
 *
 * @author Frank
 */
@RestController
@RequestMapping("/article/category")
public class ArticleCategoryController extends BaseController {

    @Resource
    private ArticleCategoryService articleCategoryService;

    /**
     * 查询分类列表
     */
    @GetMapping("/list")
    public AjaxResult<List<ArticleCategoryResp>> list() {
        List<ArticleCategoryResp> list = articleCategoryService.selectCategoryList();
        return AjaxResult.success(list);
    }

    /**
     * 查询分类详情
     */
    @GetMapping("/{id}")
    public AjaxResult<ArticleCategoryResp> getInfo(@PathVariable Long id) {
        ArticleCategoryResp resp = articleCategoryService.selectCategoryById(id);
        return AjaxResult.success(resp);
    }

    /**
     * 创建分类
     */
    @PostMapping
    public AjaxResult<String> add(@RequestBody @Valid ArticleCategoryReq categoryReq) {
        articleCategoryService.createCategory(categoryReq);
        return AjaxResult.success();
    }

    /**
     * 更新分类
     */
    @PutMapping
    public AjaxResult<String> edit(@RequestBody @Valid ArticleCategoryReq categoryReq) {
        articleCategoryService.updateCategory(categoryReq);
        return AjaxResult.success();
    }

    /**
     * 删除分类
     */
    @DeleteMapping("/{id}")
    public AjaxResult<String> remove(@PathVariable Long id) {
        articleCategoryService.deleteCategory(id);
        return AjaxResult.success();
    }
}
