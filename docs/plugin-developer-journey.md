<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# 从一个需求到可投稿的插件 / Developer walkthrough

本指南适用于使用 Agent 的外部开发者。先完成本地插件，再申请广场分发；本地纯 Web 开发不要求取得开发者资格。SDK 1.6、本文的宿主兼容修复和新开发者中心仍须对应客户端发布、官网部署后才能用于正式环境。测试源码不等于升级了已安装客户端。

## 1. 给 Agent 的任务

可复制以下需求，并用自己的业务场景替换清单功能：

> 请先阅读 AI WorkDeck 的 sdk/plugin-sdk/README.md、SERVICES.md 和 manifest.schema.json。开发一个清单助手：把用户粘贴的文本逐行去重、去掉空行，支持复选框或编号格式，用 user 范围设置记住格式，跟随宿主主题并适配窄栏。默认不调用 AI、不联网、不读取项目文件，所以权限为空。按 examples/checklist-helper 的目录结构交付；不修改 SDK 副本。先校验和打包，再在专用测试项目中安装，从真实入口操作设置、关闭重开、禁用和卸载。记录错误和修复。获得开发者资格后，用我在安全环境中提供的专用投稿令牌提交并查询待审核状态，不自动发布。不要向我索取平台 Cookie，也不要自动批准自己申请的权限。

Agent 可以使用 Codex 或其他具备本地文件操作能力的开发工具。外部 Agent 和产品内 Agent 是两个入口：外部工具写磁盘文件；产品内 Agent 使用已有项目文件工具与 `plugin_dev_scaffold/install/status`，直接在项目中开发。没有开放的 API 不应以“模拟成功”代替。

## 2. 创建和校验

安装 Node.js 20+，获取本仓或官网开发页面下载的完整模板。CLI 需要同包的 `sdk/plugin-sdk/`，不要只下载一个脚本。

```sh
node scripts/plugin-dev.mjs init ./my-checklist --id my-checklist
node scripts/plugin-dev.mjs validate ./my-checklist
node scripts/plugin-dev.mjs package ./my-checklist --out ./my-checklist-0.1.0.zip
```

`manifest.json` 必须在 ZIP 根目录，`frontendEntry` 或 `contributes.views[].entry` 指向包内 `web/` 文件。设置默认值写 `default`；`$schema` 仅辅助编辑器校验。新版本使用递增语义版本号；官网投稿目前只收 `x.y.z` 三段数字，不接受 `-rc` 或 `+build` 后缀（本地开发校验允许这些后缀）。SDK、类型与 schema 使用同一版本，不自行修改分发副本。已有 ZIP 不覆盖，重新打包须换输出名或明确移走旧文件。

优先运行可用的[清单助手](../examples/checklist-helper/)。它只使用宿主设置接口，不需要外部账号、模型额度或网络权限。

## 3. 安装：选择符合环境的一条路径

### 桌面客户端

1. 新建专用测试项目。在插件中心启用「插件开发」，工作台会出现对应入口。
2. 从 Finder / 文件管理器将源码文件夹拖到项目资源管理器；文件夹名与 manifest.id 一致。保留完整目录层次。目录拖入需要桌面宿主的文件桥，普通浏览器不能照搬此动作。
3. 在插件开发面板找到源码，点击「安装到本机」。安装后入口应立即出现，点击打开真实插件面板。
4. 修改项目中的源码后等待保存完成，再「重新安装」。重装不是文件监听，也不会把外部磁盘修改自动同步到已经导入的项目。

### 浏览器开发环境，或直接让产品内 Agent 开发

1. 在插件开发面板「新建插件」，输入稳定 ID 和显示名。也可以让产品内 Agent 调 `plugin_dev_scaffold`；返回值有源码 `folderId`。
2. 在文件树打开生成的 manifest 和 web/index.html，将业务代码保存进去；新增业务文件用项目文件工具。不要用「新建 Word 文档」创建 `.txt/.js`，那会生成 Office 文档。
3. 等待保存完成后安装；用 `plugin_dev_install(folderId)` 或面板按钮均可。产品内 Agent 的完整操作说明见 [插件开发助手](../backend/skills/plugin-dev/prompt.md)。

