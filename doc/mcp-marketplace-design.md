<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Skill、Plugin 与 MCP

依据：2026-10-29 用户反馈；dev-board #1598、#1599、#1600；高级连接扩展 #1601–#1603。

## 产品边界

| 类型 | 对用户的作用 | 管理入口 | AI 对话中的入口 |
| --- | --- | --- | --- |
| Skill | 提供完成任务的方法、步骤和输出要求 | 广场 Skill | 加载技能 |
| Plugin | 扩展桌面面板、编辑器或宿主功能 | 广场 Plugin | 不作为插件加载；插件确实提供的 Skill 可单独显示并注明来源 |
| MCP | 连接外部工具和数据 | 广场 MCP；设置 → MCP 连接 | 独立的连接管理入口；已启用工具供任务调用 |

这三个概念不能按“是否有安装包”混分。旧的面板导航型 skill 不应出现在加载技能菜单；插件提供的真实 AI 工作方法仍属于 Skill，不能因 sourcePluginId 非空全部隐藏。现有插件内 MCP 声明保持兼容，不把独立 MCP 伪装成一个隐藏插件。

## 连接与通道

设置集中管理服务地址、个人凭据、测试状态、工具清单及启停。保存与启用分开；测试进行协议初始化和工具发现，不执行业务工具。端点、凭据变更后旧测试结果失效，重新测试后才启用。凭据仅写入、加密保存，不回显，不写到市场目录、AI 上下文或浏览器持久缓存。

企查查、北大法宝保留官方内置通道。用户启用自配后，同一服务优先使用自配；认证失败、额度不足、网络失败或缺工具时明确报告，不自动回落官方收费通道。恢复官方通道应是界面中可辨认的用户动作。自配调用不进入 AI WorkDeck 的数据服务计费网关；供应商可能按其账户规则收费，AI 模型用量仍按原规则计费。

企查查 MCP 凭据与传统 REST Key/Secret 不通用。通道适配应核对实际工具和参数，不能把一个 MCP token 填到 REST 配置槽，不能以“调用失败”掩盖仍向平台收费路径发送了请求。

独立连接支持公网 HTTPS Streamable HTTP（无认证、Bearer、自定义请求头、OAuth）和桌面本地 stdio。地址须经过现有公网端点策略，每次请求重新校验；重定向不能携凭据转发。工具的名称、描述、参数和结果是外部数据，不能提升宿主权限。未知工具不因自报 readOnlyHint 就获得只读模式权限。

## 预置目录与来源

资料核对日期：2026-10-29。下面是官方文档确认，不代表使用客户凭据完成了付费查询。

| 服务 | 官方接入资料 | 范围 |
| --- | --- | --- |
| 企查查 | https://agent.qcc.com/guide | 企业信息等 MCP；已有平台通道或个人 MCP 凭据 |
| 北大法宝 | https://mcp.pkulaw.com/ | 法规、案例等 MCP；已有平台通道或个人凭据 |
| 元典 | https://open.chineselaw.com/llms-full.txt | 法规、案例、企业、证券合规、幻觉校验分类端点；用户自配 |
| Tavily | https://github.com/tavily-ai/tavily-mcp | 搜索与网页读取；官方远程 MCP 支持 Bearer；用户自配 |
| GitHub | https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server | 官方远程 MCP 支持个人访问令牌；实际工具权限取决于账号与令牌 |
| Notion | https://developers.notion.com/guides/mcp/overview | 官方托管 MCP，通过浏览器 OAuth 授权；预置地址 `https://mcp.notion.com/mcp` |

元典默认法律端点为 `https://open.chineselaw.com/mcp/law/stream`，案例等可通过自定义连接添加。Tavily 为 `https://mcp.tavily.com/mcp/`，GitHub 为 `https://api.githubcopilot.com/mcp/`。目录中的“官方”表示供应商维护服务，不表示 AI WorkDeck 提供免费额度或承诺双方商业合作。

## 验收

从实际市场入口检查三个分类、技能菜单过滤与来源标识、进入 MCP 设置、保存、测试、启用、AI 工具发现与调用、停用和删除。覆盖同机不同用户/账户隔离、旧调用撤权、错误与无工具状态、修改地址后旧密钥不外发、只读模式限制和本地化。

