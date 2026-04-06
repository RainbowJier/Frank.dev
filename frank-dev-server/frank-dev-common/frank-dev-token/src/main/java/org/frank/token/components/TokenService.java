package org.frank.token.components;

import cn.hutool.core.util.IdUtil;
import cn.hutool.http.useragent.UserAgent;
import cn.hutool.http.useragent.UserAgentUtil;
import io.jsonwebtoken.*;
import io.jsonwebtoken.security.Keys;
import io.jsonwebtoken.security.SignatureException;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.ObjectUtils;
import org.apache.commons.lang3.StringUtils;
import org.frank.redis.constant.CacheConstant;
import org.frank.redis.core.RedisCache;
import org.frank.token.constant.TokenConstants;
import org.frank.token.domain.LoginUser;
import org.frank.token.util.TokenServletUtil;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

/**
 * Token Verification.
 *
 * @author Frank
 */
@Slf4j
@Component
public class TokenService {

    private static final long MILLIS_SECOND = 1000;
    private static final long MILLIS_MINUTE = 60 * MILLIS_SECOND;
    private static final long MILLIS_MINUTE_TWENTY = 20 * MILLIS_MINUTE;

    @Value("${token.header}")
    private String header;

    @Value("${token.secret}")
    private String secret;

    @Value("${token.expireTime}")
    private int expireTime;

    @Resource
    private RedisCache redisCache;

    private SecretKey secretKey;

    @PostConstruct
    public void init() {
        if (StringUtils.isEmpty(secret)) {
            throw new IllegalArgumentException("Token secret cannot be empty");
        }
        if (secret.length() < 32) {
            throw new IllegalArgumentException("Token secret must be at least 32 characters long for security");
        }
        this.secretKey = Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
        log.info("TokenService initialized successfully");
    }

    /**
     * Create a new token for the login user.
     *
     * @param loginUser The login user info.
     * @return The created token.
     */
    public String createToken(LoginUser loginUser) {
        String tokenKey = IdUtil.fastUUID();
        loginUser.setTokenId(tokenKey);
        setUserAgent(loginUser);

        refreshToken(loginUser);

        Map<String, Object> claims = new HashMap<>();
        claims.put(TokenConstants.LOGIN_USER_KEY, tokenKey);
        claims.put(TokenConstants.JWT_USERNAME, loginUser.getUserName());
        claims.put(TokenConstants.JWT_USERID, loginUser.getUserId());
        return createJwtToken(claims);
    }

    /**
     * Create a JWT token from claims.
     *
     * @param claims The data claims.
     * @return The JWT token.
     */
    private String createJwtToken(Map<String, Object> claims) {
        return Jwts.builder()
                .claims(claims)
                .issuedAt(new Date())
                .expiration(new Date(System.currentTimeMillis() + (long) expireTime * MILLIS_MINUTE))
                .signWith(secretKey)
                .compact();
    }