### 可选 CLI 安装与诊断

端口必须来自当前**测试宿主**的实际地址，不能把示例端口当作用户客户端端口。下面的 `PORT`、`PROJECT_ID` 和 `FOLDER_ID` 需要替换：

```sh
node scripts/plugin-dev.mjs status --endpoint http://127.0.0.1:PORT --project-id PROJECT_ID
node scripts/plugin-dev.mjs install --endpoint http://127.0.0.1:PORT --project-id PROJECT_ID --folder-id FOLDER_ID
```

项目 ID 可从工作台地址中的 `projectId` 获取；`status` 返回已在项目中的插件源码及 `folderId`。磁盘路径不是 `folderId`，`install` 也不接收源码目录。桌面单机免登模式由宿主现有回环保护授权，不需要复制会话；有登录要求的宿主仍需合法 `AWD_SESSION_ID`，不能通过 CLI 绕过管理员检查。没有适用会话时直接用已登录的插件开发面板，不要求用户在聊天里提供凭据。不要写 `dev/install .`——`dev` 与 `install` 是两个独立命令名。

## 4. 调试与验收

先验证页面加载、SDK 握手和一个真实主要操作，再检查：主题、窄面板、长文本、设置持久化、关闭重开、禁用/启用与卸载的入口更新。开发面板安装失败会保留详细错误；修正错误后重试。修改后无变化先核对保存状态、源码版本和已安装版本。

| 现象 | 检查与处理 |
| --- | --- |
| `$schema` / `default` 被拒绝 | 此修复之前的宿主存在解析不一致；使用含修复的测试构建，不篡改 SDK 掩盖问题 |
| 等待宿主不结束 | SDK 同步 script 必须先于业务代码；直接打开 HTML 没有真实宿主桥 |
| `unknown_method` | 当前宿主不支持所用 API；核对版本和能力，显示可操作的升级提示 |
| `permission_denied` | 检查 manifest 最小权限、项目访问与可信宿主授权，不扩大到所有权限 |
| 网络/MCP 服务不可用 | 先在宿主设置明确授权开发服务，再建立连接；manifest 改变后重新授权 |
| 投稿报 `version_not_newer` | 先查本人投稿，包含待审和驳回版本；修正后提高版本号再提交 |
| 超时但不确定是否上传 | 先运行 `submissions` 或查看开发者中心；不要自动重复上传 |

官网模板的 `dev/host-simulator.html` 仅供浏览器调试桥契约，返回模拟数据或 `host_required`。它不能证明文件权限、账户登录、MCP、付款、真实安装或审核通过。不要给 iframe 加 `allow-same-origin`、把平台密钥放进网页，或借放宽 CSP 修运行失败。

有独立账号、订阅或 MCP 的插件，继续按 [服务验收](plugin-services-validation.md) 跑真实宿主流程。清单助手和模拟器通过，不能代替服务接入验收；先测断连、过期、付款未完成、账户切换和通道失败，再验证成功路径。

## 5. 开发者申请与维护

正式入口为官网开发者中心：中国站 `/zh/plugins/developer`，国际站 `/en/plugins/developer`，由插件开发页和账户页导航。登录自己的官网账户，填写个人/机构类型、展示名、联系方式、开发用途与拟申请权限，再提交基本资料审核。初期开发者申请和基本资料审核不收费；已有插件定价、服务商订阅和平台模型计费按各自规则执行，不承诺全部插件或模型免费。

账号已有验证渠道与自行填写的联系渠道应分别核对。开发者资料审核通过只代表平台完成基本维护核对，**不代表实名、机构法律资质或安全认证**。不要上传身份证件、客户文书或无关敏感资料。私有联系方式只供本人和平台维护审核，不放进公开插件 registry。

