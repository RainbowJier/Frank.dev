package org.frank.mybatis.domain;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class PageQuery {
    private int pageNum;

    private int pageSize;

    private String sort;

    private String order;

    private String sortColumn;
}
