# 数据分级（草稿）

> **草稿，待法务审阅。** 起草 2026-11-05；最近审阅：【待填写】。
> 本文记录 AWD 现有的数据类别和存放位置，不新增任何技术措施或承诺。

## 一、分级

| 级别 | 含义 | AWD 中的典型数据 |
|---|---|---|
| **L3 机密（客户材料）** | 律师执业保密义务覆盖的内容 | 项目文件与版本历史、AI 对话正文、文档解析/摘要/实体等派生内容、尽调清单与客户上传材料、会议录音与转写稿、聊天消息与附件 |
| **L2 凭据** | 泄露即可冒用账户或服务 | 会话 ID、设备令牌（`awdt_`）、账户密钥（`awdk_`）、用户自备的模型/数据服务 Key、插件与 MCP 连接令牌、GitHub/Gitee 访问令牌、服务端平台密钥 |
| **L2 账户与账务** | 可识别个人的账户信息和财务记录 | 用户名、手机号、邮箱、团队成员关系、Credits 账务流水 |
| **L1 使用统计** | 只含枚举名与计数 | 匿名使用统计、团队使用统计（带账户身份，见 PRIVACY 第十一节） |
| **L0 公开** | 本来公开 | 开源代码、插件清单、公开模型文件、法规公开文本 |

分级是本草稿新引入的说明框架，代码中没有对应的标签字段。【待确认】是否采用这套级别名称。

## 二、各类数据存放在哪里

### 桌面端（默认形态）

- **数据目录**：`~/.aiworkdeck`（macOS / Windows / Linux 同此规则；设置 `AWD_HOME` 可改到别处）。出处：`desktop/main/awd-home.js` 的 `dataDir()`。
- **本地数据库**：嵌入式 H2 文件库 `~/.aiworkdeck/local`，存项目元数据、AI 对话、设置等。出处：`backend/src/main/resources/application-desktop.yml`。
- **项目文件**：托管项目在数据目录的 `projects/{id}` 下；「打开本地文件夹」型项目留在用户自己的文件夹里。
- **本地后端只监听回环地址**：`LocalModeLoopbackGuard` 在监听地址不是 127.0.0.1 时拒绝启动，`LocalModeAccessFilter` 拒绝非回环来源与跨域请求。
- **静态加密**：
  - 本地 H2 数据库与项目文件**没有应用层加密**，依赖操作系统的磁盘加密（FileVault / BitLocker）。
  - 插件与连接器凭据用 AES-256-GCM 加密（`PluginCredentialStore`），密钥是 `~/.aiworkdeck/plugin-credentials.key`（权限 0600，与数据库分开存放）。
  - 管理员在「系统管理」里填写的服务 Key 存在 `system_setting` 表，**未做应用层加密**（`SystemSettingService`）。【待确认】是否需要改进，或在文档中提示用户启用磁盘加密。
  - 没有使用系统钥匙串或 Electron safeStorage。

### 云端（用户主动使用云功能时）

- **插件云后端**（addin.aiworkdeck.com / addin.workdeck.ai）与**案件库**（case.aiworkdeck.com / case.workdeck.ai）各用独立的 PostgreSQL 库（`aiworkdeck_cloud`、`aiworkdeck_case`）。出处：`deploy/cloud/README.md`、`deploy/case/README.md`。
- **对象存储中转区**：手机影像、跨设备传输、插件文档镜像使用阿里云 OSS 私有桶，按区域分国内（cn-beijing）与国际（ap-southeast-1）两套。出处：`deploy/cloud/setup-relay-oss.py`、`deploy/cloud/README.md`。
- **服务端凭据加密**：平台 AI Key 用 `PlatformAiKeyCipher`（AES-256-GCM，密钥来自环境变量 `AWD_PLATFORM_KEY_SECRET`）；Git 令牌用 `GitTokenCipher`（`AWD_GIT_TOKEN_SECRET`）；设备令牌只存哈希。
- 各功能的具体数据流见 `legal/PRIVACY.md` 第一部分。

## 三、处理要求（现状）

- L3 数据不进入使用统计通道：采集层有字段白名单 `TelemetryAttrWhitelist`，并有自动化测试锁定（PRIVACY 第五节）。
- 新增出站请求必须先在 `legal/PRIVACY.md` 声明（仓库 `CLAUDE.md` 的硬红线）。
- L2 凭据不得提交进代码仓库：CI 的 gitleaks 扫描会拦截新提交中的密钥（`.github/workflows/supply-chain.yml`）。历史遗留情况见 `vulnerability-mgmt.md`。
- 日志：后端没有统一的日志脱敏层，个别组件（`GitTokenCipher`、`SmtpMailGateway`）对令牌做了掩码。【待确认】是否需要正式的「日志不得记录 L3 正文」规则和检查手段。
