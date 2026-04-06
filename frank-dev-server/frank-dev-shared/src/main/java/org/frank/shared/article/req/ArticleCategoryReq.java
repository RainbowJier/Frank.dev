package org.frank.shared.article.req;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.io.Serializable;

/**
 * 文章分类创建/更新请求对象
 *
 * @author Frank
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ArticleCategoryReq implements Serializable {

    /**
     * 分类ID（更新时必填）
     */
    private Long id;

    /**
     * 分类名称
     */
    @NotBlank(message = "分类名称不能为空")
    @Size(min = 1, max = 50, message = "分类名称长度必须在1到50之间")
    private String categoryName;

    /**
     * 排序序号
     */
    private Integer sortOrder;

    /**
     * 状态（1正常 0停用）
     */
    private Integer status;

    /**
     * 备注
     */
    private String remark;
}
