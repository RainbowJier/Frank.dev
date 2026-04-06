package org.frank.shared.article.req;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 文章创建/更新请求对象
 *
 * @author Frank
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ArticleReq implements Serializable {

    /**
     * 文章ID（更新时必填）
     */
    private Long id;

    /**
     * 文章标题
     */
    @NotBlank(message = "文章标题不能为空")
    @Size(min = 1, max = 200, message = "标题长度必须在1到200之间")
    private String title;

    /**
     * 文章内容
     */
    private String content;

    /**
     * 文章摘要
     */
    @Size(max = 500, message = "摘要长度不能超过500")
    private String summary;

    /**
     * 封面图片地址
     */
    private String coverImage;

    /**
     * 分类ID
     */
    private Long categoryId;

    /**
     * 状态（0草稿 1已发布）
     */
    private Integer status;

    /**
     * 备注
     */
    private String remark;
}
