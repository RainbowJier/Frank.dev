package org.frank.adapter.controller.vo;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * 更新置顶状态请求对象
 *
 * @author Frank
 */
@Data
@AllArgsConstructor
@NoArgsConstructor
public class UpdateTopVo {

    private Long id;

    private Integer isTop;
}
