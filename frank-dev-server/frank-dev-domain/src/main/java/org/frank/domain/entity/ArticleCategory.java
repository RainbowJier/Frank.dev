package org.frank.domain.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 文章分类表
 *
 * @TableName article_category
 */
@EqualsAndHashCode(callSuper = true)
@TableName(value = "article_category")
@Data
public class ArticleCategory extends BaseEntity {

    @TableField(value = "category_name")
    private String categoryName;

    @TableField(value = "sort_order")
    private Integer sortOrder;
}
