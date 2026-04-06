package org.frank.mybatis.domain;

import cn.hutool.core.bean.BeanUtil;
import com.baomidou.mybatisplus.core.metadata.IPage;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;
import lombok.experimental.Accessors;

import java.io.Serializable;
import java.util.List;
import java.util.function.Function;

/**
 * 表格分页数据对象
 *
 * @author Frank
 */

@Data
@AllArgsConstructor
@NoArgsConstructor
@Accessors(chain = true)
public class PageResult implements Serializable {
    private Long total;

    private Long pageNum;

    private Long pageSize;

    private List<?> rows;

    public PageResult(List<?> list, long total) {
        this.rows = list;
        this.total = total;
    }

    public static <T> PageResult ok(IPage<T> page) {
        return new PageResult(
                page.getTotal(),
                page.getCurrent(),
                page.getSize(),
                page.getRecords()
        );
    }

    public static <E, V> PageResult ok(IPage<E> page, Class<V> voClass) {
        List<V> voList = BeanUtil.copyToList(page.getRecords(), voClass);

        return new PageResult(
                page.getTotal(),
                page.getCurrent(),
                page.getSize(),
                voList
        );
    }

    /**
     * 支持两步转换的分页方法: Entity -> PO -> Resp
     * 使用 MapStruct Converter 进行链式转换
     *
     * @param page              分页数据
     * @param entityToPO        Entity 转 PO 的函数
     * @param poToResp          PO 转 Resp 的函数
     * @param <E>               Entity 类型
     * @param <P>               PO 类型
     * @param <R>               Resp 类型
     * @return 分页结果
     */
    public static <E, P, R> PageResult ok(
            IPage<E> page,
            Function<List<E>, List<P>> entityToPO,
            Function<List<P>, List<R>> poToResp
    ) {
        List<P> poList = entityToPO.apply(page.getRecords());
        List<R> respList = poToResp.apply(poList);

        return new PageResult(
                page.getTotal(),
                page.getCurrent(),
                page.getSize(),
                respList
        );
    }

}