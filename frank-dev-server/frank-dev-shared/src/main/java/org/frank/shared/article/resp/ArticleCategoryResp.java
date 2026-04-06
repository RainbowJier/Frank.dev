package org.frank.shared.article.resp;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.Date;

/**
 * 文章分类响应对象
 *
 * @author Frank
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class ArticleCategoryResp {

    private Long id;

    private String categoryName;

    private Integer sortOrder;

    private Integer status;

    private Long articleCount;

    private Date createTime;

    private Date updateTime;

    private String remark;
}
