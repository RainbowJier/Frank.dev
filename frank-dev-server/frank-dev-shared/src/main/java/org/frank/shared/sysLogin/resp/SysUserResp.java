package org.frank.shared.sysLogin.resp;


import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@AllArgsConstructor
@NoArgsConstructor
public class SysUserResp {

    private String userId;

    private String deptId;

    private String userName;

    private String nickName;

    private String userType;

    private String email;

    private String phoneNumber;

    private Integer sex;

    private String avatar;

    private boolean isAdmin;
}
