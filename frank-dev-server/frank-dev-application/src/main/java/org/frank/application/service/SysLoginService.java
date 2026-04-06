package org.frank.application.service;

import org.frank.shared.sysLogin.req.LoginReq;

public interface SysLoginService {
    /**
     * login.
     */
    String login(LoginReq loginReq);
}
