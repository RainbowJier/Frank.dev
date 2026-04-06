/**
  用户信息表
 */
drop table if exists sys_user cascade;
create table if not exists sys_user
(
    id           bigint primary key,
    user_name    varchar(30) not null,
    nick_name    varchar(30) not null,
    email        varchar(50)  default '',
    phone_number varchar(11)  default '',
    sex          integer,
    avatar       varchar(100) default '',
    password     varchar(100) default '',
    status       integer      default 1,
    del_flag     integer      default 1,
    create_by    bigint,
    create_time  timestamp    default now(),
    update_by    bigint,
    update_time  timestamp,
    remark       varchar(200)
);

comment on table sys_user is '用户信息表';
comment on column sys_user.id is '用户ID';
comment on column sys_user.user_name is '用户账号';
comment on column sys_user.nick_name is '用户昵称';
comment on column sys_user.email is '用户邮箱';
comment on column sys_user.phone_number is '手机号码';
comment on column sys_user.sex is '用户性别（1男 0女 2未知）';
comment on column sys_user.avatar is '头像地址';
comment on column sys_user.password is '密码';
comment on column sys_user.status is '帐号状态（1正常 0停用）';
comment on column sys_user.del_flag is '删除标志（1-存在 0-删除）';
comment on column sys_user.create_by is '创建者';
comment on column sys_user.create_time is '创建时间';
comment on column sys_user.update_by is '更新者';
comment on column sys_user.update_time is '更新时间';
comment on column sys_user.remark is '备注';

INSERT INTO sys_user (id, user_name, nick_name, email, phone_number, sex, avatar, password, status,
                      del_flag, create_time, update_time)
VALUES (2012363388558524417, 'admin', 'administrator', 'frank@163.com', '', 1, '',
        '$2a$12$HgMqFBFOt1rys5iMT8ShN.1/I6woV2jgaWV3DWcM5ffDzGiyZNsIa', 1, 1, '2025-11-29 15:41:03.294377',
        '2025-11-29 15:41:03.294377');