状态包含草稿、待审核、通过、驳回和暂停。被驳回可按意见修改再申请；修改已经通过的核心资料需要重新审核。后台保留资料版本、审核意见和审核记录，关联作者账户下的插件、版本、状态、实际声明权限。暂停资格阻止新投稿与新的审核通过；既有已发布插件是否撤回仍走独立撤回流程。

插件 ID 所有权绑定提交账户，修改 manifest.author 不会转移所有权。账户或维护者变更需平台人工核对。申请资格与每个插件版本的内容、权限、依赖及安全审核是两道独立流程；通过前者不自动通过后者。

## 6. 投稿与查询

资料审核通过后，在开发者中心创建专用投稿令牌，仅显示一次。把它存入本地安全环境变量 `AWD_PLUGIN_TOKEN`，不放进源码、ZIP、命令参数、聊天或 CI 日志。令牌仅授权本人插件投稿与投稿查询，可随时撤销，有效期以创建界面为准。

```sh
node scripts/plugin-dev.mjs submit ./my-checklist --endpoint https://www.aiworkdeck.com/api/plugins --price-cents 0
node scripts/plugin-dev.mjs submissions --endpoint https://www.aiworkdeck.com/api/plugins
```

国际站将端点改为 `https://www.workdeck.ai/api/plugins`，使用对应站点账户和令牌；两站账号/资料并不因此自动共享。CLI 不跟随重定向，不自动登录，也不自动重试上传。`pending` 表示受理成功，之后由维护者检查、审核、签名上架。驳回意见在本人开发者中心查看；修改后以更高版本重投。示例的隔离测试投稿不会被发布到生产广场。

## 7. 主产品接入范围

| 需求 | 公开入口与实际边界 |
| --- | --- |
| 插件自己的设置 | manifest settings，installation/user/project；secret 由可信宿主保存，不返回 iframe |
| 平台 AI / 额度 | `awd.ai.request` 使用平台能力及用户额度；`awd.chat.send` 发起可见 Agent 工作流 |
| 自己的账号 | `contributes.connections`，bearer 或公共客户端 OAuth PKCE；宿主可信 UI 完成连接 |
| 插件 MCP | `contributes.mcpServers` 声明公共 HTTPS streamable-http 与固定工具/schema；授权后供宿主 Agent 调用，不支持任意 stdio 进程 |
| 自己的付费服务 | 固定的订阅状态操作及 checkoutUrl；在自己的服务商处理支付，宿主不据此自动代收分账 |
| 平台广场收费 | 通过现有定价、权益和审核流程，与开发者资格和外部订阅分开 |

确切参数、返回值与取消语义见 [SERVICES.md](../sdk/plugin-sdk/SERVICES.md) 和 [SDK](../sdk/plugin-sdk/README.md)。正式 OAuth、付费和外部 MCP 需与真实服务单独联调，不能从本地清单示例推定已通过。

## English quick path

Read the SDK README, SERVICES and manifest schema, then ask your Agent to implement the permission-free checklist example. Validate and package with Node 20+. In a desktop test project, enable Plugin Development and drag the source directory into the file tree; in a browser, scaffold a plugin in the development panel and edit its project files. Wait for saves, install, open the actual entry, and test settings, reopen, disable and uninstall. CLI installation consumes project/folder IDs, not a disk directory; local-mode loopback hosts need no copied session.

Apply in the website Developer Center with maintainer details, a private contact channel, purpose and intended permissions. Initial developer registration is free. Basic profile review is not identity or legal-qualification certification, and does not approve a plugin automatically. Core profile changes require review again. Existing paid-plugin terms and independent service subscriptions remain separate.

After approval, create a revocable submission token, expose it only as `AWD_PLUGIN_TOKEN`, and run `submit` followed by `submissions` against your site's explicit HTTPS `/api/plugins` endpoint. Each new submission needs a version higher than all previous submissions, including rejected ones. A pending response is receipt, not publication. New host and portal features require their corresponding release/deployment; source merges alone do not update users' installations.