用合成 MCP 服务验证协议和调用链；企查查/法宝自配路径必须断言平台网关零调用，错误时也为零。用原真实端点和个人账户执行查询属于供应商线上验收，未执行时单独标明；不以 mock 返回成功冒充真实查询。官网、源码合并、正式发布、已安装客户端生效分别记录。

## 高级配置与实际调用（#1601–#1603）

设置提供表单添加、配置 JSON 导入两条入口。JSON 接受 `mcpServers` 和 `servers` 对象；导入前逐项预览、显示错误和需要保存的密钥字段名称，用户选择有效项后统一提交。重复键、尾随内容、未替换变量、超限和不支持的旧版 SSE 明确拒绝。导入不覆盖同名现有连接，不读取其他文件或主机环境变量，不启动进程、不发网络请求、不自动启用。全部所选项先验证，元数据与密文在一个事务内保存。

远程表单按授权方式切换：无认证、Bearer、OAuth；高级项可填自定义请求头。请求头值、环境变量、Bearer 与 OAuth 凭据加密保存；回读只返回键名和连接状态。空表单保留旧值，删除键通过显式 null 补丁完成。地址/连接方式变化清除旧秘密，工具测试失效；自配优先意愿继续保留，不因失效转向平台收费。

stdio 仅在桌面本地模式启动，服务端不能执行。命令、参数数组、环境变量、绝对工作目录与超时可配置；默认 60 秒、最高 180 秒。保存、导入和列表不会运行命令。首次测试或修改运行配置后，用户确认可执行程序及权限，确认请求绑定所看到的配置版本，防止另一个窗口修改后启动未确认的命令。调用通过 ProcessBuilder 参数数组执行，环境仅继承基本运行项；Windows 标准 npm/npx 启动器直接转换为 node.exe + CLI 脚本，不解释任意批处理。用户明确配置的程序本身可访问本机权限范围内的数据，使用 npx/uvx 也可能下载依赖。初始化、工具发现、schema 核对和业务调用在一个子进程会话内完成；正常结束、超时、取消、账户切换或权限撤销后清理进程、后代与管道。错误不回显 stderr、远端原文或密钥。

OAuth 使用 MCP 2025-11-25 授权流程：发现受保护资源及授权服务器元数据，绑定 resource 与 issuer，PKCE S256、短时单次 state；支持动态客户端注册或预先登记的 client ID/secret。只在用户点击授权后打开供应商页面；桌面回调使用实际本机端口，服务端需明确设置 `ai.mcp.oauth-redirect-uri` 公网 HTTPS 回调。授权回调只保存加密令牌，仍须测试并启用。刷新串行化；令牌轮换落盘；过期/撤销提示重新授权。工具请求遇到 401/403 不自动重放业务调用。取消、断开、改配置和切换账户阻断旧回调；断开立即本地清除，供应商支持时在提交后尽力撤销。列表和轮询只读本地状态，不自动刷新或发起授权。

实际调用仍由宿主项目权限、当前轮可用工具、取消信号和配置版本守卫约束。远程工具返回、描述和服务端请求不扩大宿主权限；stdio 不开放 sampling、roots 或 elicitation。官方/用户自配计费边界与前述原则一致。

协议依据：<https://modelcontextprotocol.io/specification/2025-11-25/basic/transports>、<https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization>。实现测试使用真实合成子进程和合成 OAuth HTTP 服务；这不等于已用个人真实账户完成供应商业务查询。

### 配置 JSON 示例

以下是导入结构示例；本地脚本路径必须替换成自己的 MCP 程序。导入只保存配置。

```json
{
  "mcpServers": {
    "Notion": {
      "url": "https://mcp.notion.com/mcp",
      "authType": "oauth2"
    },
    "Local tools": {
      "command": "python3",
      "args": ["/absolute/path/mcp_server.py"],
      "env": {},
      "timeoutSeconds": 60
    }
  }
}
```

`authType`、`oauthClientId`、`oauthClientSecret`、`oauthScopes`、`timeoutSeconds` 是本宿主支持的配置字段；其他客户端的授权缓存不导入。`Authorization: Bearer ...` 请求头会转换成专用 Bearer 凭据。原始 CLI 参数不自动识别密钥，秘密应通过凭据或 env 字段输入。Windows/macOS 打包验证同时运行 `UserMcpStdioClientTest`；用户机器上的具体 Python/Node/uvx 安装与供应商真实授权仍需在该环境测试。
