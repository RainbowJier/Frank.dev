package org.frank.shared.article.req;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 文章分页查询请求对象
 *
 * @author Frank
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ArticlePageReq implements Serializable {

    /**
     * 标题关键词
     */
    private String title;

    /**
     * 分类ID
     */
    private Long categoryId;

    /**
     * 状态（0草稿 1已发布）
     */
    private Integer status;

    /**
     * 页码
     */
    private Integer pageNum;

    /**
     * 每页数量
     */
    private Integer pageSize;
}
