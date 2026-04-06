package org.frank.adapter.controller;


import jakarta.annotation.Resource;
import jakarta.validation.Valid;
import org.apache.commons.lang3.ObjectUtils;
import org.frank.application.service.SysLoginService;
import org.frank.common.core.domain.AjaxResult;
import org.frank.common.core.domain.BaseController;
import org.frank.token.components.TokenService;
import org.frank.token.domain.LoginUser;
import org.frank.shared.sysLogin.req.LoginReq;
import org.frank.shared.sysLogin.resp.LoginResp;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/sys-login")
public class SysLoginController extends BaseController {

    @Resource
    private SysLoginService service;

    @Resource
    private TokenService tokenService;

    @PostMapping("/login")
    public AjaxResult<LoginResp> login(@RequestBody @Valid LoginReq loginReq) {
        String token = service.login(loginReq);
        return AjaxResult.success(new LoginResp(token));
    }

    @PostMapping("/logout")
    public AjaxResult<String> logout() {
        LoginUser loginUser = getLoginUser();
        if(ObjectUtils.isEmpty(loginUser)){
            return AjaxResult.success("User is not logged in.");
        }

        // delete login user from cache
        tokenService.delLoginUser(loginUser.getTokenId());

        return AjaxResult.success();
    }




}
