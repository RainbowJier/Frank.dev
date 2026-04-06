package org.frank.shared.article.resp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * 文章响应对象
 *
 * @author Frank
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ArticleResp {

    private Long id;

    private String title;

    private String content;

    private String summary;

    private String coverImage;

    private Long categoryId;

    private String categoryName;

    private Long authorId;

    private String authorName;

    private Integer status;

    private Integer isTop;

    private Long viewCount;

    private Long likeCount;

    private Date createTime;

    private Date updateTime;

    private String remark;
}
