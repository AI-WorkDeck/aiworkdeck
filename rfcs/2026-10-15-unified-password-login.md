<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 四端统一密码登录

任务：zeweihan/dev-board#1299；用户指示日期：2026-10-15。

## 产品行为

- 默认使用手机号（大陆站）或邮箱（国际站）与密码登录；沿用账户登录状态。
- 首次注册及存量未设置密码的账户：验证身份 → 创建并确认密码 → 正式登录。
- 验证成功但尚未设密时，不签发正式 session、账户 Key 或设备令牌。
- 已设密码账户不再用验证码日常登录。“忘记密码”使用独立用途验证码；成功后使用新密码登录。
- 密码沿用现有 8–72 字符约束，原样处理，不 trim；各端提供确认输入与可见错误。
- 手机原生端默认密码登录；建密/重置打开同区域官网受保护流程，再返回 App 登录。小程序必须验证实际可用的页面入口。
- 官网为身份与密码权威，既有 accountId、手机号归属、项目数据与计费身份保持一致。自建服务器认证器验证不因本次官方账户改造被绕过。

## 跨仓协议

官网既有 OTP verify/exchange-key 成功验证无密码身份后返回 HTTP 200：
`{passwordSetupRequired:true,setupToken,expiresAt,account}`，不含正式凭据。
已设密码身份返回 `password_login_required`，客户端引导密码登录或重置。

| 官网端点 | 输入 | 成功结果 |
| --- | --- | --- |
| POST /api/auth/password/setup | setupToken, password | ok:true |
| POST /api/auth/password/reset/send-code | phone 或 email，现有人机验证参数 | ok:true |
| POST /api/auth/password/reset | phone 或 email, code, password | ok:true |
| POST /api/auth/login | account, password | 既有浏览器会话 |
| POST /api/auth/exchange-key | account, password | 既有账户 Key |

Java 桥透传挑战，仅最终密码登录连接账户或签发设备令牌。设置/重置后复用密码登录。客户端切换身份、站点或取消流程时清理临时票据和密码。

首次验证与重置验证码用途隔离；票据短期、一次性、仅哈希存储，密码变更与票据消费须防并发重放。重置后的旧凭据作废范围以实际实现和测试为准，不把官网会话失效宣称成所有云端设备立即退出。

## 分工及验收

1. 官网组：密码权威、验证码用途、setup/reset、登录页面和双语、持久化与并发回归。
2. 核心组：Java 桥、旧入口兼容、身份归一、桌面和 Office/WPS 页面、测试和领域文档。
3. 手机组：iOS、Android、Harmony、小程序，按 contract-change 先改共享契约再生成；统一官网入口。
4. 主任务：独立审 diff，重新运行关键回归，检查可点击入口和首屏；合成隔离数据验证新用户、旧无密码用户、已有密码用户、重置、错误/过期/重放/限流、跨端同一身份。

分别记录源码验证、浏览器交互、原生构建、正式产物与生产验收，缺少工具链不能写成通过。切换前核实旧客户端兼容与发布顺序，不能先断掉唯一登录入口。用户于本次对话澄清：主任务验收后合并并推送，无需联系 Dan。

## 工作目录和交付边界

原 iCloud 主仓缺少有效 HEAD 且存在大量遗留改动，保持原状。
本任务目录 `/Users/hans_claw_root/awd-auth-20261015/{core,website,mobile}`，使用各仓远端当前主线。
共享规则已同步到 `73b2d5a`。部署规则存在冲突：共享 RULES 2026-10-14 默认部署，项目 AGENTS 要求本次明确发版指示；在完成审验、明确交付范围前不触发生产登录切换。
