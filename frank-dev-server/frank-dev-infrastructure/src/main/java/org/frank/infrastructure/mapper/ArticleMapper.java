package org.frank.infrastructure.mapper;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import org.apache.ibatis.annotations.Mapper;
import org.frank.domain.entity.Article;

@Mapper
public interface ArticleMapper extends BaseMapper<Article> {

}
