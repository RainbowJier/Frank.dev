package org.frank.token.interceptor;

import jakarta.annotation.Resource;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.extern.slf4j.Slf4j;
import org.frank.token.components.TokenService;
import org.frank.token.domain.LoginUser;
import org.frank.token.exception.AuthenticationException;
import org.frank.token.properties.ExcludePathsProperties;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.util.ObjectUtils;
import org.springframework.web.servlet.HandlerInterceptor;

import java.util.List;

/**
 * Token验证拦截器
 * 用于拦截需要Token认证的请求
 *
 * @author Frank
 */
@Slf4j
@Component
@Order(1)
public class TokenInterceptor implements HandlerInterceptor {

    @Resource
    private TokenService tokenService;

    @Resource
    private ExcludePathsProperties excludePathsProperties;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        String requestURI = request.getRequestURI();
        String method = request.getMethod();

        log.debug("Processing {} request for URI: {}", method, requestURI);

        // white list.
        if (isExcludePath(requestURI)) {
            log.debug("URI {} is in exclude paths, skipping token validation", requestURI);
            return true;
        }

        if ("OPTIONS".equalsIgnoreCase(method)) {
            log.debug("OPTIONS request for URI {}, skipping token validation", requestURI);
            return true;
        }

        // get token.
        LoginUser loginUser = tokenService.getLoginUser(request);
        if (ObjectUtils.isEmpty(loginUser)) {
            log.warn("No login user found for URI: {}", requestURI);
            throw new AuthenticationException("Please login first.");
        }

        // verify if token is valid or not.
        if (!tokenService.verifyToken(loginUser)) {
            log.warn("Token is invalid or expired for URI: {}", requestURI);
            throw new AuthenticationException("Token is invalid or expired.");
        }

        log.info("Token validation successful for URI: {}", requestURI);
        return true;
    }

    /**
     * 检查请求路径是否在白名单中
     *
     * @param requestURI 请求URI
     * @return 如果在白名单中返回true，否则返回false
     */
    private boolean isExcludePath(String requestURI) {
        List<String> excludePaths = excludePathsProperties.getExclude();
        if (excludePaths == null || excludePaths.isEmpty()) {
            return false;
        }

        // 使用Ant风格的路径匹配
        for (String excludePath : excludePaths) {
            if (matchesPath(requestURI, excludePath)) {
                return true;
            }
        }

        return false;
    }

    /**
     * 路径匹配方法（简化版的Ant风格匹配）
     *
     * @param requestURI 请求URI
     * @param pattern    匹配模式
     * @return 如果匹配返回true，否则返回false
     */
    private boolean matchesPath(String requestURI, String pattern) {
        // 精确匹配
        if (pattern.equals(requestURI)) {
            return true;
        }

        // 通配符匹配
        if (pattern.endsWith("/**")) {
            String prefix = pattern.substring(0, pattern.length() - 3);
            return requestURI.startsWith(prefix);
        }

        // 单层通配符匹配
        if (pattern.contains("/*")) {
            String[] patternParts = pattern.split("/");
            String[] uriParts = requestURI.split("/");

            if (patternParts.length != uriParts.length) {
                return false;
            }

            for (int i = 0; i < patternParts.length; i++) {
                if (!patternParts[i].equals("*") && !patternParts[i].equals(uriParts[i])) {
                    return false;
                }
            }
            return true;
        }

        return false;
    }
}