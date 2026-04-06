package org.frank.application.service.impl;


import cn.hutool.core.util.ObjectUtil;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.frank.application.service.SysLoginService;
import org.frank.token.components.TokenService;
import org.frank.token.domain.LoginUser;
import org.frank.redis.constant.CacheConstant;
import org.frank.redis.core.RedisCache;
import org.frank.common.exception.BusinessException;
import org.frank.common.util.IpUtil;
import org.frank.common.util.ServletUtil;
import org.frank.common.util.sign.BCryptUtils;
import org.frank.domain.entity.SysUser;
import org.frank.domain.gateway.ISysUserGateway;
import org.frank.shared.sysLogin.req.LoginReq;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.util.concurrent.TimeUnit;

@Slf4j
@Service
public class SysLoginServiceImpl implements SysLoginService {

    @Resource
    private ISysUserGateway sysUserGateway;

    @Resource
    private RedisCache redisCache;

    @Resource
    private TokenService tokenService;

    @Value(value = "${user.password.maxRetryCount}")
    private int maxRetryCount;

    @Value(value = "${user.password.lockTime}")
    private int lockTime;

    @Override
    public String login(LoginReq loginReq) {
        LoginUser loginUser = new LoginUser();

        SysUser sysUser = checkExistUser(loginReq.getUsername());
        validatePassword(sysUser, loginReq.getPassword());

        loginUser.setUserId(sysUser.getId())
                .setUserName(sysUser.getUserName())
                .setIpaddr(IpUtil.getIpAddr())
                .setLoginLocation(IpUtil.getIpLocation(IpUtil.getIpAddr()))
                .setBrowser(ServletUtil.getBrowser())
                .setOs(ServletUtil.getOs());

        return tokenService.createToken(loginUser);
    }

    private SysUser checkExistUser(String userName) {
        SysUser user = sysUserGateway.selectByUsername(userName);
        if (ObjectUtil.isNull(user)) {
            log.info("User {} does not exist", userName);
            throw new BusinessException("Username or password is incorrect");
        }
        return user;
    }

    private void validatePassword(SysUser sysUser, String password) {

        Integer retryCount = redisCache.getCacheObject(getPasswordErrorCountKey(sysUser.getUserName()));
        if (retryCount == null) {
            retryCount = 0;
        }

        if (retryCount >= maxRetryCount) {
            log.warn("User {} account has been locked", sysUser.getUserName());
            throw new BusinessException("Account has been locked, please try again after " + lockTime + " minutes ");
        }

        boolean isMatch = matchesPassword(password, sysUser.getPassword());

        if (!isMatch) {
            retryCount = retryCount + 1;
            redisCache.setCacheObject(getPasswordErrorCountKey(sysUser.getUserName()), retryCount, lockTime, TimeUnit.MINUTES);
            log.warn("User {} password error, {} times wrong", sysUser.getUserName(), retryCount);
            throw new BusinessException("Username or password is incorrect");
        } else {
            clearLoginRecordCache(sysUser.getUserName());
        }
    }

    /**
     * get password error count key.
     */
    private String getPasswordErrorCountKey(String username) {
        return CacheConstant.PWD_ERR_CNT_KEY + username;
    }

    /**
     * matches password
     */
    private boolean matchesPassword(String rawPassword, String encodedPassword) {
        return BCryptUtils.matchesPassword(rawPassword, encodedPassword);
    }

    /**
     * clear login record cache.
     */
    private void clearLoginRecordCache(String loginName) {
        String cacheKey = getPasswordErrorCountKey(loginName);
        if (redisCache.hasKey(cacheKey)) {
            redisCache.deleteObject(cacheKey);
        }
    }

}
