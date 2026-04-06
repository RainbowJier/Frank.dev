package org.frank.common.core.domain;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.frank.common.util.ServletUtil;
import org.frank.domain.entity.SysUser;
import org.frank.domain.gateway.ISysUserGateway;
import org.frank.token.components.TokenService;
import org.frank.token.domain.LoginUser;
import org.springframework.stereotype.Component;


@Slf4j
@Component
public class BaseController {

    @Resource
    private TokenService tokenService;

    @Resource
    private ISysUserGateway sysUserGateway;

    public LoginUser getLoginUser() {
        HttpServletRequest request = ServletUtil.getRequest();
        return tokenService.getLoginUser(request);
    }

    /**
     * Check is admin or not.
     *
     * @return true if is admin, false otherwise.
     */
    public boolean isAdmin() {
        LoginUser loginUser = getLoginUser();
        // 简化版：用户ID为1的是管理员
        return loginUser != null && loginUser.getUserId().equals(1L);
    }


    /**
     * Get the current user's ID.
     *
     * @return User id
     */
    public Long getUserId() {
        LoginUser loginUser = getLoginUser();
        return loginUser != null ? loginUser.getUserId() : null;
    }

    /**
     * get user detail by id.
     *
     * @return SysUser
     */
    public SysUser getSysUser() {
        return sysUserGateway.getById(getUserId());
    }
}
