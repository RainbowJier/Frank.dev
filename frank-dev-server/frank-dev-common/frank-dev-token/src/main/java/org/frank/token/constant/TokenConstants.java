package org.frank.token.constant;

import io.jsonwebtoken.Claims;

/**
 * Token相关常量信息
 *
 * @author Frank
 */
public class TokenConstants {

    /**
     * 登录成功
     */
    public static final String LOGIN_SUCCESS = "Success";

    /**
     * 登录失败
     */
    public static final String LOGIN_FAIL = "Error";

    /**
     * 用户令牌
     */
    public static final String USER_TOKEN_HEADER = "Authorization";

    /**
     * 令牌自定义标识
     */
    public static final String TOKEN = "token";

    /**
     * 令牌前缀
     */
    public static final String TOKEN_PREFIX = "Bearer ";

    /**
     * 登录用户 redis key
     */
    public static final String LOGIN_USER_KEY = "login_user_key";

    /**
     * JWT 用户ID键
     */
    public static final String JWT_USERID = "userid";

    /**
     * JWT 用户名键
     */
    public static final String JWT_USERNAME = Claims.SUBJECT;

    private TokenConstants() {
        // 私有构造器，防止实例化
    }
}