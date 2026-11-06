# 访问控制（草稿）

> **草稿，待法务审阅。** 起草 2026-11-05；最近审阅：【待填写】。
> 分三部分：产品内的身份与权限、代码仓库的访问、生产环境的访问。

## 一、产品内

### 1. 桌面端（单机）

- 桌面版后端运行在「单机免登」模式（`security.local-mode: true`）：本机发来的请求一律视为本机用户，不需要登录。
- 安全前提是后端只监听 127.0.0.1：`LocalModeLoopbackGuard` 在监听地址不是回环时拒绝启动；`LocalModeAccessFilter` 拒绝非回环来源、跨域请求和代理转发头。
- 因此桌面端的访问边界就是操作系统用户账户：能登录这台电脑这个系统用户的人，就能看到其中的 AWD 数据。律所应依靠操作系统登录、磁盘加密和终端管理来控制。
- 桌面配置里的本地管理员初始口令是 `123`（`application-desktop.yml` 的 `initial-password`），只在本机回环生效；云端配置不设该项，由 `DataInitializer` 随机生成一次性口令。

### 2. 云端服务（插件云、案件库、团队服务器）

- **会话**：自研的不透明会话 ID（32 字节 `SecureRandom`），客户端通过 `X-Session-Id` 请求头携带，服务端存库并做滑动过期（云端与案件库 7 天无活动失效）。不是 JWT，也没有使用 Spring Security 框架。
- **设备令牌**：桌面端连接案件库使用 `awdt_` 设备令牌，服务端只存哈希（`DeviceTokenService`）。
- **口令**：BCrypt 哈希（`UserService`）；早期明文口令在登录时原地升级。
- **双因素认证**：支持 TOTP（RFC 6238，`TotpService`、`SecondFactorService`），用户自愿开启；管理员可重置他人 TOTP（`/api/auth/totp/reset/{targetUserId}`）。【待确认】是否对管理员账户强制开启。
- **单点登录**：不支持 SAML / OIDC / LDAP。
- **防暴力破解**：`AuthAbuseGuard`，登录失败 5 次锁定 10 分钟，并限制注册、验证码发送与成员查询的频率。计数在单实例内存中，多实例部署需要在 nginx 层另加 `limit_req`。
- **角色**：
  - 全局角色：`USER`、`ADMIN`、`CLIENT`。
  - 项目角色（`ProjectMember.role`）：负责人 OWNER、案件管理员 ADMIN、协作人 PARTICIPANT、只读 READ_ONLY、客户 CLIENT_NAMED / CLIENT_GENERIC。逻辑在 `ProjectMemberService`；删除项目仅限创建者。
  - 客户门户：客户凭访问码进入（有效期 30 天），只能看到所在项目的尽调清单和上传入口。
- **AI 工具的租户边界**：`ToolRegistry` 把 `projectId / conversationId / userId` 强制改写为服务端上下文，`ToolFileGuard` 校验按 ID 取文件的权限（2026-08 安全审计修复，见 `docs/SECURITY_AUDIT_2026-08.md`）。

### 3. 自托管的团队服务器

自建团队服务器时，账户身份仍经 AWD 官网账户桥接（`awdk_` 登录），案件库本身不开放自助注册（`deploy/case/README.md`）。【待确认】是否提供完全独立于 AWD 官网的身份方案。

## 二、代码仓库（github.com/AI-WorkDeck/aiworkdeck）

以下为 2026-11-05 通过 GitHub API 读取的设置：

- 仓库公开；默认分支 `master`。
- `master` 分支保护：必须经 PR 合并；必过检查为 `Backend (mvn test)`、`Frontend (build:h5)`、`Desktop (install deps)`、`CLAAssistant`；禁止强推和删除分支。
- **未要求人工审批**（required approving review count = 0），管理员不受保护规则约束（enforce_admins 关闭），没有 CODEOWNERS。【待确认】是否需要收紧。
- 外部贡献者须签署 CLA（`.github/workflows/cla.yml`、`legal/CLA.md`）。
- 维护者名单见 `MAINTAINERS.md`。【待确认】组织成员与权限的定期复核。

## 三、生产环境

- 生产服务器：北京 ECS（官网、插件云后端、案件库等共机）和新加坡主机（国际站），见 `deploy/case/README.md`、`deploy/cloud/README.md`。
- 服务只监听回环地址，由 nginx 对外；环境变量文件权限 0600，服务以专用系统用户运行（`deploy/case/aiworkdeck-case.service`）。
- 对象存储使用最小权限的 RAM 子用户 `awd-mobile-relay`，只能访问中转桶的读写删列。
- 发版签名凭据（Apple 开发者证书、App Store Connect API Key、Windows 的 Azure Artifact Signing、更新清单签名私钥 `UPDATE_SIGNING_KEY`）保存在 GitHub Actions Secrets；插件包签名私钥只存在官网服务器（`.github/workflows/pack-release.yml` 注释）；Windows 签名经 OIDC 并受 GitHub 环境 `windows-signing` 约束。
- 【待确认】谁有服务器 SSH / 云控制台 / 数据库的访问权限，是否开启 MFA，离职或角色变更时如何回收，是否有访问日志与定期复核。
