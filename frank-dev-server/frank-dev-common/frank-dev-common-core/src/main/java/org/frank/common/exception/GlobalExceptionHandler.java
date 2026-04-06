package org.frank.common.exception;

import lombok.extern.slf4j.Slf4j;
import org.frank.common.core.domain.AjaxResult;
import org.frank.common.enums.ResultCodeEnum;
import org.frank.token.exception.AuthenticationException;
import org.springframework.validation.BindException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;


/**
 * 全局异常处理器
 *
 * @author frank-system
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public AjaxResult<Void> handleMethodArgumentNotValidException(MethodArgumentNotValidException e) {
        log.error("参数校验异常：", e);
        String message = e.getBindingResult().getAllErrors().get(0).getDefaultMessage();
        return AjaxResult.validateFailed(message);
    }

    @ExceptionHandler(BindException.class)
    public AjaxResult<Void> handleBindException(BindException e) {
        log.error("参数绑定异常：", e);
        String message = e.getAllErrors().get(0).getDefaultMessage();
        return AjaxResult.validateFailed(message);
    }

    @ExceptionHandler(BusinessException.class)
    public AjaxResult<Void> handleBusinessException(BusinessException e) {
        log.warn("业务异常：{}", e.getMessage());
        return AjaxResult.failed(e.getMessage());
    }

    @ExceptionHandler(AuthenticationException.class)
    public AjaxResult<Void> handleAuthenticationException(AuthenticationException e) {
        log.warn("认证异常：{}", e.getMessage());
        return AjaxResult.unauthorized(e.getMessage());
    }

    @ExceptionHandler(RuntimeException.class)
    public AjaxResult<Void> handleRuntimeException(RuntimeException e) {
        log.error("运行时异常：", e);
        return AjaxResult.failed(e.getMessage());
    }

    @ExceptionHandler(Exception.class)
    public AjaxResult<Void> handleException(Exception e) {
        log.error("System Error：", e);
        return AjaxResult.failed(e.getMessage());
    }
}
