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

/**
  文章分类表
 */
drop table if exists article_category cascade;
create table if not exists article_category
(
    id            bigint primary key,
    category_name varchar(50) not null,
    sort_order    integer      default 0,
    status        integer      default 1,
    del_flag      integer      default 1,
    create_by     bigint,
    create_time   timestamp    default now(),
    update_by     bigint,
    update_time   timestamp,
    remark        varchar(200)
);

comment on table article_category is '文章分类表';
comment on column article_category.id is '分类ID';
comment on column article_category.category_name is '分类名称';
comment on column article_category.sort_order is '排序序号';
comment on column article_category.status is '状态（1正常 0停用）';
comment on column article_category.del_flag is '删除标志（1存在 0删除）';
comment on column article_category.create_by is '创建者';
comment on column article_category.create_time is '创建时间';
comment on column article_category.update_by is '更新者';
comment on column article_category.update_time is '更新时间';
comment on column article_category.remark is '备注';

/**
  文章表
 */
drop table if exists article cascade;
create table if not exists article
(
    id           bigint primary key,
    title        varchar(200) not null,
    content      text,
    summary      varchar(500) default '',
    cover_image  varchar(200) default '',
    category_id  bigint,
    author_id    bigint,
    status       integer      default 0,
    is_top       integer      default 0,
    view_count   bigint       default 0,
    like_count   bigint       default 0,
    del_flag     integer      default 1,
    create_by    bigint,
    create_time  timestamp    default now(),
    update_by    bigint,
    update_time  timestamp,
    remark       varchar(200)
);

comment on table article is '文章表';
comment on column article.id is '文章ID';
comment on column article.title is '文章标题';
comment on column article.content is '文章内容';
comment on column article.summary is '文章摘要';
comment on column article.cover_image is '封面图片地址';
comment on column article.category_id is '分类ID';
comment on column article.author_id is '作者ID';
comment on column article.status is '状态（0草稿 1已发布）';
comment on column article.is_top is '是否置顶（0否 1是）';
comment on column article.view_count is '浏览量';
comment on column article.like_count is '点赞数';
comment on column article.del_flag is '删除标志（1存在 0删除）';
comment on column article.create_by is '创建者';
comment on column article.create_time is '创建时间';
comment on column article.update_by is '更新者';
comment on column article.update_time is '更新时间';
comment on column article.remark is '备注';
