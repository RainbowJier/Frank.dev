package org.frank.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.frank.domain.entity.ArticleCategory;

@Mapper
public interface ArticleCategoryMapper extends BaseMapper<ArticleCategory> {

}