    /**
     * Parse the claims from the token.
     *
     * @param token The token.
     * @return The data claims.
     * @throws ExpiredJwtException      if the token is expired.
     * @throws MalformedJwtException    if the token is malformed.
     * @throws SignatureException       if the signature is invalid.
     * @throws UnsupportedJwtException  if the token is unsupported.
     * @throws IllegalArgumentException if the token is invalid.
     */
    public Claims parseToken(String token) {
        return Jwts.parser()
                .verifyWith(secretKey)
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * Refresh the token's expiration time.
     *
     * @param loginUser The login user info.
     */
    public void refreshToken(LoginUser loginUser) {
        loginUser.setLoginTime(System.currentTimeMillis());
        loginUser.setExpireTime(loginUser.getLoginTime() + (long) expireTime * MILLIS_MINUTE);
        String userKey = getTokenKey(loginUser.getTokenId());

        redisCache.setCacheObject(userKey, loginUser, expireTime, TimeUnit.MINUTES);
    }

    /**
     * Verify the token's validity and refresh the cache if it's about to expire.
     *
     * @param loginUser The login user info.
     */
    public boolean verifyToken(LoginUser loginUser) {
        long expireTime = loginUser.getExpireTime();
        long currentTime = System.currentTimeMillis();

        // 未过期但接近过期时刷新
        if (expireTime - currentTime <= MILLIS_MINUTE_TWENTY) {
            refreshToken(loginUser);
        }

        return true;
    }

    /**
     * Get login user info from request.
     *
     * @param request The current HttpServletRequest.
     * @return LoginUser if found, otherwise null.
     */
    public LoginUser getLoginUser(HttpServletRequest request) {
        String token = getToken(request);
        if (StringUtils.isEmpty(token)) {
            return null;
        }
        try {
            Claims claims = parseToken(token);
            String uuid = (String) claims.get(TokenConstants.LOGIN_USER_KEY);
            String userKey = getTokenKey(uuid);
            return redisCache.getCacheObject(userKey);
        } catch (ExpiredJwtException e) {
            // JWT已过期，但只要Redis中存在，说明处于刷新周期内，允许通过
            Claims claims = e.getClaims();
            String uuid = (String) claims.get(TokenConstants.LOGIN_USER_KEY);
            String userKey = getTokenKey(uuid);
            return redisCache.getCacheObject(userKey);
        } catch (SignatureException e) {
            log.error("Invalid token signature: {}", token);
        } catch (MalformedJwtException e) {
            log.error("Invalid token format: {}", token);
        } catch (UnsupportedJwtException e) {
            log.error("Unsupported token type: {}", token);
        } catch (IllegalArgumentException e) {
            log.error("Invalid token argument: {}", token);
        } catch (Exception e) {
            log.error("Error getting user info from token: {}", e.getMessage());
        }
        return null;
    }

    /**
     * Set login user info to cache.
     *
     * @param loginUser The login user info.
     */
    public void setLoginUser(LoginUser loginUser) {
        if (ObjectUtils.isNotEmpty(loginUser) && StringUtils.isNotEmpty(loginUser.getTokenId())) {
            refreshToken(loginUser);
        }
    }

    /**
     * Delete login user info from cache.
     *
     * @param token The token of the user to be deleted.
     */
    public void delLoginUser(String token) {
        if (StringUtils.isNotEmpty(token)) {
            String userKey = getTokenKey(token);
            redisCache.deleteObject(userKey);
        }
    }

    /**
     * Get the username from the token.
     *
     * @param token The token.
     * @return The username.
     */
    public String getUsernameFromToken(String token) {
        Claims claims = parseToken(token);
        return (String) claims.get(TokenConstants.JWT_USERNAME);
    }

    // region Private Methods

    /**
     * Set user agent info.
     *
     * @param loginUser The login user info.
     */
    private void setUserAgent(LoginUser loginUser) {
        UserAgent userAgent = UserAgentUtil.parse(TokenServletUtil.getRequest().getHeader("User-Agent"));
        loginUser.setBrowser(userAgent.getBrowser().getName());
        loginUser.setOs(userAgent.getOs().getName());
    }

    /**
     * Get the token from the request header.
     *
     * @param request The HttpServletRequest.
     * @return The token.
     */
    public String getToken(HttpServletRequest request) {
        String token = request.getHeader(header);
        if (ObjectUtils.isEmpty(token)) {
            throw new RuntimeException("token is empty");
        }

        if (StringUtils.isNotEmpty(token) && token.startsWith(TokenConstants.TOKEN_PREFIX)) {
            return token.replace(TokenConstants.TOKEN_PREFIX, "");
        }
        return token;
    }

    /**
     * Get the cache key for the token.
     *
     * @param uuid The unique identifier.
     * @return The cache key.
     */
    private String getTokenKey(String uuid) {
        return CacheConstant.LOGIN_TOKEN_KEY + uuid;
    }
}
