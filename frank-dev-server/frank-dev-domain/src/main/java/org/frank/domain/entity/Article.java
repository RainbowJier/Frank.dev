package org.frank.domain.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 文章表
 *
 * @TableName article
 */
@EqualsAndHashCode(callSuper = true)
@TableName(value = "article")
@Data
public class Article extends BaseEntity {

    @TableField(value = "title")
    private String title;

    @TableField(value = "content")
    private String content;

    @TableField(value = "summary")
    private String summary;

    @TableField(value = "cover_image")
    private String coverImage;

    @TableField(value = "category_id")
    private Long categoryId;

    @TableField(value = "author_id")
    private Long authorId;

    /**
     * 0-draft, 1-published.
     */
    @TableField(value = "status")
    private Integer status;

    /**
     * 0-normal, 1-top/pinned.
     */
    @TableField(value = "is_top")
    private Integer isTop;

    @TableField(value = "view_count")
    private Long viewCount;

    @TableField(value = "like_count")
    private Long likeCount;
}
