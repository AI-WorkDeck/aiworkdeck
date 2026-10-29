<!-- SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors -->
<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Skill、Plugin 与 MCP

依据：2026-10-29 用户反馈；dev-board #1598、#1599、#1600。

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

第一轮独立连接支持公共 HTTPS 的 Streamable HTTP 和 Bearer 凭据；不执行 stdio 本地命令，也不宣称具备尚未实现的 OAuth 登录。地址须经过现有公网端点策略，每次请求重新校验；重定向不能携凭据转发。工具的名称、描述、参数和结果是外部数据，不能提升宿主权限。未知工具不因自报 readOnlyHint 就获得只读模式权限。

## 预置目录与来源

资料核对日期：2026-10-29。下面是官方文档确认，不代表使用客户凭据完成了付费查询。

| 服务 | 官方接入资料 | 范围 |
| --- | --- | --- |
| 企查查 | https://agent.qcc.com/guide | 企业信息等 MCP；已有平台通道或个人 MCP 凭据 |
| 北大法宝 | https://mcp.pkulaw.com/ | 法规、案例等 MCP；已有平台通道或个人凭据 |
| 元典 | https://open.chineselaw.com/llms-full.txt | 法规、案例、企业、证券合规、幻觉校验分类端点；用户自配 |
| Tavily | https://github.com/tavily-ai/tavily-mcp | 搜索与网页读取；官方远程 MCP 支持 Bearer；用户自配 |
| GitHub | https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/set-up-the-github-mcp-server | 官方远程 MCP 支持个人访问令牌；实际工具权限取决于账号与令牌 |
| Notion | https://developers.notion.com/guides/mcp/overview | 官方托管 MCP 通过 OAuth 授权；不列作本轮可直接连接的预置 |

元典默认法律端点为 `https://open.chineselaw.com/mcp/law/stream`，案例等可通过自定义连接添加。Tavily 为 `https://mcp.tavily.com/mcp/`，GitHub 为 `https://api.githubcopilot.com/mcp/`。目录中的“官方”表示供应商维护服务，不表示 AI WorkDeck 提供免费额度或承诺双方商业合作。

## 验收

从实际市场入口检查三个分类、技能菜单过滤与来源标识、进入 MCP 设置、保存、测试、启用、AI 工具发现与调用、停用和删除。覆盖同机不同用户/账户隔离、旧调用撤权、错误与无工具状态、修改地址后旧密钥不外发、只读模式限制和本地化。

用合成 MCP 服务验证协议和调用链；企查查/法宝自配路径必须断言平台网关零调用，错误时也为零。用原真实端点和个人账户执行查询属于供应商线上验收，未执行时单独标明；不以 mock 返回成功冒充真实查询。官网、源码合并、正式发布、已安装客户端生效分别记录。
