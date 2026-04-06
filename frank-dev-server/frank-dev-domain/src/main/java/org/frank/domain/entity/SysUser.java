package org.frank.domain.entity;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;
import lombok.EqualsAndHashCode;

/**
 * 用户信息表
 *
 * @TableName sys_user
 */
@EqualsAndHashCode(callSuper = true)
@TableName(value = "sys_user")
@Data
public class SysUser extends BaseEntity {
    @TableField(value = "user_name")
    private String userName;

    @TableField(value = "nick_name")
    private String nickName;

    @TableField(value = "email")
    private String email;

    @TableField(value = "phone_number")
    private String phoneNumber;

    /**
     * 1-male, 0-female, 2-unknown.
     */
    @TableField(value = "sex")
    private Integer sex;

    /**
     * address of avatar.
     */
    @TableField(value = "avatar")
    private String avatar;

    @TableField(value = "password")
    private String password;
}